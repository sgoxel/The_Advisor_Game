/**
 * Character types: one per illustrated NPC image in public/characters/<key>.webp.
 * A resident's type is chosen from its role and seed, so its sex, age group and
 * trade always match its picture. Sizes are real-world metres; the sprite is
 * drawn at the person's true height (plus any prop that rises above the head).
 * `default` (the former protagonist art) is used when no type fits a role.
 */
import type { ResidentRole } from "./simulation.ts";

export type CharacterSex = "female" | "male";
export type CharacterAge = "child" | "adult" | "elder";
export type CharacterType = {
  key: string;
  sex: CharacterSex;
  age: CharacterAge;
  /** Width / height of the trimmed image. */
  aspect: number;
  /** Share of the image height taken by a prop above the head (bow, pickaxe, crook). */
  propTop?: number;
  /** Only plausible in settlements by water. */
  needsWater?: boolean;
};

const T = (key: string, sex: CharacterSex, age: CharacterAge, aspect: number, extra: Partial<CharacterType> = {}): CharacterType => ({ key, sex, age, aspect, ...extra });

export const CHARACTER_TYPES: Readonly<Record<string, CharacterType>> = Object.fromEntries([
  T("baker_female", "female", "adult", .4531),
  T("beggar_female", "female", "adult", .4219),
  T("beggar_male", "male", "adult", .4896),
  T("blacksmith_male", "male", "adult", .4714),
  T("butcher_male", "male", "adult", .6901),
  T("carpenter_male", "male", "adult", .5443),
  T("child_female", "female", "child", .3568),
  T("child_male", "male", "child", .4766),
  T("cleric_female", "female", "adult", .3516),
  T("elder_female", "female", "elder", .5573),
  T("elder_male", "male", "elder", .4609),
  T("farmer_male", "male", "adult", .5),
  T("fisherman_male", "male", "adult", .5339, { needsWater: true }),
  T("guard_captain_male", "male", "adult", .5026),
  T("guard_male", "male", "adult", .4531),
  T("herbalist_female", "female", "adult", .3932),
  T("hunter_female", "female", "adult", .5104, { propTop: .07 }),
  T("innkeeper_male", "male", "adult", .5677),
  T("leatherworker_male", "male", "adult", .4688),
  T("market_vendor_female", "female", "adult", .5156),
  T("merchant_male", "male", "adult", .4974),
  T("messenger_female", "female", "adult", .4766),
  T("miller_male", "male", "adult", .4844),
  T("miner_male", "male", "adult", .5469, { propTop: .06 }),
  T("monk_male", "male", "adult", .4661),
  T("nobleman_male", "male", "adult", .4896),
  T("noblewoman_female", "female", "adult", .3698),
  T("nun_female", "female", "adult", .3932),
  T("potter_female", "female", "adult", .3906),
  T("priest_male", "male", "adult", .4349),
  T("scribe_male", "male", "adult", .4714),
  T("seamstress_female", "female", "adult", .4661),
  T("shepherd_male", "male", "adult", .5391, { propTop: .05 }),
  T("stablehand_female", "female", "adult", .474),
  T("tailor_male", "male", "adult", .4661),
  T("tavernkeeper_female", "female", "adult", .375),
  T("tavernkeeper_male", "male", "adult", .5339),
  T("woodcutter_male", "male", "adult", .5156),
  T("default", "male", "adult", .4453),
].map((type) => [type.key, type]));

/** Which pictures fit each role. A role with no entry uses `default`. */
export const ROLE_CHARACTERS: Readonly<Partial<Record<ResidentRole, readonly string[]>>> = {
  innkeeper: ["innkeeper_male", "tavernkeeper_male", "tavernkeeper_female"],
  merchant: ["merchant_male"],
  blacksmith: ["blacksmith_male"],
  farmer: ["farmer_male", "farmer_male", "shepherd_male", "miller_male"],
  butcher: ["butcher_male"],
  "guard-officer": ["guard_captain_male"],
  guard: ["guard_male"],
  artisan: ["baker_female", "carpenter_male", "leatherworker_male", "potter_female", "seamstress_female", "tailor_male", "scribe_male"],
  laborer: ["woodcutter_male", "miner_male", "stablehand_female", "fisherman_male", "hunter_female", "messenger_female", "herbalist_female"],
  trader: ["market_vendor_female", "merchant_male"],
  clergy: ["priest_male", "monk_male", "nun_female", "cleric_female"],
  noble: ["nobleman_male", "noblewoman_female"],
  beggar: ["beggar_male", "beggar_female"],
  child: ["child_male", "child_female"],
  elder: ["elder_male", "elder_female"],
};

/** Seed-keyed pick among the role's pictures; water-only trades are skipped away from water. */
export function characterForRole(role: ResidentRole, seed: number, nearWater: boolean): CharacterType {
  const keys = (ROLE_CHARACTERS[role] || []).filter((key) => nearWater || !CHARACTER_TYPES[key].needsWater);
  return CHARACTER_TYPES[keys.length ? keys[seed % keys.length] : "default"];
}

/** Real body height in metres (medieval adult ranges), varied by the resident's silhouette seed 0-4. */
export function characterHeightM(type: CharacterType, silhouette: number) {
  const t = (silhouette % 5) / 4,
    [low, high] = type.age === "child" ? [1.15, 1.35]
      : type.age === "elder" ? (type.sex === "male" ? [1.6, 1.72] : [1.5, 1.62])
        : type.sex === "male" ? [1.66, 1.82] : [1.54, 1.68];
  return low + (high - low) * t;
}

/** Sprite size in metres: the body keeps its real height; a prop above the head extends the image. */
export function characterSpriteM(type: CharacterType, silhouette: number) {
  const heightM = characterHeightM(type, silhouette) / (1 - (type.propTop || 0));
  return { heightM, widthM: heightM * type.aspect };
}
