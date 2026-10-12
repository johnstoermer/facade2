// Original speech-word scheduler and viseme state, using exported original data.
// Source/clock/randomness limits are explicit in SPEECH-FACE.txt. No audio RMS,
// generated lip art, or inferred phoneme alignment is used.
const f=Math.fround;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const shapeNames=['pause','aa','ee_ih','I','w_oo','ay_eh_ah','oh','p_b_m','ruh_uhh','v_f','th','L','d_t_z_s_n','g_k_y_h','sigh','clearThroat'];
const shapeMap=new Map([[1,0],[63,0],[3,0],[31,1],[32,2],[33,2],[34,3],[35,4],[36,4],[37,5],[38,5],[39,5],[40,6],[41,7],[42,7],[43,7],[44,8],[45,8],[46,9],[47,9],[48,10],[49,10],[50,11],[51,12],[52,12],[53,12],[54,12],[55,12],[56,13],[57,13],[58,13],[59,13],[60,13],[61,14],[62,15]]);
export const speechFaceContract=Object.freeze({group:3,shapeNames:Object.freeze(shapeNames),lookaheadMs:150,wordExtensionMs:400,cueSlots:10,defaultControllerRate:30,sourceFunctions:['10044c90','10045320','100671e0','100669b0','10066ca0','1006e110']});
const cue=code=>code>=4&&code<=29;
const integer=(v,what)=>{if(!Number.isInteger(v)||v<0||v>0x7fffffff)throw Error('Invalid original speech '+what);return v;};

// An optional repeatable copy of the shipped Microsoft CRT rand arithmetic.
// Its seed/consumption is independent of the original engine's shared RNG.
export function createSpeechRandom(seed=1){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,214013)+2531011)>>>0;return(state>>>16)&32767;};
}

export function compileSpeechGroups(input){
  if(!Array.isArray(input)||input.length<2)throw Error('Incomplete original speech stream');
  let offset=0;
  const groups=input.map((g,i)=>{
    if(!Array.isArray(g)||g.length!==2||!Array.isArray(g[1])||g[1].length===0)throw Error('Invalid original speech group');
    const time=integer(g[0],'time'),codes=g[1].map(c=>integer(c,'code'));
    for(let j=0;j<codes.length;j++){
      const code=codes[j];
      if(code>63||code===30)throw Error('Unsupported original speech code '+code);
      if(j<codes.length-1&&code<=30)throw Error('Early speech group terminator');
    }
    if(codes.at(-1)>29)throw Error('Missing speech group terminator');
    const terminal=codes.length===1&&codes[0]===0;
    if(terminal!==(i===input.length-1))throw Error('Speech stream end must be the final group');
    if(cue(codes.at(-1))&&codes.length!==1)throw Error('Native cue group must contain one code');
    const row={index:i,time,codes,offset,terminal,cue:cue(codes[0])};
    offset+=1+codes.length;return row;
  });
  const words=[];
  for(let i=0;i<groups.length-1;i++){
    const g=groups[i];if(g.cue)continue;
    let next=i+1;const cues=[];
    while(groups[next].cue){const c=groups[next++];cues.push({code:c.codes[0],dueMs:integer(c.time+g.time,'cue time'),groupIndex:c.index});}
    if(cues.length>10)throw Error('Original speech exceeds ten cues per word');
    const end=integer(groups[next].time+(groups[next].offset>2?400:0),'extended word time');
    const count=g.codes.length-(g.codes.at(-1)===0?1:0);
    if(count<1||end<=g.time)throw Error('Nonpositive original speech word interval');
    const slotMs=Math.floor((end-g.time)/count);
    if(slotMs<1)throw Error('Original speech would divide by zero');
    words.push({groupIndex:i,wordOffset:g.offset,startMs:g.time,endMs:end,slotMs,count,codes:g.codes.slice(0,count),expiresMs:g.time+slotMs*count,cues});
  }
  if(words.length===0)throw Error('Original speech starts at end');
  return {format:'facade-native-speech-plan-v1',groups,words,wordCount:offset,terminalTimeMs:groups.at(-1).time};
}

// Mirrors one invocation of the native speech scheduler. Cues are data; this
// module does not interpret them as story actions. A stalled caller skips to
// the current code, just as the original recursive word advance does.
export class SpeechTrack{
  constructor(input){this.plan=compileSpeechGroups(input);this.index=-1;this.active=true;this.previousCode=-1;this.lastMs=-1;this.slots=Array(10).fill(null);}
  _flush(out){
    for(let i=0;i<10;i++){
      const c=this.slots[i];if(c&&(c.code===8||c.code===9))out.cues.push({...c,atMs:out.atMs,flushed:true});
      this.slots[i]=null;
    }
  }
  _next(out){
    if(++this.index===this.plan.words.length){this.active=false;out.commands.push(1);this._flush(out);return;}
    for(const c of this.plan.words[this.index].cues){
      const slot=this.slots.indexOf(null);if(slot<0)throw Error('Original speech cue queue overflow');
      this.slots[slot]={...c};
    }
  }
  step(elapsedMs){
    const now=integer(Math.floor(elapsedMs),'elapsed time');
    if(now<this.lastMs)throw Error('Speech time moved backwards; start a new stream');
    this.lastMs=now;const out={atMs:now,active:this.active,code:this.previousCode,wordIndex:this.index,commands:[],cues:[]};
    if(!this.active){this._flush(out);return out;}
    if(this.index<0)this._next(out);
    while(this.active){
      // Strict <, and physical cue-slot order, match10044c90.
      for(let i=0;i<10;i++){const c=this.slots[i];if(c&&c.dueMs<now){out.cues.push({...c,atMs:now,flushed:false});this.slots[i]=null;}}
      const w=this.plan.words[this.index],elapsed=Math.max(0,now+150-w.startMs);
      if(elapsed<w.count*w.slotMs){
        const code=w.codes[Math.min(w.count-1,Math.floor(elapsed/w.slotMs))];
        if(code!==this.previousCode){out.commands.push(code);this.previousCode=code;}
        break;
      }
      this._next(out);
    }
    out.active=this.active;out.code=this.previousCode;out.wordIndex=this.index;return out;
  }
  stop(elapsedMs=this.lastMs<0?0:this.lastMs){
    const now=integer(Math.floor(elapsedMs),'stop time');this.active=false;
    const out={atMs:now,active:false,code:this.previousCode,wordIndex:this.index,commands:[1],cues:[]};this._flush(out);return out;
  }
}

// The explicit point buffers retain native snapshot/current/target semantics,
// including interruption of a decay or drift. They contain only weighted and
// linearly blended deltas from the original eighteen-point viseme shapes.
export class SpeechFace{
  constructor(headData,{rate=30,randomWord=()=>Math.floor(Math.random()*32768),drift=true}={}){
    if(headData?.format!=='facade-head-data-v1')throw Error('Speech face requires original head data');
    const group=headData.expressionGroups?.[3];
    if(group?.pointCount!==18||group.entries.length!==16||group.entries.some((e,i)=>e.name!==shapeNames[i]||e.points.length!==18||e.points.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x)))))throw Error('Original viseme table mismatch');
    if(!Number.isFinite(rate)||rate<=0||rate>120||typeof randomWord!=='function')throw Error('Invalid speech controller clock/random source');
    this.group=group;this.rate=rate;this.randomWord=randomWord;this.drift=drift;
    this.current=group.entries[0].points.map(p=>p.map(f));this.from=this.current.map(p=>[...p]);this.target=this.current.map(p=>[...p]);
    this.index=0;this.weight=1;this.progress=1;this.speed=0;this.increment=0;this.linear=true;
    this.code=1;this.track=null;this.identity=null;this.tick=-1;this.sampledMs=-1;this.lastStepMs=-1;this.pendingCues=[];this.appliedCommands=0;this.mode=null;
  }
  _rand(){const x=this.randomWord();if(!Number.isInteger(x)||x<0||x>32767)throw Error('Speech randomWord must return an integer0..32767');return x;}
  _int(low,high){return high<=low?low:this._rand()%(high-low+1)+low;}
  _float(low,high,precision){
    //100aedc8..edf1 multiplies original float operands in x87, truncates to
    // signed ints, draws inclusively, then divides. In particular .95f*1000
    // truncates to949, not950;1.05f*1000 truncates to1049, not1050.
    precision=f(precision);return this._int(Math.trunc(f(low)*precision),Math.trunc(f(high)*precision))/precision;
  }
  _target(index,weight,speed,linear){
    this.from=this.current.map(p=>[...p]);this.target=this.group.entries[index].points.map(p=>p.map(v=>f(v*weight)));
    this.index=index;this.weight=weight;this.progress=0;this.speed=f(2*clamp(speed,.01,linear?1:.3));this.linear=linear;this.increment=linear?this.speed:f(this.speed/20);
  }
  setCode(code,weight=-1){
    if(code!==2&&!shapeMap.has(code))throw Error(cue(code)?'Speech cue is not a viseme':'Unknown original viseme '+code);
    if(!Number.isFinite(weight)||(weight<0&&weight!==-1))throw Error('Invalid original viseme weight');
    weight=f(weight);
    this.code=code;this.appliedCommands++;
    //100671e0 makes this random choice even for hold and forced-min shapes.
    let low=this._rand()%2===0?70:90;
    if(code===2)return;
    if([35,36,41,42,43,46,47].includes(code))low=80;
    if(weight===-1)weight=f(this._int(low,100)/100);
    this._target(shapeMap.get(code),weight,code===3?f(1/60):1,true);
  }
  _faceStep(){
    //1006e4ba..4d0 supplies .95f/1.05f for this group. Native drift is an
    // absolute target weight, not a multiplier of the prior random weight.
    // Its only native suppression here is editing this actor in FaceEditor.
    if(this.progress===1&&this.drift){
      const weight=f(this._float(.95,1.05,1000)),speed=f(.25/this._float(4,6,1000));
      this._target(this.index,weight,speed,false);return;
    }
    if(!this.linear){this.increment=f(this.progress>=.5?Math.max(this.increment/1.15,this.speed/20):Math.min(this.increment*1.15,this.speed));}
    this.progress=f(Math.min(1,this.progress+this.increment));
    for(let i=0;i<18;i++)for(let a=0;a<2;a++)this.current[i][a]=f(this.target[i][a]*this.progress+(1-this.progress)*this.from[i][a]);
  }
  start(input,identity=null){
    this.track=new SpeechTrack(input);this.identity=identity;this.tick=-1;this.sampledMs=-1;this.lastStepMs=-1;this.pendingCues=[];this.mode=null;return this;
  }
  _step(ms){
    if(!Number.isFinite(ms)||ms<0||ms<this.lastStepMs)throw Error('Invalid or decreasing speech time');
    this.lastStepMs=ms;
    if(this.track){const out=this.track.step(ms);for(const code of out.commands)this.setCode(code);this.pendingCues.push(...out.cues);}
    this._faceStep();return this.snapshot();
  }
  // One explicit native-style update; elapsedMs has the native GetTickCount
  // millisecond scale. Do not call this once per browser render unintentionally.
  step(elapsedMs){if(this.mode==='sample')throw Error('Cannot mix speech sample and step clocks');this.mode='step';return this._step(elapsedMs);}
  // Browser convenience clock, independent of rendering.30Hz is a declared
  // replacement-controller choice, not the original variable frame cadence.
  sample(elapsedMs){
    if(this.mode==='step')throw Error('Cannot mix speech step and sample clocks');
    if(!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs<this.sampledMs)throw Error('Invalid or decreasing speech time');
    this.mode='sample';this.sampledMs=elapsedMs;
    const targetTick=Math.floor(elapsedMs*this.rate/1000);
    while(this.tick<targetTick){this.tick++;this._step(this.tick*1000/this.rate);}
    return this.snapshot();
  }
  stop(){
    if(this.track){const out=this.track.stop();this.pendingCues.push(...out.cues);this.track=null;}
    this.setCode(1);this._faceStep();return this.snapshot();
  }
  apply(actor){
    actor.head??={};actor.head.groups??=[];actor.head.groupDeltas??=[];
    actor.head.groups[3]={index:this.index,weight:this.weight};actor.head.groupDeltas[3]=this.current;
    return this.snapshot();
  }
  takeCues(){const result=this.pendingCues;this.pendingCues=[];return result;}
  snapshot(){return {identity:this.identity,active:!!this.track?.active,code:this.code,index:this.index,shape:shapeNames[this.index],weight:this.weight,progress:this.progress,linear:this.linear,controllerTick:this.tick,controllerRate:this.rate,appliedCommands:this.appliedCommands,pendingCues:this.pendingCues.length,drift:this.drift};}
}
