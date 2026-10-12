import test from 'node:test';
import assert from 'node:assert/strict';
import {DialogueMemory,parseReply,replyProblems} from '../public/local-dialogue-audition/dialogue-protocol.js';
import {conversationStyle,maxReplyCharacters} from '../public/local-dialogue-audition/conversation-policy.js';
import {speechChunks} from '../public/browser-character-voice.js';
import {unresolvedObjectRequest} from '../public/local-dialogue-audition/grounded-task.js';

const world={revision:1,player:{position:[0,97,-160],holding:null},characters:[{name:'Trip',holding:{}},{name:'Grace',holding:{}}],objects:[],recentEvents:[]};
const input={text:'Trip, tell me about your first date with Grace.',world};
const reply={speaker:'Trip',text:'We met at a closed observatory in Bellwick. Grace drew the moon on my ticket.',actions:[],handoff:'none'};

test('story and explanation budgets expand only when invited; brevity still wins',()=>{
 assert.equal(conversationStyle(input).mode,'story');
 assert.equal(conversationStyle({text:'Grace, explain why ice floats.'}).mode,'explain');
 assert.equal(conversationStyle({text:'Grace, where was your first date?'}).mode,'brief');
 assert.equal(conversationStyle({text:'Trip, give me the ticket from your first date.'}).mode,'natural');
 assert.equal(conversationStyle({text:'Grace, tell me more about photosynthesis.'}).mode,'expand');
 assert.equal(conversationStyle({text:'Trip, one sentence about your first date.'}).mode,'brief');
 assert.equal(conversationStyle({text:'Grace, thanks.'}).mode,'acknowledge');
 assert.equal(conversationStyle({text:'Thanks, but explain why ice floats.'}).mode,'explain');
 assert.equal(conversationStyle({text:'Tell a story.',inputType:'idle'}).mode,'brief');
});
test('long anecdotes remain intact and every word can pass through bounded voice chunks',()=>{
 const text=('I remember the old observatory, its broken clock, and the rain on our coats. ').repeat(12);
 assert(text.length>500&&text.length<maxReplyCharacters);
 assert.equal(parseReply(JSON.stringify({...reply,text})).text,text.trim());
 const chunks=speechChunks(text);assert(chunks.length>4);assert(chunks.every(c=>c.text.length<=160));
 assert.equal(chunks.map(c=>c.text).join(' ').replace(/\s+/g,' ').trim(),text.trim());
 assert.throws(()=>parseReply(JSON.stringify({...reply,text:'a'.repeat(maxReplyCharacters+1)})),/invalid speaker or line/);
});
test('only delivered fiction survives history compaction and is shared with the other speaker',()=>{
 const memory=new DialogueMemory();memory.messages(input);memory.add(input,reply);
 assert.equal(memory.backstory.length,0);
 memory.observe(world,{speaker:'Trip',text:reply.text,state:'spoken'});
 assert.equal(memory.backstory.length,1);
 for(let i=0;i<12;i++){const next={world,text:'Short topic '+i};memory.messages(next);memory.add(next,{speaker:'Grace',text:'A different reply '+i,actions:[]});}
 const messages=memory.messages({world,text:'Grace, where did you and Trip have your first date?'});
 assert(memory.compactions>0);assert(messages.at(-1).content.includes('Bellwick'));assert.equal(memory.backstory[0].speaker,'Trip');
 assert(memory.focusedRepair({world,text:'Grace, tell me more.'},['Repeated phrase']).some(m=>m.content.includes('Bellwick')));
 assert.equal(world.objects.length,0);assert.deepEqual(replyProblems(reply,input),[]);
 assert.deepEqual(replyProblems(reply,{world,text:'Trip, remind me where your first date happened.'},[reply]),[]);
});
test('unheard, interrupted or unrelated deliveries do not commit new history; reset clears it',()=>{
 for(const delivery of [{speaker:'Trip',state:'interrupted'},{speaker:'Grace',text:reply.text,state:'spoken'},{speaker:'Trip',text:'Another line.',state:'captioned'}]){
  const memory=new DialogueMemory();memory.messages(input);memory.add(input,reply);memory.observe(world,delivery);assert.equal(memory.backstory.length,0);
  if(delivery.state==='interrupted')assert(!JSON.stringify(memory.messages({world,text:'What happened?'})).includes('Bellwick'));
 }
 const memory=new DialogueMemory();memory.messages(input);memory.add(input,reply);memory.observe(world,{speaker:'Trip',text:reply.text,state:'captioned'});memory.reset();assert.deepEqual(memory.backstory,[]);
});
test('bare thanks closes a story without injecting it again; future recall still has it',()=>{
 const memory=new DialogueMemory();memory.messages(input);memory.add(input,reply);memory.observe(world,{speaker:'Trip',text:reply.text,state:'spoken'});
 const thanks={world,text:'Grace, thanks.'},messages=memory.messages(thanks);
 assert.equal(messages.length,2);assert(!JSON.stringify(messages).includes('Bellwick'));
 assert(!JSON.stringify(memory.focusedRepair(thanks,['Repeated phrase'])).includes('Bellwick'));
 assert.equal(memory.backstory.length,1);
 assert(memory.storyContext({text:'Where was your first date?'}).includes('Bellwick'));
 assert.equal(memory.storyContext({text:'Explain photosynthesis.'}),'');
});
test('fiction stays bounded and cannot create usable objects or bypass action validation',()=>{
 const memory=new DialogueMemory();
 for(let i=0;i<12;i++){const line={...reply,text:'In childhood I owned imaginary object '+i};memory.messages(input);memory.add(input,line);memory.observe(world,{speaker:'Trip',text:line.text,state:'spoken'});}
 assert.equal(memory.backstory.length,8);assert.equal(world.objects.length,0);
 assert.throws(()=>parseReply(JSON.stringify({...reply,actions:[{actor:'Trip',type:'pick_up',object:999}]})),/Unknown movable object/);
 assert(memory.storyContext(input).length<1900);
});
test('several long stories do not refill the prompt with four full old monologues',()=>{
 const memory=new DialogueMemory();
 for(let i=0;i<8;i++){const line={...reply,text:('We visited the observatory and watched a meteor shower. ').repeat(20)+i};memory.messages(input);memory.add(input,line);memory.observe(world,{speaker:'Trip',text:line.text,state:'spoken'});}
 const prompt=memory.messages({world,text:'Trip, tell me more about that story.'});
 assert(memory.compactions>0);assert(prompt.reduce((n,m)=>n+m.content.length,0)<10000);
 assert(prompt.some(m=>m.content.includes('observatory')));
});
test('a story ticket cannot be substituted with a real trinket; real objects and storytelling remain allowed',()=>{
 const physical={...world,objects:[{id:12,name:'red wine bottle',heldBy:null},{id:30,name:'trinket 6',heldBy:null}]};
 const compact={objects:physical.objects.map(o=>({...o,owner:o.heldBy})),characters:[]};
 for(const text of ['Trip, give me the ticket from your first date.','Grace, fetch the red ticket.','Trip, please bring me the bicycle.']){
  assert(unresolvedObjectRequest({text},compact));
  assert(replyProblems({speaker:'Trip',text:'I will bring it.',actions:[{actor:'Trip',type:'pick_up',object:30}],handoff:'none'},{text,world:physical}).some(p=>p.includes('Do not substitute')));
 }
 for(const text of ['Trip, grab the red wine.','Trip, pick up trinket 6.','Trip, tell me a story about a ticket.','I am going to get my bicycle.','Grace, give me a detailed explanation of gravity.','Trip, give me some advice.','Grace, give me a story about your childhood.'])assert.equal(unresolvedObjectRequest({text},compact),null,text);
});
