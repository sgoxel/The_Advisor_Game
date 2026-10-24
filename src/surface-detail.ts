import { CANONICAL_METRES_PER_SOURCE_UNIT } from "./planet.ts";

/**
 * Procedural surface detail (presentation only, no textures).
 *
 * Every pixel of the terrain and of the lit world material (buildings, props, Blender models) gets a
 * small world-space pattern chosen from its own colour and orientation: grass, dirt, rock, sand, snow
 * and roads on the ground; brick, plaster, timber and stone blocks on walls; roof tiles on slopes;
 * paving on grey flats; leaf noise on foliage. The pattern tints the albedo and carries a tiny height
 * field that bends the normal (Mikkelsen surface-gradient bump mapping from screen derivatives), so
 * grooves, mortar and seams answer the sun and lamp light.
 *
 * Cost control: patterns are laid out in metres and each feature fades out when it would be smaller
 * than a few pixels, so they never shimmer; above ~0.45 m per pixel (beyond Close zoom) nothing is
 * evaluated at all. Patterns follow world position, so they are stable while the camera moves (the
 * render frame only re-centres after ~2 km of panning).
 */
export type SurfaceDetailMode = "terrain" | "lit";

const M = CANONICAL_METRES_PER_SOURCE_UNIT.toFixed(6);

/** Pattern ids shared by both shader languages (also used by tests of the classifier). */
export const SURFACE_KIND = Object.freeze({
  none: 0, grass: 1, dirt: 2, rock: 3, road: 4, sand: 5, snow: 6, paving: 7, brick: 8, plaster: 9,
  wood: 10, roof: 11, foliage: 12, ashlar: 13,
});

/** Display-RGB (0-255) classifier mirrored by the shaders: lit-material kind for a colour and |normal.y|. */
export function litSurfaceKind(rgb: readonly [number, number, number], ny: number): number {
  const [r, g, b] = rgb.map((v) => v / 255), lum = r * .3 + g * .59 + b * .11, sat = Math.max(r, g, b) - Math.min(r, g, b);
  const green = g > r * 1.06 && g > b * 1.12, red = r > g * 1.6 && r > b * 1.6 && sat > .2, brown = r >= g && g >= b && sat > .08 && !red;
  const K = SURFACE_KIND;
  if (lum < .16) return K.none;
  if (ny > .975) return green ? K.grass : sat < .07 && lum > .3 ? K.paving : r > g * 1.3 && sat > .12 ? K.roof : brown || red ? K.dirt : K.none;
  if (ny > .2) return green ? K.foliage : K.roof;
  if (green) return K.foliage;
  if (red) return K.brick;
  if (brown && lum < .5) return K.wood;
  if (sat < .08 && lum > .62) return K.plaster;
  if (sat < .1 && lum > .3) return K.ashlar;
  return lum > .55 ? K.plaster : K.none;
}

const GLSL_DECLARATION = `
uniform vec3 sdSunDir;
uniform float sdStrength;
vec3 sdMul = vec3(1.0);
vec3 sdGrad = vec3(0.0);
float sdShade = 1.0;
float sdHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sdNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sdHash(i), sdHash(i + vec2(1.0, 0.0)), u.x), mix(sdHash(i + vec2(0.0, 1.0)), sdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 sdCells(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); float d1 = 8.0; float d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y)); vec2 c = i + g;
      vec2 r = g + vec2(sdHash(c), sdHash(c + 17.31)) * 0.8 + 0.1 - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = sdHash(c + 5.71); } else if (d < d2) { d2 = d; }
    }
  }
  return vec2((sqrt(d2) - sqrt(d1)) * 0.5, id);
}
float sdVis(float size, float fp) { return smoothstep(1.5, 4.0, size / fp); }
float sdGroove(float edge, float width, float fp) { return 1.0 - smoothstep(width * 0.5, width * 0.5 + fp, edge); }
vec4 sdBlocks(vec2 uv, vec2 size, float joint, float fp, float toneAmp) {
  vec2 b = uv / size; float row = floor(b.y); b.x += 0.5 * (row - 2.0 * floor(row * 0.5));
  vec2 cell = floor(b); vec2 f = fract(b); vec2 e = min(f, 1.0 - f) * size;
  float g = sdGroove(min(e.x, e.y), joint, fp) * sdVis(size.y, fp);
  float tone = (sdHash(cell + row * 7.13) - 0.5) * toneAmp * sdVis(size.x, fp);
  return vec4(vec3((1.0 + tone) * (1.0 - 0.38 * g)), -g * 0.015 + smoothstep(0.0, 0.05, min(e.x, e.y)) * 0.006);
}
vec4 sdPattern(float kind, vec2 uv, float fp) {
  if (kind < 1.5) {
    float big = sdNoise(uv * 0.35); float mid = sdNoise(uv * 1.7); float fine = sdNoise(uv * 11.0);
    float tone = (big - 0.5) * 0.22 * sdVis(3.0, fp) + (mid - 0.5) * 0.18 * sdVis(0.6, fp) + (fine - 0.5) * 0.18 * sdVis(0.07, fp);
    vec3 dry = mix(vec3(1.0), vec3(1.1, 1.06, 0.8), smoothstep(0.55, 0.8, big) * 0.6 * sdVis(3.0, fp));
    return vec4(vec3(1.0 + tone) * dry, mid * 0.02 + fine * 0.012 * sdVis(0.07, fp));
  } else if (kind < 2.5 || (kind > 3.5 && kind < 4.5)) {
    float road = step(3.5, kind);
    float blotch = sdNoise(uv * 0.6); float grain = sdNoise(uv * 5.0); vec2 c = sdCells(uv * 5.0);
    float pebble = step(0.8 - road * 0.06, c.y) * smoothstep(0.01, 0.04, c.x / 5.0) * sdVis(0.2, fp);
    float tone = (blotch - 0.5) * 0.25 * sdVis(1.6, fp) + (grain - 0.5) * 0.16 * sdVis(0.2, fp);
    return vec4(vec3(1.0 + tone) * mix(vec3(1.0), vec3(1.16, 1.13, 1.1), pebble), grain * 0.01 + pebble * 0.02);
  } else if (kind < 3.5) {
    vec2 c = sdCells(uv * 0.8); float edge = c.x / 0.8; float grain = sdNoise(uv * 3.0);
    float crack = sdGroove(edge, 0.05, fp) * sdVis(0.6, fp);
    float tone = (c.y - 0.5) * 0.2 * sdVis(1.2, fp) + (grain - 0.5) * 0.2 * sdVis(0.3, fp);
    return vec4(vec3((1.0 + tone) * (1.0 - 0.45 * crack)), -crack * 0.04 + grain * 0.02 + smoothstep(0.0, 0.3, edge) * 0.03);
  } else if (kind < 5.5) {
    float s = sin((uv.x * 0.8 + uv.y * 0.6 + sdNoise(uv * 0.5) * 2.0) * 12.0) * sdVis(0.5, fp);
    return vec4(vec3(1.0 + 0.06 * s), 0.008 * s);
  } else if (kind < 6.5) {
    float n = sdNoise(uv * 0.8);
    return vec4(vec3(1.0 + (n - 0.5) * 0.06), n * 0.03);
  } else if (kind < 7.5) {
    vec2 c = sdCells(uv * 3.0); float edge = c.x / 3.0;
    float joint = sdGroove(edge, 0.03, fp) * sdVis(0.33, fp);
    return vec4(vec3((1.0 + (c.y - 0.5) * 0.2 * sdVis(0.33, fp)) * (1.0 - 0.4 * joint)), -joint * 0.02 + smoothstep(0.0, 0.08, edge) * 0.015);
  } else if (kind < 8.5) {
    return sdBlocks(uv, vec2(0.44, 0.16), 0.03, fp, 0.24);
  } else if (kind < 9.5) {
    float n = sdNoise(uv * 0.9); float fine = sdHash(floor(uv * 25.0));
    return vec4(vec3(1.0 + (n - 0.5) * 0.12 * sdVis(1.0, fp) + (fine - 0.5) * 0.06 * sdVis(0.04, fp)), sdNoise(uv * 4.0) * 0.004);
  } else if (kind < 10.5) {
    float rows = uv.y / 0.22; float row = floor(rows); float e = min(fract(rows), 1.0 - fract(rows)) * 0.22;
    float seam = sdGroove(e, 0.02, fp) * sdVis(0.22, fp);
    float grain = sdNoise(vec2(uv.x * 0.7, uv.y * 22.0));
    float tone = (sdHash(vec2(row, 3.7)) - 0.5) * 0.2 * sdVis(0.22, fp) + (grain - 0.5) * 0.18 * sdVis(0.05, fp);
    return vec4(vec3((1.0 + tone) * (1.0 - 0.45 * seam)), -seam * 0.01 + grain * 0.003);
  } else if (kind < 11.5) {
    float rows = uv.y / 0.28; float row = floor(rows); float fy = fract(rows);
    float cols = uv.x / 0.32 + 0.5 * (row - 2.0 * floor(row * 0.5)); float fx = fract(cols);
    float vis = sdVis(0.28, fp);
    float seam = sdGroove(min(fx, 1.0 - fx) * 0.32, 0.02, fp) * vis;
    float tone = (sdHash(vec2(floor(cols), row)) - 0.5) * 0.2 * vis;
    return vec4(vec3((1.0 + tone) * (1.0 - 0.3 * seam) * mix(1.0, 0.86 + 0.14 * fy, vis)), ((1.0 - fy) * 0.03 - seam * 0.01) * vis);
  } else if (kind < 12.5) {
    float n = sdNoise(uv * 4.0); float m = sdNoise(uv * 1.1);
    return vec4(vec3(1.0 + (n - 0.5) * 0.3 * sdVis(0.25, fp) + (m - 0.5) * 0.15), n * 0.04);
  }
  vec4 stones = sdBlocks(uv, vec2(0.7, 0.32), 0.035, fp, 0.28);
  float grain = sdNoise(uv * 6.0);
  return vec4(stones.rgb * (1.0 + (grain - 0.5) * 0.1 * sdVis(0.15, fp)), stones.a + grain * 0.004);
}
float sdKindLit(vec3 c, float ny) {
  float lum = dot(c, vec3(0.3, 0.59, 0.11)); float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  bool green = c.g > c.r * 1.06 && c.g > c.b * 1.12;
  bool red = c.r > c.g * 1.6 && c.r > c.b * 1.6 && sat > 0.2;
  bool brown = c.r >= c.g && c.g >= c.b && sat > 0.08 && !red;
  if (lum < 0.16) { return 0.0; }
  if (ny > 0.975) {
    if (green) { return 1.0; }
    if (sat < 0.07 && lum > 0.3) { return 7.0; }
    if (c.r > c.g * 1.3 && sat > 0.12) { return 11.0; }
    if (brown || red) { return 2.0; }
    return 0.0;
  }
  if (ny > 0.2) { return green ? 12.0 : 11.0; }
  if (green) { return 12.0; }
  if (red) { return 8.0; }
  if (brown && lum < 0.5) { return 10.0; }
  if (sat < 0.08 && lum > 0.62) { return 9.0; }
  if (sat < 0.1 && lum > 0.3) { return 13.0; }
  return lum > 0.55 ? 9.0 : 0.0;
}
float sdKindTerrain(vec3 c, float road, float ny) {
  if (road > 0.5) { return 4.0; }
  float lum = dot(c, vec3(0.3, 0.59, 0.11)); float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  if (lum > 0.85 && sat < 0.08) { return 6.0; }
  if (ny < 0.6 || sat < 0.07) { return 3.0; }
  if (c.g > c.r * 1.02 && c.g > c.b * 1.1) { return 1.0; }
  if (lum > 0.62 && c.r > c.b * 1.25) { return 5.0; }
  return 2.0;
}
`;

const glslMainStart = (mode: SurfaceDetailMode) => `
#ifdef FORWARD_PASS
{
  vec3 sdP = vPositionW * ${M};
  vec3 sdDx = dFdx(sdP); vec3 sdDy = dFdy(sdP);
  float sdFp = max(length(sdDx), length(sdDy));
  vec3 sdN = cross(sdDx, sdDy); sdN = sdN / max(length(sdN), 1e-12);
  ${mode === "terrain" ? "if (sdN.y < 0.0) { sdN = -sdN; }" : ""}
  float sdNy = abs(sdN.y);
  vec2 sdT = vec2(-sdN.z, sdN.x); sdT = sdT / max(length(sdT), 1e-6);
  vec2 sdUv = sdNy > 0.975 || ${mode === "terrain" ? "true" : "false"} ? sdP.xz : vec2(dot(sdP.xz, sdT), sdNy > 0.2 ? sdP.y / max(length(sdN.xz), 0.2) : sdP.y);
  vec3 sdC = pow(max(vVertexColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  float sdKind = ${mode === "terrain" ? "sdKindTerrain(sdC, smoothstep(0.68, 0.84, vVertexColor.a), sdNy)" : "sdKindLit(sdC, sdNy)"};
  vec4 sdPat = vec4(1.0, 1.0, 1.0, 0.0);
  if (sdFp < 0.45 && sdKind > 0.5 && sdStrength > 0.0) { sdPat = sdPattern(sdKind, sdUv, sdFp); }
  float sdFade = (1.0 - smoothstep(0.2, 0.45, sdFp)) * sdStrength;
  sdMul = mix(vec3(1.0), sdPat.rgb, sdFade);
  float sdH = sdPat.a * sdFade;
  float sdDhx = dFdx(sdH); float sdDhy = dFdy(sdH);
  vec3 sdR1 = cross(sdDy, sdN); vec3 sdR2 = cross(sdN, sdDx); float sdDet = dot(sdDx, sdR1);
  sdGrad = sign(sdDet) * (sdDhx * sdR1 + sdDhy * sdR2) / max(abs(sdDet), 1e-10);
  float sdGl = length(sdGrad); if (sdGl > 1.2) { sdGrad *= 1.2 / sdGl; }
  ${mode === "terrain" ? `
  vec3 sdL = normalize(sdSunDir);
  vec3 sdNb = normalize(sdN - sdGrad);
  float sdDay = smoothstep(-0.05, 0.25, sdL.y);
  sdShade = clamp(1.0 + 1.3 * (dot(sdNb, sdL) - dot(sdN, sdL)) * sdDay, 0.55, 1.45);` : ""}
}
#endif
`;

const WGSL_DECLARATION = `
uniform sdSunDir: vec3f;
uniform sdStrength: f32;
var<private> sdMul: vec3f = vec3f(1.0);
var<private> sdGrad: vec3f = vec3f(0.0);
var<private> sdShade: f32 = 1.0;
fn sdHash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn sdNoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sdHash(i), sdHash(i + vec2f(1.0, 0.0)), u.x), mix(sdHash(i + vec2f(0.0, 1.0)), sdHash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn sdCells(p: vec2f) -> vec2f {
  let i = floor(p); let f = fract(p); var d1 = 8.0; var d2 = 8.0; var id = 0.0;
  for (var y: i32 = -1; y <= 1; y++) {
    for (var x: i32 = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y)); let c = i + g;
      let r = g + vec2f(sdHash(c), sdHash(c + 17.31)) * 0.8 + 0.1 - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = sdHash(c + 5.71); } else if (d < d2) { d2 = d; }
    }
  }
  return vec2f((sqrt(d2) - sqrt(d1)) * 0.5, id);
}
fn sdVis(size: f32, fp: f32) -> f32 { return smoothstep(1.5, 4.0, size / fp); }
fn sdGroove(edge: f32, width: f32, fp: f32) -> f32 { return 1.0 - smoothstep(width * 0.5, width * 0.5 + fp, edge); }
fn sdBlocks(uv: vec2f, size: vec2f, joint: f32, fp: f32, toneAmp: f32) -> vec4f {
  var b = uv / size; let row = floor(b.y); b.x = b.x + 0.5 * (row - 2.0 * floor(row * 0.5));
  let cell = floor(b); let f = fract(b); let e = min(f, 1.0 - f) * size;
  let g = sdGroove(min(e.x, e.y), joint, fp) * sdVis(size.y, fp);
  let tone = (sdHash(cell + row * 7.13) - 0.5) * toneAmp * sdVis(size.x, fp);
  return vec4f(vec3f((1.0 + tone) * (1.0 - 0.38 * g)), -g * 0.015 + smoothstep(0.0, 0.05, min(e.x, e.y)) * 0.006);
}
fn sdPattern(kind: f32, uv: vec2f, fp: f32) -> vec4f {
  if (kind < 1.5) {
    let big = sdNoise(uv * 0.35); let mid = sdNoise(uv * 1.7); let fine = sdNoise(uv * 11.0);
    let tone = (big - 0.5) * 0.22 * sdVis(3.0, fp) + (mid - 0.5) * 0.18 * sdVis(0.6, fp) + (fine - 0.5) * 0.18 * sdVis(0.07, fp);
    let dry = mix(vec3f(1.0), vec3f(1.1, 1.06, 0.8), smoothstep(0.55, 0.8, big) * 0.6 * sdVis(3.0, fp));
    return vec4f(vec3f(1.0 + tone) * dry, mid * 0.02 + fine * 0.012 * sdVis(0.07, fp));
  } else if (kind < 2.5 || (kind > 3.5 && kind < 4.5)) {
    let road = step(3.5, kind);
    let blotch = sdNoise(uv * 0.6); let grain = sdNoise(uv * 5.0); let c = sdCells(uv * 5.0);
    let pebble = step(0.8 - road * 0.06, c.y) * smoothstep(0.01, 0.04, c.x / 5.0) * sdVis(0.2, fp);
    let tone = (blotch - 0.5) * 0.25 * sdVis(1.6, fp) + (grain - 0.5) * 0.16 * sdVis(0.2, fp);
    return vec4f(vec3f(1.0 + tone) * mix(vec3f(1.0), vec3f(1.16, 1.13, 1.1), pebble), grain * 0.01 + pebble * 0.02);
  } else if (kind < 3.5) {
    let c = sdCells(uv * 0.8); let edge = c.x / 0.8; let grain = sdNoise(uv * 3.0);
    let crack = sdGroove(edge, 0.05, fp) * sdVis(0.6, fp);
    let tone = (c.y - 0.5) * 0.2 * sdVis(1.2, fp) + (grain - 0.5) * 0.2 * sdVis(0.3, fp);
    return vec4f(vec3f((1.0 + tone) * (1.0 - 0.45 * crack)), -crack * 0.04 + grain * 0.02 + smoothstep(0.0, 0.3, edge) * 0.03);
  } else if (kind < 5.5) {
    let s = sin((uv.x * 0.8 + uv.y * 0.6 + sdNoise(uv * 0.5) * 2.0) * 12.0) * sdVis(0.5, fp);
    return vec4f(vec3f(1.0 + 0.06 * s), 0.008 * s);
  } else if (kind < 6.5) {
    let n = sdNoise(uv * 0.8);
    return vec4f(vec3f(1.0 + (n - 0.5) * 0.06), n * 0.03);
  } else if (kind < 7.5) {
    let c = sdCells(uv * 3.0); let edge = c.x / 3.0;
    let joint = sdGroove(edge, 0.03, fp) * sdVis(0.33, fp);
    return vec4f(vec3f((1.0 + (c.y - 0.5) * 0.2 * sdVis(0.33, fp)) * (1.0 - 0.4 * joint)), -joint * 0.02 + smoothstep(0.0, 0.08, edge) * 0.015);
  } else if (kind < 8.5) {
    return sdBlocks(uv, vec2f(0.44, 0.16), 0.03, fp, 0.24);
  } else if (kind < 9.5) {
    let n = sdNoise(uv * 0.9); let fine = sdHash(floor(uv * 25.0));
    return vec4f(vec3f(1.0 + (n - 0.5) * 0.12 * sdVis(1.0, fp) + (fine - 0.5) * 0.06 * sdVis(0.04, fp)), sdNoise(uv * 4.0) * 0.004);
  } else if (kind < 10.5) {
    let rows = uv.y / 0.22; let row = floor(rows); let e = min(fract(rows), 1.0 - fract(rows)) * 0.22;
    let seam = sdGroove(e, 0.02, fp) * sdVis(0.22, fp);
    let grain = sdNoise(vec2f(uv.x * 0.7, uv.y * 22.0));
    let tone = (sdHash(vec2f(row, 3.7)) - 0.5) * 0.2 * sdVis(0.22, fp) + (grain - 0.5) * 0.18 * sdVis(0.05, fp);
    return vec4f(vec3f((1.0 + tone) * (1.0 - 0.45 * seam)), -seam * 0.01 + grain * 0.003);
  } else if (kind < 11.5) {
    let rows = uv.y / 0.28; let row = floor(rows); let fy = fract(rows);
    let cols = uv.x / 0.32 + 0.5 * (row - 2.0 * floor(row * 0.5)); let fx = fract(cols);
    let vis = sdVis(0.28, fp);
    let seam = sdGroove(min(fx, 1.0 - fx) * 0.32, 0.02, fp) * vis;
    let tone = (sdHash(vec2f(floor(cols), row)) - 0.5) * 0.2 * vis;
    return vec4f(vec3f((1.0 + tone) * (1.0 - 0.3 * seam) * mix(1.0, 0.86 + 0.14 * fy, vis)), ((1.0 - fy) * 0.03 - seam * 0.01) * vis);
  } else if (kind < 12.5) {
    let n = sdNoise(uv * 4.0); let m = sdNoise(uv * 1.1);
    return vec4f(vec3f(1.0 + (n - 0.5) * 0.3 * sdVis(0.25, fp) + (m - 0.5) * 0.15), n * 0.04);
  }
  let stones = sdBlocks(uv, vec2f(0.7, 0.32), 0.035, fp, 0.28);
  let grain = sdNoise(uv * 6.0);
  return vec4f(stones.rgb * (1.0 + (grain - 0.5) * 0.1 * sdVis(0.15, fp)), stones.a + grain * 0.004);
}
fn sdKindLit(c: vec3f, ny: f32) -> f32 {
  let lum = dot(c, vec3f(0.3, 0.59, 0.11)); let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  let green = c.g > c.r * 1.06 && c.g > c.b * 1.12;
  let red = c.r > c.g * 1.6 && c.r > c.b * 1.6 && sat > 0.2;
  let brown = c.r >= c.g && c.g >= c.b && sat > 0.08 && !red;
  if (lum < 0.16) { return 0.0; }
  if (ny > 0.975) {
    if (green) { return 1.0; }
    if (sat < 0.07 && lum > 0.3) { return 7.0; }
    if (c.r > c.g * 1.3 && sat > 0.12) { return 11.0; }
    if (brown || red) { return 2.0; }
    return 0.0;
  }
  if (ny > 0.2) { return select(11.0, 12.0, green); }
  if (green) { return 12.0; }
  if (red) { return 8.0; }
  if (brown && lum < 0.5) { return 10.0; }
  if (sat < 0.08 && lum > 0.62) { return 9.0; }
  if (sat < 0.1 && lum > 0.3) { return 13.0; }
  return select(0.0, 9.0, lum > 0.55);
}
fn sdKindTerrain(c: vec3f, road: f32, ny: f32) -> f32 {
  if (road > 0.5) { return 4.0; }
  let lum = dot(c, vec3f(0.3, 0.59, 0.11)); let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  if (lum > 0.85 && sat < 0.08) { return 6.0; }
  if (ny < 0.6 || sat < 0.07) { return 3.0; }
  if (c.g > c.r * 1.02 && c.g > c.b * 1.1) { return 1.0; }
  if (lum > 0.62 && c.r > c.b * 1.25) { return 5.0; }
  return 2.0;
}
`;

const wgslMainStart = (mode: SurfaceDetailMode) => `
#ifdef FORWARD_PASS
{
  let sdP = vPositionW * ${M};
  let sdDx = dpdx(sdP); let sdDy = dpdy(sdP);
  let sdFp = max(length(sdDx), length(sdDy));
  var sdN = cross(sdDx, sdDy); sdN = sdN / max(length(sdN), 1e-12);
  ${mode === "terrain" ? "if (sdN.y < 0.0) { sdN = -sdN; }" : ""}
  let sdNy = abs(sdN.y);
  var sdT = vec2f(-sdN.z, sdN.x); sdT = sdT / max(length(sdT), 1e-6);
  let sdWallV = select(sdP.y, sdP.y / max(length(sdN.xz), 0.2), sdNy > 0.2);
  let sdUv = select(vec2f(dot(sdP.xz, sdT), sdWallV), sdP.xz, sdNy > 0.975 || ${mode === "terrain" ? "true" : "false"});
  let sdC = pow(max(vVertexColor.rgb, vec3f(0.0)), vec3f(1.0 / 2.2));
  let sdKind = ${mode === "terrain" ? "sdKindTerrain(sdC, smoothstep(0.68, 0.84, vVertexColor.a), sdNy)" : "sdKindLit(sdC, sdNy)"};
  var sdPat = vec4f(1.0, 1.0, 1.0, 0.0);
  if (sdFp < 0.45 && sdKind > 0.5 && uniform.sdStrength > 0.0) { sdPat = sdPattern(sdKind, sdUv, sdFp); }
  let sdFade = (1.0 - smoothstep(0.2, 0.45, sdFp)) * uniform.sdStrength;
  sdMul = mix(vec3f(1.0), sdPat.rgb, sdFade);
  let sdH = sdPat.a * sdFade;
  let sdDhx = dpdx(sdH); let sdDhy = dpdy(sdH);
  let sdR1 = cross(sdDy, sdN); let sdR2 = cross(sdN, sdDx); let sdDet = dot(sdDx, sdR1);
  sdGrad = sign(sdDet) * (sdDhx * sdR1 + sdDhy * sdR2) / max(abs(sdDet), 1e-10);
  let sdGl = length(sdGrad); if (sdGl > 1.2) { sdGrad = sdGrad * (1.2 / sdGl); }
  ${mode === "terrain" ? `
  let sdL = normalize(uniform.sdSunDir);
  let sdNb = normalize(sdN - sdGrad);
  let sdDay = smoothstep(-0.05, 0.25, sdL.y);
  sdShade = clamp(1.0 + 1.3 * (dot(sdNb, sdL) - dot(sdN, sdL)) * sdDay, 0.55, 1.45);` : ""}
}
#endif
`;

/** Shader pieces for one material; installLodCoverage composes them with its own coverage code. */
export function surfaceDetailChunks(mode: SurfaceDetailMode) {
  return { glslDeclaration: GLSL_DECLARATION, glslMainStart: glslMainStart(mode), wgslDeclaration: WGSL_DECLARATION, wgslMainStart: wgslMainStart(mode) };
}

/** Lit material: detail tints the albedo and bends the normal so the real lights see the relief. */
export const LIT_DIFFUSE_GLSL = `
uniform vec3 material_diffuse;
void getAlbedo() {
  dAlbedo = material_diffuse.rgb;
  #ifdef STD_DIFFUSE_VERTEX
    dAlbedo *= saturate(vVertexColor.rgb);
  #endif
  dAlbedo *= sdMul;
}
`;
export const LIT_DIFFUSE_WGSL = `
uniform material_diffuse: vec3f;
fn getAlbedo() {
  dAlbedo = uniform.material_diffuse.rgb;
  #ifdef STD_DIFFUSE_VERTEX
    dAlbedo = dAlbedo * saturate(vVertexColor.rgb);
  #endif
  dAlbedo = dAlbedo * sdMul;
}
`;
export const LIT_NORMAL_GLSL = `
void getNormal() { dNormalW = normalize(dVertexNormalW - sdGrad); }
`;
export const LIT_NORMAL_WGSL = `
fn getNormal() { dNormalW = normalize(dVertexNormalW - sdGrad); }
`;
