// Recognition and character speech both run locally in browser workers.
import {LocalSpeechRecognition} from './local-recognition.js';
import {BrowserCharacterVoice} from './browser-character-voice.js';
export class BrowserSpeech {
  constructor({onchange=()=>{},ontext=()=>{},onerror=()=>{},onvoice=()=>{}}={}){
    Object.assign(this,{onchange,ontext,onerror,onvoice});
    this.voice=new BrowserCharacterVoice({onchange:event=>{Object.assign(this,this.voice.sample());this.onvoice(event);this.onchange();}});
    this.Recognition=LocalSpeechRecognition;
    this.requested=false;this.hold=false;
    this.status='off';this.level=0;this.generation=0;this.speechGeneration=0;
    this.recognition=null;this.stream=null;this.speaking=false;this.wordIndex=0;
    this.local=false;
  }
  get supported(){return !!(this.Recognition&&navigator.mediaDevices?.getUserMedia&&window.AudioWorkletNode&&window.Worker);}
  async enable(){
    if(this.requested)return;
    if(!this.supported){this.onerror('Voice input is unavailable in this browser. Use Talk to type.');return;}
    const generation=++this.generation;this.requested=true;this.noWords=0;this.status='permission';this.onchange();
    try{
      if(!this.local&&typeof this.Recognition.available==='function'){
        const available=await this.Recognition.available({langs:['en-US'],processLocally:true});
        if(generation!==this.generation)return;
        if(available==='available')this.local=true;
        else if(['downloadable','downloading'].includes(available)&&typeof this.Recognition.install==='function'){
          this.status='preparing';this.onchange();let timer;
          const installed=await Promise.race([this.Recognition.install({langs:['en-US'],processLocally:true}),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),60000);})]).finally(()=>clearTimeout(timer));
          if(generation!==this.generation)return;
          if(!installed){this.fail('The browser speech model could not load. Select Mic to retry.');return;}
          this.local=true;
        }
      }
      if(generation!==this.generation)return;
      this.status='permission';this.onchange();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(generation!==this.generation){for(const track of stream.getTracks())track.stop();return;}
      this.stream=stream;this.context=new AudioContext({sampleRate:16000});await this.context.resume();
      if(generation!==this.generation)return;
      this.source=this.context.createMediaStreamSource(stream);this.analyser=this.context.createAnalyser();
      this.analyser.fftSize=1024;this.waveform=new Float32Array(1024);this.source.connect(this.analyser);
      // Deliberately no connection to the speakers: no microphone feedback.
      for(const track of stream.getAudioTracks())track.onended=()=>this.fail('Microphone disconnected. Select Mic to reconnect.');
      this.setHold(this.hold);this.listen();
    }catch(error){
      if(generation!==this.generation)return;
      const text=error.name==='NotAllowedError'?'Microphone permission denied. Allow it in the browser, then select Mic.':
        error.name==='NotFoundError'?'No microphone found. Connect one, then select Mic.':
        error.name==='NotReadableError'?'The microphone is busy. Close the app using it, then select Mic.':'Microphone could not start. Use Talk to type.';
      this.fail(text);
    }
  }
  fail(text){this.disable();this.status='error';this.onerror(text);this.onchange();}
  stopRecognition(){
    clearTimeout(this.retry);clearTimeout(this.startTimer);clearTimeout(this.finalTimer);
    const recognition=this.recognition;this.recognition=null;
    if(recognition){recognition.onstart=recognition.onaudiostart=recognition.onaudioend=recognition.onspeechstart=recognition.onend=recognition.onerror=recognition.onresult=null;try{recognition.abort();}catch{}}
  }
  disable(){
    this.voice.cancelInputPreparation();
    this.generation++;this.requested=false;this.stopRecognition();this.level=0;this.status='off';
    if(this.stream)for(const track of this.stream.getTracks()){track.onended=null;track.stop();}
    this.stream=null;this.source?.disconnect();this.source=null;this.analyser=null;
    this.context?.close().catch(()=>{});this.context=null;this.onchange();
  }
  setHold(hold){
    this.hold=!!hold;
    if(this.stream)for(const track of this.stream.getAudioTracks())track.enabled=!this.hold;
    if(!this.requested)return;
    if(this.hold){this.stopRecognition();this.status='paused';this.level=0;}
    else if(this.stream)this.listen();
    this.onchange();
  }
  listen(){
    if(!this.requested||this.hold||!this.stream||this.recognition)return;
    clearTimeout(this.retry);
    const recognition=new this.Recognition({context:this.context});this.recognition=recognition;
    if(this.local)recognition.processLocally=true;
    recognition.lang='en-US';recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
    this.status='starting';this.heardAt=0;this.lastSound=0;this.finalizing=false;this.gotResult=false;this.onchange();
    recognition.onstart=recognition.onaudiostart=()=>{if(this.recognition!==recognition)return;clearTimeout(this.startTimer);this.status='listening';this.onchange();};
    recognition.onspeechstart=()=>{if(this.recognition===recognition&&!this.heardAt)this.heardAt=performance.now();};
    recognition.onaudioend=()=>this.transcribing(recognition);
    recognition.onresult=event=>{
      if(this.recognition!==recognition||this.hold)return;
      let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=' '+event.results[i][0].transcript;
      if(text.trim()){this.gotResult=true;this.noWords=0;clearTimeout(this.finalTimer);this.lastInput={text:text.trim().slice(0,512),recognizedAt:performance.now(),endpointAt:recognition.endpointAt,speechEndedAt:recognition.speechEndedAt,inferenceMs:recognition.lastInferenceMs};this.ontext(this.lastInput.text);}
    };
    recognition.onerror=event=>{
      if(this.recognition!==recognition||event.error==='aborted'||event.error==='no-speech')return;
      this.fail(event.error==='not-allowed'||event.error==='service-not-allowed'?'Speech recognition permission denied. Use Talk to type.':
        event.error==='audio-capture'?'Speech recognition cannot access the microphone. Use Talk to type.':
        event.error==='network'?'The browser speech service is unavailable. Use Talk to type.':'Speech recognition stopped. Select Mic to retry.');
    };
    recognition.onend=()=>{
      if(this.recognition!==recognition)return;
      this.recognition=null;clearTimeout(this.startTimer);clearTimeout(this.finalTimer);
      if(this.heardAt&&!this.gotResult&&++this.noWords>=2){this.fail('The microphone has sound, but no words were recognized. Use Talk to type.');return;}
      if(this.requested&&!this.hold)this.retry=setTimeout(()=>this.listen(),250);
    };
    try{
      this.startTimer=setTimeout(()=>{if(this.recognition===recognition)this.fail('Speech recognition did not start. Use Talk to type.');},10000);
      // Feed the same verified capture track to ASR. This avoids opening an
      // unrelated/default device while the visible meter measures another.
      recognition.start(this.stream.getAudioTracks()[0]);
    }
    catch{this.fail('Speech recognition could not start. Use Talk to type.');}
  }
  transcribing(recognition){
    if(this.recognition!==recognition||this.finalizing)return;
    this.finalizing=true;this.status='transcribing';this.onchange();
    this.finalTimer=setTimeout(()=>{if(this.recognition===recognition)this.fail('Speech recognition did not return words. Select Mic to retry, or use Talk.');},30000);
  }
  sample(){
    Object.assign(this,this.voice.sample());
    if(this.analyser&&this.requested&&!this.hold){
      this.analyser.getFloatTimeDomainData(this.waveform);let sum=0;
      for(const sample of this.waveform)sum+=sample*sample;
      this.level=Math.min(1,Math.sqrt(sum/this.waveform.length)*8);
      if(this.recognition&&!this.recognition.ownsEndpointing&&!this.finalizing&&typeof this.recognition.stop==='function'){
        const now=performance.now();
        if(this.level>.09){if(!this.heardAt)this.heardAt=now;this.lastSound=now;}
        // Give the recognizer an explicit utterance boundary from the same
        // capture track. Silent ASR/VAD stalls must not hold a turn forever.
        if(this.heardAt&&(now-this.lastSound>750||now-this.heardAt>15000)){
          const recognition=this.recognition;this.transcribing(recognition);
          try{recognition.stop();}catch{this.fail('Speech recognition stopped. Select Mic to retry.');}
        }
      }
    }else this.level=0;
    return{requested:this.requested,status:this.status,level:this.level,local:this.local,speaking:this.speaking,wordIndex:this.wordIndex};
  }
  cancelSpeech(){
    this.speechGeneration++;this.voice.cancel();this.speaking=false;this.wordIndex=0;this.voiceLevel=0;
  }
  async speak(reply){
    // BrowserCharacterVoice stops the previous reply itself while retaining
    // model preparation already underway during the text response request.
    const generation=++this.speechGeneration;this.speaking=false;this.wordIndex=0;this.voiceLevel=0;
    const result=await this.voice.speak(reply);
    if(generation!==this.speechGeneration)return{spoken:false,cancelled:true};
    Object.assign(this,this.voice.sample());this.onchange();return result;
  }
}
