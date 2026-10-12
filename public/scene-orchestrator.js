import {guestRouting} from './local-dialogue-audition/guest-focus.js';
// The guest owns the floor. Model-authored handoffs cannot schedule another NPC.
// A requested second speaker or one failed-action explanation sees real outcomes.
export class SceneOrchestrator {
 constructor(input){this.input=input;this.turns=[];this.state='active';this.started=performance.now();}
 get routing(){return guestRouting(this.input.text);}
 get both(){return this.input.inputType!=='idle'&&this.routing.both;}
 get onlySpeaker(){return this.routing.only;}
 get firstSpeaker(){return this.routing.speaker;}
 nextInput(world,originalLines){
  const last=this.turns.at(-1);let replyAs=last?null:this.firstSpeaker;
  if(last){
   if(this.turns.length>=2||this.input.inputType==='idle')return null;
   const other=last.speaker==='Trip'?'Grace':'Trip';
   if(this.both)replyAs=other;
   else if(last.actionOutcomes?.some(e=>!e.success))replyAs=last.speaker;
   else return null;
  }
  return{...this.input,world,originalLines,replyAs,inputType:last?'continuation':this.input.inputType,
   exchange:{turn:this.turns.length+1,maxTurns:this.both||last?.actionOutcomes?.some(e=>!e.success)?2:1,bothRequested:this.both,onlySpeaker:this.onlySpeaker,reason:last?(this.both?'guest requested both':'explain failed action'):null,previous:last?{speaker:last.speaker,text:last.text,outcomes:last.actionOutcomes??[],delivery:last.spoken?'spoken':'captioned'}:null}};
 }
 add(reply){this.turns.push(reply);}
 finish(state='complete'){this.state=state;this.finished=performance.now();}
}
