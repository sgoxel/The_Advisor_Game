export * from "./geometry-core.ts";

import { buildTile as coreBuildTile, type Geometry, type TileGeometry } from "./geometry-core.ts";
import { featuresFor, type Tile } from "./world.ts";
import { elevationToRenderY } from "./render-frame.ts";

type Point = [number, number, number];
type RGB = readonly [number, number, number];
const color = (r: number, g: number, b: number): RGB => [r, g, b];

class Builder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const u = b.map((value, index) => value - a[index]),
      v = c.map((value, index) => value - a[index]),
      normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      length = Math.hypot(...normal) || 1,
      start = this.p.length / 3;
    for (const point of [a, b, c]) {
      this.p.push(...point);
      this.n.push(...normal.map((value) => value / length));
      this.c.push(...tint, 255);
    }
    this.i.push(start, start + 1, start + 2);
  }
  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }
  boxYaw(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, tint: RGB) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw), top = y + h,
      at = (lx: number, lz: number, yy: number): Point => [x + lx * cos + lz * sin, yy, z - lx * sin + lz * cos],
      a = at(-w / 2, -d / 2, y), b = at(w / 2, -d / 2, y), c = at(w / 2, d / 2, y), d0 = at(-w / 2, d / 2, y),
      A = at(-w / 2, -d / 2, top), B = at(w / 2, -d / 2, top), C = at(w / 2, d / 2, top), D = at(-w / 2, d / 2, top);
    this.quad(a, A, B, b, tint);
    this.quad(b, B, C, c, tint);
    this.quad(c, C, D, d0, tint);
    this.quad(d0, D, A, a, tint);
    this.quad(A, D, C, B, tint);
  }
  cone(x: number, y: number, z: number, radius: number, h: number, tint: RGB, sides = 6) {
    for (let index = 0; index < sides; index++) {
      const a = index * Math.PI * 2 / sides, b = (index + 1) * Math.PI * 2 / sides;
      this.triangle(
        [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius],
        [x, y + h, z],
        [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius],
        tint,
      );
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

function mergeGeometry(a: Geometry, b: Geometry): Geometry {
  if (!b.positions.length) return a;
  const positions = new Float32Array(a.positions.length + b.positions.length),
    normals = new Float32Array(a.normals.length + b.normals.length),
    colors = new Uint8Array(a.colors.length + b.colors.length),
    indices = new Uint32Array(a.indices.length + b.indices.length),
    offset = a.positions.length / 3;
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  normals.set(a.normals);
  normals.set(b.normals, a.normals.length);
  colors.set(a.colors);
  colors.set(b.colors, a.colors.length);
  indices.set(a.indices);
  for (let index = 0; index < b.indices.length; index++) indices[a.indices.length + index] = b.indices[index] + offset;
  return { ...a, positions, normals, colors, indices };
}

/** S004 detail overlay. World identity stays deterministic; this layer only visualizes semantic exterior features. */
export function buildTile(tile: Tile): TileGeometry {
  const result = coreBuildTile(tile), structures = new Builder(), nature = new Builder(), detail = new Builder();

  if (tile.size <= 512) for (const feature of featuresFor(tile) as any[]) {
    const x = feature.x,
      z = feature.z,
      y = elevationToRenderY(feature.y),
      yaw = feature.yawRad || 0,
      width = Math.max(.2, feature.footprintWidth || 8),
      depth = Math.max(.2, feature.footprintDepth || 8),
      length = Math.max(.2, feature.length || depth),
      variant = feature.variant || 0;

    if (feature.kind === "street") {
      structures.boxYaw(x, y + .01, z, width, .07, length, yaw, color(119, 99, 70));
    } else if (feature.kind === "border") {
      const stoneWall = variant > 0;
      structures.boxYaw(x, y, z, width, stoneWall ? 2.45 : 1.35, length, yaw, stoneWall ? color(135, 135, 123) : color(104, 81, 53));
      if (!stoneWall && tile.size <= 64) detail.boxYaw(x, y + 1.05, z, width + .08, .16, length, yaw, color(78, 60, 42));
    } else if (feature.kind === "gate") {
      const gateWidth = Math.max(7.5, width), postH = variant % 2 ? 5.8 : 4.8, cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (const side of [-1, 1]) {
        const gx = x + cos * gateWidth * .46 * side, gz = z - sin * gateWidth * .46 * side;
        structures.boxYaw(gx, y, gz, 2.1, postH, 2.1, yaw, color(139, 136, 120));
      }
      detail.boxYaw(x, y + postH - .35, z, gateWidth, .9, 1.25, yaw, color(82, 61, 42));
    } else if (feature.kind === "guard-post") {
      structures.boxYaw(x, y, z, width, 4.2, depth, yaw, color(151, 145, 124));
      structures.cone(x, y + 4.2, z, Math.max(width, depth) * .72, 2.2, color(80, 72, 63), 4);
    } else if (feature.kind === "service") {
      const service = feature.service || "market",
        h = 4.6 + ((variant >>> 2) % 3) * .65,
        wall = service === "blacksmith" ? color(126, 118, 103) : service === "guard-office" ? color(158, 157, 145) : color(194, 177, 139),
        roof = service === "guard-office" ? color(78, 85, 87) : color(119, 72, 49);
      structures.boxYaw(x, y - .15, z, width, h + .15, depth, yaw, wall);
      structures.cone(x, y + h, z, Math.max(width, depth) * .69, 2.7, roof, 4);
      const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
      if (service === "blacksmith") {
        const chimney = at(width * .34, -depth * .18);
        detail.boxYaw(chimney.x, y + 2.2, chimney.z, 1.15, 3.5, 1.15, yaw, color(78, 74, 68));
      } else if (service === "market") {
        const awning = at(0, depth / 2 + 1.15);
        detail.boxYaw(awning.x, y + 2.7, awning.z, width * .76, .18, 2.15, yaw, color(166, 114, 62));
      } else if (service === "merchant") {
        const awning = at(0, depth / 2 + 1.25), crateA = at(-width * .3, depth / 2 + 2), crateB = at(width * .26, depth / 2 + 2.25);
        detail.boxYaw(awning.x, y + 3.05, awning.z, width * .82, .18, 2.35, yaw, color(170, 118, 66));
        detail.boxYaw(crateA.x, y + .04, crateA.z, 1.5, 1, 1.4, yaw, color(115, 83, 49));
        detail.boxYaw(crateB.x, y + .04, crateB.z, 1.25, .85, 1.2, yaw, color(129, 93, 52));
      } else if (service === "headman") {
        const wing = at(width * .42, -depth * .08), porch = at(0, depth / 2 + 1.05);
        structures.boxYaw(wing.x, y, wing.z, width * .45, 5.1, depth * .68, yaw, color(167, 165, 144));
        detail.boxYaw(porch.x, y + .04, porch.z, width * .5, .18, 2.15, yaw, color(151, 132, 95));
        for (const lx of [-width * .2, width * .2]) {
          const post = at(lx, depth / 2 + 1.4);
          detail.boxYaw(post.x, y, post.z, .24, 3.1, .24, yaw, color(75, 58, 43));
        }
      }
    } else if (feature.kind === "garden") {
      structures.boxYaw(x, y + .02, z, width, .08, depth, yaw, color(117, 132, 71));
      if (tile.size <= 64) {
        const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
        for (const lx of [-width * .28, 0, width * .28]) {
          const row = at(lx, 0);
          detail.boxYaw(row.x, y + .12, row.z, .42, .3, depth * .72, yaw, color(151, 126, 62));
        }
      }
    } else if (feature.kind === "path") {
      structures.boxYaw(x, y + .015, z, width || 1.25, .06, length, yaw, color(137, 116, 79));
    } else if (feature.kind === "pavement") {
      structures.boxYaw(x, y + .018, z, width || 1.5, .075, length, yaw, color(154, 141, 111));
    } else if (feature.kind === "roadside-tree") {
      const h = 6.2 + (variant % 5) * .65, radius = 2 + ((variant >>> 3) % 6) * .18;
      nature.boxYaw(x, y - .1, z, .62, h * .58, .62, 0, color(82, 62, 42));
      nature.cone(x, y + h * .3, z, radius, h * .52, color(72 + (variant % 14), 111 + (variant % 17), 63), 7);
      if (tile.size <= 32) nature.cone(x + radius * .28, y + h * .46, z - radius * .08, radius * .65, h * .3, color(84, 126, 69), 6);
    }
  }

  return {
    terrain: result.terrain,
    structures: mergeGeometry(result.structures, structures.finish()),
    nature: mergeGeometry(result.nature, nature.finish()),
    detail: mergeGeometry(result.detail, detail.finish()),
  };
}
