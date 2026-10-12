import {validateOriginalPages} from './ui-tools/original-pages.js';
import {drawUiPlanCanvas,projectUiPoint} from './ui-tools/outline-text.js';

const dataPin={bytes:47025,sha256:'7906b11975e2cfc0813c108be5f5580dd64793fd25921cf8265c1531267314b3'};
const base=new URL('./ui-tools/original-pages.js',import.meta.url);
async function pinnedBytes(url,pin){
  const response=await fetch(url);if(!response.ok)throw Error('Original menu page asset unavailable');
  const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==pin.bytes||hash!==pin.sha256)throw Error('Original menu page integrity mismatch');
  return bytes;
}
export async function loadOriginalPages(){
  const bytes=await pinnedBytes(new URL('./pages-data.json',base),dataPin);
  const pages=validateOriginalPages(JSON.parse(new TextDecoder().decode(bytes)));
  const images=new Map(await Promise.all(pages.textureAssets.map(async asset=>{
    const bytes=await pinnedBytes(new URL(asset.urlRelativeToModule,base),asset);
    const image=await createImageBitmap(new Blob([bytes],{type:'image/bmp'}));
    if(image.width!==asset.width||image.height!==asset.height)throw Error('Original page image size mismatch');
    return[asset.stripId,image];
  })));
  return{pages,images};
}

// These four original image quads are rectangular, white, unit-UV and opaque.
// The browser decodes the original BMP bytes; no illustration is redrawn.
// Like the outline sink, Canvas rasterization is not a WGL pixel-parity claim.
export function drawOriginalPage(context,font,plan,images,viewport){
  const depth=c=>c.z??c.positions[0][2];
  const ordered=plan.commands.map((command,index)=>({command,index})).sort((a,b)=>depth(a.command)-depth(b.command)||a.index-b.index);
  let pending=[];
  const flush=()=>{if(pending.length)drawUiPlanCanvas(context,font,{commands:pending},plan.palette,viewport);pending=[];};
  for(const {command:c} of ordered){
    if(c.kind!=='texturedQuad'){pending.push(c);continue;}
    flush();
    const image=images.get(c.stripId);if(!image)throw Error('Missing original page image');
    const [bl,br,tr,tl]=c.positions;
    if(bl[0]!==tl[0]||br[0]!==tr[0]||bl[1]!==br[1]||tl[1]!==tr[1]||c.color!==7||c.alpha!==1||JSON.stringify(c.uvs)!=='[[0,0],[1,0],[1,1],[0,1]]')throw Error('Unsupported original menu image quad');
    const topLeft=projectUiPoint(tl[0],tl[1],viewport),bottomRight=projectUiPoint(br[0],br[1],viewport);
    context.save();try{context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.imageSmoothingEnabled=true;context.drawImage(image,...topLeft,bottomRight[0]-topLeft[0],bottomRight[1]-topLeft[1]);}finally{context.restore();}
  }
  flush();
}
