import {
  SETTLEMENT_LAYOUT_VERSION,
  WORLD_FOUNDATION_VERSION,
  WORLD_SEED,
} from "./config.ts";
import type { Building, BuildingRole, Room } from "./settlement-layout.ts";

export type InteriorPoint = { x: number; z: number };
export type InteriorRoom = {
  code: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  areaM2: number;
};
export type InteriorDoor = {
  code: string;
  from: string;
  to: string;
  x: number;
  z: number;
  width: number;
};
export type InteriorAnchorKind =
  | "entry"
  | "sleep"
  | "sanitation"
  | "social"
  | "service"
  | "storage"
  | "work"
  | "duty";
export type InteriorAnchor = {
  code: string;
  kind: InteriorAnchorKind;
  room: string;
  x: number;
  z: number;
};
export type InteriorFixtureKind =
  | "bed"
  | "latrine"
  | "hearth"
  | "table"
  | "counter"
  | "rack"
  | "workbench"
  | "forge"
  | "bunk";
export type InteriorFixture = {
  code: string;
  kind: InteriorFixtureKind;
  room: string;
  x: number;
  z: number;
  width: number;
  depth: number;
};
export type InteriorCulture = "alder" | "gilded" | "frontier";
export type InteriorEnvironment =
  | "domestic"
  | "commercial"
  | "craft"
  | "agrarian"
  | "guarded"
  | "fortified";
export type InteriorStyle = {
  culture: InteriorCulture;
  environment: InteriorEnvironment;
  wallMaterial: string;
  floorMaterial: string;
  furnishingMaterial: string;
};
export type InteriorBase = {
  code: string;
  building: string;
  role: BuildingRole;
  width: number;
  depth: number;
  rooms: InteriorRoom[];
  doors: InteriorDoor[];
  anchors: InteriorAnchor[];
  fixtures: InteriorFixture[];
  style: InteriorStyle;
  entry: InteriorPoint;
  signature: string;
};

const WALL = 0.28;
const MIN_DOOR = 0.9;
const INTERIOR_VERSION = "I2";

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function interiorCode(building: Building): string {
  return `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${SETTLEMENT_LAYOUT_VERSION}/${INTERIOR_VERSION}/${building.code}`;
}

function settlementIdentity(building: Building): string {
  const marker = building.code.lastIndexOf("/building/");
  return marker >= 0 ? building.code.slice(0, marker) : building.code;
}

function styleForBuilding(building: Building): InteriorStyle {
  const cultures: InteriorCulture[] = ["alder", "gilded", "frontier"],
    materialFamilies = [
      { wall: "lime-plaster-oak", floor: "oak-plank", furnishing: "waxed-oak" },
      { wall: "warm-stone-plaster", floor: "flagstone", furnishing: "dark-ash" },
      { wall: "rough-stone-timber", floor: "packed-earth-plank", furnishing: "pine" },
    ],
    index = digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${settlementIdentity(building)}/culture`) % cultures.length,
    environment: InteriorEnvironment =
      building.role === "keep" || building.district === "castle"
        ? "fortified"
        : building.role === "guard-office"
          ? "guarded"
          : building.role === "farmstead" || building.role === "barn"
            ? "agrarian"
            : building.role === "blacksmith"
              ? "craft"
              : ["inn", "market", "butcher"].includes(building.role)
                ? "commercial"
                : "domestic";
  return {
    culture: cultures[index],
    environment,
    wallMaterial: materialFamilies[index].wall,
    floorMaterial: environment === "craft" ? "stone-workfloor" : materialFamilies[index].floor,
    furnishingMaterial: materialFamilies[index].furnishing,
  };
}

function canonicalRooms(building: Building): Room[] {
  if (building.rooms.length) return building.rooms.map((room) => ({ ...room }));
  return [{ name: `${building.role} space`, areaM2: Math.max(6, building.width * building.depth * 0.55) }];
}

function anchorKind(name: string, role: BuildingRole): InteriorAnchorKind {
  const key = name.toLowerCase();
  if (/bed|guest|sleep|chamber/.test(key)) return "sleep";
  if (/latrine|toilet|sanitation/.test(key)) return "sanitation";
  if (/living|common|hall/.test(key)) return "social";
  if (/store|storage|cold/.test(key)) return "storage";
  if (/forge|work|kitchen|yard/.test(key)) return "work";
  if (/duty|shelter/.test(key) || role === "guard-office") return "duty";
  if (/stall|sales/.test(key) || ["inn", "market", "butcher"].includes(role)) return "service";
  return "social";
}

function fixtureKind(anchor: InteriorAnchor, role: BuildingRole): InteriorFixtureKind {
  switch (anchor.kind) {
    case "sleep":
      return "bed";
    case "sanitation":
      return "latrine";
    case "storage":
      return "rack";
    case "duty":
      return "bunk";
    case "work":
      return role === "blacksmith" ? "forge" : "workbench";
    case "service":
      return "counter";
    case "social":
      return role === "home" || role === "farmstead" ? "hearth" : "table";
    default:
      return "table";
  }
}

function fixturesFor(baseCode: string, rooms: InteriorRoom[], anchors: InteriorAnchor[], role: BuildingRole): InteriorFixture[] {
  const byRoom = new Map(rooms.map((room) => [room.code, room] as const));
  return anchors
    .filter((anchor) => anchor.kind !== "entry")
    .map((anchor, index) => {
      const room = byRoom.get(anchor.room);
      if (!room) throw new Error(`fixture anchor ${anchor.code} has no room`);
      const kind = fixtureKind(anchor, role),
        nominal =
          kind === "bed" || kind === "bunk"
            ? [1.7, 0.8]
            : kind === "forge"
              ? [1.4, 1.1]
              : kind === "counter" || kind === "workbench"
                ? [1.5, 0.65]
                : kind === "rack"
                  ? [1.15, 0.5]
                  : kind === "latrine"
                    ? [0.75, 0.75]
                    : [1.0, 1.0],
        width = Math.max(0.4, Math.min(nominal[0], room.width - 0.55)),
        depth = Math.max(0.4, Math.min(nominal[1], room.depth - 0.55)),
        roomX = Math.max(0, room.width / 2 - width / 2 - 0.25),
        roomZ = Math.max(0, room.depth / 2 - depth / 2 - 0.25),
        hash = digest(`${baseCode}/fixture/${index}/${anchor.kind}`),
        x = room.x + (hash & 1 ? 1 : -1) * Math.min(roomX, room.width * 0.2),
        z = room.z + (hash & 2 ? 1 : -1) * Math.min(roomZ, room.depth * 0.2);
      return {
        code: `${baseCode}/fixture/${index}`,
        kind,
        room: room.code,
        x,
        z,
        width,
        depth,
      };
    });
}

/** Pure canonical interior reconstruction. No cache, camera, renderer or visit-order input. */
export function interiorBaseForBuilding(building: Building): InteriorBase {
  const code = interiorCode(building),
    source = canonicalRooms(building),
    usableWidth = Math.max(1.8, building.width - WALL * 2),
    usableDepth = Math.max(1.8, building.depth - WALL * 2),
    usableArea = usableWidth * usableDepth,
    requested = source.reduce((sum, room) => sum + Math.max(0.5, room.areaM2), 0),
    weights = source.map((room) => Math.max(0.5, room.areaM2) / requested),
    splitX = (digest(`${code}/axis`) & 1) === 1,
    reverse = (digest(`${code}/order`) & 1) === 1,
    order = source.map((_, index) => index);
  if (reverse) order.reverse();

  const rooms: InteriorRoom[] = [];
  let cursor = splitX ? -usableWidth / 2 : -usableDepth / 2;
  for (let ordinal = 0; ordinal < order.length; ordinal++) {
    const sourceIndex = order[ordinal],
      room = source[sourceIndex],
      last = ordinal === order.length - 1,
      spanTotal = splitX ? usableWidth : usableDepth,
      span = last
        ? spanTotal / 2 - cursor
        : Math.max(0.8, spanTotal * weights[sourceIndex]),
      width = splitX ? span : usableWidth,
      depth = splitX ? usableDepth : span,
      x = splitX ? cursor + span / 2 : 0,
      z = splitX ? 0 : cursor + span / 2,
      areaM2 = width * depth;
    rooms.push({
      code: `${code}/room/${sourceIndex}`,
      name: room.name,
      x,
      z,
      width,
      depth,
      areaM2,
    });
    cursor += span;
  }

  const doors: InteriorDoor[] = [];
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = rooms[i],
      b = rooms[i + 1],
      x = splitX ? a.x + Math.sign(b.x - a.x) * a.width / 2 : 0,
      z = splitX ? 0 : a.z + Math.sign(b.z - a.z) * a.depth / 2;
    doors.push({
      code: `${code}/door/${i}`,
      from: a.code,
      to: b.code,
      x,
      z,
      width: MIN_DOOR,
    });
  }

  let entryRoom = rooms[0];
  for (const room of rooms)
    if (room.z + room.depth / 2 > entryRoom.z + entryRoom.depth / 2) entryRoom = room;
  const entry = {
    x: Math.max(entryRoom.x - entryRoom.width / 2 + 0.6, Math.min(entryRoom.x + entryRoom.width / 2 - 0.6, 0)),
    z: usableDepth / 2 - 0.05,
  };
  const anchors: InteriorAnchor[] = [
    {
      code: `${code}/anchor/entry`,
      kind: "entry",
      room: entryRoom.code,
      x: entry.x,
      z: entry.z,
    },
  ];
  rooms.forEach((room, index) => {
    anchors.push({
      code: `${code}/anchor/${index}`,
      kind: anchorKind(room.name, building.role),
      room: room.code,
      x: room.x,
      z: room.z,
    });
  });
  const fixtures = fixturesFor(code, rooms, anchors, building.role),
    style = styleForBuilding(building);

  const signaturePayload = [
    code,
    `${usableWidth.toFixed(3)}x${usableDepth.toFixed(3)}`,
    `style:${style.culture}:${style.environment}:${style.wallMaterial}:${style.floorMaterial}:${style.furnishingMaterial}`,
    ...rooms.map(
      (room) =>
        `${room.code}:${room.name}:${room.x.toFixed(3)},${room.z.toFixed(3)},${room.width.toFixed(3)},${room.depth.toFixed(3)}`,
    ),
    ...doors.map((door) => `${door.from}>${door.to}@${door.x.toFixed(3)},${door.z.toFixed(3)}`),
    ...anchors.map((anchor) => `${anchor.kind}:${anchor.room}@${anchor.x.toFixed(3)},${anchor.z.toFixed(3)}`),
    ...fixtures.map(
      (fixture) =>
        `${fixture.kind}:${fixture.room}@${fixture.x.toFixed(3)},${fixture.z.toFixed(3)},${fixture.width.toFixed(3)},${fixture.depth.toFixed(3)}`,
    ),
  ].join("|");
  const signature = `${code}/SIG/${digest(signaturePayload).toString(16).padStart(8, "0")}`;

  if (usableArea + 1e-6 < requested)
    throw new Error(
      `building ${building.code} usable interior ${usableArea.toFixed(2)}m2 is below program ${requested.toFixed(2)}m2`,
    );

  return {
    code,
    building: building.code,
    role: building.role,
    width: usableWidth,
    depth: usableDepth,
    rooms,
    doors,
    anchors,
    fixtures,
    style,
    entry,
    signature,
  };
}

export type InteriorResidencyStats = {
  active: number;
  materializations: number;
  evictions: number;
  activeBuildings: string[];
  rooms: number;
  fixtures: number;
  estimatedBytes: number;
};

function estimatedBaseBytes(base: InteriorBase): number {
  return (
    256 +
    base.code.length * 2 +
    base.signature.length * 2 +
    base.rooms.length * 112 +
    base.doors.length * 88 +
    base.anchors.length * 80 +
    base.fixtures.length * 104
  );
}

/** Bounded protagonist-demand residency. Settlement visibility alone never calls enter(). */
export class InteriorResidency {
  readonly maxActive: number;
  private readonly active = new Map<string, { base: InteriorBase; stamp: number }>();
  private stamp = 0;
  private materializations = 0;
  private evictions = 0;

  constructor(maxActive = 2) {
    if (!Number.isInteger(maxActive) || maxActive < 1) throw new RangeError("maxActive must be a positive integer");
    this.maxActive = maxActive;
  }

  enter(building: Building): InteriorBase {
    this.stamp++;
    const existing = this.active.get(building.code);
    if (existing) {
      existing.stamp = this.stamp;
      return existing.base;
    }
    const base = interiorBaseForBuilding(building);
    this.materializations++;
    this.active.set(building.code, { base, stamp: this.stamp });
    while (this.active.size > this.maxActive) {
      let oldestCode: string | undefined,
        oldestStamp = Infinity;
      for (const [code, entry] of this.active)
        if (entry.stamp < oldestStamp) {
          oldestCode = code;
          oldestStamp = entry.stamp;
        }
      if (!oldestCode) break;
      this.active.delete(oldestCode);
      this.evictions++;
    }
    return base;
  }

  exit(_buildingCode: string): void {
    // Exiting does not mutate canonical gameplay state. The base may remain until pressure evicts it.
  }

  evict(buildingCode: string): boolean {
    const removed = this.active.delete(buildingCode);
    if (removed) this.evictions++;
    return removed;
  }

  clear(): void {
    this.evictions += this.active.size;
    this.active.clear();
  }

  has(buildingCode: string): boolean {
    return this.active.has(buildingCode);
  }

  stats(): InteriorResidencyStats {
    let rooms = 0,
      fixtures = 0,
      estimatedBytes = 0;
    for (const { base } of this.active.values()) {
      rooms += base.rooms.length;
      fixtures += base.fixtures.length;
      estimatedBytes += estimatedBaseBytes(base);
    }
    return {
      active: this.active.size,
      materializations: this.materializations,
      evictions: this.evictions,
      activeBuildings: [...this.active.keys()],
      rooms,
      fixtures,
      estimatedBytes,
    };
  }
}
