// Original-data head renderer. Native references and remaining gaps are in
// RENDERER.txt. No replacement face art, textures, or guessed mesh is used.
// All sink coordinates use the same native projected space as character-body.
const f = Math.fround;
const poseRad = Math.fround(.017452778);
const wrap = a => ((a % 360) + 360) % 360;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const lineWidth = x => x*.125+.5;
const round = x => Math.sign(x)*Math.floor(Math.abs(x)+.5);
const dataByName = new Map();
const circle = [];
for(let i=0,phase=0;i<20;i++,phase=f(phase+3.1415/10)) circle.push([f(Math.sin(phase)),f(Math.cos(phase))]);

async function bytes(url) {
  const r=await fetch(url);if(!r.ok)throw Error('Missing original head asset: '+url);
  return r.arrayBuffer();
}
async function digest(buffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
}
function validateData(d) {
  if(d.format!=='facade-head-data-v1'||d.pointCount!==232||d.viewPointCount!==225||d.views.length!==3)throw Error('Unsupported head data');
  for(const set of d.views){
    if(set.length!==10)throw Error('Missing original head view');
    for(const v of set)if(v.points.length!==225||v.points.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x))))throw Error('Invalid head point');
  }
  if(d.topology.styles.rows.length!==232||d.regions.values.length!==48||d.expressionGroups.length!==5)throw Error('Invalid head topology');
  for(const row of d.topology.faces.rows)if(row.slice(0,4).some(x=>x<0||x>=232))throw Error('Invalid original face index');
  return d;
}

export async function loadHeadData() {
  const base=new URL('./out/',import.meta.url);
  const manifest=JSON.parse(new TextDecoder().decode(await bytes(new URL('manifest.json',base))));
  if(manifest.format!=='facade-head-bundle-v1')throw Error('Unsupported original head bundle');
  const result={};
  for(const name of ['grace','trip']){
    const file=name+'.head.json',record=manifest.artifacts.find(a=>a.path===file);
    if(!record)throw Error('Missing head manifest entry');
    const buffer=await bytes(new URL(file,base));
    if(buffer.byteLength!==record.bytes||await digest(buffer)!==record.sha256)throw Error('Original head integrity mismatch');
    const d=validateData(JSON.parse(new TextDecoder().decode(buffer)));
    dataByName.set(name,d);result[name]=d;
  }
  return result;
}

function angles(actor,camera,state) {
  // FUN1008e429..1008e5cd: prefix[-3] is a head rotation vector. The
  // application may supply the already-composed native angles explicitly.
  const prefix=actor.rendered.rawPrefix?.[2]||[0,0,0];
  const relative=actor.rendered.relativeYaw+prefix[1];
  const t=f(wrap(relative)*poseRad),c=Math.cos(t),s=Math.sin(t);
  const yaw=wrap(state.relativeYaw??(relative+clamp(state.yaw??0,-65,65)));
  const pitch=clamp(state.pitch??(-c*prefix[0]-s*prefix[2]),-20,35);
  const facing=(90-Math.min(Math.abs(yaw-180),90))/90;
  const roll=wrap(state.roll??(c*prefix[2]+s*prefix[0]+clamp(state.rollOffset??0,-30,30)*facing-(camera.roll??0)));
  return {yaw,pitch,roll,viewAngle:wrap(yaw+180)};
}

function expressionPoints(data,state,viewAngle,pitch) {
  const views=data.views[0];
  let first=views.findIndex((v,i)=>viewAngle>=v.angle&&viewAngle<=(views[i+1]?.angle??360));
  if(first<0)throw Error('Head angle outside original views');
  const next=(first+1)%10;
  const t=(viewAngle-views[first].angle)/((views[first+1]?.angle??360)-views[first].angle);
  const blend=(set,i,axis)=>f(t*set[next].points[i][axis]+(1-t)*set[first].points[i][axis]);
  const points=Array.from({length:225},(_,i)=>[blend(views,i,0),blend(views,i,1),0]);
  if(pitch!==0){
    const set=data.views[pitch>0?1:2],mix=Math.abs(pitch/(pitch>0?35:-20));
    for(let i=0;i<225;i++)for(let a=0;a<2;a++)points[i][a]=f(mix*blend(set,i,a)+(1-mix)*points[i][a]);
  }
  let folded=viewAngle>180?viewAngle-180:viewAngle;if(folded>90)folded=180-folded;
  const xWeight=(90-folded)/90,used=[];
  data.expressionGroups.forEach((g,gi)=>{
    const selected=state.groups?.[gi]??g.initialSelection;
    const index=typeof selected==='number'?selected:(selected.index??0);
    const weight=typeof selected==='number'?1:(selected.weight??1);
    const entry=g.entries[index];
    if(!entry||!Number.isFinite(weight))throw Error('Head expression outside original group');
    // Explicit native transition buffers may override a selected shape. This
    // retains interrupted speech fades/per-point float stores from66ca0;
    // absent buffers leave the original neutral/static path unchanged.
    const current=state.groupDeltas?.[gi];
    if(current!==undefined&&(!Array.isArray(current)||current.length!==g.pointCount||current.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))))throw Error('Invalid head expression transition buffer');
    const delta=current===undefined?entry.points.map(p=>p.map(v=>f(v*weight))):current.map(p=>p.map(f));used.push(delta);
    for(let i=0;i<g.pointCount;i++){
      const p=points[g.targetStartPoint+i];p[0]=f(p[0]+xWeight*delta[i][0]);p[1]=f(p[1]+delta[i][1]);
    }
  });
  const r=data.regions.values,mouthShift=(used[2][13][1]+used[3][13][1])/2;
  for(const end of [r[1],r[3]])for(let i=end-4;i<=end;i++)points[i][1]=f(points[i][1]+mouthShift);
  // FUN1006f720: seven mouth/teeth points are generated, not stored in a view.
  const m=r[15],a=points[m],b=points[m+1],c=points[m+2],d=points[m+3],e=points[m+4],h=points[m+7];
  const left=[f((a[0]+b[0])/2),f((a[1]+b[1])/2),0],right=[f((d[0]+e[0])/2),f((d[1]+e[1])/2),0];
  const y1=f(c[1]-Math.abs((c[1]-h[1])/4)),y2=f(c[1]-Math.abs((c[1]-h[1])*7/20));
  points.push(left,[left[0],y1,0],[b[0],y2,0],[c[0],y2,0],[d[0],y2,0],[right[0],y1,0],right);
  return {points,first,next,mix:t};
}

function nativeDepth(i,r,yaw,base,front) {
  // FUN1006f4f0, before the common +.2 point-order bias.
  const between=(a,b)=>r[a]<=i&&i<=r[b];
  let z=(between(4,5)||between(43,44)||yaw<=90||yaw>=270)?base:front;
  if(between(15,16))z+=2;
  else if(between(17,18))z+=1;
  else if(between(19,20))z+=(yaw<=10||(yaw>=175&&yaw<=360))?1:-1;
  else if(between(21,22))z+=(yaw<185||yaw>350)?1:-1;
  return z+.2;
}

function projectHead(actor,data,local,orient) {
  const body=actor.rendered,r=data.regions.values;
  if(!body.originalDepths||!body.rings?.[8]||!body.rings?.[9])throw Error('Head requires original body depth and shoulder rings');
  const neck=body.points[30],base=Math.min(neck[2],body.points[8][2],body.points[9][2])-.2;
  const front=Math.max(neck[2],body.points[8][2],body.points[9][2])+.2;
  const size=f(1+25*(body.originalDepths[30]-body.originalDepths[actor.model.anchorPoint]));
  const scale=f(body.scale*size),pivot=local[r[10]],a=-orient.roll*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const points=local.map((p,i)=>{
    let x=p[0],y=p[1];
    if(i!==r[10]&&i!==r[4]+2&&i!==r[4]+5){const dx=x-pivot[0],dy=y-pivot[1];x=f(c*dx-s*dy+pivot[0]);y=f(s*dx+c*dy+pivot[1]);}
    return [f(x*5.08*scale+neck[0]),f((y*5.08+138)*scale+neck[1]),nativeDepth(i,r,orient.yaw,base,front)];
  });
  // Native special point replacement is performed during head's ordered draw.
  // Ring15/5 resolve exact offsets0x1b48/0x1ad0 from base0x1a94.
  const frontSide=orient.yaw<=90||orient.yaw>=270;
  const shoulderA=frontSide?8:9,shoulderB=frontSide?9:8;
  points[42]=[...body.rings[shoulderA][15],body.points[shoulderA][2]];
  points[45]=[...body.rings[shoulderB][5],body.points[shoulderB][2]];
  return {points,scale,base,front,size};
}

function primitives(points,sink) {
  const at=(i,z)=>[points[i][0],points[i][1],z??points[i][2]];
  const polygon=(ids,color,z)=>{if(color>=0&&color!==38)sink.polygon(ids.map(i=>typeof i==='number'?at(i,z):[i[0],i[1],z??i[2]]),color);};
  const line=(a,b,color,width,z)=>{if(color>=0&&color!==38&&width>0)sink.line(typeof a==='number'?at(a,z):[a[0],a[1],z??a[2]],typeof b==='number'?at(b,z):[b[0],b[1],z??b[2]],color,width);};
  const strip=(ids,color,width,z)=>{for(let i=1;i<ids.length;i++)line(ids[i-1],ids[i],color,width,z);};
  const disk=(x,y,z,radius,color,ratio=1,outline=-1,ow=0)=>{
    const ring=circle.map(([sx,sy])=>[x+sx*radius*ratio,y+sy*radius,z]);
    polygon([[x,y,z],...ring,ring[0]],color,z);if(outline>=0)strip([...ring,ring[0]],outline,ow,z);
  };
  return {at,polygon,line,strip,disk};
}

function chainIntersection(previous,next) {
  // FUN10018bd0 /1008b6c0: original miter intersections, including the native
  // near-angle snapping constants and finite segment bounds.
  let delta=((previous.theta-next.theta)%6.283+6.283)%6.283;
  if(delta>-.15915963&&delta<.15915963)delta=0;
  else if(delta>2.9823403&&delta<3.3006597)delta=3.1415;
  else if(delta>6.1238403&&delta<6.4421597)delta=6.283;
  if(delta===0||delta===1.57075)return null;
  const side=delta<1.57075?0:1,end=side===0?3:2;
  const a=previous.vertices[side],b=previous.vertices[end],c=next.vertices[side],d=next.vertices[end];
  let m=(a[1]-b[1])/(a[0]-b[0]);const n=(c[1]-d[1])/(c[0]-d[0]);
  const intercept=a[1]-m*a[0],intercept2=c[1]-n*c[0];if(m===n)m+=1;
  const x=(intercept2-intercept)/(m-n),y=m*x+intercept;
  const between=(v,p,q)=>v>=Math.min(p,q)&&v<=Math.max(p,q);
  if(!Number.isFinite(x)||!Number.isFinite(y)||!between(x,a[0],b[0])||!between(y,a[1],b[1])||!between(x,c[0],d[0])||!between(y,c[1],d[1]))return null;
  return {side,point:[x,y]};
}

function chainArc(ring,a,b,z,direction,shortest,draw,color,pixels) {
  // FUN1008b2c0 uses ring-segment bounding boxes; last matching segment wins.
  let ia=-1,ib=-1;
  for(let i=0;i<20;i++){
    const p=ring[i],q=ring[(i+1)%20];
    const contains=v=>v[0]>=Math.min(p[0],q[0])&&v[0]<=Math.max(p[0],q[0])&&v[1]>=Math.min(p[1],q[1])&&v[1]<=Math.max(p[1],q[1]);
    if(contains(a))ia=i;if(contains(b))ib=i;
  }
  if(ia<0||ib<0)return;
  const distance=Math.abs(ia-ib);
  if(distance<2||distance>17){draw.line(a,b,color,pixels,z);return;}
  if(shortest)direction=ia<ib?ib-ia>10:ia-ib<11;
  const stop=(ia+Number(!direction))%20;
  draw.line(a,ring[stop],color,pixels,z);draw.line(ring[ib],b,color,pixels,z);
  let i=ib;
  for(let guard=0;i!==stop&&guard<20;guard++){const next=(i+(direction?1:19))%20;draw.line(ring[i],ring[next],color,pixels,z);i=next;}
}

function drawTopology(data,points,scale,yaw,viewAngle,first,draw) {
  const r=data.regions.values,styles=data.topology.styles.rows.map(s=>s.slice());
  const visible=viewAngle<=90||viewAngle>=270;
  for(const [a,b] of [[r[15],r[16]],[r[17],r[18]]])for(let i=a;i<=b;i++)styles[i][6]=visible?0:2;
  if(visible){const delta=r[17]-r[15],z=points[0][2]+.1;for(let i=r[15];i<r[16];i++)draw.polygon([i,i+1,i+1+delta,i+delta],0,z);}
  // Native head order is0..231 (creator byte+60=0). Skin face mode0 chooses
  // its first point in that order; no body depth sorter is reused here.
  for(let i=0;i<232;i++){
    const style=styles[i],p=points[i],radius=style[0]*scale;
    if(radius>0&&round(style[6])===0){
      const ring=circle.map(([x,y])=>[p[0]+x*radius,p[1]+y*radius,p[2]]);
      draw.polygon([p,...ring,ring[0]],round(style[1]));
      let a=round(style[2]),b=round(style[3]);if(yaw>90&&yaw<270)[a,b]=[20-b,20-a];
      if(a>=0&&b<21&&a<b&&style[5]!==0)for(let k=a;k<b;k++)draw.line(ring[k%20],ring[(k+1)%20],round(style[4]),style[5]<0&&(k===a||k===b-1)?1:lineWidth(Math.abs(round(style[5]))),p[2]+.05);
    }
    for(const edge of data.topology.edges.rows){
      const [a,b,control,mode]=edge,later=mode===1||mode===3;
      if(i!==(later?Math.max(a,b):Math.min(a,b))||styles[a][6]===2||styles[b][6]===2)continue;
      const pa=points[a],pb=points[b],z=p[2]+(later?.05:-.05);
      if(mode===0||mode===1){
        const theta=Math.atan2(pa[1]-pb[1],pa[0]-pb[0])-1.57075,c=Math.cos(theta)*scale,s=Math.sin(theta)*scale;
        const ra=styles[a][0],rb=styles[b][0],q=[[pa[0]-c*ra,pa[1]-s*ra,z],[pa[0]+c*ra,pa[1]+s*ra,z],[pb[0]+c*rb,pb[1]+s*rb,z],[pb[0]-c*rb,pb[1]-s*rb,z]];
        draw.polygon(q,edge[4]<0?round(styles[a][1]):edge[4]);
        const widths=yaw>90&&yaw<270?[edge[7],edge[6]]:[edge[6],edge[7]];
        if(widths[0]>0)draw.line(q[0],q[3],edge[5],Math.trunc(lineWidth(widths[0])),z+.05);
        if(widths[1]>0)draw.line(q[1],q[2],edge[5],Math.trunc(lineWidth(widths[1])),z+.05);
      }else if(control<0)draw.line(a,b,edge[5],Math.trunc(lineWidth(edge[6])),z);
      else throw Error('Unexpected curved original head edge');
    }
    for(const original of data.topology.faces.rows){
      const face=original.slice(),ids=face.slice(0,4),mode=face[4];
      const chosen=mode===2?ids[0]:mode===1?Math.max(...ids):Math.min(...ids);
      if(i!==chosen||ids.some(p=>styles[p][6]===2))continue;
      // Native1006eb28 reads the lower horizontal view's z word as an integer
      // outline width, not a vertex coordinate or a palette value.
      face[13]=Math.trunc(data.views[0][first].points[face[0]][2]);
      face[11]=Math.trunc(data.views[0][first].points[face[1]][2]);
      draw.polygon(ids,face[5]<0?round(styles[ids[0]][1]):face[5],mode===2?undefined:p[2]);
      for(let k=0;k<4;k++)if(face[10+k]>0)draw.line(ids[k],ids[(k+1)%4],face[6+k],lineWidth(face[10+k]),p[2]+(mode===2?.2:.05));
    }
  }
  // Native chain stage fills all segments before trimming/drawing outlines.
  const chains=data.topology.groups.rows.map(row=>{
    const knots=Array.from({length:9},(_,i)=>row.slice(i*7,i*7+7)).filter(k=>k[0]>=0);
    const segments=[];
    for(let i=0;i<knots.length-1;i++){
      const a=knots[i],b=knots[i+1],hidden=styles[a[0]][6]>0||styles[b[0]][6]>0;
      const pa=points[a[0]],pb=points[b[0]],theta=Math.atan2(pa[1]-pb[1],pa[0]-pb[0])-1.57075;
      const c=Math.cos(theta)*scale,s=Math.sin(theta)*scale,ra=styles[a[0]][0],rb=styles[b[0]][0],z=a[6]===2?pb[2]:pa[2]+(a[6]===1?.2:-.2);
      const q=[[pa[0]-c*ra,pa[1]-s*ra,z],[pa[0]+c*ra,pa[1]+s*ra,z],[pb[0]+c*rb,pb[1]+s*rb,z],[pb[0]-c*rb,pb[1]-s*rb,z]];
      if(!hidden)draw.polygon(q,a[1]);let widths=[a[4],a[3]];if(yaw>90&&yaw<270)widths.reverse();
      segments.push({a,b,vertices:q,hidden,theta:theta+1.57075,widths:widths.map(w=>w===0?0:lineWidth(w))});
    }
    return segments;
  });
  const rings=points.map((p,i)=>circle.map(([x,y])=>[p[0]+x*styles[i][0]*scale,p[1]+y*styles[i][0]*scale]));
  for(const segments of chains){
    const joints=segments.slice(1).map((s,i)=>chainIntersection(segments[i],s));let previous=null;
    for(let i=0;i<segments.length;i++){
      const seg=segments[i],v=seg.vertices.map(p=>p.slice()),prior=joints[i-1],next=joints[i],color=seg.a[2];
      if(prior){v[prior.side][0]=prior.point[0];v[prior.side][1]=prior.point[1];}
      if(next){const end=next.side===0?3:2;v[end][0]=next.point[0];v[end][1]=next.point[1];}
      if(!seg.hidden&&color>=0&&color!==38){
        for(let side=0;side<2;side++){
          const w=seg.widths[side],a=v[side],b=v[side===0?3:2];draw.line(a,b,color,w,b[2]+.05);
          if(previous&&w>0){
            const prevEnd=previous.vertices[side===0?3:2];
            if(prior?.side===side)draw.line(prevEnd,a,color,w,b[2]+.05);
            else if(previous.widths[side]>0)chainArc(rings[seg.a[0]],prevEnd,a,prevEnd[2]+.05,false,true,draw,color,w);
          }
        }
        if(seg.a[6]===0){draw.line(v[0].map((x,j)=>(x+v[3][j])/2),v[1].map((x,j)=>(x+v[2][j])/2),color,seg.widths[0],v[0][2]+.05);draw.line(v[3],v[2],color,seg.widths[0],v[0][2]+.05);}
      }
      previous={...seg,vertices:v};
      if(i===segments.length-1&&seg.b[5]!==0&&!seg.hidden)chainArc(rings[seg.b[0]],v[3],v[2],v[3][2]+.05,true,false,draw,color,seg.widths[0]);
    }
  }
}

function drawDetails(actor,data,p,scale,orientation,state,draw,base) {
  // FUN1006fc30, with original indexed contours, palettes, and depth increments.
  const r=data.regions.values,grace=data.character==='grace',v=orientation.viewAngle,pitch=orientation.pitch;
  const skin=grace?1:35,seq=(a,b)=>Array.from({length:Math.max(0,b-a+1)},(_,i)=>a+i);
  const eyeDepth=Math.max(p[r[19]][2],p[r[21]][2]);
  let eyes=true,brows=true,nose=true,creases=true,z;
  for(let side=0;side<2;side++){
    z=eyeDepth+.3;let oval=1;
    const outline=r[side?2:0],eye=r[side?8:6],brow=r[side?13:11],noseStart=r[side?25:23];
    if(side===0){
      if(v<=90||v>=285){if(v>=45&&v<=90)oval=1-(v-45)/90;else if(v>=270&&v<=330)oval=1-(60-(v-270))/120;}
      else{eyes=false;brows=false;creases=false;if(grace||(v>130&&v<230))nose=false;}
    }else{
      if(v<=75||v>=270){if(v>=270&&v<=315)oval=1-(315-v)/90;else if(v>=30&&v<=90)oval=1-(v-30)/120;}
      else{eyes=false;brows=false;creases=false;if(grace||v<230)nose=false;}
    }
    draw.strip(seq(outline,outline+r[1]-r[0]),0,lineWidth(12),p[0][2]+.2);
    const ep=seq(eye,eye+11).map(i=>p[i].slice());
    const lids=clamp(state.eyelids?.[side]??.85,0,1),gaze=clamp(state.gaze?.[side]??.5,0,1),gazeY=clamp(state.gazeY??.5,0,1);
    let ix=0,iy=0;
    const upperL=[p[eye][0],p[eye+3][1]+scale],upperR=[p[eye+5][0],p[eye+3][1]+scale];
    const lowerL=[p[eye+6][0],p[eye+9][1]-scale],lowerR=[p[eye+11][0],p[eye+9][1]-scale];
    if(eyes){
      for(let k=0;k<6;k++)ep[k][1]=(p[eye+k][1]-p[eye+k+6][1])*lids+p[eye+k+6][1];
      ix=(p[eye+11][0]-p[eye][0])*gaze+p[eye][0];
      const top=(p[eye+2][1]+p[eye+3][1])/2,bottom=(p[eye+8][1]+p[eye+9][1])/2;iy=(bottom-top)*gazeY+top;
      for(let k=0;k<5;k++)draw.polygon([ep[k+6],ep[k],ep[k+1],ep[k+7]],7,z);
    }
    z+=.1;if(eyes)draw.disk(ix,iy,z,scale,grace?21:31,oval,0,lineWidth(10));
    z+=.1;if(eyes)draw.disk(ix,iy,z,scale*.6,0,oval);
    z+=.1;if(eyes)draw.disk(ix-scale*.45,iy+scale*.3,z,scale*.2,7);
    z+=.1;
    if(eyes){
      for(let k=0;k<3;k++)draw.polygon([upperL,ep[k],ep[k+1]],skin,z);
      for(let k=3;k<5;k++)draw.polygon([upperR,ep[k],ep[k+1]],skin,z);
      draw.polygon([upperL,upperR,ep[3]],skin,z);
      for(let k=6;k<9;k++)draw.polygon([lowerL,ep[k],ep[k+1]],skin,z);
      for(let k=9;k<11;k++)draw.polygon([lowerR,ep[k],ep[k+1]],skin,z);
      draw.polygon([lowerL,lowerR,ep[9]],skin,z);
    }
    z+=.1;
    if(eyes){
      for(let k=0;k<5;k++)draw.line(ep[k],ep[k+1],0,grace?[1,1,1.5,2,2.5][k]:1,z);
      for(let k=6;k<11;k++)draw.line(ep[k],ep[k+1],0,[1,1,1,1.25,1.5][k-6],z);
      draw.line(ep[5],ep[11],0,1.5,z);
      for(let k=grace?2:1;k<5;k++)draw.line([ep[k][0],ep[k][1]+scale*.25],[ep[k+1][0],ep[k+1][1]+scale*.25],8,.5,z);
      for(let k=7;k<10;k++)draw.line([ep[k][0],ep[k][1]-scale*(grace?.55:.8)],[ep[k+1][0],ep[k+1][1]-scale*(grace?.55:.8)],grace?25:32,.5,z);
      // Source mouth-side and chin crease strokes, all derived from original points.
      const dx=scale*(grace?.7:1.2),dy=scale*(grace?.6:1.3),small=scale*(grace?.2:.1),up=scale*(grace?0:.8),inset=scale*(grace?0:.3);
      if(v<=40||v>=270){const q=p[r[15]];draw.strip([[q[0]-dx+inset,q[1]+dy+up],[q[0]-dx-small,q[1]+up],[q[0]-dx,q[1]-dy+up]],25,.5,z);}
      if(v>=320||v<=90){const q=p[r[16]];draw.strip([[q[0]+dx-inset,q[1]+dy+up],[q[0]+dx+small,q[1]+up],[q[0]+dx,q[1]-dy+up]],25,.5,z);}
      if(v<=50||v>=310){
        const q=p[r[17]+Math.trunc((r[18]-r[17])/2)],a=scale*(grace?1.4:2),b=scale*(grace?.6:1),c=scale*.1;
        draw.strip([[q[0]-2*b,q[1]-a-2*c],[q[0]-b,q[1]-a-c],[q[0],q[1]-a],[q[0]+b,q[1]-a-c],[q[0]+2*b,q[1]-a-2*c]],22,.5,z);
        if(!grace)draw.strip([[q[0]+scale*.1,q[1]-scale*4.1],[q[0]+scale*.3,q[1]-scale*4.8],[q[0]+scale*.1,q[1]-scale*5.6]],22,.5,z);
      }
    }
    if(brows){
      draw.strip(seq(brow,brow+r[12]-r[11]),grace?24:29,grace?.5:1,z);
      for(let k=0;k<r[12]-r[11];k++)draw.line(brow+k,brow+k+1,grace?24:29,grace?[1.5,2.5,1.5,1,.5][k]:[3,4,3,3,2][k],z);
    }
    z+=.1;
    if(nose){
      if(side===0){const delta=r[25]-r[23];for(let i=r[23];i<r[24]-3;i++)draw.polygon([i,i+delta,i+1+delta,i+1],skin,z);}
      z+=.1;
      for(let k=0;k<r[24]-r[23];k++){
        if(k>=4&&k<=8&&v>90&&v<270)continue;
        if(side===0&&k<4&&v>0&&v<270)continue;
        if(side===1&&k<4&&(v<=(Math.abs(pitch)>=10?0:20)||v>90))continue;
        if(k===9)continue;
        if(k>=10&&(!creases||pitch>20||(side===0&&v>90&&v<=330)||(side===1&&v>30&&v<=270)))continue;
        let color=0,width=1;if(k<=2)color=23;else if(k===3)color=8;else if(k===6)width=1.25;else if(k===7)width=1.5;else if(k>=10){color=8;width=.5;}
        draw.line(noseStart+k,noseStart+k+1,color,width,z);
      }
    }
    z+=.1;
  }
  // Original character-specific hair strips and their angular visibility.
  const span=r[29]-r[27],half=(r[33]-r[31])/2;
  let start=0,end;
  if(!grace)end=v<=90||v>=270?2:-1;
  else if(v>130&&v<230)end=-1;
  else if(v>=90&&v<=130){start=3;end=5;}
  else if(v>=230&&v<=270)end=2;
  else end=5;
  const hair=grace?24:28;
  for(let i=r[27];i<r[27]-1+span;i++)draw.polygon([i,i+1,i+1+span,i+span],hair,z);
  for(let layer=start;layer<=end;layer++){
    const first=r[31]+layer*half*2;
    for(let i=first;i<first-1+half;i++)draw.polygon([i,i+half,i+1+half,i+1],hair,z);
  }
  z+=.1;
  for(let layer=start;layer<=end;layer++){
    const first=r[31]+layer*half*2,color=!grace&&layer===end?28:24;
    for(let i=first;i<first-1+half;i++){draw.line(i,i+1,color,1,z);draw.line(i+1+half,i+half,color,1,z);}
  }
  for(let i=r[27];i<r[27]-1+span;i++)draw.line(i,i+1,7,1,z);
  draw.strip([r[27],r[29],r[29]+1],7,1,z);draw.strip([r[28],r[30],r[30]-1],7,1,z);
  for(let i=r[29]+1;i<r[29]-2+span;i++)draw.line(i,i+1,hair,1,z);
  // Neck polygons connect the view to the actual body shoulder rings.
  const q=r[43],n=r[4];draw.polygon([q,q+2,q+3,q+1],skin,base);
  draw.polygon([q+1,q+3,n+3,n],skin,base);
  for(let i=n;i<n+2;i++)draw.polygon([i,i+3,i+4,i+1],skin,base);
  for(const [a,b] of [[q,q+1],[q+2,q+3],[q+1,n],[q+2,n+3],[n,n+1],[n+1,n+2],[n+3,n+4],[n+4,n+5]])draw.line(a,b,0,1.5,base+.1);
}

export function renderHead(actor,camera,sink,time) {
  if(actor.visible===false||!actor.rendered)return null;
  const name=actor.model.id===0?'grace':actor.model.id===1?'trip':String(actor.model.name).toLowerCase();
  const data=actor.headData||dataByName.get(name);if(!data)return null;
  const state=actor.head||{},orientation=angles(actor,camera,state);
  const local=expressionPoints(data,state,orientation.viewAngle,orientation.pitch);
  const projected=projectHead(actor,data,local.points,orientation),draw=primitives(projected.points,sink);
  drawTopology(data,projected.points,projected.scale,orientation.yaw,orientation.viewAngle,local.first,draw);
  drawDetails(actor,data,projected.points,projected.scale,orientation,state,draw,projected.base);
  actor.renderedHead={...projected,...orientation,viewFirst:local.first,viewNext:local.next,viewMix:local.mix,time,
    fidelity:'original-data-partial-renderer',limitations:['Autonomous blink/gaze and non-speech expression controller','Whole-frame visual comparison pending']};
  return actor.renderedHead;
}

// Pure-data seam for passive finite validation; does not create a renderer/UI.
export const headDataMath={validateData,expressionPoints,nativeDepth,angles,projectHead};
