/**
 * Contextual dialogue topics and their follow-up chains (owner request).
 *
 * Every answer here is *narration derived from canonical facts*: mood, time of
 * day, role, place kind, region, personality, indoor/outdoor state and the
 * activity the Simulation already computed. This module never invents a
 * resource, possession, title, relationship or event, and it never writes world
 * state. A variant may only speak about inputs it was given.
 *
 * Chains work because every variant may carry a `cause`: when the player asks
 * "why?", the reply comes from the cause of the answer they just heard, not from
 * a fresh guess.
 */

export type MoodBand = "miserable" | "grumpy" | "calm" | "content" | "cheerful";
export type TimeBand = "night" | "dawn" | "morning" | "midday" | "afternoon" | "evening";
export type RoleGroup = "farmer" | "guard" | "artisan" | "trader" | "labourer" | "other";
export type PlaceKind = "village" | "city" | "wilds";
export type Band = "low" | "mid" | "high";
export type TemperBand = "even" | "hot" | "cold";

/** Normalized, deterministic view of the protagonist used to pick an answer. */
export type DialogueContextFacts = {
  readonly mood: MoodBand;
  readonly moodValue: number;
  readonly time: TimeBand;
  readonly role: RoleGroup;
  readonly place: PlaceKind;
  readonly indoors: boolean;
  readonly travelling: boolean;
  readonly sociability: Band;
  readonly temper: TemperBand;
  readonly diligence: Band;
  readonly piety: Band;
  readonly curiosity: Band;
  readonly region: string;
  readonly settlement: string;
  readonly homeName: string;
  readonly workName: string;
  readonly activity: string;
  readonly activityKey: string;
  readonly ageGroup: string;
  readonly guardShift?: 0 | 1;
};

export type TopicId =
  | "feeling"
  | "work"
  | "workPride"
  | "home"
  | "family"
  | "food"
  | "sleep"
  | "pay"
  | "danger"
  | "guards"
  | "lord"
  | "war"
  | "faith"
  | "weather"
  | "friends"
  | "gossip"
  | "health"
  | "plans"
  | "ambition"
  | "advice"
  | "place"
  | "roads"
  | "animals"
  | "harvest"
  | "craft"
  | "childhood"
  | "regret"
  | "hope"
  | "trust"
  | "secrets";

/** Conditions are matched by equality on the facts present; `undefined` = any. */
type When = Partial<Pick<
  DialogueContextFacts,
  "mood" | "time" | "role" | "place" | "indoors" | "travelling" |
  "sociability" | "temper" | "diligence" | "piety" | "curiosity" | "ageGroup" | "guardShift"
>>;

export type TopicVariant = {
  /** First matching variant wins; the final variant of a topic must have no `when`. */
  readonly when?: When;
  /** Supports {settlement} {region} {home} {work} {activity} {name}. */
  readonly text: string;
  /** What the character says when asked "why?". Grounded in the same facts. */
  readonly cause?: string;
  /** Machine-readable flavour tags, used to keep follow-ups coherent. */
  readonly tags?: readonly string[];
};

export type TopicDef = {
  readonly id: TopicId;
  /** Question phrasings that reach this topic; each becomes a library entry. */
  readonly asks: readonly string[];
  readonly variants: readonly TopicVariant[];
  /** Topics offered as next questions after this answer. */
  readonly followUps: readonly TopicId[];
};

const ROLE_FARMER = new Set(["farmer", "labourer"]);
const ROLE_SERVICE = new Set(["merchant", "innkeeper", "baker", "butcher"]);

/** Classifies a Simulation role into an answer-relevant group. */
export function roleGroupOf(role: string): RoleGroup {
  const key = role.toLowerCase();
  if (key === "farmer") return "farmer";
  if (key === "guard") return "guard";
  if (key === "blacksmith" || key === "artisan" || key === "weaver") return "artisan";
  if (key === "merchant" || key === "trader" || key === "innkeeper") return "trader";
  if (key === "labourer" || key === "laborer") return "labourer";
  if (ROLE_FARMER.has(key)) return "labourer";
  if (ROLE_SERVICE.has(key)) return "trader";
  return "other";
}

export function moodBandOf(label: string, value: number): MoodBand {
  const key = label.toLowerCase();
  if (key === "miserable") return "miserable";
  if (key === "grumpy") return "grumpy";
  if (key === "cheerful") return "cheerful";
  if (key === "content") return "content";
  if (key === "calm") return "calm";
  return value > 0.45 ? "cheerful" : value > 0.15 ? "content" : value > -0.15 ? "calm" : value > -0.45 ? "grumpy" : "miserable";
}

/** Hour of the local fantasy day (0..24) → band. */
export function timeBandOf(hour: number): TimeBand {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.5) return "night";
  if (h < 6.5) return "dawn";
  if (h < 11) return "morning";
  if (h < 13.5) return "midday";
  if (h < 17.5) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

export function bandOf(value: number): Band {
  return value < 0.34 ? "low" : value < 0.67 ? "mid" : "high";
}

export function temperBandOf(value: number): TemperBand {
  return value < 0.34 ? "even" : value < 0.67 ? "hot" : "hot";
}

/** Exported so follow-up answers reuse the exact same condition semantics. */
export function matchesWhen(when: When | undefined, facts: DialogueContextFacts): boolean {
  if (!when) return true;
  for (const key of Object.keys(when) as (keyof When)[]) {
    const expected = when[key];
    if (expected === undefined) continue;
    const actual = (facts as unknown as Record<string, unknown>)[key];
    if (actual !== expected) return false;
  }
  return true;
}

export function fillPlaceholders(text: string, facts: DialogueContextFacts, name?: string): string {
  return text
    .replaceAll("{settlement}", facts.settlement)
    .replaceAll("{region}", facts.region)
    .replaceAll("{home}", facts.homeName)
    .replaceAll("{work}", facts.workName)
    .replaceAll("{activity}", facts.activity)
    .replaceAll("{name}", name ?? "I");
}

export type TopicAnswer = {
  readonly topic: TopicId;
  readonly text: string;
  /** Present only when the chosen variant can explain itself. */
  readonly cause?: string;
  readonly tags: readonly string[];
  readonly followUps: readonly TopicId[];
};

/** Deterministically answers one topic for the current facts. */
export function answerTopic(
  topic: TopicId,
  facts: DialogueContextFacts,
  name?: string,
  definitions: readonly TopicDef[] = TOPICS,
): TopicAnswer | undefined {
  const def = definitions.find((entry) => entry.id === topic);
  if (!def) return undefined;
  const variant = def.variants.find((candidate) => matchesWhen(candidate.when, facts)) ?? def.variants[def.variants.length - 1];
  if (!variant) return undefined;
  return {
    topic,
    text: fillPlaceholders(variant.text, facts, name),
    cause: variant.cause ? fillPlaceholders(variant.cause, facts, name) : undefined,
    tags: variant.tags ?? [],
    followUps: def.followUps,
  };
}

/** The canonical question a follow-up chip should send. */
export function canonicalQuestion(topic: TopicId, definitions: readonly TopicDef[] = TOPICS): string {
  const def = definitions.find((entry) => entry.id === topic);
  const first = def?.asks[0];
  if (!first) return "Tell me more?";
  return first.charAt(0).toUpperCase() + first.slice(1) + "?";
}

/**
 * The shipped topic tree. Variants are ordered: earlier, more specific
 * conditions win; the last variant of each topic is the unconditional fallback.
 */
export const TOPICS: readonly TopicDef[] = Object.freeze([
  {
    id: "feeling",
    asks: ["how do you feel", "how are you feeling", "are you well", "how is your mood", "are you happy", "are you alright", "what is wrong", "do you feel well", "how is your day going", "are you sad"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "Miserable, truth to tell. A day {activity} does not lift a mood like mine.",
        cause: "Because the day is long, and being {activity} takes more out of me than it gives back.",
        tags: ["low-mood"],
      },
      {
        when: { mood: "grumpy" },
        text: "Grumpy, if you must know. Ask me again when the day is done.",
        cause: "I have been {activity} all day, and it has worn my patience thin.",
        tags: ["low-mood"],
      },
      {
        when: { mood: "cheerful" },
        text: "Well enough to smile at you, Advisor. A day {activity} suits me today.",
        cause: "The work went kindly today and {settlement} has been good to me.",
        tags: ["high-mood"],
      },
      {
        when: { mood: "content" },
        text: "Content. Nothing broken, nothing missing that I can mend.",
        cause: "There is food in the house and the day has gone as it should.",
        tags: ["high-mood"],
      },
      {
        text: "Calm. Steady as the week allows.",
        cause: "I keep to my work and my own business. That keeps a body calm.",
      },
    ],
    followUps: ["work", "health", "home", "plans"],
  },
  {
    id: "work",
    asks: ["what is your work", "what do you do", "what do you do for a living", "tell me about your work", "what is your trade", "how is work", "is the work hard", "do you enjoy your work", "what did you do today", "how was your day"],
    variants: [
      {
        when: { role: "guard" },
        text: "I keep the gate. {work} — watching who comes and goes, and mostly telling them to move along.",
        cause: "Somebody must stand there, and it is my turn.",
        tags: ["duty"],
      },
      {
        when: { role: "farmer" },
        text: "Farming. {work}, from before dawn until the light fails.",
        cause: "The soil does not wait for anyone's mood.",
        tags: ["labour"],
      },
      {
        when: { role: "artisan" },
        text: "I am a smith of my hands. {work} keeps me indoors and busy.",
        cause: "Good work cannot be hurried, and there is always more of it.",
        tags: ["craft"],
      },
      {
        when: { role: "trader" },
        text: "Trade. {work} — buying, selling, and remembering who owes what.",
        cause: "A market only feeds the people who are standing in it.",
        tags: ["trade"],
      },
      {
        when: { role: "labourer" },
        text: "Whatever needs carrying, I carry it. {work} today.",
        cause: "Strong arms are the only coin I was born with.",
        tags: ["labour"],
      },
      {
        when: { time: "night" },
        text: "Not now — the day's work is done and I want my bed.",
        cause: "The work starts again at first light whether I rest or not.",
        tags: ["tired"],
      },
      {
        text: "Honest work, and plenty of it. {work} fills most days.",
        cause: "It keeps the roof on and the pot full.",
      },
    ],
    followUps: ["pay", "workPride", "home", "health", "craft"],
  },
  {
    id: "workPride",
    asks: ["are you good at it", "do you take pride in your work", "is it skilled work", "did you choose this trade", "do you like what you do", "is your work respected"],
    variants: [
      {
        when: { diligence: "high" },
        text: "I do it properly or not at all. That is the whole of my pride.",
        cause: "A sloppy job comes back to the same pair of hands that made it.",
        tags: ["diligence"],
      },
      {
        when: { diligence: "low" },
        text: "It is work. I would rather be elsewhere, most days.",
        cause: "Nobody asked me what I wanted to be.",
        tags: ["resentment"],
      },
      {
        text: "I am as good as the next man, and better than some.",
        cause: "Years of it teach the hands even when the head wanders.",
      },
    ],
    followUps: ["craft", "pay", "ambition", "childhood"],
  },
  {
    id: "home",
    asks: ["where do you live", "where is your home", "tell me about your house", "is your home far", "do you have a house", "describe your home", "is home close"],
    variants: [
      {
        when: { travelling: true },
        text: "A way off yet. {home}, in {settlement}.",
        cause: "I am on the road back, and the road does not shorten itself.",
        tags: ["travelling"],
      },
      {
        when: { place: "city" },
        text: "{home}, in the crowded part of {settlement}. Small, but mine.",
        cause: "In a city a roof of your own is worth more than a wide field.",
        tags: ["home"],
      },
      {
        text: "{home}, near the middle of {settlement}. It is not grand.",
        cause: "I built what I could afford, and I keep it standing.",
        tags: ["home"],
      },
    ],
    followUps: ["family", "food", "place"],
  },
  {
    id: "family",
    asks: ["do you have a family", "are you married", "do you have children", "who do you live with", "tell me about your family", "are your parents alive", "do you have brothers", "is your family here"],
    variants: [
      {
        when: { ageGroup: "elder" },
        text: "A family grown and scattered. The house is quieter than it used to be.",
        cause: "Children leave, and that is what you raised them for.",
        tags: ["family"],
      },
      {
        when: { sociability: "high" },
        text: "A house full of them, and I would not have it quieter.",
        cause: "Noise means nobody has been lost.",
        tags: ["family"],
      },
      {
        text: "Some kin close by, some further off. We manage.",
        cause: "Family is the one debt that is never quite settled.",
        tags: ["family"],
      },
    ],
    followUps: ["home", "childhood", "regret", "hope"],
  },
  {
    id: "food",
    asks: ["have you eaten", "are you hungry", "what did you eat", "is there food at home", "what do you eat", "is food expensive", "do you have enough to eat"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "Not properly, no. Bread and what the day allowed.",
        cause: "A thin purse and a long day make a thin table.",
        tags: ["hunger", "hardship"],
      },
      {
        when: { time: "evening" },
        text: "Supper soon, if the pot remembers to be full.",
        cause: "The evening is when a body finally sits down.",
        tags: ["food"],
      },
      {
        when: { role: "farmer" },
        text: "There is always something growing. Whether it reaches my plate is another matter.",
        cause: "Most of what I grow is owed before it is eaten.",
        tags: ["food", "labour"],
      },
      {
        text: "Enough, thanks be. Not rich fare, but enough.",
        cause: "I do not go to bed hungry, and that is more than many can say.",
        tags: ["food"],
      },
    ],
    followUps: ["pay", "harvest", "health", "home"],
  },
  {
    id: "sleep",
    asks: ["did you sleep well", "are you tired", "do you need rest", "how much sleep do you get", "were you awake all night", "are you exhausted"],
    variants: [
      {
        when: { time: "night" },
        text: "I should be asleep. You are keeping me from it.",
        cause: "Tomorrow begins whether I am rested or not.",
        tags: ["tired"],
      },
      {
        when: { mood: "miserable" },
        text: "Badly. Worry is a poor bedfellow.",
        cause: "When there is no answer to a problem, the night is very long.",
        tags: ["tired", "worry"],
      },
      {
        when: { role: "guard" },
        text: "In pieces, between watches. A guard learns to sleep in snatches.",
        cause: "The gate does not close because I am tired.",
        tags: ["duty", "tired"],
      },
      {
        text: "Well enough. The work sees to that.",
        cause: "Honest labour buys honest sleep.",
        tags: ["rest"],
      },
    ],
    followUps: ["health", "work", "feeling", "home"],
  },
  {
    id: "pay",
    asks: ["does your work pay well", "do you have money", "are you paid fairly", "is the pay good", "do you earn enough", "are you in debt", "do you owe anyone", "is coin short"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "Coin is short and the month is long. That is the whole of it.",
        cause: "Work pays what it pays, and the price of bread does not consult me.",
        tags: ["hardship", "money"],
      },
      {
        when: { role: "farmer" },
        text: "Paid in what the land gives. Good years fill the barn, bad years do not.",
        cause: "Weather decides my wages more than any lord does.",
        tags: ["money", "land"],
      },
      {
        when: { role: "guard" },
        text: "A guard's wage is steady, and steady is not the same as plenty.",
        cause: "The post is worth more than the purse, and I remind myself of that often.",
        tags: ["money", "duty"],
      },
      {
        when: { mood: "cheerful" },
        text: "Enough this season. I am not complaining.",
        cause: "A good week pays for the bad ones, if you are careful.",
        tags: ["money"],
      },
      {
        text: "It keeps me. Not comfortably, but it keeps me.",
        cause: "I have learned to want less than I earn.",
        tags: ["money"],
      },
    ],
    followUps: ["work", "food", "harvest", "advice"],
  },
  {
    id: "danger",
    asks: ["is it dangerous here", "are you afraid", "is there trouble", "are there bandits", "is the road safe", "what do you fear", "is anything threatening you"],
    variants: [
      {
        when: { place: "wilds" },
        text: "Out here? Yes. Keep to the road and keep your eyes open.",
        cause: "The wild does not distinguish between a traveller and a meal.",
        tags: ["danger"],
      },
      {
        when: { time: "night" },
        text: "After dark, more than I like. Locks and lamps, and even those are not enough.",
        cause: "Whatever walks at night has the advantage of knowing the dark better than we do.",
        tags: ["danger", "night"],
      },
      {
        when: { temper: "hot" },
        text: "Let them come. I have opinions about thieves.",
        cause: "Fear is a thing you can decide not to carry.",
        tags: ["brave"],
      },
      {
        text: "The usual sort. A raised voice, a bad debt, a stranger who lingers.",
        cause: "Small troubles grow into large ones if nobody watches them.",
        tags: ["danger"],
      },
    ],
    followUps: ["guards", "roads", "war"],
  },
  {
    id: "guards",
    asks: ["are there guards", "who protects the village", "is the gate guarded", "do the guards do their job", "who keeps order", "are the guards honest"],
    variants: [
      {
        when: { role: "guard" },
        text: "I do. Two of us at a gate, more when the lord remembers to pay for them.",
        cause: "Order is not a thing that happens. Somebody stands out in the rain for it.",
        tags: ["duty", "order"],
      },
      {
        when: { place: "village" },
        text: "A guard post by the gate, and a bell that nobody hopes to hear.",
        cause: "A village's walls are mostly made of people knowing each other.",
        tags: ["order"],
      },
      {
        text: "There are guards, and there are guards. Some are worth the wage.",
        cause: "A post held by a tired man is only a post.",
        tags: ["order", "doubt"],
      },
    ],
    followUps: ["danger", "lord", "pay", "war"],
  },
  {
    id: "lord",
    asks: ["who is your lord", "who rules here", "is the lord just", "do you trust the lord", "who is in charge", "what do you think of the lord", "are taxes fair"],
    variants: [
      {
        when: { temper: "hot" },
        text: "Our lord takes his share and sends his thanks. I have opinions I keep behind my teeth.",
        cause: "It is easier to complain about the tax than to refuse it.",
        tags: ["resentment", "politics"],
      },
      {
        when: { piety: "high" },
        text: "A lord is a lord. I pray he rules better than his father did.",
        cause: "We are told to render unto them what is theirs, and to hope they deserve it.",
        tags: ["politics", "faith"],
      },
      {
        text: "He keeps the roads under watch and the taxes just short of unbearable.",
        cause: "That is considered good rule, in my experience.",
        tags: ["politics"],
      },
    ],
    followUps: ["war", "guards", "pay", "trust"],
  },
  {
    id: "war",
    asks: ["is there war", "will there be war", "are we at peace", "is the border safe", "have you fought", "what of the fighting"],
    variants: [
      {
        when: { role: "guard" },
        text: "Talk of it, more than fighting. Talk is cheaper than levies.",
        cause: "Every rumour of war costs a guard twice the watch and half his sleep.",
        tags: ["war", "duty"],
      },
      {
        when: { ageGroup: "elder" },
        text: "I remember the last one. Pray you only ever hear about it.",
        cause: "War does not end when the fighting does.",
        tags: ["war", "memory"],
      },
      {
        text: "Peace, for now. Peace is a thing that needs tending.",
        cause: "It holds while everyone believes the other side is watching.",
        tags: ["war"],
      },
    ],
    followUps: ["lord", "danger", "guards", "regret"],
  },
  {
    id: "faith",
    asks: ["are you religious", "do you pray", "which gods do you follow", "is the shrine kept", "do you believe in anything", "what do the priests say"],
    variants: [
      {
        when: { piety: "high" },
        text: "I keep the hours, and I keep my promises. The shrine knows me by name.",
        cause: "There is more to a life than what can be counted in a market.",
        tags: ["faith"],
      },
      {
        when: { piety: "low" },
        text: "I go when I must. I have seen too many prayers answered with silence.",
        cause: "Faith is easier when the harvest is good.",
        tags: ["doubt"],
      },
      {
        text: "Enough faith to be polite to the priest and honest with my neighbours.",
        cause: "Whatever listens, listens whether or not I shout.",
        tags: ["faith"],
      },
    ],
    followUps: ["hope", "regret", "trust", "feeling"],
  },
  {
    id: "weather",
    asks: ["how is the weather", "is it cold", "will it rain", "is the season good", "is it a hard winter", "how is the wind"],
    variants: [
      {
        when: { time: "night" },
        text: "Cold enough that I would rather be talking by a fire than about the sky.",
        cause: "The night takes the warmth out of everything it touches.",
        tags: ["weather"],
      },
      {
        when: { role: "farmer" },
        text: "We need rain and not too much of it. The sky is the only ledger that matters.",
        cause: "Everything I own hangs on whether the clouds arrive.",
        tags: ["weather", "land"],
      },
      {
        text: "Fair enough. The sort of day that asks nothing of you.",
        cause: "Weather, like a neighbour, is best when it is unremarkable.",
        tags: ["weather"],
      },
    ],
    followUps: ["harvest", "work", "roads", "food"],
  },
  {
    id: "friends",
    asks: ["do you have friends", "who are your friends", "do you have neighbours", "do you get along with people", "are there kind people here"],
    variants: [
      {
        when: { sociability: "high" },
        text: "More than I can keep track of. {settlement} is a town that talks.",
        cause: "I would rather hear ten bad opinions than none at all.",
        tags: ["social"],
      },
      {
        when: { sociability: "low" },
        text: "A few. I do not need many, and I do not hand out trust cheaply.",
        cause: "People who talk much tend to say things that cost you later.",
        tags: ["solitary"],
      },
      {
        text: "Neighbours I can rely on, and one or two I would call friends.",
        cause: "In a place like this, a friend is the difference between a bad year and a lost one.",
        tags: ["social"],
      },
    ],
    followUps: ["family", "trust", "gossip", "place"],
  },
  {
    id: "gossip",
    asks: ["any news", "what is being said", "any gossip", "what are people talking about", "any rumours", "what is the talk"],
    variants: [
      {
        when: { sociability: "high" },
        text: "Plenty, and half of it invented. Which half is the interesting part.",
        cause: "A tale that travels far enough stops needing to be true.",
        tags: ["gossip"],
      },
      {
        when: { diligence: "high" },
        text: "None I trust. I deal in what I can see.",
        cause: "Gossip is a tax the idle charge the busy.",
        tags: ["gossip", "doubt"],
      },
      {
        text: "A price went up, a shed came down, and somebody's cousin is doing well. The usual.",
        cause: "Life here is small enough that small things count as news.",
        tags: ["gossip"],
      },
    ],
    followUps: ["friends", "place", "lord", "danger"],
  },
  {
    id: "health",
    asks: ["are you healthy", "are you hurt", "are you ill", "do you need a healer", "is your back giving you trouble", "are you in pain"],
    variants: [
      {
        when: { ageGroup: "elder" },
        text: "Old joints, and a shoulder that complains when the weather turns.",
        cause: "Years of work leave a receipt, and age collects it.",
        tags: ["health"],
      },
      {
        when: { role: "labourer" },
        text: "Bruised often, broken rarely. The body learns what work it is for.",
        cause: "You cannot carry stones all day and keep the back of a scribe.",
        tags: ["health", "labour"],
      },
      {
        text: "Well enough to keep working, which is my measure of health.",
        cause: "Health is only noticed when it is missing.",
        tags: ["health"],
      },
    ],
    followUps: ["sleep", "work", "feeling", "food"],
  },
  {
    id: "plans",
    asks: ["what are your plans", "what will you do tomorrow", "what is next", "what do you intend", "how will you spend the day", "what happens now"],
    variants: [
      {
        when: { time: "night" },
        text: "Sleep, then the same work at first light. Tomorrow is not a mystery.",
        cause: "My plans are made by the season, not by me.",
        tags: ["future", "tired"],
      },
      {
        when: { travelling: true },
        text: "Get where I am going before the light goes. That is the whole plan.",
        cause: "A road at night is a different road entirely.",
        tags: ["future", "travelling"],
      },
      {
        when: { diligence: "high" },
        text: "Finish what I started, then start what pays next.",
        cause: "Work finished early is the only kind of luck I trust.",
        tags: ["future", "diligence"],
      },
      {
        text: "The same as today, unless something better offers itself.",
        cause: "A plan is a good servant and a poor master.",
        tags: ["future"],
      },
    ],
    followUps: ["ambition", "work", "hope", "advice"],
  },
  {
    id: "ambition",
    asks: ["what do you want", "what is your dream", "do you want a better life", "where do you see yourself", "do you wish you were somewhere else", "what would you change"],
    variants: [
      {
        when: { mood: "cheerful" },
        text: "A bigger house, a fuller barn, and a winter where nobody goes cold.",
        cause: "Wanting more is not greed, if the more goes to the people under your roof.",
        tags: ["hope", "ambition"],
      },
      {
        when: { mood: "miserable" },
        text: "A day without owing anyone. That is as far as my dreaming goes.",
        cause: "When the present is heavy, the future is a small, quiet thing.",
        tags: ["hardship", "hope"],
      },
      {
        when: { curiosity: "high" },
        text: "To see somewhere other than this. The world is wider than the road out of here.",
        cause: "Curiosity is a hunger that bread cannot answer.",
        tags: ["ambition", "travel"],
      },
      {
        text: "To be left in peace to do my work well. Not everyone wants a crown.",
        cause: "A quiet life is an achievement, even if nobody calls it one.",
        tags: ["hope"],
      },
    ],
    followUps: ["plans", "hope", "regret"],
  },
  {
    id: "advice",
    asks: ["what should i do", "give me advice", "what would you do", "do you need help", "how can i help", "should i stay", "what do you suggest"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "Help? Then find me a day that ends better than it started.",
        cause: "Small mercies are the only ones I can use right now.",
        tags: ["hardship"],
      },
      {
        when: { role: "guard" },
        text: "Keep your business out of other people's, and you will keep your teeth.",
        cause: "Most trouble begins with a helpful stranger.",
        tags: ["duty"],
      },
      {
        text: "Listen more than you talk, and pay what you owe before you are asked.",
        cause: "Both cost nothing and save a great deal.",
        tags: ["wisdom"],
      },
    ],
    followUps: ["plans", "trust", "feeling", "work"],
  },
  {
    id: "place",
    asks: ["tell me about this place", "what is this village like", "is this a good place to live", "what is here", "do you like living here", "what is this town"],
    variants: [
      {
        when: { place: "city" },
        text: "{settlement} — crowded, loud, and never entirely asleep. I would not trade it.",
        cause: "A city offers you a hundred chances and charges you for every one.",
        tags: ["place"],
      },
      {
        when: { place: "wilds" },
        text: "Not a place at all, really. A road with weather.",
        cause: "The wild is something you pass through, not somewhere you live.",
        tags: ["place"],
      },
      {
        when: { mood: "miserable" },
        text: "It is where I am. I will not pretend it is where I want to be.",
        cause: "A place looks different depending on what you owe there.",
        tags: ["place"],
      },
      {
        text: "{settlement}, in {region}. Small, stubborn, and kinder than it looks.",
        cause: "You learn a place's worth when you need something from it.",
        tags: ["place"],
      },
    ],
    followUps: ["gossip", "home", "roads", "friends"],
  },
  {
    id: "roads",
    asks: ["are the roads good", "is the road safe to travel", "where does that road go", "is the bridge sound", "how far is the next town", "can i travel from here"],
    variants: [
      {
        when: { role: "guard" },
        text: "Good enough by day. The bridge holds; the far lane floods in a hard rain.",
        cause: "Roads are only as good as the last person who repaired them.",
        tags: ["roads"],
      },
      {
        when: { place: "village" },
        text: "One road in, one road out, and a bridge that everyone prays about in spring.",
        cause: "A village is only as connected as its worst crossing.",
        tags: ["roads"],
      },
      {
        text: "They take you where you need to go, slowly. Mind the low ground after rain.",
        cause: "A road is honest — it shows you exactly how far you have to walk.",
        tags: ["roads"],
      },
    ],
    followUps: ["place", "danger", "weather"],
  },
  {
    id: "animals",
    asks: ["do you keep animals", "are there wolves", "what animals live here", "do you have a horse", "are the beasts a problem", "any livestock"],
    variants: [
      {
        when: { role: "farmer" },
        text: "A cow, some hens, and a dog with strong opinions. The hens earn their keep.",
        cause: "Animals are honest company. They do not flatter and they do not lie.",
        tags: ["animals", "farm"],
      },
      {
        when: { place: "wilds" },
        text: "Wolves, mostly. They are bolder in a bad winter.",
        cause: "Hunger makes brave animals of everything, including us.",
        tags: ["animals", "danger"],
      },
      {
        text: "Cats in the barn and pigeons on the roof. Nothing worth fearing.",
        cause: "The dangerous animals here walk on two legs and carry ledgers.",
        tags: ["animals"],
      },
    ],
    followUps: ["harvest", "danger", "weather", "place"],
  },
  {
    id: "harvest",
    asks: ["how is the harvest", "was it a good year", "will the crops be enough", "is the field yielding", "how are the fields"],
    variants: [
      {
        when: { role: "farmer" },
        text: "Fair, if the next fortnight is dry. Two weeks decide the whole year.",
        cause: "Nobody remembers the good months. Everyone remembers the ruined ones.",
        tags: ["harvest", "land"],
      },
      {
        when: { role: "trader" },
        text: "The grain came in better than feared, so the price will be softer.",
        cause: "Good harvests are bad news for anyone holding last year's stock.",
        tags: ["harvest", "trade"],
      },
      {
        text: "Better than last year, worse than the year before. The middle of the road, as usual.",
        cause: "A village lives close enough to the land to feel every change in it.",
        tags: ["harvest"],
      },
    ],
    followUps: ["food", "pay", "weather", "work"],
  },
  {
    id: "craft",
    asks: ["what are you skilled at", "are you good with your hands", "did you learn a trade", "who taught you", "what can you make"],
    variants: [
      {
        when: { role: "artisan" },
        text: "Metal, mostly. Give me a fire and an anvil and I will give you something that lasts.",
        cause: "A skill is the only thing nobody can tax away from you.",
        tags: ["craft"],
      },
      {
        when: { role: "farmer" },
        text: "Reading weather and reading soil. Neither is written in any book.",
        cause: "The land teaches, and it charges for the lessons.",
        tags: ["craft", "land"],
      },
      {
        text: "I can mend more than I can make, and that has served well enough.",
        cause: "Practical hands are worth more here than clever ones.",
        tags: ["craft"],
      },
    ],
    followUps: ["workPride", "childhood", "work", "ambition"],
  },
  {
    id: "childhood",
    asks: ["where were you born", "what was your childhood like", "did you grow up here", "how old are you", "what did you want to be", "who raised you"],
    variants: [
      {
        when: { ageGroup: "elder" },
        text: "Born a long walk from here, in a house that no longer stands. I am older than most of this street.",
        cause: "The years go quickly once there are more behind you than ahead.",
        tags: ["memory", "age"],
      },
      {
        when: { curiosity: "high" },
        text: "Born here, and wanted to leave by the time I could walk. I am still deciding.",
        cause: "A small place teaches you to look at the horizon.",
        tags: ["memory", "ambition"],
      },
      {
        text: "Born here and raised on work. Not a story anyone would write down.",
        cause: "Most lives are not stories. That does not make them small.",
        tags: ["memory"],
      },
    ],
    followUps: ["family", "ambition", "regret", "home"],
  },
  {
    id: "regret",
    asks: ["do you regret anything", "what would you do differently", "is there something you lost", "what weighs on you", "are you sorry about something", "what do you mourn"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "A few things. I keep them where I can reach them.",
        cause: "A regret is a debt you pay in the quiet hours.",
        tags: ["regret", "sadness"],
      },
      {
        when: { ageGroup: "elder" },
        text: "I should have been kinder while it still mattered. That is the honest answer.",
        cause: "Kindness delayed is the one expense you cannot make up later.",
        tags: ["regret", "memory"],
      },
      {
        text: "Nothing I would put in front of a stranger. Everyone carries something.",
        cause: "We all have a door we would rather not open.",
        tags: ["regret", "guarded"],
      },
    ],
    followUps: ["family", "feeling", "faith", "trust"],
  },
  {
    id: "hope",
    asks: ["what gives you hope", "are you hopeful", "what are you looking forward to", "is there good in this place", "what makes you happy"],
    variants: [
      {
        when: { mood: "miserable" },
        text: "Small things. A dry roof, and a morning where nothing is owed.",
        cause: "Hope does not have to be large to be real.",
        tags: ["hope"],
      },
      {
        when: { mood: "cheerful" },
        text: "The season ahead and the people in it. It is a good year to be alive.",
        cause: "Good years are loaned, not given. I intend to use this one.",
        tags: ["hope"],
      },
      {
        text: "Work that is finished, and people who come back.",
        cause: "Hope is mostly just refusing to give up on ordinary things.",
        tags: ["hope"],
      },
    ],
    followUps: ["plans", "ambition", "feeling", "family"],
  },
  {
    id: "trust",
    asks: ["do you trust me", "can i trust you", "do you trust people", "are you honest with me", "do you believe what i say"],
    variants: [
      {
        when: { sociability: "low" },
        text: "I am listening. Trust is a thing you earn in this weather, not a thing you are given.",
        cause: "I have been lied to by people with pleasant voices.",
        tags: ["guarded"],
      },
      {
        when: { mood: "cheerful" },
        text: "You have not cheated me yet, so yes — provisionally.",
        cause: "Trust is cheap to give and expensive to lose.",
        tags: ["open"],
      },
      {
        text: "I trust what I can see you do. Words are cheaper than work.",
        cause: "Anyone can promise. Only some bother to return.",
        tags: ["guarded"],
      },
    ],
    followUps: ["secrets", "gossip", "advice", "feeling"],
  },
  {
    id: "secrets",
    asks: ["do you have a secret", "is there something you are not telling me", "what are you hiding", "can you keep a secret", "is there more to this"],
    variants: [
      {
        when: { sociability: "low" },
        text: "Everyone has one. Mine stays with me, and so will yours.",
        cause: "A secret told in a market is not a secret by evening.",
        tags: ["guarded"],
      },
      {
        when: { temper: "hot" },
        text: "Ask me that again and I might tell you something I regret.",
        cause: "Some questions are cheaper unasked.",
        tags: ["guarded", "temper"],
      },
      {
        text: "Nothing worth the telling. The interesting secrets here belong to other people.",
        cause: "I know enough to know when to stop talking.",
        tags: ["guarded"],
      },
    ],
    followUps: ["trust", "gossip", "regret", "friends"],
  },
]);

/** Every topic id declared above, for validation and tests. */
export const TOPIC_IDS: readonly TopicId[] = TOPICS.map((topic) => topic.id);
