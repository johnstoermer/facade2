// Delivers static model bytes. All dialogue, recognition, speech synthesis,
// rendering and game logic execute in the player's browser.
function sliceStream(stream,start,end){
  const reader=stream.getReader();let offset=0;
  return new ReadableStream({
    async pull(controller){
      try{
        while(offset<=end){
          const {value,done}=await reader.read();
          if(done)throw Error('Truncated model segment');
          const next=offset+value.byteLength;
          if(next>start)controller.enqueue(value.subarray(Math.max(0,start-offset),Math.min(value.byteLength,end-offset+1)));
          offset=next;
          if(offset>end){controller.close();await reader.cancel();return;}
          if(next>start)return;
        }
      }catch(error){controller.error(error);await reader.cancel(error).catch(()=>{});}
    },
    cancel(reason){return reader.cancel(reason);}
  });
}
export function createAssetHandler(largeFiles){
  return async function fetchAsset(request,env){
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    const url=new URL(request.url);let path;
    try{path=decodeURIComponent(url.pathname);}catch{return new Response('Invalid path',{status:400});}
    if(path.startsWith('/auth/')||path.startsWith('/api/')||path==='/account-result.html')return Response.json({error:'This game runs locally in your browser. No account is required.'},{status:410});
    const file=Object.hasOwn(largeFiles,path)?largeFiles[path]:null;
    if(!file){if(path==='/')url.pathname='/index.html';return env.ASSETS.fetch(new Request(url,request));}
    const etag='"'+file.sha256+'"';
    const headers=new Headers({'Content-Type':file.type,'Content-Length':String(file.bytes),'ETag':etag,'Accept-Ranges':'bytes','Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'});
    if((request.headers.get('If-None-Match')??'').split(',').some(value=>['*',etag,'W/'+etag].includes(value.trim())))return new Response(null,{status:304,headers});
    let start=0,end=file.bytes-1,status=200;
    const range=request.headers.get('Range'),ifRange=request.headers.get('If-Range');
    if(range&&(!ifRange||ifRange===etag)){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||!match[1]&&!match[2])return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+file.bytes}});
      start=match[1]?Number(match[1]):Math.max(0,file.bytes-Number(match[2]));
      end=match[1]?(match[2]?Math.min(Number(match[2]),end):end):end;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.bytes||!match[1]&&Number(match[2])===0)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+file.bytes}});
      status=206;headers.set('Content-Range',`bytes ${start}-${end}/${file.bytes}`);headers.set('Content-Length',String(end-start+1));
    }
    if(request.method==='HEAD')return new Response(null,{status,headers});
    let offset=0;const selected=[];
    for(const part of file.parts){
      const last=offset+part.bytes-1;
      if(last>=start&&offset<=end)selected.push({...part,start:Math.max(0,start-offset),end:Math.min(part.bytes-1,end-offset)});
      offset+=part.bytes;
    }
    async function get(part){
      const next=new URL(part.path,url),partial=part.start!==0||part.end!==part.bytes-1;
      const response=await env.ASSETS.fetch(new Request(next,{headers:partial?{Range:`bytes=${part.start}-${part.end}`}:{}}));
      // Some static-asset runtimes ignore Range. Slice their full response as
      // a bounded stream rather than buffering the segment or failing a resume.
      if(partial&&response.status===200&&response.body)return new Response(sliceStream(response.body,part.start,part.end),{status:206});
      if(response.status!==(partial?206:200)||!response.body)throw Error('Model segment '+part.path+' returned '+response.status);
      return response;
    }
    let first;try{first=await get(selected[0]);}catch(error){console.error(error.message);return new Response('Model download unavailable. Please retry.',{status:503,headers:{'Cache-Control':'no-store'}});}
    // Backpressure limits memory to the active stream. Never buffer a model in
    // the Worker. Each file needs fewer than 50 static-asset subrequests.
    const {readable,writable}=globalThis.FixedLengthStream?new FixedLengthStream(end-start+1):new TransformStream();
    const pump=async()=>{
      for(let index=0;index<selected.length;index++){
        const response=index===0?first:await get(selected[index]);
        await response.body.pipeTo(writable,{preventClose:true});
      }
      await writable.getWriter().close();
    };
    pump().catch(error=>writable.abort(error).catch(()=>{}));
    return new Response(readable,{status,headers});
  };
}
