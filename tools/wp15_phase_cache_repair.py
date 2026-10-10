from pathlib import Path

path = Path('src/hydrology.ts')
text = path.read_text()
old_spherical = '''function sphericalNoise(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = addressed(`SURFACE-NOISE/${layer}`) * Math.PI * 2,
    a = Math.sin(p.lon * (7 + layer * 2.1) + p.lat * (5 + layer * 1.7) + phase),
    b = Math.cos(p.lon * (13 + layer * 2.7) - p.lat * (9 + layer * 1.3) - phase * 0.73),
    c = Math.sin(p.lon * (23 + layer * 3.2) + p.lat * (17 + layer * 1.9) + phase * 0.41);
  return Math.max(0, Math.min(1, (a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5));
}
'''
new_spherical = '''const sphericalPhaseCache = new Map<number, number>();
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
'''
old_fine = '''function fineReliefNoise(x: number, z: number, continentId: number) {
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
'''
new_fine = '''const fineReliefPhaseCache = new Map<number, readonly number[]>();
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
'''
if old_spherical not in text:
    raise SystemExit('sphericalNoise target not found')
if old_fine not in text:
    raise SystemExit('fineReliefNoise target not found')
text = text.replace(old_spherical, new_spherical, 1).replace(old_fine, new_fine, 1)
path.write_text(text)
