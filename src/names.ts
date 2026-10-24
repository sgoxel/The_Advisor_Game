/**
 * Seeded name generator for everything in the realm: people, houses, shops,
 * inns, keeps, wells, streets, gates, fields and walls. Every name is a pure
 * function of a SEED-keyed address (and the continent's naming culture), so a
 * thing is always called the same whenever it is generated. No global tables
 * are filled: names are made on demand for whatever is in the focused area.
 */

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
const pick = <T>(list: readonly T[], address: string): T => list[digest(address) % list.length];

export type NameSex = "female" | "male";

/** Three naming cultures, one per continent (0 Eldermere, 1 Westreach, 2 Dawnlands). */
type Culture = {
  starts: readonly string[];
  middles: readonly string[];
  female: readonly string[];
  male: readonly string[];
  familyFirst: readonly string[];
  familySecond: readonly string[];
  stems: readonly string[];
};
const CULTURES: readonly Culture[] = [
  {
    starts: ["Al", "Ber", "Cor", "Ed", "Gar", "Hal", "Os", "Wil", "Rod", "Ead", "Tam", "Bran", "Mer", "Eld", "Wyn", "God"],
    middles: ["", "", "", "a", "e", "i", "o", "ri", "le"],
    female: ["a", "wyn", "ith", "ild", "ra", "en", "ys", "ette", "da", "wen"],
    male: ["ric", "win", "mund", "red", "ard", "bert", "an", "ulf", "ston", "wald"],
    familyFirst: ["Ash", "Briar", "Crow", "Dale", "Ember", "Ford", "Grey", "Hearth", "Iron", "Lake", "Moss", "Oak", "Pine", "Reed", "Stone", "Vale", "Thorn", "Mill", "Hollow", "Wheat"],
    familySecond: ["", "", "wood", "field", "ford", "well", "ley", "brook", "wright", "hand", "more", "worth"],
    stems: ["Ald", "Bram", "Cor", "Ead", "Gar", "Hal", "Os", "Wil", "Ash", "Thorn", "Elm", "Wyn"],
  },
  {
    starts: ["Bran", "Cael", "Dun", "Fion", "Mor", "Rhi", "Tal", "Gwen", "Aed", "Cer", "Lir", "Nia", "Ow", "Sei", "Tey", "Ard"],
    middles: ["", "", "a", "e", "i", "o", "wy", "ra"],
    female: ["wen", "ra", "nwy", "eth", "ith", "a", "ys", "lle", "an", "ona"],
    male: ["og", "an", "ach", "wyn", "oc", "us", "dan", "mor", "eth", "in"],
    familyFirst: ["MacArdle", "MacKerrin", "MacEwan", "Ap Rhys", "Ap Owen", "Dunmore", "Glendower", "Brynmor", "Llanwyth", "Craigmore", "Penrose", "Tregarron", "Kerrigan", "Dalross", "Fitzallan", "O'Brennan", "O'Connell", "Morvaine"],
    familySecond: [""],
    stems: ["Bryn", "Cael", "Dun", "Glen", "Llan", "Mor", "Penn", "Rhos", "Tal", "Tre", "Ard", "Cer"],
  },
  {
    starts: ["Al", "Cas", "Dor", "Esp", "Lor", "Mar", "Ser", "Val", "Is", "Lu", "Te", "Ve", "Or", "Ce", "Fa", "Ro"],
    middles: ["", "a", "e", "i", "o", "ri", "le", "na"],
    female: ["a", "ina", "ela", "ia", "ana", "isa", "ora", "eta", "ena", "ida"],
    male: ["o", "io", "an", "es", "or", "ino", "us", "ar", "el", "ero"],
    familyFirst: ["Del", "Da", "Di", "Della", "Vas", "Mon", "Cor", "Ros", "Sal", "Ter", "Ven", "Al"],
    familySecond: ["vara", "monte", "rio", "cerro", "mar", "sol", "verde", "lago", "torre", "fonte", "bosco", "campo"],
    stems: ["Alca", "Casta", "Dora", "Lora", "Mara", "Sera", "Vala", "Terra", "Rosa", "Sola", "Vista", "Fonta"],
  },
];
const cultureFor = (continent: number) => CULTURES[((continent % CULTURES.length) + CULTURES.length) % CULTURES.length];
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const VOWEL = /[aeiouy]/;
/** Join syllables smoothly: no vowel pile-ups ("Rhi"+"an" stays "Rhian", not "Rhiaan") and no tripled letters. */
function joinSyllables(parts: readonly string[]) {
  let out = "";
  for (const raw of parts) {
    let part = raw.toLowerCase();
    if (!part) continue;
    if (out && VOWEL.test(out.slice(-1)) && VOWEL.test(part[0])) {
      if (part.length === 1) continue; // a lone joining vowel after a vowel adds nothing
      part = part.slice(1);
    }
    out += part;
  }
  return out.replace(/(.)\1{2,}/g, "$1$1");
}

// ---------------------------------------------------------------- people

/** A given name built from culture syllables, ending by sex. */
export function givenName(address: string, sex: NameSex, continent: number) {
  const c = cultureFor(continent);
  return cap(joinSyllables([pick(c.starts, `${address}/GIVEN/START`), pick(c.middles, `${address}/GIVEN/MIDDLE`), pick(sex === "female" ? c.female : c.male, `${address}/GIVEN/END`)]));
}
/** A family name; depends only on the family address, so a household and its house share it. */
export function familyName(address: string, continent: number) {
  const c = cultureFor(continent),
    first = pick(c.familyFirst, `${address}/FAMILY/FIRST`), second = pick(c.familySecond, `${address}/FAMILY/SECOND`);
  return second ? cap(joinSyllables([first, second])) : first;
}
export function personName(address: string, sex: NameSex, continent: number) {
  return `${givenName(address, sex, continent)} ${familyName(address, continent)}`;
}

// ---------------------------------------------------------------- buildings

const INN_ADJECTIVES = ["Gilded", "Sleeping", "Prancing", "Drowned", "Laughing", "Silver", "Crooked", "Golden", "Wandering", "Red", "Merry", "Hungry", "Blind", "Jolly", "Rusty", "Weary"];
const INN_NOUNS = ["Boar", "Fox", "Stag", "Goose", "Lantern", "Kettle", "Raven", "Hound", "Barrel", "Crown", "Pony", "Anchor", "Plough", "Tankard", "Owl", "Ram"];

export type BuildingKind = "inn" | "market" | "blacksmith" | "butcher" | "guard-office" | "farmstead" | "keep" | "well" | "house" | "garden" | "field" | "headman" | "merchant"
  | "cafe" | "restaurant" | "square" | "playground" | "flower-garden";

/**
 * A building's proper name. `address` is its plot id; `place` the settlement's
 * name; `owner` the owning household's family name when it has one.
 */
export function buildingName(kind: BuildingKind, address: string, place: string, continent: number, owner?: string, city = false) {
  const c = cultureFor(continent), stem = pick(c.stems, `${address}/STEM`), family = owner ?? familyName(address, continent);
  switch (kind) {
    case "inn": return `The ${pick(INN_ADJECTIVES, `${address}/INN/ADJ`)} ${pick(INN_NOUNS, `${address}/INN/NOUN`)}`;
    case "market": return pick([`${place} Market`, `${place} Market Square`, `The Corn Market`, `${stem} Market Cross`], `${address}/MARKET`);
    case "blacksmith": return pick([`${family} Forge`, `${family}'s Smithy`, `The Anvil of ${family}`], `${address}/SMITH`);
    case "butcher": return pick([`${family}'s Butchery`, `${family} Meats`, `The ${family} Shambles`], `${address}/BUTCHER`);
    case "guard-office": return pick([`${place} Watchhouse`, `The ${place} Guardhall`, `${stem} Watch`], `${address}/WATCH`);
    case "farmstead": return pick([`${family} Farm`, `${family} Steading`, `${stem}field Farm`], `${address}/FARM`);
    case "keep": return city ? pick([`Castle ${stem}`, `${place} Castle`, `${stem}hold`], `${address}/KEEP`) : pick([`${place} Tower`, `${family} Hall`, `${stem} Keep`], `${address}/KEEP`);
    case "well": return pick([`${place} Well`, `The Old Well`, `${stem}'s Well`, `The Market Well`], `${address}/WELL`);
    case "headman": return `${family} Hall`;
    case "merchant": return `${family} Trading House`;
    case "garden": return `${family} Garden`;
    case "field": return pick([`${family} Acre`, `Long Meadow`, `${stem} Field`, `Mill Acre`, `${family} Strip`, `Upper Pasture`, `${stem} Orchard`], `${address}/FIELD`);
    case "cafe": return pick([`The Copper Kettle`, `Rosewater Café`, `${family}'s Coffee House`, `The Sleepy Cat Café`], `${address}/CAFE`);
    case "restaurant": return pick([`The Golden Ladle`, `${family}'s Kitchen`, `The Roasted Hen`, `Saffron & Thyme`], `${address}/RESTAURANT`);
    case "square": return pick([`${place} Square`, `Town Square`, `${stem} Square`, `Guildhall Square`], `${address}/SQUARE`);
    case "playground": return pick([`Children's Green`, `${stem} Playground`, `The Swing Yard`], `${address}/PLAYGROUND`);
    case "flower-garden": return pick([`${family} Rose Garden`, `Lavender Walk`, `${stem} Gardens`, `The Physic Garden`], `${address}/FLOWER-GARDEN`);
    default: return `${family} House`;
  }
}

// ---------------------------------------------------------------- streets, gates, walls

const STREET_NOUNS = ["Tanner", "Mill", "Baker", "Chandler", "Cooper", "Weaver", "Smith", "Fletcher", "Bell", "Church", "Well", "Horse", "Bridge", "Sheep", "Cherry", "Hollow", "Rope", "Salt", "Wool", "Fish", "Malt", "Potter", "Dyer", "Lantern"];
const STREET_TYPES = ["Street", "Lane", "Row", "Way", "Walk", "Alley", "Gate", "Close"];
/**
 * Unique street names within one settlement: `index` 0 is the main street.
 * Uniqueness is decided by the settlement's own street list, never global state.
 */
export function streetNames(settlementAddress: string, count: number, city: boolean) {
  const used = new Set<string>(), names: string[] = [];
  for (let index = 0; index < count; index++) {
    if (index === 0) {
      const main = pick(city ? ["High Street", "Market Street", "King's Way", "Castle Street"] : ["High Street", "Main Street", "Village Street", "Church Street"], `${settlementAddress}/STREET/MAIN`);
      used.add(main);
      names.push(main);
      continue;
    }
    let name = "";
    for (let attempt = 0; attempt < 40 && (!name || used.has(name)); attempt++) {
      const noun = pick(STREET_NOUNS, `${settlementAddress}/STREET/${index}/${attempt}/NOUN`);
      name = `${noun}${noun.endsWith("er") || noun.endsWith("th") ? "'s" : ""} ${pick(STREET_TYPES, `${settlementAddress}/STREET/${index}/${attempt}/TYPE`)}`;
    }
    if (used.has(name)) name = `${name} ${index}`;
    used.add(name);
    names.push(name);
  }
  return names;
}
/** A gate is named for the direction it faces (bearing measured from east, counter-clockwise in source x/z). */
export function gateName(bearingRad: number, place: string, address: string) {
  const directions = ["East", "South-East", "South", "South-West", "West", "North-West", "North", "North-East"],
    sector = ((Math.round(bearingRad / (Math.PI / 4)) % 8) + 8) % 8;
  return pick([`${directions[sector]} Gate`, `${place} ${directions[sector]} Gate`], `${address}/GATE`);
}
export function wallName(place: string, city: boolean) {
  return city ? `${place} Walls` : `${place} Fence`;
}
