// Narrow aid for unambiguous, directly addressed physical requests. This is not
// a general natural-language parser and never executes actions. The model still
// has to return a validated plan; ambiguous speech remains a dialogue decision.
export function unresolvedObjectRequest(input,world){
 if(!world||['idle','player_event','continuation'].includes(input.inputType))return null;
 const text=String(input.text??'').trim().replace(/^(?:Trip|Tripp|Trick|Grace)\b[,!\s]*/i,'').replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i,'');
 const match=/^(?:pick up|grab|fetch|get|put down|put|set down|give|bring|pour|drink|shake)\s+(.+)/i.exec(text);
 if(!match||/\b(?:and|then)\b/i.test(text))return null;
 const noun=match[1].replace(/^(?:me|us)\s+/i,'').split(/\s+(?:from|to|on|onto|into|in|at|with|for)\s+/i)[0].replace(/[.!?]+$/,'').replace(/^(?:(?:a|an|the|my|your|our|his|her)\s+)+/i,'').toLowerCase().trim();
 if(!noun||/^(?:it|this|that|them|one|something|anything)$/i.test(noun))return null;
 // "Give me an explanation" and similar requests are conversation, not missing
 // inventory. Leave them to the dialogue model without the physical-item gate.
 if(/^(?:(?:some|another|brief|quick|detailed|short|long|honest|personal)\s+)*(?:advice|explanation|answer|example|opinion|reason|summary|rundown|history|story|backstory|idea|insight|recommendation|lesson|definition|question|hint|perspective|context|information|info|argument|proof|description|joke)s?\b/i.test(noun)||/^up to (?:speed|date)\b/i.test(noun))return null;
 const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,''),key=normalize(noun);
 const exact=world.objects.some(o=>normalize(o.name)===key||key==='object'+o.id);
 const aliases=[[/^red(?: wine)?(?: bottle)?$/, [12]],[/^white(?: wine)?(?: bottle)?$/, [13]],[/^(?:wine|bottle|wine bottle)$/, [12,13]],[/^(?:martini )?glass$/, [14,15,16,17]],[/^(?:advice|magic|eight|8)[ -]?ball$/, [23]],[/^(?:brass )?bull(?: sculpture)?$/, [24]]];
 const known=exact||aliases.some(([pattern,ids])=>pattern.test(noun)&&world.objects.some(o=>ids.includes(o.id)))||/^glass\s*(1[4-7])$/.test(noun)&&world.objects.some(o=>o.id===Number(noun.match(/\d+/)[0]));
 if(known)return null;
 return{requested:noun,instruction:'This named item cannot be matched to an available WORLD object. It may exist in a story, but no story creates an item here. Explain that you cannot provide/use it here or ask which available item the guest means. Do not substitute a trinket, invent its location, promise to fetch it, or issue actions. actions:[]'};
}
export function groundedTask(input,world,speaker=input.replyAs){
 if(!world||input.inputType==='continuation'||input.inputType==='idle'||input.inputType==='player_event')return null;
 let text=String(input.text??'').trim();const address=/^(Trip|Tripp|Trick|Grace)\b[,!\s]*/i.exec(text);
 if(address){speaker=/^grace$/i.test(address[1])?'Grace':'Trip';text=text.slice(address[0].length);}
 if(!['Trip','Grace'].includes(speaker))return null;
 text=text.replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i,'');
 if(/\b(?:and|then)\b/i.test(text))return null; // multi-step or contradictory: leave to model
 const match=/^(pick up|grab|fetch|get|put down|put|set down|give|bring|pour|drink|shake|walk|go|move|face|sit|stand)\b/i.exec(text);if(!match)return null;
 const verb=match[1].toLowerCase(),rest=text.slice(match[0].length),held=world.objects.filter(o=>o.owner===speaker);
 let object=/\bred\b/i.test(rest)?12:/\bwhite\b/i.test(rest)?13:/\b(?:advice|magic|eight|8)[ -]?ball\b/i.test(rest)?23:null;
 object??=Number(/\b(?:glass|object)\s*(1[4-7]|2[3-9]|3[0-2])\b/i.exec(rest)?.[1])||null;
 if(object===null&&/\b(?:it|bottle|glass|ball)\b/i.test(rest)){const candidates=held.filter(o=>/bottle/i.test(rest)?[12,13].includes(o.id):/glass/i.test(rest)?[14,15,16,17].includes(o.id):/ball/i.test(rest)?o.id===23:true);if(candidates.length===1)object=candidates[0].id;}
 const place=/\b(window|bar|cabinet|couch|center|doorway|work table)\b/i.exec(rest)?.[1]?.toLowerCase().replace(' ','_');
 let action;
 if(['pick up','grab','fetch','get'].includes(verb)&&object)action={actor:speaker,type:'pick_up',object};
 if(['put down','put','set down'].includes(verb)&&object&&(/\bdown\b/i.test(text)||place))action={actor:speaker,type:'put_down',object,target:place??'floor'};
 if(['give','bring'].includes(verb)&&object){const recipient=/\bto (Trip|Grace)\b/i.exec(rest)?.[1],target=recipient?recipient[0].toUpperCase()+recipient.slice(1).toLowerCase():/\bme\b/i.test(rest)?'player':null;if(target)action={actor:speaker,type:'give',object,target};}
 if(['walk','go','move'].includes(verb)&&place)action={actor:speaker,type:'move',target:place};
 if(verb==='face'&&/\bme\b/i.test(rest))action={actor:speaker,type:'face',target:'player'};
 if(['shake','drink'].includes(verb)&&object)action={actor:speaker,type:verb,object};
 if(verb==='pour'&&object){const glass=Number(/\bglass\s*(1[4-7])\b/i.exec(rest)?.[1]);if(glass)action={actor:speaker,type:'pour',object,target:glass};}
 if(verb==='sit'&&speaker==='Grace')action={actor:speaker,type:'sit'};
 if(verb==='stand')action={actor:speaker,type:'stand'};
 if(!action)return null;
 const prop=world.objects.find(o=>o.id===object),person=world.characters.find(a=>a.name===speaker);let blocked=null,already=false;
 if(prop?.owner&&prop.owner!==speaker)blocked='Object '+object+' is held by '+prop.owner+'. Do not take it from them or claim it is on furniture.';
 if(['put_down','give','drink','pour','shake'].includes(action.type)&&prop?.owner!==speaker)blocked??=speaker+' must first pick up object '+object+' with a usable hand.';
 if(action.type==='drink'&&prop?.content==='empty')blocked='The glass is empty. It cannot be drunk.';
 if(action.type==='pick_up'&&prop?.owner===speaker)already=true;
 if(action.type==='sit'&&person?.posture==='sitting'||action.type==='stand'&&person?.posture==='standing')already=true;
 return{action,...(prop?{currentObject:{id:prop.id,owner:prop.owner??null,hand:prop.hand??null,content:prop.content??null}}:{}),hands:person?.hands,...(already?{alreadySatisfied:true}:{}),...(blocked?{constraint:blocked}:{}),instruction:already?'Acknowledge current state; do not repeat this action.':'Fulfil this specific request, using prerequisites if needed. Do not substitute a different task. Actual execution may still fail; report its outcome next turn.'};
}
export function taskProblems(task,reply){
 if(!task)return[];const a=task.action;
 if(task.alreadySatisfied)return reply.actions.some(x=>x.type===a.type&&x.object===a.object)?['This request is already satisfied. Do not repeat the action.']:[];
 if(task.constraint&&!/must first pick up/.test(task.constraint))return[];
 const matching=reply.actions.some(x=>x.actor===a.actor&&x.type===a.type&&(a.object===undefined||x.object===a.object)&&(a.target===undefined||x.target===a.target));
 const refusal=/\b(?:I|we)\s+(?:won't|will not|can't|cannot|don't want|do not want)|\b(?:I'd|I would) rather not\b/i.test(reply.text);
 if(!matching&&!refusal)return['If accepting the physical request, include '+JSON.stringify(a)+'. Otherwise clearly decline it; do not substitute another promise or unrelated gesture.'];
 if(a.type==='pick_up'&&reply.actions.some(x=>['pour','drink','give','shake','put_down'].includes(x.type)))return['Only pickup was requested. Do not pour, drink, give away or put down the requested object.'];
 return[];
}
