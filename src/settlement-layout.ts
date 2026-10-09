/**
 * Settlement layout authority (WP-S002-004-009). Pure and SEED-addressed: no RNG, wall clock,
 * camera, zoom or visit order. One logical registry per inhabited place drives rendering,
 * inspection and resident homes/work. Coordinates are absolute source units (about 1 m near a
 * settlement); every identity is a canonical code independent of the owning render tile.
 */
import type { Place } from "./geography.ts";

export type Point = { x: number; z: number };
export type BuildingRole =
  | "home"
  | "inn"
  | "market"
  | "blacksmith"
  | "farmstead"
  | "barn"
  | "butcher"
  | "guard-office"
  | "keep";
export type Room = { name: string; areaM2: number };
export type Building = {
  code: string;
  role: BuildingRole;
  /** Footprint centre. */
  x: number;
  z: number;
  /** Yaw in radians: local +z (the front/entrance side) points along (sin(angle), cos(angle)). */
  angle: number;
  /** Footprint along local x and local z. */
  width: number;
  depth: number;
  floors: number;
  /** Door point on the front wall; joined to its street by an access path. */
  entrance: Point;
  /** Point on the street centreline that the access path reaches. */
  access: Point;
  rooms: Room[];
  /** Sleeping places (homes, inn guests) or worker places (services). */
  capacity: number;
  /** "castle" for keep-side residential homes in cities, otherwise "town". */
  district: "town" | "castle";
  street: string;
};
export type Street = { code: string; points: Point[]; width: number };
export type GuardPost = { code: string; x: number; z: number; gate: string };
export type Gate = {
  code: string;
  x: number;
  z: number;
  /** Yaw of the street passing through the opening. */
  angle: number;
  openingWidth: number;
  street: string;
  guardPosts: GuardPost[];
};
/** Closed polygon (last point joins the first); gaps at gates are border-wall openings. */
export type Border = { code: string; points: Point[] };
export type FieldPlot = { code: string; x: number; z: number; angle: number; width: number; depth: number; farm: string };
export type Profession = "innkeeper" | "merchant" | "blacksmith" | "farmer" | "butcher" | "guard" | "lord" | "resident";
export type Resident = { code: string; profession: Profession; home: string; work?: string };
export type SettlementArchetype = "roadside" | "green" | "crossroads" | "riverside";
export type SettlementLayout = {
  place: string;
  code: string;
  archetype: SettlementArchetype;
  center: Point;
  well: Point;
  streets: Street[];
  buildings: Building[];
  border: Border;
  gates: Gate[];
  fields: FieldPlot[];
  residents: Resident[];
};

/** Memoised per place; the same place always returns the identical object. */
export function settlementLayout(place: Place): SettlementLayout {
  throw new Error(`settlementLayout not implemented for ${place.id}`);
}

/** Distance from (x, z) to the nearest street centreline of the nearest settlement; Infinity when none. */
export function streetDistanceAt(x: number, z: number): number {
  void x;
  void z;
  return Infinity;
}

/** Building whose footprint contains (x, z), if any. */
export function buildingAt(x: number, z: number): Building | undefined {
  void x;
  void z;
  return undefined;
}
