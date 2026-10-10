import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  settlementBuilding,
  type BuildingUse,
  type SettlementBuilding,
} from "./settlements.ts";

export type InteriorRoom = {
  code: string;
  use: string;
  x: number;
  z: number;
  widthM: number;
  depthM: number;
  doorX: number;
  doorZ: number;
};

export type InteriorAnchor = {
  code: string;
  use: string;
  x: number;
  z: number;
};

export type InteriorLayout = {
  code: string;
  buildingCode: string;
  buildingUse: BuildingUse;
  widthM: number;
  depthM: number;
  entry: { x: number; z: number; headingRad: number };
  rooms: readonly InteriorRoom[];
  anchors: readonly InteriorAnchor[];
  walkableLinks: readonly { from: string; to: string }[];
  signature: string;
};

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/INTERIOR/${address}`) / 4294967296;
}
function requiredRooms(building: SettlementBuilding) {
  return building.rooms.length ? [...building.rooms] : ["usable room"];
}
function anchorUse(roomUse: string, buildingUse: BuildingUse) {
  const lower = roomUse.toLowerCase();
  if (lower.includes("bed")) return "bed";
  if (lower.includes("latrine") || lower.includes("sanitation")) return "sanitation";
  if (lower.includes("forge")) return "forge";
  if (lower.includes("stall") || lower.includes("selling")) return "trade-counter";
  if (lower.includes("guest")) return "guest-bed";
  if (lower.includes("storage")) return "storage";
  if (lower.includes("duty")) return "duty-desk";
  if (lower.includes("work")) return buildingUse === "butcher" ? "butcher-bench" : "work-bench";
  if (lower.includes("common") || lower.includes("living")) return "hearth-table";
  if (lower.includes("farm")) return "farm-table";
  return "fixture";
}

/**
 * Pure canonical base layout. It is intentionally regenerated from the building
 * identity instead of reading a render/interior cache. Rectangular subdivision is
 * local to one building, while room order, split direction and fixtures are all
 * SEED-addressed and constrained by the building's functional program.
 */
export function generateInterior(building: SettlementBuilding): InteriorLayout {
  const uses = requiredRooms(building),
    inset = 0.7,
    widthM = Math.max(4, building.widthM - inset * 2),
    depthM = Math.max(4, building.depthM - inset * 2),
    columns = uses.length <= 3 ? 2 : uses.length <= 5 ? 3 : 4,
    rows = Math.ceil(uses.length / columns),
    cellWidth = widthM / columns,
    cellDepth = depthM / rows,
    rooms: InteriorRoom[] = [],
    anchors: InteriorAnchor[] = [];

  for (let index = 0; index < uses.length; index++) {
    const sourceColumn = index % columns,
      sourceRow = Math.floor(index / columns),
      mirror = addressed(`${building.code}/MIRROR`) > 0.5,
      column = mirror ? columns - 1 - sourceColumn : sourceColumn,
      row = addressed(`${building.code}/ROWFLIP`) > 0.5 ? rows - 1 - sourceRow : sourceRow,
      jitterX = (addressed(`${building.code}/ROOM/${index}/X`) - 0.5) * Math.min(0.5, cellWidth * 0.12),
      jitterZ = (addressed(`${building.code}/ROOM/${index}/Z`) - 0.5) * Math.min(0.5, cellDepth * 0.12),
      x = -widthM / 2 + cellWidth * (column + 0.5) + jitterX,
      z = -depthM / 2 + cellDepth * (row + 0.5) + jitterZ,
      roomWidth = Math.max(2.2, cellWidth - 0.6),
      roomDepth = Math.max(2.2, cellDepth - 0.6),
      doorX = clamp(x + (column === 0 ? roomWidth * 0.34 : -roomWidth * 0.34), -widthM / 2 + 0.8, widthM / 2 - 0.8),
      doorZ = clamp(z + (row === 0 ? roomDepth * 0.34 : -roomDepth * 0.34), -depthM / 2 + 0.8, depthM / 2 - 0.8),
      code = `${building.code}/INTERIOR/ROOM/${index}`;
    rooms.push({
      code,
      use: uses[index],
      x,
      z,
      widthM: roomWidth,
      depthM: roomDepth,
      doorX,
      doorZ,
    });
    anchors.push({
      code: `${code}/ANCHOR/0`,
      use: anchorUse(uses[index], building.use),
      x: x + (addressed(`${code}/AX`) - 0.5) * roomWidth * 0.42,
      z: z + (addressed(`${code}/AZ`) - 0.5) * roomDepth * 0.42,
    });
  }

  const links = rooms.slice(1).map((room, index) => ({
      from: rooms[index].code,
      to: room.code,
    })),
    entry = {
      x: 0,
      z: depthM / 2 - 0.35,
      headingRad: Math.PI,
    },
    signature = [
      building.code,
      building.use,
      widthM.toFixed(3),
      depthM.toFixed(3),
      ...rooms.map((room) => `${room.code}:${room.use}:${room.x.toFixed(3)},${room.z.toFixed(3)}:${room.widthM.toFixed(3)}x${room.depthM.toFixed(3)}:${room.doorX.toFixed(3)},${room.doorZ.toFixed(3)}`),
      ...anchors.map((anchor) => `${anchor.code}:${anchor.use}:${anchor.x.toFixed(3)},${anchor.z.toFixed(3)}`),
    ].join("|");
  return {
    code: `${building.code}/INTERIOR`,
    buildingCode: building.code,
    buildingUse: building.use,
    widthM,
    depthM,
    entry,
    rooms,
    anchors,
    walkableLinks: links,
    signature,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Bounded protagonist-demand cache. Merely querying/focusing a settlement never
 * calls enter(). Eviction discards realized geometry/data; re-entry regenerates the
 * immutable base from SEED + building identity and therefore cannot reroll it.
 */
export class InteriorRuntime {
  readonly maxRealized: number;
  private realized = new Map<string, { layout: InteriorLayout; used: number }>();
  private sequence = 0;
  activeBuildingCode: string | null = null;
  materializations = 0;
  evictions = 0;

  constructor(maxRealized = 2) {
    if (!Number.isInteger(maxRealized) || maxRealized < 1)
      throw new RangeError("Interior cache size must be a positive integer");
    this.maxRealized = maxRealized;
  }

  enter(buildingCode: string) {
    const building = settlementBuilding(buildingCode);
    if (!building) throw new RangeError(`Unknown building ${buildingCode}`);
    let record = this.realized.get(buildingCode);
    if (!record) {
      const layout = generateInterior(building);
      record = { layout, used: ++this.sequence };
      this.realized.set(buildingCode, record);
      this.materializations++;
      this.trim(buildingCode);
    } else record.used = ++this.sequence;
    this.activeBuildingCode = buildingCode;
    return record.layout;
  }

  exit() {
    this.activeBuildingCode = null;
  }

  evict(buildingCode?: string) {
    const target = buildingCode ?? this.activeBuildingCode;
    if (!target) return false;
    if (this.realized.delete(target)) {
      this.evictions++;
      if (this.activeBuildingCode === target) this.activeBuildingCode = null;
      return true;
    }
    return false;
  }

  clear() {
    const count = this.realized.size;
    this.realized.clear();
    this.activeBuildingCode = null;
    this.evictions += count;
  }

  private trim(protectedCode: string) {
    while (this.realized.size > this.maxRealized) {
      const victim = [...this.realized.entries()]
        .filter(([code]) => code !== protectedCode)
        .sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]))[0];
      if (!victim) break;
      this.realized.delete(victim[0]);
      this.evictions++;
    }
  }

  get stats() {
    return {
      activeBuildingCode: this.activeBuildingCode,
      realized: this.realized.size,
      maxRealized: this.maxRealized,
      materializations: this.materializations,
      evictions: this.evictions,
      realizedCodes: [...this.realized.keys()].sort(),
    };
  }
}
