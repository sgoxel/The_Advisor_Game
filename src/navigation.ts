import {
  CANONICAL_PLANET_RADIUS,
  type LonLat,
  lonLatToUnit,
  unitToLonLat,
  type Unit,
} from "./planet.ts";

export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function surfaceDistance(a: LonLat, b: LonLat): number {
  const u = lonLatToUnit(a.lon, a.lat),
    v = lonLatToUnit(b.lon, b.lat);
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  return (
    CANONICAL_PLANET_RADIUS *
    Math.atan2(
      Math.hypot(...cross),
      u.reduce((sum, n, i) => sum + n * v[i], 0),
    )
  );
}
/** Minimal spherical drag rotation; coordinates, never pixel dimensions, own focus. */
export function draggedFocus(
  focus: LonLat,
  previous: LonLat,
  current: LonLat,
): LonLat {
  const a = lonLatToUnit(current.lon, current.lat),
    b = lonLatToUnit(previous.lon, previous.lat);
  const axis: Unit = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...axis),
    cosine = Math.max(
      -1,
      Math.min(
        1,
        a.reduce((sum, n, i) => sum + n * b[i], 0),
      ),
    );
  if (length < 1e-12) return focus;
  const k = axis.map((n) => n / length),
    p = lonLatToUnit(focus.lon, focus.lat);
  const dot = k.reduce((sum, n, i) => sum + n * p[i], 0),
    sine = length;
  const cross = [
    k[1] * p[2] - k[2] * p[1],
    k[2] * p[0] - k[0] * p[2],
    k[0] * p[1] - k[1] * p[0],
  ];
  return unitToLonLat(
    p.map(
      (n, i) => n * cosine + cross[i] * sine + k[i] * dot * (1 - cosine),
    ) as Unit,
  );
}
export function coordinateLabel(focus: LonLat, local: boolean): string {
  const digits = local ? 5 : 4;
  const lat = (focus.lat * 180) / Math.PI,
    lon = (focus.lon * 180) / Math.PI;
  return `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(digits)}°${lon < 0 ? "W" : "E"}`;
}
export type Rect = { x: number; y: number; width: number; height: number };
export type Label = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export const overlaps = (a: Rect, b: Rect, gap = 5) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;
/** Keep every eligible label. Search deterministic viewport slots; never apply a shared hide budget. */
export function placeLabels(
  labels: Label[],
  width: number,
  height: number,
  obstacles: Rect[],
) {
  const occupied = [...obstacles];
  return [...labels]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((label) => {
      const w = Math.min(label.width, width - 16),
        h = label.height;
      const clamp = (x: number, y: number): Rect => ({
        x: Math.max(8, Math.min(width - w - 8, x)),
        y: Math.max(8, Math.min(height - h - 8, y)),
        width: w,
        height: h,
      });
      const candidates = [clamp(label.x - w / 2, label.y - h - 6)];
      for (let y = 8; y < height - h; y += h + 8)
        for (let x = 8; x < width - w; x += Math.max(28, w / 3))
          candidates.push(clamp(x, y));
      candidates.sort(
        (a, b) =>
          Math.hypot(a.x + w / 2 - label.x, a.y + h / 2 - label.y) -
            Math.hypot(b.x + w / 2 - label.x, b.y + h / 2 - label.y) ||
          a.y - b.y ||
          a.x - b.x,
      );
      const rect =
        candidates.find((r) => !occupied.some((o) => overlaps(r, o))) ||
        candidates[0];
      occupied.push(rect);
      const endX = Math.max(rect.x, Math.min(rect.x + w, label.x)),
        endY = Math.max(rect.y, Math.min(rect.y + h, label.y));
      return {
        ...label,
        rect,
        leader: Math.hypot(endX - label.x, endY - label.y) > 4,
        endX,
        endY,
      };
    });
}
