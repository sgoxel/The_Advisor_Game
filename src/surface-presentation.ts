import * as pc from "playcanvas";
import { PLANET_RADIUS } from "./planet.ts";
import { LON_SEGMENTS, LAT_SEGMENTS } from "./globe-view.ts";

/** Presentation only; never used to choose canonical terrain or feature identity. */
export const LOD_BLEND_SECONDS = 0.24;
export const SURFACE_PRESENTATION = Object.freeze({
  vertexColorGamma: true,
  exposure: 1,
  fog: false,
  tonemap: false,
  relief: 0,
});
export function localDetailWeight(halfHeight: number): number {
  // Keep final-surface vertex detail dominant through Province scale. The old
  // 70..900 fade handed most of a 1/250 view to the coarse atlas texture, making
  // rivers/lakes/mountains read as blurred colour blobs even though refined tiles
  // were already present. This remains a continuous presentation-only blend.
  const t = Math.max(
    0,
    Math.min(1, (Math.log(halfHeight) - Math.log(220)) / Math.log(3200 / 220)),
  );
  return 1 - t * t * (3 - 2 * t);
}

/** Complementary pixel coverage avoids translucent overlapping skirts/duplicate props. */
export function installLodCoverage(material: pc.StandardMaterial) {
  material.setParameter("lodCoverage", 1);
  material.setParameter("flatCoverage", 1);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("litUserDeclarationPS", "uniform float lodCoverage; uniform float flatCoverage;");
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("litUserMainStartPS", `
    float pixelNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    if (pixelNoise >= flatCoverage) discard;
    if ((lodCoverage >= 0.0 && pixelNoise >= lodCoverage) ||
        (lodCoverage < 0.0 && pixelNoise < -lodCoverage)) discard;
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("litUserDeclarationPS", "uniform lodCoverage: f32; uniform flatCoverage: f32;");
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("litUserMainStartPS", `
    let pixelNoise = fract(52.9829189 * fract(dot(floor(input.position.xy), vec2f(0.06711056, 0.00583715))));
    if (pixelNoise >= uniform.flatCoverage) { discard; }
    if ((uniform.lodCoverage >= 0.0 && pixelNoise >= uniform.lodCoverage) ||
        (uniform.lodCoverage < 0.0 && pixelNoise < -uniform.lodCoverage)) { discard; }
  `);
}

/** Both sources are decoded display RGB. Detail is interpolated in linear light. */
export function createTerrainMaterial(surface: pc.Texture): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.name = "Canonical surface";
  material.diffuse.set(0, 0, 0);
  material.emissive.set(1, 1, 1);
  material.emissiveVertexColor = true;
  material.emissiveMap = surface;
  (material as pc.StandardMaterial & { vertexColorGamma: boolean }).vertexColorGamma = true;
  material.useLighting = false;
  material.useSkybox = false;
  material.useFog = false;
  material.useTonemap = false;
  material.cull = pc.CULLFACE_NONE;
  material.setParameter("surfaceDetailWeight", 1);
  material.setParameter("surfaceProjectionWeight", 0);
  material.setParameter("surfaceOrigin", [0, 0]);
  material.setParameter("surfaceOffset", [0, 0, 0]);
  material.setParameter("surfaceFocus", [0, 0]);
  material.setParameter("surfaceTransition", 0);
  // Wide patches use one projection at shared canonical UV coordinates instead
  // of independently rotated tangent-plane approximations. Fine ENU meshes keep
  // their patch-relative Float32 precision; the transition is continuous.
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("transformVS", `
    uniform vec2 surfaceOrigin;
    uniform vec3 surfaceOffset;
    uniform float surfaceProjectionWeight;
    uniform vec2 surfaceFocus;
    uniform float surfaceTransition;
    vec3 sphereVertex(vec2 uv) {
      float lat = (0.5 - uv.y) * 3.141592653589793;
      float lon = (uv.x - 0.5) * 6.283185307179586;
      return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    }
    vec3 sphereSurface(vec2 uv) {
      vec2 grid = uv * vec2(${LON_SEGMENTS}.0, ${LAT_SEGMENTS}.0), cell = floor(grid), f = fract(grid);
      vec2 a = cell / vec2(${LON_SEGMENTS}.0, ${LAT_SEGMENTS}.0), step = vec2(1.0/${LON_SEGMENTS}.0, 1.0/${LAT_SEGMENTS}.0);
      vec3 va = sphereVertex(a), vb = sphereVertex(a + vec2(step.x,0.0));
      vec3 vc = sphereVertex(a + vec2(0.0,step.y)), vd = sphereVertex(a + step);
      return f.x + f.y <= 1.0 ? va*(1.0-f.x-f.y)+vb*f.x+vc*f.y : vb*(1.0-f.y)+vc*(1.0-f.x)+vd*(f.x+f.y-1.0);
    }
    vec4 getPosition() {
      dModelMatrix = getModelMatrix();
      vec3 old = (dModelMatrix * vec4(vertex_position.xyz, 1.0)).xyz;
      float lat = (0.5 - vertex_texCoord0.y) * 3.141592653589793;
      float delta = (vertex_texCoord0.x - 0.5) * 6.283185307179586 - surfaceOrigin.x;
      float radius = ${PLANET_RADIUS};
      vec3 exact = vec3(radius * cos(lat) * sin(delta), vertex_position.y,
        -radius * (cos(surfaceOrigin.y) * sin(lat) - sin(surfaceOrigin.y) * cos(lat) * cos(delta))) + surfaceOffset;
      dPositionW = mix(old, exact, surfaceProjectionWeight);
      vec3 p = sphereSurface(vertex_texCoord0.xy) * radius;
      vec3 east = vec3(cos(surfaceFocus.x),0.0,-sin(surfaceFocus.x));
      vec3 up = vec3(cos(surfaceFocus.y)*sin(surfaceFocus.x),sin(surfaceFocus.y),cos(surfaceFocus.y)*cos(surfaceFocus.x));
      vec3 south = vec3(sin(surfaceFocus.y)*sin(surfaceFocus.x),-cos(surfaceFocus.y),sin(surfaceFocus.y)*cos(surfaceFocus.x));
      dPositionW = mix(dPositionW,vec3(dot(p,east),dot(p,up),dot(p,south)),surfaceTransition);
      return matrix_viewProjection * vec4(dPositionW, 1.0);
    }
    vec3 getWorldPosition() { return dPositionW; }
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("transformVS", `
    uniform surfaceOrigin: vec2f;
    uniform surfaceOffset: vec3f;
    uniform surfaceProjectionWeight: f32;
    uniform surfaceFocus: vec2f;
    uniform surfaceTransition: f32;
    fn sphereVertex(uv: vec2f) -> vec3f {
      let lat = (0.5 - uv.y) * 3.141592653589793;
      let lon = (uv.x - 0.5) * 6.283185307179586;
      return vec3f(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));
    }
    fn sphereSurface(uv: vec2f) -> vec3f {
      let grid = uv * vec2f(${LON_SEGMENTS}.0,${LAT_SEGMENTS}.0); let cell = floor(grid); let f = fract(grid);
      let a = cell/vec2f(${LON_SEGMENTS}.0,${LAT_SEGMENTS}.0); let step = vec2f(1.0/${LON_SEGMENTS}.0,1.0/${LAT_SEGMENTS}.0);
      let va = sphereVertex(a); let vb = sphereVertex(a+vec2f(step.x,0.0));
      let vc = sphereVertex(a+vec2f(0.0,step.y)); let vd = sphereVertex(a+step);
      if (f.x+f.y <= 1.0) { return va*(1.0-f.x-f.y)+vb*f.x+vc*f.y; }
      return vb*(1.0-f.y)+vc*(1.0-f.x)+vd*(f.x+f.y-1.0);
    }
    fn getPosition() -> vec4f {
      dModelMatrix = getModelMatrix();
      let old = (dModelMatrix * vec4f(vertex_position.xyz, 1.0)).xyz;
      let lat = (0.5 - vertex_texCoord0.y) * 3.141592653589793;
      let delta = (vertex_texCoord0.x - 0.5) * 6.283185307179586 - uniform.surfaceOrigin.x;
      let radius = ${PLANET_RADIUS};
      let exact = vec3f(radius * cos(lat) * sin(delta), vertex_position.y,
        -radius * (cos(uniform.surfaceOrigin.y) * sin(lat) - sin(uniform.surfaceOrigin.y) * cos(lat) * cos(delta))) + uniform.surfaceOffset;
      dPositionW = mix(old, exact, uniform.surfaceProjectionWeight);
      let p = sphereSurface(vertex_texCoord0.xy)*radius;
      let east = vec3f(cos(uniform.surfaceFocus.x),0.0,-sin(uniform.surfaceFocus.x));
      let up = vec3f(cos(uniform.surfaceFocus.y)*sin(uniform.surfaceFocus.x),sin(uniform.surfaceFocus.y),cos(uniform.surfaceFocus.y)*cos(uniform.surfaceFocus.x));
      let south = vec3f(sin(uniform.surfaceFocus.y)*sin(uniform.surfaceFocus.x),-cos(uniform.surfaceFocus.y),sin(uniform.surfaceFocus.y)*cos(uniform.surfaceFocus.x));
      dPositionW = mix(dPositionW,vec3f(dot(p,east),dot(p,up),dot(p,south)),uniform.surfaceTransition);
      return uniform.matrix_viewProjection * vec4f(dPositionW, 1.0);
    }
    fn getWorldPosition() -> vec3f { return dPositionW; }
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("emissivePS", `
    uniform float surfaceDetailWeight;
    void getEmission() {
      dEmission = vVertexColor.rgb;
      #ifdef STD_EMISSIVE_TEXTURE
        vec3 coarse = {STD_EMISSIVE_TEXTURE_DECODE}(texture2DBias({STD_EMISSIVE_TEXTURE_NAME}, {STD_EMISSIVE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_EMISSIVE_TEXTURE_CHANNEL};
        dEmission = mix(coarse, dEmission, surfaceDetailWeight);
      #endif
    }
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("emissivePS", `
    uniform surfaceDetailWeight: f32;
    fn getEmission() {
      dEmission = vVertexColor.rgb;
      #ifdef STD_EMISSIVE_TEXTURE
        let coarse = {STD_EMISSIVE_TEXTURE_DECODE}(textureSampleBias({STD_EMISSIVE_TEXTURE_NAME}, {STD_EMISSIVE_TEXTURE_NAME}Sampler, {STD_EMISSIVE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_EMISSIVE_TEXTURE_CHANNEL};
        dEmission = mix(coarse, dEmission, uniform.surfaceDetailWeight);
      #endif
    }
  `);
  installLodCoverage(material);
  material.update();
  return material;
}
