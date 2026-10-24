import { cachedRoadNetwork, roadNetworkFingerprint, roadNetworkFingerprintParts } from "./road-network-cache.ts";
import { createMacroRoadNetwork, MACRO_ROAD_VERSION } from "./macro-road-network.ts";
import { climateSampleAt } from "./climate.ts";
import { COARSE_GEOGRAPHY_VERSION as WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import {
  MACRO_PLAN,
  macroFeatureDistanceM,
  macroSampleAt,
  mountainSystems,
  macroIslands,
  macroLakes,
} from "./macro-geography.ts";
import { travelMetrics } from "./travel.ts";
import { defineContinuityCorridor } from "./continuity-corridor.ts";
import { freshwaterAccessAt, naturalSurfaceAt, SETTLEMENT_WATER_RESERVE_SOURCE, freshwaterSegmentsAround, freshwaterHabitatCandidate, drainageCoarseSegments } from "./hydrology.ts";

/** x/z are derived source/render coordinates; canonicalPosition is world truth. */
export type Place = {
  id: string;
  code: string;
  name: string;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  kind: "city" | "village";
  continent: number;
  country: number;
  city: number;
};

export type Country = {
  id: number;
  continent: number;
  code: string;
  name: string;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
};

export type PoliticalBorderSegment = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  countries: readonly [string, string];
};

const COUNTRY_NAMES = [
  "Aldermarch", "Briarhold", "Greyvale", "Oakward", "Westwatch", "Ashbourne",
  "Thornreach", "Highmere", "Stonefen", "Dunvale", "Redwater", "Merewatch",
  "Goldmere", "Northreach", "Rosefen", "Ironvale", "Willowmark", "Highward",
  "Sunmere", "Greywatch", "Falconreach", "Dawnmark", "Ravenmere", "Eastvale",
  "Mossward", "Silverfen", "Hearthmarch", "Pinewatch", "Crownhold", "Longmere",
  "Embervale", "Whitefen", "Kingsward", "Sablemarch", "Windreach", "Lakehold",
] as const;
const MIN_CITIES_PER_COUNTRY = 3;
const MIN_VILLAGES_PER_COUNTRY = 9;
export const MACRO_SETTLEMENT_VERSION = "v2";
const CULTURE_STEMS = [
  ["Alder", "Briar", "Oak", "Thorn", "Grey", "Mere", "Stone", "Willow", "Falcon", "Hearth", "Raven", "Ash"],
  ["Gold", "Rose", "Iron", "Sun", "Dawn", "High", "Red", "White", "Wind", "Crown", "Silver", "North"],
  ["Moss", "Pine", "Ember", "Sable", "Lake", "Long", "East", "West", "Frost", "Wolf", "Star", "Black"],
] as const;
const CITY_ENDINGS = [
  "haven", "gate", "hold", "watch", "reach", "bridge", "crest", "court", "spire", "ford", "mere", "cross",
] as const;
const VILLAGE_ENDINGS = [
  "wick", "ford", "mere", "field", "brook", "stead", "hollow", "den", "wood", "well", "ham", "croft", "thorpe", "lea", "combe", "fold",
] as const;
const TAU = Math.PI * 2;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressedFor(seed: string, address: string) {
  return digest(`${seed}/${WORLD_FOUNDATION_VERSION}/${address}`) / 4294967296;
}
function addressed(address: string) {
  return addressedFor(WORLD_SEED, address);
}
function seededSettlementName(
  kind: "city" | "village",
  address: string,
  continent: number,
  used: Set<string>,
) {
  const stems = CULTURE_STEMS[continent % CULTURE_STEMS.length],
    endings = kind === "city" ? CITY_ENDINGS : VILLAGE_ENDINGS,
    reserved = new Set(COUNTRY_NAMES.map((name) => name.toLowerCase()));
  for (let attempt = 0; attempt < 96; attempt++) {
    const stem = stems[Math.floor(addressed(`${address}/NAME/${attempt}/STEM`) * stems.length)],
      ending = endings[Math.floor(addressed(`${address}/NAME/${attempt}/ENDING`) * endings.length)],
      prefix = attempt < 16 ? "" : ["Upper ", "Lower ", "East ", "West ", "North ", "South ", "Old ", "New ", "High ", "Little ", "Great ", "Green ", "White ", "Black ", "Red ", "Long ", "Clear ", "Deep ", "Bright ", "Fair "][Math.floor(addressed(`${address}/NAME/${attempt}/PREFIX`) * 20)],
      name = `${prefix}${stem}${ending}`,
      key = name.toLowerCase();
    if (used.has(key) || reserved.has(key)) continue;
    used.add(key);
    return name;
  }
  throw new Error(`Seeded geography could not create unique ${kind} name for ${address}`);
}
function canonicalPosition(lon: number, lat: number, elevation = 0): CanonicalPosition {
  return {
    lon: normalizeLongitude(lon),
    lat: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
    elevation,
  };
}
function destination(origin: LonLat, bearing: number, distance: number): CanonicalPosition {
  const sinLat =
      Math.sin(origin.lat) * Math.cos(distance) +
      Math.cos(origin.lat) * Math.sin(distance) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(
      origin.lon +
        Math.atan2(
          Math.sin(bearing) * Math.sin(distance) * Math.cos(origin.lat),
          Math.cos(distance) - Math.sin(origin.lat) * Math.sin(lat),
        ),
    );
  return canonicalPosition(lon, lat);
}
function initialBearing(from: LonLat, to: LonLat) {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  return Math.atan2(
    Math.sin(deltaLon) * Math.cos(to.lat),
    Math.cos(from.lat) * Math.sin(to.lat) -
      Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(deltaLon),
  );
}
const withPresentation = <T extends { canonicalPosition: CanonicalPosition }>(record: T) => {
  const { x, z } = lonLatToSource(
    record.canonicalPosition.lon,
    record.canonicalPosition.lat,
  );
  return { ...record, x, z };
};

/** Continent labels/anchors are views of the same seed-derived macro recipes as terrain. */
export const continents = MACRO_PLAN.continents.map((continent) =>
  withPresentation({
    id: continent.id,
    name: continent.name,
    code: continent.code,
    canonicalPosition: canonicalPosition(continent.center.lon, continent.center.lat),
    majorRadiusRad: continent.majorRadiusRad,
    minorRadiusRad: continent.minorRadiusRad,
    orientationRad: continent.orientationRad,
  }),
);

/** Seed-addressed registry floors; actual density-driven settlement counts may exceed them. */
export function politicalRegistryMinimumCountsForSeed(seed: string) {
  const perContinent = continents.map(
    (continent) => 10 + Math.floor(addressedFor(seed, `COUNTRY_COUNT/${continent.id}`) * 3),
  );
  const countryCount = perContinent.reduce((sum, count) => sum + count, 0);
  return {
    continents: continents.length,
    perContinent,
    countries: countryCount,
    cities: countryCount * MIN_CITIES_PER_COUNTRY,
    villages: countryCount * MIN_VILLAGES_PER_COUNTRY,
  } as const;
}

function continentCandidate(
  continent: (typeof continents)[number],
  address: string,
  attempt: number,
): CanonicalPosition {
  const radius = Math.sqrt(addressed(`${address}/${attempt}/radius`)),
    angle = TAU * addressed(`${address}/${attempt}/angle`),
    u = Math.cos(angle) * radius * continent.majorRadiusRad * 1.12,
    v = Math.sin(angle) * radius * continent.minorRadiusRad * 1.12,
    c = Math.cos(continent.orientationRad),
    s = Math.sin(continent.orientationRad),
    east = u * c - v * s,
    north = u * s + v * c,
    cosLat = Math.max(0.25, Math.abs(Math.cos(continent.canonicalPosition.lat)));
  return canonicalPosition(
    continent.canonicalPosition.lon + east / cosLat,
    continent.canonicalPosition.lat + north,
  );
}

/**
 * Canonical settlement-site guard. This WP reserves land-connected settlements on
 * the seeded mainland so every accepted city/village can reach its country backbone
 * without inventing a ferry or filling water. Island transport remains transport-
 * network scope. All wetness here comes from macro geography; no prototype river or
 * source-presentation coordinate is allowed to decide settlement validity.
 */
function locallyDrySettlementSite(position: LonLat, maxReliefM: number) {
  const macro = macroSampleAt(position);
  const source=lonLatToSource(position.lon,position.lat),natural=naturalSurfaceAt(source.x,source.z);
  return (
    macro.land &&
    macro.domain === "Mainland" &&
    macro.reliefM <= maxReliefM &&
    macro.coastDistanceRad * CANONICAL_PLANET_RADIUS >= 3_000 &&
    natural.water.kind==='none' && natural.walkable &&
    freshwaterAccessAt(position).sourceDistance>=SETTLEMENT_WATER_RESERVE_SOURCE
  );
}

/**
 * Country anchors are selected by deterministic farthest-candidate sampling over
 * each full seeded mainland footprint. They are not a centre cluster, ring, grid,
 * or mutable random stream.
 */
function buildCountries(): Country[] {
  const result: Country[] = [],
    counts = politicalRegistryMinimumCountsForSeed(WORLD_SEED).perContinent;
  for (const continent of continents) {
    const accepted: CanonicalPosition[] = [];
    for (let id = 0; id < counts[continent.id]; id++) {
      let best: CanonicalPosition | undefined,
        bestScore = -Infinity;
      for (let attempt = 0; attempt < 144; attempt++) {
        const candidate = continentCandidate(continent, `COUNTRY/${continent.id}/${id}`, attempt),
          macro = macroSampleAt(candidate);
        if (
          !macro.land ||
          macro.domain !== "Mainland" ||
          macro.continentId !== continent.id ||
          macro.reliefM > 110
        )
          continue;
        const separation = accepted.length
          ? Math.min(...accepted.map((other) => macroFeatureDistanceM(candidate, other)))
          : 80_000 + 240_000 * addressed(`COUNTRY/${continent.id}/${id}/${attempt}/first`),
          coastBonus = Math.max(0, Math.min(90_000, macro.coastDistanceRad * CANONICAL_PLANET_RADIUS)),
          jitter = 0.92 + 0.16 * addressed(`COUNTRY/${continent.id}/${id}/${attempt}/rank`),
          score = (separation + coastBonus * 0.18) * jitter;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (!best)
        throw new Error(`Seeded geography could not place country ${continent.id}/${id}`);
      accepted.push(best);
      const globalNameIndex = continent.id * 12 + id;
      result.push(
        withPresentation({
          id,
          continent: continent.id,
          code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CONT/${continent.id}/COUNTRY/${id}`,
          name: COUNTRY_NAMES[globalNameIndex % COUNTRY_NAMES.length],
          canonicalPosition: best,
        }),
      );
    }
  }
  return result;
}

export const countries = buildCountries();

function politicalWarp(position: LonLat, country: Country) {
  const phaseA = TAU * addressed(`${country.code}/BOUNDARY/A`),
    phaseB = TAU * addressed(`${country.code}/BOUNDARY/B`),
    wave =
      Math.sin(position.lon * 7 + position.lat * 3 + phaseA) +
      0.65 * Math.cos(position.lat * 11 - position.lon * 4 + phaseB) +
      0.35 * Math.sin((position.lon + position.lat) * 17 + phaseA - phaseB);
  return 1 + wave * 0.045;
}

/**
 * Complete political partition. Every canonical land coordinate is owned by one
 * country in its macro continent. The wavy weighted Voronoi score is presentation-
 * independent and creates irregular shared borders without separate border truth.
 */
export function countryAtPosition(position: LonLat): Country | undefined {
  const macro = macroSampleAt(position);
  if (!macro.land) return undefined;
  let winner: Country | undefined,
    best = Infinity;
  for (const country of countries) {
    if (country.continent !== macro.continentId) continue;
    const distance = greatCircleDistance(position, country.canonicalPosition),
      reliefBias = 1 + Math.min(0.04, Math.max(0, macro.reliefM) / 5000),
      score = distance * politicalWarp(position, country) * reliefBias;
    if (score < best || (score === best && country.code < (winner?.code || "~"))) {
      best = score;
      winner = country;
    }
  }
  return winner;
}

/** A generated city must have a direct dry same-country reserve to its country backbone. */
function cityBackboneConnectionFits(from: LonLat, to: LonLat, country: Country) {
  const distanceRad = greatCircleDistance(from, to) / CANONICAL_PLANET_RADIUS,
    bearing = initialBearing(from, to),
    samples = 24;
  for (let index = 0; index <= samples; index++) {
    const point = destination(from, bearing, distanceRad * (index / samples)),
      macro = macroSampleAt(point);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.continentId !== country.continent ||
      countryAtPosition(point)?.code !== country.code
    )
      return false;
  }
  return true;
}

/**
 * Generation-time settlement acceptance. A canonical settlement anchor is only
 * accepted when its minimum usable footprint and at least one approach beyond
 * that footprint remain dry, low-relief and inside the same political owner.
 * This prevents later building/road systems from repairing a fundamentally bad
 * site with hidden land fill or border-crossing entrances.
 */
function settlementEnvelopeFits(
  position: LonLat,
  country: Country,
  kind: Place["kind"],
) {
  const radiusM = kind === "city" ? 240 : 170,
    reliefLimit = kind === "city" ? 46 : 34,
    centreRelief = macroSampleAt(position).reliefM,
    reliefs = [centreRelief];
  for (let index = 0; index < 12; index++) {
    const sample = destination(
        position,
        (index / 12) * TAU,
        radiusM / CANONICAL_PLANET_RADIUS,
      ),
      owner = countryAtPosition(sample),
      relief = macroSampleAt(sample).reliefM;
    if (
      owner?.code !== country.code ||
      !locallyDrySettlementSite(sample, 180)
    )
      return false;
    reliefs.push(relief);
  }
  if (Math.max(...reliefs) - Math.min(...reliefs) > reliefLimit) return false;

  const start = TAU * addressed(
      `${country.code}/${kind.toUpperCase()}/ENVELOPE/${position.lon.toFixed(8)}/${position.lat.toFixed(8)}`,
    ),
    approachDistanceM = radiusM + (kind === "city" ? 260 : 140);
  for (let attempt = 0; attempt < 24; attempt++) {
    const bearing = start + (attempt / 24) * TAU,
      approach = destination(
        position,
        bearing,
        approachDistanceM / CANONICAL_PLANET_RADIUS,
      ),
      midpoint = destination(
        position,
        bearing,
        (approachDistanceM * 0.5) / CANONICAL_PLANET_RADIUS,
      );
    if (
      countryAtPosition(approach)?.code === country.code &&
      countryAtPosition(midpoint)?.code === country.code &&
      locallyDrySettlementSite(approach, 180) &&
      locallyDrySettlementSite(midpoint, 180) &&
      Math.abs(macroSampleAt(approach).reliefM - centreRelief) <=
        (kind === "city" ? 70 : 55)
    )
      return true;
  }
  return false;
}

// Coarse, immutable population candidates. No tile/building data is prepared here.
type PopulationCandidate = {
  position: CanonicalPosition; productivity: number; habitat: number; interior: number;
  fresh: boolean; dryException: boolean; cityLegal?: boolean; villageLegal?: boolean;
};
type CountryPopulation = {
  country: Country; areaKm2: number; productiveKm2: number;
  candidates: PopulationCandidate[]; cityTarget: number; villageTarget: number;
};
const populationProfiles = new Map<string, CountryPopulation>(countries.map(country =>
  [country.code,{country,areaKm2:0,productiveKm2:0,candidates:[],cityTarget:3,villageTarget:9}]));
const countryWaterSegments=new Map<string,typeof drainageCoarseSegments[number][]>();
for(const segment of drainageCoarseSegments){
  const midpoint=sourceToLonLat(segment.ax+wrapSourceX(segment.bx-segment.ax)/2,(segment.az+segment.bz)/2),owner=countryAtPosition(midpoint);
  if(!owner)continue;
  const list=countryWaterSegments.get(owner.code)||[];list.push(segment);countryWaterSegments.set(owner.code,list);
}
function populationCandidate(position:CanonicalPosition,country:Country):PopulationCandidate|undefined {
  const macro=macroSampleAt(position);
  if(!macro.land||macro.domain!=="Mainland"||macro.reliefM>110||macro.coastDistanceRad*CANONICAL_PLANET_RADIUS<3000)return;
  const climate=climateSampleAt(position),water=freshwaterAccessAt(position),
    thermal=Math.max(.08,1-Math.abs(climate.temperatureC-14)/35),
    productivity=thermal*(.25+.75*Math.min(1,climate.moisture/.6)),
    ownDistance=macroFeatureDistanceM(position,country.canonicalPosition),
    otherDistance=Math.min(...countries.filter(c=>c.continent===country.continent&&c!==country).map(c=>macroFeatureDistanceM(position,c.canonicalPosition))),
    interior=Math.max(0,Math.min(1,(otherDistance-ownDistance)/40000));
  return {position,productivity,habitat:.35+productivity*.65+Math.max(0,1-macro.reliefM/110)*.15+(water.nearby?.65:0),interior,
    fresh:water.nearby,dryException:water.arid&&!water.nearby&&water.distanceM<=8000};
}
// Fixed coarse work per finite continent, with area-weighted latitude correction.
const POPULATION_SAMPLES_PER_CONTINENT=2048;
for(const continent of continents){
  const areaPerSample=Math.PI*(continent.majorRadiusRad*1.12*CANONICAL_PLANET_RADIUS)*(continent.minorRadiusRad*1.12*CANONICAL_PLANET_RADIUS)/1e6/POPULATION_SAMPLES_PER_CONTINENT;
  for(let attempt=0;attempt<POPULATION_SAMPLES_PER_CONTINENT;attempt++){
    const position=continentCandidate(continent,`POPULATION/${MACRO_SETTLEMENT_VERSION}/${continent.id}`,attempt),owner=countryAtPosition(position);
    if(!owner||owner.continent!==continent.id||macroSampleAt(position).domain!=="Mainland")continue;
    const profile=populationProfiles.get(owner.code)!,candidate=populationCandidate(position,owner),
      area=areaPerSample*Math.cos(position.lat)/Math.max(.25,Math.cos(continent.canonicalPosition.lat));
    profile.areaKm2+=area;
    if(candidate){profile.productiveKm2+=area*candidate.productivity;profile.candidates.push(candidate);}
  }
}
for(const profile of populationProfiles.values()){
  const {country}=profile;
  // Density is an area/habitat setting, not a maximum city count or road radius.
  profile.cityTarget=Math.max(MIN_CITIES_PER_COUNTRY,Math.round(profile.productiveKm2/3500));
  profile.villageTarget=Math.max(MIN_VILLAGES_PER_COUNTRY,Math.round(profile.productiveKm2/650));
  const anchor=populationCandidate(country.canonicalPosition,country);
  if(anchor)profile.candidates.push(anchor);
  for(let attempt=0;attempt<240;attempt++){
    const point=freshwaterHabitatCandidate(countryWaterSegments.get(country.code)||[],`POPULATION/${MACRO_SETTLEMENT_VERSION}/${country.code}/WATER/${attempt}`);
    if(!point||countryAtPosition(point)?.code!==country.code)continue;
    const candidate=populationCandidate({...point,elevation:0},country);
    if(candidate)profile.candidates.push(candidate);
  }
}
function siteLegal(candidate:PopulationCandidate,country:Country,kind:Place["kind"]){
  const key=kind==="city"?"cityLegal":"villageLegal";
  return candidate[key]??(candidate[key]=locallyDrySettlementSite(candidate.position,kind==="city"?90:95)&&settlementEnvelopeFits(candidate.position,country,kind));
}
const cityParents=new Map<string,string>();
export const cities:Place[]=(()=>{
  const result:Place[]=[],usedNames=new Set<string>();
  for(const profile of populationProfiles.values()){
    const {country}=profile,local:Place[]=[];
    for(let index=0;index<profile.cityTarget;index++){
      const ranked=profile.candidates.map((candidate,order)=>{
        const separation=local.length?Math.min(...local.map(c=>macroFeatureDistanceM(c.canonicalPosition,candidate.position))):0,
          centreAffinity=1/(1+macroFeatureDistanceM(candidate.position,country.canonicalPosition)/60000),
          coverage=local.length?Math.min(1,separation/55000):centreAffinity,
          score=candidate.habitat*(.55+.45*coverage)*(.8+.2*candidate.interior)*( .92+.16*addressed(`POPULATION/${country.code}/CITY/${index}/${order}`));
        return {candidate,score};
      }).sort((a,b)=>b.score-a.score);
      let chosen:PopulationCandidate|undefined,parent:Place|undefined;
      for(const {candidate} of ranked){
        if(result.some(c=>macroFeatureDistanceM(c.canonicalPosition,candidate.position)<18000)||!siteLegal(candidate,country,"city"))continue;
        if(local.length){
          parent=[...local].sort((a,b)=>macroFeatureDistanceM(a.canonicalPosition,candidate.position)-macroFeatureDistanceM(b.canonicalPosition,candidate.position))
            .find(c=>cityBackboneConnectionFits(candidate.position,c.canonicalPosition,country));
          if(!parent)continue;
        }
        chosen=candidate;break;
      }
      if(!chosen){if(local.length<MIN_CITIES_PER_COUNTRY)throw new Error(`No legal minimum city capacity in ${country.code}`);break;}
      const id=`${country.continent}/${country.id}/${index}`,code=`${country.code}/SETTLEMENT/${MACRO_SETTLEMENT_VERSION}/CITY/${index}`,
        place=withPresentation({id,code,name:seededSettlementName("city",code,country.continent,usedNames),canonicalPosition:chosen.position,
          kind:"city" as const,continent:country.continent,country:country.id,city:index});
      if(parent)cityParents.set(id,parent.id);
      result.push(place);local.push(place);
    }
  }
  return result;
})();
export const villages:Place[]=(()=>{
  const result:Place[]=[],usedNames=new Set<string>(["alderwick",...cities.map(c=>c.name.toLowerCase())]),childCounts=new Map<string,number>();
  for(const profile of populationProfiles.values()){
    const {country}=profile,local:Place[]=[],countryCities=cities.filter(c=>c.continent===country.continent&&c.country===country.id);
    for(let index=0;index<profile.villageTarget;index++){
      const ranked=profile.candidates.filter(c=>c.fresh||c.dryException).map((candidate,order)=>{
        const separation=local.length?Math.min(...local.map(v=>macroFeatureDistanceM(v.canonicalPosition,candidate.position))):30000,
          hinterland=index<countryCities.length?1/(1+macroFeatureDistanceM(candidate.position,countryCities[index].canonicalPosition)/30000):1,
          score=candidate.habitat*(.35+.65*Math.min(1,separation/28000))*hinterland*(.92+.16*addressed(`POPULATION/${country.code}/VILLAGE/${index}/${order}`));
        return {candidate,score};
      }).sort((a,b)=>b.score-a.score);
      let chosen:PopulationCandidate|undefined,parent:Place|undefined;
      for(const {candidate} of ranked){
        if(result.some(v=>macroFeatureDistanceM(v.canonicalPosition,candidate.position)<6000)||countryCities.some(c=>macroFeatureDistanceM(c.canonicalPosition,candidate.position)<7000)||!siteLegal(candidate,country,"village"))continue;
        parent=(index<countryCities.length?[countryCities[index]]:[...countryCities].sort((a,b)=>macroFeatureDistanceM(a.canonicalPosition,candidate.position)-macroFeatureDistanceM(b.canonicalPosition,candidate.position)))
          .find(c=>cityBackboneConnectionFits(candidate.position,c.canonicalPosition,country));
        if(!parent)continue;
        chosen=candidate;break;
      }
      if(!chosen||!parent){if(local.length<MIN_VILLAGES_PER_COUNTRY)throw new Error(`No legal minimum rural capacity in ${country.code}: ${local.length}`);break;}
      const child=childCounts.get(parent.id)||0;childCounts.set(parent.id,child+1);
      const code=`${parent.code}/VILLAGE/${child}`,name=result.length===0?"Alderwick":seededSettlementName("village",code,country.continent,usedNames),
        place=withPresentation({...parent,id:`${parent.id}/${child}`,code,name,kind:"village" as const,canonicalPosition:chosen.position});
      result.push(place);local.push(place);
    }
  }
  return result;
})();
export const places=[...cities,...villages];
export const macroPopulationSummary={version:MACRO_SETTLEMENT_VERSION,
  countries:[...populationProfiles.values()].map(p=>({countryCode:p.country.code,areaKm2:p.areaKm2,productiveKm2:p.productiveKm2,cityTarget:p.cityTarget,villageTarget:p.villageTarget,
    cities:cities.filter(c=>c.continent===p.country.continent&&c.country===p.country.id).length,
    villages:villages.filter(v=>v.continent===p.country.continent&&v.country===p.country.id).length,candidateCount:p.candidates.length})),
  candidateCount:[...populationProfiles.values()].reduce((n,p)=>n+p.candidates.length,0)};
// Candidate eligibility is disposable generation scratch, never resident scenery.
populationProfiles.clear();countryWaterSegments.clear();
const placeById=new Map(places.map(p=>[p.id,p]));
// Rural neighbours trade directly where a dry owned corridor is available;
// the city backbone still guarantees a connected coarse graph per country.
const villageTradeEdges:[Place,Place][]=[],tradeKeys=new Set<string>();
for(const country of countries){
  const local=villages.filter(v=>v.continent===country.continent&&v.country===country.id);
  for(const village of local){
    const neighbour=local.filter(v=>v!==village).sort((a,b)=>macroFeatureDistanceM(village.canonicalPosition,a.canonicalPosition)-macroFeatureDistanceM(village.canonicalPosition,b.canonicalPosition))
      .slice(0,4).find(v=>cityBackboneConnectionFits(village.canonicalPosition,v.canonicalPosition,country));
    if(!neighbour)continue;
    const key=[village.id,neighbour.id].sort().join("|");
    if(!tradeKeys.has(key)){tradeKeys.add(key);villageTradeEdges.push([village,neighbour]);}
  }
}
const backboneEdges:[Place,Place][]=[...villageTradeEdges,...cities.filter(c=>cityParents.has(c.id)).map(c=>[c,placeById.get(cityParents.get(c.id)!)!] as [Place,Place]),
  ...villages.map(v=>[v,placeById.get(v.id.slice(0,v.id.lastIndexOf("/")))!] as [Place,Place])];
/**
 * The macro road network is ~90% of world start-up cost and a pure function of the SEED, the
 * settlement registry and the generator. It ships precomputed (src/generated/road-network.json,
 * written by tools/build-world-cache.ts); a fingerprint of the exact inputs guards it, and any
 * mismatch falls back to routing live, so the world is identical either way.
 */
export const ROAD_NETWORK_FINGERPRINT = roadNetworkFingerprint(WORLD_SEED, places, backboneEdges);
export const ROAD_NETWORK_FINGERPRINT_PARTS = roadNetworkFingerprintParts(WORLD_SEED, places, backboneEdges);
export function generateRoadNetworkLive() {
  return createMacroRoadNetwork(places,backboneEdges,position=>{const c=countryAtPosition(position);return c?`${c.continent}/${c.id}`:undefined;},WORLD_SEED,macroSampleAt,drainageCoarseSegments);
}
const generatedRoadNetwork=cachedRoadNetwork(ROAD_NETWORK_FINGERPRINT,ROAD_NETWORK_FINGERPRINT_PARTS,()=>({places:places.map(p=>p.id),links:backboneEdges.map(([a,b])=>`${a.id}>${b.id}`)})) ?? generateRoadNetworkLive();
export const roadJunctions=generatedRoadNetwork.junctions;
export const roadConnections=generatedRoadNetwork.connections;
export const roadNetworkTelemetry=generatedRoadNetwork.telemetry;
export const roads=generatedRoadNetwork.edges.map(edge=>{
  const points=edge.points,from=edge.from,to=edge.to,xs=points.map(p=>p.x),zs=points.map(p=>p.z),
    surfaceLengthM=points.slice(1).reduce((sum,p,i)=>sum+greatCircleDistance(points[i].position,p.position),0),travel=travelMetrics(surfaceLengthM,"good-road");
  return {code:`${WORLD_SEED}/${MACRO_ROAD_VERSION}/ROAD/${edge.id}`,networkId:edge.id,networkKind:edge.kind as "trunk"|"link"|"detour",coarseFallback:edge.fallback,
    from:from.id,to:to.id,fromX:points[0].x,toX:points.at(-1)!.x,fromZ:points[0].z,toZ:points.at(-1)!.z,
    minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),z:(from.z+to.z)/2,
    fromPosition:from.canonicalPosition,toPosition:to.canonicalPosition,
    presentationLengthSourceUnits:points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0),
    surfaceLengthM,walkSurface:"good-road" as const,walkSpeedMps:travel.speedMps,fantasyWalkSeconds:travel.fantasySeconds,realWalkSeconds:travel.realSeconds,
    centerline:points as readonly {x:number;z:number;position:LonLat}[] | undefined};
});

// Release construction-only edge objects; physical paths are shared by roads.
generatedRoadNetwork.edges.length=0;
export type Road = (typeof roads)[number];
export const continuityCorridor = defineContinuityCorridor(villages,roads[0]);
if (continuityCorridor.road) roads.push(continuityCorridor.road);

/** Shortest seam-wrapped source distance to the exact physical road polyline.
 * Matches the S005 transport lookup; never treats a longitude seam as a world-spanning chord.
 */
type DistanceSegment = { ax: number; az: number; scale: number; dx: number; dz: number; length: number; minZ: number; maxZ: number };
const distanceSegments = new WeakMap<Road, DistanceSegment[]>();
/** Immutable SEED roads share prepared metrics across terrain and walking queries.
 * A finite bound may return Infinity outside it; distances inside remain exact. */
export function roadDistanceAt(x: number, z: number, road: Road, limit = Infinity) {
  let segments = distanceSegments.get(road);
  if (!segments) {
    const points = road.centerline && road.centerline.length > 1 ? road.centerline
      : [{ x: road.fromX, z: road.fromZ }, { x: road.toX, z: road.toZ }];
    segments = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], scale = Math.cos(sourceToLonLat(a.x, a.z).lat),
        dx = wrapSourceX(b.x - a.x) * scale, dz = b.z - a.z;
      segments.push({ ax: a.x, az: a.z, scale, dx, dz, length: dx * dx + dz * dz,
        minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
    }
    distanceSegments.set(road, segments);
  }
  let distance = limit, found = false;
  for (const segment of segments) {
    if (z < segment.minZ - distance || z > segment.maxZ + distance) continue;
    const qx = wrapSourceX(x - segment.ax) * segment.scale, qz = z - segment.az;
    if (qx < Math.min(0, segment.dx) - distance || qx > Math.max(0, segment.dx) + distance) continue;
    const t = segment.length ? Math.max(0, Math.min(1, (qx * segment.dx + qz * segment.dz) / segment.length)) : 0,
      candidate = Math.hypot(qx - segment.dx * t, qz - segment.dz * t);
    if (candidate <= distance) { distance = candidate; found = true; }
  }
  return found ? distance : Infinity;
}

/** Canonical nearest-place lookup; independent of wrap and source-plane edges. */
export function nearestPlaceAt(position: LonLat): Place | undefined {
  let result: Place | undefined,
    distance = Infinity;
  for (const place of places) {
    const candidate = greatCircleDistance(position, place.canonicalPosition);
    if (candidate < distance) {
      distance = candidate;
      result = place;
    }
  }
  return result;
}

/** The macro authority owns continent affiliation even for its islands and nearby sea. */
export function continentAtPosition(position: LonLat) {
  return continents[macroSampleAt(position).continentId];
}

// Immutable source/render spatial buckets avoid scanning every settlement at every
// terrain sample. Seam-shifted aliases are presentation acceleration only.
const buckets = new Map<string, Place[]>();
for (const place of places)
  for (const x of [place.x - SOURCE_PRESENTATION_WIDTH, place.x, place.x + SOURCE_PRESENTATION_WIDTH]) {
    const key = `${Math.floor(x / 2048)}/${Math.floor(place.z / 2048)}`,
      bucket = buckets.get(key) || [];
    bucket.push(place);
    buckets.set(key, bucket);
  }

const neighbourhoods = new Map<string, readonly Place[]>();
export function nearbyPlaces(x: number, z: number): readonly Place[] {
  const bx = Math.floor(x / 2048),
    bz = Math.floor(z / 2048),
    key = `${bx}/${bz}`;
  let result = neighbourhoods.get(key);
  if (!result) {
    const found = new Map<string, Place>();
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const place of buckets.get(`${bx + dx}/${bz + dz}`) || []) found.set(place.id, place);
    result = [...found.values()];
    neighbourhoods.set(key, result);
  }
  return result;
}

/** Transitional source/render lookup used by local terrain generation. */
export function nearestPlace(x: number, z: number): Place | undefined {
  let result: Place | undefined,
    distance = Infinity;
  for (const place of nearbyPlaces(x, z)) {
    const d = Math.hypot(wrapSourceX(x - place.x), z - place.z);
    if (d < distance) {
      distance = d;
      result = place;
    }
  }
  return result;
}

export function continentAt(x: number, z: number) {
  return continentAtPosition(sourceToLonLat(x, z));
}

export function countryAt(x: number, z: number) {
  return countryAtPosition(sourceToLonLat(x, z));
}

/** Compatibility scalar for presentation callers: <1 means dry macro land and >1 means water. */
export function continentalEnvelope(x: number, z: number) {
  const sample = macroSampleAt(sourceToLonLat(x, z));
  if (sample.land) return Math.max(0.5, 1 - Math.max(0.02, sample.coastDistanceRad) * 5);
  return Math.min(1.5, 1 + Math.max(0.02, -sample.coastDistanceRad) * 5);
}

/** Transitional source/render road hit test; road identity is its seed code. */
export function roadAt(x: number, z: number) {
  const localVillageIds = new Set(
    nearbyPlaces(x, z)
      .filter((place) => place.kind === "village")
      .map((place) => place.id),
  );
  if (!localVillageIds.size) return undefined;
  return roads.find(
    (road) =>
      (localVillageIds.has(road.from) || localVillageIds.has(road.to)) &&
      roadDistanceAt(x, z, road) < 12,
  );
}

function borderOwner(x: number, z: number) {
  return countryAt(x, z)?.code;
}
function borderCrossing(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ownerA: string,
  ownerB: string,
) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 7; i++) {
    const t = (lo + hi) / 2,
      owner = borderOwner(ax + (bx - ax) * t, az + (bz - az) * t);
    if (owner === ownerA) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    pair: ownerA < ownerB ? `${ownerA}|${ownerB}` : `${ownerB}|${ownerA}`,
  };
}

/**
 * Bounded local presentation of the canonical country classifier. Marching-cell
 * crossings are recomputed only when the view changes by the caller; they are not
 * separate political truth and never affect ownership.
 */
export function politicalBorderSegments(
  centerX: number,
  centerZ: number,
  halfHeight: number,
  aspect: number,
  columns = 34,
  rows = 24,
): PoliticalBorderSegment[] {
  const halfWidth = halfHeight * aspect,
    minX = centerX - halfWidth * 1.18,
    maxX = centerX + halfWidth * 1.18,
    minZ = centerZ - halfHeight * 1.18,
    maxZ = centerZ + halfHeight * 1.18,
    dx = (maxX - minX) / columns,
    dz = (maxZ - minZ) / rows,
    owner = Array.from({ length: rows + 1 }, (_, rz) =>
      Array.from({ length: columns + 1 }, (_, rx) =>
        borderOwner(minX + rx * dx, minZ + rz * dz),
      ),
    ),
    result: PoliticalBorderSegment[] = [];
  for (let rz = 0; rz < rows; rz++)
    for (let rx = 0; rx < columns; rx++) {
      const x0 = minX + rx * dx,
        x1 = x0 + dx,
        z0 = minZ + rz * dz,
        z1 = z0 + dz,
        corners = [
          { x: x0, z: z0, owner: owner[rz][rx] },
          { x: x1, z: z0, owner: owner[rz][rx + 1] },
          { x: x1, z: z1, owner: owner[rz + 1][rx + 1] },
          { x: x0, z: z1, owner: owner[rz + 1][rx] },
        ],
        groups = new Map<string, { x: number; z: number }[]>();
      for (let edge = 0; edge < 4; edge++) {
        const a = corners[edge],
          b = corners[(edge + 1) % 4];
        if (!a.owner || !b.owner || a.owner === b.owner) continue;
        const crossing = borderCrossing(a.x, a.z, b.x, b.z, a.owner, b.owner),
          list = groups.get(crossing.pair) || [];
        list.push(crossing);
        groups.set(crossing.pair, list);
      }
      for (const [pair, points] of groups) {
        if (points.length < 2) continue;
        const [left, right] = pair.split("|");
        for (let i = 1; i < points.length; i += 2) {
          const a = points[i - 1],
            b = points[i];
          result.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, countries: [left, right] });
        }
      }
    }
  return result;
}

/** Exposed diagnostics are immutable macro identities, not a second render dataset. */
export const macroGeography = {
  planVersion: WORLD_FOUNDATION_VERSION,
  islands: macroIslands,
  lakes: macroLakes,
  mountainSystems,
} as const;
