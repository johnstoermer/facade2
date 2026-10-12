// Deterministic turn routing and narrow first-person plan attribution. This is
// not a general intent classifier: ambiguous meaning stays with the model.
const name='(Trip|Tripp|Trick|Grace)',canonical=value=>/^grace$/i.test(value)?'Grace':'Trip';
const clean=text=>String(text??'').replace(/[\u2018\u2019]/g,"'").trim();
export function guestRouting(value){
 const text=clean(value);
 const exclusive=new RegExp('(?:^|[.!?;:]\\s*)(?:just|only)\\s+'+name+'\\b','i').exec(text)??new RegExp('(?:^|[.!?;:]\\s*)'+name+'\\s+only\\b','i').exec(text);
 const only=exclusive?canonical(exclusive[1]):null;
 // A vocative, not a third-person mention ("Grace told me" or "a trick").
 let address=new RegExp('(?:^|[.!?;:,]\\s*)(?:(?:hey|please|okay|ok|well)\\s*[, ]\\s*)?'+name+'(?=\\s*[,!:]|\\s+(?:I\\b|you\\b|your\\b|what\\b|why\\b|how\\b|can\\b|could\\b|would\\b|will\\b|do\\b|did\\b|are\\b|please\\b))','i').exec(text)
  ??new RegExp(',\\s*'+name+'[.!?]*\\s*$','i').exec(text)
  ??new RegExp('^'+name+'[.!?]*$','i').exec(text);
 // Recognition sometimes omits the vocative comma at the end of a question.
 if(!address&&/\b(?:you|your)\b/i.test(text)){
  const end=new RegExp('\\s+'+name+'[.!?]*$','i').exec(text);
  if(end&&!/\b(?:about|with|to|for|of|from|by|and|ask|tell|see|know|like|love|mention)\s*$/i.test(text.slice(0,end.index)))address=end;
 }
 const collective='(?:both of you|you both|each of you|you two|both|(?:Trip|Tripp|Trick) and Grace|Grace and (?:Trip|Tripp|Trick))';
 const both=!only&&(new RegExp('^\\s*'+collective+'(?:\\s*[,!:]|\\s+(?:please|tell|answer|respond|say|what|how|why|can|could|would|will|do|did|are|have)\\b)','i').test(text)
  ||new RegExp('(?:^|[.!?]\\s*|\\bplease\\s+)(?:what|how|why|when|where|can|could|would|will|do|did|are|have|tell|answer|respond|say)\\b[^.!?]{0,55}\\b'+collective+'\\b','i').test(text));
 return{speaker:only??(address?canonical(address[1]):null),only,both};
}
export function guestIntention(input){
 if(!['speech','continuation',undefined].includes(input.inputType))return null;
 const text=clean(input.text),pattern=/\b(?:I(?: am|'m)\s+(not\s+)?(?:going to|gonna|about to)|I\s+(will not|won't|will)|I'll|I\s+(?:plan|intend)\s+to)\s+([^.!?;]+)/gi;
 let latest=null;
 for(const match of text.matchAll(pattern)){
  // Do not turn a hypothetical or quotation into an announced action.
  const prefix=text.slice(Math.max(text.lastIndexOf('.',match.index-1)+1,text.lastIndexOf('?',match.index-1)+1,text.lastIndexOf('!',match.index-1)+1),match.index);
  if(/\b(?:if|suppose|imagine|whether|said|say|quote)\b|["\u201c]/i.test(prefix))continue;
  const action=match[3].split(/,?\s+but\s+|,?\s+(?:Trip|Tripp|Trick|Grace)\s*,/i)[0].trim();
  if(action)latest={actor:'guest',action:action.slice(0,180),negated:!!match[1]||/not|won't/.test(match[2]??''),status:'announced, not executed'};
 }
 return latest;
}
export function intentionProblems(reply,input){
 const intention=guestIntention(input);
 if(!intention||/\b(?:can|could|would|will) you\b|\bplease\b/i.test(input.text??''))return[];
 const verb=/^[a-z]+/i.exec(intention.action)?.[0]?.toLowerCase();
 if(!verb||/\b(?:with you|alongside you|join you)\b/i.test(reply.text))return[];
 const claimed=new RegExp("\\bI(?:'ll| will| won't| will not| can't| cannot| am going to|'m going to| am not going to|'m not going to)\\s+(?:just\\s+)?"+verb+'\\b','i');
 return claimed.test(clean(reply.text))?['The announced plan belongs to the GUEST. React to them doing it (you/your), rather than saying you will or cannot do their action yourself.']:[];
}
// A narrow guard for immediate verbatim/topic recall, not a semantic evaluator
// for arbitrary questions. The evidence comes from actual player input.
export function immediateRecallProblems(reply,input,recent){
 if(!/\bwhat\s+(?:did|have)\s+I\s+just\s+(?:say|said|ask|asked|tell|told|mention|mentioned|criticiz\w*|request\w*)\b/i.test(input.text??''))return[];
 const previous=recent.findLast(t=>t.kind==='speech'&&t.guest)?.guest;
 if(!previous)return[];
 const stop=new Set('trip tripp trick grace please your yours you youre yourself im ive ill its this that those these the and but for with from have has had was were are am did do dont didnt said say told tell just what which who going would could should will want'.split(' '));
 const terms=[...new Set(clean(previous).toLowerCase().match(/[a-z]{3,}/g)??[])].filter(t=>!stop.has(t));
 if(!terms.length||terms.some(t=>new RegExp('\\b'+t+'(?:s|es)?\\b','i').test(reply.text)))return[];
 return['Answer the immediate recall question using the most recent guest remark, not an older topic. That remark was exactly '+JSON.stringify(previous)+'. Name its specific subject in your answer.'];
}
