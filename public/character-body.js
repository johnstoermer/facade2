// Original body drawing primitives. Coordinates here use the native GL scene
// space (-100..100), not world positions. The WebGL sink supplies rasterization.
// Source: FUN_1004e2a0, 100891b0, 10089f90, 100187d0, 10018bd0,
// 1008b2c0, 1008b6c0 and 10090e90 in the retained original DLL evidence.
const f=Math.fround;
const round=v=>Math.sign(v)*Math.floor(Math.abs(v)+.5);
const width=v=>v*.125+.5;
const normalized=v=>((v%360)+360)%360;
const angle=(a,b)=>Math.atan2(a[1]-b[1],a[0]-b[0]);
const circle=[];
let phase=0;
for(let i=0;i<20;i++,phase=f(phase+3.1415/10))circle.push([f(Math.sin(phase)),f(Math.cos(phase))]);
circle.push(circle[0]);

function nativeOrder(points){
  // First minimum keeps the first index; subsequent equal depths prefer the
  // last unused index (the original selection loop uses <=).
  let first=0;
  for(let i=1;i<points.length;i++)if(points[i][2]<points[first][2])first=i;
  return [first,...points.map((_,i)=>i).filter(i=>i!==first).sort((a,b)=>points[a][2]-points[b][2]||b-a)];
}

function strip(a,ra,b,rb,scale,z){
  const theta=angle(a,b)-1.57075,c=Math.cos(theta)*scale,s=Math.sin(theta)*scale;
  return [[a[0]-c*ra,a[1]-s*ra,z],[a[0]+c*ra,a[1]+s*ra,z],
          [b[0]+c*rb,b[1]+s*rb,z],[b[0]-c*rb,b[1]-s*rb,z]];
}

function ringArc(ring,a,b,z,direction,shortest,sink,color,pixels){
  // Original lookup uses each ring segment's bounding box, with last match
  // winning. This deliberately does not substitute nearest-angle snapping.
  let ia=-1,ib=-1;
  for(let i=0;i<20;i++){
    const p=ring[i],q=ring[(i+1)%20];
    const contains=v=>v[0]>=Math.min(p[0],q[0])&&v[0]<=Math.max(p[0],q[0])&&v[1]>=Math.min(p[1],q[1])&&v[1]<=Math.max(p[1],q[1]);
    if(contains(a))ia=i;if(contains(b))ib=i;
  }
  if(ia<0||ib<0)return;
  const line=(p,q)=>sink.line([p[0],p[1],z],[q[0],q[1],z],color,pixels);
  const distance=Math.abs(ia-ib);
  if(distance<2||distance>17){line(a,b);return;}
  if(shortest)direction=ia<ib?ib-ia>10:ia-ib<11;
  const stop=(ia+Number(!direction))%20;
  line(a,ring[stop]);line(ring[ib],b);
  let i=ib;
  for(let guard=0;i!==stop&&guard<20;guard++){
    const next=(i+(direction?1:19))%20;line(ring[i],ring[next]);i=next;
  }
}

function joinIntersection(previous,next){
  let delta=((previous.theta-next.theta)%6.283+6.283)%6.283;
  if(delta>-.15915963&&delta<.15915963)delta=0;
  else if(delta>2.9823403&&delta<3.3006597)delta=3.1415;
  else if(delta>6.1238403&&delta<6.4421597)delta=6.283;
  if(delta===0||delta===1.57075)return null;
  const left=delta<1.57075;
  const a=previous.vertices[left?0:1],b=previous.vertices[left?3:2],c=next.vertices[left?0:1],d=next.vertices[left?3:2];
  let m=(a[1]-b[1])/(a[0]-b[0]);const n=(c[1]-d[1])/(c[0]-d[0]);
  const intercept=a[1]-m*a[0],intercept2=c[1]-n*c[0];
  if(m===n)m+=1;
  const x=(intercept2-intercept)/(m-n),y=m*x+intercept;
  const between=(v,p,q)=>v>=Math.min(p,q)&&v<=Math.max(p,q);
  if(!Number.isFinite(x)||!Number.isFinite(y)||!between(x,a[0],b[0])||!between(y,a[1],b[1])||!between(x,c[0],d[0])||!between(y,c[1],d[1]))return null;
  return {side:left?0:1,point:[x,y]};
}

export function drawBody(model,projectedPoints,scale,baseDepth,relativeYaw,sink,anchorPoint=0){
  if(projectedPoints.length!==model.pointCount)throw Error('Body pose/topology mismatch');
  const styles=model.pointStyle,points=projectedPoints.map(p=>p.slice());
  const order=nativeOrder(points),rank=Array(points.length),radius=Array(points.length),rings=Array(points.length);
  const yaw=normalized(relativeYaw),back=yaw>90&&yaw<270;
  order.forEach((id,i)=>rank[id]=i);
  const anchorDepth=points[anchorPoint][2];
  for(let i=0;i<points.length;i++){
    radius[i]=styles[i][0]*(1+(points[i][2]-anchorDepth)*50);
    points[i][2]=baseDepth+.2*(rank[i]+1);
    rings[i]=circle.slice(0,20).map(([x,y])=>[points[i][0]+x*radius[i]*scale,points[i][1]+y*radius[i]*scale]);
  }
  const line=(a,b,color,pixels,bias=.05)=>{if(pixels>0&&color>=0&&color!==38)sink.line([a[0],a[1],a[2]+bias],[b[0],b[1],b[2]+bias],color,pixels);};
  for(const id of order){
    const p=points[id],style=styles[id];
    if(radius[id]>0&&round(style[6])===0){
      const ring=rings[id];
      if(round(style[1])!==38)sink.polygon([p,...ring.map(v=>[...v,p[2]]),[...ring[0],p[2]]],round(style[1]));
      let start=round(style[2]),end=round(style[3]);const color=round(style[4]),rawWidth=round(style[5]);
      if(start>=0&&start<end&&end<21&&rawWidth!==0&&color!==38){
        if(back)[start,end]=[20-end,20-start];
        for(let k=start;k<end;k++){
          const pixels=rawWidth<0&&(k===start||k===end-1)?1:width(Math.abs(rawWidth));
          line([...ring[k%20],p[2]],[...ring[(k+1)%20],p[2]],color,pixels);
        }
      }
    }
    for(const edge of model.edges){
      const [aId,bId,control,mode]=edge;
      if((id!==aId&&id!==bId)||styles[aId][6]===2||styles[bId][6]===2)continue;
      const later=mode===1||mode===3;
      const selected=later?(rank[aId]>rank[bId]?aId:bId):(rank[aId]<rank[bId]?aId:bId);
      if(selected!==id)continue;
      const lo=Math.min(aId,bId),hi=Math.max(aId,bId),a=points[lo],b=points[hi],z=p[2]+(later?.05:-.05);
      if(mode===0||mode===1){
        const polygon=strip(a,radius[lo],b,radius[hi],scale,z);
        sink.polygon(polygon,edge[4]<0?round(styles[aId][1]):edge[4]);
        let w1=edge[6],w2=edge[7];if(back)[w1,w2]=[w2,w1];
        line(polygon[0],polygon[3],edge[5],w1>0?Math.trunc(width(w1)):0);
        line(polygon[1],polygon[2],edge[5],w2>0?Math.trunc(width(w2)):0);
      }else{
        const pixels=edge[6]>0?Math.trunc(width(edge[6])):0;
        if(control<0)line([a[0],a[1],z],[b[0],b[1],z],edge[5],pixels,0);
        else{
          const c=points[control];let prev=a;
          for(let k=1;k<=10;k++){const t=k/10,s=1-t,q=[s*s*a[0]+2*s*t*c[0]+t*t*b[0],s*s*a[1]+2*s*t*c[1]+t*t*b[1],z];line([prev[0],prev[1],z],q,edge[5],pixels,0);prev=q;}
        }
      }
    }
  }
  // FUN_10018bd0 first fills every segment, then computes intersections and
  // draws trimmed outlines and the original twenty-segment circular joins.
  const chains=model.chains.map(row=>{
    const knots=Array.from({length:9},(_,i)=>row.slice(i*7,i*7+7)).filter(k=>k[0]>=0);
    const segments=[];
    for(let i=0;i<knots.length-1;i++){
      const a=knots[i],b=knots[i+1],pa=points[a[0]],pb=points[b[0]],mode=a[6];
      const z=mode===2?pb[2]:pa[2]+(mode===1?.2:-.2);
      const vertices=strip(pa,radius[a[0]],pb,radius[b[0]],scale,z);
      const hidden=styles[a[0]][6]>0||styles[b[0]][6]>0;
      if(!hidden)sink.polygon(vertices,a[1]);
      const widths=back?[a[3],a[4]]:[a[4],a[3]];
      segments.push({a,b,vertices,hidden,theta:angle(pa,pb),widths:widths.map(w=>w===0?0:width(w))});
    }
    return segments;
  });
  for(const segments of chains){
    const joints=segments.slice(1).map((s,i)=>joinIntersection(segments[i],s));
    let previous=null;
    for(let i=0;i<segments.length;i++){
      const seg=segments[i],v=seg.vertices.map(p=>p.slice()),prior=joints[i-1],next=joints[i],color=seg.a[2];
      if(prior){v[prior.side][0]=prior.point[0];v[prior.side][1]=prior.point[1];}
      if(next){const end=next.side===0?3:2;v[end][0]=next.point[0];v[end][1]=next.point[1];}
      if(!seg.hidden&&color>=0&&color!==38){
        for(let side=0;side<2;side++){
          const w=seg.widths[side],start=v[side],end=v[side===0?3:2];
          line(start,end,color,w);
          if(previous&&w>0){
            const prevEnd=previous.vertices[side===0?3:2];
            if(prior?.side===side)line([prevEnd[0],prevEnd[1],end[2]],start,color,w);
            else if(previous.widths[side]>0)ringArc(rings[seg.a[0]],prevEnd,start,prevEnd[2]+.05,false,true,sink,color,w);
          }
        }
        if(seg.a[6]===0){
          line(v[0].map((x,j)=>(x+v[3][j])/2),v[1].map((x,j)=>(x+v[2][j])/2),color,seg.widths[0]);
          line(v[3],v[2],color,seg.widths[0]);
        }
      }
      previous={...seg,vertices:v};
      if(i===segments.length-1&&seg.b[5]!==0&&!seg.hidden)ringArc(rings[seg.b[0]],v[3],v[2],v[3][2]+.05,true,false,sink,color,seg.widths[0]);
    }
  }
  return {points,rings,order,radius};
}
