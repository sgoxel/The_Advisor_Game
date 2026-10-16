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
  SITE_SUPPORT_SOURCE_UNITS,
} from "../src/sites.ts";

const {
  featuresFor,
  finalSurfaceAt,
  finalSurfaceDebugAt,
  tileForPosition,
} = await import("../src/world.ts");

const sourceDistance = (ax: number, az: number, bx: number, bz: number) =>
  Math.hypot(wrapSourceX(ax - bx), az - bz);
const placeReservationRadius = (kind: "city" | "village") => kind === "city" ? 510 : 170;

test("priority-9 site registry is complete, deterministic and country-owned", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.accessBranches, summary.sites);
  assert.equal(summary.priority9Foundation, "reservation-aware-bounded-site-pad");
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  for (const country of countries) {
    const local = criticalSites.filter((site) => site.countryCode === country.code);
    assert.equal(local.length, 2, country.code);
    assert.deepEqual(local.map((site) => site.kind).sort(), ["critical-place", "ruin"]);
    assert.equal(new Set(local.map((site) => site.hostPlaceCode)).size, 2, country.code);
  }
  const hardest = [...criticalSites].sort((a, b) => b.terrainReliefM - a.terrainReliefM || a.code.localeCompare(b.code))[0];
  assert.deepEqual(summary.hardestSite, { code: hardest.code, reliefM: hardest.terrainReliefM });
  assert.ok(hardest.terrainReliefM > 0.1, "representative ruin/critical site should prove non-flat bounded preparation");
});

test("site footprints use legal unowned priority-9 ground and the public final surface", () => {
  const probes = [[0, 0], [SITE_SUPPORT_SOURCE_UNITS, 0], [-SITE_SUPPORT_SOURCE_UNITS, 0], [0, SITE_SUPPORT_SOURCE_UNITS], [0, -SITE_SUPPORT_SOURCE_UNITS]] as const;
  for (const site of criticalSites) {
    const host = places.find((place) => place.code === site.hostPlaceCode);
    assert.ok(host, site.code);
    assert.equal(site.code, `${host.code}/SITE/KEEP`);
    assert.equal(countryAtPosition(site.canonicalPosition)?.code, site.countryCode, site.code);
    assert.ok(site.terrainReliefM <= 6, site.code);
    for (const place of places)
      assert.ok(
        sourceDistance(site.x, site.z, place.x, place.z) >= placeReservationRadius(place.kind) + SITE_SUPPORT_SOURCE_UNITS + 8,
        `${site.code} overlaps earlier settlement reservation ${place.code}`,
      );
    for (const road of roads.filter((road) => !road.code.endsWith("/ACCESS")))
      assert.ok(roadDistanceAt(site.x, site.z, road) >= SITE_SUPPORT_SOURCE_UNITS + 12, `${site.code} overlaps earlier road ${road.code}`);
    for (const [dx, dz] of probes) {
      const x = wrapSourceX(site.x + dx), z = site.z + dz, natural = naturalSurfaceAt(x, z);
      assert.equal(natural.water.kind, "none", `${site.code} support water`);
      assert.equal(natural.walkable, true, `${site.code} support walkability`);
      assert.equal(countryAtPosition(sourceToLonLat(x, z))?.code, site.countryCode, `${site.code} support ownership`);
    }
    const final = finalSurfaceAt(site.x, site.z);
    assert.equal(final.reservedUse, site.code, site.code);
    assert.equal(final.walkable, true, site.code);
    assert.equal(final.vegetationDensityScale, 0, site.code);
    assert.equal(final.material, "Settlement", site.code);
    assert.ok(Math.abs(final.groundHeight - site.preparedGroundHeightM) <= 3.001, site.code);
  }
  for (let a = 0; a < criticalSites.length; a++)
    for (let b = a + 1; b < criticalSites.length; b++)
      assert.ok(sourceDistance(criticalSites[a].x, criticalSites[a].z, criticalSites[b].x, criticalSites[b].z) >= SITE_SUPPORT_SOURCE_UNITS * 2 + 24);
});

test("legacy village-core priority-9 pads no longer own the public final surface", () => {
  for (const place of places) {
    const oldCode = `${place.code}/SITE/KEEP`, x = place.x - 30, z = place.z - 28,
      canonical = criticalSites.find((site) => site.code === oldCode);
    if (canonical && sourceDistance(x, z, canonical.x, canonical.z) <= SITE_SUPPORT_SOURCE_UNITS) continue;
    const debug = finalSurfaceDebugAt(x, z);
    assert.ok(!debug.modifiers.some((modifier) => modifier.priority === 9), oldCode);
    assert.notEqual(debug.final.reservedUse, oldCode, oldCode);
  }
});

test("every site has a dry, same-country, grade-bounded road branch consumed by final surface", () => {
  assert.equal(siteAccessRoads.length, criticalSites.length);
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode),
      parent = roads.find((road) => road.code === site.access.roadCode);
    assert.ok(branch, site.code);
    assert.ok(parent, site.code);
    assert.ok(roads.some((road) => road.code === branch.code), site.code);
    assert.ok(site.access.lengthM > 0, site.code);
    const dx = wrapSourceX(site.access.x - site.x), dz = site.access.z - site.z,
      segmentSource = Math.hypot(dx, dz) / 16,
      segmentM = Math.max(1, segmentSource * CANONICAL_METRES_PER_SOURCE_UNIT);
    let previousHeight = naturalSurfaceAt(site.x, site.z).groundHeight;
    for (let sample = 0; sample <= 16; sample++) {
      const t = sample / 16, x = wrapSourceX(site.x + dx * t), z = site.z + dz * t,
        natural = naturalSurfaceAt(x, z);
      assert.equal(natural.water.kind, "none", `${site.code} access water ${sample}`);
      assert.equal(natural.walkable, true, `${site.code} access walkability ${sample}`);
      assert.ok(natural.freshwaterDistanceSource > 3.7, `${site.code} access freshwater ${sample}`);
      assert.equal(countryAtPosition(sourceToLonLat(x, z))?.code, site.countryCode, `${site.code} access country ${sample}`);
      for (const place of places)
        assert.ok(sourceDistance(x, z, place.x, place.z) >= placeReservationRadius(place.kind) + 8, `${site.code} access settlement ${place.code}`);
      if (sample > 0) assert.ok(Math.abs(natural.groundHeight - previousHeight) / segmentM <= 0.1400001, `${site.code} access grade ${sample}`);
      previousHeight = natural.groundHeight;
    }
    assert.ok(roadDistanceAt(site.access.x, site.access.z, parent) < 1e-7, site.code);
    const branchDistance = Math.hypot(dx, dz), probeT = branchDistance === 0 ? 0 : Math.min(0.75, (SITE_SUPPORT_SOURCE_UNITS + 2) / branchDistance),
      probe = finalSurfaceDebugAt(wrapSourceX(site.x + dx * probeT), site.z + dz * probeT);
    assert.ok(probe.modifiers.some((modifier) => modifier.id === branch.code), site.code);
    assert.equal(probe.final.walkable, true, site.code);
  }
});

test("physical site geometry is local/lazy while broad views stay semantic", () => {
  for (const site of criticalSites.slice(0, Math.min(16, criticalSites.length))) {
    const localTile = tileForPosition(site.x, site.z, 11), coarseTile = tileForPosition(site.x, site.z, 8),
      local = featuresFor(localTile), coarse = featuresFor(coarseTile);
    assert.equal(localTile.size, 128);
    assert.ok(local.some((feature) => feature.code.includes(site.code)), `${site.code} missing local geometry`);
    assert.ok(!coarse.some((feature) => feature.code.includes(site.code)), `${site.code} eagerly emitted at coarse zoom`);
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
