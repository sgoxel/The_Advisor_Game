import test from "node:test";
import assert from "node:assert/strict";
import { countries, countryAtPosition, places, roadDistanceAt, roads } from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { criticalSites, nearbyCriticalSites, siteAcceptanceSummary, siteAccessRoads, siteSurfaceSample } from "../src/sites.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance, wrapSourceX } from "../src/planet.ts";
import { finalSurfaceAt, finalSurfaceDebugAt } from "../src/world.ts";

test("critical-site registry scales with the actual country registry", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.publicSites, summary.sites);
  assert.equal(summary.accessBranches, summary.sites);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  assert.equal(new Set(siteAccessRoads.map((road) => road.code)).size, siteAccessRoads.length);
});

test("every site is dry, same-country and joined to a dedicated legal access branch", () => {
  for (const site of criticalSites) {
    const macro = macroSampleAt(site.canonicalPosition), owner = countryAtPosition(site.canonicalPosition), branch = siteAccessRoads.find((road) => road.code === site.access.branchCode);
    assert.equal(macro.land, true, site.code);
    assert.notEqual(macro.domain, "Lake", site.code);
    assert.equal(owner?.code, site.countryCode, site.code);
    assert.ok(site.access.lengthM >= 650 && site.access.lengthM <= 2300, site.code);
    assert.ok(roads.some((road) => road.code === site.access.roadCode), site.code);
    assert.ok(branch, `${site.code} missing SITE/ACCESS branch`);
    assert.ok(!roads.includes(branch!), `${site.code} SITE/ACCESS branch must not pollute settlement-routing roads`);
    assert.ok(places.every((place) => greatCircleDistance(site.canonicalPosition, place.canonicalPosition) >= 900), `${site.code} overlaps settlement reserve`);
  }
});

test("site identity, icon metadata and access are stable canonical data", () => {
  const snapshot = criticalSites.map((site) => ({ code: site.code, kind: site.kind, visibility: site.visibility, importance: site.importance, x: site.x, z: site.z, road: site.access.roadCode, branch: site.access.branchCode, t: site.access.roadT, signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}` }));
  const reordered = [...criticalSites].reverse().reverse().map((site) => ({ code: site.code, kind: site.kind, visibility: site.visibility, importance: site.importance, x: site.x, z: site.z, road: site.access.roadCode, branch: site.access.branchCode, t: site.access.roadT, signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}` }));
  assert.deepEqual(reordered, snapshot);
});

test("focused site queries stay bounded", () => {
  for (const site of criticalSites.slice(0, 12)) {
    const nearby = nearbyCriticalSites(site.x, site.z, 5000, 7);
    assert.ok(nearby.length >= 1);
    assert.ok(nearby.length <= 7);
    assert.equal(nearby[0].code, site.code);
  }
});

test("priority-9 site preparation is bounded and consumed by final-surface authority", () => {
  const site = criticalSites[0], sourcePerMetre = 1 / CANONICAL_METRES_PER_SOURCE_UNIT,
    centreBase = finalSurfaceDebugAt(site.x, site.z).base.groundHeight,
    centre = siteSurfaceSample(site, site.x, site.z, centreBase),
    outsideX = site.x + (site.radiusM + site.falloffM + 2) * sourcePerMetre,
    outsideBase = finalSurfaceDebugAt(outsideX, site.z).base.groundHeight,
    outside = siteSurfaceSample(site, outsideX, site.z, outsideBase),
    debug = finalSurfaceDebugAt(site.x, site.z), final = finalSurfaceAt(site.x, site.z);
  assert.equal(centre.cleared, true);
  assert.equal(centre.walkable, true);
  assert.equal(centre.influence, 1);
  assert.equal(outside.cleared, false);
  assert.equal(outside.influence, 0);
  assert.ok(debug.modifiers.some((modifier) => modifier.id === `${site.code}/PREP`));
  assert.equal(final.reservedUse, site.code);
  assert.equal(final.walkable, true);
  assert.equal(final.water.kind, "none");
  assert.equal(final.vegetationDensityScale, 0);
});

test("every SITE/ACCESS branch is indexed, contiguous, dry and walkable in final surface", () => {
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode)!, dx = wrapSourceX(site.access.x - site.x), dz = site.access.z - site.z;
    for (let index = 0; index <= 12; index++) {
      const t = index / 12, x = site.x + dx * t, z = site.z + dz * t, surface = finalSurfaceAt(x, z);
      assert.ok(roadDistanceAt(x, z, branch) < 1e-6, `${site.code} discontinuous at ${index}`);
      assert.equal(surface.water.kind, "none", `${site.code} access crosses water at ${index}`);
      assert.equal(surface.walkable, true, `${site.code} access not walkable at ${index}`);
      if (index >= 2 && index < 12) assert.ok(surface.contributingModifierIds.includes(branch.code), `${site.code} branch not consumed at ${index}`);
      if (index === 12) assert.ok(surface.contributingModifierIds.includes(branch.code) || surface.contributingModifierIds.includes(site.access.roadCode), `${site.code} access junction not consumed by road authority`);
    }
  }
});
