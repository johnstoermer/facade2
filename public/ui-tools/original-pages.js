// Pure original page plans. No DOM, URL opening, input handlers, timers, or GL.
import { layoutOutlineText } from './outline-text.js';

const PAGE_CONTRACT = Object.freeze({instructions:[1,3,3], hints:[2,17,0], about:[3,23,1]});
const finite = (...n) => n.every(Number.isFinite);
const inside = (cursor, hit) => cursor !== null && cursor.x > hit[0] && cursor.y > hit[1]
  && cursor.x < hit[2] && cursor.y < hit[3];

export function validateOriginalPages(data) {
  if (data?.format !== 'facade-original-pages-v1' || Object.keys(data.pages ?? {}).length !== 3)
    throw Error('Invalid original page bundle');
  for (const [key, [nativeState, labels, images]] of Object.entries(PAGE_CONTRACT)) {
    const page = data.pages[key];
    if (!page || page.nativeState !== nativeState || page.labels?.length !== labels || page.images?.length !== images)
      throw Error('Invalid original page records');
    for (const label of page.labels) {
      if (typeof label.text !== 'string' || !finite(label.x,label.y,label.z,label.wrap,label.scale)
          || label.wrap <= 0 || label.scale <= 0 || !data.palette[label.color]) throw Error('Invalid page text transform');
    }
    for (const control of page.controls) {
      if (control.hit?.length !== 4 || !finite(...control.hit) || !control.strict
          || control.hit[0] >= control.hit[2] || control.hit[1] >= control.hit[3]) throw Error('Invalid original page hit box');
    }
    for (const image of page.images) {
      if (image.kind !== 'texturedQuad' || image.positions?.length !== 4 || image.uvs?.length !== 4
          || !data.textureAssets.some(asset => asset.stripId === image.stripId)
          || image.positions.some(p => p.length !== 3 || !finite(...p))
          || image.uvs.some(p => p.length !== 2 || !finite(...p))) throw Error('Invalid original page image');
    }
  }
  return data;
}

// Invoke once when native dispatcher10097670 would execute this page. The caller
// retains frame counters, ending dispatch delay, click latch and outer backdrop.
// Rendering still describes the current page on a click frame; nextNativeState
// applies to the subsequent dispatch, as in the native routines.
export function layoutOriginalPage(font, data, pageId, {
  cursor = null, click = false, endingMode = false, hintsSuppressed = false,
  frameCounter = 0, lastAboutLinkFrame = 0,
} = {}) {
  validateOriginalPages(data);
  if (!Object.hasOwn(PAGE_CONTRACT,pageId)) throw Error('Unknown original page');
  if (cursor !== null && !finite(cursor?.x,cursor?.y)) throw Error('Invalid native page cursor');
  if (![click,endingMode,hintsSuppressed].every(v => typeof v === 'boolean')) throw Error('Invalid native page flag');
  if (![frameCounter,lastAboutLinkFrame].every(v => Number.isInteger(v) && v >= -2147483648 && v <= 4294967295))
    throw Error('Invalid native frame counter');
  const page = data.pages[pageId], commands = [], actions = [];
  let nextNativeState = page.nativeState, nextAboutLinkFrame = lastAboutLinkFrame;
  const hovered = pageId === 'hints' && hintsSuppressed ? []
    : page.controls.filter(control => inside(cursor,control.hit)).map(control => control.id);
  const result = () => ({page:pageId,source:page.function,commands,actions,hovered,
    nextNativeState,nextAboutLinkFrame,palette:data.palette,
    textureAssets:data.textureAssets.filter(asset => page.images.some(image => image.stripId === asset.stripId)),
    suppressed:pageId === 'hints' && hintsSuppressed});
  if (pageId === 'hints' && hintsSuppressed) return result();
  const navigate = state => {
    nextNativeState = state;
    actions.push({type:'page',nativeState:state,page:state === 0 ? 'name' : null});
  };

  if (pageId === 'instructions' && click) navigate(0);
  if (pageId === 'about') {
    if (click) {
      const logo = page.controls.find(control => control.id === 'logo');
      // x86 SUB/CMP/JLE: signed32 difference, strictly greater than150.
      if (endingMode && hovered.includes('logo')
          && (lastAboutLinkFrame === 0 || ((frameCounter-lastAboutLinkFrame)|0) > 150)) {
        nextAboutLinkFrame = frameCounter;
        actions.push({type:'external-url',url:logo.url});
      }
      navigate(endingMode ? 8 : 0);
    }
    if (!endingMode) actions.push({type:'fade',...page.normalFrameFadeAssignment});
  }
  if (page.disableMovement) actions.push({type:'native-flag',address:'0x101c6f98',value:0});

  for (const label of page.labels) {
    const isHovered = label.control && hovered.includes(label.control);
    if (pageId === 'hints' && label.control && isHovered && click) {
      const control = page.controls.find(control => control.id === label.control);
      if (control.url) {
        actions.push({type:'external-url',url:control.url});
        actions.push({type:'native-flag',address:control.setFlag,value:1});
      }
      if (control.nextNativeState !== undefined) navigate(control.nextNativeState);
    }
    commands.push(...layoutOutlineText(font,label.text,{...label,color:isHovered ? label.hoverColor : label.color}).commands);
  }
  for (const image of page.images) commands.push({...image,positions:image.positions.map(p => [...p]),uvs:image.uvs.map(p => [...p])});
  if (pageId === 'about' && endingMode && hovered.includes('logo'))
    commands.push({...page.highlight,points:page.highlight.points.map(p => [...p])});
  return result();
}
