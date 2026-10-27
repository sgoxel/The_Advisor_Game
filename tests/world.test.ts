import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cellAt,
  finalSurfaceAt,
  finalSurfaceRenderChannelsAt,
  cellSeed,
  regionSeed,
  districtSeed,
  featuresFor,
  settlementFrontDoorWalkway,
  heightAt,
  selectTiles,
  tileAt,
  WORLD_SEED,
  WORLD_MIN,
  MAX_LEVEL,
} from "../src/world.ts";
import { buildTile } from "../src/geometry.ts";
import {
  continents,
  countries,
  cities,
  villages,
  roads,
  roadJunctions,
  roadNetworkTelemetry,
} from "../src/geography.ts";
import { MACRO_PLAN, macroSampleAt } from "../src/macro-geography.ts";
import { WORLD_FOUNDATION_VERSION } from "../src/config.ts";
import {
  CANONICAL_PLANET_CIRCUMFERENCE,
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
} from "../src/planet.ts";
import {
  DIFFICULT_TERRAIN_WALK_SPEED_MPS,
  GOOD_ROAD_WALK_SPEED_MPS,
  MIN_VILLAGE_FASTEST_DISTANCE_M,
  MIN_VILLAGE_WALK_FANTASY_SECONDS,
  OPEN_GROUND_WALK_SPEED_MPS,
  fantasyTravelSeconds,
  realSecondsForFantasy,
} from "../src/travel.ts";
import { LazySimulation, summaryAt, residentAt, populationOf } from "../src/simulation.ts";
import { FantasyClock, TIME_SCALE } from "../src/clock.ts";


test("S009 render-only mesh channels match canonical water, height and material without changing legal traversal", () => {
  const anchors = [
    ...villages.slice(0, 3).map(place => ({ x: place.x, z: place.z })),
    ...roads.slice(0, 3).map(road => ({ x: road.fromX, z: road.fromZ })),
    ...MACRO_PLAN.continents.slice(0, 2).map(item => lonLatToSource(item.center.lon, item.center.lat)),
    ...MACRO_PLAN.lakes.slice(0, 2).map(item => lonLatToSource(item.center.lon, item.center.lat)),
    lonLatToSource(0, Math.PI / 2),
  ];
  let wet = 0;
  for (const { x, z } of anchors) {
    const sampled = finalSurfaceRenderChannelsAt(x, z);
    const authoritative = finalSurfaceAt(x, z);
    assert.deepEqual(
      { groundHeight: sampled.groundHeight, groundMaterial: sampled.groundMaterial, water: sampled.water },
      { groundHeight: authoritative.groundHeight, groundMaterial: authoritative.groundMaterial, water: authoritative.water },
      `renderer and Simulation must share exact SEED channels at ${x},${z}`,
    );
    if (sampled.water.kind !== "none") wet++;
    assert.deepEqual(finalSurfaceAt(x, z), authoritative,
      "render-only query cannot mutate cached traversal or walkability");
  }
  assert.ok(wet > 0, "test must include canonical natural water");
});

test("real front-wall doorstep approaches never enter a house or jump to a side street", () => {
  const metre = 1 / (2 * Math.PI * 637100 / 262144);
  const door = { x: 0, z: 0 };
  const street = (x: number, z: number) => ({ x: x * metre, z: z * metre, width: 2 * metre });
  const front = settlementFrontDoorWalkway(door, 0, street(0, 8));
  assert.ok(front, "a genuine street ahead of the painted wall admits an outward walkway");
  assert.ok(Math.abs(front.x) < 1e-9 && Math.abs(front.z / metre - 3.5) < 1e-6,
    "walkway is centred between the actual front-wall entrance and road edge");
  assert.ok(Math.abs(front.length / metre - 7) < 1e-6,
    "length excludes the road surface, never the width of the house");
  assert.equal(settlementFrontDoorWalkway(door, 0, street(8, 0)), null,
    "nearby junction side street may not draw a path through the house");
  assert.equal(settlementFrontDoorWalkway(door, 0, street(0, -8)), null,
    "road behind the building cannot become its front-wall approach");
  assert.ok(settlementFrontDoorWalkway(door, Math.PI / 2, street(8, 0)),
    "a correctly rotated SEED house keeps a corresponding legal frontage");
  const highLat = { x: 120, z: 24000 }, cosLat = Math.cos(24000 / 262144 * 2 * Math.PI),
    eastEightMetres = 8 * metre / cosLat;
  const polarFront = settlementFrontDoorWalkway(highLat, Math.PI / 2,
    { x: highLat.x + eastEightMetres, z: highLat.z, width: 2 * metre });
  assert.ok(polarFront && Math.abs(polarFront.length / metre - 7) < .001,
    "high-latitude doorway remains seven physical metres from the road edge");
  assert.equal(settlementFrontDoorWalkway(door, 0, street(0, 1)), null,
    "sub-metre gaps do not add a decorative walkway into a street");
});

test("reloading cells in reverse order preserves all canonical content", () => {
  const coords = [
    [-203, -201],
    [-1, -1],
    [0, 0],
    [199, 199],
    [200, 200],
    [819, 1337],
  ];
  const baseline = coords.map(([x, z]) => cellAt(x, z));
  for (let i = coords.length - 1; i >= 0; i--)
    assert.deepEqual(cellAt(...(coords[i] as [number, number])), baseline[i]);
  assert.equal(new Set(baseline.map((c) => c.code)).size, coords.length);
  assert.equal(cellAt(-0.1, -0.1).x, -1);
  assert.match(
    cellAt(1, 1).code,
    /L1\/0\/0\/L2\/0\/0\/L3\/0\/0\/L4\/0\/0\/L5\/0\/0$/,
  );
});
test("all five source-detail seed levels compose correctly across negative boundaries", () => {
  for (const cx of [-101, -100, -11, -10, -1, 0, 9, 10, 99, 100])
    for (const cz of [-101, -1, 0, 100]) {
      const c = cellSeed(cx, cz),
        p = c.parent,
        d = p.parent,
        r = d.parent;
      assert.ok(c.x >= 0 && c.x < 2 && c.z >= 0 && c.z < 2);
      assert.ok(p.x >= 0 && p.x < 5 && p.z >= 0 && p.z < 5);
      assert.ok(d.x >= 0 && d.x < 10 && d.z >= 0 && d.z < 10);
      assert.equal(r.x * 100 + d.x * 10 + p.x * 2 + c.x, cx);
      assert.equal(r.z * 100 + d.z * 10 + p.z * 2 + c.z, cz);
      assert.ok(c.code.startsWith(p.code));
      assert.ok(p.code.startsWith(d.code));
      assert.ok(d.code.startsWith(r.code));
      assert.ok(r.code.startsWith(r.parent.code));
      assert.equal(d.code, districtSeed(cx, cz).code);
      assert.equal(r.code, regionSeed(cx, cz).code);
    }
});
test("source-detail regions inherit seeded macro land, island, lake and ocean authority", () => {
  const anchors = [
    ...MACRO_PLAN.continents.map((item) => item.center),
    ...MACRO_PLAN.islands.slice(0, 6).map((item) => item.center),
    ...MACRO_PLAN.lakes.slice(0, 3).map((item) => item.center),
    { lon: 0, lat: Math.PI / 2 },
  ];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const source = lonLatToSource(anchor.lon, anchor.lat),
      region = regionSeed(source.x / 2, source.z / 2),
      center = sourceToLonLat(region.x * 200 + 100, region.z * 200 + 100),
      macro = macroSampleAt(center),
      h = heightAt(source.x, source.z);
    seen.add(macro.domain);
    assert.equal(region.landform, macro.domain);
    if (macroSampleAt(anchor).land) assert.ok(h > 0);
    else assert.ok(h < 0);
  }
  assert.ok(seen.has("Mainland"));
  assert.ok(seen.has("Island"));
  assert.ok(seen.has("Lake"));
  assert.ok(seen.has("Ocean"));
});
test("render tiles cover the view without overlapping parent and child areas", () => {
  for (const halfHeight of [28, 97, 500, 3000]) {
    const view = { x: 0, z: 0, halfHeight, aspect: 1.7, yaw: 0, pixels: 768 };
    const tiles = selectTiles(view);
    assert.ok(tiles.length > 0 && tiles.length < 230);
    for (let i = 0; i < tiles.length; i++)
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i],
          b = tiles[j];
        assert.ok(
          a.minX + a.size <= b.minX ||
            b.minX + b.size <= a.minX ||
            a.minZ + a.size <= b.minZ ||
            b.minZ + b.size <= a.minZ,
        );
      }
    for (let z = -halfHeight; z <= halfHeight; z += halfHeight / 5)
      for (
        let x = -halfHeight * 1.7;
        x <= halfHeight * 1.7;
        x += halfHeight / 5
      ) {
        if (
          x >= WORLD_MIN &&
          x < -WORLD_MIN &&
          z >= WORLD_MIN &&
          z < -WORLD_MIN
        )
          assert.ok(
            tiles.some(
              (t) =>
                x >= t.minX &&
                x < t.minX + t.size &&
                z >= t.minZ &&
                z < t.minZ + t.size,
            ),
          );
      }
  }
});
test("feature identity survives LOD changes and adjacent tile ownership is unique", () => {
  const parent = tileAt(12, 2048, 2048),
    a = tileAt(13, 4096, 4096),
    b = tileAt(13, 4097, 4096),
    c = tileAt(13, 4096, 4097),
    d = tileAt(13, 4097, 4097);
  const coarse = featuresFor(parent);
  const fine = [a, b, c, d].flatMap(featuresFor);
  assert.equal(new Set(fine.map((f) => f.code)).size, fine.length);
  assert.deepEqual(
    [...coarse].sort((a, b) => a.code.localeCompare(b.code)),
    fine.sort((a, b) => a.code.localeCompare(b.code)),
  );
  const mesh = buildTile(a),
    again = buildTile(a);
  assert.deepEqual(mesh, again);
  assert.ok(mesh.terrain.positions.every(Number.isFinite));
  assert.ok(mesh.terrain.positions.length > 0);
});

test("Alderwick retains legal S004 morphology across tile ownership", async () => {
  const { villages } = await import("../src/geography.ts");
  const { canonicalSettlementPopulation } = await import("../src/settlement-exterior.ts");
  const { finalSurfaceAt, tileForPosition } = await import("../src/world.ts");
  const place = villages[0], tiles = new Map<string, ReturnType<typeof tileForPosition>>();
  for (let dz = -192; dz <= 192; dz += 32) for (let dx = -192; dx <= 192; dx += 32) {
    const tile = tileForPosition(place.x + dx, place.z + dz, 13);
    tiles.set(tile.key, tile);
  }
  const marker = `/F/${place.id}/`,
    features = [...tiles.values()].flatMap(featuresFor).filter((feature) => feature.code.includes(marker)),
    residences = features.filter((feature) => feature.kind === "residence");
  assert.equal(new Set(features.map((feature) => feature.code)).size, features.length);
  assert.ok(residences.length > 0, "starting village must materialize visible canonical residences");
  assert.ok(residences.length < canonicalSettlementPopulation(place), "visible residence meshes must remain bounded below canonical population");
  for (const kind of ["keep", "field", "service", "street", "gate"])
    assert.ok(features.some((feature) => feature.kind === kind), `missing ${kind}`);
  for (const feature of features.filter((item) => ["residence", "service", "keep", "field"].includes(item.kind))) {
    const surface = finalSurfaceAt(feature.x, feature.z);
    assert.equal(surface.water.kind, "none", `${feature.kind} must remain dry`);
    assert.ok(surface.walkable, `${feature.kind} must remain walkable`);
  }
});
test("S006 legally resolved guard homes remain rendered at coarser Street LOD", async () => {
  const { resolvedSettlementHomeDoorFor, tileForPosition } = await import("../src/world.ts");
  const { metresToSource } = await import("../src/physical-scale.ts");
  const place = villages[0], index = 7, door = resolvedSettlementHomeDoorFor(place, index);
  assert.ok(door, "fixture requires a physical SEED-owned guard doorway");
  // Level 11 is 128 source units and ordinary village home stride is 2.
  // Guard index 7 used to be removed solely by its odd index, even after its
  // actual lawful SEED frontage and possible replacement lot were resolved.
  const tiles = new Map<string, ReturnType<typeof tileForPosition>>();
  for (const dx of [-metresToSource(12), metresToSource(12)])
    for (const dz of [-metresToSource(12), metresToSource(12)]) {
      const tile = tileForPosition(door.x + dx, door.z + dz, 11);
      tiles.set(tile.key, tile);
    }
  const visible = [...tiles.values()].flatMap(featuresFor).filter(feature =>
    feature.kind === "residence" && feature.ownerId === `${place.code}/RESIDENT/${index}`);
  assert.equal(visible.length, 1, "a legal guard door must have exactly one rendered SEED-owned home at the same LOD");
  assert.equal(new Set(visible.map(feature => feature.code)).size, 1, "adjacent LOD tile ownership stays unique");
});

test("application source contains no random-number API or clock-driven world generation", () => {
  for (const file of [
    "world.ts",
    "geometry.ts",
    "geography.ts",
    "macro-geography.ts",
    "climate.ts",
    "simulation.ts",
    "tile-worker.ts",
    "main.ts",
    "travel.ts",
  ]) {
    const source = readFileSync(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /Math\.random\s*\(|getRandomValues\s*\(|randomUUID\s*\(/,
    );
    if (file !== "main.ts")
      assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(/);
  }
  assert.equal(WORLD_SEED, "ADVISOR-0126-ALDERWICK");
});
test("three continents preserve owner minimum country, city and village counts", () => {
  assert.equal(continents.length, 3);
  assert.ok(countries.length >= 30);
  assert.ok(cities.length >= 90);
  assert.ok(villages.length >= 270);
  for (const continent of continents)
    assert.ok(countries.some((c) => c.continent === continent.id));
  for (const country of countries)
    assert.ok(
      cities.some(
        (c) => c.continent === country.continent && c.country === country.id,
      ),
    );
  for (const city of cities)
    assert.ok(villages.some((v) => v.id.startsWith(city.id + "/")));
  for (const place of [...cities, ...villages])
    assert.ok(
      heightAt(place.x, place.z) > 0.1,
      `${place.name} must be on land`,
    );
  assert.equal(SOURCE_PRESENTATION_WIDTH / 2 ** MAX_LEVEL, 2);
  assert.notEqual(SOURCE_PRESENTATION_WIDTH, CANONICAL_PLANET_CIRCUMFERENCE);
});

test("canonical scale/travel foundation is versioned and all village pairs satisfy the fastest-speed minimum", () => {
  assert.equal(WORLD_FOUNDATION_VERSION, "v5");
  assert.equal(CANONICAL_PLANET_RADIUS, 637_100);
  assert.equal(GOOD_ROAD_WALK_SPEED_MPS, 1);
  assert.equal(OPEN_GROUND_WALK_SPEED_MPS, 5 / 6);
  assert.ok(DIFFICULT_TERRAIN_WALK_SPEED_MPS < OPEN_GROUND_WALK_SPEED_MPS);
  assert.equal(MIN_VILLAGE_FASTEST_DISTANCE_M, 3600);
  assert.equal(MIN_VILLAGE_WALK_FANTASY_SECONDS, 3600);
  let pairs = 0,
    shortest = Infinity;
  for (let i = 0; i < villages.length; i++)
    for (let j = i + 1; j < villages.length; j++) {
      const distance = greatCircleDistance(
        villages[i].canonicalPosition,
        villages[j].canonicalPosition,
      );
      shortest = Math.min(shortest, distance);
      assert.ok(
        distance >= MIN_VILLAGE_FASTEST_DISTANCE_M,
        `${villages[i].code} ↔ ${villages[j].code} is only ${distance.toFixed(2)} m`,
      );
      pairs++;
    }
  assert.equal(pairs, (villages.length * (villages.length - 1)) / 2);
  assert.ok(shortest >= MIN_VILLAGE_FASTEST_DISTANCE_M);
});

test("physical road edges expose canonical distance and route-derived fantasy time", () => {
  for (const road of roads) {
    const expectedDistance = road.centerline
      ? road.centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(sourceToLonLat(road.centerline![index].x,road.centerline![index].z), sourceToLonLat(point.x,point.z)), 0)
      : greatCircleDistance(road.fromPosition, road.toPosition);
    assert.ok(Math.abs(road.surfaceLengthM - expectedDistance) < 1e-7);
    assert.ok(road.presentationLengthSourceUnits > 0);
    assert.equal(road.walkSurface, "good-road");
    assert.equal(road.walkSpeedMps, GOOD_ROAD_WALK_SPEED_MPS);
    assert.equal(road.fantasyWalkSeconds, road.surfaceLengthM);
    assert.equal(road.realWalkSeconds, road.fantasyWalkSeconds / TIME_SCALE);
    // Physical shared trunks may be short; the village-pair minimum is proven above.
    assert.ok(road.fantasyWalkSeconds > 0);
    assert.ok(
      fantasyTravelSeconds(road.surfaceLengthM, "open-ground") >
        road.fantasyWalkSeconds,
    );
    assert.ok(
      fantasyTravelSeconds(road.surfaceLengthM, "difficult-terrain") >
        fantasyTravelSeconds(road.surfaceLengthM, "open-ground"),
    );
    assert.equal(
      realSecondsForFantasy(road.fantasyWalkSeconds),
      road.realWalkSeconds,
    );
    for (let step = 0; step <= 10; step++) {
      const t = step / 10, station=road.centerline ? t*(road.centerline.length-1) : t,
        index=road.centerline ? Math.min(road.centerline.length-2,Math.floor(station)) : 0,
        from=road.centerline?.[index] || {x:road.fromX,z:road.fromZ},
        to=road.centerline?.[index+1] || {x:road.toX,z:road.toZ}, localT=road.centerline ? station-index : t,
        x = wrapSourceX(from.x+(to.x-from.x)*localT),
        z = from.z+(to.z-from.z)*localT;
      // Prototype records are candidate distance bounds, not a bypass of terrain truth.
      // The dedicated continuity corridor and routing suites prove actual legal travel.
      const cell=cellAt(x,z);
      const surface=finalSurfaceAt(Math.floor(x/2)*2+1,Math.floor(z/2)*2+1);
      if(surface.water.kind!=='none')assert.equal(cell.walkable,surface.deckHeight!==null,`${road.code} must not bypass water`);
    }
  }
});

test("active scale/travel source and UI contain no legacy physical-truth assumptions", () => {
  const sources = [
    "../src/config.ts",
    "../src/geography.ts",
    "../src/simulation.ts",
    "../src/travel.ts",
    "../src/travel-ui.ts",
    "../index.html",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /\bVILLAGE_SPACING_M\b/);
  assert.doesNotMatch(combined, /\bWALK_SPEED_MPS\b/);
  assert.doesNotMatch(combined, /420 m by road/i);
  assert.doesNotMatch(combined, /1\.4\s*m\/s/i);
  assert.doesNotMatch(combined, /Five minutes on foot/i);
  assert.match(combined, /WORLD_FOUNDATION_VERSION/);
  assert.match(combined, /canonical route distance and fantasy travel time/i);
});

test("fantasy epoch maps 2026 to 0126 and advances one day per real hour, including offline", () => {
  const epoch = Date.parse("2026-10-07T08:48:29Z"),
    clock = new FantasyClock(epoch);
  assert.equal(clock.labelAt(epoch), "07.10.0126 · 11:48");
  assert.equal(clock.tickAt(epoch + 3600000), 86400);
  assert.equal(clock.labelAt(epoch + 3600000), "08.10.0126 · 11:48");
  assert.equal(clock.tickAt(epoch + 86400000), 24 * 86400);
  assert.equal(
    new FantasyClock(epoch).tickAt(epoch + 86400000),
    clock.tickAt(epoch + 86400000),
  );
  assert.equal(clock.tickAt(epoch - 1000), 0);
  assert.equal(TIME_SCALE, 24);
});
test("lazy country simulation catches up identically regardless of interest or elapsed steps", () => {
  const a = new LazySimulation(),
    b = new LazySimulation();
  a.setFocus(villages[0]);
  b.setFocus(villages[0]);
  for (let i = 0; i <= 10; i++) a.advance(i);
  b.advance(10);
  assert.deepEqual(a.residents, b.residents);
  assert.deepEqual(
    a.summaries.get(a.activeCountry),
    summaryWithLive(a.activeCountry, 10),
  );
  assert.ok(a.stats.residents > 0);
  assert.equal(a.stats.liveCountries, 1);
  const far = countries.find((c) => c.continent === 1)!;
  a.setInterest(far.code);
  a.advance(3600);
  assert.equal(
    a.summaries.get(far.code)!.grain,
    summaryAt(far.code, 3600).grain,
  );
  a.setFocus(villages.find((v) => v.continent === 1)!);
  a.advance(3601);
  assert.equal(a.stats.liveCountries, 1);
  assert.ok(a.stats.residents > 0);
  const home = a.residents.get(a.activeCountry)![0],
    place = [...cities, ...villages].find((p) => p.id === home.settlement)!;
  assert.deepEqual(home, residentAt(place, home.index, 3601));
  function summaryWithLive(code: string, tick: number) {
    return { ...summaryAt(code, tick), tier: "live" };
  }
});


test("larger country populations remain analytical with a bounded focused resident pool",()=>{
  const sim=new LazySimulation();
  for(const country of countries){
    const place=cities.find(c=>c.continent===country.continent&&c.country===country.id)!;
    sim.setFocus(place);sim.advance(sim.tick+1);
    assert.equal(sim.stats.activeScheduleRecords,0);
    assert.equal(sim.residents.size,1);
    assert.equal(sim.stats.residents,summaryAt(country.code,sim.tick).population);
    assert.ok(sim.stats.logicalResidents>0);
    // Off-screen residents retain exact SEED/time identities without resident records.
    assert.ok(!sim.residents.get(sim.activeCountry)!.some(r=>r.index===populationOf(place)-1));
    const remote=residentAt(place,populationOf(place)-1,sim.tick);
    assert.equal(remote.settlement,place.id);
    assert.ok(Number.isFinite(remote.position.lon)&&Number.isFinite(remote.position.lat));
  }
});

test('every generated fork has three separated nonparallel physical approach segments',()=>{
 const arms=new Map(roadJunctions.map(j=>[j.id,[] as {lon:number;lat:number}[]]));
 for(const road of roads){
  for(let i=1;i<road.centerline.length;i++)assert.ok(Math.abs(road.centerline[i].x-road.centerline[i-1].x)<SOURCE_PRESENTATION_WIDTH/2,road.code+' seam continuity');
  arms.get(road.from)?.push(road.centerline[1].position);
  arms.get(road.to)?.push(road.centerline.at(-2)!.position);
 }
 const azimuth=(p:{lon:number;lat:number},q:{lon:number;lat:number})=>Math.atan2(Math.sin(q.lon-p.lon)*Math.cos(q.lat),Math.cos(p.lat)*Math.sin(q.lat)-Math.sin(p.lat)*Math.cos(q.lat)*Math.cos(q.lon-p.lon));
 for(const j of roadJunctions){
  const rays=arms.get(j.id)!;assert.equal(rays.length,3,j.id);
  for(let i=0;i<3;i++)for(let k=i+1;k<3;k++){
   const d=azimuth(j.canonicalPosition,rays[i])-azimuth(j.canonicalPosition,rays[k]),angle=Math.abs(Math.atan2(Math.sin(d),Math.cos(d)))*180/Math.PI;
   assert.ok(angle>=45,`${j.id}: actual first-segment angle ${angle}`);
  }
 }
 for(let i=0;i<roadJunctions.length;i++)for(let k=i+1;k<roadJunctions.length;k++)assert.ok(greatCircleDistance(roadJunctions[i].canonicalPosition,roadJunctions[k].canonicalPosition)>=(roadJunctions[i].id.startsWith("J/LOCAL/")||roadJunctions[k].id.startsWith("J/LOCAL/")?1:300));
 assert.ok(roadNetworkTelemetry.maximumForkAttempts<=12);
});

test('all actual domestic settlement departures share stems below 45 degrees',()=>{
 const incident=new Map<string,{lon:number;lat:number}[]>(),
  az=(p:{lon:number;lat:number},q:{lon:number;lat:number})=>Math.atan2(Math.sin(q.lon-p.lon)*Math.cos(q.lat),Math.cos(p.lat)*Math.sin(q.lat)-Math.sin(p.lat)*Math.cos(q.lat)*Math.cos(q.lon-p.lon)),
  origins=new Map<string,{lon:number;lat:number}>();
 for(const r of roads.filter(r=>r.code.includes('/macro-roads-v2/')))for(const [id,p,q]of [[r.from,r.centerline[0],r.centerline[1]],[r.to,r.centerline.at(-1)!,r.centerline.at(-2)!]] as const){
  const rays=incident.get(id)||[];rays.push(q.position);incident.set(id,rays);origins.set(id,p.position);
 }
 for(const [id,rays]of incident)for(let i=0;i<rays.length;i++)for(let j=i+1;j<rays.length;j++){
  const d=az(origins.get(id)!,rays[i])-az(origins.get(id)!,rays[j]),angle=Math.abs(Math.atan2(Math.sin(d),Math.cos(d)))*180/Math.PI;
  assert.ok(angle>=45-1e-6,`${id}: unmerged actual departure ${angle}`);
 }
});
