// Budget longer answers when invited, without turning every acknowledgement or
// action request into a monologue. The model still chooses its own wording.
export const maxReplyCharacters=1400;
export const maxBackstoryCharacters=1600;
export function conversationStyle(input={}){
 const text=String(input.text??'');
 if(['idle','player_event'].includes(input.inputType)||input.exchange?.reason==='explain failed action')return{mode:'brief',maxTokens:280,hint:'Keep this reaction brief and relevant.'};
 if(/^(?:(?:trip|grace)[,:\s]+)?(?:thanks(?: a lot| so much)?|thank you(?: very much)?)(?:[,:\s]+(?:trip|grace))?[.!\s]*$/i.test(text))return{mode:'acknowledge',maxTokens:160,hint:'The guest is simply thanking you. Acknowledge them warmly or dryly in one short sentence, without reopening the previous story. actions:[]'};
 if(/\b(?:one|single)\s+sentence\b|\b(?:briefly|short answer|keep it short)\b/i.test(text))return{mode:'brief',maxTokens:280,hint:'The guest wants a short answer: one natural sentence.'};
 if(/\b(?:tell|share|recount|describe|invent|make up)\b[^.!?]{0,80}\b(?:story|stories|backstory|childhood|grew up|first date|how you met|your past|memory|memories|dream)\b|\b(?:what was your childhood like|how did you (?:two )?meet)\b/i.test(text))return{mode:'story',maxTokens:560,hint:'The guest invites a personal story. Tell it with specific people, places and events, about 60-120 words when useful, and why it matters to you. Do not merely promise to tell it. Preserve previously established details.'};
 if(/\b(?:tell me more|go on|elaborate|in detail)\b/i.test(text))return{mode:'expand',maxTokens:560,hint:'Develop the topic the guest asks about, about 60-120 words when useful. Add relevant details instead of repeating the previous answer. Personal history may be invented consistently; real-world explanations must remain factual.'};
 if(/\b(?:where|when|who|which)\b|\b(?:remind me|what (?:did|was|were|inspired|happened))\b/i.test(text)&&!/\bexplain\b/i.test(text))return{mode:'brief',maxTokens:280,hint:'Answer this specific follow-up in 1-2 short sentences, about 15-35 words. When asked what was already said, recall only established details; say if the requested detail was not mentioned. Do not invent a replacement memory or retell the whole story.'};
 if(/\b(?:explain|teach me|help me understand|why (?:does|do|is|are)|how (?:does|do)|what (?:is|are))\b/i.test(text))return{mode:'explain',maxTokens:440,hint:'Answer the actual question with a clear explanation and a useful example if it helps, in 2-5 conversational sentences. General questions are welcome; do not redirect them to your marriage or refuse because the topic is absent from WORLD.'};
 return{mode:'natural',maxTokens:320,hint:'Use a natural conversational length. A quick exchange can be 1-2 sentences; develop an interesting point when it helps. Do not force every answer into a tiny line.'};
}
