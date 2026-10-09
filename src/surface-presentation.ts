import * as pc from "playcanvas";
import { PLANET_RADIUS } from "./planet.ts";

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
  const t = Math.max(0, Math.min(1, (Math.log(halfHeight) - Math.log(70)) / Math.log(900 / 70)));
  return 1 - t * t * (3 - 2 * t);
}

/** Complementary pixel coverage avoids translucent overlapping skirts/duplicate props. */
export function installLodCoverage(material: pc.StandardMaterial) {
  material.setParameter("lodCoverage", 1);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("litUserDeclarationPS", "uniform float lodCoverage;");
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("litUserMainStartPS", `
    float pixelNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    if ((lodCoverage >= 0.0 && pixelNoise >= lodCoverage) ||
        (lodCoverage < 0.0 && pixelNoise < -lodCoverage)) discard;
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("litUserDeclarationPS", "uniform lodCoverage: f32;");
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("litUserMainStartPS", `
    let pixelNoise = fract(52.9829189 * fract(dot(floor(input.position.xy), vec2f(0.06711056, 0.00583715))));
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
  // Wide patches use one projection at shared canonical UV coordinates instead
  // of independently rotated tangent-plane approximations. Fine ENU meshes keep
  // their patch-relative Float32 precision; the transition is continuous.
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("transformVS", `
    uniform vec2 surfaceOrigin;
    uniform vec3 surfaceOffset;
    uniform float surfaceProjectionWeight;
    vec4 getPosition() {
      dModelMatrix = getModelMatrix();
      vec3 old = (dModelMatrix * vec4(vertex_position.xyz, 1.0)).xyz;
      float lat = (0.5 - vertex_texCoord0.y) * 3.141592653589793;
      float delta = (vertex_texCoord0.x - 0.5) * 6.283185307179586 - surfaceOrigin.x;
      float radius = ${PLANET_RADIUS};
      vec3 exact = vec3(radius * cos(lat) * sin(delta), vertex_position.y,
        -radius * (cos(surfaceOrigin.y) * sin(lat) - sin(surfaceOrigin.y) * cos(lat) * cos(delta))) + surfaceOffset;
      dPositionW = mix(old, exact, surfaceProjectionWeight);
      return matrix_viewProjection * vec4(dPositionW, 1.0);
    }
    vec3 getWorldPosition() { return dPositionW; }
  `);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("transformVS", `
    uniform surfaceOrigin: vec2f;
    uniform surfaceOffset: vec3f;
    uniform surfaceProjectionWeight: f32;
    fn getPosition() -> vec4f {
      dModelMatrix = getModelMatrix();
      let old = (dModelMatrix * vec4f(vertex_position.xyz, 1.0)).xyz;
      let lat = (0.5 - vertex_texCoord0.y) * 3.141592653589793;
      let delta = (vertex_texCoord0.x - 0.5) * 6.283185307179586 - uniform.surfaceOrigin.x;
      let radius = ${PLANET_RADIUS};
      let exact = vec3f(radius * cos(lat) * sin(delta), vertex_position.y,
        -radius * (cos(uniform.surfaceOrigin.y) * sin(lat) - sin(uniform.surfaceOrigin.y) * cos(lat) * cos(delta))) + uniform.surfaceOffset;
      dPositionW = mix(old, exact, uniform.surfaceProjectionWeight);
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
