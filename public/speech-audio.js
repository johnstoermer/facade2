// Original recorded dialogue, fetched and decoded only when requested.
// Speech group operands remain available for the native cue scheduler port.
export class SpeechAudio {
  constructor(manifest) {
    if(manifest.schema!=='facade-original-opening-audio-v1')throw Error('Unsupported speech data');
    this.manifest=manifest;this.context=null;this.analyser=null;this.cache=new Map();
    this.generation=0;this.source=null;this.started=0;this.line=null;
    this.status='idle';this.duration=0;this.error=null;this.fetchedBytes=0;
    this.onchange=()=>{};
    this.effectSources=new Set();this.effects={};this.effectGeneration=0;
    this.finished=Promise.resolve(false);this.finish=null;
  }
  static async load(){
    const response=await fetch('./assets/opening-audio.json');
    if(!response.ok)throw Error('Original speech index unavailable');
    return new SpeechAudio(await response.json());
  }
  async unlock(){
    // Called synchronously from a user gesture; no autoplay-policy bypass.
    if(!this.context){
      this.context=new AudioContext();this.analyser=this.context.createAnalyser();
      this.analyser.fftSize=1024;this.analyser.connect(this.context.destination);
      this.waveform=new Float32Array(this.analyser.fftSize);
    }
    if(this.context.state!=='running')await this.context.resume();
    if(this.context.state!=='running')throw Error('Select Play voice to enable sound');
  }
  stop(){
    this.generation++;
    this.finish?.(false);this.finish=null;
    if(this.source){this.source.onended=null;this.source.stop();this.source.disconnect();this.source=null;}
    this.status='idle';this.line=null;this.duration=0;this.onchange();
  }
  async loadEffects(){
    const response=await fetch('./assets/door-audio.json');if(!response.ok)throw Error('Door sound index unavailable');
    const data=await response.json();if(data.schema!=='facade-door-audio-v1')throw Error('Unsupported door sound data');
    this.effects=data.files;
  }
  stopEffects(){
    this.effectGeneration++;
    for(const source of this.effectSources){source.onended=null;source.stop();source.disconnect();}
    this.effectSources.clear();
  }
  async effect(name){
    const meta=this.effects[name];if(!meta)throw Error('Unknown original sound effect');
    const generation=this.effectGeneration;
    await this.unlock();const buffer=await this.buffer(meta.file,meta);
    if(generation!==this.effectGeneration)return false;
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.analyser);
    source.onended=()=>{source.disconnect();this.effectSources.delete(source);};
    this.effectSources.add(source);source.start();return true;
  }
  async buffer(file,metadata){
    if(this.cache.has(file)){const cached=this.cache.get(file);this.cache.delete(file);this.cache.set(file,cached);return cached;}
    const meta=metadata??this.manifest.files[file];if(!meta)throw Error('Unknown original voice file');
    const response=await fetch(meta.uri);if(!response.ok)throw Error('Original voice file unavailable');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==meta.bytes)throw Error('Truncated original voice file');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==meta.sha256)throw Error('Original voice integrity mismatch');
    const decoded=await this.context.decodeAudioData(bytes);
    if(decoded.numberOfChannels!==meta.channels||Math.abs(decoded.duration-meta.duration)>2/meta.sampleRate)throw Error('Decoded speech format mismatch');
    this.fetchedBytes+=meta.bytes;this.cache.set(file,decoded);
    // A bounded cache keeps a long conversation from retaining every WAV.
    while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);
    return decoded;
  }
  async play(actor,script){
    const line=this.manifest.lines.find(l=>l.actor===actor&&l.script===script);
    if(!line?.available)throw Error('This original voice line is unavailable');
    this.stop();const generation=this.generation;this.error=null;
    this.line=line;this.status='loading';this.onchange();
    try{
      await this.unlock();const buffer=await this.buffer(line.file);
      if(this.generation!==generation)return false;
      const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.analyser);
      this.source=source;this.duration=buffer.duration;this.started=this.context.currentTime;
      this.finished=new Promise(resolve=>{this.finish=resolve;});
      source.onended=()=>{
        source.disconnect();if(this.generation!==generation)return;
        this.finish?.(true);this.finish=null;
        this.source=null;this.status='idle';this.line=null;this.duration=0;this.onchange();
      };
      source.start();this.status='playing';this.onchange();return true;
    }catch(error){
      if(this.generation!==generation)return false;
      this.status='error';this.error=error.message;this.onchange();throw error;
    }
  }
  sample(){
    let rms=0;if(this.analyser){this.analyser.getFloatTimeDomainData(this.waveform);rms=Math.sqrt(this.waveform.reduce((s,v)=>s+v*v,0)/this.waveform.length);}
    return {status:this.status,actor:this.line?.actor??null,script:this.line?.script??null,
      seconds:this.status==='playing'?Math.min(this.duration,this.context.currentTime-this.started):0,
      duration:this.duration,contextState:this.context?.state??'uninitialized',rms,
      cachedFiles:this.cache.size,fetchedBytes:this.fetchedBytes,error:this.error};
  }
}
