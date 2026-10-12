import assert from 'node:assert/strict';
import {guestRouting,guestIntention,intentionProblems,immediateRecallProblems} from '../public/local-dialogue-audition/guest-focus.js';
import {SceneOrchestrator} from '../public/scene-orchestrator.js';
import {DialogueMemory,replyProblems} from '../public/local-dialogue-audition/dialogue-protocol.js';
for(const [text,speaker] of [
 ['Grace, your art sucks.','Grace'],['Trip, I am going to leave.','Trip'],
 ['Tripp, please grab the red wine.','Trip'],['Trick, what do you think?','Trip'],
 ['Hey Trick, I will leave.','Trip'],['I am leaving. Trip, open the door.','Trip'],
 ['What do you think, Grace?','Grace'],['What do you think, Trick?','Trip'],
 ['How are you Grace?','Grace'],['What do you think Trick?','Trip'],['Can you tell me about Grace?',null],['Do you know Trip?',null],
 ['Grace what do you want?','Grace'],['Just Grace, please.','Grace'],['Grace only: answer me.','Grace'],
 ['Trip told me about your painting.',null],['Grace said it is hers.',null],
 ['That is a trick question.',null],['Trick questions are annoying.',null]
])assert.equal(guestRouting(text).speaker,speaker,text);
for(const text of ['I like both of you.','I like you both. I am taking a walk.','Trip told me that Grace and Trip are married.','Grace only: what do you both think?'])assert.equal(guestRouting(text).both,false,text);
for(const text of ['Both of you, how are you?','Both of you please tell me.','What do you both think of that?','How would each of you feel?','Trip and Grace, please listen.','Can both of you tell me?'])assert.equal(guestRouting(text).both,true,text);
for(const text of ['Grace, your art sucks.','Trick, I am going to leave.','I like both of you.']){
 const x=new SceneOrchestrator({text,inputType:'speech'}),speaker=x.firstSpeaker??'Trip';x.add({speaker,text:'I disagree.',handoff:speaker==='Trip'?'Grace':'Trip',actionOutcomes:[]});assert.equal(x.nextInput(null,[]),null,text);
}
const idle=new SceneOrchestrator({text:'',inputType:'idle'});idle.add({speaker:'Grace',handoff:'Trip',actionOutcomes:[{success:false}]});assert.equal(idle.nextInput(null,[]),null);
const failure=new SceneOrchestrator({text:'Grace, grab it.',inputType:'speech'});failure.add({speaker:'Grace',handoff:'Trip',actionOutcomes:[{success:false}]});assert.equal(failure.nextInput(null,[]).replyAs,'Grace');failure.add({speaker:'Grace',actionOutcomes:[{success:false}]});assert.equal(failure.nextInput(null,[]),null);
for(const text of ["If I'm going to leave, would you be upset?","If I were going to leave, would you care?",'Trip, please walk to the window.','You said "I am going to leave."'])assert.equal(guestIntention({text}),null,text);
assert.equal(guestIntention({text:'I am not going to throw the photo. I am going to call a taxi.'}).action,'call a taxi');
assert.equal(guestIntention({text:"I'm not going to drink the red wine."}).negated,true);
assert.equal(guestIntention({text:'I will not drink the red wine.'}).negated,true);
assert.equal(guestIntention({text:'I am going to leave. Trip, could you open the door?'}).action,'leave');
const world={characters:[{name:'Trip',holding:{}},{name:'Grace',holding:{}}],objects:[],recentEvents:[]};
const reply={speaker:'Trip',text:"I'll walk to the window.",actions:[{actor:'Trip',type:'move',target:'window'}],handoff:'none'};
assert(replyProblems(reply,{world,text:'Trip, I will walk to the window.'}).some(p=>p.includes('THEIR action')));
assert(!replyProblems(reply,{world,text:'Trip, please walk to the window.'}).length);
assert(intentionProblems({text:"I can't put your bicycle in the kitchen."},{text:'Grace, I am going to put my bicycle in the kitchen.'}).length);
assert(intentionProblems({text:'You want me to put your bicycle in the kitchen?'},{text:'Grace, I am going to put my bicycle in the kitchen.'}).length);
assert(!intentionProblems({text:"I won't let you throw my photograph away."},{text:'I am going to throw your photograph away.'}).length);
assert(!intentionProblems({text:"I'll walk with you."},{text:'I am going to walk home.'}).length);
const recent=[{kind:'speech',guest:'Trip, your apartment is a showroom.'},{kind:'speech',guest:'Grace, your art sucks.'}],recall={text:'Trip, what did I just criticize?'};
assert(immediateRecallProblems({text:'You criticized my apartment.'},recall,recent).length);
assert(immediateRecallProblems({text:'You criticized the apartment, not my art.'},recall,recent).length);
assert(!immediateRecallProblems({text:"You said Grace's art sucks."},recall,recent).length);
assert(!immediateRecallProblems({text:'The apartment.'},{text:'What did I criticize earlier?'},recent).length);
const reused=[{speaker:'Trip',text:"You're calling a taxi? That's a good idea, I'll help you get ready."}];
assert(replyProblems({speaker:'Grace',text:"You're staying? That's a good idea, I'll help you get ready.",actions:[],handoff:'none'},{text:'Grace, I am staying.'},reused).some(p=>p.includes('stock phrase')));
assert(replyProblems({speaker:'Grace',text:reused[0].text,actions:[],handoff:'none'},{text:'How do you both feel?'},reused).some(p=>p.includes('other spouse')));
assert(!replyProblems({speaker:'Trip',text:reused[0].text,actions:[],handoff:'none'},{text:'Trip, repeat what you said.'},reused).length);
const memory=new DialogueMemory(),input={text:'Trick, I am going to order lunch.',world};
const msg=memory.messages(input).at(-1).content;assert(msg.includes('Speak as Trip'));assert(msg.includes('"actor":"guest","action":"order lunch"'));assert(msg.endsWith(JSON.stringify(input.text)));
memory.add(input,{speaker:'Trip',text:'An invented old story about a zoo.',actions:[]});
const focused=memory.messages({text:'Grace, what did I just say?',world});assert.equal(focused.length,2);assert(focused[1].content.includes('order lunch'));assert(!focused[1].content.includes('zoo'));assert(memory.messagesSoFar.length>0);
const shared=new DialogueMemory(),bothInput={text:'Both of you, I am going to leave.',world};shared.messages(bothInput);shared.add(bothInput,{speaker:'Trip',text:'Unique first spouse wording.',actions:[],handoff:'none'});
const second=shared.messages({...bothInput,inputType:'continuation',replyAs:'Grace',exchange:{bothRequested:true,previous:{speaker:'Trip',text:'Unique first spouse wording.',outcomes:[{success:true,action:{actor:'Trip',type:'pick_up',object:12}}]}}});
assert(!second.some(m=>m.content.includes('Unique first spouse wording.')));assert(second.at(-1).content.includes('pick_up'));assert(second.at(-1).content.includes(bothInput.text));assert(shared.messagesSoFar.some(m=>m.content.includes('Unique first spouse wording.')));
const repair=shared.focusedRepair({...bothInput,replyAs:'Grace'},['A repeated phrase.']);assert.equal(repair.length,2);assert(!repair.some(m=>m.content.includes('Unique first spouse wording.')));assert(repair[1].content.includes('Speak as Grace'));assert(repair[1].content.endsWith(JSON.stringify(bothInput.text)));
console.log('PASS: named and alias routing, third-person mentions, explicit both, no NPC handoffs, bounded failure explanation, negated/conditional guest intentions, actor ownership, latest-input prompt');
