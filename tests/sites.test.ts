import test from "node:test";
import assert from "node:assert/strict";
import { appendCriticalSiteGeometry } from "../src/site-geometry.ts";
import type { Geometry, TileGeometry } from "../src/geometry.ts";
import {
  countries,
  countryAtPosition,
  places,
  roadDistanceAt,
  roads,
} from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { transportNetwork } from "../src/transport-network.ts";
import { composeSiteTransportNetwork, siteTransportAcceptanceSummary, siteTransportNetwork, siteAccessRoadsNear } from "../src/site-transport-network.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAcceptanceSummary,
  siteAccessRoads,
  siteSurfaceSample,
} from "../src/sites.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
} from "../src/planet.ts";
import { politicalSettlementSitePlans } from "../src/political-settlement-access.ts";
import {
  featuresFor,
  finalSurfaceAt,
  finalSurfaceDebugAt,
} from "../src/world.ts";

function segmentDistanceM(
  position: CanonicalPosition,
  from: CanonicalPosition,
  to: CanonicalPosition,
) {
  const p = lonLatToSource(position.lon, position.lat),
    a = lonLatToSource(from.lon, from.lat),
    b = lonLatToSource(to.lon, to.lat),
    dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(p.x - a.x),
    qz = p.z - a.z,
    denominator = dx * dx + dz * dz,
    t = denominator > 0 ? Math.max(0, Math.min(1, (qx * dx + qz * dz) / denominator)) : 0;
  return Math.hypot(qx - dx * t, qz - dz * t) * CANONICAL_METRES_PER_SOURCE_UNIT;
}

test("S005 site-access branches join the same canonical source road graph as physical rendering", () => {
  const network = siteTransportNetwork,
    summary = siteTransportAcceptanceSummary(),
    nodes = new Map(network.nodes.map(node => [node.sourceId, node])),
    edges = new Map(network.roadEdges.map(edge => [edge.code, edge])),
    physical = new Map(siteAccessRoads.map(road => [road.code, road]));
  assert.equal(summary.siteNodes, criticalSites.length);
  assert.equal(summary.siteAccessBranches, siteAccessRoads.length);
  assert.equal(network.nodes.length, transportNetwork.nodes.length + criticalSites.length);
  assert.equal(network.roadEdges.length, transportNetwork.roadEdges.length + siteAccessRoads.length);
  assert.equal(nodes.size, network.nodes.length, "no duplicate graph identities");
  assert.equal(edges.size, network.roadEdges.length, "no duplicate physical graph edges");
  for (const site of criticalSites) {
    const node = nodes.get(site.code),
      edge = edges.get(site.access.branchCode),
      parent = edges.get(site.access.roadCode),
      road = physical.get(site.access.branchCode),
      junction = nodes.get(road!.to);
    assert.equal(node?.kind, "site", site.code);
    assert.ok(edge && parent && road && junction, `${site.code} needs physical and graph path`);
    assert.equal(edge.from, node!.code, site.code);
    assert.equal(edge.to, junction!.code, site.code);
    assert.ok(parent.from === edge.to || parent.to === edge.to,
      `${site.code} must join an existing parent edge at its actual node`);
    assert.equal(edge.surfaceLengthM, road.surfaceLengthM, site.code);
    assert.equal(edge.fantasyWalkSeconds, road.fantasyWalkSeconds, site.code);
    assert.equal(edge.centerline[0].position.lon, node!.position.lon, site.code);
    assert.equal(edge.centerline.at(-1)!.position.lon, junction!.position.lon, site.code);
    const local = siteAccessRoadsNear(site.x, site.z, 128, 160);
    assert.ok(local.some(candidate => candidate.code === road.code),
      `${site.code} physically near access must be included in bounded inspection`);
  }
  const rebuilt = composeSiteTransportNetwork(
    transportNetwork, [...criticalSites].reverse(), [...siteAccessRoads].reverse());
  assert.equal(rebuilt.digest, network.digest, "canonical site graph cannot depend on registry visitation order");
  assert.deepEqual(rebuilt.roadEdges.map(edge => edge.code), network.roadEdges.map(edge => edge.code));
});

test("critical-site registry scales with the actual country registry", () => {
  const summary = siteAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.sites, countries.length * 2);
  assert.equal(summary.ruins, countries.length);
  assert.equal(summary.criticalPlaces, countries.length);
  assert.equal(summary.accessBranches, summary.sites);
  assert.equal(new Set(criticalSites.map((site) => site.code)).size, criticalSites.length);
  assert.equal(new Set(siteAccessRoads.map((road) => road.code)).size, siteAccessRoads.length);
  assert.equal(summary.maxCutM, 3);
  assert.equal(summary.maxFillM, 3);
});

test("every critical site is dry, same-country and joined to a canonical road junction", () => {
  for (const site of criticalSites) {
    const macro = macroSampleAt(site.canonicalPosition),
      owner = countryAtPosition(site.canonicalPosition),
      parent = roads.find((road) => road.code === site.access.roadCode),
      branch = siteAccessRoads.find((road) => road.code === site.access.branchCode);
    assert.equal(macro.land, true, site.code);
    assert.notEqual(macro.domain, "Lake", site.code);
    assert.equal(owner?.code, site.countryCode, site.code);
    assert.ok(site.access.lengthM >= 500 && site.access.lengthM <= 1800, site.code);
    assert.ok(parent, `${site.code} missing parent road`);
    assert.ok(branch, `${site.code} missing materialized SITE/ACCESS branch`);
    assert.ok(
      !roads.includes(branch!),
      `${site.code} access branch must not weaken the inter-village road invariant`,
    );
    assert.ok(
      site.access.roadT === 0 || site.access.roadT === 1,
      `${site.code} access must join an existing canonical parent-road node`,
    );
    const endpoint = site.access.roadT === 0
      ? {
          id: parent!.from,
          x: parent!.fromX,
          z: parent!.fromZ,
          position: parent!.fromPosition,
        }
      : {
          id: parent!.to,
          x: parent!.toX,
          z: parent!.toZ,
          position: parent!.toPosition,
        };
    assert.ok(endpoint.id.startsWith("J/"), `${site.code} must attach outside settlement anchors`);
    assert.equal(branch!.from, site.code, `${site.code} branch origin identity must be the site`);
    assert.equal(branch!.to, endpoint.id, `${site.code} branch must terminate at the parent node`);
    assert.deepEqual(
      branch!.fromPosition,
      site.canonicalPosition,
      `${site.code} branch origin identity/geometry mismatch`,
    );
    assert.deepEqual(
      branch!.toPosition,
      endpoint.position,
      `${site.code} branch endpoint identity/geometry mismatch`,
    );
    assert.ok(
      Math.abs(wrapSourceX(branch!.toX - endpoint.x)) < 1e-9 &&
        Math.abs(branch!.toZ - endpoint.z) < 1e-9,
      `${site.code} branch misses its parent road node`,
    );
    assert.ok(
      places.every(
        (place) => greatCircleDistance(site.canonicalPosition, place.canonicalPosition) >= 650,
      ),
      `${site.code} overlaps a settlement reserve`,
    );

    const supportM = site.radiusM + site.falloffM,
      roadClearanceSource = supportM / CANONICAL_METRES_PER_SOURCE_UNIT + 12;
    for (const plan of politicalSettlementSitePlans) {
      assert.ok(
        greatCircleDistance(site.canonicalPosition, plan.centre) >=
          plan.envelopeRadiusM + supportM,
        `${site.code} site support overlaps ${plan.placeCode} envelope`,
      );
      assert.ok(
        segmentDistanceM(site.canonicalPosition, plan.centre, plan.entrance) >= supportM,
        `${site.code} site support overlaps ${plan.placeCode} entrance reservation`,
      );
    }
    assert.ok(
      roads.every((road) => roadDistanceAt(site.x, site.z, road) >= roadClearanceSource),
      `${site.code} prepared support overlaps an established road reservation`,
    );
  }
});

test("priority-9 prepared footprints remain legal dry same-country ground", () => {
  for (const site of criticalSites) {
    const support = (site.radiusM + site.falloffM) / CANONICAL_METRES_PER_SOURCE_UNIT;
    for (let index = 0; index < 8; index++) {
      const angle = (index * Math.PI) / 4,
        x = site.x + Math.cos(angle) * support,
        z = site.z + Math.sin(angle) * support,
        natural = naturalSurfaceAt(x, z),
        owner = countryAtPosition(sourceToLonLat(x, z));
      assert.equal(natural.water.kind, "none", `${site.code} support crosses water at ${index}`);
      assert.equal(natural.walkable, true, `${site.code} support is not walkable at ${index}`);
      assert.equal(owner?.code, site.countryCode, `${site.code} support crosses political ownership`);
    }
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
    signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}/${site.preparedHeightM}`,
  }));
  assert.deepEqual(
    [...criticalSites].reverse().reverse().map((site) => ({
      code: site.code,
      kind: site.kind,
      x: site.x,
      z: site.z,
      road: site.access.roadCode,
      branch: site.access.branchCode,
      t: site.access.roadT,
      signature: `${site.archetype}/${site.variant}/${site.radiusM}/${site.falloffM}/${site.preparedHeightM}`,
    })),
    snapshot,
  );
});

test("focused site queries are bounded and do not materialize the planet", () => {
  for (const site of criticalSites.slice(0, 12)) {
    const nearby = nearbyCriticalSites(site.x, site.z, 5000, 7);
    assert.ok(nearby.length >= 1);
    assert.ok(nearby.length <= 7);
    assert.equal(nearby[0].code, site.code);
  }
});

test("priority-9 preparation is consumed by shared final surface", () => {
  for (const site of criticalSites.slice(0, 12)) {
    const naturalHeight = site.preparedHeightM + 40,
      prepared = siteSurfaceSample(site, site.x, site.z, naturalHeight);
    assert.equal(prepared.influence, 1);
    assert.ok(Math.abs(prepared.height - naturalHeight) <= 3.000001);

    const debug = finalSurfaceDebugAt(site.x, site.z),
      modifier = debug.modifiers.find((item) => item.id === `${site.code}/PAD`);
    assert.ok(modifier, `${site.code} has no priority-9 final-surface modifier`);
    assert.equal(modifier!.priority, 9);
    assert.equal(debug.final.reservedUse, site.code);
    assert.equal(debug.final.walkable, true);
    assert.equal(debug.final.vegetationDensityScale, 0);
    assert.equal(debug.final.water.kind, "none");
  }
});

test("every site access branch remains contiguous, reservation-safe, walkable and joined", () => {
  const accessClearanceM = 12 * CANONICAL_METRES_PER_SOURCE_UNIT;
  for (const site of criticalSites) {
    const branch = siteAccessRoads.find((road) => road.code === site.access.branchCode)!,
      parent = roads.find((road) => road.code === site.access.roadCode)!,
      dx = wrapSourceX(site.access.x - site.x),
      dz = site.access.z - site.z;
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 0.98, 1]) {
      const x = site.x + dx * t,
        z = site.z + dz * t,
        position = sourceToLonLat(x, z),
        surface = finalSurfaceAt(x, z);
      assert.ok(roadDistanceAt(x, z, branch) < 1e-6, `${site.code} discontinuous at ${t}`);
      assert.equal(surface.walkable, true, `${site.code} access is not walkable at ${t}`);
      assert.equal(surface.water.kind, "none", `${site.code} access crosses water at ${t}`);
      assert.ok(
        surface.contributingModifierIds.includes(branch.code) || t === 1,
        `${site.code} access is absent from final surface at ${t}`,
      );
      for (const plan of politicalSettlementSitePlans) {
        assert.ok(
          greatCircleDistance(position, plan.centre) >=
            plan.envelopeRadiusM + accessClearanceM,
          `${site.code} access overlaps ${plan.placeCode} envelope at ${t}`,
        );
        assert.ok(
          segmentDistanceM(
            { lon: position.lon, lat: position.lat, elevation: 0 },
            plan.centre,
            plan.entrance,
          ) >= accessClearanceM,
          `${site.code} access overlaps ${plan.placeCode} entrance reservation at ${t}`,
        );
      }
    }
    const junction = finalSurfaceAt(site.access.x, site.access.z);
    assert.ok(
      roadDistanceAt(site.access.x, site.access.z, branch) < 1e-9,
      `${site.code} branch misses its canonical junction`,
    );
    assert.ok(
      roadDistanceAt(site.access.x, site.access.z, parent) < 1e-9,
      `${site.code} canonical junction misses parent road ${site.access.roadCode}`,
    );
    assert.equal(junction.walkable, true, `${site.code} canonical junction is not walkable`);
    assert.equal(junction.water.kind, "none", `${site.code} canonical junction is submerged`);
  }
});

test("local tiles materialize deterministic distinct ruin and critical-place stone forms", () => {
  const examples = [
    criticalSites.find((site) => site.kind === "ruin")!,
    criticalSites.find((site) => site.kind === "critical-place")!,
  ];
  const layouts = examples.map((site) => {
    const tile = {
        level: 10,
        x: 0,
        z: 0,
        key: `site-test/${site.code}`,
        size: 256,
        minX: site.x - 128,
        minZ: site.z - 128,
      },
      features = featuresFor(tile).filter((feature) => feature.code.includes(`/site/${site.code}/`));
    assert.ok(features.length >= 4, `${site.code} has no focused 3D detail`);
    return features.map((feature) => [
      Math.round(feature.x - site.x),
      Math.round(feature.z - site.z),
    ]);
  });
  assert.notDeepEqual(layouts[0], layouts[1]);
});


test("site focus queries match canonical distance truth across bucket edges and wrapped coordinates", () => {
  for (const site of criticalSites) for (const radius of [0, 16, 512, 1024])
    for (const x of [site.x, site.x + 511, site.x - 511, site.x + SOURCE_PRESENTATION_WIDTH, site.x - SOURCE_PRESENTATION_WIDTH]) {
      const distance = (value: typeof site) => Math.hypot(wrapSourceX(value.x - x), value.z - site.z);
      const expected = criticalSites.filter(value => distance(value) <= radius)
        .sort((a, b) => distance(a) - distance(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
        .slice(0, 24).map(value => value.code);
      assert.deepEqual(nearbyCriticalSites(x, site.z, radius).map(value => value.code), expected);
    }
});

test("focused ruin and shrine meshes have deterministic visible silhouettes within a bounded detail budget", () => {
  const empty = (): Geometry => ({
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Uint8Array(0),
    indices: new Uint32Array(0),
  });
  for (const kind of ["ruin", "critical-place"] as const) {
    const site = criticalSites.find(value => value.kind === kind)!,
      tile = {
        level: 10, x: 0, z: 0, key: `site-geometry/${site.code}`,
        size: 128, minX: site.x - 64, minZ: site.z - 64,
      };
    const build = () => {
      const data: TileGeometry = {
        terrain: empty(), structures: empty(), nature: empty(), detail: empty(),
      };
      const summary = appendCriticalSiteGeometry(tile, data);
      return { summary, positions: data.structures.positions, colors: data.structures.colors,
        triangles: data.structures.indices.length / 3 };
    };
    const first = build(), again = build();
    assert.ok(first.summary.codes.includes(site.code), `${kind} mesh missing`);
    assert.ok(first.triangles > 0 && first.triangles < 600, `${kind} exceeds close-detail budget`);
    const y = [...first.positions].filter((_, index) => index % 3 === 1);
    assert.ok(Math.max(...y) - Math.min(...y) > 5, `${kind} silhouette is too flat`);
    assert.ok([...first.colors].some((value, index) => index % 4 === 0 && value >= 170),
      `${kind} lacks readable contrasting stone`);
    assert.deepEqual(first.summary.codes, again.summary.codes);
    assert.deepEqual(first.positions, again.positions);
    assert.deepEqual(first.colors, again.colors);
    assert.equal(first.triangles, again.triangles);
  }
});
