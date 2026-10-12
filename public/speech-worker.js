// Models and runtimes are same-origin assets. Audio stays in this worker.
// GPU failure is retried in a fresh CPU worker by RecognitionWorkerClient.
import {loadVoiceRuntime} from './voice-audition/voice-runtime.js';
let loading=null,busy=false,backend,metadata;
const forceCpu=new URL(self.location.href).searchParams.get('backend')==='wasm';
const gpuInfo=info=>({vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description,isFallbackAdapter:info?.isFallbackAdapter});
function ready(){
 return loading??=(async()=>{
  const started=performance.now();let adapter,fallbackReason;
  backend='wasm';
  if(!forceCpu){
   try{adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});}catch{}
   if(adapter&&!adapter.info?.isFallbackAdapter&&adapter.features.has('shader-f16'))backend='webgpu';
   else fallbackReason='Hardware WebGPU recognition unavailable; using local CPU recognition.';
  }
  const gpu=backend==='webgpu';
  const runtime=gpu?await loadVoiceRuntime({preferJspi:new URL(self.location.href).searchParams.get('runtime')!=='asyncify'}):null;
  const {pipeline,env}=gpu?runtime.library:await import('./assets/speech/runtime/transformers.min.js');
  env.allowRemoteModels=false;env.allowLocalModels=true;
  env.localModelPath=new URL('./assets/speech/',import.meta.url)[gpu?'pathname':'href'];
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const options={device:backend,local_files_only:true};
  if(gpu){
   env.useBrowserCache=true;env.cacheKey='facade-whisper-gpu-4.3.1-2575352d';
   options.device=runtime.device;options.session_options=runtime.sessionOptions;
   if(runtime.kind==='jspi'){
    // The injected runtime uses device:auto, so Transformers cannot infer
    // its usual WebGPU KV placement. Preserve the pinned Whisper cache path.
    const preferredOutputLocation={};
    for(let i=0;i<4;i++)for(const source of ['encoder','decoder'])for(const part of ['key','value'])preferredOutputLocation[`present.${i}.${source}.${part}`]='gpu-buffer';
    options.session_options={...runtime.sessionOptions,preferredOutputLocation};
   }
   env.backends.onnx.webgpu.adapter=adapter;env.backends.onnx.webgpu.powerPreference='high-performance';
   options.dtype={encoder_model:'fp32',decoder_model_merged:'q4'};
   // Omit the model metadata progress probe; it duplicates large local GETs.
  }else{
   env.backends.onnx.wasm.wasmPaths=new URL('./assets/speech/runtime/',import.meta.url).href;
   options.dtype='q8';let previous=-Infinity;
   options.progress_callback=progress=>{const now=performance.now();if(progress.progress<100&&now-previous<150)return;previous=now;postMessage({type:'progress',file:progress.file,progress:progress.progress});};
  }
  const model=await pipeline('automatic-speech-recognition','whisper-tiny-en',options);
  if(runtime?.kind==='jspi'){
   const decoder=model.model.sessions.decoder_model_merged;
   if(model.model.config.decoder_layers!==4||Object.keys(options.session_options.preferredOutputLocation).some(name=>!decoder.outputNames.includes(name)))throw Error('Pinned Whisper GPU cache outputs changed');
  }
  metadata={backend,startupMs:performance.now()-started,fallbackReason,runtime:runtime?.kind??'wasm',runtimeFallbackReason:runtime?.fallbackReason};
  if(gpu){
   const device=await env.backends.onnx.webgpu.device;
   metadata.gpu={...gpuInfo(adapter.info),...gpuInfo(device.adapterInfo)};
   device.lost.then(info=>postMessage({type:'device-lost',error:info.message||'Recognition GPU was lost'}));
  }
  return model;
 })().catch(error=>{loading=null;throw error;});
}
self.onmessage=async({data})=>{
  const {id,type}=data;let inference=false;
  try{
    if(type==='prepare'){await ready();postMessage({id,ready:true,...metadata});return;}
    if(type!=='transcribe')throw Error('Unknown speech worker request');
    if(busy)throw Error('A speech turn is still finishing');
    if(!(data.audio instanceof Float32Array)||data.audio.length<1600||data.audio.length>16000*20||data.audio.some(value=>!Number.isFinite(value)))throw Error('Invalid speech buffer');
    busy=true;inference=true;
    try{
      const model=await ready(),started=performance.now();
      const result=await model(data.audio,{max_new_tokens:96,do_sample:false,return_timestamps:false});
      postMessage({id,text:String(result.text??'').trim(),elapsedMs:performance.now()-started,...metadata});
    }finally{busy=false;}
  }catch(error){postMessage({id,error:String(error.message??error).slice(0,300),retryCpu:backend==='webgpu'&&(type==='prepare'||inference)});}
};
