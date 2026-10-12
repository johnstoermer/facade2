// Browser controller for original authored frame sequences and pose layers.
// This replaces scheduling code, while preserving the shipped pose operands.
// The original engine consumes one pose per update and has variable sleep;
// 30Hz is this controller's nominal clock, independent of browser rendering.
export async function loadMotionScripts(){
  const response=await fetch('./assets/motion-scripts.json');if(!response.ok)throw Error('Original motion data unavailable');
  const data=await response.json();if(data.schema!=='facade-authored-motion-v1')throw Error('Unsupported motion data');
  return data.actors;
}

export function compileMotion(script,frameCount){
  const frames=[],bases=[],cues=[];let base=null,started=false,ended=false;
  function add(frame){
    if(!Number.isInteger(frame)||frame<0||frame>=frameCount)throw Error('Motion frame outside original poses');
    if(base===null)base=frame;frames.push(frame);bases.push(base);
  }
  for(const op of script.ops){
    if(ended)throw Error('Multiple segments need the original script controller');
    switch(op[0]){
      case 200000:if(started)throw Error('Repeated motion start');started=true;break;
      case 'f':add(op[1]);break;
      case 200001:{
        let end=op[2];if(Math.abs(end-op[1])>200)end=op[1];
        const direction=end<op[1]?-1:1;
        for(let frame=op[1];;frame+=direction){add(frame);if(frame===end)break;}
        break;
      }
      case 200004:
        if(!Number.isInteger(op[1])||op[1]<0||op[1]>=frameCount)throw Error('Invalid layer base');
        base=op[1];break;
      case 200006:cues.push({frameOffset:frames.length,code:op[1]});break;
      case 200007:ended=true;break;
      default:throw Error('Motion requires the dialogue/nested script controller');
    }
  }
  if(!started||!ended||frames.length===0)throw Error('Incomplete authored motion');
  return {id:script.id,names:script.names,frames,bases,cues};
}

export function attachMotion(actor,bundle){
  actor.motion={scripts:bundle.scripts,compiled:new Map(),base:null,layers:new Map()};
}

export function playMotion(actor,name,{layer=0,loop=false,rate=30,now=performance.now()}={}){
  if(!Number.isInteger(layer)||layer<0||layer>7||!Number.isFinite(rate)||rate<=0||rate>120)throw Error('Invalid motion channel/rate');
  const m=actor.motion,script=m.scripts.find(s=>s.id===name||s.names.includes(name));
  if(!script)throw Error('Unknown original motion: '+name);
  let compiled=m.compiled.get(script.id);if(!compiled){compiled=compileMotion(script,actor.meta.frameCount);m.compiled.set(script.id,compiled);}
  const playback={compiled,started:now,rate,loop};actor.playback=null;
  if(layer===0)m.base=playback;else m.layers.set(layer,playback);
  return {id:script.id,frames:compiled.frames.length,seconds:compiled.frames.length/rate,layer};
}

export function stopMotion(actor,layer){
  if(layer===undefined){actor.motion.base=null;actor.motion.layers.clear();}
  else if(layer===0)actor.motion.base=null;else actor.motion.layers.delete(layer);
}

function current(playback,time){
  const frame=Math.max(0,Math.floor((time-playback.started)*playback.rate/1000)),n=playback.compiled.frames.length;
  return {index:playback.loop?frame%n:Math.min(frame,n-1),ended:!playback.loop&&frame>=n};
}

export function readPose(actor,frame){
  const layout=actor.meta.layout,count=layout.frameStrideBytes/4,offset=frame*layout.frameStrideBytes;
  if(!Number.isInteger(frame)||frame<0||frame>=actor.meta.frameCount)throw Error('Invalid source pose');
  return Float32Array.from({length:count},(_,i)=>actor.view.getFloat32(offset+i*4,true));
}

export function composePose(actor,time){
  const motion=actor.motion;
  if(motion?.base){
    const sample=current(motion.base,time);actor.frame=motion.base.compiled.frames[sample.index];
    if(sample.ended)motion.base=null;
  }
  const pose=readPose(actor,actor.frame);actor.activeMotionLayers=[];
  if(!motion)return pose;
  for(let layer=1;layer<=7;layer++){
    const playback=motion.layers.get(layer);if(!playback)continue;
    const sample=current(playback,time);if(sample.ended){motion.layers.delete(layer);continue;}
    const frame=playback.compiled.frames[sample.index],base=playback.compiled.bases[sample.index];
    const active=readPose(actor,frame),reference=readPose(actor,base);
    for(let i=0;i<pose.length;i++)pose[i]=active[i]-reference[i]+pose[i];
    actor.activeMotionLayers.push({layer,script:playback.compiled.id,frame,base});
  }
  return pose;
}
