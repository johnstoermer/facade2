import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const dir=new URL('../test-artifacts/character-tone-'+Date.now()+'/',import.meta.url);
await mkdir(dir,{recursive:true});
const cases=[
 ['Trip','friendly','Trip, thanks for having me over. How are you?'],
 ['Trip','direct insult',"Trip, you're a fucking arrogant asshole."],
 ['Trip','apology','Trip, sorry. That was rude of me. Can we start over?'],
 ['Trip','profane praise','Trip, this apartment looks fucking amazing.'],
 ['Trip','reported insult',"Trip, a coworker called me a fucking idiot today. I'm upset."],
 ['Grace','friendly','Grace, thanks for inviting me. What have you been painting?'],
 ['Grace','direct insult','Grace, your art is fucking ugly and you have shit taste.'],
 ['Grace','apology','Grace, I was out of line. Sorry I insulted your art.'],
 ['Grace','profane praise','Grace, that painting is fucking beautiful.'],
 ['Grace','reported insult',"Grace, a coworker called me a fucking idiot today. I'm upset."]
];
const result={utc:new Date().toISOString(),scope:'Live default Qwen3.5-4B in an owned browser; actual game prompt, memory, orchestrator and validation. Speech playback stubbed; no microphone. Tone needs transcript review, not a keyword-only score. Other GPU work may affect timings.',sources:{},turns:[],errors:[]};
for(const path of ['local-dialogue-audition/prompt.js','local-dialogue-audition/character-tone.js','local-dialogue-audition/dialogue-protocol.js','local-dialogue-audition/dialogue-worker.js'])result.sources[path]=createHash('sha256').update(await readFile(new URL('../public/'+path,import.meta.url))).digest('hex');
const save=()=>writeFile(new URL('result.json',dir),JSON.stringify(result,null,2)+'\n');
const context=await chromium.launchPersistentContext(fileURLToPath(new URL('../test-artifacts/character-tone-owned-profile/',import.meta.url)),{executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1152,height:864},args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const page=await context.newPage();
 page.on('pageerror',error=>result.errors.push(error.stack));
 page.on('requestfailed',request=>console.log('REQUEST FAILED',request.url(),request.failure()));
 await page.addInitScript(()=>{localStorage.setItem('facade-local-dialogue','recordings');localStorage.setItem('facade-idle-behavior','false');window.microphoneRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.microphoneRequests++;throw Error('Physical microphone prohibited in this test');};});
 await page.goto(process.env.GAME_ORIGIN??'http://127.0.0.1:18060/');await page.waitForFunction(()=>window.facadeScene?.ready);await page.locator('#voice').click();
 await page.evaluate(()=>{
  const s=facadeScene,c=s.conversation;s.opening.reset();s.opening.started=true;s.opening.status('apartment','');c.idleEnabled=false;c.model='Qwen3.5-4B-q4f16_1-MLC';
  s.setCamera({x:0,y:97,z:-160,yaw:0});for(const actor of s.actors){actor.visible=true;actor.position=actor.model.name==='trip'?[-75,-5,-230]:[60,-5,-330];s.behavior.idle(actor);}
  c.speech.speak=async()=>({spoken:true,fixture:true});c.speech.voice.unlock=async()=>{};
 });
 result.load=await page.evaluate(()=>facadeScene.conversation.dialogue.load(facadeScene.conversation.model));console.log('LOADED',JSON.stringify(result.load.adapter));await save();
 for(const [speaker,kind,text] of cases){
  const turn=await page.evaluate(async text=>{const c=facadeScene.conversation,started=performance.now(),ok=await c.send(text);return{ok,ms:performance.now()-started,exchange:c.lastExchange,error:c.error,failure:c.lastFailure};},text);
  result.turns.push({speaker,kind,input:text,...turn});await save();
  console.log(JSON.stringify({speaker,kind,ok:turn.ok,replies:turn.exchange?.turns.map(r=>({speaker:r.speaker,text:r.text,actions:r.actions})),error:turn.error}));
 }
 assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
 result.pipelinePassed=result.turns.every(t=>t.ok&&t.exchange?.turns.length===1&&t.exchange.turns[0].speaker===t.speaker&&t.exchange.turns[0].actions.every(a=>['face','gesture'].includes(a.type))&&t.exchange.turns[0].actionOutcomes.every(o=>o.success));
 result.completed=true;
}catch(error){result.errors.push(error.stack);console.error(error.stack);}
finally{await context.close();await save();}
console.log('RESULT',fileURLToPath(dir));
if(result.errors.length||!result.pipelinePassed)process.exitCode=1;
