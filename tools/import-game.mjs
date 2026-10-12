// Maintainer-only import. The public repository contains an explicit game
// dependency closure; the surrounding development workspace is never staged.
import {readFile,writeFile,copyFile,mkdir,readdir,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,sep,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),source=await realpath(process.argv[2]??'');
if(!process.argv[2]||source===root)throw Error('Usage: node tools/import-game.mjs <browser-native directory>');
for(const path of ['scene.js','index.html','browser-conversation.js'])await stat(resolve(source,path));
const records=new Map(),sources=new Set();
const hashFile=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');};
const safe=(base,path)=>{const target=resolve(base,path);if(!target.startsWith(resolve(base)+sep))throw Error('Path escaped project: '+path);return target;};
const save=async(path,bytes)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);};
async function asset(path,pin={}){
  path=path.replaceAll('\\','/');
  const existing=records.get(path);if(existing){if(pin.sha256&&existing.sha256!==pin.sha256)throw Error('Conflicting pin: '+path);return;}
  const file=safe(source,path),info=await stat(file),sha256=await hashFile(file);
  if(pin.bytes!==undefined&&pin.bytes!==info.size||pin.sha256&&pin.sha256!==sha256)throw Error('Asset integrity mismatch: '+path);
  const output=safe(resolve(root,'.assets'),path);await mkdir(dirname(output),{recursive:true});await copyFile(file,output);
  records.set(path,{path,bytes:info.size,sha256,...(typeof(pin.url??pin.source)==='string'&&/^https:\/\//.test(pin.url??pin.source)?{source:pin.url??pin.source}:{})});
}
async function code(path){
  path=posix.normalize(path);if(sources.has(path))return;
  if(/(?:^|\/)(?:runtime|vendor)\//.test(path)){await asset(path);return;}
  if(!/\.(?:m?js)$/.test(path)||path.startsWith('../'))return;
  if(/(?:^|\/)(?:account-result|browser-conversation-api)\./.test(path))throw Error('Account/cloud code is outside the game publication scope');
  sources.add(path);
  const bytes=await readFile(safe(source,path));await save(safe(resolve(root,'public'),path),bytes);
  const text=bytes.toString('utf8');
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\s*\(\s*)['"](\.[^'"]+)['"]/g)){
    const dependency=posix.normalize(posix.join(posix.dirname(path),match[1].split('?')[0]));
    if(/\.(?:m?js)$/.test(dependency))await code(dependency);
  }
}
async function tree(path,accept){
  for(const entry of await readdir(safe(source,path),{withFileTypes:true})){
    const next=path+'/'+entry.name;
    if(entry.isDirectory())await tree(next,accept);else if(accept(next))await asset(next);
  }
}
await save(resolve(root,'public/index.html'),await readFile(resolve(source,'index.html')));
for(const path of ['scene.js','speech-worker.js','voice-capture-worklet.js','local-dialogue-audition/dialogue-worker.js','voice-audition/tts-worker.js'])await code(path);
for(const path of ['assets/scene.json','assets/characters.json','assets/motion-scripts.json','assets/opening-audio.json','assets/door-audio.json','ui-tools/atlas-data.json','ui-tools/pages-data.json','ui-tools/atlas-yellowfont.bmp','ui-tools/atlas-yellowfont2.bmp','ui-tools/out/ui-manifest.json','ui-tools/out/ui-data.json','ui-tools/out/comic-bold.json','animation-tools/out/manifest.json','head-tools/out/manifest.json'])await asset(path);
await tree('assets/textures',path=>path.endsWith('.bmp'));
await tree('assets/audio',path=>path.endsWith('.wav'));
await tree('head-tools/out',path=>path.endsWith('.head.json'));
await tree('animation-tools/out',path=>path.endsWith('.poses.bin'));
await asset('voice-audition/references/references.json');
const references=JSON.parse(await readFile(resolve(source,'voice-audition/references/references.json'),'utf8'));
for(const reference of references.references)await asset('voice-audition/'+reference.uri,{sha256:reference.sha256});

const dialogue=JSON.parse(await readFile(resolve(source,'local-dialogue-audition/models.lock.json'),'utf8'));
for(const model of dialogue.models){
  const base='local-dialogue-audition/models/'+model.id+'/resolve/'+model.revision+'/';
  for(const file of [...model.files,model.library])await asset(base+file.path,file);
}
await asset('local-dialogue-audition/'+dialogue.runtime.file,dialogue.runtime);
for(const manifestPath of ['voice-audition/model-manifest-turbo-game.json','voice-audition/model-manifest-standard-game.json']){
  const manifest=JSON.parse(await readFile(resolve(source,manifestPath),'utf8'));
  for(const file of [...manifest.files,...manifest.fallbackRuntime??[]])await asset('voice-audition/'+file.path,file);
  await save(safe(resolve(root,'public'),manifestPath),await readFile(resolve(source,manifestPath)));
}
for(const manifestPath of ['assets/speech/manifest.json','assets/speech/manifest-webgpu.json']){
  const manifest=JSON.parse(await readFile(resolve(source,manifestPath),'utf8'));
  for(const file of manifest.artifacts)await asset('assets/speech/'+file.path,file);
  for(const file of [...manifest.sharedRuntime??[],...manifest.fallbackRuntime??[]])await asset(file.path,file);
  await save(safe(resolve(root,'public'),manifestPath),await readFile(resolve(source,manifestPath)));
}
await save(resolve(root,'public/local-dialogue-audition/models.lock.json'),JSON.stringify(dialogue,null,2)+'\n');
await save(resolve(root,'public/local-dialogue-audition/selection.json'),JSON.stringify({defaultModel:'Qwen3.5-4B-q4f16_1-MLC',schedule:'sequence',status:'Experimental browser-local dialogue. See the public repository for limitations.'},null,2)+'\n');
for(const directory of ['local-dialogue-audition/licenses','assets/speech']){
  for(const file of await readdir(resolve(source,directory)))if(/license|apache/i.test(file)&&/\.txt$/i.test(file)){
    await save(resolve(root,'public/third-party',file),await readFile(resolve(source,directory,file)));
  }
}
const files=[...records.values()].sort((a,b)=>a.path.localeCompare(b.path));
await save(resolve(root,'asset-manifest.json'),JSON.stringify({format:'facade2-release-assets-v1',files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)},null,2)+'\n');
await mkdir(resolve(root,'.local'),{recursive:true});
await save(resolve(root,'.local/import.json'),JSON.stringify({source,importedAt:new Date().toISOString(),sourceFiles:[...sources].sort()},null,2)+'\n');
console.log(JSON.stringify({sourceFiles:sources.size,assets:files.length,assetBytes:files.reduce((sum,file)=>sum+file.bytes,0)}));
