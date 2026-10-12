import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const origin=process.argv.slice(2).find(argument=>!argument.startsWith('--'))??'http://127.0.0.1:18060';
const ai=!process.argv.includes('--ui-only');
const directory=resolve('test-artifacts','hosting-'+Date.now());
await mkdir(directory,{recursive:true});
const result={origin,started:new Date().toISOString(),layouts:[],errors:[],failedRequests:[],replies:[]};
const context=await chromium.launchPersistentContext(resolve(directory,'owned-profile'),{executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,hasTouch:true,isMobile:true,viewport:{width:1152,height:864},args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const browser=context.browser();
let progress;
const save=()=>writeFile(resolve(directory,'result.json'),JSON.stringify(result,null,2));
try{
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>result.errors.push(error.stack));
 page.on('requestfailed',request=>{if(!request.failure()?.errorText.includes('ERR_ABORTED'))result.failedRequests.push({url:request.url(),error:request.failure()});});
 await page.addInitScript(()=>{
  localStorage.setItem('facade-local-dialogue','recordings');localStorage.setItem('facade-idle-behavior','false');
  window.microphoneRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.microphoneRequests++;throw Error('Microphone capture prohibited in this owned browser test');};
 });
 await page.goto(origin);await page.waitForFunction(()=>window.facadeScene?.ready);assert.equal(await page.title(),'Facade 2');
 const cdp=await browser.newBrowserCDPSession();const system=await cdp.send('SystemInfo.getInfo');result.gpu=system.gpu.devices;
 const checkLayout=async label=>{
  const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,bad:[...document.querySelectorAll('button,select,textarea,dialog[open],dialog[open] p,dialog[open] label,#status')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.x<-.1||r.y<-.1||r.right>innerWidth+.1||r.bottom>innerHeight+.1||e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1;}).map(e=>e.id||e.tagName)}));
  result.layouts.push({label,...layout});assert.deepEqual(layout.bad,[],JSON.stringify(result.layouts.at(-1)));assert(layout.scrollWidth<=layout.width&&layout.scrollHeight<=layout.height);
 };
 const menu=async id=>{await page.locator('#game-menu-button').click();await page.locator('#'+id).click();};
 for(const size of [{width:1152,height:864},{width:320,height:568},{width:568,height:240},{width:390,height:200},{width:320,height:200}]){
  await page.setViewportSize(size);await checkLayout('names');await page.locator('#game-menu-button').click();await checkLayout('menu');await page.locator('#dialogue-button').click();await checkLayout('dialogue');await page.locator('#dialogue-close').click();
 }
 await page.locator('#voice').click();await page.waitForFunction(()=>facadeScene.opening.started);
 await page.evaluate(()=>{const s=facadeScene;s.opening.reset();s.opening.started=true;s.opening.status('apartment','');s.setCamera({x:0,y:97,z:-160,yaw:0});for(const actor of s.actors){actor.visible=true;actor.position=actor.model.name==='trip'?[-75,-5,-230]:[60,-5,-330];s.behavior.idle(actor);}s.conversation.controls();});
 for(const size of [{width:1152,height:864},{width:320,height:568},{width:568,height:240},{width:390,height:200},{width:320,height:200}]){
  await page.setViewportSize(size);await checkLayout('game');await menu('character-voice-button');await checkLayout('voice');await page.locator('#character-voice-close').click();await page.locator('#talk-button').click();await page.locator('#talk-text').fill('W'.repeat(80));await checkLayout('talk');await page.locator('#talk-close').click();
 }
 await page.setViewportSize({width:1152,height:864});
 await page.evaluate(()=>facadeScene.conversation.setDraft(''));
 await page.screenshot({path:resolve(directory,'game.png')});
 const before=await page.evaluate(()=>({...facadeScene.camera}));await page.locator('#game').focus();await page.keyboard.down('KeyW');await page.waitForTimeout(400);await page.keyboard.up('KeyW');const after=await page.evaluate(()=>({...facadeScene.camera}));result.movement={before,after};assert.notDeepEqual(before,after,'WASD should move the player');
 if(ai){
  console.log('PREPARING',origin,JSON.stringify(result.gpu));
  progress=setInterval(()=>page.evaluate(()=>{const c=facadeScene.conversation;const state={stage:document.getElementById('prepare-stage').textContent,detail:document.getElementById('prepare-detail').textContent,error:c.preparation.lastRun?.error};if(state.error)c.preparation.cancel();return state;}).then(state=>console.log('PROGRESS',JSON.stringify(state))).catch(()=>{}),15000);
  result.preparation=await page.evaluate(async()=>{const c=facadeScene.conversation;c.model='Qwen3.5-4B-q4f16_1-MLC';const ok=await c.preparation.prepare({name:'Adam'});return{ok,run:c.preparation.lastRun,dialogue:c.dialogue.model,voice:c.speech.voice.model,storage:await navigator.storage.estimate()};});
  clearInterval(progress);assert.equal(result.preparation.ok,true);assert.equal(result.preparation.run.completed,true);console.log('PREPARED',Math.round(result.preparation.run.totalMs));await save();
  for(const text of ['Trip, thank you for inviting me. How are you?','Grace, how do you feel about your painting?']){
   const reply=await page.evaluate(async text=>{const c=facadeScene.conversation,at=performance.now();const ok=await c.send(text);return{ok,ms:performance.now()-at,exchange:c.lastExchange,reply:c.lastReply,error:c.error,failure:c.lastFailure};},text);
   result.replies.push({input:text,...reply});console.log('REPLY',JSON.stringify({ok:reply.ok,speaker:reply.reply?.speaker,text:reply.reply?.text,spoken:reply.reply?.spoken,timings:reply.reply?.timings,error:reply.error}));await save();assert.equal(reply.ok,true,reply.error);assert.equal(reply.reply?.spoken,true,reply.error);
  }
 }
 result.microphoneRequests=await page.evaluate(()=>window.microphoneRequests);assert.equal(result.microphoneRequests,0);assert.deepEqual(result.errors,[]);result.passed=true;
}catch(error){result.errors.push(error.stack);result.passed=false;console.error(error.stack);}
finally{clearInterval(progress);await browser.close();await save();}
console.log(JSON.stringify({directory,passed:result.passed,layouts:result.layouts.length,errors:result.errors,failedRequests:result.failedRequests}));if(!result.passed)process.exitCode=1;
