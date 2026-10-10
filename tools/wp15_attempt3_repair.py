from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"attempt3 anchor missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Cache immutable SEED-addressed phase values. This is output-preserving and avoids
# recomputing string digests at every terrain vertex/sample.
replace_once(
    "src/hydrology.ts",
    '''function sphericalNoise(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = addressed(`SURFACE-NOISE/${layer}`) * Math.PI * 2,
    a = Math.sin(p.lon * (7 + layer * 2.1) + p.lat * (5 + layer * 1.7) + phase),
    b = Math.cos(p.lon * (13 + layer * 2.7) - p.lat * (9 + layer * 1.3) - phase * 0.73),
    c = Math.sin(p.lon * (23 + layer * 3.2) + p.lat * (17 + layer * 1.9) + phase * 0.41);
  return Math.max(0, Math.min(1, (a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5));
}
''',
    '''const sphericalPhaseCache = new Map<number, number>();
function sphericalPhase(layer: number) {
  const cached = sphericalPhaseCache.get(layer);
  if (cached !== undefined) return cached;
  const phase = addressed(`SURFACE-NOISE/${layer}`) * Math.PI * 2;
  sphericalPhaseCache.set(layer, phase);
  return phase;
}
function sphericalNoise(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = sphericalPhase(layer),
    a = Math.sin(p.lon * (7 + layer * 2.1) + p.lat * (5 + layer * 1.7) + phase),
    b = Math.cos(p.lon * (13 + layer * 2.7) - p.lat * (9 + layer * 1.3) - phase * 0.73),
    c = Math.sin(p.lon * (23 + layer * 3.2) + p.lat * (17 + layer * 1.9) + phase * 0.41);
  return Math.max(0, Math.min(1, (a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5));
}
''',
)
replace_once(
    "src/hydrology.ts",
    '''function fineReliefNoise(x: number, z: number, continentId: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = (slot: number) => addressed(`FINE-RELIEF/${continentId}/${slot}`) * Math.PI * 2,
    terms = [
      Math.sin(p.lon * 1489 + p.lat * 1777 + phase(0)) * 0.24,
      Math.cos(p.lon * 2333 - p.lat * 1597 + phase(1)) * 0.2,
      Math.sin(p.lon * 3761 + p.lat * 2903 + phase(2)) * 0.18,
      Math.cos(p.lon * 5147 - p.lat * 4099 + phase(3)) * 0.15,
      Math.sin(p.lon * 7481 + p.lat * 6211 + phase(4)) * 0.13,
      Math.cos(p.lon * 10009 - p.lat * 8011 + phase(5)) * 0.1,
    ];
  return terms.reduce((sum, value) => sum + value, 0);
}
''',
    '''const fineReliefPhaseCache = new Map<number, readonly number[]>();
function fineReliefPhases(continentId: number) {
  const cached = fineReliefPhaseCache.get(continentId);
  if (cached) return cached;
  const phases = Object.freeze(
    Array.from(
      { length: 6 },
      (_, slot) => addressed(`FINE-RELIEF/${continentId}/${slot}`) * Math.PI * 2,
    ),
  );
  fineReliefPhaseCache.set(continentId, phases);
  return phases;
}
function fineReliefNoise(x: number, z: number, continentId: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = fineReliefPhases(continentId),
    terms = [
      Math.sin(p.lon * 1489 + p.lat * 1777 + phase[0]) * 0.24,
      Math.cos(p.lon * 2333 - p.lat * 1597 + phase[1]) * 0.2,
      Math.sin(p.lon * 3761 + p.lat * 2903 + phase[2]) * 0.18,
      Math.cos(p.lon * 5147 - p.lat * 4099 + phase[3]) * 0.15,
      Math.sin(p.lon * 7481 + p.lat * 6211 + phase[4]) * 0.13,
      Math.cos(p.lon * 10009 - p.lat * 8011 + phase[5]) * 0.1,
    ];
  return terms.reduce((sum, value) => sum + value, 0);
}
''',
)

# A land vertex at the exact coastline now meets the shared water plane just above
# the land clip and climbs over a relief-scaled 0.3–2.6 km toe. This removes the
# high-mountain vertical extrusion while leaving authoritative Ocean/Lake cells water.
replace_once(
    "src/hydrology.ts",
    '''    // High terrain approaches the sea over a proportionally wider exposed slope;
    // the water boundary is unchanged, but ordinary mountain coasts no longer become
    // a one-cell vertical extrusion. Truly steep samples can still classify as cliffs.
    coastRise = 34 + Math.min(440, compressedRelief * 0.9),
    coastWeight = smooth01((coastSource + 2) / (coastRise + 2));
  return lerp(-2.8, terrain, coastWeight);''',
    '''    // Land meets the shared water plane as a shallow canonical toe, then gains
    // relief over a distance proportional to its mountain height. Ocean/lake ownership
    // remains unchanged; this only prevents a high dry vertex directly beside water.
    coastRise = 280 + Math.min(2400, compressedRelief * 4.2),
    coastWeight = smooth01(coastSource / coastRise);
  return lerp(0.06, terrain, coastWeight);''',
)

# Evidence target selection: representative inland range segment and a strong exposed
# canonical cliff. This does not affect runtime world generation.
p = Path("tools/wp15_targets.ts")
text = p.read_text()
text = text.replace(
    '''let cliffPoint: DrainagePoint | undefined,
  cliffClearance = -Infinity;''',
    '''let cliffPoint: DrainagePoint | undefined,
  cliffScore = -Infinity;''',
    1,
)
text = text.replace(
    '''        if (!sample.cliff || sample.water !== "none" || !macro.land) continue;
        const clearance = Math.min(
          macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
          sample.freshwaterDistance,
        );
        if (clearance > cliffClearance) {
          cliffClearance = clearance;
          cliffPoint = { x, z, bed: sample.elevation };
        }''',
    '''        if (!sample.cliff || sample.water !== "none" || !macro.land || sample.elevation < 28)
          continue;
        const clearance = Math.min(
            macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
            sample.freshwaterDistance,
          ),
          score = sample.slope * 220 + Math.min(1200, clearance) * 0.08 + Math.min(260, sample.elevation) * 0.05;
        if (score > cliffScore) {
          cliffScore = score;
          cliffPoint = { x, z, bed: sample.elevation };
        }''',
    1,
)
pattern = re.compile(r'''const mountain =\n  \[\.\.\.MACRO_PLAN\.mountainSystems\].*?const mountainTarget = mountain\.path\[Math\.floor\(mountain\.path\.length / 2\)\] \?\? mountain\.center;''', re.S)
replacement = '''const mountainCandidates = MACRO_PLAN.mountainSystems
  .filter(
    (system) =>
      system.path.length >= 4 &&
      (system.kind === "long-chain" ||
        system.kind === "hooked-range" ||
        system.kind === "dominant-spine" ||
        system.kind === "compact-massif"),
  )
  .flatMap((system) =>
    system.path.map((anchor) => {
      const macro = macroSampleAt(anchor),
        coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
        score =
          system.reliefM * (0.7 + macro.mountainIntensity) +
          Math.min(3000, Math.max(0, coast)) * 0.09 -
          system.widthRad * 180;
      return { anchor, macro, coast, score };
    }),
  )
  .filter(
    ({ macro, coast }) =>
      macro.land && macro.mountainIntensity >= 0.045 && coast >= 900,
  )
  .sort((a, b) => b.score - a.score);
const mountainTarget = mountainCandidates[0]?.anchor;
if (!mountainTarget) throw new Error("Visual evidence requires an inland seeded mountain range segment");'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"mountain target replacement count={count}")
p.write_text(text)

# Woodland is an optional map layer. Hide it only while taking terrain topology evidence
# so close canopies do not cover the canonical mountain/cliff geometry; restore it for
# settlement/freshwater evidence.
p = Path(".github/workflows/wp15-visual-evidence.yml")
text = p.read_text()
old = '''eval:window.advisorWorld.navigation.setFocus(window.__wp15.mountain.lon,window.__wp15.mountain.lat);eval:window.advisorWorld.setHalfHeight(760);settle;shot:mountain-range;eval:window.advisorWorld.navigation.setFocus(window.__wp15.cliff.lon,window.__wp15.cliff.lat);eval:window.advisorWorld.setHalfHeight(55);settle;shot:cliff-street;eval:window.advisorWorld.navigation.setFocus(window.__wp15.village.lon,window.__wp15.village.lat)'''
new = '''uncheck:#nature;eval:window.advisorWorld.navigation.setFocus(window.__wp15.mountain.lon,window.__wp15.mountain.lat);eval:window.advisorWorld.setHalfHeight(760);settle;shot:mountain-range;eval:window.advisorWorld.navigation.setFocus(window.__wp15.cliff.lon,window.__wp15.cliff.lat);eval:window.advisorWorld.setHalfHeight(55);settle;shot:cliff-street;check:#nature;eval:window.advisorWorld.navigation.setFocus(window.__wp15.village.lon,window.__wp15.village.lat)'''
if old not in text:
    raise SystemExit("visual evidence step anchor missing")
p.write_text(text.replace(old, new, 1))

print("WP15 final attempt repair applied")
