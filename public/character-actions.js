import {playMotion,stopMotion} from './character-motion.js';
import {normalizeActions,locations,propIds,inspectIds,preferredPickupHand} from './character-action-protocol.js';
const name=actor=>actor.model.name==='trip'?'Trip':'Grace';
const rad=Math.PI/180,heading=(from,to)=>Math.atan2(to[0]-from[0],from[2]-to[2])/rad;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const scripts={trip:{walk:17,slow:20,angry:29,sad:26,still:221,nod:53,welcome:47,emphasize:54,cross_arms:80,point:93,angryGesture:229,pickup:159,holdLeft:158,holdRight:185,sip:[190,192,193],offer:163,put:162},grace:{walk:43,slow:102,angry:111,sad:108,still:139,nod:51,sigh:13,welcome:76,emphasize:17,cross_arms:79,angryGesture:141,pickup:52,holdLeft:55,sip:[60,62,63],offer:76,put:56}};
const surfaces={bar:[-151,80,-123],cabinet:[-183,75,-352],work_table:[153,65,-26]};
export class CharacterActions {
 constructor(scene,panels){
  this.scene=scene;this.panels=panels;this.objects=panels.filter(p=>inspectIds.includes(p.id)).map(p=>({id:p.id,name:p.name,panel:p,initial:structuredClone(p),heldBy:null,hand:null,content:[12,13].includes(p.id)?'wine':[14,15,16,17].includes(p.id)?'empty':null}));
  this.generation=0;this.revision=0;this.events=[];this.jobs=[];this.busy=false;this.active=null;this.reset();
 }
 actor(who){return this.scene.actors.find(a=>name(a)===who);}
 object(id){const object=this.objects.find(o=>o.id===id);if(!object)throw Error('That object is unavailable.');return object;}
 held(who,hand){return this.objects.find(o=>o.heldBy===who&&(!hand||o.hand===hand));}
 isHeld(id){return !!this.objects.find(o=>o.id===id)?.heldBy;}
 emit(source,type,detail,success=true,meta={}){const event={id:++this.revision,source,type,detail,success,...meta};this.events.push(event);this.events=this.events.slice(-24);this.onEvent?.(event);return event;}
 reset(){this.cancel();for(const o of this.objects){Object.assign(o.panel,structuredClone(o.initial));o.heldBy=o.hand=null;o.content=[12,13].includes(o.id)?'wine':[14,15,16,17].includes(o.id)?'empty':null;}for(const a of this.scene.actors)a.posture='standing';this.events=[];this.revision++;}
 idle(actor){
  stopMotion(actor);actor.playback=null;actor.frame=actor.model.neutralFrame;
  if(actor.posture==='sitting')playMotion(actor,46,{loop:true});
  playMotion(actor,actor.model.name==='trip'?1:2,{layer:1,loop:true});
  const s=scripts[actor.model.name];for(const [hand,layer] of [['left',6],['right',7]])if(this.held(name(actor),hand))playMotion(actor,hand==='left'?s.holdLeft:s.holdRight,{layer,loop:true});
 }
 cancel(){this.generation++;for(const job of this.jobs){job.rollback?.();job.resolve(false);}this.jobs=[];if(this.active){this.idle(this.actor(this.active.actor));this.emit(this.active.actor,this.active.type,'Interrupted before completion.',false,{cancelled:true,action:{...this.active}});}this.active=null;this.busy=false;this.onChange?.();}
 snapshot(){return{revision:this.revision,player:{position:[this.scene.camera.x,this.scene.camera.y,this.scene.camera.z],holding:this.held('player')?.id??null},characters:this.scene.actors.map(a=>({name:name(a),position:a.position.slice(),facing:a.yaw,posture:a.posture??'standing',holding:{left:this.held(name(a),'left')?.id??null,right:this.held(name(a),'right')?.id??null},action:this.active?.actor===name(a)?this.active.type:null})),objects:this.objects.map(o=>({id:o.id,name:o.name,position:o.heldBy?this.position(o.heldBy):o.panel.position.slice(),heldBy:o.heldBy,hand:o.hand,content:o.content,movable:propIds.includes(o.id)})),door:this.scene.door.opened?'open':'closed',recentEvents:this.events.slice(-12)};}
 position(target){if(target==='player')return[this.scene.camera.x,0,this.scene.camera.z];const actor=this.actor(target);if(actor)return actor.position.slice();if(Object.hasOwn(locations,target)){const [x,z]=locations[target];return[x,-5,z];}const object=this.object(target);return object.heldBy?this.position(object.heldBy):object.panel.position.slice();}
 faceListener(actor,now){
  const dt=Math.min(.05,Math.max(0,(now-(actor.listenerTick??now-16))/1000));actor.listenerTick=now;
  // Interaction/walking animations retain their own orientation.
  if(this.scene.opening.walks.has(actor)||(this.active?.actor===name(actor)&&!['gesture','wait'].includes(this.active.type)))return false;
  const target=heading(actor.position,this.position('player')),delta=((target-actor.yaw)%360+540)%360-180,step=180*dt;
  if(actor.posture==='sitting'){
   // Use the existing head controls instead of rotating the seated body off
   // the couch. The original head renderer supports a 65-degree turn.
   actor.head??={};actor.listenerHeadBase??=actor.head.yaw??0;
   const desired=Math.max(-65,Math.min(65,delta)),change=desired-(actor.head.yaw??0);
   actor.head.yaw=(actor.head.yaw??0)+Math.max(-step,Math.min(step,change));return Math.abs(change)<=step;
  }
  actor.yaw+=Math.max(-step,Math.min(step,delta));return Math.abs(delta)<=step;
 }
 endListening(actor){if(actor.listenerHeadBase!==undefined){actor.head.yaw=actor.listenerHeadBase;delete actor.listenerHeadBase;}delete actor.listenerTick;}
 free(x,z,actor){return x>=-185&&x<=185&&z>=-480&&z<=75&&!this.scene.world.blockers(x,z,10,actor).length&&Math.hypot(x-this.scene.camera.x,z-this.scene.camera.z)>=23;}
 line(a,b,actor){const d=distance(a,b),steps=Math.max(1,Math.ceil(d/5));for(let i=1;i<=steps;i++)if(!this.free(a[0]+(b[0]-a[0])*i/steps,a[2]+(b[2]-a[2])*i/steps,actor))return false;return true;}
 path(actor,destination){
  const start=actor.position;if(!this.free(destination[0],destination[2],actor))throw Error('The destination is occupied.');
  if(this.line(start,destination,actor))return[destination];
  const grid=10,key=(x,z)=>x+','+z,round=n=>Math.round(n/grid)*grid;
  const starts=[];for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const p=[round(start[0])+dx*grid,-5,round(start[2])+dz*grid];if(this.free(p[0],p[2],actor)&&this.line(start,p,actor))starts.push(p);}
  const open=[],best=new Map();for(const p of starts){const node={p,g:distance(start,p),previous:null};node.f=node.g+distance(p,destination);open.push(node);best.set(key(p[0],p[2]),node.g);}
  for(let visited=0;open.length&&visited<3000;visited++){
   open.sort((a,b)=>b.f-a.f);const node=open.pop();if(node.g!==best.get(key(node.p[0],node.p[2])))continue;
   if(distance(node.p,destination)<=22&&this.line(node.p,destination,actor)){const points=[destination];for(let n=node;n;n=n.previous)points.unshift(n.p);return points;}
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const p=[node.p[0]+dx*grid,-5,node.p[2]+dz*grid],g=node.g+grid*Math.hypot(dx,dz),k=key(p[0],p[2]);if(g>=(best.get(k)??Infinity)||!this.line(node.p,p,actor))continue;best.set(k,g);open.push({p,g,f:g+distance(p,destination),previous:node});}
  }
  throw Error('No clear path to that destination.');
 }
 approach(actor,target,reach=85){
  if(distance(actor.position,target)<=reach&&this.free(actor.position[0],actor.position[2],actor))return[];
  const candidates=[];for(const r of [38,55,72,85])for(let i=0;i<16;i++){const angle=i*Math.PI/8,p=[target[0]+Math.sin(angle)*r,-5,target[2]+Math.cos(angle)*r];if(r<=reach&&this.free(p[0],p[2],actor))candidates.push(p);}
  candidates.sort((a,b)=>distance(a,actor.position)-distance(b,actor.position));for(const p of candidates){try{return this.path(actor,p);}catch{}}throw Error('Cannot reach that object or character.');
 }
 wait(ms,generation,{step,rollback}={}){if(generation!==this.generation)return Promise.resolve(false);return new Promise((resolve,reject)=>this.jobs.push({started:performance.now(),ms,generation,step,rollback,resolve,reject}));}
 async motion(actor,script,generation,layer=2){const result=playMotion(actor,script,{layer});return this.wait(result.seconds*1000,generation);}
 async walk(actor,points,generation,pace='normal'){
  if(!points.length)return true;if(actor.posture==='sitting')throw Error('Stand up before walking.');
  this.scene.opening.walks.delete(actor);const s=scripts[actor.model.name];stopMotion(actor,0);playMotion(actor,this.held(name(actor))?s.still:pace==='normal'?s.walk:s[pace],{loop:true});
  const total=points.reduce((n,p,i)=>n+distance(i?points[i-1]:actor.position,p),0),speed=pace==='slow'?32:pace==='angry'?62:48;
  let index=0,last=0,blocked=0;
  const result=await this.wait(Math.max(3000,total/speed*1000+4000),generation,{step:elapsed=>{
   const dt=Math.min(.1,(elapsed-last)/1000);last=elapsed;const target=points[index];if(!target)return true;
   const d=distance(actor.position,target),step=Math.min(d,speed*dt),next=[actor.position[0]+(d?(target[0]-actor.position[0])*step/d:0),-5,actor.position[2]+(d?(target[2]-actor.position[2])*step/d:0)];
   if(!this.free(next[0],next[2],actor)){blocked+=dt;if(blocked>1)throw Error('Someone is blocking the path.');return false;}blocked=0;
   actor.yaw=heading(actor.position,target);actor.position=next;if(d<=step+.01)index++;return index>=points.length;
  }});this.idle(actor);return result;
 }
 async near(actor,target,generation,reach=85){const path=this.approach(actor,target,reach);if(!await this.walk(actor,path,generation))return false;if(distance(actor.position,target)>reach+1)throw Error('The target moved out of reach.');actor.yaw=heading(actor.position,target);return true;}
 pickupHand(actor,object,requested){return preferredPickupHand(name(actor),object.id,{left:this.held(name(actor),'left')?.id??null,right:this.held(name(actor),'right')?.id??null},requested);}
 transfer(object,who,hand){object.heldBy=who;object.hand=who==='player'?null:hand;this.revision++;}
 async execute(action,generation){
  const actor=this.actor(action.actor),s=scripts[actor.model.name],same=()=>generation===this.generation;
  if(action.type==='move')return this.walk(actor,action.position?this.path(actor,[action.position[0],-5,action.position[1]]):Object.hasOwn(locations,action.target)?this.path(actor,this.position(action.target)):this.approach(actor,this.position(action.target)),generation,action.pace);
  if(action.type==='face'){actor.yaw=heading(actor.position,this.position(action.target));return true;}
  if(action.type==='wait')return this.wait(action.seconds*1000,generation);
  if(action.type==='gesture'){if(action.name==='cross_arms'&&this.held(action.actor))throw Error('Hands must be empty to cross arms.');return this.motion(actor,s[action.name==='angry'?'angryGesture':action.name],generation);}
  if(action.type==='inspect'){if(!await this.near(actor,this.position(action.target),generation,120))return false;return this.motion(actor,s.nod,generation);}
  if(action.type==='open_door'||action.type==='close_door'){if(action.actor!=='Trip')throw Error('Only Trip has an implemented door animation.');if(this.held('Trip','right'))throw Error('Trip needs his right hand free for the door.');if(!await this.near(actor,[-185,0,140],generation,100))return false;const open=action.type==='open_door';this.scene.door.swing(open);if(!await this.motion(actor,open?38:41,generation))return false;if(!await this.wait(1700,generation))return false;return this.motion(actor,open?40:43,generation);}
  if(action.type==='sit'){
   if(this.held(action.actor))throw Error('Put objects down before sitting.');if(actor.posture==='sitting')return true;
   if(this.scene.actors.some(a=>a!==actor&&distance(a.position,[146,-5,-350])<40)||distance(this.position('player'),[146,-5,-350])<40)throw Error('The seat is occupied.');
   if(!await this.walk(actor,this.path(actor,[75,-5,-350]),generation))return false;
   const from=actor.position.slice();actor.yaw=270;const motion=playMotion(actor,45);const ok=await this.wait(motion.seconds*1000,generation,{step:t=>{actor.position=[from[0]+(146-from[0])*Math.min(1,t/(motion.seconds*1000)),-5,-350];return t>=motion.seconds*1000;},rollback:()=>{actor.position=from;}});if(ok){actor.posture='sitting';this.idle(actor);}return ok;
  }
  if(action.type==='stand'){
   if(actor.posture!=='sitting'){this.idle(actor);return true;}
   if(!this.free(75,-350,actor))throw Error('Someone is blocking the standing position.');
   const from=actor.position.slice(),motion=playMotion(actor,47);const ok=await this.wait(motion.seconds*1000,generation,{step:t=>{actor.position=[from[0]+(75-from[0])*Math.min(1,t/(motion.seconds*1000)),-5,-350];return t>=motion.seconds*1000;},rollback:()=>{actor.position=from;}});if(ok){actor.posture='standing';this.idle(actor);}return ok;
  }
  const object=this.object(action.object);
  if(action.type==='pick_up'){
   if(object.heldBy)throw Error('That object is already held.');const hand=this.pickupHand(actor,object,action.hand);if(this.held(action.actor,hand))throw Error('That hand is occupied.');
   if(!await this.near(actor,object.panel.position,generation,95))return false;
   if(actor.model.name==='grace'&&hand!=='left')throw Error('Grace only has an implemented left-hand pickup.');
   if(!await this.motion(actor,actor.model.name==='trip'&&hand==='right'?156:s.pickup,generation))return false;
   if(object.heldBy||this.held(action.actor,hand)||distance(actor.position,object.panel.position)>96)throw Error('The object or hand is no longer available in reach.');this.transfer(object,action.actor,hand);this.idle(actor);return true;
  }
  if(object.heldBy!==action.actor)throw Error('The character is not holding that object.');
  if(action.type==='put_down'){
   const at=action.target==='floor'?[actor.position[0]+Math.sin(actor.yaw*rad)*35,Math.max(5,object.panel.height/2),actor.position[2]-Math.cos(actor.yaw*rad)*35]:surfaces[action.target];
   if(action.target!=='floor'&&!await this.near(actor,at,generation,100))return false;
   if(action.target==='floor'&&!this.free(at[0],at[2],actor))throw Error('There is no clear floor space there.');
   stopMotion(actor,object.hand==='left'?6:7);
   if(!await this.motion(actor,actor.model.name==='trip'&&object.hand==='right'?186:s.put,generation))return false;object.panel.position=at.slice();object.heldBy=object.hand=null;this.revision++;this.idle(actor);return true;
  }
  if(action.type==='give'){
   if(object.hand!=='left')throw Error('Handoffs use the left hand. Put it down and pick it up with that hand.');
   if(!await this.near(actor,this.position(action.target),generation,70))return false;
   const recipient=this.actor(action.target),hand=recipient?this.pickupHand(recipient,object):null;if(this.held(action.target,hand))throw Error('The recipient has no free hand.');
   stopMotion(actor,6);if(!await this.motion(actor,s.offer,generation))return false;
   if(this.held(action.target,hand)||distance(actor.position,this.position(action.target))>85)throw Error('The recipient moved or their hand is occupied.');
   this.transfer(object,action.target,hand);this.idle(actor);if(recipient)this.idle(recipient);return true;
  }
  if(action.type==='drink'){
   if(![14,15,16,17].includes(object.id)||object.content==='empty')throw Error('The held glass is empty.');
   const expected=actor.model.name==='trip'?'right':'left';if(object.hand!==expected)throw Error('The drink must be in the '+expected+' hand.');
   stopMotion(actor,expected==='left'?6:7);for(const script of s.sip)if(!await this.motion(actor,script,generation))return false;
   if(same()){object.content='empty';object.panel.texture=7000;}this.idle(actor);return same();
  }
  if(action.type==='pour'){
   if(action.actor!=='Trip')throw Error('Grace has no implemented pouring animation.');
   if(![12,13].includes(object.id))throw Error('Only a wine bottle can pour.');const glass=this.object(action.target);if(glass.heldBy&&glass.heldBy!==action.actor)throw Error('The glass is held by someone else.');
   if(!glass.heldBy&&!await this.near(actor,glass.panel.position,generation,95))return false;
   stopMotion(actor,6);stopMotion(actor,7);for(const script of [138,140,141])if(!await this.motion(actor,script,generation))return false;
   if(glass.heldBy&&glass.heldBy!==action.actor||!glass.heldBy&&distance(actor.position,glass.panel.position)>96)throw Error('The glass is no longer available in reach.');
   glass.content=object.id===12?'red wine':'white wine';glass.panel.texture=object.id===12?8004:7004;this.revision++;return true;
  }
  if(action.type==='shake'){if(object.id!==23||action.actor!=='Trip')throw Error('Only Trip shaking the advice ball is implemented.');return this.motion(actor,169,generation);}
  return false;
 }
 async start(plan){
  const actions=normalizeActions(plan);if(!actions.length)return[];this.cancel();const generation=this.generation;this.busy=true;this.onChange?.();const outcomes=[];
  try{for(const action of actions){if(generation!==this.generation)break;this.active=action;try{const success=await this.execute(action,generation);if(generation!==this.generation)break;this.idle(this.actor(action.actor));outcomes.push(this.emit(action.actor,action.type,success?JSON.stringify(action):'Action did not finish.',success,{action:{...action}}));if(!success)break;}catch(error){if(generation!==this.generation)break;this.idle(this.actor(action.actor));outcomes.push(this.emit(action.actor,action.type,error.message,false,{action:{...action}}));break;}}}
  finally{if(generation===this.generation){this.active=null;this.busy=false;this.onChange?.();}}return outcomes;
 }
 update(now){for(const job of [...this.jobs]){if(job.generation!==this.generation)continue;const elapsed=Math.max(0,now-job.started);try{const done=job.step?job.step(elapsed):elapsed>=job.ms;if(done||elapsed>=job.ms){this.jobs.splice(this.jobs.indexOf(job),1);if(!done&&job.step){job.rollback?.();job.resolve(false);}else job.resolve(true);}}catch(error){this.jobs.splice(this.jobs.indexOf(job),1);job.rollback?.();job.reject(error);}}}
 playerAction(type,target){
  if(this.scene.opening.stage!=='apartment')return false;const player=this.position('player');
  try{
   if(type==='inspect'){const object=this.object(target);if(distance(player,object.panel.position)>165)throw Error('Move closer to inspect that.');this.emit('player','inspect','The guest examined '+object.name);return true;}
   if(type==='pick_up'){const object=this.object(target);if(!propIds.includes(target)||object.heldBy)throw Error('That object cannot be picked up.');if(this.held('player'))throw Error('Put down or give away the object you are holding.');if(distance(player,object.panel.position)>120)throw Error('Move closer to pick that up.');this.transfer(object,'player');this.emit('player','pick_up','The guest picked up '+object.name);return true;}
   if(type==='give'){const object=this.held('player'),actor=this.actor(target);if(!object||!actor||distance(player,actor.position)>100)throw Error('Move closer to give the held object.');const hand=this.pickupHand(actor,object);if(this.held(target,hand))throw Error('Their hands are full.');this.transfer(object,target,hand);this.idle(actor);this.emit('player','give','The guest gave '+object.name+' to '+target);return true;}
   if(type==='put_down'){const object=this.held('player');if(!object)return false;const at=[player[0]+Math.sin(this.scene.camera.yaw*rad)*32,object.panel.height/2,player[2]-Math.cos(this.scene.camera.yaw*rad)*32];if(this.scene.world.blockers(at[0],at[2],6).length)throw Error('There is no clear floor space there.');object.panel.position=at;object.heldBy=object.hand=null;this.emit('player','put_down','The guest set down '+object.name);return true;}
  }catch(error){this.emit('player',type,error.message,false);this.scene.conversation?.report(error.message);return false;}return false;
 }
}
