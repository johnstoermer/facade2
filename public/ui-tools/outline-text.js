// Original WGL text layout with separately pinned host Comic Sans outlines.
// Pure plans/path commands; no DOM, events, fonts, UI, or clock are installed.
const f=Math.fround;
const finite=(...values)=>values.every(Number.isFinite);
export function validateOutlineFont(font){
  if(font?.format!=='facade-host-outline-font-v1'||font.glyphs?.length!==255||font.metadata?.unitsPerEm<16)throw Error('Unsupported original-selected font bundle');
  font.glyphs.forEach((g,i)=>{if(g.code!==i||!finite(g.advanceX,g.advanceY)||!Array.isArray(g.contours))throw Error('Invalid glyph metric');});
  return font;
}
export async function loadOriginalUi(){
  const base=new URL('./out/',import.meta.url),r=await fetch(new URL('ui-manifest.json',base));if(!r.ok)throw Error('Original UI manifest unavailable');
  const manifest=await r.json();if(manifest.format!=='facade-ui-bundle-v1')throw Error('Unsupported original UI manifest');
  async function asset(name){const pin=manifest.artifacts.find(a=>a.path===name);if(!pin)throw Error('Missing UI asset pin');const response=await fetch(new URL(name,base));if(!response.ok)throw Error('Original UI asset unavailable');const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==pin.bytes||sha!==pin.sha256)throw Error('Original UI integrity mismatch');return JSON.parse(new TextDecoder().decode(bytes));}
  const [font,data]=await Promise.all([asset('comic-bold.json'),asset('ui-data.json')]);validateOutlineFont(font);if(data.format!=='facade-original-ui-contract-v1'||data.names.length!==95)throw Error('Original UI contract mismatch');return{font,data,manifest};
}
function bytesFor(font,text){
  if(typeof text!=='string')throw Error('Text must be a string');
  const map=new Map(font.glyphs.filter(g=>g.text!==null).map(g=>[g.text,g.code]));
  return Array.from(text,c=>{const code=map.get(c);if(code===undefined)throw Error('Character outside captured original ANSI font');return code;});
}

//1009e370: one forced foreground pass, prior-space wrap, no kerning or newline
// substitution. Matrix pen advance and wrap-width accumulator are separate.
export function layoutOutlineText(font,text,{x,y,wrap=200,scale=7,z=0,color=7,alpha=1}={}){
  if(!finite(x,y,wrap,scale,z,alpha)||scale<=0)throw Error('Invalid native text transform');
  const codes=bytesFor(font,text),commands=[];let line=-1,width=0,penX=0,penY=0;
  for(let i=0;i<codes.length;i++){
    if(line===-1||(i>0&&codes[i-1]===32&&width>=wrap/10)){line++;penX=f(f(x)-25);penY=f(f(y)-line*f(scale)*f(.7));width=0;}
    const code=codes[i],glyph=font.glyphs[code],prior=width;
    if(code>=128&&code!==231)throw Error('Native signed-metric wrapping for this extended byte is unresolved');
    commands.push({kind:'glyph',code,glyph,x:penX,y:penY,z:f(f(z)-2),scale:f(scale),color,alpha,line,sourceIndex:i});
    penX=f(penX+f(scale)*f(glyph.advanceX));penY=f(penY+f(scale)*f(glyph.advanceY));
    width=code===231?f(Math.trunc(prior)):f(width+f(glyph.advanceX));
  }
  return{commands,lines:line+1,wrapWidth:width,text,source:'1009e370'};
}

//1009d210: caller supplies the recovered native actor/object projected anchor
// and the already-decided visibility. It does not infer subtitle eligibility.
export function layoutCaption(font,text,{x,y,route=0,alpha=1}={}){
  if(!finite(x,y,alpha)||!Number.isInteger(route)||route<0||route>3)throw Error('Invalid caption anchor');
  let clamped=false;if(x<-70){x=-70;clamped=true;}if(x>50){x=60;clamped=true;}if(y<-60)y=-60;
  if(clamped&&route===0)y=20;if(clamped&&route===1)y=-60;
  const codes=bytesFor(font,text);if(codes.some(c=>c>=128))throw Error('Native signed caption metric for extended byte is unresolved');
  const commands=[];
  for(let pass=0;pass<2;pass++){
    let line=-1,width=0,penX=0,penY=0;const z=pass===0?-7:-5,color=pass===0?0:7;
    for(let i=0;i<codes.length;i++){
      if(line===-1||(i>0&&codes[i-1]===32&&width>=7)){
        line++;penX=f(f(x)-25);penY=f(f(y)-line*5);
        if(pass===0){penX=f(penX+f(.3));penY=f(penY-f(.3));}
        commands.push({kind:'polygon',points:[[-1,-1],[50,-1],[50,4],[-1,4]].map(p=>[f(penX+p[0]),f(penY+p[1])]),z:z-2,color:36,alpha:.3,line,pass});width=0;
      }
      const code=codes[i],glyph=font.glyphs[code];commands.push({kind:'glyph',code,glyph,x:penX,y:penY,z,scale:6,color,alpha,line,pass,sourceIndex:i});
      penX=f(penX+6*f(glyph.advanceX));penY=f(penY+6*f(glyph.advanceY));width=f(width+f(glyph.advanceX));
    }
  }
  return{commands,anchor:{x,y,clamped},text,source:'1009d210'};
}

//Append actual native quadratic/cubic contour geometry to a Canvas2D/Path2D-
//compatible path object. Coordinates are normalized by the original em.
export function traceGlyph(path,glyph,unitsPerEm){
  const p=v=>[v[0]/unitsPerEm,v[1]/unitsPerEm];
  for(const contour of glyph.contours){
    path.moveTo(...p(contour.start));
    for(const curve of contour.curves){
      const pts=curve.points;
      if(curve.type===1)for(const point of pts)path.lineTo(...p(point));
      else if(curve.type===2){
        if(pts.length<2)throw Error('Incomplete original quadratic');
        for(let i=0;i<pts.length-1;i++){const end=i===pts.length-2?pts[i+1]:[(pts[i][0]+pts[i+1][0])/2,(pts[i][1]+pts[i+1][1])/2];path.quadraticCurveTo(...p(pts[i]),...p(end));}
      }else if(curve.type===3){if(pts.length%3)throw Error('Incomplete original cubic');for(let i=0;i<pts.length;i+=3)path.bezierCurveTo(...p(pts[i]),...p(pts[i+1]),...p(pts[i+2]));}
      else throw Error('Unknown original native curve');
    }
    path.closePath();
  }
  return path;
}

export function projectUiPoint(x,y,{width=1016,height=741,nativeClientHeight=741}={}){
  if(!finite(x,y,width,height,nativeClientHeight)||width<=0||height<=0||nativeClientHeight<=0)throw Error('Invalid UI projection');
  return[(x+100)*5.08*width/1016,(nativeClientHeight-(y+100)*5.08)*height/nativeClientHeight];
}
export function unprojectUiPoint(x,y,{width=1016,height=741,nativeClientHeight=741}={}){
  const origin=projectUiPoint(0,0,{width,height,nativeClientHeight});return[(x-origin[0])/(5.08*width/1016),-(y-origin[1])/(5.08*height/nativeClientHeight)];
}

//Optional consumer. Geometry comes from captured outlines, not browser text or
//CSS font fallback. Canvas curve rasterization is not original WGL tessellation.
export function drawUiPlanCanvas(context,font,plan,palette,viewport={}){
  const {width=context.canvas.width,height=context.canvas.height,nativeClientHeight=741}=viewport;
  const sx=5.08*width/1016,sy=5.08*height/nativeClientHeight;
  const commands=plan.commands.map((command,index)=>({command,index})).sort((a,b)=>a.command.z-b.command.z||a.index-b.index);
  context.save();
  try{
    for(const {command:c} of commands){
      const color=palette[c.color];if(!color)throw Error('Missing original UI palette');
      context.fillStyle=`rgb(${color[0]*255} ${color[1]*255} ${color[2]*255})`;context.globalAlpha=c.alpha??color[3]??1;
      if(c.kind==='glyph'){
        const at=projectUiPoint(c.x,c.y,{width,height,nativeClientHeight});context.setTransform(sx*c.scale,0,0,-sy*c.scale,...at);context.beginPath();traceGlyph(context,c.glyph,font.metadata.unitsPerEm);context.fill('nonzero');
      }else if(c.kind==='polygon'){
        context.setTransform(1,0,0,1,0,0);context.beginPath();c.points.forEach((point,i)=>{const p=projectUiPoint(...point,{width,height,nativeClientHeight});if(i)context.lineTo(...p);else context.moveTo(...p);});context.closePath();context.fill('nonzero');
      }else throw Error('Unknown original UI draw command');
    }
  }finally{context.restore();}
}
