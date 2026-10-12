// Developer setup, not a player requirement. The source repository keeps
// multi-gigabyte models and original game data outside Git.
import {readFile,mkdir,stat,writeFile,rename,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base=new URL(process.argv[2]??'https://facade2.com/');
if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw Error('Use a public HTTP(S) asset origin without credentials');
const manifest=JSON.parse(await readFile(resolve(root,'asset-manifest.json'),'utf8'));
const hash=async path=>{const digest=createHash('sha256');for await(const bytes of createReadStream(path))digest.update(bytes);return digest.digest('hex');};
let done=0;const queue=manifest.files.slice();
await Promise.all(Array.from({length:3},async()=>{while(queue.length){
  const file=queue.shift(),target=resolve(root,'.assets',file.path),prefix=resolve(root,'.assets')+sep;
  if(!target.startsWith(prefix))throw Error('Unsafe asset path');
  try{if((await stat(target)).size===file.bytes&&await hash(target)===file.sha256){done++;continue;}}catch{}
  await mkdir(dirname(target),{recursive:true});
  const response=await fetch(new URL(file.path,base));if(!response.ok)throw Error('Asset download failed: '+file.path+' ('+response.status+')');
  let bytes=0;const digest=createHash('sha256');
  const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;digest.update(chunk);callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(target+'.download'));
  if(bytes!==file.bytes||digest.digest('hex')!==file.sha256){await rm(target+'.download');throw Error('Asset integrity mismatch: '+file.path);}
  await rename(target+'.download',target);done++;if(done%10===0)console.log(done+'/'+manifest.files.length);
}}));
console.log('Verified '+done+' release assets. Run npm run build.');
