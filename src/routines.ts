/**
 * NPC character sheets and daily routines — pure functions of the SEED-keyed
 * resident code and absolute Fantasy Time. Nothing here is stored or stepped:
 * the simulation evaluates a routine only for residents of the focused area,
 * at the requested tick, so the same NPC always has the same traits and is in
 * the same place doing the same thing whenever it is generated again.
 */
import type { CharacterAge } from "./characters.ts";
import type { ResidentRole } from "./simulation.ts";

const HOUR = 3_600, MINUTE = 60;

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
const unit = (address: string) => digest(address) / 4294967296;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// ---------------------------------------------------------------- traits

export type Abilities = { strength: number; dexterity: number; constitution: number; knowledge: number; wisdom: number; charisma: number };
export type Personality = { diligence: number; sociability: number; piety: number; temper: number; curiosity: number };
export type ResidentTraits = { abilities: Abilities; personality: Personality; temperament: string };

const ABILITY_KEYS = ["strength", "dexterity", "constitution", "knowledge", "wisdom", "charisma"] as const;
/** Trade and age shift the 3-18 ability scores: a smith is strong, a scribe learned, a child small. */
const ROLE_BONUS: Readonly<Partial<Record<ResidentRole, Partial<Abilities>>>> = {
  blacksmith: { strength: 4, constitution: 2 },
  butcher: { strength: 3, constitution: 1 },
  farmer: { strength: 2, constitution: 2 },
  laborer: { strength: 3, constitution: 2, dexterity: 1 },
  guard: { strength: 2, dexterity: 2, constitution: 2 },
  "guard-officer": { strength: 2, wisdom: 2, charisma: 2 },
  artisan: { dexterity: 4, knowledge: 1 },
  merchant: { charisma: 3, knowledge: 2 },
  trader: { charisma: 3, wisdom: 1 },
  innkeeper: { charisma: 3, constitution: 1 },
  clergy: { knowledge: 3, wisdom: 3 },
  noble: { knowledge: 3, charisma: 3, strength: -1 },
  beggar: { constitution: -2, wisdom: 2, charisma: -1 },
};
const AGE_BONUS: Readonly<Record<CharacterAge, Partial<Abilities>>> = {
  child: { strength: -6, constitution: -3, knowledge: -5, wisdom: -5, dexterity: 1 },
  adult: {},
  elder: { strength: -3, dexterity: -3, constitution: -2, knowledge: 3, wisdom: 4 },
};

/** Ability scores (3d6 by seed, then trade and age adjustments) and a seeded personality. */
export function traitsFor(code: string, role: ResidentRole, age: CharacterAge): ResidentTraits {
  const abilities = {} as Abilities;
  for (const key of ABILITY_KEYS) {
    let roll = 0;
    for (let die = 0; die < 3; die++) roll += 1 + (digest(`${code}/ABILITY/${key}/${die}`) % 6);
    abilities[key] = clamp(roll + (ROLE_BONUS[role]?.[key] ?? 0) + (AGE_BONUS[age][key] ?? 0), 3, 18);
  }
  const p = (name: string) => Math.round(unit(`${code}/PERSONALITY/${name}`) * 100) / 100,
    personality: Personality = {
      diligence: p("DILIGENCE"),
      sociability: p("SOCIABILITY"),
      piety: clamp(p("PIETY") + (role === "clergy" ? .45 : 0), 0, 1),
      temper: p("TEMPER"),
      curiosity: clamp(p("CURIOSITY") + (age === "child" ? .3 : 0), 0, 1),
    };
  const ranked = (Object.entries(personality) as [keyof Personality, number][]).sort((a, b) => b[1] - a[1]),
    temperament = ({ diligence: "industrious", sociability: "gregarious", piety: "devout", temper: "hot-headed", curiosity: "inquisitive" } as const)[ranked[0][0]];
  return { abilities, personality, temperament };
}

// ---------------------------------------------------------------- mood

export type Mood = { value: number; label: string };
/**
 * Mood for a fantasy day and hour: a seeded daily swing on top of personality,
 * lower on a long workday and late in the evening, higher on the rest day.
 */
export function moodAt(code: string, traits: ResidentTraits, day: number, weekday: number, secondOfDay: number): Mood {
  const { sociability, temper, diligence } = traits.personality,
    daily = (unit(`${code}/MOOD/${day}`) - .5) * .9,
    base = (sociability - .5) * .3 - (temper - .5) * .4,
    restDay = weekday === 6 ? .25 : 0,
    hour = secondOfDay / HOUR,
    fatigue = hour < 5 ? -.35 : hour > 21 ? -.25 * (hour - 21) / 3 : hour > 15 ? -.1 * (1 - diligence) : 0,
    value = clamp(base + daily + restDay + fatigue, -1, 1),
    label = value > .45 ? "cheerful" : value > .15 ? "content" : value > -.15 ? "calm" : value > -.45 ? (hour > 20 || hour < 6 ? "tired" : "grumpy") : "miserable";
  return { value: Math.round(value * 100) / 100, label };
}

// ---------------------------------------------------------------- routines

/** Where an activity happens; the simulation maps each anchor to a real building or plot. */
export type RoutineAnchor = "home" | "work" | "inn" | "market" | "plaza" | "keep";
export type ActivityKind = "sleep" | "wake" | "breakfast" | "commute" | "work" | "lunch" | "dinner" | "socialise" | "pray" | "play" | "stroll" | "errand" | "rest" | "guard";
export type Activity = { kind: ActivityKind; anchor: RoutineAnchor; start: number; task: string; indoors: boolean };
export type RoutineSubject = { code: string; role: ResidentRole; ageGroup: CharacterAge; guardShift?: 0 | 1 };

const WORK_TASK: Readonly<Partial<Record<ResidentRole, string>>> = {
  farmer: "Working the farm", blacksmith: "Working the forge", merchant: "Trading", trader: "Trading",
  innkeeper: "Keeping the inn", butcher: "Working the butcher shop", "guard-officer": "Coordinating the watch",
  artisan: "Working in the workshop", laborer: "Labouring", clergy: "Tending the shrine", noble: "Holding court",
  beggar: "Begging at the market",
};
/** Trades practised indoors (the NPC is inside its building, not on the street). */
const INDOOR_WORK: ReadonlySet<ResidentRole> = new Set(["blacksmith", "innkeeper", "butcher", "guard-officer", "artisan", "noble"]);

const minutes = (code: string, salt: string, span: number) => Math.floor(unit(`${code}/${salt}`) * span) * MINUTE;

/**
 * The seeded plan of one fantasy day, sorted by start second (00:00-24:00).
 * Every plan begins and ends at home asleep (night guards: at their post), so
 * consecutive days join without jumps. Variation comes from role, age, weekday,
 * personality and the day's mood; the same inputs always give the same plan.
 */
export function dailyPlan(subject: RoutineSubject, traits: ResidentTraits, day: number, weekday: number): Activity[] {
  const { code, role, ageGroup } = subject, p = traits.personality,
    d = (salt: string, span: number) => minutes(code, `${salt}/${day}`, span),
    morningMood = moodAt(code, traits, day, weekday, 8 * HOUR).value,
    eveningMood = moodAt(code, traits, day, weekday, 19 * HOUR).value,
    restDay = weekday === 6,
    plan: Activity[] = [],
    add = (kind: ActivityKind, anchor: RoutineAnchor, start: number, task: string, indoors: boolean) => plan.push({ kind, anchor, start: clamp(Math.round(start), 0, 24 * HOUR - MINUTE), task, indoors });

  if (role === "guard") {
    // Twelve-hour watches: day shift 06-18, night shift 18-06, sleep in the other half.
    const night = subject.guardShift === 1;
    if (night) {
      add("guard", "work", 0, "Night watch", false);
      add("commute", "home", 6 * HOUR, "Walking home", false);
      add("breakfast", "home", 6.4 * HOUR, "Eating at home", true);
      add("sleep", "home", 7 * HOUR, "Sleeping", true);
      add("wake", "home", 15 * HOUR + d("WAKE", 40), "Getting up", true);
      add("dinner", eveningMood > .1 && p.sociability > .5 ? "inn" : "home", 16 * HOUR, "Eating before the watch", true);
      add("commute", "work", 17.4 * HOUR, "Walking to the gate", false);
      add("guard", "work", 18 * HOUR, "Night watch", false);
    } else {
      add("sleep", "home", 0, "Sleeping", true);
      add("wake", "home", 4.75 * HOUR + d("WAKE", 20), "Getting up", true);
      add("breakfast", "home", 5 * HOUR + d("BREAKFAST", 10), "Breakfast at home", true);
      add("commute", "work", 5.5 * HOUR, "Walking to the gate", false);
      add("guard", "work", 6 * HOUR, "Guard duty", false);
      add("commute", eveningMood > 0 && p.sociability > .45 ? "inn" : "home", 18 * HOUR, "Leaving the gate", false);
      add("dinner", eveningMood > 0 && p.sociability > .45 ? "inn" : "home", 18.5 * HOUR, "Dinner", true);
      add("commute", "home", 20.5 * HOUR + d("HOMEWARD", 40), "Walking home", false);
      add("sleep", "home", 21.5 * HOUR + d("SLEEP", 50), "Sleeping", true);
    }
    return plan.sort((a, b) => a.start - b.start);
  }

  // Waking: farmers at first light, the diligent earlier, children and elders later; rest day lie-in.
  const wakeBase = role === "farmer" ? 4.6 : role === "innkeeper" ? 7 : role === "noble" ? 7.5 : ageGroup === "child" ? 6.5 : ageGroup === "elder" ? 6.7 : 5.6,
    wake = (wakeBase + (1 - p.diligence) * .8 + (restDay ? 1 : 0) - (morningMood > .3 ? .2 : 0)) * HOUR + d("WAKE", 25),
    breakfast = wake + 15 * MINUTE + d("DRESS", 15),
    leave = breakfast + 25 * MINUTE + d("BREAKFAST", 20);
  add("sleep", "home", 0, "Sleeping", true);
  add("wake", "home", wake, "Getting up", true);
  add("breakfast", "home", breakfast, "Making breakfast at home", true);

  // Daytime by kind of person.
  let dayEnd: number;
  if (ageGroup === "child") {
    add("play", "plaza", leave, "Playing in the square", false);
    add("lunch", "home", 12 * HOUR + d("LUNCH", 30), "Lunch at home", true);
    add("play", p.curiosity > .5 ? "market" : "plaza", 13.5 * HOUR, "Playing with other children", false);
    dayEnd = 17.5 * HOUR + d("PLAYEND", 40);
  } else if (ageGroup === "elder" || role === "elder") {
    add("stroll", p.piety > .6 ? "keep" : "plaza", leave + 30 * MINUTE, p.piety > .6 ? "Morning prayers" : "Morning stroll", false);
    add("rest", "home", 11 * HOUR + d("ELDREST", 40), "Resting at home", true);
    add("errand", "market", 15 * HOUR + d("ELDERRAND", 50), "Chatting at the market", false);
    dayEnd = 17 * HOUR + d("ELDEND", 40);
  } else if (restDay && role !== "innkeeper" && role !== "clergy" && role !== "beggar") {
    // Rest day: worship, the market and company, then the usual evening.
    add("pray", "plaza", Math.max(leave, 9 * HOUR), p.piety > .4 ? "Attending the shrine" : "Gathering in the square", false);
    add("errand", "market", 10.5 * HOUR + d("RESTMKT", 40), "Visiting the market", false);
    add("lunch", p.sociability > .6 ? "inn" : "home", 12.5 * HOUR, "Rest-day lunch", true);
    add("rest", "home", 14 * HOUR + d("RESTHOME", 40), "Resting at home", true);
    dayEnd = 17 * HOUR;
  } else {
    const start = role === "innkeeper" ? 9.5 * HOUR : role === "clergy" ? Math.max(leave, 6 * HOUR) : leave,
      stop = role === "innkeeper" ? 22.5 * HOUR : role === "farmer" ? 18.5 * HOUR : role === "beggar" ? 17 * HOUR : (17 + p.diligence * 1.5) * HOUR + d("STOP", 30),
      task = WORK_TASK[role] ?? "Working",
      indoors = INDOOR_WORK.has(role);
    add("work", "work", start, task, indoors);
    if (role === "artisan" || role === "laborer" || role === "trader" || role === "farmer") {
      // A midday break: field hands eat on site, townsfolk run an errand at the market.
      const lunch = 12 * HOUR + d("LUNCH", 45);
      if (role === "farmer" || role === "laborer") add("lunch", "work", lunch, "Midday meal", false);
      else add("errand", "market", lunch, "Midday errand at the market", false);
      add("work", "work", lunch + 50 * MINUTE, task, indoors);
    }
    dayEnd = stop;
  }

  // Evening: dinner at the inn when sociable and in good spirits, otherwise at home; sleep at home.
  if (role !== "innkeeper") {
    const inn = (p.sociability * .6 + eveningMood * .5 + (restDay ? .2 : 0) + unit(`${code}/INN/${day}`) * .3) > .62 && ageGroup !== "child",
      dinner = Math.max(dayEnd + 15 * MINUTE, 18 * HOUR + d("DINNER", 40));
    add("commute", inn ? "inn" : "home", dayEnd, inn ? "Walking to the inn" : "Walking home", false);
    add("dinner", inn ? "inn" : "home", dinner, inn ? "Dinner at the inn" : "Cooking dinner at home", true);
    if (inn) {
      add("socialise", "inn", dinner + 50 * MINUTE, eveningMood > .3 ? "Drinking and laughing at the inn" : "Talking at the inn", true);
      add("commute", "home", 21 * HOUR + p.sociability * 1.2 * HOUR + d("INNHOME", 20), "Walking home", false);
    }
  } else {
    add("commute", "home", 22.5 * HOUR, "Closing the inn and walking home", false);
  }
  const bedtime = ageGroup === "child" ? 20.5 : ageGroup === "elder" ? 21 : role === "innkeeper" ? 23.2 : 21.8 + p.sociability * 1.1 - p.diligence * .4;
  add("sleep", "home", Math.max(bedtime * HOUR + d("SLEEP", 30), (plan[plan.length - 1]?.start ?? 0) + 25 * MINUTE), "Sleeping", true);
  return plan.sort((a, b) => a.start - b.start);
}

/** The plan entry active at a second of the day (plans always start at 00:00). */
export function activityAt(plan: readonly Activity[], secondOfDay: number) {
  let index = 0;
  for (let i = 0; i < plan.length; i++) if (plan[i].start <= secondOfDay) index = i;
  return { index, activity: plan[index], previous: plan[index - 1] };
}
