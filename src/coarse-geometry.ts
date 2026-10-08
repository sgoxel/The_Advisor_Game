import { terrainTint, type Geometry, type TileGeometry } from "./geometry.ts";
import { heightAt, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];

class TerrainBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

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
      start = this.positions.length / 3;
    for (const point of [a, b, c]) {
      this.positions.push(...point);
      this.normals.push(nx / length, ny / length, nz / length);
      this.colors.push(...tint, 255);
    }
    this.indices.push(start, start + 1, start + 2);
  }

  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }

  relativeTo(x: number, z: number) {
    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] -= x;
      this.positions[i + 2] -= z;
    }
  }

  finish(): Geometry {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Uint8Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

function emptyGeometry(): Geometry {
  return {
    positions: new Float32Array(),
    normals: new Float32Array(),
    colors: new Uint8Array(),
    indices: new Uint32Array(),
  };
}

/**
 * Coarse patches contain terrain only in the normal builder. At realm-scale LOD
 * twelve samples per edge retain the same seeded height/tint functions while
 * cutting deterministic generation work substantially during long-distance
 * streaming and pole rollover.
 */
export function buildCoarseTile(t: Tile): TileGeometry {
  const terrain = new TerrainBuilder(),
    resolution = Math.min(12, t.size / 2),
    step = t.size / resolution,
    point = (x: number, z: number): Point => [x, heightAt(x, z), z];

  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = t.minX + x * step,
        az = t.minZ + z * step,
        a = point(ax, az),
        b = point(ax, az + step),
        c = point(ax + step, az + step),
        d = point(ax + step, az);
      if (Math.max(a[1], b[1], c[1], d[1]) > 0)
        terrain.quad(
          a,
          b,
          c,
          d,
          terrainTint(ax + step / 2, az + step / 2, t.size),
        );
      if (z === 0)
        terrain.quad(
          a,
          d,
          [d[0], d[1] - 12, d[2]],
          [a[0], a[1] - 12, a[2]],
          terrainTint(ax, az, t.size),
        );
      if (z === resolution - 1)
        terrain.quad(
          c,
          b,
          [b[0], b[1] - 12, b[2]],
          [c[0], c[1] - 12, c[2]],
          terrainTint(ax, az, t.size),
        );
      if (x === 0)
        terrain.quad(
          b,
          a,
          [a[0], a[1] - 12, a[2]],
          [b[0], b[1] - 12, b[2]],
          terrainTint(ax, az, t.size),
        );
      if (x === resolution - 1)
        terrain.quad(
          d,
          c,
          [c[0], c[1] - 12, c[2]],
          [d[0], d[1] - 12, d[2]],
          terrainTint(ax, az, t.size),
        );
    }

  terrain.quad(
    [t.minX, 0, t.minZ],
    [t.minX, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ],
    [70, 126, 132],
  );
  terrain.relativeTo(t.minX + t.size / 2, t.minZ + t.size / 2);

  return {
    terrain: terrain.finish(),
    structures: emptyGeometry(),
    nature: emptyGeometry(),
    detail: emptyGeometry(),
  };
}
