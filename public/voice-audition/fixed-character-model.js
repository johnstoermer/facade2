import {PreTrainedModel,ChatterboxModel,AutoConfig,Tensor,env} from './runtime/transformers.min.js';
import {withModelDownloadProgress} from './model-download-progress.js';

// These are the pinned encoders' outputs, copied without rounding.
// No speech encoder is needed at runtime for the two fixed game characters.
const configurations={
 standard:{modelId:'chatterbox',revision:'3cab09af388d3f02bba43443fce88c1f4525ac43',encoderDtype:'fp32',embeddingDtype:'fp32',layers:30,manifestHash:'941e358d6bda004cb4b7c21bcbf2f1f280c0d13f64a3067e32abe78bac5f56f4',featureShape:[1,33,1024],maxTensorBytes:262144},
 turbo:{modelId:'chatterbox-turbo',revision:'d21799bd0354adb85e348b8a0442a8405110a2cf',encoderDtype:'q4f16',embeddingDtype:'q4f16',layers:24,manifestHash:'5897e4a136b8b8cee8c15107e4dcdd33829230887f0d42fd388cbf81e911b97d',featureShape:[1,null,1024],maxTensorBytes:1048576},
};
const configuration=variant=>{if(!Object.hasOwn(configurations,variant))throw Error('Unknown fixed voice model');return configurations[variant];};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const manifestPromises=new Map();

async function checkedFile(url,sha256,maxBytes){
 let cache;try{cache=await caches.open('facade-character-conditioning-v1');}catch{}
 let response=await cache?.match(url);if(!response)response=await fetch(url);
 if(!response?.ok)throw Error('Character voice profile unavailable');
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength>maxBytes||await digest(bytes)!==sha256){await cache?.delete(url);throw Error('Character voice profile integrity mismatch');}
 // Cache only verified bytes. Failure to persist does not prevent playback.
 try{await cache?.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));}catch{}
 return bytes;
}

function manifest(variant){
 if(manifestPromises.has(variant))return manifestPromises.get(variant);
 const {revision,encoderDtype,manifestHash}=configuration(variant),base=new URL('./conditioning/'+variant+'/',import.meta.url);
 const promise=checkedFile(new URL('manifest.json',base),manifestHash,16384).then(bytes=>{
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(data.schema!=='facade-character-conditioning-v1'||data.revision!==revision||data.encoderDtype!==encoderDtype)throw Error('Unsupported character voice profile');
  return data;
 }).catch(error=>{manifestPromises.delete(variant);throw error;});
 manifestPromises.set(variant,promise);return promise;
}

export async function loadFixedCharacterModel({variant='standard',progress_callback,session_options={},device='webgpu'}={}){
 const info=configuration(variant),{modelId}=info,config=await AutoConfig.from_pretrained(modelId,{local_files_only:true});
 const generationResponse=await fetch(new URL('./models/'+modelId+'/generation_config.json',import.meta.url));
 if(!generationResponse.ok)throw Error('Voice generation configuration unavailable');
 const generation_config=await generationResponse.json(),sessions={},componentMs={};
 const layers=config.text_config?.num_hidden_layers??config.text_config?.n_layer;if(config.model_type!=='chatterbox'||layers!==info.layers)throw Error('Fixed voices require the pinned model configuration');
 // Turbo shares byte-identical duplicated initializers in its fp32 decoder.
 // The audited repack reduces downloads without changing tensor precision.
 const components=[['embed_tokens','embed_tokens',info.embeddingDtype],['model','language_model','q4f16'],['conditional_decoder',variant==='turbo'?'conditional_decoder_dedup':'conditional_decoder','fp32']];
 const load=async([name,file,dtype])=>{
  const preferredOutputLocation={};if(name==='model')for(let i=0;i<layers;i++)for(const part of ['key','value'])preferredOutputLocation['present.'+i+'.'+part]='gpu-buffer';
  const begin=performance.now();
  const component=await PreTrainedModel.from_pretrained(modelId,{config:{model_type:'custom','transformers.js_config':{use_external_data_format:true}},device,dtype,model_file_name:file,local_files_only:true,session_options:{...session_options,...(name==='model'?{preferredOutputLocation}:{})}});
  sessions[name]=component.sessions.model;componentMs[name]=performance.now()-begin;
  if(name==='model')for(const output of Object.keys(preferredOutputLocation))if(!sessions[name].outputNames.includes(output))throw Error('Voice model cache outputs changed');
 };
 // Downloads can overlap; Transformers.js serializes WebGPU session creation.
 // Keep the optional Standard model's existing sequential loading order.
 await withModelDownloadProgress(env,new URL('./models/'+modelId+'/',import.meta.url),progress_callback,async()=>{
  if(variant==='turbo')await Promise.all(components.map(load));
  else for(const component of components)await load(component);
 });
 const model=new ChatterboxModel(config,sessions,{generation_config});model.componentMs=componentMs;return model;
}

export async function loadFixedConditioning(speaker,pcm,variant='standard'){
 const info=configuration(variant),base=new URL('./conditioning/'+variant+'/',import.meta.url);
 const shapes={audio_features:info.featureShape,audio_tokens:[1,null],speaker_embeddings:[1,192],speaker_features:[1,null,80]};
 const data=await manifest(variant),profile=data.profiles.find(p=>p.speaker===speaker);
 if(!profile||await digest(pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.byteLength))!==profile.pcmSha256)throw Error('Character recording does not match its voice profile');
 const encoded={};
 for(const tensor of profile.tensors){
  const expected=shapes[tensor.name],type=tensor.name==='audio_tokens'?'int64':'float32';
  if(!expected||tensor.type!==type||tensor.dims.length!==expected.length||tensor.dims.some((n,i)=>!Number.isInteger(n)||n<1||n>2048||(expected[i]!==null&&n!==expected[i]))||!/^\w+-\w+\.bin$/.test(tensor.file))throw Error('Invalid character voice tensor');
  const bytes=await checkedFile(new URL(tensor.file,base),tensor.sha256,info.maxTensorBytes);
  if(bytes.byteLength!==tensor.bytes||bytes.byteLength!==tensor.dims.reduce((a,b)=>a*b,1)*(type==='int64'?8:4))throw Error('Invalid character voice tensor size');
  const values=type==='int64'?new BigInt64Array(bytes):new Float32Array(bytes);
  if(type==='float32'&&values.some(v=>!Number.isFinite(v)))throw Error('Invalid character voice features');
  encoded[tensor.name]=new Tensor(type,values,tensor.dims);
 }
 if(Object.keys(encoded).length!==4)throw Error('Incomplete character voice profile');
 return encoded;
}
