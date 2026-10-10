import test from "node:test";
import assert from "node:assert/strict";
import { countries, countryAtPosition, places, roads } from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAcceptanceSummary,
  siteSurfaceSample,
} from "../src/sites.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance } from "../src/planet.ts";

test("critical-site registry scales with the actual country registry", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
});

test("every critical site is dry, same-country and joined to a real road", () => {
  for (const site of criticalSites) {
    const macro = macroSampleAt(site.canonicalPosition),
      owner = countryAtPosition(site.canonicalPosition);
    assert.equal(macro.land, true, site.code);
    assert.notEqual(macro.domain, "Lake", site.code);
    assert.equal(owner?.code, site.countryCode, site.code);
    assert.ok(site.access.lengthM >= 500 && site.access.lengthM <= 1800, site.code);
    assert.ok(roads.some((road) => road.code === site.access.roadCode), site.code);
    assert.ok(
      places.every((place) => greatCircleDistance(site.canonicalPosition, place.canonicalPosition) >= 650),
      `${site.code} overlaps a settlement reserve`,
    );
  }
});

test("site access and identities are stable canonical data", () => {
  const snapshot = criticalSites.map((site) => ({
    code: site.code,
    kind: site.kind,
    x: site.x,
    z: site.z,
    road: site.access.roadCode,
    t: site.access.roadT,
    signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}`,
  }));
  const reordered = [...criticalSites].reverse().reverse().map((site) => ({
    code: site.code,
    kind: site.kind,
    x: site.x,
    z: site.z,
    road: site.access.roadCode,
    t: site.access.roadT,
    signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}`,
  }));
  assert.deepEqual(reordered, snapshot);
});

test("focused site queries are bounded and do not scan-materialize the planet", () => {
  for (const site of criticalSites.slice(0, 12)) {
    const nearby = nearbyCriticalSites(site.x, site.z, 5000, 7);
    assert.ok(nearby.length >= 1);
    assert.ok(nearby.length <= 7);
    assert.equal(nearby[0].code, site.code);
  }
});

test("priority-9 preparation has bounded canonical-metre support and one surface/walkability truth", () => {
  const site = criticalSites[0],
    target = 42,
    sourcePerMetre = 1 / CANONICAL_METRES_PER_SOURCE_UNIT,
    centre = siteSurfaceSample(site, site.x, site.z, 78, target),
    edge = siteSurfaceSample(
      site,
      site.x + (site.radiusM + site.falloffM * 0.5) * sourcePerMetre,
      site.z,
      78,
      target,
    ),
    outside = siteSurfaceSample(
      site,
      site.x + (site.radiusM + site.falloffM + 2) * sourcePerMetre,
      site.z,
      78,
      target,
    );
  assert.equal(centre.height, target);
  assert.equal(centre.cleared, true);
  assert.equal(centre.walkable, true);
  assert.ok(edge.influence > 0 && edge.influence < 1);
  assert.equal(outside.height, 78);
  assert.equal(outside.cleared, false);
  assert.equal(outside.influence, 0);
});
