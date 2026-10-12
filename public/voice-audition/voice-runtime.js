// Each speech worker owns its sessions. This selects only the async bridge;
// model tensors and the native WebGPU kernels remain the same pinned version.
export const supportsJspi=()=>typeof WebAssembly.Suspending==='function'&&typeof WebAssembly.promising==='function';
let loading;
export function loadVoiceRuntime({preferJspi=false}={}){
 return loading??=(async()=>{
  let kind=preferJspi&&supportsJspi()?'jspi':'asyncify',fallbackReason;
  if(kind==='jspi'){
   try{globalThis[Symbol.for('onnxruntime')]=await import('./runtime/ort.jspi.bundle.min.mjs');}
   catch{kind='asyncify';fallbackReason='The faster voice runtime could not load; using the compatible local runtime.';}
  }
  const library=await import('./runtime/transformers.min.js');
  library.env.backends.onnx.wasm.wasmPaths={mjs:new URL('./runtime/ort-wasm-simd-threaded.'+kind+'.mjs',import.meta.url).href,wasm:new URL('./runtime/ort-wasm-simd-threaded.'+kind+'.wasm',import.meta.url).href};
  // Transformers4.3.1 leaves its device list empty for an injected runtime.
  // An explicit provider keeps all sessions on the same hardware WebGPU path.
  return{library,kind,fallbackReason,device:kind==='jspi'?'auto':'webgpu',sessionOptions:kind==='jspi'?{executionProviders:['webgpu']}:{}};
 })();
}
