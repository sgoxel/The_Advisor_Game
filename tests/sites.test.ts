import assert from "node:assert/strict";
import test from "node:test";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAccessRoads,
  siteAcceptanceSummary,
  sitePadRoads,
} from "../src/sites.ts";
import { countries, countryAtPosition, roadDistanceAt, roads } from "../src/geography.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import { WORLD_BUILDING_PRIORITIES, composeFinalSurface } from "../src/final-surface.ts";

const emptyBase = {
  groundHeight: 12,
  material: "Meadow" as const,
  water: { kind: "none" as const, level: -Infinity, flowX: 0, flowZ: 0 },
  walkable: true,
  vegetationDensityScale: 1,
  reservedUse: null,
};

test("critical sites have stable country-owned identities and bounded registry size", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.accessBranches, criticalSites.length);
  assert.equal(summary.preparedPads, criticalSites.length);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  for (const country of countries) {
    const owned = criticalSites.filter((site) => site.countryCode === country.code);
    assert.equal(owned.length, 2, `${country.code} must own one ruin and one critical place`);
    assert.deepEqual(owned.map((site) => site.kind).sort(), ["critical-place", "ruin"]);
  }
});

test("accepted site cores are dry, walkable, owned, and separated from water authority", () => {
  for (const site of criticalSites) {
    const natural = naturalSurfaceAt(site.x, site.z),
      owner = countryAtPosition(site.canonicalPosition);
    assert.equal(owner?.code, site.countryCode);
    assert.equal(natural.water.kind, "none", `${site.code} centre must remain dry`);
    assert.equal(natural.walkable, true, `${site.code} centre must remain naturally usable`);
    assert.ok(natural.groundHeight > 0.1);
    assert.ok(Math.abs(natural.groundHeight - site.preparedHeightM) < 1e-9);
  }
});

test("every site has one real road branch and one bounded priority-9 pad identity", () => {
  assert.equal(siteAccessRoads.length, criticalSites.length);
  assert.equal(sitePadRoads.length, criticalSites.length);
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode),
      parent = roads.find((road) => road.code === site.access.roadCode),
      pad = sitePadRoads.find((road) => road.code === `${site.code}/PAD`);
    assert.ok(branch);
    assert.ok(parent);
    assert.ok(pad);
    assert.ok(site.access.lengthM >= 600 && site.access.lengthM <= 1800);
    assert.ok(roadDistanceAt(site.access.x, site.access.z, parent!) < 1e-6);
    assert.equal(branch!.surfaceLengthM, site.access.lengthM);
    assert.equal(pad!.surfaceLengthM, 0);
  }

  const sampleSite = criticalSites[0],
    final = composeFinalSurface(emptyBase, [
      {
        id: `${sampleSite.code}/PAD`,
        priority: WORLD_BUILDING_PRIORITIES.road,
        targetGroundHeight: 13,
        material: "Road",
        walkable: true,
        vegetationDensityScale: 0,
        reservedUse: `${sampleSite.code}/PAD`,
      },
    ]);
  assert.equal(final.groundMaterial, "Settlement");
  assert.equal(final.reservedUse, sampleSite.code);
  assert.equal(final.vegetationDensityScale, 0);
});

test("main-thread final surface consumes pre-registered site pads and access roads", async () => {
  const { finalSurfaceAt } = await import("../src/world.ts"),
    site = criticalSites[0],
    centre = finalSurfaceAt(site.x, site.z),
    mx = site.x + (site.access.x - site.x) * 0.5,
    mz = site.z + (site.access.z - site.z) * 0.5,
    access = finalSurfaceAt(mx, mz);
  assert.equal(centre.groundMaterial, "Settlement");
  assert.equal(centre.reservedUse, site.code);
  assert.equal(centre.walkable, true);
  assert.ok(centre.contributingModifierIds.includes(`${site.code}/PAD`));
  assert.equal(access.walkable, true);
  assert.ok(access.contributingModifierIds.includes(site.access.branchCode));
});

test("site spatial queries are deterministic, distance ordered, and bounded", () => {
  const origin = criticalSites[0],
    a = nearbyCriticalSites(origin.x, origin.z, 5000, 12),
    b = nearbyCriticalSites(origin.x, origin.z, 5000, 12);
  assert.deepEqual(a.map((site) => site.code), b.map((site) => site.code));
  assert.ok(a.length <= 12);
  assert.equal(a[0]?.code, origin.code);
  for (let index = 1; index < a.length; index++) {
    const previous = Math.hypot(a[index - 1].x - origin.x, a[index - 1].z - origin.z),
      current = Math.hypot(a[index].x - origin.x, a[index].z - origin.z);
    assert.ok(current + 1e-9 >= previous);
  }
});

test("critical-site scene meshes exist only on close terrain LODs", async () => {
  const { appendCriticalSiteGeometry, SITE_GEOMETRY_MAX_TILE_SIZE } = await import("../src/site-geometry.ts"),
    { tileForPosition } = await import("../src/world.ts"),
    site = criticalSites[0],
    empty = () => ({
      positions: new Float32Array(),
      normals: new Float32Array(),
      colors: new Uint8Array(),
      indices: new Uint32Array(),
    }),
    farTile = tileForPosition(site.x, site.z, 10),
    closeTile = tileForPosition(site.x, site.z, 12),
    farData = { terrain: empty(), structures: empty(), nature: empty(), detail: empty() },
    closeData = { terrain: empty(), structures: empty(), nature: empty(), detail: empty() };
  assert.ok(farTile.size > SITE_GEOMETRY_MAX_TILE_SIZE);
  assert.equal(appendCriticalSiteGeometry(farTile, farData).meshes, 0);
  assert.ok(closeTile.size <= SITE_GEOMETRY_MAX_TILE_SIZE);
  const evidence = appendCriticalSiteGeometry(closeTile, closeData);
  assert.ok(evidence.meshes >= 1);
  assert.ok(closeData.structures.indices.length > 0);
});
