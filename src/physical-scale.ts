import { CANONICAL_METRES_PER_SOURCE_UNIT, sourceToLonLat } from "./planet.ts";

export const metresToSource = (metres: number) => metres / CANONICAL_METRES_PER_SOURCE_UNIT;
/** Inverse local metric of the equirectangular source domain, not a new world position. */
export function sourceUnitsPerMetreAt(z: number) {
  const latitude = sourceToLonLat(0, z).lat;
  return { x: metresToSource(1) / Math.max(.001, Math.cos(latitude)), z: metresToSource(1) };
}
export function physicalFootprintRadius(widthM: number, depthM: number, z: number, marginM = .4) {
  const scale = sourceUnitsPerMetreAt(z);
  return (Math.hypot(widthM, depthM) * .5 + marginM) * Math.max(scale.x, scale.z);
}

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export type HouseDimensions = {
  houseType: "shack" | "cottage" | "townhouse" | "large-house";
  widthM: number; depthM: number; wallHeightM: number; roomCount: number; storeys: number;
};
/** Physical exterior/foundation dimensions. Room counts are a program, not enterable interiors. */
export function houseDimensionsFor(id: string, city: boolean): HouseDimensions {
  const seed = hash(`${id}/PHYSICAL-DIMENSIONS`), kind = seed % 16;
  if (kind === 0) return { houseType: "shack", widthM: 2.4, depthM: 3.4, wallHeightM: 2.4, roomCount: 1, storeys: 1 };
  if (kind === 15) return { houseType: "large-house", widthM: 8, depthM: 10, wallHeightM: 5.6, roomCount: 6, storeys: 2 };
  if (city) return { houseType: "townhouse", widthM: 6 + (seed >>> 8) % 3, depthM: 8 + (seed >>> 12) % 3, wallHeightM: 3, roomCount: 3, storeys: 1 };
  return { houseType: "cottage", widthM: 6 + (seed >>> 8) % 2, depthM: 8 + (seed >>> 12) % 2, wallHeightM: 2.8, roomCount: 3, storeys: 1 };
}
export function residentDimensionsFor(silhouette: number) {
  return { heightM: (1600 + (silhouette % 5) * 75) / 1000, widthM: (580 + (silhouette % 3) * 45) / 1000 };
}
