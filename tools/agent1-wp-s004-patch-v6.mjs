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
'    3 + unit(`${place.code}/${service}/SETBACK`) * 4,',
'    8 + unit(`${place.code}/${service}/SETBACK`) * 5,',
"service setback",
);

replaceOnce(
'    candidates: candidateCloud(base, `${place.code}/PLOT/${id}`, lateral, kind === "field" ? 11 : 5),',
'    candidates: candidateCloud(base, `${place.code}/PLOT/${id}`, lateral, kind === "field" ? 11 : kind === "service" ? 6 : 5),',
"service candidate spread",
);

fs.writeFileSync(path, source);
console.log("AGENT #1 WP-S004 archetype/service patch v6 applied");
