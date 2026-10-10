from pathlib import Path

p = Path('src/hydrology.ts')
text = p.read_text()
old = '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    ridgePhase = addressed(`RIDGE/${macro.continentId}`) * Math.PI * 2,
    secondaryPhase = addressed(`RIDGE-SECONDARY/${macro.continentId}`) * Math.PI * 2,
    ridgeWave = 1 - Math.abs(Math.sin(position.lon * 401 + position.lat * 277 + ridgePhase)),
    secondary = 1 - Math.abs(Math.sin(position.lon * 233 - position.lat * 359 + secondaryPhase)),
    ridge = smooth01((ridgeWave - 0.34) / 0.66) * 0.72 + smooth01((secondary - 0.55) / 0.45) * 0.28,
    ridgeDetail = (ridge - 0.2) * Math.min(142, macro.reliefM * 0.38) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.76 + 0.24 * noise) + ridgeDetail,
    cap = macro.domain === "Island" ? 180 : 620,
    terrain = Math.min(cap, Math.max(1.2, base + macroRelief)),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;'''
new = '''  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    ridgePhase = addressed(`RIDGE/${macro.continentId}`) * Math.PI * 2,
    secondaryPhase = addressed(`RIDGE-SECONDARY/${macro.continentId}`) * Math.PI * 2,
    tertiaryPhase = addressed(`RIDGE-TERTIARY/${macro.continentId}`) * Math.PI * 2,
    // Three differently oriented smooth waves interfere into irregular crags.
    // Unlike the old abs(sin()) ridge mask, this has no repeated narrow stripe crest.
    ridgeTexture =
      Math.sin(position.lon * 317 + position.lat * 211 + ridgePhase) * 0.44 +
      Math.sin(position.lon * 197 - position.lat * 389 + secondaryPhase) * 0.34 +
      Math.cos(position.lon * 461 + position.lat * 137 + tertiaryPhase) * 0.22,
    ridgeDetail = ridgeTexture * Math.min(108, macro.reliefM * 0.27) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.8 + 0.2 * noise) + ridgeDetail,
    cap = macro.domain === "Island" ? 180 : 620,
    terrain = Math.min(cap, Math.max(1.2, base + macroRelief)),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;'''
if old not in text:
    raise SystemExit('ridge block anchor missing')
p.write_text(text.replace(old, new, 1))
