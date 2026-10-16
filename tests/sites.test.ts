import test from "node:test";
import assert from "node:assert/strict";
import { countries, countryAtPosition, places, roads, roadDistanceAt } from "../src/geography.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  greatCircleDistance,
  sourceToLonLat,
  wrapSourceX,
} from "../src/planet.ts";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAccessRoads,
  siteAcceptanceSummary,
} from "../src/sites.ts";

// Import after sites.ts so its deterministic access branches are present before
// world.ts freezes the final-surface road spatial index for this process.
const { finalSurfaceAt, finalSurfaceDebugAt } = await import("../src/world.ts");

test("priority-9 site registry is complete, deterministic and country-owned", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.accessBranches, summary.sites);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  assert.deepEqual(
    criticalSites.map((site) => site.code),
    [...criticalSites].map((site) => site.code),
  );
  for (const country of countries) {
    const local = criticalSites.filter((site) => site.countryCode === country.code);
    assert.equal(local.length, 2);
    assert.deepEqual(local.map((site) => site.kind).sort(), ["critical-place", "ruin"]);
  }
});

test("sites reuse the existing priority-9 final-surface foundation exactly", () => {
  for (const site of criticalSites) {
    const host = places.find((place) => place.code === site.hostPlaceCode);
    assert.ok(host, site.code);
    assert.equal(site.code, `${host.code}/SITE/KEEP`);
    assert.ok(Math.abs(wrapSourceX(site.x - (host.x - 30))) < 1e-9, site.code);
    assert.ok(Math.abs(site.z - (host.z - 28)) < 1e-9, site.code);
    assert.equal(countryAtPosition(site.canonicalPosition)?.code, site.countryCode, site.code);
    const natural = naturalSurfaceAt(site.x, site.z);
    assert.equal(natural.water.kind, "none", site.code);
    assert.equal(natural.walkable, true, site.code);
    const final = finalSurfaceAt(site.x, site.z);
    assert.equal(final.reservedUse, site.code, site.code);
    assert.equal(final.walkable, true, site.code);
    assert.equal(final.vegetationDensityScale, 0, site.code);
  }
});

test("every site has a real dry same-country road branch consumed by final surface", () => {
  assert.equal(siteAccessRoads.length, criticalSites.length);
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode),
      parent = roads.find((road) => road.code === site.access.roadCode);
    assert.ok(branch, site.code);
    assert.ok(parent, site.code);
    assert.ok(roads.some((road) => road.code === branch.code), site.code);
    assert.ok(site.access.lengthM > 0, site.code);
    const dx = wrapSourceX(site.access.x - site.x),
      dz = site.access.z - site.z,
      branchLengthSource = Math.hypot(dx, dz),
      siteSupportSource = (site.radiusM + site.falloffM) / CANONICAL_METRES_PER_SOURCE_UNIT;
    for (let sample = 0; sample <= 8; sample++) {
      const t = sample / 8,
        x = site.x + dx * t,
        z = site.z + dz * t,
        natural = naturalSurfaceAt(x, z);
      assert.equal(natural.water.kind, "none", `${site.code} sample ${sample}`);
      assert.equal(countryAtPosition(sourceToLonLat(x, z))?.code, site.countryCode, site.code);
    }

    // The branch must participate in final-surface composition. When there is
    // room beyond the priority-9 site support it must visibly own Road material;
    // very short branches may be completely covered by the higher-priority site
    // pad, in which case they still compose underneath it and join the parent
    // road at the exact deterministic junction.
    const probeDistance = Math.min(branchLengthSource * 0.5, siteSupportSource + 1),
      probeT = branchLengthSource === 0 ? 0 : probeDistance / branchLengthSource,
      probeX = site.x + dx * probeT,
      probeZ = site.z + dz * probeT,
      probe = finalSurfaceDebugAt(probeX, probeZ);
    assert.ok(probe.modifiers.some((modifier) => modifier.id === branch.code), site.code);
    assert.equal(probe.final.walkable, true, site.code);

    if (branchLengthSource > siteSupportSource + 1) {
      const roadT = (siteSupportSource + 1) / branchLengthSource,
        roadX = site.x + dx * roadT,
        roadZ = site.z + dz * roadT,
        surface = finalSurfaceAt(roadX, roadZ);
      assert.equal(surface.material, "Road", site.code);
      assert.equal(surface.reservedUse, branch.code, site.code);
      assert.equal(surface.walkable, true, site.code);
    } else {
      assert.ok(roadDistanceAt(site.access.x, site.access.z, parent) < 1e-7, site.code);
      assert.equal(finalSurfaceAt(site.access.x, site.access.z).walkable, true, site.code);
    }
  }
});

test("critical-site lookup is bounded and canonical across wrap-aware focus queries", () => {
  for (const site of criticalSites.slice(0, Math.min(12, criticalSites.length))) {
    const local = nearbyCriticalSites(site.x, site.z, 64, 4);
    assert.ok(local.some((item) => item.code === site.code), site.code);
    assert.ok(local.length <= 4, site.code);
    const canonical = sourceToLonLat(site.x, site.z);
    assert.ok(greatCircleDistance(canonical, site.canonicalPosition) < 0.01, site.code);
  }
});
