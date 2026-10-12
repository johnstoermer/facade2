class VoiceCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.parts=[];this.length=0;this.done=false;
    this.rate=sampleRate;this.preRoll=[];this.preLength=0;
    this.heard=false;this.voiced=0;this.silent=0;this.spokenLength=0;
    this.port.onmessage=({data})=>{if(data==='flush')this.flush();};
  }
  flush(){
    if(this.done)return;this.done=true;
    const audio=new Float32Array(this.length);let offset=0;
    for(const part of this.parts){audio.set(part,offset);offset+=part.length;}
    this.parts=[];this.preRoll=[];this.port.postMessage({type:'audio',audio,trailingSilenceMs:this.silent/this.rate*1000},[audio.buffer]);
  }
  process(inputs){
    if(this.done)return false;
    const channel=inputs[0]?.[0];
    if(channel){
      let energy=0;for(const value of channel)energy+=value*value;
      const sound=Math.sqrt(energy/channel.length)>=.003;
      const part=channel.slice();
      if(!this.heard){
        // Keep only a short pre-roll while waiting. Silence never reaches
        // Whisper and does not consume the utterance's time limit.
        this.preRoll.push(part);this.preLength+=part.length;
        while(this.preLength-this.preRoll[0].length>=this.rate*.25)this.preLength-=this.preRoll.shift().length;
        this.voiced=sound?this.voiced+part.length:0;
        if(this.voiced>=this.rate*.024){
          this.heard=true;this.parts=this.preRoll;this.length=this.preLength;
          this.preRoll=[];this.preLength=0;this.spokenLength=this.voiced;
          this.port.postMessage({type:'speechstart'});
        }
      }else{
        this.parts.push(part);this.length+=part.length;this.spokenLength+=part.length;
        this.silent=sound?0:this.silent+part.length;
        // Endpoint on the audio thread, even if rendering or a slow frame
        // delays the UI meter. Keep the last 750ms so final words are intact.
        if(this.silent>=this.rate*.75||this.spokenLength>=this.rate*15)this.flush();
      }
    }
    // Output stays silent; the destination connection keeps capture active.
    return !this.done;
  }
}
registerProcessor('facade-voice-capture',VoiceCapture);
