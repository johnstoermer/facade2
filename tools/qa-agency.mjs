import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const cases=[
 ['first-date','Trip','Trip, tell me a detailed story about your first date with Grace.'],
 ['shared-date','Grace','Grace, where did Trip say your first date happened?'],
 ['childhood','Grace','Grace, tell me a childhood story about what made you love art.'],
 ['shared-childhood','Trip','Trip, what inspired Grace to love art as a child?'],
 ['ice','Trip','Trip, explain why ice floats on water.'],
 ['plants','Grace','Grace, explain how sunlight helps a tree grow.'],
 ['arithmetic','Trip','Trip, explain why seven times eight is fifty-six.'],
 ['dream','Grace','Grace, tell me about a bizarre dream you had.'],
 ['later-recall','Trip','Trip, remind me where your first date with Grace took place.'],
 ['unavailable','Trip','Trip, give me the ticket from your first date.'],
 ['both-date',null,'Both of you, tell me what you remember about your first date.'],
 ['brief','Trip','Trip, one sentence: did you enjoy that date?'],
 ['acknowledgement','Grace','Grace, thanks.']
];
const selected=process.argv.find(a=>a.startsWith('--cases='))?.slice(8).split(',');
const speech=process.argv.includes('--speech');
const origin=process.env.GAME_ORIGIN??'http://127.0.0.1:18060';
const directory=resolve('test-artifacts','agency-'+Date.now());await mkdir(directory,{recursive:true});
const result={origin,started:new Date().toISOString(),scope:'Actual Qwen3.5-4B, game memory and action execution. Transcript review required for quality. Speech is real only for flagged turns. No microphone.',turns:[],errors:[],sources:{}};
for(const file of ['prompt.js','dialogue-protocol.js','dialogue-worker.js','conversation-policy.js','grounded-task.js'])result.sources[file]=createHash('sha256').update(await readFile('public/local-dialogue-audition/'+file)).digest('hex');
const save=()=>writeFile(resolve(directory,'result.json'),JSON.stringify(result,null,2));
const context=await chromium.launchPersistentContext(resolve('test-artifacts','orchestrator-owned-profile'),{executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1152,height:864},args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.stack));
 await page.addInitScript(()=>{localStorage.setItem('facade-local-dialogue','recordings');localStorage.setItem('facade-idle-behavior','false');window.microphoneRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.microphoneRequests++;throw Error('Physical microphone prohibited');};});
 await page.goto(origin);await page.waitForFunction(()=>facadeScene.ready);await page.locator('#voice').click();
 await page.evaluate(()=>{
  const s=facadeScene,c=s.conversation;s.opening.reset();s.opening.started=true;s.opening.status('apartment','');c.idleEnabled=false;c.model='Qwen3.5-4B-q4f16_1-MLC';
  s.setCamera({x:0,y:97,z:-160,yaw:0});for(const a of s.actors){a.visible=true;a.position=a.model.name==='trip'?[-75,-5,-230]:[60,-5,-330];s.behavior.idle(a);}
  window.realSpeak=c.speech.speak.bind(c.speech);c.speech.speak=reply=>window.testSpeech?realSpeak(reply):Promise.resolve({spoken:true,fixture:true});
 });
 result.load=await page.evaluate(()=>facadeScene.conversation.dialogue.load(facadeScene.conversation.model));console.log('LOADED',Math.round(result.load.startupMs));await save();
 for(const [id,speaker,text] of cases.filter(c=>!selected||selected.includes(c[0]))){
  const actualSpeech=speech&&['first-date','childhood'].includes(id);
  const turn=await page.evaluate(async({text,actualSpeech})=>{
   window.testSpeech=actualSpeech;
   const c=facadeScene.conversation,start=performance.now(),frames=[];let last,raf,captionPages=0;
   const frame=t=>{if(last!==undefined)frames.push(t-last);last=t;captionPages=Math.max(captionPages,c.reply?.pages.length??0);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
   const ok=await c.send(text);cancelAnimationFrame(raf);frames.sort((a,b)=>a-b);
   return{ok,ms:performance.now()-start,exchange:c.lastExchange,error:c.error,failure:c.lastFailure,captionPages,render:{fps:1000*frames.length/frames.reduce((a,b)=>a+b,0),p95Ms:frames[Math.floor(frames.length*.95)],maxMs:frames.at(-1)}};
  },{text,actualSpeech});
  const replies=turn.exchange?.turns??[];
  const checks={completed:turn.ok,speakers:replies.length===(speaker?1:2)&&(!speaker||replies[0]?.speaker===speaker),actions:replies.every(r=>r.actionOutcomes?.every(o=>o.success)&&(id!=='unavailable'||r.actions.length===0)),spoken:!actualSpeech||replies.every(r=>r.spoken&&r.voice?.chunks.length>1&&r.voice.chunks.every(ch=>Number.isFinite(ch.playbackEndedMs)))};
  result.turns.push({id,input:text,actualSpeech,...turn,checks});await save();
  console.log(JSON.stringify({id,...checks,replies:replies.map(r=>({speaker:r.speaker,text:r.text,rememberedStories:r.metrics.turn?.backstoryCount,words:r.text.split(/\s+/).length,ms:Math.round(r.metrics.responseMs)})),error:turn.error}));
 }
 result.microphoneRequests=await page.evaluate(()=>window.microphoneRequests);assert.equal(result.microphoneRequests,0);
 if(process.argv.includes('--interrupt')){
  await page.evaluate(()=>{window.testSpeech=true;window.interruptedStory=facadeScene.conversation.send('Trip, tell me another story from your childhood.');});
  await page.waitForFunction(()=>facadeScene.conversation.speech.voice.playback,undefined,{timeout:180000});
  await page.setViewportSize({width:320,height:200});
  const during=await page.evaluate(()=>{const c=facadeScene.conversation;return{micHeld:c.speech.hold,backstory:c.lastReply.metrics.turn.backstoryCount,pages:c.reply.pages.length,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,badControls:[...document.querySelectorAll('button')].filter(b=>b.checkVisibility()).filter(b=>{const r=b.getBoundingClientRect();return r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight;}).map(b=>b.id)};});
  await page.screenshot({path:resolve(directory,'long-reply-small.png')});await page.locator('#stop-reply').click();
  const stopped=await page.evaluate(async()=>({ok:await interruptedStory,state:facadeScene.conversation.lastExchange.state,playing:!!facadeScene.conversation.speech.voice.playback}));
  assert.equal(stopped.ok,false);assert.equal(stopped.state,'cancelled');assert.equal(stopped.playing,false);assert(during.micHeld&&during.pages>1);assert.deepEqual(during.badControls,[]);assert(during.scrollWidth<=320&&during.scrollHeight<=200);
  const recovered=await page.evaluate(async()=>{const c=facadeScene.conversation;const ok=await c.send('Grace, one sentence: are you still there?');return{ok,spoken:c.lastReply?.spoken,backstory:c.lastReply?.metrics.turn.backstoryCount,error:c.error};});
  assert(recovered.ok&&recovered.spoken);assert.equal(recovered.backstory,during.backstory);
  result.interruption={during,stopped,recovered};console.log('INTERRUPTION',JSON.stringify(result.interruption));
 }
 result.completed=true;result.pipelinePassed=!result.errors.length&&result.turns.every(t=>Object.values(t.checks).every(Boolean));
}catch(e){result.errors.push(e.stack);console.error(e.stack);}
finally{await context.close();await save();}
console.log('RESULT',JSON.stringify({directory,completed:result.completed,pipelinePassed:result.pipelinePassed,errors:result.errors}));
if(!result.pipelinePassed)process.exitCode=1;
