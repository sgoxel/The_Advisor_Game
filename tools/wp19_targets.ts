import { cities, villages } from "../src/geography.ts";
import { settlementPlan } from "../src/settlements.ts";

const selectedVillages: typeof villages = [];
const seen = new Set<string>();
for (const village of villages) {
  const archetype = settlementPlan(village.id).archetype;
  if (seen.has(archetype)) continue;
  seen.add(archetype);
  selectedVillages.push(village);
  if (selectedVillages.length === 3) break;
}
while (selectedVillages.length < 3)
  selectedVillages.push(villages[selectedVillages.length]);

const encode = (place: (typeof villages)[number]) => {
  const plan = settlementPlan(place.id),
    use = (name: string) => plan.buildings.find((building) => building.use === name)?.code;
  return {
    id: place.id,
    name: place.name,
    lon: place.canonicalPosition.lon,
    lat: place.canonicalPosition.lat,
    archetype: plan.archetype,
    population: plan.population,
    home: use("home"),
    inn: use("inn"),
    market: use("market"),
    blacksmith: use("blacksmith"),
  };
};

const city = cities[0], cityPlan = settlementPlan(city.id);
console.log(JSON.stringify({
  villages: selectedVillages.map(encode),
  city: {
    id: city.id,
    name: city.name,
    lon: city.canonicalPosition.lon,
    lat: city.canonicalPosition.lat,
    archetype: cityPlan.archetype,
    population: cityPlan.population,
    inn: cityPlan.buildings.find((building) => building.use === "inn")?.code,
  },
}));
