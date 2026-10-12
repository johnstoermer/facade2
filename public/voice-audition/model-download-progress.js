// Transformers 4.3.1's model progress callback probes same-origin metadata
// with an unread full GET. Track actual downloads through its public fetch
// hook instead, and leave from_pretrained's metadata callback disabled.
export async function withModelDownloadProgress(env,base,callback,load){
 if(!callback)return load();
 const original=env.fetch;
 env.fetch=async(input,options)=>{
  const response=await original(input,options);
  const url=new URL(input instanceof Request?input.url:input,base);
  const method=options?.method??(input instanceof Request?input.method:'GET');
  if(method!=='GET'||!response.ok||!response.body||url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||!/\.onnx(?:_data(?:_\d+)?)?$/.test(url.pathname))return response;
  const file=url.pathname.slice(base.pathname.length),reader=response.body.getReader();
  // Fetch decompresses before delivering chunks. A compressed Content-Length
  // cannot be used as the decoded byte total.
  const total=response.headers.has('content-encoding')?0:Number(response.headers.get('content-length'))||0;
  let loaded=0;
  callback({status:'download',file});
  const body=new ReadableStream({
   async pull(controller){
    try{
     const {done,value}=await reader.read();
     if(done){callback({status:'progress',file,loaded,total:loaded,progress:100});callback({status:'done',file});reader.releaseLock();controller.close();return;}
     loaded+=value.byteLength;
     callback({status:'progress',file,loaded,total,progress:total?Math.min(100,loaded/total*100):undefined});
     controller.enqueue(value);
    }catch(error){reader.releaseLock();controller.error(error);}
   },
   async cancel(reason){try{await reader.cancel(reason);}finally{reader.releaseLock();}},
  },{highWaterMark:0});
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 try{return await load();}finally{env.fetch=original;}
}
