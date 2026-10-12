// Replacement opening controller using original geometry, poses, cues and
// recordings. It is a bounded playable opening, not the original drama engine.
import {playMotion,stopMotion} from './character-motion.js';
const RAD=Math.PI/180;
const heading=(from,to)=>Math.atan2(to[0]-from[0],from[2]-to[2])/RAD;
export class ApartmentOpening {
  constructor(scene,door,{spawn,onStatus=()=>{}}){
    this.scene=scene;this.door=door;this.spawn=spawn;this.onStatus=onStatus;
    this.trip=scene.actors.find(a=>a.model.name==='trip');this.grace=scene.actors.find(a=>a.model.name==='grace');
    if(!this.trip||!this.grace)throw Error('Both original characters are required');
    this.generation=0;this.waiters=[];this.walks=new Map();this.history=[];
    this.reset();
  }
  status(stage,text){this.stage=stage;this.onStatus(text);this.history.push({stage,time:performance.now()});if(this.history.length>32)this.history.shift();}
  reset(){
    this.generation++;this.scene.audio.stop();this.scene.audio.stopEffects();
    for(const w of this.waiters)w.resolve(false);this.waiters=[];this.walks.clear();
    this.door.reset();Object.assign(this.scene.camera,this.spawn);this.scene.keys.clear();
    for(const actor of this.scene.actors){stopMotion(actor);actor.playback=null;actor.visible=true;actor.frame=actor.model.neutralFrame;actor.pitch=0;actor.roll=0;actor.torsoYaw=0;}
    // Trip's original TGreetsP initialization, Java argument case414.
    this.trip.position=[-154,-5,126];this.trip.yaw=heading(this.trip.position,[-210,0,190]);
    // Grace starts out of the hallway sightline; this controller's staging
    // choice is recorded separately from the original authored body data.
    this.grace.position=[-30,-5,-155];this.grace.yaw=180;
    this.started=false;this.starting=false;this.status('ready','Opening preview');
  }
  async start(player={id:0,name:'Adam',gender:'m'}){
    if(this.started||this.starting)return false;
    const generation=this.generation;this.starting=true;
    try{await this.scene.audio.unlock();}finally{if(generation===this.generation)this.starting=false;}
    if(generation!==this.generation)return false;
    this.started=true;this.player=player;
    for(const actor of this.scene.actors)playMotion(actor,actor===this.trip?1:2,{layer:1,loop:true});
    this.status('hallway','WASD move · ← → turn · Click the door to knock');return true;
  }
  wait(ms){return new Promise(resolve=>this.waiters.push({at:performance.now()+ms,resolve}));}
  async speak(actor,script,generation=this.generation){
    if(generation!==this.generation)return false;
    if(!await this.scene.audio.play(actor,script))return false;
    if(generation!==this.generation)return false;
    const ended=await this.scene.audio.finished;
    return ended&&generation===this.generation;
  }
  onDoor(event){
    const sounds={knock:'doorknock1',open:'opendoor1',closed:'closedoor1'};
    if(sounds[event.type])this.scene.audio.effect(sounds[event.type]).catch(e=>this.onStatus(e.message));
    if(event.type==='knock'&&this.stage==='hallway')this.answer().catch(e=>this.onStatus(e.message));
  }
  async answer(){
    const generation=this.generation;this.status('answering','');
    // Original opening dialogue; alternate variants and the full argument
    // beat remain unimplemented. Audio completion, not a guessed delay,
    // advances each line. Replay/reset cancels the whole outstanding chain.
    const female=this.player.gender!=='m';
    if(!await this.speak('trip',female?1062:1061,generation))return;
    if(!await this.speak('grace',female?959:958,generation))return;
    if(!await this.speak('trip',female?1064:1063,generation))return;
    playMotion(this.trip,38,{layer:2});
    // Script38 emits original cue8 after24 poses; door motion starts there.
    const playback=this.trip.motion.layers.get(2),cue=playback.compiled.cues.find(c=>c.code===8);
    if(!cue)throw Error('Original door gesture cue missing');
    if(!await this.wait(cue.frameOffset/30*1000)||generation!==this.generation)return;
    this.door.swing(true);
    if(!await this.wait(250)||generation!==this.generation)return;
    if(!await this.speak('trip',1069,generation))return;
    stopMotion(this.trip,2);playMotion(this.trip,49,{layer:2});
    if(!await this.speak('trip',1086,generation))return;
    // Move away from the opening so the player can enter without passing
    // through a character. Paths/scheduling are this replacement controller.
    this.walk(this.trip,[[-170,-5,40],[-130,-5,-20],[-75,-5,-40]],()=>this.facePlayer(this.trip));
    this.status('entering','Come on in');
  }
  facePlayer(actor){actor.yaw=heading(actor.position,[this.scene.camera.x,0,this.scene.camera.z]);}
  walk(actor,points,done=()=>{}){
    const script=actor===this.trip?17:43;
    stopMotion(actor);playMotion(actor,script,{loop:true});
    this.walks.set(actor,{points:points.map(p=>p.slice()),done});
  }
  async greet(){
    const generation=this.generation;this.status('greeting','');
    this.walk(this.grace,[[-30,-5,-95]],()=>this.facePlayer(this.grace));
    if(!await this.wait(1200)||generation!==this.generation)return;
    this.facePlayer(this.trip);this.facePlayer(this.grace);
    playMotion(this.grace,76,{layer:2});
    if(!await this.speak('grace',964,generation))return;
    playMotion(this.grace,78,{layer:2});
    if(!await this.speak('grace',976,generation))return;
    this.status('apartment','Opening preview · Click Trip or Grace');
  }
  async interact(actor){
    if(this.stage!=='apartment'||this.scene.audio.status!=='idle')return false;
    this.facePlayer(actor);
    return this.speak(actor.model.name,actor===this.trip?1099:992);
  }
  update(now,dt){
    const due=this.waiters.filter(w=>w.at<=now);this.waiters=this.waiters.filter(w=>w.at>now);for(const w of due)w.resolve(true);
    for(const [actor,walk] of this.walks){
      const target=walk.points[0],dx=target[0]-actor.position[0],dz=target[2]-actor.position[2],distance=Math.hypot(dx,dz),step=Math.min(distance,45*dt);
      actor.yaw=heading(actor.position,target);
      if(distance>0){actor.position[0]+=dx/distance*step;actor.position[2]+=dz/distance*step;}
      if(distance<=step){
        actor.position=target;walk.points.shift();
        if(!walk.points.length){this.walks.delete(actor);stopMotion(actor);actor.frame=actor.model.neutralFrame;playMotion(actor,actor===this.trip?1:2,{layer:1,loop:true});walk.done();}
      }
    }
    if(this.stage==='entering'&&this.scene.camera.z<60)this.greet().catch(e=>this.onStatus(e.message));
  }
}
