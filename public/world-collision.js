// Original static collision extents with a browser movement resolver.
// FUN10076290 param18 -> virtual90(3), FUN1001d4f0 collision mode;
// FUN10061590 point bounds/type3 thickness, FUN10061390 ID5/7 extensions,
// FUN10062000 five foyer wall rectangles. The new resolver uses substeps.
import {rotate,panelPoints} from './scene-geometry.js';
function bounds(points){return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[2])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[2]))];}
export function panelBounds(panel){
  const points=panelPoints(panel);
  const rect=bounds(points);
  if(Math.abs(rect[0]-rect[2])<=.001){rect[0]-=10;rect[2]+=10;}
  else if(Math.abs(rect[1]-rect[3])<=.001){rect[1]-=10;rect[3]+=10;}
  return rect;
}
function cornerInside(x,z,r){return x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3];}
export function nativeRectangleOverlap(a,b){
  // FUN100b0950/FUN100b0c50 checks all four corners in both directions,
  // including boundaries. Preserve that test for the recovered rectangles.
  return [[a,b],[b,a]].some(([p,q])=>cornerInside(p[0],p[1],q)||cornerInside(p[0],p[3],q)||cornerInside(p[2],p[1],q)||cornerInside(p[2],p[3],q));
}
export class WorldCollision {
  constructor(scene,actors=[]){
    this.actors=actors;this.static=[];this.disabled=new Set();
    for(const panel of scene.panels){
      if(!panel.initiallyVisible||!panel.flag18)continue;
      const rect=panelBounds(panel),rects=[];
      if(['FY_leftwall1','FY_rightwall1'].includes(panel.name)){
        for(let i=0;i<5;i++)rects.push([rect[0]+(rect[2]-rect[0])*.2*i,rect[1]+(rect[3]-rect[1])*(.8-.2*i),rect[0]+(rect[2]-rect[0])*.2*(i+1),rect[1]+(rect[3]-rect[1])*(1-.2*i)]);
      }else rects.push(rect);
      this.static.push({name:panel.name,id:panel.id,rects});
    }
    for(const object of scene.furniture){
      const rect=bounds(object.points.map(p=>rotate(p,object.rotation).map((v,i)=>v+object.position[i])));
      if(object.id===5)rect[0]-=15;if(object.id===7)rect[2]+=15;
      this.static.push({name:object.name,id:object.id,rects:[rect]});
    }
  }
  blockers(x,z,radius=10,ignoreActor=null){
    const box=[x-radius,z-radius,x+radius,z+radius],found=[];
    if(box[0]<=-645||box[1]<=-645||box[2]>=630||box[3]>=630)found.push('world boundary');
    for(const object of this.static)if(!this.disabled.has(object.name)&&object.rects.some(rect=>nativeRectangleOverlap(box,rect)))found.push(object.name);
    for(const actor of this.actors){
      if(!actor.visible||actor===ignoreActor)continue;
      const [ax,,az]=actor.position;
      if(nativeRectangleOverlap(box,[ax-10,az-10,ax+10,az+10]))found.push(actor.model.name);
    }
    return found;
  }
  move(camera,dx,dz){
    if(!Number.isFinite(dx)||!Number.isFinite(dz))throw Error('Invalid movement');
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/2));if(steps>1000)throw Error('Movement exceeds controller step limit');
    const sx=dx/steps,sz=dz/steps;
    for(let i=0;i<steps;i++){
      if(this.blockers(camera.x+sx,camera.z+sz).length===0){camera.x+=sx;camera.z+=sz;continue;}
      // Resolve each component independently so moving along a wall still works.
      if(this.blockers(camera.x+sx,camera.z).length===0)camera.x+=sx;
      if(this.blockers(camera.x,camera.z+sz).length===0)camera.z+=sz;
    }
  }
}
