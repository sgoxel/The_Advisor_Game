import type { Geometry } from "./geometry.ts";
import { featuresFor, type Feature, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];

const soil: RGB = [142, 119, 67],
  crop: RGB = [181, 154, 78],
  timber: RGB = [93, 70, 46];

class Builder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly i: number[] = [];

  private triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2],
      vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2],
      nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx,
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

  private point(x: number, y: number, z: number, lx: number, ly: number, lz: number, angle: number): Point {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [x + c * lx + s * lz, y + ly, z - s * lx + c * lz];
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, angle: number, tint: RGB) {
    const hw = w / 2, hd = d / 2,
      a = this.point(x, y, z, -hw, 0, -hd, angle),
      b = this.point(x, y, z, hw, 0, -hd, angle),
      c = this.point(x, y, z, hw, 0, hd, angle),
      d0 = this.point(x, y, z, -hw, 0, hd, angle),
      at = this.point(x, y, z, -hw, h, -hd, angle),
      bt = this.point(x, y, z, hw, h, -hd, angle),
      ct = this.point(x, y, z, hw, h, hd, angle),
      dt = this.point(x, y, z, -hw, h, hd, angle);
    this.quad(a, at, bt, b, tint);
    this.quad(b, bt, ct, c, tint);
    this.quad(c, ct, dt, d0, tint);
    this.quad(d0, dt, at, a, tint);
    this.quad(at, dt, ct, bt, tint);
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

function local(tile: Tile, feature: Feature) {
  return {
    x: feature.x - (tile.minX + tile.size / 2),
    z: feature.z - (tile.minZ + tile.size / 2),
    y: feature.y,
  };
}

/** Canonical farm plots remain visible even though vegetation owns the generic nature group. */
export function buildSettlementFieldGeometry(tile: Tile): Geometry | null {
  if (tile.size > 512) return null;
  const builder = new Builder(),
    fields = featuresFor(tile).filter((feature) => feature.kind === "field");
  if (!fields.length) return null;
  for (const feature of fields) {
    const { x, y, z } = local(tile, feature),
      angle = feature.angle ?? 0,
      width = Math.max(8, feature.width ?? 18),
      depth = Math.max(8, feature.depth ?? 14);
    builder.box(x, y + 0.02, z, width, 0.12, depth, angle, soil);
    if (tile.size <= 64) {
      const rows = Math.max(3, Math.min(10, Math.floor(width / 2))),
        c = Math.cos(angle),
        s = Math.sin(angle);
      for (let row = 0; row < rows; row++) {
        const offset = rows === 1 ? 0 : -width * 0.42 + (width * 0.84 * row) / (rows - 1),
          px = x + c * offset,
          pz = z - s * offset;
        builder.box(px, y + 0.16, pz, 0.48, 0.32, depth * 0.88, angle, crop);
      }
      for (const side of [-1, 1]) {
        const along = side * depth / 2,
          fx = x + s * along,
          fz = z + c * along;
        builder.box(fx, y + 0.48, fz, width, 0.9, 0.14, angle, timber);
      }
    }
  }
  return builder.finish();
}

export function mergeGeometry(base: Geometry, addition: Geometry | null): Geometry {
  if (!addition || addition.positions.length === 0) return base;
  if (base.uvs || addition.uvs)
    throw new Error("settlement geometry merge expects non-UV structure/detail groups");
  const positions = new Float32Array(base.positions.length + addition.positions.length),
    normals = new Float32Array(base.normals.length + addition.normals.length),
    colors = new Uint8Array(base.colors.length + addition.colors.length),
    indices = new Uint32Array(base.indices.length + addition.indices.length),
    offset = base.positions.length / 3;
  positions.set(base.positions);
  positions.set(addition.positions, base.positions.length);
  normals.set(base.normals);
  normals.set(addition.normals, base.normals.length);
  colors.set(base.colors);
  colors.set(addition.colors, base.colors.length);
  indices.set(base.indices);
  for (let i = 0; i < addition.indices.length; i++)
    indices[base.indices.length + i] = addition.indices[i] + offset;
  return { positions, normals, colors, indices };
}
