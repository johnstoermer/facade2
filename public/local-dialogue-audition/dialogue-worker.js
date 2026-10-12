import {MLCEngine} from './vendor/web-llm-0.2.86.js';
import {parseReply,replyProblems,DialogueMemory,responseSchema} from './dialogue-protocol.js';
let engine=null,model=null,run=0,loading=null,generating=false,adapterInfo=null;
const memory=new DialogueMemory(),send=(type,data={})=>postMessage({type,...data});
const devices=[];
if(globalThis.GPUAdapter){const request=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(options){const device=await request.call(this,options),a=this.info;devices.push({vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description,requiredFeatures:options?.requiredFeatures??[]});device.lost.then(info=>send('device-lost',{reason:info.reason,message:info.message}));return device;};}
// Report buffers requested through this worker, not physical VRAM usage.
let allocated=0,peak=0,allocations=0;
if(globalThis.GPUDevice){const create=GPUDevice.prototype.createBuffer;GPUDevice.prototype.createBuffer=function(descriptor){const b=create.call(this,descriptor);allocated+=descriptor.size;allocations++;peak=Math.max(peak,allocated);const destroy=b.destroy.bind(b);let alive=true;b.destroy=()=>{if(alive){allocated-=descriptor.size;alive=false;}destroy();};return b;};}
const memoryStats=()=>({trackedLiveBufferBytes:allocated,trackedPeakBufferBytes:peak,bufferAllocations:allocations,scope:'WebGPU buffers requested by this dialogue worker; excludes driver, textures, browser, ASR and TTS'});
async function load(id){
 if(model?.id===id&&engine)return model;
 if(loading)return loading;
 loading=(async()=>{
  if(!navigator.gpu)throw Error('Local dialogue needs WebGPU. Original recorded dialogue is still available.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No WebGPU adapter is available.');
  const a=adapter.info;adapterInfo={vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description,isFallbackAdapter:adapter.isFallbackAdapter,features:[...adapter.features]};
  if(!adapter.features.has('shader-f16'))throw Error('These dialogue models require shader-f16. Original recordings remain available.');
  const lock=await(await fetch('./models.lock.json')).json(),candidate=lock.models.find(m=>m.id===id);if(!candidate)throw Error('Unknown pinned dialogue model.');
  if(engine)await engine.unload();model=null;memory.reset();
  const base=new URL('./models/'+id+'/resolve/'+candidate.revision+'/',import.meta.url).href;
  const sri=hex=>'sha256-'+btoa(String.fromCharCode(...hex.match(/../g).map(h=>parseInt(h,16))));
  let last=0;const start=performance.now();
  engine=new MLCEngine({logLevel:'WARN',appConfig:{useIndexedDBCache:false,model_list:[{model:base,model_id:id,model_lib:base+'model.wasm',overrides:candidate.overrides,required_features:['shader-f16'],integrity:{config:sri(candidate.files.find(f=>f.path==='mlc-chat-config.json').sha256),model_lib:sri(candidate.library.sha256),tokenizer:{'tokenizer.json':sri(candidate.files.find(f=>f.path==='tokenizer.json').sha256)},onFailure:'error'}}]},initProgressCallback:p=>{if(performance.now()-last>200||p.progress===1){last=performance.now();send('progress',{progress:p.progress,text:p.text});}}});
  await engine.reload(id,candidate.overrides);
  model={id,startupMs:performance.now()-start,adapter:adapterInfo,engineGPUVendor:await engine.getGPUVendor(),requestedDevices:devices.slice(),memory:memoryStats(),runtimeVersion:lock.runtime.version,revision:candidate.revision};send('ready',{model});return model;
 })().finally(()=>{loading=null;});return loading;
}
self.onmessage=async({data})=>{
 const {type,id}=data;
 if(type==='cancel'){run++;if(engine)engine.interruptGenerate();send('cancelled',{id,retainedModel:!!model});return;}
 if(type==='observe'){memory.observe(data.world);if(data.delivery)memory.delivery=data.delivery;return;}
 if(type==='reset'){memory.reset();if(engine&&!generating)await engine.resetChat(true);send('result',{id,result:true});return;}
 if(type==='unload'){run++;engine?.interruptGenerate();if(engine)await engine.unload();engine=null;model=null;memory.reset();send('result',{id,result:true});return;}
 try{
  if(type==='load'){send('result',{id,result:await load(data.model)});return;}
  if(type==='generate'){
   if(generating)throw Error('The previous local reply is still stopping. Try again in a moment.');
   generating=true;const token=++run,start=performance.now();let raw='',firstTokenMs=null,usage=null,finishReason=null;
   try{
    await load(data.model);if(token!==run)throw new DOMException('Cancelled','AbortError');
    const messages=data.messages??memory.messages(data.input),generationStart=performance.now(),attempts=[];let reply,metrics,repairMessages=messages;
    let schema={...responseSchema,properties:{...responseSchema.properties}};
    if(['Trip','Grace'].includes(data.input?.replyAs))schema.properties.speaker={const:data.input.replyAs};
    schema.properties.handoff={const:'none'};
    for(let attempt=0;attempt<2;attempt++){
    raw='';firstTokenMs=null;usage=null;finishReason=null;const attemptStarted=performance.now();
    const stream=await engine.chat.completions.create({messages:repairMessages,temperature:attempt ? .3 : data.temperature??.6,top_p:data.topP??.8,presence_penalty:data.presencePenalty??.25,frequency_penalty:0,max_tokens:data.maxTokens??280,stream:true,stream_options:{include_usage:true},response_format:data.grammar===false?undefined:{type:'json_object',schema:JSON.stringify(schema)},extra_body:{enable_thinking:data.thinking??false,enable_latency_breakdown:true}});
    for await(const chunk of stream){
     if(token!==run){engine.interruptGenerate();continue;}
     const part=chunk.choices?.[0]?.delta?.content??'';if(part){if(firstTokenMs===null)firstTokenMs=performance.now()-attemptStarted;raw+=part;send('token',{id,part});}
     if(chunk.usage)usage=chunk.usage;if(chunk.choices?.[0]?.finish_reason)finishReason=chunk.choices[0].finish_reason;
    }
    if(token!==run)throw new DOMException('Cancelled','AbortError');
    metrics={firstTokenMs,responseMs:performance.now()-generationStart,totalMs:performance.now()-start,usage,finishReason,memory:memoryStats(),promptCharacters:repairMessages.reduce((n,m)=>n+m.content.length,0),compactions:memory.compactions,...(!data.messages?{turn:memory.trace}:{})};
    let issues=[];try{if(finishReason==='length')throw Error('Local dialogue reached its token limit. Nothing was executed.');reply=parseReply(raw);if(!data.messages)issues=replyProblems(reply,data.input,memory.turns);}catch(e){issues=[e.message];}
    attempts.push({firstTokenMs,responseMs:performance.now()-attemptStarted,issues,raw});
    if(!issues.length)break;
    if(attempt===1){if(!data.messages)memory.failed(data.input);const e=Error('Local reply could not produce a fresh, valid plan. No commands were executed. Please rephrase.');e.raw=raw;e.metrics={...metrics,attempts};throw e;}
    repairMessages=[...messages,{role:'assistant',content:raw},{role:'user',content:'ENGINE CHECK: This draft was not spoken and no actions were executed. Fix these problems: '+issues.join(' ')+' Return a fresh complete compact JSON turn for the same latest input. WORLD is unchanged.'}];
    }
    metrics.attempts=attempts;metrics.firstTokenMs=attempts[0].firstTokenMs;
    if(!data.messages)memory.add(data.input,{...reply,raw});
    send('result',{id,result:{...reply,raw,metrics,model:model.id,completed:true}});
   }finally{generating=false;send('drained',{id,retainedModel:!!model});}
   return;
  }
  throw Error('Unknown worker request.');
 }catch(error){send('error',{id,error:error.message,name:error.name,raw:error.raw,metrics:error.metrics});}
};
