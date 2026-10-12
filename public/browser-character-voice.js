// Character speech stays on this device. The heavy runtime is imported only
// during Start preparation, Mic input or a reply; both characters share one model.
const base=new URL('./voice-audition/',import.meta.url);
const referenceHash='60476870e885749c155cffb270409aad57e42d3334e408815fa8179b1dc5efeb';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const aborted=()=>new DOMException('Reply stopped','AbortError');
export const defaultVoiceMode='turbo';
export const voiceModes={turbo:'Turbo · ~0.8 GB',standard:'Standard · 0.94 GB',captions:'Captions only'};
export const synthesisText=text=>text.replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]\s*$/g,'.').replace(/[\u2013\u2014]/g,', ').replace(/\u2026/g,'...').replace(/\s+/g,' ').trim();

export function speechChunks(text){
 const chunks=[];let start=0;
 while(start<text.length){
  while(/\s/.test(text[start]??'')&&start<text.length)start++;
  if(start>=text.length)break;
  const words=[...text.slice(start).matchAll(/[^\s\u2013\u2014]+[\u2013\u2014]?|[\u2013\u2014]/g)];let end=start;
  for(let i=0;i<words.length;i++){
   const next=start+words[i].index+words[i][0].length;
   if(next-start>160||i>=28)break;
   // Even a short greeting or exclamation must stay separate. Combining it
   // with the next sentence can yield long audio with only the first word.
   // A substantial comma-delimited phrase can play while the next one
   // generates. Leave short interjections, names and numbers together.
   end=next;if((end-start>=32&&i>=4&&/,["'\u201d\u2019]?$/.test(words[i][0]))||/[.!?]["'\u201d\u2019]?$/.test(words[i][0])||(/[\u2013\u2014]$/.test(words[i][0])&&/\w/.test(text.slice(start,end))))break;
  }
  if(end===start)end=Math.min(text.length,start+160);
  chunks.push({text:text.slice(start,end),start,end});start=end;
 }
 return chunks;
}

export class BrowserCharacterVoice {
 constructor({onchange=()=>{}}={}){
  this.onchange=onchange;this.serial=0;this.state='idle';this.text='Loads when needed.';
  try{this.mode=localStorage.getItem('facade-character-voice')??defaultVoiceMode;}catch{this.mode=defaultVoiceMode;}
  if(!voiceModes[this.mode])this.mode=defaultVoiceMode;
  this.references=new Map();this.client=null;this.playback=null;this.lastRun=null;this.prepareEpoch=0;
 }
 status(state,text){this.state=state;this.text=text;this.onchange({state,text,mode:this.mode});}
 setMode(mode){
  if(!voiceModes[mode]||mode===this.mode)return;
  this.cancel();this.client?.cancel();this.client=null;this.mode=mode;
  try{localStorage.setItem('facade-character-voice',mode);}catch{}
  this.status('idle',mode==='captions'?'New replies use captions.':'Loads when needed.');
 }
 unlock(){
  if(this.mode==='captions')return Promise.resolve();
  try{this.context??=new AudioContext({sampleRate:24000});return this.context.resume();}catch(error){return Promise.reject(error);}
 }
 stopPlayback(){
  const playback=this.playback;this.playback=null;
  if(playback){playback.source.onended=null;try{playback.source.stop();}catch{}playback.source.disconnect();playback.analyser.disconnect();playback.resolve(false);}
 }
 cancel({keepPreparation=false}={}){
  this.serial++;this.abort?.abort();this.abort=null;this.stopPlayback();
  if(!keepPreparation){this.prepareEpoch++;this.preparing=null;this.warmup=null;clearInterval(this.loadingClock);}
  // Stop audible output immediately; let interrupted generation release its
  // request cache while keeping the expensive shared model initialized.
  if(this.client?.pending.size&&!(keepPreparation&&this.preparing&&[...this.client.pending.values()].every(p=>p.type==='prepare')))this.client.interrupt();
  if(!keepPreparation||!this.preparing)this.status('idle','Reply stopped.');
 }
 async limited(promise,ms,message){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{this.client?.cancel();reject(Error(message));},ms);})]);}finally{clearTimeout(timer);}
 }
 prepare(){
  if(this.mode==='captions')return Promise.resolve(null);
  if(this.client?.model)return Promise.resolve(this.client.model);
  if(this.preparing)return this.preparing;
  const epoch=this.prepareEpoch,mode=this.mode,active=()=>{if(epoch!==this.prepareEpoch||mode!==this.mode)throw aborted();};
  const operation=(async()=>{
   let loadingClock;
   try{
    if(!navigator.gpu||!window.Worker)throw Error('WebGPU is unavailable');
    const {LocalCharacterVoice}=await import('./voice-audition/tts-client.js');active();
    this.client??=new LocalCharacterVoice({variant:mode,referenceMode:'precomputed',onEvent:event=>this.workerEvent(event)});
    this.status('loading','Loading local voice…');const started=performance.now();
    loadingClock=this.loadingClock=setInterval(()=>{if(epoch===this.prepareEpoch&&this.state==='loading')this.status('loading',`Preparing local voice · ${Math.floor((performance.now()-started)/1000)} s`);},1000);
    const prepared=await this.limited(this.client.prepare(),600000,'Voice loading timed out');active();this.model=prepared;return prepared;
   }catch(error){if(epoch===this.prepareEpoch)this.client?.cancel();throw error;}
   finally{clearInterval(loadingClock);}
  })();
  this.preparing=operation;
  // Attach cleanup without creating a second unhandled rejected promise.
  operation.then(()=>{if(this.preparing===operation)this.preparing=null;},()=>{if(this.preparing===operation)this.preparing=null;});
  return operation;
 }
 prepareForInput(){
  if(this.abort||this.playback||this.client?.model)return;
  return this.prepareAhead('input');
 }
 cancelInputPreparation(){
  if(this.warmup?.owner!=='input')return;
  this.cancel();this.status('idle',this.client?.model?'Voice ready.':'Loads when needed.');
 }
 prepareForReply(){return this.prepareAhead('reply');}
 prepareAhead(owner){
  if(this.mode==='captions')return;
  if(this.warmup){if(owner==='reply')this.warmup.owner='reply';return this.warmup.promise;}
  const warmup=this.warmup={owner,started:performance.now(),promise:this.prepare()};
  // A text/API failure or Stop may arrive before any spoken reply consumes it.
  warmup.promise.then(()=>{warmup.finished=performance.now();},()=>{});
  return warmup.promise;
 }
 async reference(speaker,signal,decodeReference){
  if(this.references.has(speaker))return this.references.get(speaker);
  const response=await fetch(new URL('references/references.json',base),{signal});
  if(!response.ok)throw Error('Character references unavailable');
  const bytes=await response.arrayBuffer();if(await digest(bytes)!==referenceHash)throw Error('Character reference index changed');
  const ref=JSON.parse(new TextDecoder().decode(bytes)).references.find(r=>r.id===speaker);
  if(!ref)throw Error('Unknown character voice');
  const wav=await fetch(new URL(ref.uri,base),{signal});if(!wav.ok)throw Error('Character recording unavailable');
  const buffer=await wav.arrayBuffer();if(await digest(buffer)!==ref.sha256)throw Error('Character recording integrity mismatch');
  const pcm=decodeReference(buffer);this.references.set(speaker,pcm);return pcm;
 }
 async warmCharacter(speaker){
  const epoch=this.prepareEpoch;await this.prepare();
  const active=()=>{if(epoch!==this.prepareEpoch)throw aborted();};active();
  const {decodeReference}=await import('./voice-audition/tts-client.js');active();
  this.abort=new AbortController();
  try{
   const pcm=await this.reference(speaker,this.abort.signal,decodeReference);active();
   await this.limited(this.client.encode(speaker,pcm),60000,'Character preparation timed out');active();
   const audio=await this.limited(this.client.generate(speaker,speaker==='trip'?'It is good to see you again.':'I am glad you could come over.'),60000,'Voice warmup timed out');active();
   this.status('idle','Voice ready.');return{speaker,metrics:audio.metrics};
  }finally{if(epoch===this.prepareEpoch)this.abort=null;}
 }
 workerEvent(event){
  // Preparing the next sentence must not replace the current speaker status.
  if(this.playback&&['stage','progress'].includes(event.event))return;
  if(event.event==='progress'&&event.progress?.total){
   if(performance.now()-(this.lastProgress??0)<150)return;this.lastProgress=performance.now();
   const percent=Math.min(100,Math.round(event.progress.loaded/event.progress.total*100));
   if(Number.isFinite(percent))this.status('loading',`Loading voice files · ${percent}%`);
  }else if(event.event==='stage'){
   const labels={loading:'Loading local voice…',ready:'Voice ready.',encoding:'Preparing character voice…',generating:'Generating speech…',decoding:'Finishing speech…'};
   if(labels[event.stage])this.status(event.stage,labels[event.stage]);
  }else if(event.event==='device-lost')this.status('error','Voice GPU disconnected. Captions are on.');
 }
 async speak(reply){
  const warmup=this.warmup;this.warmup=null;this.cancel({keepPreparation:!!warmup});const serial=this.serial,started=performance.now();
  const active=()=>{if(serial!==this.serial)throw aborted();};
  if(this.mode==='captions')return{spoken:false,error:'Captions only. Select Voice for spoken replies.'};
  const speaker=String(reply.speaker).toLowerCase(),text=String(reply.text);
  const run=this.lastRun={mode:this.mode,speaker,text,started,chunks:[]};
  this.abort=new AbortController();const signal=this.abort.signal;
  try{
   if(!navigator.gpu||!window.Worker)throw Error('WebGPU is unavailable');
   await this.unlock();active();
   if(this.context.state!=='running')throw Error('Browser audio is paused');
   const {decodeReference}=await import('./voice-audition/tts-client.js');active();
   const prepared=await(warmup?.promise??this.prepare());active();
   run.preparationOverlapMs=warmup?Math.max(0,Math.min(started,warmup.finished??started)-warmup.started):0;
   run.modelReadyBeforeReply=!!warmup&&warmup.finished<=started;
   this.model=prepared;run.gpu=prepared.gpu;run.modelStartupMs=prepared.startupMs;
   const pcm=await this.reference(speaker,signal,decodeReference);active();
   run.reference=await this.limited(this.client.encode(speaker,pcm),60000,'Character preparation timed out');active();
   const chunks=speechChunks(text);
   const queue=chunk=>{
    const queued={ready:false};
    // Always attach both handlers: Stop can reject this promise while the
    // previous sentence is still playing. Keep at most one sentence ahead.
    const spokenText=synthesisText(chunk.text);
    queued.promise=this.limited(this.client.generate(speaker,spokenText),60000,'Speech generation timed out').then(audio=>{
     active();queued.ready=true;const entry={...chunk,synthesisText:spokenText,...audio.metrics,audioReadyMs:performance.now()-started};run.chunks.push(entry);return{audio,entry};
    }).catch(error=>({error}));return queued;
   };
   let next=chunks.length?queue(chunks[0]):null,previousEnd=null;
   for(let index=0;index<chunks.length;index++){
    const chunk=chunks[index];this.currentChunk=chunk;
    if(!next.ready)this.status('generating','Generating speech…');
    const {audio,entry,error}=await next.promise;active();if(error)throw error;
    const samples=new Float32Array(audio.pcm);run.firstAudioMs??=entry.audioReadyMs;
    next=index+1<chunks.length?queue(chunks[index+1]):null;
    entry.playbackStartedMs=performance.now()-started;entry.gapBeforeMs=previousEnd===null?null:entry.playbackStartedMs-previousEnd;
    const played=await this.play(samples,audio.sampleRate,chunk,reply.speaker);active();
    entry.playbackEndedMs=performance.now()-started;previousEnd=entry.playbackEndedMs;
    if(!played)throw aborted();
   }
   run.finishedMs=performance.now()-started;this.status('idle','Voice ready.');return{spoken:true,metrics:run};
  }catch(error){
   if(error.name==='AbortError'||serial!==this.serial){run.cancelled=true;return{spoken:false,cancelled:true};}
   this.stopPlayback();const lengthLimit=error.code==='voice_length_limit';if(!lengthLimit){this.cancel();this.client?.cancel();}run.error=error.message;
   const reason=lengthLimit?'Voice could not finish this reply.':/WebGPU|shader-f16|GPU adapter/.test(error.message)?'This browser cannot run local voices.':/audio is paused/.test(error.message)?'Browser audio is paused.':'Local voice failed.';
   const message=reason+' Captions are on.'+(lengthLimit?'':' Select Voice to retry.');this.status('error',message);return{spoken:false,error:message,detail:error.message};
  }finally{if(serial===this.serial){this.abort=null;this.currentChunk=null;}}
 }
 play(pcm,sampleRate,chunk,speaker){
  return new Promise((resolve,reject)=>{
   try{
    const buffer=this.context.createBuffer(1,pcm.length,sampleRate);buffer.copyToChannel(pcm,0);
    const source=this.context.createBufferSource(),analyser=this.context.createAnalyser();analyser.fftSize=1024;
    source.buffer=buffer;source.connect(analyser);analyser.connect(this.context.destination);
    let timer;const finish=value=>{clearTimeout(timer);resolve(value);};
    const playback=this.playback={source,analyser,resolve:finish,chunk,duration:buffer.duration,started:this.context.currentTime,startedMs:performance.now(),wave:new Float32Array(1024)};
    source.onended=()=>{if(this.playback!==playback)return;this.playback=null;source.disconnect();analyser.disconnect();finish(true);};
    timer=setTimeout(()=>{if(this.playback!==playback)return;this.playback=null;source.onended=null;try{source.stop();}catch{}source.disconnect();analyser.disconnect();reject(Error('Voice playback timed out'));},Math.max(15000,buffer.duration*1000+5000));
    source.start();this.status('playing',speaker);
   }catch(error){this.stopPlayback();reject(error);}
  });
 }
 sample(){
  const p=this.playback;if(!p)return{speaking:false,wordIndex:this.currentChunk?.start??0,voiceLevel:0};
  p.analyser.getFloatTimeDomainData(p.wave);let sum=0;for(const v of p.wave)sum+=v*v;
  const progress=Math.max(0,Math.min(1,(this.context.currentTime-p.started)/p.duration));
  const at=Math.min(p.chunk.text.length-1,Math.floor(progress*p.chunk.text.length));
  const wordStart=p.chunk.text.lastIndexOf(' ',at)+1;
  return{speaking:true,wordIndex:p.chunk.start+wordStart,voiceLevel:Math.min(1,Math.sqrt(sum/p.wave.length)*8),speechStarted:p.startedMs};
 }
}
