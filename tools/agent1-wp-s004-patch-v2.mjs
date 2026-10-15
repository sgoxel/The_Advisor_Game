import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  const index = text.indexOf(before);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(before, index + 1) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return text.slice(0, index) + after + text.slice(index + before.length);
}
function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker), end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing range anchor: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

{
  const path = "src/geography.ts";
  let text = read(path);
  text = replaceOnce(
    text,
    "const MIN_CITIES_PER_COUNTRY = 3;\nconst MAX_CITIES_PER_COUNTRY = 4;\nconst MIN_VILLAGES_PER_CITY = 3;\nconst MAX_VILLAGES_PER_CITY = 4;",
    "const MIN_CITIES_PER_COUNTRY = 3;\nconst MIN_VILLAGES_PER_CITY = 3;",
    "remove fixed settlement maxima",
  );
  const targets = [
    "function cityTargetForCountry(country: Country) {",
    "  const capacity = habitatCapacityForCountry(country);",
    "  if (capacity < 11) return MIN_CITIES_PER_COUNTRY;",
    "  const densityBand = 18 + 12 * addressed(country.code + \"/CITY_DENSITY_BAND\"),",
    "    extra = 1 + Math.floor(Math.max(0, capacity - 11) / densityBand);",
    "  return MIN_CITIES_PER_COUNTRY + extra;",
    "}",
    "",
    "function villageTargetForSite(position: LonLat, country: Country, cityIndex: number) {",
    "  const water = freshwaterAccessAt(position),",
    "    climate = climateSampleAt(position),",
    "    countryCapacity = habitatCapacityForCountry(country),",
    "    supportsExtra = water.nearby || (climate.moisture >= 0.22 && countryCapacity >= 10),",
    "    seededDensity = addressed(country.code + \"/CITY/\" + cityIndex + \"/VILLAGE_DENSITY\");",
    "  if (!supportsExtra || seededDensity < 0.36) return MIN_VILLAGES_PER_CITY;",
    "  const support = Math.max(0, countryCapacity - 10) + (water.nearby ? 12 : 0) +",
    "      (climate.moisture >= 0.18 && climate.moisture <= 0.78 ? 6 : 0),",
    "    densityBand = 26 + 18 * addressed(country.code + \"/CITY/\" + cityIndex + \"/VILLAGE_DENSITY_BAND\"),",
    "    extra = 1 + Math.floor(support / densityBand);",
    "  return MIN_VILLAGES_PER_CITY + extra;",
    "}",
    "",
  ].join("\n");
  text = replaceBetween(text, "function cityTargetForCountry", "function interiorOwnershipScore", targets, "habitat settlement target functions");
  text = replaceOnce(
    text,
    '      const prefix = `VILLAGE/${city.id}/${v}/${attempt}`,\n        bearing = TAU * addressed(`${prefix}/bearing`),\n        distanceM = 6_000 + 72_000 * Math.sqrt(addressed(`${prefix}/distance`)),\n        waterCandidate =\n          attempt % 3 !== 2 ? freshwaterHabitatCandidate(waterSegments, prefix) : undefined,\n        candidate = waterCandidate\n          ? { ...waterCandidate, elevation: 0 }\n          : destination(city.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS),',
    '      const prefix = `VILLAGE/${city.id}/${v}/${attempt}`,\n        waterCandidate =\n          attempt % 3 !== 2 ? freshwaterHabitatCandidate(waterSegments, prefix) : undefined,\n        candidate = waterCandidate\n          ? { ...waterCandidate, elevation: 0 }\n          : attempt % 2 === 0\n            ? countryCenteredCandidate(country, prefix, attempt)\n            : continentCandidate(continents[country.continent], prefix, attempt),',
    "country-wide village candidate coverage",
  );
  text = replaceOnce(
    text,
    "        (selected.length > 0 &&\n          (macroFeatureDistanceM(candidate, selected[selected.length - 1]) > 55_000 ||\n            !dryOwnedConnectionFits(candidate, selected[selected.length - 1], country))) ||",
    "        (selected.length > 0 &&\n          !dryOwnedConnectionFits(candidate, selected[selected.length - 1], country)) ||",
    "remove village chain radius ceiling",
  );
  write(path, text);
}

{
  const path = "src/world.ts";
  let text = read(path);
  text = replaceOnce(
    text,
    'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";\n',
    'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";\nimport { settlementExteriorFor, type SettlementPlotPlan, type SettlementService } from "./settlement-exterior.ts";\n',
    "world settlement exterior import",
  );
  text = replaceOnce(
    text,
    'export type Feature = {\n  kind: "house" | "keep" | "tree" | "rock" | "field" | "well";\n  x: number;\n  z: number;\n  y: number;\n  code: string;\n  variant: number;\n};',
    'export type Feature = {\n  kind: "house" | "keep" | "tree" | "rock" | "field" | "well" | "service" | "street" | "border" | "gate" | "guard-post";\n  x: number;\n  z: number;\n  y: number;\n  code: string;\n  variant: number;\n  service?: SettlementService;\n  ownerId?: string;\n  capacity?: number;\n  residents?: number;\n  label?: string;\n  entranceX?: number;\n  entranceZ?: number;\n};',
    "world feature type",
  );
  const start = text.indexOf("export function featuresFor(tile: Tile): Feature[] {");
  const end = text.indexOf("export type View = {", start);
  if (start < 0 || end < 0) throw new Error("Missing featuresFor block");
  const replacement = `const settlementPlotAnchors = new Map<string, { x: number; z: number } | null>();

/** Tile-owned exterior features. Plan creation is deterministic and limited to nearby settlements. */
export function featuresFor(tile: Tile): Feature[] {
  const features: Feature[] = [];
  const plotAt = (kind: Feature["kind"], x: number, z: number) => {
    const surface = finalSurfaceAt(x, z);
    if (surface.groundHeight < .2 || surface.water.kind !== "none" || !surface.walkable) return null;
    if (["house", "keep", "well", "field", "service"].includes(kind)) {
      const radius = kind === "keep" ? 15 : kind === "field" ? 13 : kind === "house" ? 7 : kind === "service" ? 8 : 2;
      if (naturalSurfaceAt(x, z).freshwaterDistanceSource <= Math.SQRT2 * radius + 3.7 || surfaceRoadAt(x, z, radius + 5).distance <= radius + 5) return null;
      for (const [dx, dz] of [[-radius,-radius],[-radius,radius],[radius,radius],[radius,-radius],[0,-radius],[0,radius],[-radius,0],[radius,0]]) {
        const corner = finalSurfaceAt(x + dx, z + dz);
        if (corner.water.kind !== "none" || !corner.walkable || Math.abs(corner.groundHeight - surface.groundHeight) > (kind === "field" ? .1 : .25)) return null;
      }
    }
    return surface;
  };
  const add = (
    kind: Feature["kind"],
    x: number,
    z: number,
    variant: number,
    id: string,
    metadata: Partial<Pick<Feature, "service" | "ownerId" | "capacity" | "residents" | "label" | "entranceX" | "entranceZ">> = {},
  ) => {
    if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) return;
    const surface = plotAt(kind, x, z);
    if (!surface) return;
    if ((kind === "tree" || kind === "rock") && surface.vegetationDensityScale <= 0) return;
    features.push({ kind, x, z, y: surface.groundHeight, variant, code: WORLD_SEED + "/" + GENERATOR_VERSION + "/F/" + id, ...metadata });
  };
  const nearestStreetPoint = (place: Place, x: number, z: number) => {
    const plan = settlementExteriorFor(place);
    let best = { x: place.x, z: place.z }, distance = Infinity;
    for (const street of plan.streets) for (const point of street.points) {
      const candidate = Math.hypot(wrapSourceX(x - point.x), z - point.z);
      if (candidate < distance) { best = point; distance = candidate; }
    }
    return best;
  };
  const acceptedPlot = (plot: SettlementPlotPlan, featureKind: Feature["kind"]) => {
    if (settlementPlotAnchors.has(plot.id)) return settlementPlotAnchors.get(plot.id)!;
    const chosen = plot.candidates.find((candidate) => Boolean(plotAt(featureKind, candidate.x, candidate.z))) || null;
    settlementPlotAnchors.set(plot.id, chosen);
    return chosen;
  };

  for (const place of places) {
    const coarseExtent = place.kind === "city" ? 456 : 178,
      tileCentreX = tile.minX + tile.size * .5,
      tileCentreZ = tile.minZ + tile.size * .5;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + coarseExtent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + coarseExtent) continue;
    const plan = settlementExteriorFor(place), sx = Math.floor(place.x / 2), sz = Math.floor(place.z / 2);
    for (const street of plan.streets) for (let index = 0; index < street.points.length; index++) {
      const point = street.points[index];
      add("street", point.x, point.z, Math.max(9, Math.round(street.width + 5)), place.id + "/street/" + street.id + "/" + index);
    }
    for (let segment = 0; segment < plan.border.length; segment++) {
      const a = plan.border[segment], b = plan.border[(segment + 1) % plan.border.length],
        dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(length / 11));
      for (let step = 0; step < steps; step++) {
        const t = (step + .5) / steps, x = wrapSourceX(a.x + dx * t), z = a.z + dz * t;
        if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 18)) continue;
        add("border", x, z, place.kind === "city" ? 1 : 0, place.id + "/border/" + segment + "/" + step);
      }
    }
    for (const plot of plan.plots) {
      const featureKind: Feature["kind"] = plot.kind === "service" ? "service" : plot.kind;
      const point = acceptedPlot(plot, featureKind);
      if (!point) continue;
      const entrance = nearestStreetPoint(place, point.x, point.z);
      add(featureKind, point.x, point.z, coordinateValue(sx, sz, 40 + (digest(plot.id) % 500)), place.id + "/" + plot.id, {
        service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind, entranceX: entrance.x, entranceZ: entrance.z,
      });
    }
    for (const gate of plan.gates) {
      add("gate", gate.x, gate.z, digest(gate.id), place.id + "/gate/" + gate.id, { label: place.name + " gate", entranceX: place.x, entranceZ: place.z });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(gate.id + "/" + index), place.id + "/guard-post/" + gate.id + "/" + index, { service: "guard-office", capacity: 4, residents: 2, label: "Guard post", entranceX: gate.x, entranceZ: gate.z });
      }
    }
  }

  if (tile.size <= 256) {
    for (let gz = Math.floor(tile.minZ / 10) - 1; gz < (tile.minZ + tile.size) / 10 + 1; gz++) {
      for (let gx = Math.floor(tile.minX / 10) - 1; gx < (tile.minX + tile.size) / 10 + 1; gx++) {
        const v = coordinateValue(gx, gz, 30), x = gx * 10 + (v % 7) - 3, z = gz * 10 + ((v >>> 5) % 7) - 3, biome = biomeAt(x, z);
        if (biome === "Woodland" && v % 4 !== 0) add("tree", x, z, v, "tree/" + gx + "/" + gz);
        else if (!["Settlement", "Ocean", "Lake", "River", "Road", "Bridge"].includes(biome) && v % 31 === 0) add("rock", x, z, v, "rock/" + gx + "/" + gz);
      }
    }
  }
  return features;
}
`;
  text = text.slice(0, start) + replacement + text.slice(end);
  write(path, text);
}

{
  const path = "src/geometry.ts";
  let text = read(path);
  text = replaceOnce(
    text,
    '      } else if (f.kind === "keep") {',
    `      } else if (f.kind === "service") {
        const market = f.service === "market", smith = f.service === "blacksmith", inn = f.service === "inn";
        const w = market ? 12 : inn ? 11 : 9, d = market ? 10 : inn ? 12 : 9, h = market ? 3.8 : inn ? 6.2 : 5.1;
        structures.box(x, y - 0.25, z, w, h + 0.25, d, market ? color(188, 166, 116) : plaster);
        structures.roof(x, y + h, z, w + 1.2, d + 1.2, market ? 2.1 : 2.8, smith ? color(66, 70, 70) : color(122 + (v % 18), 70, 50));
        if (market && t.size <= 64) {
          for (const ox of [-4, 0, 4]) detail.box(x + ox, y + .2, z + d / 2 + 1.5, 3, 1.4, 2.3, color(157, 112 + (v % 20), 63));
        } else if (smith && t.size <= 64) {
          detail.box(x + w / 2 + 1.1, y + .1, z, 1.8, 1.2, 1.8, color(82, 82, 76));
          detail.box(x + w / 2 + 1.1, y + 1.3, z, .3, 2.3, .3, timber);
        }
      } else if (f.kind === "street") {
        const size = Math.max(9, Math.min(12, v));
        structures.box(x, y + .015, z, size, .08, size, color(118, 96, 64));
      } else if (f.kind === "border") {
        const cityWall = v === 1;
        structures.box(x, y - .05, z, 11, cityWall ? 2.4 : 1.25, 11, cityWall ? stone : timber);
      } else if (f.kind === "gate") {
        for (const ox of [-4.5, 4.5]) structures.box(x + ox, y - .2, z, 1.5, 7.2, 1.5, stone);
        structures.box(x, y + 5.7, z, 10.5, 1.3, 1.5, timber);
      } else if (f.kind === "guard-post") {
        structures.box(x, y - .2, z, 4.5, 6.2, 4.5, stone);
        structures.roof(x, y + 6, z, 5.2, 5.2, 2.2, color(72, 80, 82));
      } else if (f.kind === "keep") {`,
    "geometry settlement feature branches",
  );
  write(path, text);
}

{
  const path = "tests/final-surface-integration.test.ts";
  let text = read(path);
  const before = `  let bank: ReturnType<typeof naturalSurfaceAt> | undefined;
  for(const radius of [4,6,8,10,12]) {
    for(let index=0;index<24;index++) {
      const angle=index/24*Math.PI*2,
        sample=naturalSurfaceAt(p.x+Math.cos(angle)*radius,p.z+Math.sin(angle)*radius);
      if(sample.material==="Riverbank"&&sample.water.kind==="none") {
        bank=sample;
        break;
      }
    }
    if(bank) break;
  }`;
  const after = `  let bank: ReturnType<typeof naturalSurfaceAt> | undefined;
  for(const radius of [2,3,4,5,6,8,10,12]) {
    for(let index=0;index<48;index++) {
      const angle=index/48*Math.PI*2, sample=naturalSurfaceAt(p.x+Math.cos(angle)*radius,p.z+Math.sin(angle)*radius);
      if(sample.material==="Riverbank"&&sample.water.kind==="none"&&(!bank||sample.groundHeight<bank.groundHeight)) bank=sample;
    }
  }`;
  text = replaceOnce(text, before, after, "crossing bank nearest legal support");
  write(path, text);
}

{
  const path = "tests/world.test.ts";
  let text = read(path);
  const marker = "  for(const kind of ['keep','well','field']) assert.ok(features.some(f=>f.kind===kind),`missing ${kind}`);\n";
  const addition = marker + `  const exterior=[...tiles.values()].flatMap(featuresFor);
  for(const service of ['market','inn','blacksmith','butcher','guard-office','farmstead'])
    assert.ok(exterior.some(f=>f.kind==='service'&&f.service===service),'missing '+service);
  const homes=exterior.filter(f=>f.kind==='house');
  assert.ok(homes.every(f=>f.ownerId&&Number.isFinite(f.entranceX)&&Number.isFinite(f.entranceZ)),'homes need owner and road entrance');
  assert.ok(exterior.some(f=>f.kind==='border'),'missing core border');
  assert.ok(exterior.some(f=>f.kind==='gate'),'missing gate');
  assert.ok(exterior.some(f=>f.kind==='guard-post'),'missing guard post');
`;
  text = replaceOnce(text, marker, addition, "Alderwick exterior assertions");
  write(path, text);
}

console.log("AGENT #1 WP-S004 acceptance patch v2 applied");
