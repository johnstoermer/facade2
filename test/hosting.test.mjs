import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAssetHandler} from '../cloudflare/assets.js';

const data=Buffer.from('0123456789abcdefghijklmnopqrstuv');
const hash=createHash('sha256').update(data).digest('hex');
const parts=[data.subarray(0,10),data.subarray(10,20),data.subarray(20)];
const manifest={'/model.bin':{sha256:hash,bytes:data.length,type:'application/octet-stream',parts:parts.map((part,index)=>({path:'/__chunks/'+index+'.bin',bytes:part.length}))}};
const handler=createAssetHandler(manifest);
function binding({missing=-1,ignoreRange=false}={}){
  const seen=[];
  return{seen,ASSETS:{async fetch(request){
    const path=new URL(request.url).pathname;seen.push(path);
    if(path==='/index.html')return new Response('game',{headers:{'Content-Type':'text/html'}});
    const match=/^\/__chunks\/(\d)\.bin$/.exec(path);
    if(!match||Number(match[1])===missing)return new Response('missing',{status:404});
    const bytes=parts[Number(match[1])],range=request.headers.get('Range');
    if(range&&!ignoreRange){const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range);return new Response(bytes.subarray(Number(start),Number(end)+1),{status:206});}
    return new Response(bytes);
  }}};
}
const request=(path='/model.bin',options)=>new Request('https://facade2.com'+path,options);
test('only configured model downloads redirect; input cannot select another host',async()=>{
  const target='https://huggingface.co/example/model/resolve/'+'a'.repeat(40)+'/weights.bin';
  const remoteHandler=createAssetHandler({}, {'/weights.bin':target});
  for(const method of ['GET','HEAD']){const response=await remoteHandler(request('/weights.bin',{method}),binding());assert.equal(response.status,302);assert.equal(response.headers.get('Location'),target);assert.equal(await response.text(),'');}
  assert.equal((await remoteHandler(request('/weights.bin?url=https://untrusted.example'),binding())).headers.get('Location'),target);
  assert.equal((await remoteHandler(request('/https://untrusted.example'),binding())).status,404);
  assert.equal((await remoteHandler(request('/weights.bin',{method:'POST'}),binding())).status,405);
});
test('large model response preserves every byte across segment boundaries',async()=>{
  const env=binding(),response=await handler(request(),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Length'),String(data.length));
  const actual=Buffer.from(await response.arrayBuffer());assert.deepEqual(actual,data);
  assert.equal(createHash('sha256').update(actual).digest('hex'),hash);assert.equal(env.seen.length,3);
});
test('HEAD and conditional requests avoid fetching model segments',async()=>{
  const env=binding();const head=await handler(request('/model.bin',{method:'HEAD'}),env);
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const tag of ['"'+hash+'"','W/"'+hash+'"','*'])assert.equal((await handler(request('/model.bin',{headers:{'If-None-Match':tag}}),env)).status,304);
  assert.equal(env.seen.length,0);
});
test('bounded, open and suffix ranges return correct bytes',async()=>{
  for(const [range,start,end] of [['bytes=8-22',8,22],['bytes=10-',10,31],['bytes=-5',27,31],['bytes=0-999',0,31]]){
    const response=await handler(request('/model.bin',{headers:{Range:range}}),binding());
    assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),`bytes ${start}-${end}/32`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),data.subarray(start,end+1));
  }
});
test('invalid ranges fail without returning unrelated bytes',async()=>{
  for(const range of ['bytes=32-','bytes=9-2','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=999999999999999999999-']){
    const env=binding(),response=await handler(request('/model.bin',{headers:{Range:range}}),env);assert.equal(response.status,416,range);assert.equal(env.seen.length,0);
  }
});
test('ranges work when the static asset binding ignores Range',async()=>{
  for(const [range,start,end] of [['bytes=8-22',8,22],['bytes=10-',10,31],['bytes=-5',27,31]]){
    const response=await handler(request('/model.bin',{headers:{Range:range}}),binding({ignoreRange:true}));
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),data.subarray(start,end+1));
  }
});
test('stale If-Range returns the entire current model',async()=>{
  const response=await handler(request('/model.bin',{headers:{Range:'bytes=1-2','If-Range':'"old"'}}),binding());
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),data);
});
test('absent first segment reports a retryable download failure',async()=>{
  const response=await handler(request(),binding({missing:0}));assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('a missing later segment fails the body instead of serving corrupted bytes',async()=>{
  const response=await handler(request(),binding({missing:1}));await assert.rejects(response.arrayBuffer());
});
test('cancellation stops remaining segments after any in-flight prefetch',async()=>{
  const env=binding(),response=await handler(request(),env);await response.body.cancel();await new Promise(resolve=>setTimeout(resolve,20));assert(env.seen.length<=2);assert(!env.seen.includes('/__chunks/2.bin'));
});
test('root serves the game; unknown paths do not become an open proxy',async()=>{
  assert.equal(await(await handler(request('/'),binding())).text(),'game');
  assert.equal((await handler(request('/https://other.example/secret'),binding())).status,404);
  assert.equal((await handler(request('/__proto__'),binding())).status,404);
  assert.equal((await handler(request('/%zz'),binding())).status,400);
});
test('account endpoints stay retired and uploads are not accepted',async()=>{
  for(const path of ['/auth/login','/api/dialogue','/account-result.html'])assert.equal((await handler(request(path),binding())).status,410);
  assert.equal((await handler(request('/model.bin',{method:'POST',body:'no'}),binding())).status,405);
});
