// Retain the small input buffer until a result arrives, so a failed GPU worker
// can be terminated and the same utterance retried once on the CPU.
export class RecognitionWorkerClient {
 constructor({onreset=()=>{},WorkerClass,url=new URL('./speech-worker.js',import.meta.url)}={}){
  Object.assign(this,{onreset,WorkerClass,url});this.serial=0;this.pending=new Map();this.worker=null;this.cpuOnly=false;this.info=null;this.fallbackReason=null;
 }
 drop(error){
  const worker=this.worker;this.worker=null;worker?.terminate();
  for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();this.info=null;this.onreset();
 }
 useCpu(error){
  if(this.cpuOnly)return;
  this.cpuOnly=true;this.fallbackReason=error.message;
  this.drop(Object.assign(error,{retryCpu:true}));
 }
 engine(){
  if(this.worker)return this.worker;
  const url=new URL(this.url);if(this.cpuOnly)url.searchParams.set('backend','wasm');
  const worker=this.worker=new (this.WorkerClass??globalThis.Worker)(url,{type:'module'});
  worker.onmessage=({data})=>{
   if(this.worker!==worker||data.type==='progress')return;
   if(data.type==='device-lost'){this.useCpu(new Error(data.error||'Recognition GPU was lost'));return;}
   const request=this.pending.get(data.id);if(!request)return;
   this.pending.delete(data.id);clearTimeout(request.timer);
   if(data.error)request.reject(Object.assign(new Error(data.error),{retryCpu:data.retryCpu===true}));
   else{this.info={backend:data.backend,gpu:data.gpu,startupMs:data.startupMs,runtime:data.runtime};this.fallbackReason??=data.fallbackReason??null;request.resolve(data);}
  };
  worker.onerror=event=>{
   if(this.worker!==worker)return;
   const error=new Error(event.message||'Speech worker unavailable');
   if(!this.cpuOnly&&this.info?.backend!=='wasm')this.useCpu(error);else this.drop(error);
  };
  return worker;
 }
 request(type,extra){
  return new Promise((resolve,reject)=>{
   const worker=this.engine(),id=++this.serial,transfer=[];let payload=extra;
   if(extra.audio instanceof Float32Array){const audio=extra.audio.slice();payload={...extra,audio};transfer.push(audio.buffer);}
   const timer=setTimeout(()=>{
    if(!this.pending.has(id))return;
    const error=new Error('Speech recognition timed out');
    if(!this.cpuOnly&&this.info?.backend!=='wasm')this.useCpu(error);else this.drop(error);
   },type==='prepare'?60000:30000);
   this.pending.set(id,{resolve,reject,timer});
   try{worker.postMessage({id,type,...payload},transfer);}catch(error){this.pending.delete(id);clearTimeout(timer);reject(error);}
  });
 }
 async call(type,extra={}){
  try{return await this.request(type,extra);}
  catch(error){
   if(!error.retryCpu)throw error;
   this.useCpu(error);
   // Deliberately no recursive retry: CPU failures reach the existing UI.
   return this.request(type,extra);
  }
 }
}
