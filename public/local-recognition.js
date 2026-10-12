import {RecognitionWorkerClient} from './recognition-worker-client.js';
let prepared=false,preparing=null,warmed=false,warming=null;
const worklets=new WeakMap(),client=new RecognitionWorkerClient({onreset:()=>{prepared=false;preparing=null;warmed=false;warming=null;}});
async function call(type,extra={}){
 const result=await client.call(type,extra);
 prepared=true;LocalSpeechRecognition.lastError=null;
 LocalSpeechRecognition.backend=client.info;LocalSpeechRecognition.fallbackReason=client.fallbackReason;
 return result;
}

// Small SpeechRecognition-compatible adapter lets the game use its existing
// pause/error/turn lifecycle while owning its actual transcription pipeline.
export class LocalSpeechRecognition {
  static warmup(){
    if(warmed)return Promise.resolve({cached:true,backend:client.info});
    if(warming)return warming;
    const operation=(async()=>{
      await call('prepare');
      // Silent synthetic samples warm kernels without opening a capture device.
      const result=await call('transcribe',{audio:new Float32Array(16000)});
      warmed=true;return{elapsedMs:result.elapsedMs,backend:client.info};
    })();warming=operation;
    operation.then(()=>{if(warming===operation)warming=null;},()=>{if(warming===operation)warming=null;});return operation;
  }
  static cancelWarmup(){if(warming)client.drop(new DOMException('Preparation cancelled','AbortError'));}
  static async available(){return prepared?'available':'downloadable';}
  static async install(){
    if(prepared)return true;
    preparing??=call('prepare').then(()=>{prepared=true;return true;}).catch(error=>{LocalSpeechRecognition.lastError=error.message;preparing=null;return false;});
    return preparing;
  }
  constructor({context}={}){this.context=context;this.generation=0;this.active=false;this.stopping=false;this.ownsEndpointing=true;}
  start(track){
    if(!track||track.kind!=='audio'||track.readyState!=='live'||this.active)throw new DOMException('Invalid capture track','InvalidStateError');
    if(!this.context||this.context.sampleRate!==16000)throw Error('Speech capture must run at16000Hz');
    this.active=true;this.stopping=false;const generation=++this.generation;
    (async()=>{
      let loading=worklets.get(this.context);
      if(!loading){loading=this.context.audioWorklet.addModule(new URL('./voice-capture-worklet.js',import.meta.url));worklets.set(this.context,loading);}
      await loading;if(generation!==this.generation)return;
      this.source=this.context.createMediaStreamSource(new MediaStream([track]));
      this.node=new AudioWorkletNode(this.context,'facade-voice-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
      this.node.port.onmessage=async({data})=>{
        if(generation!==this.generation)return;
        if(data.type==='speechstart'){this.onspeechstart?.();return;}
        if(data.type!=='audio')return;
        const audio=data.audio;
        this.endpointAt=performance.now();this.speechEndedAt=this.endpointAt-(data.trailingSilenceMs??0);
        this.disconnect();
        try{
          if(audio.length>=1600){
            this.onaudioend?.();
            if(generation!==this.generation)return;
            const result=await call('transcribe',{audio});
            if(generation!==this.generation)return;
            this.lastInferenceMs=result.elapsedMs;
            if(result.text){const item=Object.assign([{transcript:result.text,confidence:0}],{isFinal:true});this.onresult?.({resultIndex:0,results:[item]});}
          }
          if(generation!==this.generation)return;this.active=false;this.onend?.();
        }catch(error){if(generation!==this.generation)return;this.active=false;this.onerror?.({error:'transcription',message:error.message});this.onend?.();}
      };
      this.source.connect(this.node);this.node.connect(this.context.destination);this.onstart?.();this.onaudiostart?.();
      if(this.stopping)this.node.port.postMessage('flush');
    })().catch(error=>{if(generation!==this.generation)return;this.active=false;this.onerror?.({error:'audio-capture',message:error.message});});
  }
  disconnect(){this.source?.disconnect();this.node?.disconnect();this.source=null;this.node=null;}
  stop(){if(!this.active||this.stopping)return;this.stopping=true;this.node?.port.postMessage('flush');}
  abort(){this.generation++;this.active=false;this.disconnect();this.onend?.();}
}
