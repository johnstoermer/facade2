import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const dir=new URL('../test-artifacts/wasd-'+Date.now()+'/',import.meta.url);
await mkdir(dir,{recursive:true});
const result={checks:[],movement:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1152,height:864}});
  await context.addInitScript(()=>{
    localStorage.setItem('facade-local-dialogue','recordings');
    localStorage.setItem('facade-idle-behavior','false');
    window.microphoneRequests=0;
    navigator.mediaDevices.getUserMedia=async()=>{window.microphoneRequests++;throw Error('Microphone is disabled in this test');};
  });
  const page=await context.newPage();
  page.on('pageerror',error=>result.errors.push(error.stack));
  await page.goto(process.env.GAME_ORIGIN??'http://127.0.0.1:18060/');
  await page.waitForFunction(()=>window.facadeScene?.ready);
  const camera=()=>page.evaluate(()=>({...facadeScene.camera}));
  const origin=await camera();
  await page.keyboard.type('wasd');
  assert.deepEqual(await camera(),origin,'Name entry must not move the camera');
  assert.equal(await page.evaluate(()=>facadeScene.keys.size),0);
  result.checks.push('Name entry keeps letters separate from movement');

  await page.locator('#voice').click();
  await page.waitForFunction(()=>facadeScene.opening.started);
  await page.evaluate(()=>{
    const s=facadeScene;
    s.opening.reset();s.opening.started=true;s.opening.status('apartment','');
    s.ui.confirm();
    for(const actor of s.actors)actor.position=[actor.model.name==='trip'?-100:100,-5,-280];
    s.conversation.controls();
    // Exercise the real input and submit handlers without invoking a model.
    s.conversation.send=async text=>{window.submittedText=text;s.conversation.setDraft('');return true;};
  });
  const place=async(position={x:0,y:97,z:-100,yaw:0})=>{
    await page.locator('#game').focus();
    await page.evaluate(position=>{facadeScene.keys.clear();facadeScene.setCamera(position);},position);
  };
  const idle=async(label)=>{
    const before=await camera();await page.waitForTimeout(150);
    assert.deepEqual(await camera(),before,label);
    assert.equal(await page.evaluate(()=>facadeScene.keys.size),0,label);
    result.checks.push(label);
  };
  const move=async(keys,position)=>{
    await place(position);const before=await camera();
    const started=await page.evaluate(()=>performance.now());
    for(const key of keys)await page.keyboard.down(key);
    await page.waitForTimeout(450);
    for(const key of keys.toReversed())await page.keyboard.up(key);
    const elapsed=await page.evaluate(started=>performance.now()-started,started),after=await camera();
    const motion={keys,before,after,elapsed,distance:Math.hypot(after.x-before.x,after.z-before.z)};
    motion.speed=motion.distance*1000/elapsed;result.movement.push(motion);
    assert.equal(await page.evaluate(()=>facadeScene.conversation.draft),'','Movement must not type dialogue');
    return motion;
  };
  const forward=await move(['KeyW']);assert(forward.after.z<-120&&Math.abs(forward.after.x)<.01);assert.equal(forward.after.yaw,0);
  const back=await move(['KeyS']);assert(back.after.z>-80&&Math.abs(back.after.x)<.01);
  const left=await move(['KeyA']);assert(left.after.yaw<-20);assert.equal(left.distance,0,'A turns in place');
  const right=await move(['KeyD']);assert(right.after.yaw>20);assert.equal(right.distance,0,'D turns in place');
  const turningWalk=await move(['KeyW','KeyD']);assert(turningWalk.after.yaw>20&&turningWalk.after.x>5&&turningWalk.after.z<-120);
  assert(turningWalk.speed/forward.speed>.88&&turningWalk.speed/forward.speed<1.12,'Turning while walking must keep walking speed');
  const turned=await move(['KeyW'],{x:0,y:97,z:-100,yaw:90});assert(turned.after.x>20&&Math.abs(turned.after.z+100)<.02);
  const turnAgain=await move(['KeyD'],{x:0,y:97,z:-100,yaw:90});assert(turnAgain.after.yaw>110);assert.equal(turnAgain.distance,0);
  const arrows=await move(['ArrowRight']);assert(arrows.after.yaw>20);assert.equal(arrows.distance,0);
  const opposed=await move(['KeyW','KeyS','KeyA','KeyD']);assert(opposed.distance<3&&Math.abs(opposed.after.yaw)<3,'Opposing keys cancel');
  result.checks.push('W/S walk, A/D turn in place, arrows still work, walking while turning keeps walking speed, opposing keys cancel');

  await place();await page.keyboard.down('Shift');await page.keyboard.down('KeyD');await page.waitForTimeout(250);
  assert((await camera()).yaw>10);assert.equal((await camera()).x,0);await page.keyboard.up('Shift');await page.keyboard.up('KeyD');
  await idle('Shift release before movement-key release does not stick');

  await place({x:175,y:97,z:50,yaw:90});await page.keyboard.down('KeyW');await page.waitForTimeout(450);await page.keyboard.up('KeyW');
  const wall=await camera();assert(wall.x>177&&wall.x<180);
  assert.equal(await page.evaluate(()=>facadeScene.world.blockers(facadeScene.camera.x,facadeScene.camera.z).length),0);
  result.checks.push('WASD walking respects apartment collisions');

  await place();await page.keyboard.down('KeyW');await page.waitForTimeout(100);await page.keyboard.press('Enter');
  assert(await page.locator('#talk-dialog').isVisible());await page.keyboard.up('KeyW');
  await idle('Entering Talk stops held movement');
  const typingCamera=await camera(),words='WASD was a strange day, Grace.';
  await page.keyboard.type(words);assert.equal(await page.locator('#talk-text').inputValue(),words);
  assert.deepEqual(await camera(),typingCamera,'Typing WASD must not move the player');
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.submittedText),words);
  assert(!await page.locator('#talk-dialog').isVisible());
  result.checks.push('Enter opens Talk; WASD types normally there; Enter submits the exact text');

  await page.keyboard.press('Enter');await page.locator('#talk-text').fill('Trip, a word.');await page.locator('#talk-close').click();
  await page.keyboard.press('Enter');assert.equal(await page.locator('#talk-text').inputValue(),'Trip, a word.');
  await page.locator('#talk-close').click();await page.keyboard.press('Escape');
  result.checks.push('Enter reopens an unfinished draft for editing');

  await place();await page.keyboard.down('KeyW');await page.waitForTimeout(100);await page.locator('#game-menu-button').click();
  await page.keyboard.up('KeyW');await page.keyboard.press('KeyD');await idle('Menus stop movement and ignore WASD');
  await page.locator('#game-menu-close').click();
  await place();await page.keyboard.down('KeyW');await page.waitForTimeout(100);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('KeyW');await idle('Lost window focus clears held movement');

  await place();await page.keyboard.down('KeyW');await page.waitForTimeout(100);
  await page.evaluate(()=>{const input=document.createElement('input');input.id='keyboard-focus-test';document.body.append(input);input.focus();});
  await page.keyboard.up('KeyW');await page.keyboard.type('wasd');
  assert.equal(await page.locator('#keyboard-focus-test').inputValue(),'wasd');
  await idle('Focused text fields stop movement and keep WASD as text');
  await page.locator('#keyboard-focus-test').evaluate(input=>input.remove());await place();
  await page.keyboard.press('Control+KeyA');await idle('Browser keyboard shortcuts do not move the player');
  await page.evaluate(()=>{
    document.getElementById('game').dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',isComposing:true,bubbles:true}));
  });
  await idle('IME composition does not move the player');

  await page.screenshot({path:fileURLToPath(new URL('apartment.png',dir))});
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  assert.equal(await page.evaluate(()=>facadeScene.sample().glError),0);
  result.passed=result.errors.length===0;
}catch(error){result.errors.push(error.stack);result.passed=false;}
finally{await browser.close();await writeFile(new URL('result.json',dir),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({artifactDirectory:fileURLToPath(dir),passed:result.passed,checks:result.checks,errors:result.errors},null,2));
if(!result.passed)process.exitCode=1;
