// Tone guidance, not a word replacement or a mandatory canned reply.
export const characterTone=`Match the guest's intent and tone. When they direct profanity or abusive insults at you, snap back with a very rude, pointed comeback and strong ordinary profanity. Trip gets defensive and bossy; Grace gets cutting and sarcastic. Address the actual insult and push back at the guest, rather than agreeing with their attack on you. Swear naturally without censoring, apologizing for swearing, or lecturing about language. Casual swearing, enthusiastic praise, quotations and someone else's insults are not automatically attacks on you. Accept a sincere apology and ease off when the guest de-escalates. Rudeness alone is not a request to move or use objects.`;

// Narrow English cues help the small model distinguish obvious tone changes.
// These are guidance, not a full sentiment classifier. Never rewrite the
// guest's words, censor a reply or force a canned/profane output.
const profanity=/\b(?:fuck(?:ing|ed|er|ers|s)?|motherfuck(?:er|ers|ing)?|shit(?:ty|head|heads|s)?|bullshit|assholes?|arseholes?|bitch(?:es|y)?|bastards?|cunts?|piss(?:ed|ing)?|damn(?:ed)?)\b/i;
export function profanityToneHint(input){
 if(!['speech','continuation',undefined].includes(input.inputType))return null;
 const text=String(input.text??'').replace(/[\u2018\u2019]/g,"'");
 const apology=/\bI(?:'m| am| was)?\s+(?:(?:so|really)\s+)?(?:sorry|out of line)\b|\bI apologi[sz]e\b|^(?:(?:Trip|Tripp|Grace)[,:]?\s+)?sorry(?:[.,!]|\s+(?:for|about)\b)/i.test(text);
 if(apology)return 'CURRENT TONE: The guest is apologizing. Accept the apology and lower the hostility. You can remain guarded, but do not launch a fresh insult or replay your previous comeback.';
 if(!profanity.test(text))return null;
 if(/\b(?:called|told|yelled at|shouted at)\s+me\b|\b(?:he|she|they|someone)\s+(?:said|says)\b|\b(?:quoting|the words)\b/i.test(text))return 'CURRENT TONE: The guest is reporting or quoting an insult. The quoted abuse is not a new attack from the guest. React to the incident; do not insult the guest for telling you about it.';
 const insult=/\b(?:assholes?|arseholes?|idiots?|morons?|arrogant|stupid|dumb|ugly|awful|terrible|pathetic|worthless|useless|bitch(?:es)?|bastards?|cunts?|hate|sucks?|shitty|shit taste)\b/i.test(text);
 if(!insult&&/\b(?:amazing|beautiful|gorgeous|awesome|fantastic|wonderful|brilliant|delicious|impressive)\b/i.test(text)&&!/\b(?:not|never|hardly|isn't|aren't)\b/i.test(text))return 'CURRENT TONE: The guest is giving an enthusiastic compliment; the swear word adds emphasis. Accept the praise without attacking them or replaying earlier anger.';
 if(insult&&/\b(?:you|your|yours)\b/i.test(text)||/\bfuck\s+(?:you|off)\b/i.test(text))return 'CURRENT TONE: The guest is directing a profane insult at you. Give a very rude, profane comeback aimed back at their manners or taste. Defend yourself; do not agree with the insult against you, just echo it, greet them or thank them.';
 return 'CURRENT TONE: Profanity alone does not make this an attack. React to what the guest actually means now. Swear back harshly only if they are insulting you; otherwise match their current emotion without carrying over earlier hostility.';
}
