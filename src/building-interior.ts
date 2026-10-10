/**
 * Protagonist-demand building interiors for WP-S002-004-009.
 *
 * Interior truth is derived only from the canonical building identity/program, settlement identity,
 * local seeded climate and SEED versions. Looking at, focusing, or rendering a settlement never
 * calls this module. A plan is realized only through enter(), can be evicted after exit(), and
 * reconstructs byte-for-byte equivalent logical topology on re-entry. Renderer/camera/device state
 * is intentionally absent from this authority.
 */
import { BUILDING_INTERIOR_VERSION, SETTLEMENT_LAYOUT_VERSION, WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { climateSampleAt } from "./climate.ts";
import { sourceToLonLat } from "./planet.ts";
import type { Building, BuildingRole, Point, Room } from "./settlement-layout.ts";

export type InteriorDoor = {
  code: string;
  kind: "door" | "stair";
  from: string;
  to: string;
  widthM: number;
};

export type InteriorAnchor = {
  code: string;
  room: string;
  kind:
    | "bed"
    | "latrine"
    | "hearth"
    | "table"
    | "counter"
    | "forge"
    | "anvil"
    | "stall"
    | "storage"
    | "workbench"
    | "desk"
    | "rack"
    | "hay"
    | "stairs"
    | "entrance";
  x: number;
  z: number;
};

export type InteriorRoom = Room & {
  code: string;
  floor: number;
  /** Local-space room centre in metres, relative to the building footprint centre. */
  x: number;
  z: number;
  widthM: number;
  depthM: number;
};

export type InteriorStyle = {
  culture: "Marcher" | "Riverward" | "Highland" | "Woodland" | "Coastal";
  environment: "cold" | "temperate" | "warm-dry" | "humid" | "forested";
  construction: string;
  heating: string;
  furniture: string;
  wall: string;
  floor: string;
  accent: string;
};

export type InteriorPlan = {
  code: string;
  building: string;
  role: BuildingRole;
  floors: number;
  footprint: { widthM: number; depthM: number };
  /** Exterior canonical threshold. This is not copied into a second world coordinate system. */
  exteriorEntrance: Point;
  style: InteriorStyle;
  rooms: InteriorRoom[];
  doors: InteriorDoor[];
  anchors: InteriorAnchor[];
  signature: string;
  estimatedBytes: number;
};

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function key(building: Building, purpose: string, index = 0) {
  return `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${SETTLEMENT_LAYOUT_VERSION}/${BUILDING_INTERIOR_VERSION}/${building.code}/${purpose}/${index}`;
}

function unit(building: Building, purpose: string, index = 0) {
  return digest(key(building, purpose, index)) / 4294967296;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function styleFor(building: Building): InteriorStyle {
  const settlement = building.code.includes("/building/")
      ? building.code.slice(0, building.code.lastIndexOf("/building/"))
      : building.code,
    cultureNames: InteriorStyle["culture"][] = ["Marcher", "Riverward", "Highland", "Woodland", "Coastal"],
    culture = cultureNames[digest(`${WORLD_SEED}/${SETTLEMENT_LAYOUT_VERSION}/${settlement}/culture`) % cultureNames.length],
    climate = climateSampleAt(sourceToLonLat(building.x, building.z), 0),
    environment: InteriorStyle["environment"] = climate.forestFamily
      ? "forested"
      : climate.temperatureC < 4
        ? "cold"
        : climate.moisture > 0.68
          ? "humid"
          : climate.temperatureC > 19 && climate.moisture < 0.42
            ? "warm-dry"
            : "temperate",
    palettes: Record<InteriorStyle["culture"], Pick<InteriorStyle, "wall" | "floor" | "accent">> = {
      Marcher: { wall: "#c8b88c", floor: "#574937", accent: "#d5aa62" },
      Riverward: { wall: "#b7c0a8", floor: "#48544d", accent: "#83b1a4" },
      Highland: { wall: "#a7a69d", floor: "#494846", accent: "#c1a06e" },
      Woodland: { wall: "#aeb78f", floor: "#3f4b39", accent: "#b9a763" },
      Coastal: { wall: "#c8bea8", floor: "#48545a", accent: "#84aebe" },
    },
    palette = palettes[culture],
    serviceStone = building.role === "blacksmith" || building.role === "guard-office" || building.role === "keep",
    construction = serviceStone
      ? environment === "warm-dry" ? "limewashed stone and timber" : "stone base with timber framing"
      : building.role === "barn" || building.role === "farmstead"
        ? "heavy local timber frame"
        : environment === "cold"
          ? "insulated timber frame with stone hearth wall"
          : environment === "humid"
            ? "raised timber frame with lime plaster"
            : environment === "forested"
              ? "oak frame with wattle-and-daub infill"
              : environment === "warm-dry"
                ? "lime plaster over stone-and-timber walls"
                : "timber frame with plaster infill",
    heating = building.role === "blacksmith"
      ? "forge hearth"
      : environment === "cold"
        ? "enclosed masonry hearth"
        : environment === "warm-dry"
          ? "small vented cook hearth"
          : "central hearth",
    furniture = building.role === "market"
      ? `${culture.toLowerCase()} trestles and lockable chests`
      : building.role === "inn"
        ? `${culture.toLowerCase()} benches, tables and guest bedsteads`
        : building.role === "blacksmith"
          ? `${culture.toLowerCase()} forge benches, racks and anvil blocks`
          : building.role === "guard-office" || building.role === "keep"
            ? `${culture.toLowerCase()} desks, weapon racks and storage chests`
            : building.role === "barn" || building.role === "farmstead"
              ? `${culture.toLowerCase()} bins, racks and work tables`
              : `${culture.toLowerCase()} stools, table, chests and bedsteads`;
  return { culture, environment, construction, heating, furniture, ...palette };
}

function anchorKind(role: BuildingRole, roomName: string, ordinal: number): InteriorAnchor["kind"] {
  const room = roomName.toLowerCase();
  if (room.includes("latrine")) return "latrine";
  if (room.includes("bed")) return "bed";
  if (role === "blacksmith") return ordinal % 2 ? "anvil" : "forge";
  if (role === "market") return ordinal % 2 ? "counter" : "stall";
  if (role === "barn") return ordinal % 2 ? "storage" : "hay";
  if (role === "guard-office" || role === "keep") return ordinal % 2 ? "rack" : "desk";
  if (role === "butcher") return ordinal % 2 ? "counter" : "workbench";
  if (role === "farmstead") return ordinal % 2 ? "storage" : "table";
  if (role === "inn") return ordinal % 2 ? "table" : "counter";
  return ordinal % 2 ? "table" : "hearth";
}

/**
 * Deterministically packs the canonical room program into floor-local strips. This is a logical
 * navigation/collision base, not final art. Each room receives at least the canonical required area,
 * the first room connects to the exterior threshold, and every later room is connected to the
 * preceding room so there are no unreachable mandatory spaces. Floor changes are explicit stairs.
 */
export function interiorPlanFor(building: Building): InteriorPlan {
  const usableWidth = Math.max(2.4, building.width - 0.6),
    usableDepth = Math.max(2.4, building.depth - 0.6),
    floorArea = usableWidth * usableDepth,
    floors = Math.max(1, building.floors),
    roomsPerFloor = Math.max(1, Math.ceil(building.rooms.length / floors)),
    rooms: InteriorRoom[] = [];
  let floor = 0,
    used = 0,
    floorOrdinal = 0;

  for (let i = 0; i < building.rooms.length; i++) {
    const source = building.rooms[i],
      required = Math.max(1.5, source.areaM2);
    if (
      floor < floors - 1 &&
      used > 0 &&
      (floorOrdinal >= roomsPerFloor || used + required > floorArea * 0.78)
    ) {
      floor++;
      used = 0;
      floorOrdinal = 0;
    }
    const maxRoomWidth = Math.max(1.8, usableWidth * (0.48 + unit(building, "room-width", i) * 0.32)),
      widthM = Math.min(usableWidth, Math.max(1.8, Math.sqrt(required) * (0.9 + unit(building, "room-aspect", i) * 0.45))),
      boundedWidth = Math.min(maxRoomWidth, widthM),
      depthM = Math.min(usableDepth, Math.max(1.8, required / boundedWidth)),
      columns = Math.max(1, Math.floor(usableWidth / Math.max(2.1, boundedWidth))),
      column = floorOrdinal % columns,
      row = Math.floor(floorOrdinal / columns),
      x = -usableWidth / 2 + boundedWidth / 2 + column * (usableWidth / columns),
      z = -usableDepth / 2 + depthM / 2 + row * Math.min(depthM + 0.35, usableDepth / Math.max(1, Math.ceil(building.rooms.length / floors / columns)));
    rooms.push({
      ...source,
      code: `${building.code}/INTERIOR/ROOM/${i}`,
      floor,
      x: round(Math.max(-usableWidth / 2 + boundedWidth / 2, Math.min(usableWidth / 2 - boundedWidth / 2, x))),
      z: round(Math.max(-usableDepth / 2 + depthM / 2, Math.min(usableDepth / 2 - depthM / 2, z))),
      widthM: round(boundedWidth),
      depthM: round(depthM),
    });
    used += required;
    floorOrdinal++;
  }

  const doors: InteriorDoor[] = [];
  if (rooms.length) {
    doors.push({ code: `${building.code}/INTERIOR/DOOR/ENTRY`, kind: "door", from: "EXTERIOR", to: rooms[0].code, widthM: 1.1 });
    for (let i = 1; i < rooms.length; i++) {
      const floorChange = rooms[i - 1].floor !== rooms[i].floor;
      doors.push({
        code: `${building.code}/INTERIOR/${floorChange ? "STAIR" : "DOOR"}/${i}`,
        kind: floorChange ? "stair" : "door",
        from: rooms[i - 1].code,
        to: rooms[i].code,
        widthM: floorChange ? 1.0 : 0.9,
      });
    }
  }

  const anchors: InteriorAnchor[] = [];
  if (rooms.length)
    anchors.push({
      code: `${building.code}/INTERIOR/ANCHOR/ENTRY`,
      room: rooms[0].code,
      kind: "entrance",
      x: 0,
      z: round(usableDepth / 2 - 0.55),
    });
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i],
      count = building.role === "market" || building.role === "inn" ? 2 : 1;
    for (let j = 0; j < count; j++) {
      const spread = count === 1 ? 0 : (j === 0 ? -1 : 1) * room.widthM * 0.22;
      anchors.push({
        code: `${building.code}/INTERIOR/ANCHOR/${i}/${j}`,
        room: room.code,
        kind: anchorKind(building.role, room.name, i + j),
        x: round(room.x + spread),
        z: round(room.z + (unit(building, "anchor-z", i * 3 + j) - 0.5) * Math.min(1.2, room.depthM * 0.35)),
      });
    }
  }
  for (const connection of doors) {
    if (connection.kind !== "stair") continue;
    const from = rooms.find((room) => room.code === connection.from),
      to = rooms.find((room) => room.code === connection.to);
    if (from)
      anchors.push({ code: `${connection.code}/FROM`, room: from.code, kind: "stairs", x: from.x, z: from.z });
    if (to)
      anchors.push({ code: `${connection.code}/TO`, room: to.code, kind: "stairs", x: to.x, z: to.z });
  }

  const style = styleFor(building),
    topology = {
      building: building.code,
      role: building.role,
      floors,
      footprint: [round(building.width), round(building.depth)],
      style,
      rooms: rooms.map((room) => [room.code, room.name, room.areaM2, room.floor, room.x, room.z, room.widthM, room.depthM]),
      doors: doors.map((door) => [door.code, door.kind, door.from, door.to, door.widthM]),
      anchors: anchors.map((anchor) => [anchor.code, anchor.room, anchor.kind, anchor.x, anchor.z]),
    },
    serialized = JSON.stringify(topology),
    signature = digest(serialized).toString(16).padStart(8, "0"),
    estimatedBytes = serialized.length * 2 + rooms.length * 96 + doors.length * 72 + anchors.length * 72;

  return {
    code: `${building.code}/INTERIOR/${BUILDING_INTERIOR_VERSION}`,
    building: building.code,
    role: building.role,
    floors,
    footprint: { widthM: building.width, depthM: building.depth },
    exteriorEntrance: { ...building.entrance },
    style,
    rooms,
    doors,
    anchors,
    signature,
    estimatedBytes,
  };
}

export type InteriorResidencyStats = {
  active: number;
  cached: number;
  bytes: number;
  materializations: number;
  evictions: number;
};

type ResidentPlan = { plan: InteriorPlan; active: boolean; used: number };

/** Small protagonist-facing LRU. No settlement-load or camera-focus method exists by design. */
export class ProtagonistInteriorCache {
  private readonly entries = new Map<string, ResidentPlan>();
  private serial = 0;
  private materializations = 0;
  private evictions = 0;

  constructor(private readonly maxCached = 3) {
    if (!Number.isInteger(maxCached) || maxCached < 1) throw new RangeError("maxCached must be a positive integer");
  }

  enter(building: Building): InteriorPlan {
    let entry = this.entries.get(building.code);
    if (!entry) {
      entry = { plan: interiorPlanFor(building), active: true, used: ++this.serial };
      this.entries.set(building.code, entry);
      this.materializations++;
    } else {
      entry.active = true;
      entry.used = ++this.serial;
    }
    this.trim();
    return entry.plan;
  }

  exit(buildingCode: string) {
    const entry = this.entries.get(buildingCode);
    if (entry) entry.active = false;
  }

  evict(buildingCode: string): boolean {
    const entry = this.entries.get(buildingCode);
    if (!entry || entry.active) return false;
    this.entries.delete(buildingCode);
    this.evictions++;
    return true;
  }

  evictInactive() {
    for (const [code, entry] of [...this.entries])
      if (!entry.active) {
        this.entries.delete(code);
        this.evictions++;
      }
  }

  has(buildingCode: string) {
    return this.entries.has(buildingCode);
  }

  stats(): InteriorResidencyStats {
    let activeCount = 0,
      bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.active) activeCount++;
      bytes += entry.plan.estimatedBytes;
    }
    return { active: activeCount, cached: this.entries.size, bytes, materializations: this.materializations, evictions: this.evictions };
  }

  private trim() {
    while (this.entries.size > this.maxCached) {
      let victim: [string, ResidentPlan] | undefined;
      for (const item of this.entries)
        if (!item[1].active && (!victim || item[1].used < victim[1].used)) victim = item;
      if (!victim) return;
      this.entries.delete(victim[0]);
      this.evictions++;
    }
  }
}
