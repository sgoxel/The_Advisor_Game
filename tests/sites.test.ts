import test from "node:test";
import assert from "node:assert/strict";
import {
  countries,
  countryAtPosition,
  places,
  roadAt,
  roadDistanceAt,
  roads,
} from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAcceptanceSummary,
  siteAccessRoads,
  siteSurfaceSample,
} from "../src/sites.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  greatCircleDistance,
  wrapSourceX,
} from "../src/planet.ts";
import { biomeAt, cellAt, heightAt } from "../src/world.ts";

test("critical-site registry scales with the actual country registry", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.accessBranches, summary.sites);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  assert.equal(new Set(siteAccessRoads.map((road) => road.code)).size, siteAccessRoads.length);
});

test("every critical site is dry, same-country and joined to a materialized legal road branch", () => {
  for (const site of criticalSites) {
    const macro = macroSampleAt(site.canonicalPosition),
      owner = countryAtPosition(site.canonicalPosition),
      branch = siteAccessRoads.find((road) => road.code === site.access.branchCode);
    assert.equal(macro.land, true, site.code);
    assert.notEqual(macro.domain, "Lake", site.code);
    assert.equal(owner?.code, site.countryCode, site.code);
    assert.ok(site.access.lengthM >= 500 && site.access.lengthM <= 1800, site.code);
    assert.ok(roads.some((road) => road.code === site.access.roadCode), site.code);
    assert.ok(branch, `${site.code} missing materialized SITE/ACCESS branch`);
    assert.ok(roads.includes(branch!), `${site.code} branch is not in shared road authority`);
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
    branch: site.access.branchCode,
    t: site.access.roadT,
    signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}`,
  }));
  const reordered = [...criticalSites].reverse().reverse().map((site) => ({
    code: site.code,
    kind: site.kind,
    x: site.x,
    z: site.z,
    road: site.access.roadCode,
    branch: site.access.branchCode,
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
    target = 3,
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

  // The materialized branch is consumed by the existing shared road earthwork:
  // terrain height/material and logical cell walkability all resolve the same site core.
  assert.equal(roadAt(site.x, site.z)?.code, site.access.branchCode);
  assert.ok(Math.abs(heightAt(site.x, site.z) - target) < 1e-6);
  assert.equal(biomeAt(site.x, site.z), "Road");
  assert.equal(cellAt(site.x, site.z).walkable, true);
});

test("every site access branch stays dry, contiguous and walkable into its parent road", () => {
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode)!;
    const dx = wrapSourceX(site.access.x - site.x),
      dz = site.access.z - site.z;
    for (let index = 0; index <= 12; index++) {
      const t = index / 12,
        x = site.x + dx * t,
        z = site.z + dz * t;
      assert.ok(roadDistanceAt(x, z, branch) < 1e-6, `${site.code} discontinuous at ${index}`);
      assert.ok(heightAt(x, z) > 0.1, `${site.code} access crosses water at ${index}`);
      assert.equal(cellAt(x, z).walkable, true, `${site.code} access is not walkable at ${index}`);
    }
  }
});
