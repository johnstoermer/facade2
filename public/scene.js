// Original-data scene renderer: private development slice, not full gameplay.
// Geometry/placement/palette: assets/scene.json records original native inputs.
// Projection: FUN_1008fee0 and FUN_100ae610. Original texturing is affine
// because the native engine projects vertices before submitting them to GL.
import {loadCharacters,renderCharacter,setFrame} from './character-scene.js';
import {SpeechAudio} from './speech-audio.js';
import {loadHeadData,renderHead} from './head-tools/head-renderer.js';
import {playMotion,stopMotion} from './character-motion.js';
import {WorldCollision} from './world-collision.js';
import {SpeechFace} from './head-tools/speech-face.js';
import {rotate,panelPoints} from './scene-geometry.js';
import {FrontDoor} from './front-door.js';
import {ApartmentOpening} from './apartment-opening.js';
import {GameUi} from './game-ui.js';
import {BrowserConversation} from './browser-conversation.js';
import {CharacterActions} from './character-actions.js';
import {propIds} from './character-action-protocol.js';
const canvas = document.querySelector('#game');
const status = document.querySelector('#status');
const gl = canvas.getContext('webgl2', {alpha:false, antialias:false, depth:true, preserveDrawingBuffer:false});
const state = {ready:false, error:null, frames:0, frameTimes:[], camera:{x:-32,y:97,z:-111,yaw:24}, keys:new Set(), draws:0,primitives:0};
window.facadeScene = state;
const nativeRad = 0.017452778;

function shader(type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
  return shader;
}
function program(vs,fs) {
  const p=gl.createProgram(); gl.attachShader(p,shader(gl.VERTEX_SHADER,vs)); gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)); return p;
}
function eye(point) {
  const x=point[0]-state.camera.x,y=point[1]-state.camera.y,z=point[2]-state.camera.z;
  const s=Math.sin(state.camera.yaw*nativeRad),c=Math.cos(state.camera.yaw*nativeRad);
  return [c*x+s*z,y,-s*x+c*z];
}
function projected([x,y,z]) {
  const d=Math.max(.1,-z); return [x*1.25/d,y*1.25/d,-z/1000-1];
}
// Development slice near-plane clipping. Exact native partially clipped panel
// behavior remains a fidelity task, and is not claimed by this preview.
function clipNear(vertices) {
  let out=[];
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length],ai=a[2]<=-.1,bi=b[2]<=-.1;
    if(ai) out.push(a);
    if(ai!==bi) { const t=(-.1-a[2])/(b[2]-a[2]); out.push(a.map((v,j)=>v+(b[j]-v)*t)); }
  }
  return out;
}
function decodeBMP(buffer,alphaMask) {
  const v=new DataView(buffer);
  if(v.getUint16(0,true)!==0x4d42 || v.getUint32(14,true)<40 || v.getUint16(26,true)!==1 || v.getUint16(28,true)!==24 || v.getUint32(30,true)!==0) throw Error('Unsupported original BMP format');
  const width=v.getInt32(18,true),height=v.getInt32(22,true),offset=v.getUint32(10,true);
  if(width<=0||height<=0||width>2048||height>2048) throw Error('Unexpected BMP extent');
  const stride=(width*3+3)&~3;
  if(offset+stride*height>buffer.byteLength) throw Error('Truncated texture');
  const src=new Uint8Array(buffer),dst=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const a=offset+y*stride+x*3,b=(y*width+x)*4;
    dst[b]=src[a+2];dst[b+1]=src[a+1];dst[b+2]=src[a];
    // FUN_100a8d2d passes the strip's alpha-test flag into FUN_100a9670.
    // Only those textures get average-RGB alpha; other textures stay opaque.
    dst[b+3]=alphaMask?Math.floor((src[a]+src[a+1]+src[a+2])/3):255;
  }
  return {width,height,data:dst};
}
async function boot() {
  if(!gl) throw Error('WebGL 2 is required');
  const response=await fetch('./assets/scene.json'); if(!response.ok) throw Error('Scene data unavailable');
  const data=await response.json();
  const parameters=new URL(location.href).searchParams,openingMode=parameters.has('play')||!parameters.has('scene')&&!parameters.has('characters');
  // Diagnostic modes remain explicit; the normal URL opens the playable slice.
  const characters=parameters.has('characters')||openingMode?await loadCharacters():[];
  if(characters.length){const heads=await loadHeadData();for(const actor of characters)actor.headData=heads[actor.model.name];}
  const palette=new Map(data.palette.map(v=>[v.id,v]));
  const strips=new Map(data.filmstrips.map(v=>[v.id,v]));
  // Original empty/full wine frames; internal aliases select a filmstrip frame
  // without replacing any source artwork or changing initial scene textures.
  for(const [id,stripId,frame] of [[7000,7,0],[7004,7,4],[8004,8,4]]){const strip=strips.get(stripId);strips.set(id,{...strip,id,files:[strip.files[frame]]});}
  const textureCache=new Map();
  const wanted=new Map();
  function want(id){const strip=strips.get(id),name=strip.files[0];if(wanted.has(name)&&wanted.get(name)!==strip.alphaTest)throw Error('Texture alpha mode conflict: '+name);wanted.set(name,strip.alphaTest);}
  for(const panel of data.panels)if(panel.initiallyVisible&&panel.texture>=0)want(panel.texture);
  for(const obj of data.furniture) for(const face of obj.faces) if(face[14]>=0) want(face[14]);
  want(46); // Original city panorama, separately drawn by FUN_100632b0.
  if(openingMode)for(const id of [7000,7004,8004])want(id);
  if(openingMode){want(40);want(41);} // Original yellow typed-input atlases.
  await Promise.all([...wanted].map(async ([name,alphaMask])=>{
    const res=await fetch('./assets/textures/'+encodeURIComponent(name)); if(!res.ok) throw Error('Missing texture '+name);
    const bmp=decodeBMP(await res.arrayBuffer(),alphaMask);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bmp.width,bmp.height,0,gl.RGBA,gl.UNSIGNED_BYTE,bmp.data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    // The original loader passes GL_LINEAR as the wrap parameter, which GL
    // rejects. Its resulting texture wrap remains the GL default REPEAT.
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    textureCache.set(name,texture);
  }));
  const fill=program(`#version 300 es
    in vec3 position; in vec2 uv; in vec4 tint; out vec2 texcoord; flat out vec4 vertexColor;
    void main(){gl_Position=vec4(position,1.0);texcoord=uv;vertexColor=tint;}`,
    `#version 300 es
    precision highp float; in vec2 texcoord; flat in vec4 vertexColor; uniform sampler2D texture0; uniform bool textured; uniform bool cutout; out vec4 result;
    void main(){result=vertexColor*(textured?texture(texture0,texcoord):vec4(1)); if(cutout&&result.a==1.0)discard;}`);
  const locations=Object.fromEntries(['texture0','textured','cutout'].map(n=>[n,gl.getUniformLocation(fill,n)]));
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.enableVertexAttribArray(gl.getAttribLocation(fill,'position'));gl.vertexAttribPointer(gl.getAttribLocation(fill,'position'),3,gl.FLOAT,false,36,0);
  gl.enableVertexAttribArray(gl.getAttribLocation(fill,'uv'));gl.vertexAttribPointer(gl.getAttribLocation(fill,'uv'),2,gl.FLOAT,false,36,12);
  gl.enableVertexAttribArray(gl.getAttribLocation(fill,'tint'));gl.vertexAttribPointer(gl.getAttribLocation(fill,'tint'),4,gl.FLOAT,false,36,20);
  gl.useProgram(fill);gl.uniform1i(locations.texture0,0);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  const white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  function colorAt(index) {return palette.get(index)??palette.get(0);}
  let batch=new Float32Array(65536),used=0,batchTexture=null,batchCutout=false;
  function flush(){
    if(!used)return;
    gl.uniform1i(locations.textured,!!batchTexture);gl.uniform1i(locations.cutout,batchCutout);
    if(batchCutout)gl.disable(gl.BLEND);else gl.enable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D,batchTexture??white);
    gl.bufferData(gl.ARRAY_BUFFER,batch.subarray(0,used),gl.STREAM_DRAW);gl.drawArrays(gl.TRIANGLES,0,used/9);
    state.draws++;used=0;
  }
  function draw(vertices,index,texture=-1) {
    if(vertices.length<3||index===38)return;
    const material=colorAt(index),strip=strips.get(texture);
    const tex=strip?textureCache.get(strip.files[0]):null,cutout=!!strip?.alphaTest;
    if(tex!==batchTexture||cutout!==batchCutout){flush();batchTexture=tex;batchCutout=cutout;}
    const required=used+(vertices.length-2)*27;
    if(required>batch.length){let size=batch.length;while(size<required)size*=2;const larger=new Float32Array(size);larger.set(batch.subarray(0,used));batch=larger;}
    // Preserve primitive/depth/blend ordering. Only adjacent compatible work is
    // combined. Flat color is constant per triangle, matching the old uniform.
    for(let i=1;i<vertices.length-1;i++)for(const vertex of [vertices[0],vertices[i],vertices[i+1]]){
      for(let j=0;j<5;j++)batch[used++]=vertex[j];
      for(let j=0;j<3;j++)batch[used++]=material.rgb[j];batch[used++]=material.alpha;
    }
    state.primitives++;
  }
  const screenSink={
    polygon(vertices,color){if(vertices.every(p=>p[2]>0))return;draw(vertices.map(p=>[p[0]/100,p[1]/100,-p[2]/1000-1,0,0]),color);},
    line(a,b,color,pixels){
      if(pixels<=0||color<0||color===38||a[2]>0&&b[2]>0)return;
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)return;
      const ox=-dy/length*pixels*100/1016,oy=dx/length*pixels*100/1016;
      this.polygon([[a[0]+ox,a[1]+oy,a[2]],[a[0]-ox,a[1]-oy,a[2]],[b[0]-ox,b[1]-oy,b[2]],[b[0]+ox,b[1]+oy,b[2]]],color);
    }
  };
  function face(points,row,styles) {
    const coordinates=points.map(eye),ids=row.slice(0,4);
    if(ids.every(i=>coordinates[i][2]>-.1))return;
    const strip=strips.get(row[14]);
    let u=1,v0=0;
    if(strip){const m=strip.nativeMetadata;u=m['-0x1c']/m['-0x14'];v0=1-m['-0x20']/m['-0x18'];}
    const uv=[[0,v0],[u,v0],[u,1],[0,1]];
    const poly=clipNear(ids.map((idx,k)=>[...coordinates[idx],...uv[k]]));
    const fillColor=row[5]===-1?styles[ids[0]][1]:row[5];
    draw(poly.map(v=>[...projected(v),v[3],v[4]]),fillColor,row[14]);
    for(let edge=0;edge<4;edge++) {
      const ci=row[6+edge],width=row[10+edge];if(ci<0||ci===38||width<=0)continue;
      let a=coordinates[ids[edge]],b=coordinates[ids[(edge+1)%4]];
      if(a[2]>-.1&&b[2]>-.1)continue;
      if((a[2]>-.1)!==(b[2]>-.1)){const t=(-.1-a[2])/(b[2]-a[2]);const c=a.map((v,i)=>v+t*(b[i]-v));if(a[2]>-.1)a=c;else b=c;}
      const p=projected(a),q=projected(b),bias=row[4]===2?.2:.05;p[2]-=bias/1000;q[2]-=bias/1000;
      // Wide line coverage is a provisional triangle expansion. Native
      // aliased line endpoint/diamond rules still require matched tests.
      const pixels=width*.125+.5,dx=(q[0]-p[0])*508,dy=(q[1]-p[1])*508,len=Math.hypot(dx,dy);
      if(!len)continue; const ox=-dy/len*pixels/1016,oy=dx/len*pixels/1016;
      draw([[p[0]+ox,p[1]+oy,p[2],0,0],[p[0]-ox,p[1]-oy,p[2],0,0],[q[0]-ox,q[1]-oy,q[2],0,0],[q[0]+ox,q[1]+oy,q[2],0,0]],ci);
    }
  }
  const meshes=data.furniture.map(o=>({...o,world:o.points.map(p=>rotate(p,o.rotation).map((v,i)=>v+o.position[i]))}));
  const panels=data.panels.filter(o=>o.initiallyVisible);
  const panelStyles=Array.from({length:4},()=>[1,7,-1,-1,-1,1,1]);
  const last={t:performance.now()};
  state.setCamera=(camera)=>Object.assign(state.camera,camera);
  state.reset=()=>Object.assign(state.camera,{x:-32,y:97,z:-111,yaw:24});
  state.sample=()=>({ready:state.ready,frames:state.frames,draws:state.draws,primitives:state.primitives,camera:{...state.camera},frameTimes:state.frameTimes.slice(),glError:gl.getError()});
  state.actors=characters;
  state.world=new WorldCollision(data,characters);
  state.move=(dx,dz)=>state.world.move(state.camera,dx,dz);
  state.audio=await SpeechAudio.load();
  state.door=new FrontDoor(panels.find(p=>p.id===47),state.world,{onEvent:event=>state.opening?.onDoor(event)});
  state.speech=null;state.speechCues=[];
  const rememberCues=face=>{state.speechCues.push(...face.takeCues());if(state.speechCues.length>100)state.speechCues.splice(0,state.speechCues.length-100);};
  const voiceButton=document.querySelector('#voice');
  let nextVoice=0;
  state.audio.onchange=()=>{
    state.conversation?.originalAudioChanged();
    const busy=['loading','playing'].includes(state.audio.status);
    if(!openingMode){voiceButton.textContent=busy?'Stop voice':'Play voice';voiceButton.setAttribute('aria-pressed',String(busy));}
    if(state.audio.status==='playing'){
      const line=state.audio.line,actor=characters.find(a=>a.model.name===line.actor);
      if(actor){
        const face=new SpeechFace(actor.headData).start(line.rawSpeechGroups,{actor:line.actor,script:line.script});
        state.speech={actor,face};face.sample(0);face.apply(actor);rememberCues(face);
      }
    }else if(state.speech){
      state.speech.face.stop();state.speech.face.apply(state.speech.actor);rememberCues(state.speech.face);state.speech=null;
    }
  };
  voiceButton.disabled=false;
  const nameButtons=[document.querySelector('#previous-name'),document.querySelector('#next-name')];
  const nameLabel=()=>{status.textContent=state.ui.label;voiceButton.textContent=state.ui.page?'Back':'Start';voiceButton.setAttribute('aria-label',state.ui.page?'Back to names':'Start as '+state.ui.label);for(const button of nameButtons)button.hidden=!!state.ui.page;};
  voiceButton.onclick=async()=>{
    if(openingMode){
      if(state.launching)return;
      if(state.ui.page){state.ui.back();nameLabel();return;}
      const player=state.ui.name.frame.record,epoch=state.opening.generation;
      state.launching=true;voiceButton.disabled=true;
      state.audio.unlock().catch(()=>{});state.conversation.speech.voice.unlock().catch(()=>{});
      try{
        if(await state.conversation.preparation.prepare(player)&&epoch===state.opening.generation&&await state.opening.start(player)){
          state.ui.confirm();voiceButton.hidden=true;for(const button of nameButtons)button.hidden=true;document.body.classList.add('playing');canvas.focus();
        }
      }catch(error){status.textContent=error.message;}
      finally{state.launching=false;voiceButton.disabled=false;}
      return;
    }
    if(['loading','playing'].includes(state.audio.status)){state.audio.stop();return;}
    const [actor,script]=[['trip',1069],['grace',964]][nextVoice++%2];
    try{await state.audio.play(actor,script);}catch(error){status.textContent=error.message;}
  };
  state.setPose=(name,frame)=>{const actor=characters.find(a=>a.model.name===name);if(!actor)throw Error('Unknown actor');actor.playback=null;stopMotion(actor);setFrame(actor,frame);};
  state.playMotion=(name,script,options)=>{const actor=characters.find(a=>a.model.name===name);if(!actor)throw Error('Unknown actor');return playMotion(actor,script,options);};
  state.stopMotion=(name,layer)=>{const actor=characters.find(a=>a.model.name===name);if(!actor)throw Error('Unknown actor');stopMotion(actor,layer);};
  state.playPoseClip=(name,clipName,rate=30)=>{
    const actor=characters.find(a=>a.model.name===name),clip=actor?.meta.clips.find(c=>c.name===clipName);
    if(!actor||!clip||!Number.isFinite(rate)||rate<=0||rate>120)throw Error('Invalid pose preview clip/rate');
    stopMotion(actor);
    actor.playback={clip,rate,started:performance.now()};
  };
  if(openingMode){
    await state.audio.loadEffects();
    // Original StoryIntro behavior9170 teleports here before opening the
    // name menu. See ui-tools/hallway-spawn-review.txt (source + javap).
    state.opening=new ApartmentOpening(state,state.door,{spawn:{x:-287,y:97,z:309,yaw:30},onStatus:text=>{status.textContent=text;}});
    state.behavior=new CharacterActions(state,panels);
    state.ui=await GameUi.load(document.querySelector('#ui'));
    state.conversation=await BrowserConversation.load(state);
    voiceButton.textContent='Start';voiceButton.removeAttribute('aria-pressed');
    nameLabel();for(const [i,button] of nameButtons.entries()){button.hidden=false;button.onclick=()=>{state.ui.name.cooldown=0;state.ui.step(i?{right:true}:{left:true});nameLabel();};}
    document.querySelector('#reset').textContent='Restart';
    document.title='Facade 2';
    canvas.setAttribute('aria-label','Facade 2. W and S walk forward and backward. A and D turn left and right. Arrow keys also work. Enter opens typing. Click the front door to knock.');
  }
  document.querySelector('#reset').onclick=()=>{if(state.opening){state.conversation?.reset();state.opening.reset();state.ui.reset();nameLabel();voiceButton.hidden=false;for(const button of nameButtons)button.hidden=false;document.body.classList.remove('playing');state.conversation?.controls();}else state.reset();canvas.focus();};
  for(const button of document.querySelectorAll('#movement button')){
    button.addEventListener('pointerdown',event=>{if(!state.opening?.started)return;event.preventDefault();button.setPointerCapture(event.pointerId);state.keys.add(button.dataset.key);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>state.keys.delete(button.dataset.key));
  }
  const pointerCoordinates=event=>{const rect=canvas.getBoundingClientRect();return[(event.clientX-rect.left)*1016/rect.width,(event.clientY-rect.top)*734/rect.height];};
  canvas.addEventListener('pointermove',event=>{if(state.ui?.active)canvas.style.cursor=state.ui.pointer(...pointerCoordinates(event))?'pointer':'default';});
  canvas.addEventListener('pointerdown',event=>{
    const [x,y]=pointerCoordinates(event);
    if(state.ui?.active){state.ui.pointer(x,y,true);nameLabel();return;}
    if(!state.opening?.started)return;
    canvas.focus();
    const action=state.door.activate(state.camera,x,y);
    if(action!=='miss'){if(['open','close','knock'].includes(action)&&state.opening.stage==='apartment')state.behavior.emit('player',action+'_door','The guest interacted with the front door.');return;}
    const sx=x/5.08-100,sy=(734-y)/5.08-100;
    if(state.opening.stage==='apartment'){
      const hit=state.behavior.objects.filter(o=>!o.heldBy&&Math.hypot(o.panel.position[0]-state.camera.x,o.panel.position[2]-state.camera.z)<165).map(o=>({o,points:panelPoints(o.panel,state.camera.yaw).map(eye)})).filter(({points})=>points.every(p=>p[2]<-.1)).map(({o,points})=>({o,points:points.map(p=>[p[0]*125/-p[2],p[1]*125/-p[2]]),distance:Math.hypot(o.panel.position[0]-state.camera.x,o.panel.position[2]-state.camera.z)})).filter(({points})=>sx>=Math.min(...points.map(p=>p[0]))&&sx<=Math.max(...points.map(p=>p[0]))&&sy>=Math.min(...points.map(p=>p[1]))&&sy<=Math.max(...points.map(p=>p[1]))).sort((a,b)=>a.distance-b.distance)[0];
      if(hit){state.behavior.playerAction(propIds.includes(hit.o.id)?'pick_up':'inspect',hit.o.id);return;}
    }
    let hitActor=false;
    for(const actor of characters){
      if(!actor.rendered||Math.hypot(actor.position[0]-state.camera.x,actor.position[2]-state.camera.z)>160)continue;
      const points=[...actor.rendered.points,...actor.renderedHead?.points??[]];
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      if(sx>=Math.min(...xs)&&sx<=Math.max(...xs)&&sy>=Math.min(...ys)&&sy<=Math.max(...ys)){
        hitActor=true;if(state.behavior?.held('player')){state.behavior.playerAction('give',actor.model.name==='trip'?'Trip':'Grace');break;}
        if(!state.conversation?.pending&&!state.conversation?.reply)state.opening.interact(actor).catch(error=>{status.textContent=error.message;});break;
      }
    }
    if(!hitActor&&state.behavior?.held('player'))state.behavior.playerAction('put_down');
  });
  const movementKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d']);
  const movementKey=event=>({KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d'}[event.code]??(event.key.length===1?event.key.toLowerCase():event.key));
  const clearKeys=()=>{state.keys.clear();state.ui?.keys.clear();};
  const editable=target=>target.isContentEditable||target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  window.addEventListener('keydown',event=>{
    if(document.querySelector('dialog[open]'))return;
    if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||editable(event.target))return;
    if(state.opening?.started&&event.target.closest?.('button,a'))return;
    if(state.conversation?.key(event)){event.preventDefault();return;}
    if(event.key==='Enter'&&state.opening&&!state.opening.started){voiceButton.click();event.preventDefault();return;}
    if(state.ui?.key(event.key,true)){nameLabel();event.preventDefault();return;}
    if(state.opening&&!state.opening.started)return;
    const key=movementKey(event);
    if(movementKeys.has(key)){state.keys.add(key);event.preventDefault();}
  });
  window.addEventListener('keyup',event=>{state.keys.delete(movementKey(event));state.ui?.key(event.key,false);});
  window.addEventListener('blur',clearKeys);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearKeys();});
  document.addEventListener('focusin',event=>{if(editable(event.target)||event.target.closest?.('button,a'))clearKeys();});
  function panel(p){
    const points=panelPoints(p,state.camera.yaw);
    const color=p.color<0?(p.color===-2?7:0):p.color;
    // Native constructor indices [4,1,2,3], with its unused center removed.
    face(points,[3,0,1,2,2,color,p.edgeColor,p.edgeColor,p.edgeColor,p.edgeColor,12,12,12,12,p.texture],panelStyles);
  }
  function skyline(){
    // FUN_100632b0: these vertices are already in the original orthographic
    // screen space. Glass uses the second scene pass after this background.
    const extent=-state.camera.z*.05+100;
    let yaw=((state.camera.yaw+180)%360+360)%360-180;
    yaw*=Math.max(2,Math.min(4,(state.camera.z+500)/50));
    for(const side of [-1,1]){
      const offset=-extent*(yaw/180+side),lo=(-extent+offset)/100,hi=(extent+offset)/100,e=extent/100;
      draw([[hi,-e,.3,0,0],[lo,-e,.3,1,0],[lo,e,.3,1,1],[hi,e,.3,0,1]],7,46);
    }
  }
  function render(t){
    const dt=Math.min(.1,(t-last.t)/1000);last.t=t;
    state.door.update(t);state.opening?.update(t,dt);
    state.behavior?.update(t);
    state.conversation?.update(t);
    if(state.keys.size&&(state.ui?.active||document.hidden||document.querySelector('dialog[open]')))state.keys.clear();
    const turn=Number(state.keys.has('ArrowRight')||state.keys.has('d'))-Number(state.keys.has('ArrowLeft')||state.keys.has('a'));
    const walk=Number(state.keys.has('ArrowUp')||state.keys.has('w'))-Number(state.keys.has('ArrowDown')||state.keys.has('s'));
    state.camera.yaw+=turn*65*dt;
    if(walk)state.move(Math.sin(state.camera.yaw*nativeRad)*walk*75*dt,-Math.cos(state.camera.yaw*nativeRad)*walk*75*dt);
    if(state.speech&&state.audio.status==='playing'){
      const seconds=Math.max(0,Math.min(state.audio.duration,state.audio.context.currentTime-state.audio.started));
      state.speech.face.sample(seconds*1000);state.speech.face.apply(state.speech.actor);rememberCues(state.speech.face);
    }
    // Match the original square viewport anchored at the bottom of a 1016x734
    // game surface, rather than changing FOV with CSS/window aspect ratio.
    gl.viewport(0,0,1016,1016);
    const menu=state.ui?.active;gl.clearColor(menu?0:.4,menu?0:.4,menu?0:.5,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);state.draws=0;state.primitives=0;
    // Native FUN1008be70 skips both scene passes during name entry.
    if(!menu){
      for(const obj of meshes)for(const row of obj.faces)face(obj.world,row,obj.pointStyle);
      for(const actor of characters){renderCharacter(actor,state.camera,eye,screenSink,t);renderHead(actor,state.camera,screenSink,t);}
      for(const p of panels)if(!p.latePass&&!state.behavior?.isHeld(p.id))panel(p);
      skyline();
      for(const p of panels)if(p.latePass&&!state.behavior?.isHeld(p.id))panel(p);
      // Original prop textures follow the recovered hand points50/66. This
      // attachment uses a camera-facing sprite; full native prop orientation
      // is still a fidelity task, not an identical-rendering claim.
      for(const object of state.behavior?.objects??[]){
        if(!object.heldBy)continue;const actor=state.behavior.actor(object.heldBy),p=object.panel;
        let center,scale;if(object.heldBy==='player'){center=[65,-65,-3];scale=1.6;}else{if(!actor?.rendered)continue;center=actor.rendered.points[object.hand==='left'?50:66];scale=actor.rendered.scale*2;}
        const [cx,cy,depth]=center,w=p.width*scale/2,h=p.height*scale/2;
        draw([[cx-w,cy-h,depth],[cx+w,cy-h,depth],[cx+w,cy+h,depth],[cx-w,cy+h,depth]].map((q,i)=>[q[0]/100,q[1]/100,-(q[2]+.03)/1000-1,...[[0,0],[1,0],[1,1],[0,1]][i]]),p.color<0?7:p.color,p.texture);
      }
      for(const quad of state.conversation?.plan.quads??[]){
        draw(quad.positions.map((p,i)=>[p[0]/100,(p[1]+(state.conversation?.typingYOffset??0))/100,-p[2]/1000-1,...quad.uvs[i]]),7,quad.stripId);
      }
    }
    flush();
    state.ui?.update(t,state);
    if(state.ui?.active&&status.textContent!==state.ui.label)nameLabel();
    state.frames++;state.frameTimes.push(t);if(state.frameTimes.length>600)state.frameTimes.shift();requestAnimationFrame(render);
  }
  state.ready=true;state.assetCounts={furniture:meshes.length,panels:panels.length,textures:textureCache.size,characterBodies:characters.length,characterHeads:characters.length};
  if(!openingMode)status.textContent='Scene preview';requestAnimationFrame(render);
}
boot().catch(error=>{state.error=error.message;status.textContent=error.message;console.error(error);});
