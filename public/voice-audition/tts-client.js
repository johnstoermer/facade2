export class LocalCharacterVoice {
 constructor({onEvent=()=>{},variant='standard',precision='decoder',graphOptimization='all',referenceMode='recordings'}={}){this.onEvent=onEvent;this.variant=variant;this.precision=precision;this.graphOptimization=graphOptimization;this.referenceMode=referenceMode;this.serial=0;this.epoch=0;this.pending=new Map();this.encoded=new Set();this.worker=null;this.model=null;this.draining=null;}
 async call(type,payload={},transfer=[]){
  const epoch=this.epoch;if(this.draining)await this.draining;
  if(epoch!==this.epoch)throw new DOMException('Canceled','AbortError');
  if(!this.worker){
   const url=new URL('./tts-worker.js',import.meta.url);if(this.variant==='turbo')url.searchParams.set('model','turbo');
   url.searchParams.set('precision',this.precision);
   url.searchParams.set('graph',this.graphOptimization);
   if(this.referenceMode==='precomputed')url.searchParams.set('references','precomputed');
   this.worker=new Worker(url,{type:'module'});
   const worker=this.worker;
   this.worker.onmessage=({data})=>{if(this.worker!==worker)return;
    if(data.event==='device-lost'||data.event==='worker-error'){this.onEvent(data);const error=Error(data.error||(data.event==='device-lost'?'WebGPU device lost':'Local voice worker failed'));for(const p of this.pending.values())p.reject(error);this.cancel();return;}
    const pending=this.pending.get(data.id);if(!pending)return;
    if(pending.abandoned){
     if(data.event==='complete'||data.event==='error'&&data.code==='voice_length_limit'){this.pending.delete(data.id);clearTimeout(pending.timer);this.draining=null;pending.release();this.onEvent({id:data.id,event:'cancelled',drainMs:data.drainMs,retainedModel:true,tokens:data.tokens});}
     else if(data.event==='error'){this.cancel();this.onEvent({id:data.id,event:'cancelled',retainedModel:false,error:data.error});}
     return;
    }
    this.onEvent(data);
    if(data.event==='complete'){this.pending.delete(data.id);pending.resolve(data);}else if(data.event==='error'){this.pending.delete(data.id);pending.reject(Object.assign(Error(data.error),{code:data.code}));}};
   this.worker.onerror=event=>{event.preventDefault();if(this.worker!==worker)return;const error=Error(event.message||'Local voice worker failed');for(const p of this.pending.values())p.reject(error);this.cancel();};
  }
  const id=++this.serial;return new Promise((resolve,reject)=>{this.pending.set(id,{type,resolve,reject});this.worker.postMessage({id,type,...payload},transfer);});
 }
 async prepare(){if(this.model)return this.model;if(this.preparing)return this.preparing;const operation=this.call('prepare').then(result=>{this.model=result;return result;}).finally(()=>{if(this.preparing===operation)this.preparing=null;});this.preparing=operation;return operation;}
 async encode(speaker,pcm){if(this.encoded.has(speaker))return{encodeMs:0,cached:true};const copy=pcm.slice();const result=await this.call('encode',{speaker,pcm:copy.buffer},[copy.buffer]);this.encoded.add(speaker);return result;}
 async generate(speaker,text,exaggeration=.5){return this.call('generate',{speaker,text,exaggeration});}
 interrupt(){
  this.epoch++;if(this.draining)return this.draining;
  const entry=[...this.pending].find(([,p])=>p.type==='generate');
  if(!entry){if(this.pending.size)this.cancel();return Promise.resolve();}
  const [id,pending]=entry;pending.abandoned=true;pending.reject(new DOMException('Canceled','AbortError'));
  this.draining=new Promise(resolve=>{pending.release=resolve;});
  pending.timer=setTimeout(()=>{if(this.pending.get(id)===pending){this.cancel();this.onEvent({id,event:'cancelled',retainedModel:false,error:'Interrupted GPU work did not finish within15s'});}},15000);
  this.worker.postMessage({type:'cancel-generation',target:id});return this.draining;
 }
 cancel(){this.epoch++;for(const p of this.pending.values()){p.reject(new DOMException('Canceled','AbortError'));clearTimeout(p.timer);p.release?.();}this.pending.clear();this.draining=null;this.worker?.terminate();this.worker=null;this.model=null;this.preparing=null;this.encoded.clear();}
}

export function wavBlob(pcm,sampleRate=24000){
 const bytes=new ArrayBuffer(44+pcm.length*2),view=new DataView(bytes);const text=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++){const v=Math.max(-1,Math.min(1,pcm[i]));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}return new Blob([bytes],{type:'audio/wav'});
}

export function decodeReference(buffer){
 const view=new DataView(buffer);const tag=at=>String.fromCharCode(...new Uint8Array(buffer,at,4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('Invalid reference WAV');let format,offset,length;
 for(let at=12;at+8<=buffer.byteLength;){const size=view.getUint32(at+4,true);if(at+8+size>buffer.byteLength)throw Error('Truncated reference');
  if(tag(at)==='fmt ')format={code:view.getUint16(at+8,true),channels:view.getUint16(at+10,true),rate:view.getUint32(at+12,true),bits:view.getUint16(at+22,true)};
  if(tag(at)==='data'){offset=at+8;length=size;}at+=8+size+(size%2);}
 if(format?.code!==1||format.channels!==1||format.rate!==24000||format.bits!==16||!offset)throw Error('Reference must be 24kHz mono PCM16');
 const pcm=new Float32Array(length/2);for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(offset+i*2,true)/32768;return pcm;
}
