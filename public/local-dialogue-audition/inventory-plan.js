import {preferredPickupHand} from '../character-action-protocol.js';
// Predict inventory preconditions only. Reachability, animation and concurrent
// player changes still require the authoritative live executor.
export function inventoryProblems(actions,world){
 const issues=[],objects=new Map(world.objects.map(o=>[o.id,{...o}])),hands=Object.fromEntries(world.characters.map(a=>[a.name,{...a.hands}]));let playerHolding=world.player.holding;
 const remove=o=>{if(hands[o.owner]&&o.hand)hands[o.owner][o.hand]=null;else if(o.owner==='player')playerHolding=null;o.owner=o.hand=null;};
 for(const a of actions){
  const o=objects.get(a.object),h=hands[a.actor];if(!h)continue;
  if(a.type==='pick_up'&&o){
   if(o.owner){issues.push('Object '+o.id+' is already held by '+o.owner+'.');continue;}
   const hand=preferredPickupHand(a.actor,o.id,h,a.hand);
   if(h[hand]!=null){issues.push(a.actor+' needs the '+hand+' hand free before picking up '+o.id+'. Put its current object down first.');continue;}
   h[hand]=o.id;o.owner=a.actor;o.hand=hand;
  }
  if(['put_down','give','pour','drink','shake'].includes(a.type)&&o){
   if(o.owner!==a.actor){issues.push(a.actor+' must hold object '+o.id+' before '+a.type+'.');continue;}
   if(a.type==='put_down')remove(o);
   if(a.type==='give'){
    if(o.hand!=='left'){issues.push('Give requires the LEFT hand. Put object '+o.id+' down and pick it up in the left hand first.');continue;}
    const target=hands[a.target],hand=target?preferredPickupHand(a.target,o.id,target):null;
    if(target?target[hand]!=null:playerHolding!=null){issues.push(a.target+' has no free hand for the gift.');continue;}
    remove(o);o.owner=a.target;o.hand=hand;if(target)target[hand]=o.id;else playerHolding=o.id;
   }
   if(a.type==='drink'){
    if(o.content==='empty')issues.push('Glass '+o.id+' is empty.');
    if(o.hand!==(a.actor==='Trip'?'right':'left'))issues.push(a.actor+' must drink from the '+(a.actor==='Trip'?'RIGHT':'LEFT')+' hand; put the glass down and pick it up in that hand first.');
    o.content='empty';
   }
   if(a.type==='pour'){const glass=objects.get(a.target);if(glass?.owner&&glass.owner!==a.actor)issues.push('The glass belongs to '+glass.owner+'.');else if(glass)glass.content=o.id===12?'red wine':'white wine';}
  }
  if(a.type==='sit'&&(h.left!=null||h.right!=null))issues.push('Put held objects down before sitting.');
  if(a.type==='gesture'&&a.name==='cross_arms'&&(h.left!=null||h.right!=null))issues.push('Crossing arms requires empty hands. Use another gesture.');
  if(['open_door','close_door'].includes(a.type)&&h.right!=null)issues.push('Trip needs his right hand free to operate the door.');
 }
 return issues;
}
