/**
 * Day/night lighting from local time (see clock.ts time zones). Keyframes are
 * blended smoothly through the day: night is dark blue, dawn and sunrise are
 * orange and rose, the day keeps the original bright atlas settings, late
 * afternoon is golden and dusk is warm violet. Pure function of local time.
 */
export type RGB = readonly [number, number, number];
export type Daylight = {
  /** Directional light colour and intensity (sun by day, moon by night). */
  sunColor: RGB;
  sunIntensity: number;
  /** Elevation above the horizon and compass azimuth of the light, in degrees. */
  sunPitch: number;
  sunYaw: number;
  /** Scene ambient light (lit buildings and characters). */
  ambient: RGB;
  /** Multiplier for the unlit terrain surface. */
  terrainTint: RGB;
  /** Backdrop behind the map. */
  sky: RGB;
  /** 0 at night, 1 in full day: used to switch shadows and similar effects. */
  daylight: number;
  phase: "night" | "dawn" | "sunrise" | "day" | "golden hour" | "dusk";
};

type Key = { hour: number; sun: RGB; intensity: number; pitch: number; ambient: RGB; tint: RGB; sky: RGB; daylight: number };
// The "day" key is exactly the atlas's original bright lighting.
const DAY: Omit<Key, "hour"> = { sun: [1, .94, .84], intensity: .9, pitch: 48, ambient: [.4, .46, .41], tint: [1, 1, 1], sky: [.65, .71, .65], daylight: 1 };
const NIGHT: Omit<Key, "hour"> = { sun: [.55, .66, 1], intensity: .22, pitch: 38, ambient: [.24, .28, .4], tint: [.26, .31, .52], sky: [.06, .09, .19], daylight: 0 };
const KEYS: readonly Key[] = [
  { hour: 0, ...NIGHT },
  { hour: 4.6, ...NIGHT },
  { hour: 5.4, sun: [.95, .55, .45], intensity: .35, pitch: 6, ambient: [.22, .2, .3], tint: [.62, .5, .58], sky: [.42, .32, .42], daylight: .25 },
  { hour: 6.3, sun: [1, .6, .3], intensity: .62, pitch: 14, ambient: [.36, .3, .3], tint: [.96, .74, .56], sky: [.88, .6, .42], daylight: .6 },
  { hour: 7.6, sun: [1, .84, .66], intensity: .82, pitch: 30, ambient: [.38, .4, .38], tint: [1, .93, .84], sky: [.74, .72, .62], daylight: .9 },
  { hour: 9, ...DAY },
  { hour: 16, ...DAY },
  { hour: 17.6, sun: [1, .8, .58], intensity: .82, pitch: 22, ambient: [.4, .39, .36], tint: [1, .9, .76], sky: [.8, .7, .55], daylight: .85 },
  { hour: 18.8, sun: [1, .52, .32], intensity: .55, pitch: 8, ambient: [.33, .25, .3], tint: [.9, .64, .56], sky: [.72, .44, .44], daylight: .5 },
  { hour: 19.8, sun: [.75, .5, .7], intensity: .32, pitch: 4, ambient: [.3, .25, .34], tint: [.5, .42, .6], sky: [.3, .22, .36], daylight: .2 },
  { hour: 21, ...NIGHT },
  { hour: 24, ...NIGHT },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

export function daylightAt(localSecondOfDay: number): Daylight {
  const hour = ((localSecondOfDay / 3600) % 24 + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = smooth(Math.max(0, Math.min(1, (hour - a.hour) / Math.max(1e-6, b.hour - a.hour))));
  // The light travels east to west across the day; at night it is the moon, high in the south.
  // At noon the light comes from exactly where the original atlas sun stood (yaw -28°).
  const sunYaw = hour >= 5 && hour <= 20 ? -28 + (hour - 12) * 14.7 : 180,
    phase = hour < 5 || hour >= 20.5 ? "night" : hour < 6 ? "dawn" : hour < 8 ? "sunrise" : hour < 16.5 ? "day" : hour < 18.5 ? "golden hour" : "dusk";
  return {
    sunColor: mix3(a.sun, b.sun, t), sunIntensity: mix(a.intensity, b.intensity, t), sunPitch: mix(a.pitch, b.pitch, t), sunYaw,
    ambient: mix3(a.ambient, b.ambient, t), terrainTint: mix3(a.tint, b.tint, t), sky: mix3(a.sky, b.sky, t),
    daylight: mix(a.daylight, b.daylight, t), phase,
  };
}
