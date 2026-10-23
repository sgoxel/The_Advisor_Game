import { transportNetwork } from "../src/transport-network.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cities,
  continents,
  countries,
  roads,
  roadJunctions, roadConnections, roadNetworkTelemetry,
  macroPopulationSummary,
  countryAtPosition,
  politicalBorderSegments,
  politicalRegistryMinimumCountsForSeed,
  villages,
} from "../src/geography.ts";
import { WORLD_SEED } from "../src/config.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { lonLatToSource } from "../src/planet.ts";
import {
  politicalAccessLinks,
  politicalBorderGateways,
  politicalSettlementAccessFingerprint,
  politicalSettlementAccessSummary,
  politicalSettlementSiteById,
  politicalSettlementSitePlans,
} from "../src/political-settlement-access.ts";
import {
  POLITICAL_BORDER_MAX_SCALE_DENOMINATOR,
  POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR,
  politicalOverlayOpacity,
} from "../src/political-presentation.ts";

test("political registry uses seed-variable minimum counts rather than fixed maxima", () => {
  const counts = politicalRegistryMinimumCountsForSeed(WORLD_SEED);
  assert.equal(continents.length, 3);
  assert.equal(countries.length, counts.countries);
  assert.ok(cities.length >= counts.cities);
  assert.ok(villages.length >= counts.villages);
  assert.ok(countries.length >= 30);
  assert.ok(cities.length >= 90);
  assert.ok(villages.length >= 270);
  assert.deepEqual(counts, politicalRegistryMinimumCountsForSeed(WORLD_SEED));
  const variants = [
    politicalRegistryMinimumCountsForSeed("ADVISOR-POLITICAL-A"),
    politicalRegistryMinimumCountsForSeed("ADVISOR-POLITICAL-B"),
    politicalRegistryMinimumCountsForSeed("ADVISOR-POLITICAL-C"),
  ];
  assert.ok(variants.every((value) => value.countries >= 30));
  assert.ok(variants.some((value) => value.countries !== counts.countries));
  assert.equal(new Set(countries.map((country) => country.name)).size, countries.length);
});

test("canonical settlement names are cultural, typed collision-safe and free of numeric templates", () => {
  const settlements = [...cities, ...villages],
    allNames = [...countries, ...settlements].map((place) => place.name.toLowerCase()),
    globalUniqueRatio = new Set(allNames).size / allNames.length;
  assert.equal(villages[0].name, "Alderwick");
  assert.equal(new Set(cities.map((city) => city.name.toLowerCase())).size, cities.length);
  assert.equal(new Set(villages.map((village) => village.name.toLowerCase())).size, villages.length);
  assert.equal(new Set([...cities, ...villages].map((place) => place.code)).size, cities.length + villages.length);
  assert.ok(globalUniqueRatio >= 0.98, `global place-name uniqueness fell to ${globalUniqueRatio}`);
  for (const place of settlements) {
    assert.doesNotMatch(place.name, /\d+\.\d+\.\d+/);
    assert.doesNotMatch(place.name, /^(Citadel|Market|Harbour)$/);
  }
  const continentFamilies = continents.map((continent) =>
    new Set(
      settlements
        .filter((place) => place.continent === continent.id)
        .map((place) => place.name.slice(0, 4)),
    ),
  );
  assert.ok(continentFamilies.every((family) => family.size >= 6));
});

test("every sampled canonical land coordinate has exactly one country owner", () => {
  let landSamples = 0;
  for (let latDeg = -72; latDeg <= 72; latDeg += 6)
    for (let lonDeg = -180; lonDeg < 180; lonDeg += 6) {
      const position = {
        lon: (lonDeg * Math.PI) / 180,
        lat: (latDeg * Math.PI) / 180,
      };
      const macro = macroSampleAt(position);
      if (!macro.land) continue;
      landSamples++;
      const owner = countryAtPosition(position);
      assert.ok(owner, `missing owner at ${latDeg},${lonDeg}`);
      assert.equal(owner!.continent, macro.continentId);
    }
  assert.ok(landSamples > 100);
  for (const country of countries)
    assert.equal(countryAtPosition(country.canonicalPosition)?.code, country.code);
});

test("cities and villages stay inside their canonical political owner without row placement", () => {
  for (const place of [...cities, ...villages]) {
    const owner = countryAtPosition(place.canonicalPosition);
    assert.ok(owner, place.code);
    assert.equal(owner!.continent, place.continent, place.code);
    assert.equal(owner!.id, place.country, place.code);
  }
  for (const city of cities) {
    const children = villages.filter((village) => village.id.startsWith(`${city.id}/`));
    // Density and terrain decide association counts; three is not a quota.
    if (children.length < 2) continue;
    assert.ok(
      new Set(children.map((village) => village.canonicalPosition.lat.toFixed(8))).size > 1,
      `${city.id} still uses a fixed east-west village row`,
    );
  }
});

test("every accepted settlement reserves a complete dry owned envelope and legal entrance", () => {
  const allPlaces = [...cities, ...villages],
    missingSites = allPlaces
      .filter((place) => !politicalSettlementSiteById.has(place.id))
      .map((place) => `${place.kind}:${place.code}`);
  assert.deepEqual(missingSites, [], `invalid canonical settlement sites: ${missingSites.join(", ")}`);
  assert.equal(politicalSettlementSitePlans.length, allPlaces.length);
  assert.equal(politicalSettlementSiteById.size, allPlaces.length);
  for (const place of allPlaces) {
    const plan = politicalSettlementSiteById.get(place.id);
    assert.ok(plan, `missing site plan for ${place.code}`);
    assert.equal(plan!.countryCode, countryAtPosition(place.canonicalPosition)?.code, place.code);
    assert.equal(countryAtPosition(plan!.entrance)?.code, plan!.countryCode, `${place.code} entrance owner`);
    assert.equal(macroSampleAt(plan!.entrance).land, true, `${place.code} entrance is wet`);
    assert.ok(plan!.reservedAreaM2 >= (place.kind === "city" ? 180_000 : 60_000), place.code);
    assert.ok(plan!.plotCapacity >= (place.kind === "city" ? 180 : 48), place.code);
    assert.ok(plan!.maximumEnvelopeReliefSpreadM <= (place.kind === "city" ? 46 : 34), place.code);
    assert.ok(plan!.maximumPreparedCutFillM <= (place.kind === "city" ? 8 : 6), place.code);
    assert.ok(Number.isFinite(plan!.waterDistanceM), `${place.code} water context is unbounded`);
  }
});

test("every political settlement reaches its country backbone and every country reserves a land border gateway", () => {
  const expectedFromIds = new Set([
      ...villages.map((village) => village.id),
      ...cities.filter((city) => city.city !== 0).map((city) => city.id),
    ]),
    actualFromIds = new Set(politicalAccessLinks.map((link) => link.fromId)),
    missingAccess = [...expectedFromIds].filter((id) => !actualFromIds.has(id)),
    infeasibleAccess = politicalAccessLinks
      .filter((link) => !link.feasible)
      .map((link) => `${link.id}:${link.fromId}->${link.toId}`);
  assert.deepEqual(missingAccess, [], `missing political access links: ${missingAccess.join(", ")}`);
  assert.equal(politicalAccessLinks.length, expectedFromIds.size);
  assert.equal(
    politicalSettlementAccessSummary.feasibleLinks,
    expectedFromIds.size,
    `infeasible political access links: ${infeasibleAccess.join(", ")}`,
  );
  for (const link of politicalAccessLinks) {
    assert.equal(link.feasible, true, link.id);
    assert.ok(link.waypoints.length >= 2, link.id);
    assert.ok(Number.isFinite(link.distanceM) && link.distanceM > 0, link.id);
    for (const waypoint of link.waypoints) {
      assert.equal(macroSampleAt(waypoint).land, true, `${link.id} crosses macro water`);
      assert.equal(countryAtPosition(waypoint)?.code, link.countryCode, `${link.id} leaves its country`);
    }
  }

  const gatewayCountries = new Set(politicalBorderGateways.map((gate) => gate.countryCode)),
    missingGateways = countries
      .filter((country) => !gatewayCountries.has(country.code))
      .map((country) => country.code);
  assert.deepEqual(missingGateways, [], `countries without legal border gateways: ${missingGateways.join(", ")}`);
  assert.equal(politicalBorderGateways.length, countries.length);
  for (const gate of politicalBorderGateways) {
    assert.equal(countryAtPosition(gate.inside)?.code, gate.countryCode, `${gate.id} inside owner`);
    assert.equal(countryAtPosition(gate.outside)?.code, gate.neighbourCountryCode, `${gate.id} outside owner`);
    assert.notEqual(gate.countryCode, gate.neighbourCountryCode, gate.id);
    assert.equal(macroSampleAt(gate.inside).land, true, gate.id);
    assert.equal(macroSampleAt(gate.outside).land, true, gate.id);
  }
});

test("political settlement/access metadata is deterministic and lightweight", () => {
  assert.equal(politicalSettlementAccessSummary.sites, cities.length + villages.length);
  assert.equal(politicalSettlementAccessSummary.expectedSites, cities.length + villages.length);
  assert.equal(politicalSettlementAccessSummary.countries, countries.length);
  assert.equal(politicalSettlementAccessSummary.borderGateways, countries.length);
  const a = politicalSettlementAccessFingerprint(),
    b = politicalSettlementAccessFingerprint();
  assert.equal(a, b);
  assert.ok(a.length < 500_000, `political site/access fingerprint unexpectedly large: ${a.length}`);
});

test("shared country borders are deterministic bounded derivations of ownership", () => {
  const focus = countries[0].canonicalPosition,
    source = lonLatToSource(focus.lon, focus.lat),
    a = politicalBorderSegments(source.x, source.z, 9000, 1.6),
    b = politicalBorderSegments(source.x, source.z, 9000, 1.6);
  assert.deepEqual(a, b);
  assert.ok(a.length < 3000);
  const keys = a.map((segment) => {
    assert.ok(segment.countries[0] < segment.countries[1]);
    return [
      segment.countries.join("|"),
      segment.ax.toFixed(3),
      segment.az.toFixed(3),
      segment.bx.toFixed(3),
      segment.bz.toFixed(3),
    ].join("/");
  });
  assert.equal(new Set(keys).size, keys.length);
});

test("political overlay visibility is Country-scale driven across flat/globe handoff", () => {
  assert.equal(POLITICAL_BORDER_MAX_SCALE_DENOMINATOR, 1000);
  assert.equal(POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR, 1000);
  for (const presentation of ["flat", "transition", "globe"] as const)
    for (const transition of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1])
      assert.equal(
        politicalOverlayOpacity(
          presentation,
          transition,
          1000,
          POLITICAL_BORDER_MAX_SCALE_DENOMINATOR,
        ),
        1,
        `${presentation}/${transition}`,
      );
  assert.equal(
    politicalOverlayOpacity("flat", 0, 2500, POLITICAL_BORDER_MAX_SCALE_DENOMINATOR),
    0,
  );
  assert.equal(
    politicalOverlayOpacity("globe", 1, 2500, POLITICAL_BORDER_MAX_SCALE_DENOMINATOR),
    0,
  );
  assert.equal(
    politicalOverlayOpacity("flat", 0, 1000, POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR),
    1,
  );
  assert.equal(
    politicalOverlayOpacity("flat", 0, 2500, POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR),
    0,
  );
});


test("macro population uses variable productive-country density with bounded coarse scratch",()=>{
  assert.ok(cities.length>politicalRegistryMinimumCountsForSeed(WORLD_SEED).cities);
  assert.ok(villages.length>politicalRegistryMinimumCountsForSeed(WORLD_SEED).villages);
  assert.ok(new Set(macroPopulationSummary.countries.map(c=>c.cities)).size>1);
  assert.ok(macroPopulationSummary.countries.some(c=>c.cities>3));
  assert.ok(new Set(cities.map(c=>villages.filter(v=>v.id.startsWith(c.id+"/")).length)).size>1);
  assert.ok(macroPopulationSummary.candidateCount<3*2048+countries.length*241);
  for(const c of macroPopulationSummary.countries){assert.ok(c.cities>=3);assert.ok(c.villages>=9);assert.ok(c.productiveKm2<=c.areaKm2);}
});


test("macro transport connects every generated settlement within its country with variable long links",()=>{
  const harbors = transportNetwork.nodes.filter(node => node.kind === "harbor").map(node => ({
    id: node.sourceId, continent: node.continent,
    country: countries.find(country => country.code === node.countryCode)!.id,
  }));
  const places=[...cities,...villages,...roadJunctions,...harbors],byId=new Map(places.map(p=>[p.id,p]));
  const graph=new Map(places.map(p=>[p.id,new Set<string>()]));
  for(const road of roads){
    const a=byId.get(road.from),b=byId.get(road.to);
    assert.ok(a&&b,`${road.code} endpoints exist`);
    if(a.continent!==b.continent||a.country!==b.country)continue;
    graph.get(a.id)!.add(b.id);graph.get(b.id)!.add(a.id);
  }
  for(const country of countries){
    const local=places.filter(p=>p.continent===country.continent&&p.country===country.id),seen=new Set<string>(),pending=[local[0].id];
    while(pending.length){const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);pending.push(...graph.get(id)!);}
    assert.equal(seen.size,local.length,`${country.code} coarse backbone is connected`);
  }
  assert.ok(roads.some(r=>r.surfaceLengthM>100000),"coarse links are not capped at the old local parent radius");
  assert.ok(new Set(roads.map(r=>Math.floor(r.surfaceLengthM/10000))).size>5);
});


test("generated roads use shared Y nodes and bounded terrain-selected physical polylines",()=>{
 assert.ok(roadJunctions.length>0);assert.ok(roadNetworkTelemetry.bentEdges>0);assert.ok(roadNetworkTelemetry.maximumStations<=26);assert.ok(roadNetworkTelemetry.maxStates<=49);
 const byNetworkId=new Map(roads.map(r=>[r.networkId,r]));
 for(const c of roadConnections){let at=c.from;for(const leg of c.legs){const r=byNetworkId.get(leg.edgeId)!;assert.ok(r);assert.equal(leg.reverse?r.to:r.from,at);at=leg.reverse?r.from:r.to;}assert.equal(at,c.to);}
 const uses=new Map<string,number>();for(const c of roadConnections)for(const leg of c.legs)uses.set(leg.edgeId,(uses.get(leg.edgeId)||0)+1);
 assert.ok(roads.some(r=>r.networkKind==='trunk'&&(uses.get(r.networkId)||0)>=2));
 for(const j of roadJunctions)assert.equal(roads.filter(r=>r.from===j.id||r.to===j.id).length,3);
});


test("small props and NPCs are hidden from displayed 1/2 outward, independently of building icons", async () => {
  const { settlementSmallDetailsVisible, SETTLEMENT_ICON_FROM_SCALE } = await import("../src/political-presentation.ts");
  for (const scale of [.2,.5,1,1.99]) assert.equal(settlementSmallDetailsVisible(scale),true);
  for (const scale of [2,5,10,100,10000]) assert.equal(settlementSmallDetailsVisible(scale),false);
  assert.equal(SETTLEMENT_ICON_FROM_SCALE,5);
});
