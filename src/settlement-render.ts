import type { Geometry } from "./geometry.ts";
import { roads } from "./geography.ts";
import { featuresFor, heightAt, type Feature, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];

const timber: RGB = [91, 67, 45];
const stone: RGB = [139, 137, 124];
const roadTint: RGB = [151, 128, 91];
const roofDark: RGB = [91, 66, 58];
const plaster: RGB = [185, 170, 139];
const marketCloth: RGB = [154, 89, 64];
const forgeDark: RGB = [83, 82, 77];
// WP19_ATTEMPT2_SERVICE_SILHOUETTES: small reusable palette for functional attachments.
const straw: RGB = [174, 139, 76];
const brick: RGB = [126, 72, 58];
const awningGreen: RGB = [87, 112, 79];
const slate: RGB = [77, 88, 96];

class Builder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly i: number[] = [];

  private triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2],
      nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      length = Math.hypot(nx, ny, nz) || 1,
      start = this.p.length / 3;
    for (const point of [a, b, c]) {
      this.p.push(...point);
      this.n.push(nx / length, ny / length, nz / length);
      this.c.push(...tint, 255);
    }
    this.i.push(start, start + 1, start + 2);
  }

  private quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }

  private point(
    x: number,
    y: number,
    z: number,
    lx: number,
    ly: number,
    lz: number,
    angle: number,
  ): Point {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return [x + c * lx + s * lz, y + ly, z - s * lx + c * lz];
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, angle: number, tint: RGB) {
    const hw = w / 2,
      hd = d / 2,
      p000 = this.point(x, y, z, -hw, 0, -hd, angle),
      p100 = this.point(x, y, z, hw, 0, -hd, angle),
      p110 = this.point(x, y, z, hw, 0, hd, angle),
      p010 = this.point(x, y, z, -hw, 0, hd, angle),
      p001 = this.point(x, y, z, -hw, h, -hd, angle),
      p101 = this.point(x, y, z, hw, h, -hd, angle),
      p111 = this.point(x, y, z, hw, h, hd, angle),
      p011 = this.point(x, y, z, -hw, h, hd, angle);
    this.quad(p000, p001, p101, p100, tint);
    this.quad(p100, p101, p111, p110, tint);
    this.quad(p110, p111, p011, p010, tint);
    this.quad(p010, p011, p001, p000, tint);
    this.quad(p001, p011, p111, p101, tint);
  }

  roof(x: number, y: number, z: number, w: number, d: number, h: number, angle: number, tint: RGB) {
    const hw = w / 2,
      hd = d / 2,
      a = this.point(x, y, z, -hw, 0, -hd, angle),
      b = this.point(x, y, z, hw, 0, -hd, angle),
      c = this.point(x, y, z, hw, 0, hd, angle),
      d0 = this.point(x, y, z, -hw, 0, hd, angle),
      r0 = this.point(x, y, z, 0, h, -hd, angle),
      r1 = this.point(x, y, z, 0, h, hd, angle);
    this.quad(a, r0, r1, d0, tint);
    this.quad(c, r1, r0, b, tint);
    this.triangle(a, b, r0, tint);
    this.triangle(c, d0, r1, tint);
  }

  finish(): Geometry {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Uint8Array(this.c),
      indices: new Uint32Array(this.i),
    };
  }
}

function localFeature(tile: Tile, feature: Feature) {
  return {
    x: feature.x - (tile.minX + tile.size / 2),
    z: feature.z - (tile.minZ + tile.size / 2),
    y: feature.y,
  };
}

function roleWall(role: string | undefined, variant: number): RGB {
  const lift = (variant % 15) - 7;
  const vary = (base: RGB): RGB => [
    Math.max(0, Math.min(255, base[0] + lift)),
    Math.max(0, Math.min(255, base[1] + lift)),
    Math.max(0, Math.min(255, base[2] + lift)),
  ];
  if (role === "guard-office" || role === "keep") return vary([151, 149, 135]);
  if (role === "blacksmith" || role === "barn") return vary([139, 123, 94]);
  if (role === "market") return vary([190, 164, 118]);
  if (role === "butcher") return vary([181, 151, 125]);
  if (role === "inn") return vary([192, 174, 143]);
  if (role === "farmstead") return vary([173, 154, 116]);
  return vary(plaster);
}

function buildingHeight(feature: Feature) {
  const floors = Math.max(1, feature.floors ?? 1);
  if (feature.role === "barn") return 4.8;
  if (feature.role === "market") return 3.4;
  if (feature.role === "guard-office") return 4.2;
  if (feature.role === "keep") return 10;
  return 2.9 * floors;
}

function renderBuilding(tile: Tile, feature: Feature, structures: Builder, detail: Builder) {
  const { x, y, z } = localFeature(tile, feature),
    angle = feature.angle ?? 0,
    width = Math.max(4, feature.width ?? (feature.kind === "keep" ? 18 : 8)),
    depth = Math.max(4, feature.depth ?? (feature.kind === "keep" ? 16 : 7)),
    height = buildingHeight(feature),
    wall = roleWall(feature.role, feature.variant),
    roof = feature.role === "blacksmith" ? forgeDark : feature.role === "guard-office" ? [83, 88, 85] as RGB : roofDark;

  structures.box(x, y - 0.25, z, width, height + 0.25, depth, angle, wall);
  structures.roof(x, y + height, z, width + 0.8, depth + 0.7, Math.min(3.4, 1.6 + width * 0.11), angle, roof);

  // Exterior entrance: local +z. It is the same orientation as the canonical layout entrance.
  const c = Math.cos(angle),
    s = Math.sin(angle),
    doorX = x + s * (depth / 2 + 0.04),
    doorZ = z + c * (depth / 2 + 0.04);
  detail.box(doorX, y, doorZ, 1.25, 2.15, 0.12, angle, timber);

  if (feature.role === "inn") {
    // Guest wing + hanging roadside sign make the inn structurally distinct from a home.
    const wingX = x + c * (width * 0.42),
      wingZ = z - s * (width * 0.42);
    structures.box(wingX, y - 0.2, wingZ, width * 0.45, Math.max(3.2, height * 0.75), depth * 0.72, angle, wall);
    detail.box(doorX + c * 1.65, y + 2.1, doorZ - s * 1.65, 0.18, 2.4, 0.18, angle, timber);
    detail.box(doorX + c * 2.25, y + 3.55, doorZ - s * 2.25, 1.25, 0.85, 0.12, angle, [126, 91, 52]);
  } else if (feature.role === "market") {
    // WP19_ATTEMPT2_MARKET_COURT: an open two-row trading court, not a house with a label.
    const canopyX = x + s * (depth / 2 + 2.8),
      canopyZ = z + c * (depth / 2 + 2.8),
      span = Math.min(10.5, width * 0.95);
    structures.box(canopyX, y + 2.75, canopyZ, span, 0.22, 3.8, angle, marketCloth);
    structures.box(canopyX + s * 3.7, y + 2.45, canopyZ + c * 3.7, span * 0.72, 0.2, 2.8, angle, awningGreen);
    for (const row of [0, 1])
      for (const side of [-1, 0, 1]) {
        const forward = row === 0 ? 0 : 3.7,
          px = canopyX + s * forward + c * side * span * 0.3,
          pz = canopyZ + c * forward - s * side * span * 0.3;
        detail.box(px, y + 0.65, pz, Math.min(2.6, span * 0.27), 1.05, 0.9, angle, row ? straw : timber);
        detail.box(px, y, pz, 0.14, 2.7, 0.14, angle, timber);
      }
    detail.box(canopyX - c * span * 0.44, y + 0.35, canopyZ + s * span * 0.44, 1.15, 0.75, 1.15, angle, [112, 82, 49]);
  } else if (feature.role === "blacksmith") {
    // Side forge shed and tall chimney communicate actual workshop use.
    const shedX = x - c * (width / 2 + 2),
      shedZ = z + s * (width / 2 + 2);
    // WP19_ATTEMPT2_SMITHY_YARD: taller brick stack, open forge pad and wood/coal bins.
    structures.box(shedX, y - 0.1, shedZ, 4.4, 3.1, depth * 0.8, angle, [126, 112, 88]);
    detail.box(shedX - c * 1.15, y + 2.4, shedZ + s * 1.15, 1.15, 5.8, 1.15, angle, brick);
    detail.box(shedX + c * 1.0, y + 0.75, shedZ - s * 1.0, 1.8, 0.85, 1.35, angle, forgeDark);
    detail.box(shedX + s * 3.1, y + 0.12, shedZ + c * 3.1, 5.8, 0.2, 4.3, angle, [92, 83, 69]);
    for (const side of [-1, 1])
      detail.box(shedX + c * side * 2.2 + s * 3.1, y + 0.45, shedZ - s * side * 2.2 + c * 3.1, 0.16, 1.15, 4.1, angle, timber);
  } else if (feature.role === "farmstead") {
    // L-shaped work wing and open yard edge distinguish a farm from ordinary housing.
    const wingX = x + c * (width / 2 + 2.2),
      wingZ = z - s * (width / 2 + 2.2);
    structures.box(wingX, y - 0.15, wingZ, 4.3, 3.1, Math.max(5, depth * 0.75), angle, [161, 143, 106]);
    const yardX = x + s * (depth / 2 + 4.2),
      yardZ = z + c * (depth / 2 + 4.2);
    for (const side of [-1, 1]) {
      const fx = yardX + c * side * Math.min(5.5, width * 0.48),
        fz = yardZ - s * side * Math.min(5.5, width * 0.48);
      detail.box(fx, y + 0.45, fz, 0.14, 1.1, 7.5, angle, timber);
    }
  } else if (feature.role === "barn") {
    // Tall central doors and steeper roof read as agricultural storage rather than a house.
    structures.roof(x, y + height, z, width + 1, depth + 0.8, 3.2, angle, [112, 72, 48]);
    detail.box(doorX, y, doorZ, Math.min(3.6, width * 0.38), 3.4, 0.15, angle, [99, 67, 43]);
  } else if (feature.role === "butcher") {
    const awningX = x + s * (depth / 2 + 1.25),
      awningZ = z + c * (depth / 2 + 1.25);
    detail.box(awningX, y + 2.55, awningZ, Math.min(5.5, width * 0.65), 0.16, 2.1, angle, [133, 72, 62]);
    detail.box(awningX, y + 0.75, awningZ, Math.min(4.8, width * 0.58), 1.1, 0.8, angle, [121, 87, 57]);
  } else if (feature.role === "guard-office") {
    // Stone duty bay and corner lookout distinguish the gate service.
    const bayX = x - c * (width / 2 + 1.3),
      bayZ = z + s * (width / 2 + 1.3);
    structures.box(bayX, y - 0.2, bayZ, 2.7, 5.5, 3.2, angle, stone);
    detail.box(bayX, y + 5.3, bayZ, 3.1, 0.35, 3.6, angle, [110, 111, 105]);
  } else if (feature.role === "keep" || feature.kind === "keep") {
    // Four corner towers surround the canonical keep footprint.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const lx = sx * (width / 2 + 1.4),
          lz = sz * (depth / 2 + 1.4),
          tx = x + Math.cos(angle) * lx + Math.sin(angle) * lz,
          tz = z - Math.sin(angle) * lx + Math.cos(angle) * lz;
        structures.box(tx, y - 0.25, tz, 4.2, height + 3, 4.2, angle, [148, 148, 136]);
      }
  } else {
    // WP19_ATTEMPT2_HOME_VARIANTS: ordinary homes retain their canonical footprint but gain
    // seeded porch/chimney/lean-to silhouettes so a street no longer reads as cloned boxes.
    const porchX = x + s * (depth / 2 + 0.8),
      porchZ = z + c * (depth / 2 + 0.8),
      variant = Math.abs(feature.variant) % 4;
    detail.box(porchX, y + 0.12, porchZ, Math.min(2.6, width * 0.35), 0.22, 1.5, angle, [116, 91, 62]);
    if (variant !== 0) {
      const chimneyX = x + c * width * (variant === 1 ? -0.28 : 0.28),
        chimneyZ = z - s * width * (variant === 1 ? -0.28 : 0.28);
      detail.box(chimneyX, y + height * 0.72, chimneyZ, 0.75, 2.8, 0.75, angle, variant === 3 ? brick : stone);
    }
    if (variant >= 2 && width > 6.5) {
      const leanX = x - c * (width / 2 + 1.15),
        leanZ = z + s * (width / 2 + 1.15);
      structures.box(leanX, y - 0.1, leanZ, 2.3, 2.15, Math.max(3.4, depth * 0.55), angle, variant === 2 ? timber : wall);
      structures.roof(leanX, y + 2.05, leanZ, 2.7, Math.max(3.8, depth * 0.6), 0.9, angle, variant === 2 ? straw : slate);
    }
  }
}

function renderLinearFeature(tile: Tile, feature: Feature, structures: Builder, detail: Builder) {
  const { x, y, z } = localFeature(tile, feature),
    angle = feature.angle ?? 0;
  if (feature.kind === "street") {
    structures.box(x, y + 0.03, z, Math.max(2.5, feature.width ?? 4), 0.12, Math.max(1, feature.length ?? 8), angle, roadTint);
  } else if (feature.kind === "wall") {
    structures.box(x, y - 0.08, z, 0.72, 2.75, Math.max(1, feature.length ?? 8), angle, [132, 132, 121]);
    if (tile.size <= 64) detail.box(x, y + 2.62, z, 0.9, 0.26, Math.max(1, feature.length ?? 8), angle, [112, 113, 105]);
  } else if (feature.kind === "gate") {
    const opening = Math.max(4, feature.width ?? 6),
      c = Math.cos(angle),
      s = Math.sin(angle);
    for (const side of [-1, 1]) {
      const offset = side * (opening / 2 + 1.05),
        px = x + c * offset,
        pz = z - s * offset;
      structures.box(px, y - 0.1, pz, 1.8, 4.2, 2.2, angle, [138, 137, 126]);
    }
    detail.box(x, y + 3.75, z, opening + 3.8, 0.55, 1.15, angle, timber);
  } else if (feature.kind === "guard-post") {
    structures.box(x, y - 0.1, z, 2.8, 2.8, 2.8, angle, [145, 140, 120]);
    structures.roof(x, y + 2.7, z, 3.4, 3.4, 1.15, angle, roofDark);
  } else if (feature.kind === "well") {
    structures.box(x, y, z, 2.5, 0.9, 2.5, angle, stone);
    detail.box(x, y + 1.9, z, 0.15, 2.2, 0.15, angle, timber);
  }
}

function renderBridges(tile: Tile, structures: Builder, detail: Builder) {
  if (tile.size > 512) return;
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  for (const road of roads) {
    const dx = road.toX - road.fromX,
      dz = road.toZ - road.fromZ,
      length = Math.hypot(dx, dz);
    if (!(length > 0)) continue;
    const ux = dx / length,
      uz = dz / length,
      angle = Math.atan2(ux, uz),
      steps = Math.ceil(length / 2);
    for (let index = 0; index < steps; index++) {
      const distance = Math.min(length, (index + 0.5) * 2),
        wx = road.fromX + ux * distance,
        wz = road.fromZ + uz * distance;
      if (wx < tile.minX || wx >= tile.minX + tile.size || wz < tile.minZ || wz >= tile.minZ + tile.size) continue;
      if (heightAt(wx, wz) >= 2.9) continue;
      const x = wx - originX,
        z = wz - originZ;
      structures.box(x, 2.82, z, 9.5, 0.22, 2.25, angle, [116, 88, 57]);
      if (tile.size <= 64)
        for (const side of [-1, 1]) {
          const lateral = side * 4.3,
            px = x + Math.cos(angle) * lateral,
            pz = z - Math.sin(angle) * lateral;
          detail.box(px, 3.55, pz, 0.16, 1.25, 2.25, angle, [80, 62, 43]);
        }
    }
  }
}

/**
 * Dedicated local settlement presentation. Canonical identities and footprints come from
 * settlement-layout/world; this module only turns those records into reusable low-poly geometry.
 * Returning null for coarse tiles is deliberate: Realm/Province views retain logical place metadata
 * without allocating all building, wall or street meshes.
 */
export function buildSettlementGeometry(tile: Tile): { structures: Geometry; detail: Geometry } | null {
  if (tile.size > 512) return null;
  const features = featuresFor(tile),
    structures = new Builder(),
    detail = new Builder();
  for (const feature of features) {
    if (feature.kind === "house" || feature.kind === "keep") renderBuilding(tile, feature, structures, detail);
    else if (["street", "wall", "gate", "guard-post", "well"].includes(feature.kind))
      renderLinearFeature(tile, feature, structures, detail);
  }
  renderBridges(tile, structures, detail);
  return { structures: structures.finish(), detail: detail.finish() };
}
