import {LocalDialogue} from './local-dialogue-audition/dialogue-client.js';
import {BrowserSpeech} from './browser-speech.js';
import {createAtlasInput} from './ui-tools/atlas-input.js';
import {SpeechFace} from './head-tools/speech-face.js';
import {GamePreparation} from './game-preparation.js';
import {SceneOrchestrator} from './scene-orchestrator.js';
import {bindGameMenu} from './in-game-controls.js';
const $=id=>document.getElementById(id);
const printable=/^[a-z0-9 !?.,"';:()\-]$/i;
const busyAudio=scene=>['loading','playing'].includes(scene.audio.status);

export class BrowserConversation {
  static async load(scene){
    const response=await fetch('./ui-tools/atlas-data.json');if(!response.ok)throw Error('Original typing data unavailable');
    const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(sha!=='74e8a58abb45cb53da50228d71d5d1ce770d2de36ebf525ebc931bc56a71abb5')throw Error('Original typing data integrity mismatch');
    return new BrowserConversation(scene,createAtlasInput(JSON.parse(new TextDecoder().decode(bytes))));
  }
  constructor(scene,atlas){
    this.scene=scene;this.atlas=atlas;this.model=localStorage.getItem('facade-local-dialogue')??'recordings';
    this.dialogue=new LocalDialogue({onchange:event=>{this.preparation?.dialogueProgress(event);if(event.type==='progress'&&this.pending)$('status').textContent='Loading dialogue · '+Math.round((event.progress??0)*100)+'%';this.controls();}});
    this.pipelineSchedule='sequence';this.idleEnabled=localStorage.getItem('facade-idle-behavior')!=='false';this.idleCount=0;this.nextIdleAt=performance.now()+45000;
    this.selectionReady=fetch('./local-dialogue-audition/selection.json').then(r=>r.json()).then(s=>{if(!localStorage.getItem('facade-local-dialogue')&&s.defaultModel)this.model=s.defaultModel;this.pipelineSchedule=s.schedule??'sequence';this.controls();}).catch(()=>{});
    this.draft='';this.plan=atlas.layout(new Uint8Array());this.draftPages=[];this.draftPage=0;this.pending=false;this.generation=0;
    this.originalLines=[];this.reply=null;this.lastReply=null;this.error=null;this.stage=null;this.lastMeter=0;
    this.pendingActionEvents=[];this.lastActionReaction=0;
    this.speech=new BrowserSpeech({onchange:()=>this.controls(),ontext:text=>{this.send(text);},onerror:text=>this.report(text),
      onvoice:event=>{if(this.reply&&!this.reply.textOnly&&!this.error)$('status').textContent=event.text;}});
    this.preparation=new GamePreparation(this);
    bindGameMenu(this);
    $('previous-draft').onclick=()=>{this.showDraftPage(this.draftPage-1);$('game').focus();};
    $('next-draft').onclick=()=>{this.showDraftPage(this.draftPage+1);$('game').focus();};
    this.hudResize=new ResizeObserver(()=>this.layoutDraft());this.hudResize.observe(document.querySelector('.game-surface'));
    if(scene.behavior){scene.behavior.onChange=()=>this.controls();scene.behavior.onEvent=event=>{if(event.source==='player'){this.pendingActionEvents.push(event.id);this.pendingActionEvents=this.pendingActionEvents.slice(-12);this.actionEventAt=performance.now();}else if(!event.success&&!event.cancelled)this.report(event.detail);};}
    $('character-voice-button').onclick=()=>{$('character-voice-dialog').showModal();this.scene.keys.clear();this.holdMic();this.controls();};
    $('character-voice-close').onclick=()=>$('character-voice-dialog').close();
    $('character-voice-dialog').addEventListener('close',()=>{this.holdMic();$('game').focus();});
    $('character-voice-mode').onchange=()=>{const mode=$('character-voice-mode').value;this.cancel();this.speech.voice.setMode(mode);this.error=null;this.controls();};
    $('dialogue-button').onclick=()=>{$('dialogue-dialog').showModal();this.scene.keys.clear();this.holdMic();this.controls();};
    $('dialogue-close').onclick=()=>$('dialogue-dialog').close();
    $('dialogue-dialog').addEventListener('close',()=>{this.holdMic();$('game').focus();});
    $('dialogue-model').onchange=async()=>{const model=$('dialogue-model').value;this.cancel();this.dialogue.unload();this.model=model;localStorage.setItem('facade-local-dialogue',this.model);this.error=null;this.controls();if(this.scene.opening.started){$('dialogue-dialog').close();if(!await this.preparation.prepare(this.scene.opening.player)){this.model='recordings';localStorage.setItem('facade-local-dialogue',this.model);this.controls();this.report('Preparation cancelled. Original recordings still play.');}}};
    $('idle-behavior').onchange=()=>{this.idleEnabled=$('idle-behavior').checked;localStorage.setItem('facade-idle-behavior',String(this.idleEnabled));this.nextIdleAt=performance.now()+45000;};
    $('talk-button').onclick=()=>{
      $('talk-text').value=this.draft;$('talk-dialog').showModal();this.scene.keys.clear();this.holdMic();$('talk-text').focus();
    };
    $('talk-close').onclick=()=>$('talk-dialog').close();
    $('talk-dialog').addEventListener('close',()=>{this.holdMic();$('game').focus();});
    $('talk-text').addEventListener('input',()=>{this.setDraft($('talk-text').value);$('talk-text').value=this.draft;});
    $('talk-form').onsubmit=event=>{event.preventDefault();const text=this.draft;$('talk-dialog').close();this.send(text);};
    $('talk-text').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();$('talk-form').requestSubmit();}});
    $('mic-button').onclick=async()=>{
      if(this.speech.requested){this.speech.disable();this.report('Microphone off.');$('game').focus();return;}
      if(this.scene.opening.stage!=='apartment'){this.report('Enter the apartment before starting a conversation.');$('game').focus();return;}
      this.speech.voice.unlock().catch(()=>{});
      if(this.speech.supported&&!this.pending&&!this.reply)this.speech.voice.prepareForInput();
      this.error=null;this.holdMic();$('game').focus();await this.speech.enable();
    };
    $('stop-reply').onclick=()=>{this.cancel();this.report('Reply stopped.');$('game').focus();};
    window.addEventListener('pagehide',()=>{this.cancel();this.speech.disable();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.speech.requested){this.speech.disable();this.report('Microphone off while the game is hidden.');}});
    this.controls();
  }
  report(text){this.error=text;$('status').textContent=text;this.controls();}
  setDraft(text){
    const accepted=[...text.replace(/\s/g,' ')].filter(char=>printable.test(char)).slice(0,80).join('');
    this.draft=accepted;this.draftPages=[];let part='';
    const layout=text=>this.atlas.layout(new TextEncoder().encode(text)),add=text=>this.draftPages.push({text,plan:layout(text)}),fits=plan=>plan.truncatedAt===null&&!plan.quads.some(q=>q.positions.some(p=>p[0]>99));
    for(const char of accepted){
      const next=part+char,plan=layout(next);
      if(part&&!fits(plan)){
        const split=part.lastIndexOf(' ');if(split>0&&fits(layout(part.slice(split+1)+char))){add(part.slice(0,split+1));part=part.slice(split+1)+char;}else{add(part);part=char;}
      }else part=next;
    }
    if(part||!this.draftPages.length)add(part);this.showDraftPage(this.draftPages.length-1);
  }
  showDraftPage(index){
    this.draftPage=Math.max(0,Math.min(this.draftPages.length-1,index));this.plan=this.draftPages[this.draftPage]?.plan??this.atlas.layout(new Uint8Array());
    $('draft-pages').hidden=this.draftPages.length<2;$('draft-page').textContent=(this.draftPage+1)+' / '+this.draftPages.length;
    $('previous-draft').disabled=this.draftPage===0;$('next-draft').disabled=this.draftPage===this.draftPages.length-1;this.layoutDraft();
  }
  layoutDraft(){
    this.typingYOffset=0;if(!this.plan.quads.length)return;
    const canvas=$('game').getBoundingClientRect(),controls=[...document.querySelectorAll('.play-controls button,#movement button,.draft-controls button')].filter(e=>e.checkVisibility());
    if(!controls.length||!canvas.height)return;
    const top=Math.min(...controls.map(e=>e.getBoundingClientRect().top)),minY=Math.min(...this.plan.quads.flatMap(q=>q.positions.map(p=>p[1])));
    const clearY=(canvas.bottom-top+8)*734/canvas.height/5.08-100;
    this.typingYOffset=Math.max(0,clearY-minY);
  }
  key(event){
    if(!this.scene.opening?.started||this.preparation.active||document.querySelector('dialog[open]'))return false;
    if(event.ctrlKey||event.metaKey||event.altKey)return false;
    // Gameplay letters belong to movement. Typing starts explicitly so words
    // containing WASD never move the player, including when resuming a draft.
    if(event.key==='Enter'){if(!event.repeat)$('talk-button').click();return true;}
    if(event.key==='Escape'){if(this.draft)this.setDraft('');else this.cancel();return true;}
    return false;
  }
  holdMic(){
    const hold=!!(this.scene.opening?.stage!=='apartment'||this.preparation?.active||busyAudio(this.scene)||this.pending||this.reply||document.querySelector('dialog[open]'));
    if(hold!==this.speech.hold)this.speech.setHold(hold);
  }
  originalAudioChanged(){
    if(this.scene.audio.status==='playing'){
      const line=this.scene.audio.line;this.originalLines.push({speaker:line.actor==='grace'?'Grace':'Trip',text:line.text});
      this.originalLines=this.originalLines.slice(-6);this.cancel();
    }
    this.holdMic();
  }
  async send(text,{playerEvent=false,idle=false}={}){
    text=String(text).trim().slice(0,512);if(!text&&!playerEvent&&!idle)return false;
    if(this.pending||this.reply||this.scene.behavior?.busy){this.report('Let this exchange finish, or select Stop.');return false;}
    if(this.scene.opening.stage!=='apartment'){this.report('Enter the apartment before starting a conversation.');return false;}
    if(busyAudio(this.scene)){this.report('Let them finish speaking, then try again.');return false;}
    this.speech.voice.unlock().catch(()=>{});
    const generation=++this.generation,inputStarted=performance.now(),speechInput=this.speech.lastInput?.text===text&&performance.now()-this.speech.lastInput.recognizedAt<1000?{...this.speech.lastInput}:null;
    const exchange=this.exchange=this.lastExchange=new SceneOrchestrator({text,inputType:idle?'idle':playerEvent?'player_event':'speech',player:this.scene.opening.player.name});
    this.lastReply=null;this.lastFailure=null;this.pending=true;this.error=null;this.holdMic();this.controls();
    this.pendingActionEvents=[];this.nextIdleAt=performance.now()+45000;if(!idle)this.idleCount=0;
    try{
      await this.selectionReady;if(generation!==this.generation)return false;
      if(this.model==='recordings'){this.report('Original recordings only. Choose a model in Menu > Dialogue for local replies.');return false;}
      let input=exchange.nextInput(this.scene.behavior?.snapshot(),this.originalLines);
      while(input&&generation===this.generation){
        if(this.pipelineSchedule==='overlap')this.speech.voice.prepareForReply();
        $('status').textContent=input.replyAs?input.replyAs+' is thinking…':'Thinking locally…';
        const reply=await this.dialogue.generate(this.model,input);
        if(generation!==this.generation)return false;
        if(input.replyAs&&reply.speaker!==input.replyAs)throw Error('Local dialogue returned the wrong character. No commands were executed.');
        if(this.draft.trim()===text)this.setDraft('');
        const accepted=this.lastReply={...reply,guest:text,inputStarted,replyAt:performance.now(),speechInput};exchange.add(accepted);
        const actor=this.scene.actors.find(a=>a.model.name===reply.speaker.toLowerCase());
        // Ordinary game code runs movement while the line plays. Keep the
        // exchange locked until it settles so a reply cannot cancel the walk.
        const actions=reply.actions?.length?this.scene.behavior.start(reply.actions):Promise.resolve([]);
        try{await this.presentReply(accepted,actor,generation);}finally{accepted.actionOutcomes=await actions;}
        if(generation!==this.generation)return false;
        this.dialogue.observe?.(this.scene.behavior?.snapshot(),{speaker:reply.speaker,text:reply.text,state:accepted.spoken?'spoken':'captioned'});
        input=exchange.nextInput(this.scene.behavior?.snapshot(),this.originalLines);
      }
      exchange.finish();this.nextIdleAt=performance.now()+45000;return true;
    }catch(error){
      if(generation!==this.generation)return false;
      exchange.finish(exchange.turns.length?'partial':'failed');this.speech.cancelSpeech();this.finishReply();
      this.lastFailure={message:error.message,raw:error.raw,metrics:error.metrics};
      if(error.name!=='AbortError')this.speech.disable();
      this.report(error.name==='AbortError'?'Reply stopped.':exchange.turns.length?'The follow-up failed. The first reply and its actions are kept.':error.message.length<=170?error.message:'Local dialogue failed. Original recordings still play; select Talk to retry.');return false;
    }finally{
      if(generation===this.generation){if(exchange.state==='active')exchange.finish('unavailable');this.exchange=null;this.pending=false;this.abort=null;this.holdMic();this.controls();if(!this.error)$('status').textContent=this.speech.requested?'Listening…':'';}
    }
  }
  async presentReply(accepted,actor,generation){
    if(!accepted.text){accepted.spoken=false;return;}
    const pages=this.scene.ui.captionPages(accepted.text);
    this.reply={...accepted,actor,pages,page:0,started:performance.now(),face:actor?new SpeechFace(actor.headData,{drift:false}):null};
    $('status').textContent=accepted.speaker;this.controls();
    const spoken=await this.speech.speak(accepted);
    if(generation!==this.generation)return;
    accepted.spoken=spoken.spoken;accepted.voice=spoken.metrics??null;
    if(spoken.metrics?.chunks?.[0]){const first=spoken.metrics.started+spoken.metrics.chunks[0].playbackStartedMs;accepted.timings={inputToFirstAudioMs:first-accepted.inputStarted,speechEndToFirstAudioMs:accepted.speechInput?.speechEndedAt?first-accepted.speechInput.speechEndedAt:null,recognitionMs:accepted.speechInput?.inferenceMs??null,dialogueMs:accepted.metrics?.responseMs,replyToFirstAudioMs:first-accepted.replyAt};}
    if(!spoken.spoken&&!spoken.cancelled){
      if(this.reply.face){this.reply.face.stop();this.reply.face.apply(this.reply.actor);}
      this.reply.textOnly=true;this.reply.started=performance.now();this.reply.page=0;
      if(this.speech.voice.mode!=='captions')this.report(spoken.error??'Spoken replies are unavailable. Captions are on.');
      // A captioned first turn must remain readable before the second begins.
      await new Promise(resolve=>{this.captionDone=resolve;});
    }else this.finishReply();
  }
  finishReply(){
    if(this.reply?.actor)this.scene.behavior?.endListening(this.reply.actor);
    if(this.reply?.face){this.reply.face.stop();this.reply.face.apply(this.reply.actor);}
    this.reply=null;this.captionDone?.();this.captionDone=null;this.holdMic();this.controls();
    if(!this.error)$('status').textContent=this.pending?'Finishing…':this.speech.requested?'Listening…':'';
  }
  cancel(){this.preparation?.cancel();if(this.exchange){this.exchange.finish('cancelled');this.dialogue.observe?.(this.scene.behavior?.snapshot(),{speaker:this.reply?.speaker??this.lastReply?.speaker,state:'interrupted; the last generated line may only have been partly heard'});}this.exchange=null;this.generation++;clearTimeout(this.requestTimer);this.dialogue.cancel();this.nextIdleAt=performance.now()+60000;this.idleCount=2;this.abort=null;this.pending=false;this.pendingActionEvents=[];this.scene.behavior?.cancel();this.speech.cancelSpeech();this.finishReply();}
  reset(){
    this.cancel();this.speech.disable();this.setDraft('');this.originalLines=[];this.lastReply=null;this.lastExchange=null;this.error=null;
    this.scene.behavior?.reset();
    this.dialogue.reset();this.idleCount=0;
    for(const id of ['talk-dialog','dialogue-dialog','character-voice-dialog','game-menu'])if($(id).open)$(id).close();this.controls();
  }
  get caption(){
    if(!this.reply)return null;
    return{actor:this.reply.speaker.toLowerCase(),text:this.reply.pages[this.reply.page].text,script:'generated-'+this.generation+'-'+this.reply.page};
  }
  update(now){
    const stage=this.scene.opening.stage;
    if(stage!==this.stage){this.stage=stage;this.holdMic();this.controls();if(stage==='apartment')$('status').textContent='WASD move · ← → turn · Enter to talk';}
    const reply=this.reply;
    if(this.pendingActionEvents.length&&now-this.actionEventAt>850&&now-this.lastActionReaction>4000&&!document.hidden&&this.model!=='recordings'&&!this.pending&&!this.reply&&!this.scene.behavior?.busy&&!busyAudio(this.scene)&&stage==='apartment'&&!document.querySelector('dialog[open]')){this.lastActionReaction=now;this.send('React to the guest action in the scene.',{playerEvent:true});}
    if(this.idleEnabled&&this.idleCount<1&&now>this.nextIdleAt&&this.dialogue.model&&!this.dialogue.draining&&!document.hidden&&!this.pending&&!this.reply&&!this.scene.behavior?.busy&&!this.pendingActionEvents.length&&!busyAudio(this.scene)&&stage==='apartment'&&!this.draft&&!document.querySelector('dialog[open]')&&!['transcribing','preparing','starting'].includes(this.speech.status)&&(!this.speech.requested||!this.speech.heardAt)){this.idleCount++;this.nextIdleAt=now+45000;this.send('',{idle:true});}
    if(reply){
      // Conversation facing is engine behavior, including gestures/captions.
      // Locomotion, object use and an explicit facing request keep their pose.
      if(reply.actor&&!reply.actions?.some(a=>a.actor===reply.speaker&&a.type==='face'&&a.target!=='player'))this.scene.behavior?.faceListener(reply.actor,now);
      // rAF's frame timestamp can precede an async reply received in that
      // frame. A negative first tick must not select caption page-1.
      const elapsed=Math.max(0,now-reply.started);
      if(reply.textOnly){reply.page=Math.min(reply.pages.length-1,Math.floor(elapsed/4500));if(elapsed>=reply.pages.length*4500)this.finishReply();}
      else{
        const at=this.speech.wordIndex;reply.page=Math.max(0,reply.pages.findLastIndex(page=>page.start<=at));
        // Replacement timing for generated speech, using original viseme
        // geometry. Estimated word timing and waveform energy are not phoneme alignment.
        if(reply.face&&this.speech.speaking&&this.speech.voiceLevel>.02){
          const letter=reply.text[Math.min(reply.text.length-1,at+Math.floor((now-this.speech.speechStarted)%400/80))]?.toLowerCase();
          const code=/[mbp]/.test(letter)?41:/[fv]/.test(letter)?46:/[ou]/.test(letter)?35:/[ei]/.test(letter)?32:/[a]/.test(letter)?31:/[a-z]/.test(letter)?51:1;
          if(reply.face.code!==code)reply.face.setCode(code,.8);reply.face.sample(elapsed);reply.face.apply(reply.actor);
        }else if(reply.face){reply.face.stop();reply.face.apply(reply.actor);}
      }
    }
    if(now-this.lastMeter>=80){this.lastMeter=now;const sample=this.speech.sample();$('mic-level').value=sample.level;if(this.speech.requested&&!this.speech.hold&&!this.error)$('status').textContent=sample.status==='listening'?'Listening…':sample.status==='transcribing'?'Recognizing speech…':sample.status==='preparing'?'Downloading browser speech model…':sample.status==='permission'?'Allow microphone access in the browser…':'Starting microphone…';}
  }
  controls(){
    const playing=!!this.scene.opening?.started;
    $('talk-button').hidden=$('mic-button').hidden=!playing;
    $('character-voice-button').hidden=!playing;
    $('character-voice-mode').value=this.speech.voice.mode;
    $('voice-state').textContent=this.speech.voice.text;
    $('voice-note').textContent=this.speech.voice.mode==='captions'?'Original recordings still play.':this.speech.voice.mode==='standard'?'Startup ~2 min. Files are cached here.':'Startup ~10 s. Files are cached here.';
    $('mic-button').setAttribute('aria-pressed',String(this.speech.requested));$('mic-button').textContent=this.speech.requested?'Mic on':'Mic';
    $('mic-level').hidden=!this.speech.requested;$('mic-level').setAttribute('aria-label',this.speech.hold?'Microphone paused':'Microphone input level');
    $('stop-reply').hidden=!this.pending&&!this.reply&&!this.scene.behavior?.busy;
    $('dialogue-button').hidden=false;
    $('dialogue-model').value=this.model;$('idle-behavior').checked=this.idleEnabled;
    $('dialogue-state').textContent=this.dialogue.state==='loading'?'Downloading and preparing…':this.dialogue.model?'Ready · runs in this browser':'Downloads once, then runs here.';
  }
}
