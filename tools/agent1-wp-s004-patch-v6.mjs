import fs from "node:fs";

const path = "src/settlement-exterior.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
`function archetypeFor(place: Place): SettlementArchetype {
  const site = politicalSettlementSiteById.get(place.id);
  if (site?.waterContext === "freshwater-lake" || site?.waterContext === "coast") return "riverside";
  if ((site?.maximumEnvelopeReliefSpreadM || 0) > 34) return "hillside";
  const value = digest(\`${'${place.code}'}/EXTERIOR/ARCHETYPE\`);
  if (place.kind === "city") {
    return ["market-trade", "fortified-frontier", "riverside", "hillside"][value % 4] as SettlementArchetype;
  }
  return [
    "roadside",
    "green",
    "crossroads",
    "dispersed-farming",
    "fortified-frontier",
    "market-trade",
  ][value % 6] as SettlementArchetype;
}`,
`function archetypeFor(place: Place): SettlementArchetype {
  const site = politicalSettlementSiteById.get(place.id),
    value = digest(\`${'${place.code}'}/EXTERIOR/ARCHETYPE\`),
    waterInfluenced = site?.waterContext === "freshwater-lake" || site?.waterContext === "coast",
    relief = site?.maximumEnvelopeReliefSpreadM || 0;
  if (place.kind === "city") {
    if (waterInfluenced && digest(\`${'${place.code}'}/EXTERIOR/WATER-MORPH\`) % 3 === 0) return "riverside";
    if (relief > 34 && digest(\`${'${place.code}'}/EXTERIOR/RELIEF-MORPH\`) % 3 === 1) return "hillside";
    return ["market-trade", "fortified-frontier", "riverside", "hillside"][value % 4] as SettlementArchetype;
  }
  if (waterInfluenced && digest(\`${'${place.code}'}/EXTERIOR/WATER-MORPH\`) % 4 === 0) return "riverside";
  if (relief > 28 && digest(\`${'${place.code}'}/EXTERIOR/RELIEF-MORPH\`) % 5 === 0) return "hillside";
  return [
    "roadside",
    "green",
    "crossroads",
    "dispersed-farming",
    "fortified-frontier",
    "market-trade",
  ][value % 6] as SettlementArchetype;
}`,
"archetype diversity",
);

replaceOnce(
`function streetFromControls(
  place: Place,
  axis: SettlementPoint,
  id: string,
  width: number,
  controls: readonly (readonly [number, number])[],
): SettlementStreetPlan {
  const points: SettlementPoint[] = [];
  for (let controlIndex = 1; controlIndex < controls.length; controlIndex++) {
    const a = controls[controlIndex - 1],
      b = controls[controlIndex],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      steps = Math.max(1, Math.ceil(length / 8));
    for (let step = controlIndex === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps,
        along = a[0] + dx * t,
        lateral = a[1] + dz * t;
      points.push(localPoint(place, axis, along, lateral));
    }
  }
  return { id: \`${'${place.code}'}/STREET/${'${id}'}\`, width, points };
}`,
`function streetFromControls(
  place: Place,
  axis: SettlementPoint,
  id: string,
  width: number,
  controls: readonly (readonly [number, number])[],
): SettlementStreetPlan {
  const points: SettlementPoint[] = [];
  for (let controlIndex = 1; controlIndex < controls.length; controlIndex++) {
    const a = controls[controlIndex - 1],
      b = controls[controlIndex],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz) || 1,
      steps = Math.max(2, Math.ceil(length / 8)),
      bendSign = (digest(\`${'${place.code}'}/STREET/${'${id}'}/BEND/${'${controlIndex}'}\`) & 1) === 0 ? -1 : 1,
      bend = bendSign * (1.8 + unit(\`${'${place.code}'}/STREET/${'${id}'}/BEND-MAG/${'${controlIndex}'}\`) * 2.4),
      normalAlong = -dz / length,
      normalLateral = dx / length;
    for (let step = controlIndex === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps,
        curve = Math.sin(Math.PI * t) * bend,
        along = a[0] + dx * t + normalAlong * curve,
        lateral = a[1] + dz * t + normalLateral * curve;
      points.push(localPoint(place, axis, along, lateral));
    }
  }
  return { id: \`${'${place.code}'}/STREET/${'${id}'}\`, width, points };
}`,
"seeded street curvature",
);

replaceOnce(
`function servicePlot(
  place: Place,
  streets: readonly SettlementStreetPlan[],
  service: SettlementService,
  streetIndex: number,
  fraction: number,
  side: -1 | 1,
  capacity: number,
  residents: number,
) {
  return plotOnStreet(
    place,
    streets[streetIndex % streets.length],
    service.toUpperCase(),
    "service",
    fraction,
    side,
    3 + unit(\`${'${place.code}'}/${'${service}'}/SETBACK\`) * 4,
    capacity,
    residents,
    service,
  );
}`,
`function servicePlot(
  place: Place,
  streets: readonly SettlementStreetPlan[],
  service: SettlementService,
  streetIndex: number,
  fraction: number,
  side: -1 | 1,
  capacity: number,
  residents: number,
) {
  const setback = 8 + unit(\`${'${place.code}'}/${'${service}'}/SETBACK\`) * 5,
    base = plotOnStreet(
      place,
      streets[streetIndex % streets.length],
      service.toUpperCase(),
      "service",
      fraction,
      side,
      setback,
      capacity,
      residents,
      service,
    ),
    candidates = [...base.candidates],
    fractions = [0.18, 0.34, 0.5, 0.66, 0.82] as const;
  for (let offset = 0; offset < streets.length; offset++) {
    const street = streets[(streetIndex + offset) % streets.length];
    for (let fractionIndex = 0; fractionIndex < fractions.length; fractionIndex++) {
      const sample = pointOnStreet(street, fractions[fractionIndex]),
        alternateSide: -1 | 1 = ((digest(\`${'${place.code}'}/${'${service}'}/ALT/${'${offset}'}/${'${fractionIndex}'}\`) & 1) === 0) ? side : (side === 1 ? -1 : 1),
        lateral = alternateSide * (street.width * 0.5 + setback + base.depth * 0.5);
      candidates.push(offsetPoint(sample, 0, lateral));
      candidates.push(offsetPoint(sample, 4.5, lateral + alternateSide * 3.5));
      candidates.push(offsetPoint(sample, -4.5, lateral + alternateSide * 3.5));
    }
  }
  return { ...base, candidates };
}`,
"required service fallback candidates",
);

replaceOnce(
'    candidates: candidateCloud(base, `${place.code}/PLOT/${id}`, lateral, kind === "field" ? 11 : 5),',
'    candidates: candidateCloud(base, `${place.code}/PLOT/${id}`, lateral, kind === "field" ? 11 : kind === "service" ? 6 : 5),',
"service candidate spread",
);

fs.writeFileSync(path, source);
console.log("AGENT #1 WP-S004 archetype/service/curvature patch v6 applied");
