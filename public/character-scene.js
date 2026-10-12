import {drawBody} from './character-body.js';
import {loadMotionScripts,attachMotion,composePose} from './character-motion.js';
import {resolveRootPrefix,projectBodyPoints} from './motion-transform-tools/motion-transforms.js';
const f=Math.fround;
const signedAngle=a=>{while(a>180)a-=360;while(a< -180)a+=360;return a;};
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('Missing character data: '+url);return r.json();}

export async function loadCharacters(){
  const [topology,poses,motions]=await Promise.all([json('./assets/characters.json'),json('./animation-tools/out/manifest.json'),loadMotionScripts()]);
  if(topology.schema!=='facade-body-topology-v1'||poses.schema!=='facade-animation-poses-v1')throw Error('Unsupported character data schema');
  return Promise.all(topology.actors.map(async model=>{
    const meta=poses.actors.find(a=>a.id===model.id);
    if(!meta||meta.layout.modelPointCount!==model.pointCount)throw Error('Character point counts disagree');
    const response=await fetch('./animation-tools/out/'+meta.blob.uri);if(!response.ok)throw Error('Missing original animation poses');
    const buffer=await response.arrayBuffer();if(buffer.byteLength!==meta.blob.bytes||buffer.byteLength!==meta.frameCount*meta.layout.frameStrideBytes)throw Error('Truncated original poses');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==meta.blob.sha256)throw Error('Original pose integrity mismatch');
    const actor={model,meta,view:new DataView(buffer),frame:model.neutralFrame,position:model.id===0?[-30,0,-290]:[45,0,-315],yaw:180,visible:true,playback:null};
    attachMotion(actor,motions.find(m=>m.id===model.id));return actor;
  }));
}

export function setFrame(actor,frame){
  if(!Number.isInteger(frame)||frame<0||frame>=actor.meta.frameCount)throw Error('Pose frame outside original data');
  actor.frame=frame;
}

export function renderCharacter(actor,camera,eye,sink,time){
  actor.rendered=null;actor.renderedHead=null;
  if(!actor.visible)return;
  if(actor.playback){
    const {clip,started,rate}=actor.playback;
    setFrame(actor,clip.startFrame+Math.floor((time-started)*rate/1000)%clip.frameCount);
  }
  const {model,meta}=actor,l=meta.layout,pose=composePose(actor,time),base=l.modelPointsByteOffset/4;
  // Native world root comes from the BASE frame before additive composition.
  // Keep controller position/yaw unchanged to prevent per-render accumulation.
  const rootOffset=actor.frame*l.frameStrideBytes;
  const basePrefix=Array.from({length:6},(_,i)=>actor.view.getFloat32(rootOffset+i*4,true));
  const world=resolveRootPrefix({basePosition:actor.position,baseRotation:[actor.pitch??0,actor.yaw,actor.roll??0],basePrefix});
  const raw=Array.from({length:model.pointCount},(_,i)=>[0,1,2].map(axis=>pose[base+i*3+axis]));
  const origin=eye(world.position);if(origin[2]>=-.1)return;
  // FUN_1008fee0 returns 100/depth as scale; its extra1.25 only multiplies
  // projected origin X/Y. FUN_1008ebf6 then multiplies scale by0.625.
  const perspective=125/-origin[2],scale=100/-origin[2]*.625;
  // FUN_100908f0 uses gluProject with the original 1016-square viewport,
  // then subtracts integer halves of native nominal dimensions 1016x741.
  // FUN_100af6b0/1008e0e0, confirmed from x86: a half-angle correction for
  // actors away from the camera centerline is shared by body and outline yaw.
  const bearing=signedAngle(f(Math.atan2(world.position[2]-camera.z,world.position[0]-camera.x)*57.2974694313457+90));
  const correction=f(signedAngle(f(camera.yaw-bearing))*.5);
  const body=projectBodyPoints({actorId:model.id,points:raw,pivotIndex:model.anchorPoint,
    worldRotation:world.rotation,cameraRotation:[0,camera.yaw,0],torsoYaw:actor.torsoYaw??0,
    offAxisCorrection:correction,scale,center:[origin[0]*perspective,origin[1]*perspective]});
  const points=body.points,relative=body.outlineRelativeYaw;
  actor.rendered=drawBody(model,points,scale,origin[2],relative,sink,model.anchorPoint);
  actor.rendered.scale=scale;actor.rendered.relativeYaw=relative;
  actor.rendered.originalDepths=points.map(p=>p[2]);actor.rendered.rawPose=raw;
  actor.rendered.rawPrefix=Array.from({length:5},(_,i)=>[0,1,2].map(axis=>pose[i*3+axis]));
  actor.rendered.worldPosition=world.position;actor.rendered.worldRotation=world.rotation;
  actor.rendered.bodyGroups=body.groups;
}
