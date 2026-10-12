import {readFile,writeFile,mkdir,copyFile,readdir,stat,open,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
const manifest=JSON.parse(await readFile(resolve(root,'asset-manifest.json'),'utf8'));
const chunkSize=24*1024*1024,largeFiles={},remoteFiles={};let remoteBytes=0;
const safe=(base,path)=>{const target=resolve(base,path);if(!target.startsWith(resolve(base)+sep))throw Error('Unsafe asset path');return target;};
// Only this generated child directory is removed. No workspace or source path
// can be selected through command arguments or asset metadata.
if(dirname(dist)!==resolve(root)||dist===resolve(root))throw Error('Invalid build directory');
await mkdir(dist,{recursive:true});
// Keep the directory itself: Windows dev-server watchers may hold it open.
for(const name of await readdir(dist))await rm(safe(dist,name),{recursive:true,force:true});
async function copyTree(from,to){
  await mkdir(to,{recursive:true});
  for(const file of await readdir(from,{withFileTypes:true})){const input=resolve(from,file.name),output=resolve(to,file.name);if(file.isDirectory())await copyTree(input,output);else await copyFile(input,output);}
}
await copyTree(resolve(root,'public'),dist);
const types={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.bmp':'image/bmp','.wav':'audio/wav'};
let chunks=0;
for(const file of manifest.files){
  const input=safe(resolve(root,'.assets'),file.path),info=await stat(input);
  if(info.size!==file.bytes)throw Error('Asset size changed: '+file.path);
  // Only unchanged files from a pinned public model revision use the upstream
  // download host. Corrected/derived models have no source URL and stay here.
  const remote=file.bytes>1024*1024&&/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[a-f0-9]{40}\//.test(file.source??'');
  const handle=await open(input),hash=createHash('sha256'),parts=[];
  try{
    for(let offset=0;offset<file.bytes;offset+=chunkSize){
      const data=Buffer.allocUnsafe(Math.min(chunkSize,file.bytes-offset));let read=0;
      while(read<data.length){const {bytesRead}=await handle.read(data,read,data.length-read,offset+read);if(!bytesRead)throw Error('Truncated asset');read+=bytesRead;}
      hash.update(data);
      if(remote)continue;
      const path=file.bytes>chunkSize?'__chunks/'+file.sha256+'/'+parts.length+'.bin':file.path;
      const output=safe(dist,path);await mkdir(dirname(output),{recursive:true});await writeFile(output,data);
      if(file.bytes>chunkSize){parts.push({path:'/'+path,bytes:data.length});chunks++;}
    }
  }finally{await handle.close();}
  if(hash.digest('hex')!==file.sha256)throw Error('Asset hash changed: '+file.path);
  if(remote){remoteFiles['/'+file.path]=file.source;remoteBytes+=file.bytes;}
  if(parts.length)largeFiles['/'+file.path]={bytes:file.bytes,sha256:file.sha256,type:types[extname(file.path)]??'application/octet-stream',parts};
}
await mkdir(resolve(root,'cloudflare'),{recursive:true});
await writeFile(resolve(root,'cloudflare/large-files.json'),JSON.stringify(largeFiles)+'\n');
await writeFile(resolve(root,'cloudflare/remote-files.json'),JSON.stringify(remoteFiles)+'\n');
await writeFile(resolve(dist,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  Cache-Control: public, max-age=0, must-revalidate\n\n/__chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log(JSON.stringify({assetBytes:manifest.totalBytes,hostedAssetBytes:manifest.totalBytes-remoteBytes,remoteBytes,remoteFiles:Object.keys(remoteFiles).length,largeFiles:Object.keys(largeFiles).length,chunks,maximumFileBytes:chunkSize,dist:relative(root,dist)}));
