#!/usr/bin/env python3
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

def replace(path, old, new, count=1):
    text = read(path)
    if text.count(old) < count:
        raise SystemExit(f"expected text not found in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, count))

def sub(path, pattern, repl, count=1):
    text = read(path)
    out, n = re.subn(pattern, repl, text, count=count, flags=re.S)
    if n != count:
        raise SystemExit(f"pattern matched {n}, expected {count} in {path}: {pattern[:100]!r}")
    write(path, out)

# Canonical physical scale remains distinct from the transitional S001 source-coordinate domain.
planet = read("src/planet.ts")
marker = "export const POLE_DISTANCE = PLANET_CIRCUMFERENCE / 4;\n"
insert = marker + """
/** Binding S002 physical planet scale. The S001 source coordinate domain is intentionally
 * kept separate until WP-S002-004-002 performs the runtime world rescale. */
export const CANONICAL_PLANET_RADIUS = 637_100;
export const CANONICAL_PLANET_CIRCUMFERENCE = 2 * Math.PI * CANONICAL_PLANET_RADIUS;
export const CANONICAL_PLANET_DIAMETER = 2 * CANONICAL_PLANET_RADIUS;
/** Physical metres represented by one transitional S001 source-coordinate metre. */
export const CANONICAL_METRES_PER_SOURCE_METRE = CANONICAL_PLANET_CIRCUMFERENCE / WORLD_SIZE;
export const canonicalFootprintForHalfHeight = (halfHeight: number) =>
  halfHeight * 2 * CANONICAL_METRES_PER_SOURCE_METRE;
export const halfHeightForCanonicalFootprint = (footprint: number) =>
  footprint / (2 * CANONICAL_METRES_PER_SOURCE_METRE);
"""
if "CANONICAL_PLANET_RADIUS" not in planet:
    planet = planet.replace(marker, insert)
write("src/planet.ts", planet)

write("src/handoff.ts", '''import {
  canonicalFootprintForHalfHeight,
  halfHeightForCanonicalFootprint,
} from "./planet.ts";

export const HANDOFF_LOCAL_FOOTPRINT = 127_420;
export const HANDOFF_GLOBE_FOOTPRINT = 318_550;
export const HANDOFF_LOCAL_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_LOCAL_FOOTPRINT);
export const HANDOFF_GLOBE_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_GLOBE_FOOTPRINT);
export const SCALE_LADDER = [10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Presentation-only globe blend derived solely from continuous zoom. */
export function projectionTransitionForHalfHeight(halfHeight: number): number {
  if (halfHeight <= HANDOFF_LOCAL_HALF_HEIGHT) return 0;
  if (halfHeight >= HANDOFF_GLOBE_HALF_HEIGHT) return 1;
  const a = Math.log(HANDOFF_LOCAL_HALF_HEIGHT);
  const b = Math.log(HANDOFF_GLOBE_HALF_HEIGHT);
  const t = Math.max(0, Math.min(1, (Math.log(halfHeight) - a) / (b - a)));
  return smoothstep(t);
}

/** Reversible easing: changing the target mid-transition simply changes direction. */
export function advanceProjectionTransition(current: number, target: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const factor = 1 - Math.exp(-dt / 0.16);
  const next = current + (target - current) * factor;
  return Math.abs(target - next) < 0.001 ? target : next;
}

export function scaleLabelForHalfHeight(halfHeight: number): string {
  const footprint = canonicalFootprintForHalfHeight(halfHeight);
  const diameter = 1_274_200;
  const denominator = Math.max(10, Math.min(10000, (footprint / diameter) * 10000));
  let best = SCALE_LADDER[0];
  for (const candidate of SCALE_LADDER)
    if (Math.abs(Math.log(candidate / denominator)) < Math.abs(Math.log(best / denominator))) best = candidate;
  return `1/${best}`;
}
''')

# Make the globe camera use the same fixed oblique viewing angle as the flat map, while
# keeping the canonical focus point at the same screen pixel.
replace("src/globe-view.ts", 'private readonly point = new pc.Vec3();', 'private readonly point = new pc.Vec3();\n  private readonly viewAxis = new pc.Vec3(0, 1, 0);\n  private readonly shade: pc.Entity;')
sub("src/globe-view.ts", r'function fanMesh\(device: pc\.GraphicsDevice\): pc\.Mesh \{.*?\n\}\n\n/\*\* Radial shading profile', '''function fanMesh(device: pc.GraphicsDevice): pc.Mesh {
  // Screen-facing XY disc; GlobeView.placeCamera gives it the camera rotation.
  const positions = new Float32Array((SHADE_SEGMENTS + 1) * 3),
    normals = new Float32Array((SHADE_SEGMENTS + 1) * 3),
    uvs = new Float32Array((SHADE_SEGMENTS + 1) * 2),
    indices = new Uint16Array(SHADE_SEGMENTS * 3);
  normals[2] = 1;
  uvs[1] = 0.5;
  for (let i = 0; i < SHADE_SEGMENTS; i++) {
    const angle = (i / SHADE_SEGMENTS) * 2 * Math.PI,
      v = i + 1;
    positions[v * 3] = Math.cos(angle);
    positions[v * 3 + 1] = Math.sin(angle);
    normals[v * 3 + 2] = 1;
    uvs[v * 2] = 1;
    uvs[v * 2 + 1] = 0.5;
    indices[i * 3] = 0;
    indices[i * 3 + 1] = ((i + 1) % SHADE_SEGMENTS) + 1;
    indices[i * 3 + 2] = v;
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Radial shading profile''')
replace("src/globe-view.ts", 'const shade = new pc.Entity("Globe shading");', 'const shade = (this.shade = new pc.Entity("Globe shading"));')
replace("src/globe-view.ts", '''    shade.setLocalScale(reach, 1, reach);
    shade.setLocalPosition(0, PLANET_RADIUS * 1.25, 0);''', '''    shade.setLocalScale(reach, reach, 1);
    shade.setLocalPosition(0, PLANET_RADIUS * 1.25, 0);''')
replace("src/globe-view.ts", '''  setVisible(visible: boolean) {
    this.root.enabled = visible;
  }
''', '''  setBlend(alpha: number) {
    const value = Math.max(0, Math.min(1, alpha));
    this.shade.enabled = value > 0.001;
    this.shadeMaterial.opacity = value;
    this.shadeMaterial.update();
  }

  setVisible(visible: boolean) {
    this.root.enabled = visible;
  }
''')
sub("src/globe-view.ts", r'  /\*\* Put an orthographic camera.*?\n  placeCamera\(camera: pc\.Entity, halfHeight: number\) \{.*?\n  \}\n', '''  /** Use the same fixed 60°-above-ground camera angle as the flat presentation.
   * The focused surface point remains at the screen centre at every zoom. */
  placeCamera(camera: pc.Entity, halfHeight: number, yaw: number) {
    const lens = camera.camera!,
      distance = halfHeight * 2.2 + 200,
      target = new pc.Vec3(0, PLANET_RADIUS, 0),
      position = new pc.Vec3(
        Math.sin(yaw) * distance * 0.5,
        PLANET_RADIUS + distance * Math.sin(Math.PI / 3),
        Math.cos(yaw) * distance * 0.5,
      );
    camera.setPosition(position);
    camera.lookAt(target);
    lens.orthoHeight = halfHeight;
    lens.farClip = Math.max(lens.farClip, PLANET_RADIUS * 6 + distance);
    this.viewAxis.copy(position).sub(target).normalize();
    // The radial halo is a camera-facing overlay centred on the projected sphere disc.
    const centreToCamera = position.clone().normalize();
    this.shade.setPosition(centreToCamera.mulScalar(PLANET_RADIUS * 1.25));
    this.shade.setRotation(camera.getRotation());
    lens.onAppPrerender();
  }
''')
replace("src/globe-view.ts", '    return out.y > 0;\n  }', '''    return out.dot(this.viewAxis) > 0;
  }

  frontness(point: pc.Vec3): number {
    return point.dot(this.viewAxis) / PLANET_RADIUS;
  }''')

# Main runtime: canonical-anchor transition, destination readiness gates, reversible blend,
# focus-preserving tangent frame, and telemetry.
main = read("src/main.ts")
main = main.replace('''import {
  PLANET_RADIUS,
  POLE_DISTANCE,
  flatToLonLat,
  lonLatToFlat,
  wrapX,
} from "./planet.ts";
''', '''import {
  PLANET_RADIUS,
  POLE_DISTANCE,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  canonicalFootprintForHalfHeight,
  flatToLonLat,
  lonLatToFlat,
  wrapX,
} from "./planet.ts";
import {
  HANDOFF_LOCAL_HALF_HEIGHT,
  HANDOFF_GLOBE_HALF_HEIGHT,
  projectionTransitionForHalfHeight,
  advanceProjectionTransition,
  scaleLabelForHalfHeight,
} from "./handoff.ts";
''')
main = re.sub(r'/\*\* The Realm level:.*?\*/\nconst GLOBE_FROM = PLANET_RADIUS \* 0\.9;', '/** Canonical 1/2500 globe-dominant anchor, converted through the temporary S001 presentation adapter. */\nconst GLOBE_FROM = HANDOFF_GLOBE_HALF_HEIGHT;', main, count=1, flags=re.S)
main = main.replace('const globePoint = new pc.Vec3();', '''const globePoint = new pc.Vec3(), flatLabelPoint = new pc.Vec3();
let projectionTransition = 0,
  desiredProjectionTransition = 0,
  handoffActive = false,
  handoffDirection = "none",
  handoffStarted = 0,
  handoffDurationMs = 0,
  slowFrameCount = 0,
  droppedFrameCount = 0,
  lastFlatOpacity = -1;
let worldMaterial: pc.StandardMaterial | undefined;''')
pattern = r'/\*\* Switch between the flat map and the Realm globe\. Presentation only\. \*/\nfunction setPresentation\(showGlobe: boolean\) \{.*?\n\}\nfunction updateCamera\(\) \{.*?\n\}\n'
replacement = '''function flatCoverageReady() {
  return !selectionDirty && wanted.length > 0 && wanted.every((tile) => tileCache.has(tile.key));
}
function applyPresentation() {
  if (!globe) return;
  desiredProjectionTransition = projectionTransitionForHalfHeight(view.halfHeight);
  const active = projectionTransition > 0.001,
    fullGlobe = projectionTransition >= 0.999,
    targetY = Math.max(0, heightAt(view.x, view.z));
  globeShown = fullGlobe;
  document.body.classList.toggle("globe-mode", fullGlobe);
  document.body.classList.toggle("handoff-mode", active && !fullGlobe);
  if (active) {
    flatRoot.setLocalPosition(-view.x, PLANET_RADIUS - targetY, -view.z);
    flatRoot.enabled = !fullGlobe;
    const { lon, lat } = flatToLonLat(view.x, view.z);
    globe.orient(lon, lat, 0);
    globe.setVisible(true);
    globe.setBlend(projectionTransition);
    globe.placeCamera(camera, view.halfHeight, view.yaw);
    $("cell-panel").hidden = true;
  } else {
    flatRoot.setLocalPosition(0, 0, 0);
    flatRoot.enabled = true;
    globe.setVisible(false);
    globe.setBlend(0);
    const distance = view.halfHeight * 2.2 + 200;
    camera.setPosition(
      view.x + Math.sin(view.yaw) * distance * 0.5,
      targetY + distance * Math.sin(Math.PI / 3),
      view.z + Math.cos(view.yaw) * distance * 0.5,
    );
    camera.lookAt(view.x, targetY, view.z);
    camera.camera!.orthoHeight = view.halfHeight;
    camera.camera!.farClip = 600000;
  }
  if (worldMaterial) {
    const opacity = 1 - projectionTransition;
    if (Math.abs(opacity - lastFlatOpacity) > 0.004 || opacity === 0 || opacity === 1) {
      lastFlatOpacity = opacity;
      worldMaterial.opacity = opacity;
      worldMaterial.blendType = opacity < 0.999 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
      worldMaterial.depthWrite = opacity >= 0.999;
      worldMaterial.update();
    }
  }
  const backdrop = globe.backdropColor, t = projectionTransition;
  camera.camera!.clearColor.set(
    FLAT_BACKDROP.r + (backdrop.r - FLAT_BACKDROP.r) * t,
    FLAT_BACKDROP.g + (backdrop.g - FLAT_BACKDROP.g) * t,
    FLAT_BACKDROP.b + (backdrop.b - FLAT_BACKDROP.b) * t,
    1,
  );
  selectionDirty = true;
}
function updateCamera() {
  desiredProjectionTransition = projectionTransitionForHalfHeight(view.halfHeight);
  if (desiredProjectionTransition > 0) prepareGlobe();
  applyPresentation();
}
function updateHandoff(dt: number) {
  desiredProjectionTransition = projectionTransitionForHalfHeight(view.halfHeight);
  if (desiredProjectionTransition > 0) prepareGlobe();
  const flatReady = flatCoverageReady(), globeReady = globePass > 0;
  let target = desiredProjectionTransition;
  if (target > projectionTransition && !globeReady) target = projectionTransition;
  if (target < projectionTransition && !flatReady) target = projectionTransition;
  const canMove = Math.abs(target - projectionTransition) > 0.001;
  if (canMove && !handoffActive) {
    handoffActive = true;
    handoffDirection = target > projectionTransition ? "to-globe" : "to-flat";
    handoffStarted = performance.now();
  } else if (canMove) {
    handoffDirection = target > projectionTransition ? "to-globe" : "to-flat";
  }
  projectionTransition = advanceProjectionTransition(projectionTransition, target, dt);
  if (
    handoffActive &&
    Math.abs(projectionTransition - desiredProjectionTransition) <= 0.001 &&
    (desiredProjectionTransition === 0 ? flatReady : globeReady)
  ) {
    handoffDurationMs = performance.now() - handoffStarted;
    handoffActive = false;
    handoffDirection = "none";
  }
  applyPresentation();
}
'''
main, n = re.subn(pattern, replacement, main, count=1, flags=re.S)
if n != 1: raise SystemExit("main presentation functions not found")
main = main.replace('if (view.halfHeight >= GLOBE_FROM) {', 'if (view.halfHeight >= HANDOFF_LOCAL_HALF_HEIGHT) {', 1)
main = main.replace('if (!moved && pointers.size === 1 && !globeShown)', 'if (!moved && pointers.size === 1 && projectionTransition <= 0.001)')
main = main.replace('canvas.setPointerCapture(event.pointerId);', 'try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic browser tests */ }')
main = main.replace('if (globeShown)\n      globeFit', 'if (projectionTransition > 0.001)\n      globeFit')
main = main.replace('''  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1, 1, 1);''', '''  const material = (worldMaterial = new pc.StandardMaterial());
  material.diffuse = new pc.Color(1, 1, 1);''')
main = main.replace('''    for (const actor of actors)
      if (actor.enabled) {
        actor.setRotation(camera.getRotation());
        actor.rotateLocal(90, 0, 0);
      }
    sun.light!.castShadows = view.halfHeight < 500;
    const destinations =
      globeShown || view.halfHeight > 25000''', '''    for (const actor of actors)
      if (actor.enabled) {
        actor.setRotation(camera.getRotation());
        actor.rotateLocal(90, 0, 0);
      }
    if (dt > 1 / 30) slowFrameCount++;
    droppedFrameCount += Math.max(0, Math.floor(dt / (1 / 60)) - 1);
    updateHandoff(dt);
    sun.light!.castShadows = view.halfHeight < 500 && projectionTransition <= 0.001;
    const destinations =
      projectionTransition > 0.001 || view.halfHeight > 25000''')
label_pattern = r'''      let screen: pc\.Vec3;\n      if \(globeShown\) \{.*?\n      \} else \{\n        if \(\n          Math\.abs\(place\.x - view\.x\) > view\.halfHeight \* view\.aspect \* 1\.4 \|\|\n          Math\.abs\(place\.z - view\.z\) > view\.halfHeight \* 1\.5\n        \)\n          continue;\n        screen = camera\.camera!\.worldToScreen\(\n          new pc\.Vec3\(\n            place\.x,\n            Math\.max\(0, heightAt\(place\.x, place\.z\)\) \+ 2,\n            place\.z,\n          \),\n        \);\n      \}'''
label_repl = '''      let screen: pc.Vec3;
      if (projectionTransition > 0.001) {
        const focusY = Math.max(0, heightAt(view.x, view.z));
        flatLabelPoint.set(
          place.x - view.x,
          PLANET_RADIUS + Math.max(0, heightAt(place.x, place.z)) + 2 - focusY,
          place.z - view.z,
        );
        const flatScreen = camera.camera!.worldToScreen(flatLabelPoint);
        const { lon, lat } = flatToLonLat(place.x, place.z),
          onFront = globe!.worldPoint(lon, lat, globePoint);
        if ((!onFront || globe!.frontness(globePoint) < 0.08) && projectionTransition > 0.55)
          continue;
        if (onFront) {
          const globeScreen = camera.camera!.worldToScreen(globePoint), t = projectionTransition;
          screen = new pc.Vec3(
            flatScreen.x + (globeScreen.x - flatScreen.x) * t,
            flatScreen.y + (globeScreen.y - flatScreen.y) * t,
            flatScreen.z + (globeScreen.z - flatScreen.z) * t,
          );
        } else screen = flatScreen;
      } else {
        if (
          Math.abs(place.x - view.x) > view.halfHeight * view.aspect * 1.4 ||
          Math.abs(place.z - view.z) > view.halfHeight * 1.5
        )
          continue;
        screen = camera.camera!.worldToScreen(
          new pc.Vec3(
            place.x,
            Math.max(0, heightAt(place.x, place.z)) + 2,
            place.z,
          ),
        );
      }'''
main, n = re.subn(label_pattern, label_repl, main, count=1, flags=re.S)
if n != 1: raise SystemExit("label projection block not found")
main = main.replace('''  $("tile-status").textContent = globeShown
    ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
    : `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`;''', '''  $("tile-status").textContent = projectionTransition >= 0.999
    ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
    : projectionTransition > 0.001
      ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${pending.size ? "preparing terrain" : "ready"}`
      : `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`;''')
main = main.replace('''      planet: { radius: PLANET_RADIUS, flatToLonLat, lonLatToFlat },
      renderer: rendererState,''', '''      planet: {
        radius: CANONICAL_PLANET_RADIUS,
        circumference: CANONICAL_PLANET_CIRCUMFERENCE,
        renderRadius: PLANET_RADIUS,
        flatToLonLat,
        lonLatToFlat,
      },
      handoff: {
        localHalfHeight: HANDOFF_LOCAL_HALF_HEIGHT,
        globeHalfHeight: HANDOFF_GLOBE_HALF_HEIGHT,
      },
      setHalfHeight(height: number) {
        navigate(view.x, view.z, height);
      },
      renderer: rendererState,''')
main = main.replace('''          presentation: globeShown ? "globe" : "flat",
          globe: {''', '''          presentation:
            projectionTransition <= 0.001
              ? "flat"
              : projectionTransition >= 0.999
                ? "globe"
                : "transition",
          scaleLabel: scaleLabelForHalfHeight(view.halfHeight),
          canonicalFootprintM: canonicalFootprintForHalfHeight(view.halfHeight),
          handoff: {
            projectionTransition,
            desiredTransition: desiredProjectionTransition,
            active: handoffActive,
            direction: handoffDirection,
            durationMs: handoffActive ? performance.now() - handoffStarted : handoffDurationMs,
            destinationReady:
              desiredProjectionTransition >= projectionTransition ? globePass > 0 : flatCoverageReady(),
            outstandingGeneration: pending.size + uploads.length + inFlight,
            slowFrames: slowFrameCount,
            droppedFrames: droppedFrameCount,
          },
          globe: {''')
main = main.replace('''          settled:
            (!globeShown || globePass >= GLOBE_PASSES.length) &&
            !selectionDirty &&''', '''          settled:
            Math.abs(projectionTransition - desiredProjectionTransition) <= 0.001 &&
            (desiredProjectionTransition <= 0.001 || globePass > 0) &&
            (!globeShown || globePass >= GLOBE_PASSES.length) &&
            !selectionDirty &&''')
write("src/main.ts", main)

# Unit coverage for the canonical scale adapter and reversible transition.
write("tests/handoff.test.ts", '''import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDOFF_LOCAL_FOOTPRINT,
  HANDOFF_GLOBE_FOOTPRINT,
  HANDOFF_LOCAL_HALF_HEIGHT,
  HANDOFF_GLOBE_HALF_HEIGHT,
  projectionTransitionForHalfHeight,
  advanceProjectionTransition,
  scaleLabelForHalfHeight,
} from "../src/handoff.ts";
import {
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  canonicalFootprintForHalfHeight,
} from "../src/planet.ts";

test("handoff anchors are derived from the canonical 637.1 km planet", () => {
  assert.equal(CANONICAL_PLANET_RADIUS, 637100);
  assert.ok(Math.abs(CANONICAL_PLANET_CIRCUMFERENCE - 4003017.36) < 0.01);
  assert.ok(Math.abs(canonicalFootprintForHalfHeight(HANDOFF_LOCAL_HALF_HEIGHT) - HANDOFF_LOCAL_FOOTPRINT) < 1e-6);
  assert.ok(Math.abs(canonicalFootprintForHalfHeight(HANDOFF_GLOBE_HALF_HEIGHT) - HANDOFF_GLOBE_FOOTPRINT) < 1e-6);
  assert.equal(projectionTransitionForHalfHeight(HANDOFF_LOCAL_HALF_HEIGHT), 0);
  assert.equal(projectionTransitionForHalfHeight(HANDOFF_GLOBE_HALF_HEIGHT), 1);
});

test("projection blend is monotonic and reverses without resetting", () => {
  const mid = Math.sqrt(HANDOFF_LOCAL_HALF_HEIGHT * HANDOFF_GLOBE_HALF_HEIGHT);
  const target = projectionTransitionForHalfHeight(mid);
  assert.ok(target > 0 && target < 1);
  let value = 0;
  for (let i = 0; i < 20; i++) value = advanceProjectionTransition(value, target, 1 / 60);
  assert.ok(value > 0 && value < target);
  const before = value;
  for (let i = 0; i < 10; i++) value = advanceProjectionTransition(value, 0, 1 / 60);
  assert.ok(value < before && value >= 0);
});

test("player-facing labels use the canonical slash scale form", () => {
  for (const halfHeight of [HANDOFF_LOCAL_HALF_HEIGHT, HANDOFF_GLOBE_HALF_HEIGHT, 97])
    assert.match(scaleLabelForHalfHeight(halfHeight), /^1\\/(10|20|50|100|250|500|1000|2500|5000|10000)$/);
});
''')

pkg = json.loads(read("package.json"))
pkg["scripts"]["test"] = "node --experimental-strip-types --test tests/world.test.ts tests/renderer.test.ts tests/planet.test.ts tests/globe.test.ts tests/handoff.test.ts"
write("package.json", json.dumps(pkg, indent=2) + "\n")

# Existing planet tests keep source-domain round trips but now also assert canonical authority.
planet_test = read("tests/planet.test.ts")
planet_test = planet_test.replace('''  PLANET_CIRCUMFERENCE,
  PLANET_RADIUS,
  POLE_DISTANCE,''', '''  PLANET_CIRCUMFERENCE,
  PLANET_RADIUS,
  POLE_DISTANCE,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,''')
planet_test = planet_test.replace('''test("the planet is the flat world: one turn east-west, poles a quarter turn from the equator", () => {
  assert.equal(PLANET_CIRCUMFERENCE, WORLD_SIZE);''', '''test("the transitional source domain wraps exactly while canonical physical scale is explicit", () => {
  assert.equal(CANONICAL_PLANET_RADIUS, 637100);
  assert.ok(Math.abs(CANONICAL_PLANET_CIRCUMFERENCE - 4003017.36) < 0.01);
  assert.equal(PLANET_CIRCUMFERENCE, WORLD_SIZE);''')
write("tests/planet.test.ts", planet_test)

# Browser acceptance: exact focus/yaw through button, wheel and synthetic two-pointer pinch;
# reverse while the blend is in progress and check the three required viewports.
world_spec = read("tests/browser/world.spec.js")
world_spec += r'''

test("pure zoom handoff preserves focus through buttons wheel pinch and reversal", async ({ page }) => {
  test.setTimeout(420000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready);
    const anchors = await page.evaluate(() => window.advisorWorld.handoff);
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 0.94);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));
    await page.locator("#zoom-out").click();
    await page.waitForFunction(() => window.advisorWorld.state.handoff.projectionTransition > 0.01);
    let state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    await page.locator("#world").hover();
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(60);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    // Two-pointer pinch: synthetic pointer events exercise the same production handler.
    await page.evaluate(() => {
      const c = document.getElementById("world"), r = c.getBoundingClientRect();
      const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: id, pointerType: "touch", clientX: x, clientY: y,
        buttons: type === "pointerup" ? 0 : 1,
      }));
      const cy = r.top + r.height * 0.55, cx = r.left + r.width * 0.5;
      fire("pointerdown", 31, cx - 45, cy); fire("pointerdown", 32, cx + 45, cy);
      fire("pointermove", 31, cx - 70, cy); fire("pointermove", 32, cx + 70, cy);
      fire("pointerup", 31, cx - 70, cy); fire("pointerup", 32, cx + 70, cy);
    });
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    // Reverse mid-transition and then traverse both settled endpoints.
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(50);
    expect((await page.evaluate(() => window.advisorWorld.state.handoff)).direction).not.toBe("to-globe");
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.globeHalfHeight * 1.06);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "globe" && window.advisorWorld.state.settled);
    const globe = await page.evaluate(() => window.advisorWorld.state);
    expect(globe.view.x).toBe(focus.x);
    expect(globe.view.z).toBe(focus.z);
    expect(globe.view.yaw).toBe(focus.yaw);
    expect(globe.handoff.destinationReady).toBeTruthy();
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 0.94);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "flat" && window.advisorWorld.state.settled);
    const flat = await page.evaluate(() => window.advisorWorld.state);
    expect(flat.view.x).toBe(focus.x);
    expect(flat.view.z).toBe(focus.z);
    expect(flat.view.yaw).toBe(focus.yaw);
    await expect(page.locator("#error")).toBeHidden();
  }
  expect(errors).toEqual([]);
});
'''
write("tests/browser/world.spec.js", world_spec)

renderer_spec = read("tests/browser/renderer.spec.js")
renderer_spec += r'''

test("WebGL2 fallback keeps the same focus through the handoff and pinch", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  const anchors = await page.evaluate(() => window.advisorWorld.handoff);
  await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 1.15);
  await page.waitForFunction(() => window.advisorWorld.state.handoff.projectionTransition > 0.01);
  const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));
  await page.locator("#zoom-out").click();
  await page.locator("#world").hover();
  await page.mouse.wheel(0, 100);
  await page.evaluate(() => {
    const c = document.getElementById("world"), r = c.getBoundingClientRect();
    const fire = (type, id, x) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: id, pointerType: "touch", clientX: x,
      clientY: r.top + r.height * 0.55, buttons: type === "pointerup" ? 0 : 1,
    }));
    const cx = r.left + r.width / 2;
    fire("pointerdown", 41, cx - 35); fire("pointerdown", 42, cx + 35);
    fire("pointermove", 41, cx - 55); fire("pointermove", 42, cx + 55);
    fire("pointerup", 41, cx - 55); fire("pointerup", 42, cx + 55);
  });
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => window.advisorWorld.state);
  expect(state.view.x).toBe(focus.x);
  expect(state.view.z).toBe(focus.z);
  expect(state.view.yaw).toBe(focus.yaw);
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("webgl2");
  expect(errors).toEqual([]);
});
'''
write("tests/browser/renderer.spec.js", renderer_spec)

# Screenshot tool: named fixed-focus handoff sequence with intermediate frames in both directions.
shot = read("tools/screenshot_tool.py")
shot = shot.replace('''    "realm-tiles": "click:#overview;check:#grid",
    "cell":''', '''    "realm-tiles": "click:#overview;check:#grid",
    "handoff": (
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.18);settle;shot:in-25;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:in-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.88);settle;shot:in-80;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*1.04);settle;shot:globe;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.86);settle;shot:out-80;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:out-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.16);settle;shot:out-25;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat-return"
    ),
    "cell":''')
shot = shot.replace('''    cached: state.cached ?? null, pending: state.pending ?? null,
    detailName:''', '''    cached: state.cached ?? null, pending: state.pending ?? null,
    handoff: state.handoff ?? null, scaleLabel: state.scaleLabel ?? null,
    canonicalFootprintM: state.canonicalFootprintM ?? null,
    detailName:''')
write("tools/screenshot_tool.py", shot)

# Add changelog/suggestion entries; ROADMAP is not completed until deployed later.
with (ROOT / "docs/changelog.txt").open("a") as f:
    f.write("2026-10-07 19:50 Europe/Istanbul — WP-S002-002-002 implementation: Added a canonical-scale-derived, focus-preserving reversible globe/local handoff with destination-readiness gating, transition telemetry, fixed camera heading/angle, label-anchor interpolation and browser coverage for wheel, pinch and zoom buttons. MIXED visual evidence is captured by the screenshot tool during CI before completion.\n")
with (ROOT / "docs/suggest_log.txt").open("a") as f:
    f.write("2026-10-07 19:50 Europe/Istanbul — WP-S002-002-002, phase 1: After the later canonical world-rescale package removes the S001 source-coordinate adapter, simplify the handoff conversion so render metres and canonical metres are identical. Retain the reversible transition fixtures and intermediate-frame screenshots as regressions. Suggestion only; not implemented here.\n")

# Restore the normal deployment workflow in the implementation commit and remove this one-shot helper.
write(".github/workflows/pages.yml", '''name: Build and deploy world atlas
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: github-pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: xvfb-run -a npm run test:webgpu
      - run: xvfb-run -a npx playwright test --config playwright.fallback.config.js
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webgpu-evidence
          path: test-results/
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
''')
Path(__file__).unlink()
