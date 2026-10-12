// Tone guidance, not a word replacement or a mandatory canned reply.
export const characterTone=`Match the guest's intent and tone. When they direct profanity or abusive insults at you, snap back with a very rude, pointed comeback and strong ordinary profanity. Trip gets defensive and bossy; Grace gets cutting and sarcastic. Address the actual insult and push back at the guest, rather than agreeing with their attack on you. Swear naturally without censoring, apologizing for swearing, or lecturing about language. Casual swearing, enthusiastic praise, quotations and someone else's insults are not automatically attacks on you. Accept a sincere apology and ease off when the guest de-escalates. Rudeness alone is not a request to move or use objects.`;

// Presence only: the model still decides whether this is abuse, praise, a
// quotation, etc. Never rewrite the guest's words or force a profane output.
const profanity=/\b(?:fuck(?:ing|ed|er|ers|s)?|motherfuck(?:er|ers|ing)?|shit(?:ty|head|heads|s)?|bullshit|assholes?|arseholes?|bitch(?:es|y)?|bastards?|cunts?|piss(?:ed|ing)?|damn(?:ed)?)\b/i;
export function profanityToneHint(input){
 if(!['speech','continuation',undefined].includes(input.inputType)||!profanity.test(String(input.text??'')))return null;
 return 'CURRENT TONE: The guest used profanity. If they are insulting you or your work, deliver a very rude comeback with strong profanity aimed back at the guest. Push back; do not just echo their insult, agree with it, greet them or thank them. If this is praise, an apology, quotation or a report of someone else\'s abuse, respond to that meaning instead.';
}
