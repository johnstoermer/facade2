import {loadVoiceRuntime} from './voice-runtime.js';
// Messages can arrive while dynamic imports are pending. Register first.
const earlyMessages=[];self.onmessage=event=>earlyMessages.push(event);
const parameters=new URL(self.location.href).searchParams;
const runtime=await loadVoiceRuntime({preferJspi:parameters.get('model')==='turbo'&&parameters.get('references')==='precomputed'&&parameters.get('runtime')!=='asyncify'});
const {ChatterboxModel,AutoProcessor,Tensor,env,InterruptableStoppingCriteria,StoppingCriteriaList}=runtime.library;

env.allowRemoteModels=false;env.allowLocalModels=true;
// Registry metadata probes in4.3.1 require a local path, not an absolute URL.
env.localModelPath=new URL('./models/',import.meta.url).pathname;
const turbo=new URL(self.location.href).searchParams.get('model')==='turbo',modelId=turbo?'chatterbox-turbo':'chatterbox';
const precision=new URL(self.location.href).searchParams.get('precision')??'decoder';
const graphOptimization=new URL(self.location.href).searchParams.get('graph')??'all';
const fixedReferences=new URL(self.location.href).searchParams.get('references')==='precomputed';
if(fixedReferences&&turbo&&precision!=='decoder')throw Error('Fixed Turbo references require the approved decoder configuration');
if(!['disabled','basic','extended','all'].includes(graphOptimization))throw Error('Invalid graph optimization level');
env.useBrowserCache=true;env.cacheKey=turbo?'facade-chatterbox-turbo-4.3.1-d21799bd-'+precision:'facade-chatterbox-4.3.1-3cab09af';
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
const mixed={embed_tokens:'fp32',speech_encoder:'fp32',language_model:'q4f16',conditional_decoder:'fp32'};
const dtype=turbo?(precision==='mixed'?mixed:precision==='decoder'?{embed_tokens:'q4f16',speech_encoder:'q4f16',language_model:'q4f16',conditional_decoder:'fp32'}:'q4f16'):mixed;
let model,processor,prepared,gpu,active=false,activeJob=null;const speakers=new Map();
const message=(id,event,data={})=>postMessage({id,event,...data});
const gpuInfo=info=>({vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description,isFallbackAdapter:info?.isFallbackAdapter});
// A dependency may reject a sibling graph/data promise before awaiting it.
// Fail the whole worker explicitly so the caller can discard partial sessions.
self.addEventListener('unhandledrejection',event=>{
 event.preventDefault();
 message(activeJob?.id??0,'worker-error',{error:String(event.reason?.message??event.reason??'Local voice worker failed').slice(0,500)});
});

async function prepare(id){
 if(prepared)return prepared;
 prepared=(async()=>{
  const started=performance.now();
  if(!navigator.gpu)throw Error('WebGPU is unavailable. Original recordings remain playable.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter||adapter.info?.isFallbackAdapter)throw Error('No hardware WebGPU adapter is available.');
  if(!adapter.features.has('shader-f16'))throw Error('This model needs WebGPU shader-f16 support.');
  env.backends.onnx.webgpu.adapter=adapter;env.backends.onnx.webgpu.powerPreference='high-performance';
  gpu=gpuInfo(adapter.info);message(id,'stage',{stage:'loading',gpu});
  // Cached reads also emit thousands of byte-progress callbacks. Throttle
  // before crossing the worker boundary; terminal and stage events stay immediate.
  const progressTimes=new Map();
  const progress_callback=p=>{
   if(p.status==='progress'||p.status==='progress_total'){
    const key=p.status+':'+(p.file??''),now=performance.now();
    const complete=p.progress>=100||(p.total>0&&p.loaded>=p.total);
    if(!complete&&now-(progressTimes.get(key)??-Infinity)<150)return;
    progressTimes.set(key,now);
   }
   message(id,'progress',{progress:{status:p.status,file:p.file,loaded:p.loaded,total:p.total,progress:p.progress}});
  };
  processor=await AutoProcessor.from_pretrained(modelId,{local_files_only:true,progress_callback});
  const session_options={...runtime.sessionOptions,graphOptimizationLevel:graphOptimization};
  model=fixedReferences?await(await import('./fixed-character-model.js')).loadFixedCharacterModel({variant:turbo?'turbo':'standard',progress_callback,session_options,device:runtime.device}):await ChatterboxModel.from_pretrained(modelId,{device:runtime.device,dtype,local_files_only:true,progress_callback,session_options});
  const device=await env.backends.onnx.webgpu.device;
  gpu={...gpu,...gpuInfo(device.adapterInfo),features:[...device.features],backend:'webgpu'};
  device.lost.then(info=>message(0,'device-lost',{error:info.message||'WebGPU device lost'}));
  const startupMs=performance.now()-started;message(id,'stage',{stage:'ready',gpu,startupMs});
  const resources=performance.getEntriesByType('resource').map(r=>({url:r.name,transferBytes:r.transferSize,encodedBytes:r.encodedBodySize,durationMs:r.duration}));
  return{gpu,startupMs,dtype,resources,graphOptimization,referenceMode:fixedReferences?'precomputed':'recordings',componentMs:model.componentMs,variant:turbo?'turbo':'standard',cacheKey:env.cacheKey,runtime:runtime.kind,runtimeFallbackReason:runtime.fallbackReason};
 })().catch(error=>{prepared=null;throw error;});return prepared;
}

async function encode(id,{speaker,pcm}){
 if(!['trip','grace'].includes(speaker))throw Error('Unknown character');
 await prepare(id);if(speakers.has(speaker))return{speaker,cached:true,encodeMs:0};
 const samples=new Float32Array(pcm);
 if(samples.length<24000||samples.length>24000*20||samples.some(x=>!Number.isFinite(x)))throw Error('Invalid voice reference');
 message(id,'stage',{stage:'encoding',speaker});const started=performance.now();
 const input=new Tensor('float32',samples,[1,samples.length]);
 const encoded=fixedReferences?await(await import('./fixed-character-model.js')).loadFixedConditioning(speaker,samples,turbo?'turbo':'standard'):await model.encode_speech(input);speakers.set(speaker,encoded);
 return{speaker,cached:false,precomputed:fixedReferences,encodeMs:performance.now()-started};
}

async function generate(id,{speaker,text,exaggeration=.5}){
 if(!speakers.has(speaker))throw Error('The character reference has not been encoded');
 if(typeof text!=='string'||!text.trim()||text.length>280)throw Error('Use a short audition line');
 const job=activeJob,stopper=job.stopper=new InterruptableStoppingCriteria(),criteria=new StoppingCriteriaList();criteria.push(stopper);
 message(id,'stage',{stage:'generating',speaker});
 const started=performance.now(),inputs=await processor(text);
 const maxSpeechTokens=320;let puts=0,tokens=0,lastToken=null,firstTokenMs=null,tokenGenerationMs=null;
 const waveform=await model.generate({...inputs,...speakers.get(speaker),...(!turbo?{exaggeration}:{}),max_new_tokens:maxSpeechTokens,stopping_criteria:criteria,
  streamer:{put(ids){if(puts++===0)return;tokens+=ids[0]?.length??0;firstTokenMs??=performance.now()-started;
   lastToken=Number(ids[0]?.at(-1));job.tokens=tokens;if(job.cancelled&&tokens>=4)stopper.interrupt();
   if(tokens%10===0)message(id,'tokens',{tokens,elapsedMs:performance.now()-started});},end(){tokenGenerationMs=performance.now()-started;message(id,'stage',{stage:'decoding'});}}});
 // The library finishes its decoder and disposes the request's KV cache.
 // Canceled audio is discarded; model weights and speaker embeddings survive.
 if(job.cancelled)return{cancelled:true,drainMs:performance.now()-job.cancelledAt,tokens};
 const eos=model.generation_config.eos_token_id,finished=(Array.isArray(eos)?eos:[eos]).some(id=>Number(id)===lastToken);
 // A finite, non-silent waveform can still be a cut-off or runaway reply.
 // Do not play it as completed speech. The per-request cache is already freed.
 if(tokens>=maxSpeechTokens&&!finished)throw Object.assign(Error('Speech reached its token limit before finishing'),{code:'voice_length_limit'});
 const samples=new Float32Array(waveform.data),generationMs=performance.now()-started;
 let sum=0,peak=0,clipped=0;for(const v of samples){if(!Number.isFinite(v))throw Error('Synthesis returned invalid audio');sum+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>=1)clipped++;}
 if(samples.length<2400||peak<1e-5)throw Error('Synthesis returned no audible speech');
 const durationSeconds=samples.length/24000;
 return{pcm:samples.buffer,sampleRate:24000,metrics:{generationMs,firstTokenMs,tokenGenerationMs,decodeMs:generationMs-tokenGenerationMs,
  tokens,lastToken,finished,durationSeconds,realTimeFactor:generationMs/1000/durationSeconds,audioSecondsPerComputeSecond:durationSeconds/(generationMs/1000),peak,rms:Math.sqrt(sum/samples.length),clippedSamples:clipped,gpu}};
}

self.onmessage=async({data})=>{
 const{id,type,...payload}=data;
 if(type==='cancel-generation'){
  if(activeJob?.type==='generate'&&activeJob.id===payload.target){activeJob.cancelled=true;activeJob.cancelledAt??=performance.now();if(activeJob.tokens>=4)activeJob.stopper?.interrupt();}
  return;
 }
 if(active){message(id,'error',{error:'A synthesis operation is already running'});return;}
 active=true;activeJob={id,type,cancelled:false,tokens:0};
 try{let result;if(type==='prepare')result=await prepare(id);else if(type==='encode')result=await encode(id,payload);else if(type==='generate')result=await generate(id,payload);else throw Error('Unknown audition operation');
  const transfer=result.pcm?[result.pcm]:[];postMessage({id,event:'complete',...result},transfer);
 }catch(error){message(id,'error',{error:error.message,code:error.code,stack:error.stack});}finally{active=false;activeJob=null;}
};
for(const event of earlyMessages.splice(0))self.onmessage(event);
