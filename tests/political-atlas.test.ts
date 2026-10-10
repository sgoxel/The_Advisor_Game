import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cities,
  continents,
  countries,
  countryAtPosition,
  politicalBorderSegments,
  politicalRegistryCountsForSeed,
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
  const counts = politicalRegistryCountsForSeed(WORLD_SEED);
  assert.equal(continents.length, 3);
  assert.equal(countries.length, counts.countries);
  assert.equal(cities.length, counts.cities);
  assert.equal(villages.length, counts.villages);
  assert.ok(countries.length >= 30);
  assert.ok(cities.length >= 90);
  assert.ok(villages.length >= 270);
  assert.deepEqual(counts, politicalRegistryCountsForSeed(WORLD_SEED));
  const variants = [
    politicalRegistryCountsForSeed("ADVISOR-POLITICAL-A"),
    politicalRegistryCountsForSeed("ADVISOR-POLITICAL-B"),
    politicalRegistryCountsForSeed("ADVISOR-POLITICAL-C"),
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
    assert.equal(children.length, 3);
    assert.ok(
      new Set(children.map((village) => village.canonicalPosition.lat.toFixed(8))).size > 1,
      `${city.id} still uses a fixed east-west village row`,
    );
  }
});

test("every accepted settlement reserves a complete dry owned envelope and legal entrance", () => {
  assert.equal(politicalSettlementSitePlans.length, cities.length + villages.length);
  assert.equal(politicalSettlementSiteById.size, cities.length + villages.length);
  for (const place of [...cities, ...villages]) {
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
  const expectedLinks = villages.length + cities.length - countries.length;
  assert.equal(politicalAccessLinks.length, expectedLinks);
  assert.equal(politicalSettlementAccessSummary.feasibleLinks, expectedLinks);
  for (const link of politicalAccessLinks) {
    assert.equal(link.feasible, true, link.id);
    assert.ok(link.waypoints.length >= 2, link.id);
    assert.ok(Number.isFinite(link.distanceM) && link.distanceM > 0, link.id);
    for (const waypoint of link.waypoints) {
      assert.equal(macroSampleAt(waypoint).land, true, `${link.id} crosses macro water`);
      assert.equal(countryAtPosition(waypoint)?.code, link.countryCode, `${link.id} leaves its country`);
    }
  }

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
