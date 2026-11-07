/**
 * Follow-up questions and their contextual answers.
 *
 * The first version of the chain only ever offered a bare "Why?". That reads
 * like a survey, not a conversation. This module replaces the single follow-up
 * with ten distinct conversational moves, each with many natural phrasings and
 * answers that change with the protagonist's real state.
 *
 * Every answer is narration derived from canonical facts (mood, role, time,
 * place, personality, activity). Nothing here invents resources, possessions,
 * titles or events, and nothing writes world state.
 */
import type { DialogueContextFacts, TopicVariant } from "./dialogue-topics.ts";

export type FollowUpId =
  | "reason"
  | "detail"
  | "feelings"
  | "help"
  | "others"
  | "duration"
  | "blame"
  | "consequence"
  | "past"
  | "need";

export type FollowUpDef = {
  readonly id: FollowUpId;
  /** Natural ways a player might ask this. Deliberately varied in register. */
  readonly asks: readonly string[];
  readonly variants: readonly TopicVariant[];
};

/**
 * The conversational moves. Phrasings range from blunt to gentle, because a
 * player should not have to sound like a form.
 */
export const FOLLOWUPS: readonly FollowUpDef[] = Object.freeze([
  {
    id: "reason",
    asks: [
      "why", "why is that", "why so", "what makes you say that", "why do you feel that way",
      "how come", "what is the reason", "why is it like that", "and why is that", "why though",
    ],
    variants: [
      { when: { mood: "miserable" }, text: "Because it has been like this a while now, and nothing I do moves it.", cause: "When effort stops changing anything, a body stops expecting it to." },
      { when: { mood: "grumpy" }, text: "Because I am tired of being asked to explain myself, if you want the truth.", cause: "A short temper is usually a long day wearing someone down." },
      { when: { time: "night" }, text: "Because it is late and I have not stopped moving since dawn.", cause: "Nights are for things you did not finish during the day." },
      { when: { role: "farmer" }, text: "The land and the weather decide it, not me. I only turn up.", cause: "Some things are simply larger than the person living through them." },
      { text: "Because it is the honest answer, and you did ask.", cause: "I would rather say a plain thing than a pleasing one." },
    ],
  },
  {
    id: "detail",
    asks: [
      "tell me more", "go on", "what happened", "what exactly happened", "explain that",
      "and then what", "what do you mean", "say more about that", "what else", "keep going",
    ],
    variants: [
      { when: { travelling: true }, text: "Mostly walking. One road, then another, and the light going as I go.", cause: "Travel is long stretches of nothing interrupted by small worries." },
      { when: { role: "guard" }, text: "Standing, watching, counting who passes. A gate is dull until the moment it is not.", cause: "Nothing happens at a gate for hours, and then everything happens at once." },
      { when: { indoors: true }, text: "It is indoors work and it does not make for good stories.", cause: "The interesting part of most work is the part nobody sees." },
      { text: "There is not much to tell. Days here look alike, and I have made my peace with that.", cause: "A quiet life is not the same as an empty one." },
    ],
  },
  {
    id: "feelings",
    asks: [
      "how does that make you feel", "and how do you feel about it", "does that bother you",
      "are you angry about it", "does it upset you", "how do you carry that",
      "is that hard on you", "does it weigh on you",
    ],
    variants: [
      { when: { mood: "miserable" }, text: "Heavy. There is no better word for it than that.", cause: "Feelings that have nowhere to go tend to settle in the shoulders." },
      { when: { mood: "grumpy" }, text: "It makes me short with people who have not earned it. I know that much.", cause: "Anger is easier to carry than the thing underneath it." },
      { when: { temper: "hot" }, text: "Angry, mostly. I would rather be angry than frightened.", cause: "Anger at least feels like doing something." },
      { when: { sociability: "low" }, text: "I keep it to myself. That is not the same as it not being there.", cause: "Quiet people feel things just as loudly." },
      { text: "It sits with me. I would not call it heavy, but it does not leave.", cause: "Most things in a life are carried rather than solved." },
    ],
  },
  {
    id: "help",
    asks: [
      "what would help", "can i help", "what do you need", "how can i help you",
      "is there anything i can do", "what would make it better", "do you want help",
      "shall i do something", "what would you have me do",
    ],
    variants: [
      { when: { mood: "miserable" }, text: "Honestly? A day where nothing else goes wrong. That is all I am asking of the world.", cause: "When someone is worn thin, small mercies matter more than grand ones." },
      { when: { role: "farmer" }, text: "Hands at harvest, if you have them. Otherwise, do not promise rain you cannot deliver.", cause: "Practical help is the only kind that reaches a field." },
      { when: { role: "guard" }, text: "Keep your affairs lawful and your voice down after dark. That is a real help to a guard.", cause: "Half a guard's work is undone by other people's noise." },
      { when: { time: "night" }, text: "Let me sleep. That is the whole of what I need tonight.", cause: "Tomorrow comes whether or not anyone is rested for it." },
      { text: "Nothing you could hand me. But it helps to have been asked.", cause: "Being asked is not the same as being helped, and it is not nothing." },
    ],
  },
  {
    id: "others",
    asks: [
      "who else knows", "does anyone else know", "have you told anyone", "who have you told",
      "what do the others say", "does your family know", "who would you tell",
      "is it just you", "does anyone share this",
    ],
    variants: [
      { when: { sociability: "high" }, text: "Half the street by now, I should think. Nothing stays quiet here long.", cause: "In a place this size, a secret is only a story that has not travelled yet." },
      { when: { sociability: "low" }, text: "Nobody. And I would thank you not to make it otherwise.", cause: "I have learned what people do with a confidence." },
      { when: { role: "guard" }, text: "The other guards, and the one who signs our wages. That is as far as it goes.", cause: "A guard's troubles travel up the chain, not across the market." },
      { text: "A few people, the ones who would need to know. Not the ones who would only enjoy hearing it.", cause: "There is a difference between telling someone and feeding them." },
    ],
  },
  {
    id: "duration",
    asks: [
      "how long has it been like this", "since when", "when did that start",
      "how long ago was that", "has it been long", "is this new", "when did it begin",
      "how long have you felt this way",
    ],
    variants: [
      { when: { ageGroup: "elder" }, text: "Long enough that I have stopped counting. That is a strange thing to admit.", cause: "Years pass quietly when nothing marks them." },
      { when: { mood: "miserable" }, text: "Since the last bad season. It has not lifted properly since.", cause: "Some winters do not end when the weather turns." },
      { when: { time: "night" }, text: "Since this morning, if you mean today. Longer, if you mean the rest of it.", cause: "A day and a life can both be described as long." },
      { text: "A while now. Long enough that it feels less like a problem and more like weather.", cause: "Things endured long enough stop being events and become conditions." },
    ],
  },
  {
    id: "blame",
    asks: [
      "whose fault is it", "who is to blame", "who caused this", "is someone responsible",
      "who did this to you", "was it your doing", "do you blame anyone",
      "who should answer for it",
    ],
    variants: [
      { when: { temper: "hot" }, text: "There are names I could give you. Whether saying them would mend anything is another matter.", cause: "Blame is satisfying and rarely useful." },
      { when: { piety: "high" }, text: "I try not to keep a ledger of faults. It is not mine to balance.", cause: "Judging is a heavy office and I did not apply for it." },
      { when: { role: "farmer" }, text: "The sky, if you want someone to blame. It does not answer to any of us.", cause: "Some things have no culprit, only causes." },
      { text: "Mine, partly. Most of it is simply how things fell.", cause: "Taking your share is cheaper than hunting for someone else's." },
    ],
  },
  {
    id: "consequence",
    asks: [
      "what happens if nothing changes", "what if it stays like this", "will it get worse",
      "what is the worst that could happen", "and if nothing is done",
      "how bad could it get", "what comes next if this continues",
    ],
    variants: [
      { when: { mood: "miserable" }, text: "It gets quieter. People stop asking, and then it is only me and it.", cause: "The worst outcome is usually not disaster. It is being left alone with it." },
      { when: { role: "guard" }, text: "Somebody gets hurt at a gate nobody was watching properly. That is how it always goes.", cause: "Neglect at a post does not announce itself. It waits." },
      { when: { role: "farmer" }, text: "A thin winter, then a thinner one. Farms fail slowly before they fail all at once.", cause: "Ruin in the countryside arrives in instalments." },
      { text: "Nothing dramatic. It just continues, and I get older inside it.", cause: "Most decline is not a cliff. It is a slope you stop noticing." },
    ],
  },
  {
    id: "past",
    asks: [
      "has it always been like this", "was it better before", "what changed",
      "how was it before", "did something happen", "was there a time it was different",
      "what used to be different",
    ],
    variants: [
      { when: { ageGroup: "elder" }, text: "It was worse, and I was stronger. Now I am wiser and tired. Take your pick.", cause: "Old age trades one kind of difficulty for another." },
      { when: { mood: "cheerful" }, text: "Worse, if anything. This is the good stretch and I know it.", cause: "You only recognise a good year while you are inside it." },
      { when: { role: "farmer" }, text: "The land has not changed. What changed is how much it costs to work it.", cause: "The ground stays honest. Everything around it gets dearer." },
      { text: "It was different, yes. I am not sure it was better.", cause: "Memory is generous to the past, which is why it is a poor witness." },
    ],
  },
  {
    id: "need",
    asks: [
      "what do you need most", "what matters most to you", "what would you ask for",
      "if you could have one thing", "what is the one thing you lack",
      "what do you want more than anything",
    ],
    variants: [
      { when: { mood: "miserable" }, text: "A reason to get up tomorrow that is not simply habit.", cause: "Obligation will carry a body a long way before it gives out." },
      { when: { role: "guard" }, text: "More men on the gate, and fewer promises about more men on the gate.", cause: "A post is only as strong as the person standing it." },
      { when: { curiosity: "high" }, text: "To see one place that is not this one, before I am too old to travel.", cause: "Curiosity does not fade with age. It just gets less convenient." },
      { when: { sociability: "high" }, text: "Good company, honestly. Better than good wages, and harder to find.", cause: "Money buys a quiet house, and a quiet house is not what everyone wants." },
      { text: "Enough to stop worrying, and a little left for something that is not a necessity.", cause: "Nobody dreams of the bare minimum." },
    ],
  },
]);

export const FOLLOWUP_BY_ID = new Map(FOLLOWUPS.map((entry) => [entry.id, entry]));

/** Every phrasing, for library generation. */
export const FOLLOWUP_ASKS: readonly { id: FollowUpId; ask: string }[] = FOLLOWUPS.flatMap((entry) =>
  entry.asks.map((ask) => ({ id: entry.id, ask })),
);
