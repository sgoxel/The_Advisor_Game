import type { Geometry } from "./geometry.ts";
import { places } from "./geography.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT } from "./planet.ts";
import {
  settlementPlan,
  settlementRenderFeaturesForBounds,
  type BuildingUse,
  type SettlementRenderFeature,
} from "./settlements.ts";
import { heightAt, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
const EMPTY = () => ({
  positions: new Float32Array(),
  normals: new Float32Array(),
  colors: new Uint8Array(),
  indices: new Uint32Array(),
});

class Builder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];

  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2],
      vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2],
      nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      length = Math.hypot(nx, ny, nz) || 1,
      start = this.p.length / 3;
    for (const point of [a, b, c]) {
      this.p.push(...point);
      this.n.push(nx / length, ny / length, nz / length);
      this.c.push(tint[0], tint[1], tint[2], 255);
    }
    this.i.push(start, start + 1, start + 2);
  }

  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }

  private transformed(
    x: number,
    y: number,
    z: number,
    localX: number,
    localY: number,
    localZ: number,
    heading: number,
  ): Point {
    const c = Math.cos(heading), s = Math.sin(heading);
    return [x + localX * c - localZ * s, y + localY, z + localX * s + localZ * c];
  }

  box(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    heading: number,
    tint: RGB,
  ) {
    const hw = width / 2, hd = depth / 2,
      a = this.transformed(x, y, z, -hw, 0, -hd, heading),
      b = this.transformed(x, y, z, hw, 0, -hd, heading),
      c = this.transformed(x, y, z, hw, 0, hd, heading),
      d = this.transformed(x, y, z, -hw, 0, hd, heading),
      at = this.transformed(x, y, z, -hw, height, -hd, heading),
      bt = this.transformed(x, y, z, hw, height, -hd, heading),
      ct = this.transformed(x, y, z, hw, height, hd, heading),
      dt = this.transformed(x, y, z, -hw, height, hd, heading);
    this.quad(a, at, bt, b, tint);
    this.quad(b, bt, ct, c, tint);
    this.quad(c, ct, dt, d, tint);
    this.quad(d, dt, at, a, tint);
    this.quad(at, dt, ct, bt, tint);
  }

  roof(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    rise: number,
    heading: number,
    tint: RGB,
  ) {
    const hw = width / 2, hd = depth / 2,
      a = this.transformed(x, y, z, -hw, 0, -hd, heading),
      b = this.transformed(x, y, z, hw, 0, -hd, heading),
      c = this.transformed(x, y, z, hw, 0, hd, heading),
      d = this.transformed(x, y, z, -hw, 0, hd, heading),
      r1 = this.transformed(x, y, z, 0, rise, -hd, heading),
      r2 = this.transformed(x, y, z, 0, rise, hd, heading);
    this.quad(a, d, r2, r1, tint);
    this.quad(r1, r2, c, b, tint);
    this.triangle(a, r1, b, tint);
    this.triangle(c, r2, d, tint);
  }

  cylinder(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    tint: RGB,
    sides = 8,
  ) {
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2,
        b = ((i + 1) / sides) * Math.PI * 2,
        p0: Point = [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius],
        p1: Point = [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius],
        p2: Point = [p1[0], y + height, p1[2]],
        p3: Point = [p0[0], y + height, p0[2]];
      this.quad(p0, p3, p2, p1, tint);
      this.triangle([x, y + height, z], p3, p2, tint);
    }
  }

  ribbon(ax: number, az: number, bx: number, bz: number, width: number, tint: RGB) {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const nx = (-dz / length) * width / 2,
      nz = (dx / length) * width / 2,
      ay = Math.max(0.08, heightAt(ax, az) + 0.12),
      by = Math.max(0.08, heightAt(bx, bz) + 0.12);
    this.quad(
      [ax + nx, ay, az + nz],
      [bx + nx, by, bz + nz],
      [bx - nx, by, bz - nz],
      [ax - nx, ay, az - nz],
      tint,
    );
  }

  relativeTo(x: number, z: number) {
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] -= x;
      this.p[i + 2] -= z;
    }
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

const WALL: RGB = [206, 188, 151];
const TIMBER: RGB = [92, 67, 46];
const ROOF: RGB = [111, 69, 54];
const STONE: RGB = [137, 140, 131];
const DARK_STONE: RGB = [102, 105, 101];
const MARKET: RGB = [183, 151, 94];
const FORGE: RGB = [88, 82, 72];
const FARM: RGB = [178, 164, 116];
const BUTCHER: RGB = [184, 139, 119];
const DOOR: RGB = [67, 48, 35];
const ROAD: RGB = [159, 140, 102];
const LANE: RGB = [146, 132, 99];
const BORDER: RGB = [112, 86, 58];
const FIELD: RGB = [151, 139, 82];
const CROP: RGB = [111, 125, 67];

function frontOffset(feature: SettlementRenderFeature, amount: number) {
  return {
    x: feature.x - Math.sin(feature.heading) * amount,
    z: feature.z + Math.cos(feature.heading) * amount,
  };
}

function renderDoor(builder: Builder, feature: SettlementRenderFeature, y: number) {
  const door = frontOffset(feature, feature.depth * 0.505),
    width = Math.max(0.22, Math.min(0.55, feature.width * 0.2)),
    depth = 0.12,
    height = Math.max(0.65, Math.min(1.4, feature.height * 0.48));
  builder.box(door.x, y + 0.02, door.z, width, height, depth, feature.heading, DOOR);
}

function renderBuilding(builder: Builder, feature: SettlementRenderFeature) {
  const role = feature.role as BuildingUse,
    y = heightAt(feature.x, feature.z),
    width = feature.width,
    depth = feature.depth,
    height = feature.height,
    heading = feature.heading,
    roofRise = Math.max(0.45, Math.min(1.8, height * 0.28));

  if (role === "well") {
    builder.cylinder(feature.x, y, feature.z, Math.max(0.35, width * 0.42), 0.55, STONE, 10);
    builder.box(feature.x, y + 0.5, feature.z, width * 0.12, 1.2, depth * 0.12, heading, TIMBER);
    return;
  }
  if (role === "guard-post") {
    builder.box(feature.x, y, feature.z, width * 0.78, height * 0.72, depth * 0.78, heading, STONE);
    builder.roof(feature.x, y + height * 0.72, feature.z, width, depth, roofRise, heading, ROOF);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "guard-office") {
    builder.box(feature.x, y, feature.z, width, height * 0.72, depth, heading, STONE);
    builder.roof(feature.x, y + height * 0.72, feature.z, width * 1.06, depth * 1.06, roofRise, heading, DARK_STONE);
    const tower = frontOffset(feature, -depth * 0.28);
    builder.box(tower.x, y, tower.z, width * 0.28, height, depth * 0.34, heading, DARK_STONE);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "inn") {
    builder.box(feature.x, y, feature.z, width, height * 0.72, depth, heading, WALL);
    builder.roof(feature.x, y + height * 0.72, feature.z, width * 1.05, depth * 1.05, roofRise, heading, ROOF);
    const porch = frontOffset(feature, depth * 0.58);
    builder.box(porch.x, y, porch.z, width * 0.44, height * 0.18, depth * 0.22, heading, TIMBER);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "market") {
    builder.box(feature.x, y, feature.z, width, height * 0.5, depth, heading, MARKET);
    builder.roof(feature.x, y + height * 0.5, feature.z, width * 1.1, depth * 1.08, roofRise * 0.8, heading, ROOF);
    for (const side of [-0.28, 0.28]) {
      const lateralX = Math.cos(heading) * width * side,
        lateralZ = Math.sin(heading) * width * side,
        stall = frontOffset(feature, depth * 0.62);
      builder.box(stall.x + lateralX, y, stall.z + lateralZ, width * 0.2, height * 0.28, depth * 0.22, heading, TIMBER);
    }
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "blacksmith") {
    builder.box(feature.x, y, feature.z, width, height * 0.58, depth, heading, FORGE);
    builder.roof(feature.x, y + height * 0.58, feature.z, width * 1.04, depth * 1.04, roofRise, heading, DARK_STONE);
    const chimneyX = feature.x + Math.cos(heading) * width * 0.26,
      chimneyZ = feature.z + Math.sin(heading) * width * 0.26;
    builder.box(chimneyX, y + height * 0.42, chimneyZ, width * 0.12, height * 0.5, width * 0.12, heading, DARK_STONE);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "farmstead") {
    builder.box(feature.x, y, feature.z, width * 0.68, height * 0.58, depth, heading, FARM);
    builder.roof(feature.x, y + height * 0.58, feature.z, width * 0.74, depth * 1.04, roofRise, heading, ROOF);
    const sideX = feature.x + Math.cos(heading) * width * 0.42,
      sideZ = feature.z + Math.sin(heading) * width * 0.42;
    builder.box(sideX, y, sideZ, width * 0.32, height * 0.42, depth * 0.66, heading, TIMBER);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "barn") {
    builder.box(feature.x, y, feature.z, width, height * 0.62, depth, heading, TIMBER);
    builder.roof(feature.x, y + height * 0.62, feature.z, width * 1.1, depth * 1.08, roofRise * 1.15, heading, ROOF);
    renderDoor(builder, feature, y);
    return;
  }
  if (role === "butcher") {
    builder.box(feature.x, y, feature.z, width, height * 0.62, depth, heading, BUTCHER);
    builder.roof(feature.x, y + height * 0.62, feature.z, width * 1.04, depth * 1.04, roofRise, heading, ROOF);
    const awning = frontOffset(feature, depth * 0.58);
    builder.box(awning.x, y + height * 0.42, awning.z, width * 0.7, 0.12, depth * 0.18, heading, [142, 74, 67]);
    renderDoor(builder, feature, y);
    return;
  }

  // Homes vary in wall/roof proportion but retain one compact readable silhouette.
  const wall: RGB = feature.variant % 3 === 0 ? WALL : feature.variant % 3 === 1 ? [196, 178, 139] : [185, 168, 130];
  builder.box(feature.x, y, feature.z, width, height * 0.62, depth, heading, wall);
  builder.roof(feature.x, y + height * 0.62, feature.z, width * 1.08, depth * 1.08, roofRise, heading, feature.variant % 2 ? ROOF : TIMBER);
  renderDoor(builder, feature, y);
}

function renderField(builder: Builder, feature: SettlementRenderFeature) {
  const y = Math.max(0.08, heightAt(feature.x, feature.z) + 0.05),
    width = feature.width,
    depth = feature.depth;
  builder.box(feature.x, y, feature.z, width, 0.08, depth, feature.heading, FIELD);
  const rows = Math.max(3, Math.min(9, Math.floor(width / 1.2)));
  for (let i = 0; i < rows; i++) {
    const across = ((i + 0.5) / rows - 0.5) * width * 0.86,
      x = feature.x + Math.cos(feature.heading) * across,
      z = feature.z + Math.sin(feature.heading) * across;
    builder.box(x, y + 0.08, z, width / rows * 0.18, 0.12, depth * 0.86, feature.heading, CROP);
  }
}

function tileContains(tile: Tile, x: number, z: number, margin = 0) {
  return (
    x >= tile.minX - margin &&
    x <= tile.minX + tile.size + margin &&
    z >= tile.minZ - margin &&
    z <= tile.minZ + tile.size + margin
  );
}

function renderTopology(builder: Builder, tile: Tile) {
  if (tile.size > 256) return;
  for (const place of places) {
    if (!tileContains(tile, place.x, place.z, 80)) continue;
    const plan = settlementPlan(place.id);
    for (const street of plan.streets) {
      const width = Math.max(0.34, street.widthM / CANONICAL_METRES_PER_SOURCE_UNIT);
      for (let i = 1; i < street.sourcePoints.length; i++) {
        const a = street.sourcePoints[i - 1], b = street.sourcePoints[i];
        if (!tileContains(tile, (a.x + b.x) / 2, (a.z + b.z) / 2, width + 3)) continue;
        builder.ribbon(a.x, a.z, b.x, b.z, width, street.kind === "lane" ? LANE : ROAD);
      }
    }

    // Low palisade/fence communicates settlement boundary while preserving gate gaps.
    for (let i = 1; i < plan.borderSource.length; i++) {
      const a = plan.borderSource[i - 1], b = plan.borderSource[i],
        mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!tileContains(tile, mx, mz, 3)) continue;
      const nearGate = plan.gates.some((gate) => Math.hypot(gate.x - mx, gate.z - mz) < 2.2);
      if (nearGate) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z),
        angle = Math.atan2(b.z - a.z, b.x - a.x),
        y = Math.max(0.08, heightAt(mx, mz));
      builder.box(mx, y, mz, length, 0.7, 0.18, angle, BORDER);
    }
    for (const gate of plan.gates) {
      if (!tileContains(tile, gate.x, gate.z, 4)) continue;
      const half = Math.max(0.5, (gate.widthM / CANONICAL_METRES_PER_SOURCE_UNIT) * 0.65),
        tangent = gate.headingRad + Math.PI / 2,
        px = Math.cos(tangent) * half,
        pz = Math.sin(tangent) * half,
        y = Math.max(0.08, heightAt(gate.x, gate.z));
      builder.box(gate.x + px, y, gate.z + pz, 0.32, 1.8, 0.32, gate.headingRad, BORDER);
      builder.box(gate.x - px, y, gate.z - pz, 0.32, 1.8, 0.32, gate.headingRad, BORDER);
    }
  }
}

export function buildSettlementGeometry(tile: Tile): {
  structures: Geometry;
  detail: Geometry;
} {
  if (tile.size > 512) return { structures: EMPTY(), detail: EMPTY() };
  const structures = new Builder(), detail = new Builder();
  for (const feature of settlementRenderFeaturesForBounds(tile.minX, tile.minZ, tile.size)) {
    if (feature.role === "field") renderField(detail, feature);
    else renderBuilding(structures, feature);
  }
  renderTopology(detail, tile);
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  structures.relativeTo(originX, originZ);
  detail.relativeTo(originX, originZ);
  return { structures: structures.finish(), detail: detail.finish() };
}
