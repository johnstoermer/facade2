import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {guestFocusEvals} from '../test/fixtures/guest-focus-evals.js';
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)??'tuned',limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8))||30;
const selected=process.argv.find(a=>a.startsWith('--cases='))?.slice(8).split(',');
const dir=new URL('../test-artifacts/guest-focus-'+label+'-'+Date.now()+'/',import.meta.url);await mkdir(dir,{recursive:true});
const result={utc:new Date().toISOString(),label,scope:'Actual default Qwen3.5-4B, shared game orchestrator and action executor. Speech stubbed. Connected guest inputs; no expectation passed to model. Lexical anchors are review aids, not semantic scores.',turns:[],errors:[],sources:{}};
for(const f of ['local-dialogue-audition/prompt.js','local-dialogue-audition/scene-context.js','local-dialogue-audition/character-tone.js','local-dialogue-audition/dialogue-protocol.js','local-dialogue-audition/dialogue-worker.js','local-dialogue-audition/guest-focus.js','local-dialogue-audition/grounded-task.js','scene-orchestrator.js','browser-conversation.js','character-actions.js'])result.sources[f]=createHash('sha256').update(await readFile(new URL('../public/'+f,import.meta.url))).digest('hex');
const save=()=>writeFile(new URL('result.json',dir),JSON.stringify(result,null,2));
const context=await chromium.launchPersistentContext(fileURLToPath(new URL('../test-artifacts/orchestrator-owned-profile/',import.meta.url)),{executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1152,height:864},args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.stack));await page.addInitScript(()=>{localStorage.setItem('facade-local-dialogue','recordings');navigator.mediaDevices.getUserMedia=()=>Promise.reject(Error('Physical microphone prohibited in this test'));});
 await page.goto(process.env.GAME_ORIGIN??'http://127.0.0.1:18060/');await page.waitForFunction(()=>facadeScene.ready);await page.locator('#voice').click();
 await page.evaluate(()=>{const s=facadeScene,c=s.conversation;s.opening.reset();s.opening.started=true;s.opening.status('apartment','');c.idleEnabled=false;c.model='Qwen3.5-4B-q4f16_1-MLC';s.setCamera({x:0,y:97,z:-160,yaw:0});for(const a of s.actors){a.visible=true;a.position=a.model.name==='trip'?[-75,-5,-230]:[60,-5,-330];s.behavior.idle(a);}c.speech.speak=async()=>({spoken:true,fixture:true});c.speech.voice.unlock=async()=>{};});
 const cdp=await context.browser().newBrowserCDPSession();result.gpu=await cdp.send('SystemInfo.getInfo');await cdp.detach();
 result.load=await page.evaluate(()=>facadeScene.conversation.dialogue.load(facadeScene.conversation.model));console.log('LOADED',Math.round(result.load.startupMs));await save();
 await page.evaluate(async()=>{const c=facadeScene.conversation;await c.dialogue.generate(c.model,{}, {messages:[{role:'user',content:'Return JSON: {"speaker":"Trip","text":"Hello.","handoff":"none","actions":[]}'}],temperature:0,maxTokens:100});await c.dialogue.request('reset');});
 for(const test of (selected?guestFocusEvals.filter(t=>selected.includes(t.id)):guestFocusEvals).slice(0,limit)){
  const r=await page.evaluate(async text=>{
   const s=facadeScene,c=s.conversation,start=performance.now(),before=s.behavior.snapshot(),frames=[];let last=null,raf;
   const frame=t=>{if(last!==null)frames.push(t-last);last=t;raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
   const ok=await c.send(text);cancelAnimationFrame(raf);frames.sort((a,b)=>a-b);
   return{ok,before,exchange:c.lastExchange,world:s.behavior.snapshot(),ms:performance.now()-start,error:c.error,failure:c.lastFailure,render:{frames:frames.length,fps:frames.length?1000*frames.length/frames.reduce((a,b)=>a+b,0):null,p95Ms:frames[Math.floor(frames.length*.95)]??null,maxMs:frames.at(-1)??null,over50Ms:frames.filter(t=>t>50).length}};
  },test.text);
  const replies=r.exchange?.turns??[],actions=replies.flatMap(r=>r.actions),check=(name,pass)=>({name,pass}),physical=new Set(['pick_up','put_down','give','pour','drink','shake']);
  const checks=[check('completed',r.ok),check('speaker count',replies.length===(test.both?2:1)),check('lexical reference',test.anchors.some(word=>replies.some(r=>new RegExp('\\b'+word+'(?:s|es|ing|ed)?\\b','i').test(r.text))))];
  if(test.speaker)checks.push(check('addressed speaker',replies[0]?.speaker===test.speaker));
  if(test.intention)checks.push(check('guest statement did not move inventory/player',JSON.stringify(r.before.player)===JSON.stringify(r.world.player)&&r.before.objects.every(o=>{const after=r.world.objects.find(a=>a.id===o.id);return o.heldBy===after.heldBy&&JSON.stringify(o.position)===JSON.stringify(after.position);})));
  if('owner' in test)checks.push(check('requested ownership',r.world.objects.find(o=>o.id===12).heldBy===test.owner));
  if(test.noObjectActions)checks.push(check('no repeated object use',!actions.some(a=>physical.has(a.type))));
  if(test.noMove)checks.push(check('no contradictory move',!actions.some(a=>a.type==='move')));
  if(test.move)checks.push(check('actual requested move',replies.some(r=>r.actionOutcomes?.some(o=>o.success&&o.action?.type==='move'&&o.action.target===test.move))));
  if(test.door)checks.push(check('door state',r.world.door===test.door));
  result.turns.push({...test,...r,checks});console.log(JSON.stringify({id:test.id,ok:r.ok,replies:replies.map(r=>({who:r.speaker,text:r.text,actions:r.actions,ms:Math.round(r.metrics.responseMs)})),failed:checks.filter(c=>!c.pass).map(c=>c.name),error:r.error}));await save();
 }
 result.completed=true;
}catch(e){result.errors.push(e.stack);console.error(e.stack);}finally{
 result.summary={inputs:result.turns.length,completedInputs:result.turns.filter(t=>t.ok).length,failedChecks:result.turns.flatMap(t=>t.checks.filter(c=>!c.pass).map(c=>({id:t.id,name:c.name})))};
 await context.close();await save();
}
console.log('RESULT',JSON.stringify({directory:fileURLToPath(dir),completed:result.completed,...result.summary,errors:result.errors}));
if(result.errors.length||!result.completed||result.turns.some(t=>!t.ok))process.exitCode=1;
