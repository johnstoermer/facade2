export class LocalDialogue {
 constructor({onchange=()=>{},onToken=()=>{}}={}){this.onchange=onchange;this.onToken=onToken;this.pending=new Map();this.counter=0;this.model=null;this.state='idle';this.text='Loads with the first reply.';}
 ensureWorker(){
  if(this.worker)return;
  if(!navigator.gpu)throw Error('Local dialogue is unavailable without WebGPU. Original recordings still play.');
  const worker=this.worker=new Worker(new URL('./dialogue-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data.type==='progress'){this.state='loading';this.text=data.text;this.onchange(data);}
   if(data.type==='ready'){this.model=data.model;this.state='ready';this.text='Local dialogue ready.';this.onchange(data);}
   if(data.type==='device-lost'&&data.reason!=='destroyed'){this.fail(new Error('The local dialogue GPU disconnected. Original recordings still play. Select Talk to retry.'));return;}
   if(data.type==='token')this.onToken(data);
   if(data.type==='drained'){this.draining=false;this.onchange(data);}
   if(data.type==='result'||data.type==='error'){const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);if(data.type==='result')p.resolve(data.result);else p.reject(Object.assign(new Error(data.error),{name:data.name??'Error',raw:data.raw,metrics:data.metrics}));}
  };
  worker.onerror=()=>{this.fail(new Error('The local dialogue worker failed. Original recordings still play.'));};
 }
 fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.worker?.terminate();this.worker=null;this.model=null;this.draining=false;this.state='error';this.text=error.message;this.onchange({type:'error',text:this.text});}
 request(type,data={},timeout=180000){this.ensureWorker();const id=++this.counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(new Error('Local dialogue timed out. Select Talk to retry.')),timeout);this.pending.set(id,{resolve,reject,timer,type});this.worker.postMessage({type,id,...data});});}
 async load(model){const result=await this.request('load',{model},600000);this.model=result;return result;}
 async generate(model,input,options={}){if(this.draining)throw Error('The previous reply is still stopping. Try again shortly.');this.state='generating';this.text='Thinking locally…';this.onchange({type:'generating'});try{const result=await this.request('generate',{model,input,...options},this.model?90000:600000);this.state='ready';return result;}catch(e){if(e.name!=='AbortError'){this.state='error';this.text=e.message;this.onchange({type:'error',text:this.text});}throw e;}}
 cancel(){
  if(!this.worker)return;
  if(!this.model&&this.pending.size){this.fail(new DOMException('Cancelled','AbortError'));this.state='idle';this.text='Download stopped. Cached files will be reused.';return;}
  this.draining=[...this.pending.values()].some(p=>p.type==='generate');this.worker.postMessage({type:'cancel'});
  for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(new DOMException('Cancelled','AbortError'));this.pending.delete(id);}
 }
 reset(){this.cancel();if(this.worker)this.worker.postMessage({type:'reset'});}
 observe(world,delivery){this.worker?.postMessage({type:'observe',world,delivery});}
 async unload(){this.cancel();this.worker?.terminate();this.worker=null;this.model=null;this.state='idle';this.draining=false;}
}
