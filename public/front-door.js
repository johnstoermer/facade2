// Shipped front-door geometry/picking and angle controller, on a new 30Hz
// browser clock. See opening-evidence.txt for source locations and limits.
const f=Math.fround;
export class FrontDoor {
  constructor(panel,world,{now=performance.now(),onEvent=()=>{}}={}){
    if(panel.id!==47||panel.rotationAnchor!==1||panel.objectRotation?.[1]!==30)throw Error('Original door setup missing');
    this.panel=panel;this.world=world;this.onEvent=onEvent;this.created=now;
    this.motion=null;this.lastKnock=now-2000;this.events=[];
  }
  get angle(){return this.panel.objectRotation[1];}
  get opened(){return this.angle!==30;}
  get percentOpen(){return Math.max(0,Math.min(100,(30-this.angle)/95*100));}
  emit(type){const event={type,angle:this.angle};this.events.push(event);if(this.events.length>32)this.events.shift();this.onEvent(event);}
  collision(enabled){for(const name of ['front door','FD_leftpanel','FD_rightpanel'])this.world.disabled[enabled?'delete':'add'](name);}
  reset(now=performance.now()){
    this.panel.objectRotation[1]=30;this.motion=null;this.created=now;this.lastKnock=now-2000;this.collision(true);
  }
  swing(open,now=performance.now(),speed=1){
    if(!Number.isFinite(speed)||speed<=0)throw Error('Invalid door speed');
    const target=open?-65:30,from=this.angle;
    if(target===from)return false;
    const ticks=Math.max(1,Math.trunc(Math.abs(target-from)/(speed*2)));
    this.motion={from,target,ticks,started:now};
    // Native opening clears these three collision entries at motion start.
    if(open)this.collision(false);
    this.emit(open?'open':'close');return true;
  }
  update(now){
    if(!this.motion)return;
    const {from,target,ticks,started}=this.motion,tick=Math.max(0,Math.floor((now-started)*30/1000));
    // FUN1004edd0 mode1 stores each intermediate in float32. It snaps to
    // the exact target at completion, avoiding a permanently closed gap.
    const progress=f(tick/ticks),angle=f(f(progress*3.1415)/2),ease=f(Math.sin(angle));
    this.panel.objectRotation[1]=tick>=ticks?target:f(from+f(f(target-from)*ease));
    if(tick>=ticks){this.motion=null;if(target===30)this.collision(true);this.emit(target===30?'closed':'opened');}
  }
  hit(camera,clientX,clientY){
    if(![clientX,clientY].every(Number.isFinite))return false;
    const p=this.panel.position,r=camera.yaw*.017452778,c=Math.cos(r),s=Math.sin(r);
    let x=p[0]-camera.x,y=p[1]-camera.y,z=p[2]-camera.z;
    const depth=-s*x+c*z;
    // Original test keeps the unadjusted center depth, even when open.
    if(depth< -105||depth> -5)return false;
    const scale=100/-depth,hx=Math.trunc((clientX-508)/5),hy=-Math.trunc((clientY-370)/5)-28;
    if(this.opened){x-=30;z-=30;}
    const d=Math.max(.1,s*x-c*z),px=(c*x+s*z)*125/d,py=y*125/d;
    return hx>=px-36*scale&&hx<=px+36*scale&&hy>=py-78*scale&&hy<=py+78*scale;
  }
  activate(camera,clientX,clientY,now=performance.now()){
    if(!this.hit(camera,clientX,clientY))return 'miss';
    if(this.motion||now-this.lastKnock<2000)return 'busy';
    if(!this.opened&&camera.x< -150&&camera.z>140){this.lastKnock=now;this.emit('knock');return 'knock';}
    this.swing(!this.opened,now);return this.opened?'close':'open';
  }
}
