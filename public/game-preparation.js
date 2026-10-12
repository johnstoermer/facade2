import {DialogueMemory} from './local-dialogue-audition/dialogue-protocol.js';
import {LocalSpeechRecognition} from './local-recognition.js';
const $=id=>document.getElementById(id);
const aborted=()=>new DOMException('Preparation cancelled','AbortError');

// Preparation never executes a model command, plays generated audio, records
// microphone input, or adds its test sentence to the actual conversation.
export class GamePreparation {
 constructor(conversation){
  this.conversation=conversation;this.serial=0;this.active=false;this.ready=null;this.lastRun=null;
  $('prepare-cancel').onclick=()=>this.cancel();
  $('prepare-recordings').onclick=()=>this.cancel({recordings:true});
  $('prepare-retry').onclick=()=>this.run(this.serial);
  $('prepare-dialog').addEventListener('cancel',event=>{event.preventDefault();this.cancel();});
 }
 isReady(){
  const c=this.conversation,r=this.ready;
  return r&&r.model===c.model&&r.dialogueWorker===c.dialogue.worker&&!!c.dialogue.model&&
   r.voiceMode===c.speech.voice.mode&&(r.voiceMode==='captions'||r.voiceWorker===c.speech.voice.client?.worker&&!!c.speech.voice.client?.model);
 }
 async prepare(player){
  if(this.active)return this.promise;
  await this.conversation.selectionReady;
  if(this.conversation.model==='recordings'||this.isReady())return true;
  this.player=player;this.active=true;const serial=++this.serial;
  this.promise=new Promise(resolve=>{this.resolve=resolve;});
  this.conversation.scene.keys.clear();this.conversation.scene.ui.keys.clear();
  $('prepare-dialog').showModal();this.conversation.holdMic();
  this.run(serial);return this.promise;
 }
 stage(index,label){
  this.phase=index;this.label=label;$('prepare-stage').textContent=label;
  $('prepare-progress').value=index;$('prepare-progress').setAttribute('aria-valuetext',label);
  this.lastRun.stages.push({index,label,startedMs:performance.now()-this.started});this.updateDetail();
 }
 updateDetail(){
  if(!this.active)return;
  $('prepare-detail').textContent=`${Math.min(6,this.phase+1)} / 6 · ${Math.floor((performance.now()-this.started)/1000)} s · files are cached`;
 }
 dialogueProgress(event){
  if(!this.active||this.phase!==0||event.type!=='progress')return;
  const p=Math.max(0,Math.min(1,event.progress??0));
  $('prepare-progress').value=p;$('prepare-stage').textContent=this.label+' · '+Math.round(p*100)+'%';
 }
 async run(serial){
  const c=this.conversation,voice=c.speech.voice;
  this.started=performance.now();this.lastRun={model:c.model,voiceMode:voice.mode,stages:[],completed:false};
  $('prepare-retry').hidden=true;clearInterval(this.clock);this.clock=setInterval(()=>this.updateDetail(),1000);
  const active=()=>{if(!this.active||serial!==this.serial)throw aborted();};
  try{
   this.stage(0,'Loading dialogue');await c.dialogue.load(c.model);active();
   this.stage(1,'Warming dialogue');
   const input={text:'Trip, greet me briefly without taking any action.',player:this.player?.name??'Adam',world:c.scene.behavior.snapshot()};
   const reply=await c.dialogue.generate(c.model,input,{messages:new DialogueMemory().messages(input),temperature:0,presencePenalty:0});active();
   this.lastRun.dialogue=reply.metrics;
   // A stateless test prompt bypasses memory.add; reset recurrent/KV state,
   // keeping weights and compiled kernels in the same worker.
   await c.dialogue.request('reset');active();
   this.stage(2,voice.mode==='captions'?'Keeping captions':'Loading character voices');
   if(voice.mode!=='captions')await voice.prepare();active();
   this.lastRun.voices=[];
   for(const [index,speaker] of ['trip','grace'].entries()){
    this.stage(index+3,voice.mode==='captions'?'Keeping captions':'Warming '+(index?'Grace':'Trip'));
    if(voice.mode!=='captions')this.lastRun.voices.push(await voice.warmCharacter(speaker));active();
   }
   this.stage(5,'Warming speech recognition');
   this.lastRun.recognition=await LocalSpeechRecognition.warmup();active();
   this.ready={model:c.model,dialogueWorker:c.dialogue.worker,voiceMode:voice.mode,voiceWorker:voice.client?.worker};
   this.lastRun.completed=true;this.lastRun.totalMs=performance.now()-this.started;
   $('prepare-progress').value=6;$('prepare-stage').textContent='Ready';this.finish(true);
  }catch(error){
   if(!this.active||serial!==this.serial)return;
   clearInterval(this.clock);this.lastRun.error=error.message;this.lastRun.totalMs=performance.now()-this.started;
   c.dialogue.cancel();voice.cancel();LocalSpeechRecognition.cancelWarmup();
   $('prepare-stage').textContent='Local preparation failed';
   $('prepare-detail').textContent=/WebGPU|shader-f16|GPU adapter/.test(error.message)?'This browser cannot run these models. Original recordings still work.':'Retry, or play with original recordings.';
   $('prepare-retry').hidden=false;
  }
 }
 cancel({recordings=false}={}){
  if(!this.active)return;
  this.serial++;const c=this.conversation;c.dialogue.cancel();c.speech.voice.cancel();LocalSpeechRecognition.cancelWarmup();
  if(this.lastRun){this.lastRun.cancelled=true;this.lastRun.totalMs=performance.now()-this.started;}
  if(recordings){c.model='recordings';localStorage.setItem('facade-local-dialogue','recordings');c.dialogue.unload();}
  this.finish(recordings);
 }
 finish(proceed){
  clearInterval(this.clock);this.active=false;if($('prepare-dialog').open)$('prepare-dialog').close();
  this.conversation.holdMic();this.conversation.controls();const resolve=this.resolve;this.resolve=null;resolve?.(proceed);
 }
}
