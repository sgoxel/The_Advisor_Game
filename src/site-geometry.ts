import type { Geometry, TileGeometry } from "./geometry.ts";
import { elevationToRenderY } from "./render-frame.ts";
import { nearbyCriticalSites } from "./sites.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "./planet.ts";
import { heightAt, type Tile } from "./world.ts";

type Point = readonly [number, number, number];
type Tint = readonly [number, number, number];

export const SITE_GEOMETRY_MAX_TILE_SIZE = 128;

class SiteBuilder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly i: number[] = [];

  private triangle(a: Point, b: Point, c: Point, tint: Tint) {
    const start = this.p.length / 3;
    const u = b.map((value, index) => value - a[index]), v = c.map((value, index) => value - a[index]),
      normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]],
      length = Math.hypot(...normal) || 1;
    for (const point of [a, b, c]) {
      this.p.push(...point);
      this.n.push(...normal.map(value => value / length));
      this.c.push(tint[0], tint[1], tint[2], 255);
    }
    this.i.push(start, start + 1, start + 2);
  }

  private quad(a: Point, b: Point, c: Point, d: Point, tint: Tint) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, tint: Tint) {
    const ax = x - w / 2,
      bx = x + w / 2,
      az = z - d / 2,
      bz = z + d / 2,
      top = y + h;
    this.quad([ax, y, az], [ax, top, az], [bx, top, az], [bx, y, az], tint);
    this.quad([bx, y, bz], [bx, top, bz], [ax, top, bz], [ax, y, bz], tint);
    this.quad([ax, y, bz], [ax, top, bz], [ax, top, az], [ax, y, az], tint);
    this.quad([bx, y, az], [bx, top, az], [bx, top, bz], [bx, y, bz], tint);
    this.quad([ax, top, az], [ax, top, bz], [bx, top, bz], [bx, top, az], tint);
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
  if (!b.indices.length) return a;
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
  for (let index = 0; index < b.indices.length; index++)
    indices[a.indices.length + index] = b.indices[index] + offset;
  return { positions, normals, colors, indices };
}

function ownedByTile(tile: Tile, x: number, z: number) {
  const centreX = tile.minX + tile.size / 2,
    unwrappedX = centreX + wrapSourceX(x - centreX);
  return (
    unwrappedX >= tile.minX &&
    unwrappedX < tile.minX + tile.size &&
    z >= tile.minZ &&
    z < tile.minZ + tile.size
  );
}

/**
 * Append only close-LOD landmark geometry. World-wide identity, access and pads
 * exist independently; these low-poly meshes are disposable presentation data.
 */
export function appendCriticalSiteGeometry(tile: Tile, data: TileGeometry) {
  if (tile.size > SITE_GEOMETRY_MAX_TILE_SIZE)
    return Object.freeze({ meshes: 0, details: 0, codes: [] as string[] });

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    radius = Math.hypot(tile.size, tile.size) * 0.75 + 32,
    structures = new SiteBuilder(),
    detail = new SiteBuilder(),
    codes: string[] = [];
  let details = 0;

  for (const site of nearbyCriticalSites(originX, originZ, radius, 12)) {
    if (!ownedByTile(tile, site.x, site.z)) continue;
    const localX = wrapSourceX(site.x - originX),
      localZ = site.z - originZ,
      y = elevationToRenderY(heightAt(site.x, site.z)),
      variant = site.variant,
      // Cool, high-value stone contrasts against the warm earth/road material
      // at close zoom; colour never selects the SEED-owned site archetype.
      stone: Tint = [171 + (variant % 12), 184 + (variant % 10), 181 + (variant % 9)],
      darkStone: Tint = [77, 87, 87],
      accent: Tint = [221, 191, 115];
    codes.push(site.code);

    if (site.kind === "ruin") {
      const towerHeight = 7.2 + (variant % 4) * 0.7;
      structures.box(localX - 3.4, y - 0.2, localZ - 2.8, 4.4, towerHeight, 4.2, stone);
      structures.box(localX - 3.4, y + towerHeight - 0.75, localZ - 2.8, 4.8, 0.6, 4.5, darkStone);
      structures.box(localX + 2.8, y - 0.15, localZ + 3.2, 8.6, 2.4 + (variant % 2), 1.15, stone);
      structures.box(localX + 5.7, y - 0.15, localZ - 0.6, 1.15, 3.2, 6.8, darkStone);
      structures.box(localX - 0.2, y - 0.1, localZ + 5.4, 5.2, 1.55, 1.0, darkStone);
    } else {
      const stones = 5 + (variant % 2);
      for (let index = 0; index < stones; index++) {
        const angle = (index / stones) * Math.PI * 2 + ((variant % 17) / 17) * 0.35,
          radius = 5.2 + (index % 2) * 0.7;
        structures.box(
          localX + Math.cos(angle) * radius,
          y - 0.15,
          localZ + Math.sin(angle) * radius,
          1.4,
          5.2 + ((variant >>> (index % 12)) & 1) * 1.3,
          1.4,
          stone,
        );
        structures.box(
          localX + Math.cos(angle) * radius,
          y + 5.05 + ((variant >>> (index % 12)) & 1) * 1.3,
          localZ + Math.sin(angle) * radius,
          1.7, 0.65, 1.7, accent,
        );
      }
      structures.box(localX, y - 0.08, localZ, 3.1, 1.1, 2.6, accent);
      structures.box(localX, y + 1.0, localZ, 1.3, 2.6, 1.3, darkStone);
      structures.box(localX, y + 3.6, localZ, 1.5, 0.55, 1.5, accent);
    }

    if (tile.size <= 32) {
      const rubble = 4 + (variant % 4);
      for (let index = 0; index < rubble; index++) {
        const angle = (index / rubble) * Math.PI * 2 + (variant % 31) * 0.07,
          radius = 3.5 + ((variant >>> (index % 16)) % 4);
        detail.box(
          localX + Math.cos(angle) * radius,
          y - 0.05,
          localZ + Math.sin(angle) * radius,
          0.65 + (index % 2) * 0.35,
          0.45 + (index % 3) * 0.25,
          0.7 + ((index + 1) % 2) * 0.4,
          index % 2 ? stone : darkStone,
        );
      }
      details += rubble;
    }
  }

  const structureGeometry = structures.finish(),
    detailGeometry = detail.finish();
  data.structures = mergeGeometry(data.structures, structureGeometry);
  data.detail = mergeGeometry(data.detail, detailGeometry);
  return Object.freeze({ meshes: codes.length, details, codes: Object.freeze(codes) });
}
