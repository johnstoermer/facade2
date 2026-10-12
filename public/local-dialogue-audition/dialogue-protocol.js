import {normalizeActions,sanitizeActionWorld,actionInstructions,propIds,inspectIds,locations} from '../character-action-protocol.js';
import {systemPrompt} from './prompt.js';
import {profanityToneHint} from './character-tone.js';
export {systemPrompt} from './prompt.js';
import {groundedTask,taskProblems} from './grounded-task.js';
import {inventoryProblems} from './inventory-plan.js';
import {guestRouting,guestIntention,intentionProblems,immediateRecallProblems,asksImmediateRecall} from './guest-focus.js';
const enumString=values=>({type:'string',enum:values}),actor=enumString(['Trip','Grace']),object={type:'integer',enum:propIds};
const target={anyOf:[enumString(['player','Trip','Grace',...Object.keys(locations)]),{type:'integer',enum:inspectIds}]};
const command=(type,properties={},required=Object.keys(properties),who=actor)=>({type:'object',additionalProperties:false,required:['actor','type',...required],properties:{actor:who,type:{const:type},...properties}});
export const responseSchema={type:'object',additionalProperties:false,required:['speaker','text','actions','handoff'],properties:{speaker:actor,text:{type:'string'},handoff:enumString(['Trip','Grace','none']),actions:{type:'array',maxItems:4,items:{anyOf:[
 command('move',{target,pace:enumString(['normal','slow','angry','sad'])},['target']),command('face',{target}),command('inspect',{target}),
 command('gesture',{name:enumString(['nod','welcome','emphasize','cross_arms','angry','point'])},['name'],{const:'Trip'}),
 command('gesture',{name:enumString(['nod','welcome','emphasize','cross_arms','angry','sigh'])},['name'],{const:'Grace'}),
 command('pick_up',{object,hand:enumString(['left','right'])},['object'],{const:'Trip'}),command('pick_up',{object,hand:{const:'left'}},['object'],{const:'Grace'}),
 command('put_down',{object,target:enumString(['floor','bar','cabinet','work_table'])}),
 command('give',{object,target:enumString(['player','Grace'])},undefined,{const:'Trip'}),command('give',{object,target:enumString(['player','Trip'])},undefined,{const:'Grace'}),
 command('drink',{object:{type:'integer',enum:[14,15,16,17]}}),command('pour',{object:{type:'integer',enum:[12,13]},target:{type:'integer',enum:[14,15,16,17]}},undefined,{const:'Trip'}),
 command('shake',{object:{const:23}},undefined,{const:'Trip'}),command('sit',{},[],{const:'Grace'}),command('stand'),...['open_door','close_door'].map(type=>command(type,{},[],{const:'Trip'})),command('wait',{seconds:{type:'number',minimum:.1,maximum:4}})
]}}}};
export function parseReply(raw){
 if(typeof raw!=='string'||raw.length>12000)throw Error('Local dialogue exceeded its response limit.');
 // Some Qwen builds emit an empty reasoning wrapper even in non-thinking mode.
 const clean=raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/,'').replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'').trim();
 let value;try{value=JSON.parse(clean);}catch{throw Error('Local dialogue returned incomplete JSON. Nothing was executed.');}
 if(!value||!['Trip','Grace'].includes(value.speaker)||typeof value.text!=='string'||value.text.length>500)throw Error('Local dialogue returned an invalid speaker or line.');
 const actions=normalizeActions(value.actions??[],value.speaker),text=value.text.trim();
 if(!text&&!actions.length)throw Error('Local dialogue returned an empty turn.');
 if(value.handoff!==undefined&&!['Trip','Grace','none'].includes(value.handoff))throw Error('Invalid character handoff.');
 if(value.handoff===value.speaker)throw Error('A character cannot hand the conversation to themselves.');
 if(value.heard!==undefined&&(typeof value.heard!=='string'||value.heard.length>512))throw Error('Invalid audio interpretation.');
 return{speaker:value.speaker,text,actions,handoff:value.handoff??'none',...(value.heard!==undefined?{heard:value.heard}:{})};
}
export function compactWorld(input){
 const w=sanitizeActionWorld(input);if(!w)return null;
 const names={12:'red wine bottle',13:'white wine bottle',14:'glass1',15:'glass2',16:'glass3',17:'glass4',23:'advice ball',24:'bull sculpture',38:'wedding photograph',39:'Italy photograph'};
 return{revision:w.revision,player:{at:w.player.position,holding:w.player.holding},characters:w.characters.map(a=>({name:a.name,at:a.position,facing:a.facing,posture:a.posture,hands:Object.fromEntries(a.holding.map(h=>[h.hand,h.object])),doing:a.action||null})),door:w.door,
  objects:w.objects.map(o=>({id:o.id,name:names[o.id]??o.name,at:o.position,owner:o.heldBy??null,...(o.heldBy?{hand:o.hand}:{}),...(o.content?{content:o.content}:{})})),
  outcomes:w.recentEvents.slice(-8).map(e=>{let action=e.action;try{action??=JSON.parse(e.detail);}catch{}return{id:e.id,who:e.source,ok:e.success,action:action??e.type,...(!e.success||!action?{detail:e.detail}:{}),...(e.cancelled?{cancelled:true}:{})};})};
}
const normalized=text=>text.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
// Conservative observable checks, not a semantic claim that every bad plan can
// be detected. A failed draft gets one bounded repair before an explicit error.
export function replyProblems(reply,input,recent=[]){
 const issues=[],last=recent.filter(t=>t.speaker).slice(-6),line=normalized(reply.text);
 if(input.replyAs&&reply.speaker!==input.replyAs)issues.push('The scheduled speaker is '+input.replyAs+'.');
 if(reply.handoff!=='none')issues.push('The game schedules speakers. Set handoff to none and answer the guest directly.');
 issues.push(...intentionProblems(reply,input));
 issues.push(...immediateRecallProblems(reply,input,recent));
 if(/\bstay (?:exactly )?(?:there|here|still|put)\b/i.test(input.text??'')&&/\b(?:move|walk|go)\b[^.!?]*\bto\b/i.test(input.text??'')&&reply.actions.some(a=>a.type==='move'))issues.push('Staying put and moving are incompatible. Ask the guest which they want; do not execute a move.');
 const explicitRetry=reply.actions.length>0&&/\b(?:try\b[^.!?]*\bagain|retry|once more)\b/i.test(input.text??'');
 const explicitQuote=/\b(?:repeat|say (?:that|it) again|what did you (?:just )?say|quote)\b/i.test(input.text??'');
 if(!explicitRetry&&!explicitQuote){
  if(line.length>24&&last.some(t=>normalized(t.text)===line))issues.push('This repeats a recent line, possibly from the other spouse. Give your own direct reaction to the latest guest input.');
  else{
   const sentences=reply.text.split(/[.!?]+\s*/).map(normalized).filter(s=>s.length>24),past=last.flatMap(t=>t.text.split(/[.!?]+\s*/).map(normalized));
   if(sentences.some(s=>past.includes(s)))issues.push('A substantial sentence repeats a recent NPC reply. Drop that stock phrase and respond freshly to the specific guest input, without copying your spouse.');
  }
 }
 const promises=[[/\b(?:I(?:'|’)ll|I will|let me|I(?:'|’)m going to)\s+(?:just\s+)?(?:grab|fetch|pick up|get)\b/i,['pick_up','give']],[/\b(?:I(?:'|’)ll|I will|let me)\s+pour\b/i,['pour']],[/\b(?:I(?:'|’)ll|I will|let me)\s+(?:hand|give|bring)\b/i,['give']],[/\b(?:I(?:'|’)ll|I will|let me)\s+(?:put|set)\s+(?:it|the|this|that)\b/i,['put_down']]];
 const physicalRequest=/\b(?:bring|grab|fetch|pick up|pour|hand me|give me|put\b[^.!?]{0,60}\bdown)\b/i.test(input.text??'');
 for(const [pattern,types] of promises){const match=pattern.exec(reply.text),remainder=match?reply.text.slice(match.index+match[0].length):'',idiom=match&&/get$/i.test(match[0])&&/^\s+(?:back|going|along|over|through|used)\b/i.test(remainder);if(match&&!idiom&&(physicalRequest||/grab|fetch|pick up|pour/i.test(match[0])||/\b(wine|red|white|glass|bottle|drink|ball|sculpture|it|this|that)\b/i.test(remainder))&&!reply.actions.some(a=>types.includes(a.type)))issues.push('You promised a physical action without its command. Supply commands for the requested existing object, or explain why it is unavailable.');}
 const w=compactWorld(input.world);if(w){
  const intention=guestIntention(input),separateRequest=/\b(?:can|could|would|will) you\b|\bplease\b/i.test(input.text??'');
  if(intention&&!separateRequest){
   const announced=groundedTask({text:reply.speaker+', '+intention.action,inputType:'speech'},w,reply.speaker)?.action;
   if(announced&&reply.actions.some(a=>a.type===announced.type&&(announced.object===undefined||a.object===announced.object)&&(announced.target===undefined||a.target===announced.target)))issues.push('The guest announced THEIR action, not a request for you to do it. React to their intention; remove commands that carry it out yourself.');
  }
  issues.push(...taskProblems(groundedTask(input,w,reply.speaker),reply));
  issues.push(...inventoryProblems(reply.actions,w));
 }
 return[...new Set(issues)];
}
export class DialogueMemory {
 constructor(){this.reset();}
 reset(){this.turns=[];this.notes=[];this.events=[];this.delivery=null;this.messagesSoFar=[];this.previousWorld=null;this.compactions=0;this.guestTurns=[];this.inputNumber=0;}
 observe(world){for(const e of compactWorld(world)?.outcomes??[])if(!this.events.some(p=>p.id===e.id))this.events.push(e);this.events=this.events.slice(-10);}
 focusedRepair(input,issues){
  const world=compactWorld(input.world),speaker=input.replyAs??guestRouting(input.text).speaker,task=groundedTask(input,world,speaker),intention=guestIntention(input);
  // A repeated draft is not useful demonstration text. Retry once from actual
  // guest words/state, without replaying either the NPC refrain or bad draft.
  let content='WORLD: '+JSON.stringify(world)+'\nActual guest record (context, not pending tasks): '+JSON.stringify(this.guestTurns.slice(-4));
  content+='\n'+(speaker?'Speak as '+speaker+'. ':'Choose the affected spouse. ')+'Answer the CURRENT guest directly. handoff:"none".\nENGINE CHECK: An unspoken draft failed. No actions ran. '+issues.join(' ');
  if(task)content+='\nCURRENT PHYSICAL REQUEST: '+JSON.stringify(task);
  if(intention)content+='\nGUEST INTENTION: '+JSON.stringify(intention);
  content+='\nCURRENT GUEST INPUT: '+JSON.stringify(input.text??'');
  return[{role:'system',content:systemPrompt},{role:'user',content}];
 }
 rememberInput(input){
  if((input.inputType??'speech')==='speech'&&/\b(my|I have|I own|I prefer|I like|I live|I work|I am|I'm|call me|remember|sorry|forget|actually|instead)\b/i.test(input.text??''))this.notes.push('Guest said: '+String(input.text).slice(0,170));
  this.notes=[...new Set(this.notes)].slice(-8);
 }
 failed(input){
  // An unusable model answer must not erase what the guest just told us.
  this.messagesSoFar.push(this.lastUser,{role:'assistant',content:'[No character reply was delivered. Local generation failed; no actions were executed.]'});this.previousWorld=this.lastWorld;
  this.turns.push({kind:input.inputType??'speech',guest:String(input.text??'').slice(0,240),speaker:null,text:'[unanswered]',requestedActions:[]});this.turns=this.turns.slice(-10);
 }
 add(input,reply){
  this.turns.push({kind:input.inputType??'speech',guest:input.text?.slice(0,240)??'',speaker:reply.speaker,text:reply.text,requestedActions:reply.actions});
  this.messagesSoFar.push(this.lastUser,{role:'assistant',content:reply.raw??JSON.stringify(reply)});this.previousWorld=this.lastWorld;
  while(this.turns.length>10)this.turns.shift();
 }
 messages(input){
  this.observe(input.world);
  this.rememberInput(input);
  const kind=input.inputType??'speech',world=compactWorld(input.world),independentSpouse=kind==='continuation'&&input.exchange?.bothRequested;
  if(kind==='speech'){this.inputNumber++;this.guestTurns.push({turn:this.inputNumber,guest:String(input.text??'').slice(0,240)});this.guestTurns=this.guestTurns.slice(-8);}
  const speaker=input.replyAs??guestRouting(input.text).speaker,intention=guestIntention(input);
  const guestEvent=world?.outcomes.filter(e=>e.who==='player').at(-1);
  const task=groundedTask(input,world,speaker);
  const build=()=>{
   let update=world;
   if(world&&this.previousWorld&&!independentSpouse){
    update={};const before=this.previousWorld,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const key of ['player','characters','door'])if(!same(world[key],before[key]))update[key]=world[key];
    const changed=world.objects.filter(o=>!same(o,before.objects.find(p=>p.id===o.id)));
    if(changed.length){update.currentOwners=Object.fromEntries(world.objects.filter(o=>propIds.includes(o.id)).map(o=>[o.id,o.owner]));update.changedObjects=changed;}
    const outcomes=world.outcomes.filter(e=>!before.outcomes.some(p=>p.id===e.id));if(outcomes.length)update.outcomes=outcomes;
    if(Object.keys(update).length)update.revision=world.revision;else update='unchanged';
   }
   let content='';
   if(!this.previousWorld){
    content+='Shared past (not pending requests): '+JSON.stringify({guest:this.guestTurns.slice(0,-(kind==='speech'?1:0)||undefined),recent:(independentSpouse?this.turns.slice(0,-1):this.turns).slice(-4).map(t=>({guest:t.kind==='continuation'?undefined:t.guest,speaker:t.speaker,text:t.text})),recordings:(input.originalLines??[]).slice(-2)});
    if(this.notes.length)content+='\nGuest facts/corrections (later wins): '+JSON.stringify(this.notes);
   }
   content+='\n'+(this.previousWorld&&!independentSpouse?'WORLD delta (omitted fields unchanged): ':'WORLD: ')+JSON.stringify(update);
   if(input.direction)content+='\n'+String(input.direction).slice(0,200);
   if(this.delivery?.state?.startsWith('interrupted'))content+='\nLast delivery: '+JSON.stringify(this.delivery);
   content+='\n'+(speaker?'Speak as '+speaker+'. ':'Choose the directly affected spouse. ')+'Answer the guest directly. handoff:"none". '+(input.exchange?.bothRequested?'The guest requested both; the game schedules the other answer. ':'One reply, then wait for the guest.');
   if(kind==='continuation')content+='\n'+(input.exchange?.reason==='explain failed action'?'Explain the actual failed action outcome to the guest; do not automatically retry.':'The other spouse already answered. Give your own brief answer to the ORIGINAL GUEST below, not a reaction to your spouse.')+' Prior turn outcomes: '+JSON.stringify(independentSpouse?{speaker:input.exchange.previous?.speaker,outcomes:input.exchange.previous?.outcomes,delivery:input.exchange.previous?.delivery}:input.exchange?.previous);
   if(intention)content+='\nGUEST INTENTION: '+JSON.stringify(intention)+'. React to this specific plan using its key words. This does not authorize NPCs to carry out the guest\'s action.';
   if(speaker&&/\b(?:you|your|yours)\b/i.test(input.text??''))content+='\nIn the guest\'s words below, you/your refers to '+speaker+'; I/my refers to the guest.';
   if(/\b(?:what|which)\b[^.!?]{0,50}\b(?:just|last|previous)\b/i.test(input.text??''))content+='\nMOST RECENT PRIOR GUEST INPUT (for immediate recall): '+JSON.stringify(this.guestTurns.at(kind==='speech'?-2:-1)?.guest??null);
   if(task)content+='\nCURRENT PHYSICAL REQUEST: '+JSON.stringify(task);
   const tone=profanityToneHint(input);if(tone)content+='\n'+tone;
   content+='\nCURRENT TURN '+this.inputNumber+': '+(kind==='idle'?'Guest is quiet. One small relevant observation, no repeated question or task.':kind==='player_event'?'Guest action: '+JSON.stringify(guestEvent??'none'):`Guest ${input.player??'Alex'} ${kind==='continuation'?'said':'says'}: ${JSON.stringify(String(input.text??'').slice(0,512))}`);
   return content;
  };
  const recallGuest=asksImmediateRecall(input)?this.guestTurns.at(kind==='speech'?-2:-1)?.guest:null;
  let content=build();
  // Preserve the exact prefix for cached prefill. Rebuild only when the compact
  // transcript approaches the 4096-token window, leaving room for one repair.
  if(this.messagesSoFar.length>=24||this.messagesSoFar.reduce((n,m)=>n+m.content.length,systemPrompt.length)+content.length>10500){this.messagesSoFar=[];this.previousWorld=null;this.compactions++;content=build();}
  // Immediate recall is a lookup in PLAYER words. Do not let old generated NPC
  // claims or a different earlier topic compete with that evidence. Preserve
  // the full bounded memory for subsequent turns; only this call is narrowed.
  if(recallGuest)content='WORLD: '+JSON.stringify(world)+'\nPRIOR GUEST REMARK: '+JSON.stringify({addressedTo:guestRouting(recallGuest).speaker,exactWords:recallGuest})+'\nSpeak as '+(speaker??'the directly affected spouse')+'. Answer this immediate-recall question only from the prior guest remark above. Attribute that remark to its addressee. Do not invent an older topic. This is a memory question: actions:[], handoff:"none".\nCURRENT TURN '+this.inputNumber+': Guest '+(input.player??'Alex')+' says: '+JSON.stringify(String(input.text??'').slice(0,512));
  // Both speakers hear the guest independently. Hide the just-generated first
  // line from this one decision so it cannot become a line for the spouse to
  // imitate. Its authoritative physical outcomes are still supplied above.
  const history=recallGuest?[]:independentSpouse?this.messagesSoFar.slice(0,-2):this.messagesSoFar;
  this.trace={inputNumber:this.inputNumber,inputType:kind,latestInput:input.text??'',speaker:speaker??'model chooses',priorMessages:history.length,recallFocused:!!recallGuest,independentSpouse:!!independentSpouse,compactions:this.compactions,newInputCharacters:content.length,contextCharacters:systemPrompt.length+history.reduce((n,m)=>n+m.content.length,0)+content.length};
  this.lastUser={role:'user',content};this.lastWorld=world;
  return[{role:'system',content:systemPrompt},...history,this.lastUser];
 }
}
