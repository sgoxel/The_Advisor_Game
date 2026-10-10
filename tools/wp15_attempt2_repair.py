from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"attempt2 anchor missing in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/hydrology.ts",
    '''function terrainNoise(x: number, z: number) {
  return sphericalNoise(x, z, 0) * 0.5 + sphericalNoise(x, z, 1) * 0.32 + sphericalNoise(x, z, 2) * 0.18;
}
''',
    '''function terrainNoise(x: number, z: number) {
  return sphericalNoise(x, z, 0) * 0.5 + sphericalNoise(x, z, 1) * 0.32 + sphericalNoise(x, z, 2) * 0.18;
}

/** Sub-kilometre spherical spectrum. Integer longitude frequencies make the wrap exact;
 * mixed lon/lat directions and seed-addressed phases avoid an axis-aligned ridge lattice. */
function fineReliefNoise(x: number, z: number, continentId: number) {
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
)

p = Path("src/hydrology.ts")
text = p.read_text()
pattern = re.compile(
    r'''  const noise = terrainNoise\(sx, z\),\n    broad = sphericalNoise\(sx, z, 3\),.*?  return lerp\(-2\.8, terrain, smooth01\(\(coastSource \+ 2\) / 12\)\);''',
    re.S,
)
replacement = '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    fine = fineReliefNoise(sx, z, macro.continentId),
    // Macro authority decides where/which mountain exists; this continuous spectrum
    // breaks its wide footprint into local shoulders, gullies and ridges at Province scale.
    localRelief = fine * Math.min(155, macro.reliefM * 0.3) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    rawRelief = Math.max(0, macro.reliefM * (0.54 + 0.2 * noise) + localRelief),
    reliefLimit = macro.domain === "Island" ? 190 : 560,
    // Soft compression keeps every height gradient instead of clipping a broad high
    // mountain interior to one flat ceiling.
    compressedRelief = reliefLimit * Math.tanh(rawRelief / reliefLimit),
    terrain = Math.max(1.2, base + compressedRelief),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
    // High terrain approaches the sea over a proportionally wider exposed slope;
    // the water boundary is unchanged, but ordinary mountain coasts no longer become
    // a one-cell vertical extrusion. Truly steep samples can still classify as cliffs.
    coastRise = 34 + Math.min(440, compressedRelief * 0.9),
    coastWeight = smooth01((coastSource + 2) / (coastRise + 2));
  return lerp(-2.8, terrain, coastWeight);'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"attempt2 naturalElevation replacement count={count}")
p.write_text(text)

replace_once(
    "src/terrain-refine.ts",
    '''    shade = Math.abs(unitY) > 0.995 ? 1 : Math.max(0.9, Math.min(1.045, 0.965 + light * 0.085)),''',
    '''    shade = Math.abs(unitY) > 0.995 ? 1 : Math.max(0.84, Math.min(1.08, 0.93 + light * 0.14)),''',
)

print("WP15 attempt 2 terrain shaping applied")
