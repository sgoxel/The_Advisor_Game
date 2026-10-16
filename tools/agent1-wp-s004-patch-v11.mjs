import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing patch anchor: ${label}`);
  return text.replace(before, after);
}

let geography = read('src/geography.ts');
geography = replaceOnce(
  geography,
  `        !dryOwnedConnectionFits(candidate, city.canonicalPosition, country) ||\n        (selected.length > 0 &&\n          !dryOwnedConnectionFits(candidate, selected[selected.length - 1], country)) ||\n        accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000) ||`,
  `        !dryOwnedConnectionFits(candidate, city.canonicalPosition, country) ||\n        accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000) ||`,
  'remove previous-village chain constraint',
);

const oldRoads = `export const roads = cities.flatMap((city) => {\n  const children = villages.filter((place) => place.id.startsWith(\`${'${city.id}'}\/\`));\n  return children.slice(0, -1).map((fromPlace, index) => {\n    const toPlace = children[index + 1],\n      fromPosition = fromPlace.canonicalPosition,\n      toPosition = toPlace.canonicalPosition,\n      dx = wrapSourceX(toPlace.x - fromPlace.x),\n      toUnwrappedX = fromPlace.x + dx,\n      fromZ = fromPlace.z,\n      toZ = toPlace.z,\n      minX = Math.min(fromPlace.x, toUnwrappedX),\n      maxX = Math.max(fromPlace.x, toUnwrappedX),\n      minZ = Math.min(fromZ, toZ),\n      maxZ = Math.max(fromZ, toZ),\n      surfaceLengthM = greatCircleDistance(fromPosition, toPosition),\n      travel = travelMetrics(surfaceLengthM, \"good-road\");\n    return {\n      code: \`${'${city.code}'}/ROAD/${'${index}'}\`,\n      from: fromPlace.id,\n      to: toPlace.id,\n      fromX: fromPlace.x,\n      toX: toUnwrappedX,\n      fromZ,\n      toZ,\n      minX,\n      maxX,\n      minZ,\n      maxZ,\n      /** Compatibility centreline coordinate retained for diagnostics only. */\n      z: (fromZ + toZ) / 2,\n      fromPosition,\n      toPosition,\n      presentationLengthSourceUnits: Math.hypot(dx, toZ - fromZ),\n      surfaceLengthM,\n      walkSurface: \"good-road\" as const,\n      walkSpeedMps: travel.speedMps,\n      fantasyWalkSeconds: travel.fantasySeconds,\n      realWalkSeconds: travel.realSeconds,\n      centerline: undefined as readonly { x: number; z: number; position: LonLat }[] | undefined,\n    };\n  });\n});`;

const newRoads = `/**\n * S004 provisional settlement access follows the canonical dry parent reserve.\n * Village identity does not impose a sibling-order road chain; S005 may later\n * derive shared transport hierarchy from these legal endpoints.\n */\nexport const roads = cities.flatMap((city) => {\n  const children = villages.filter((place) => place.id.startsWith(\`${'${city.id}'}\/\`));\n  return children.map((toPlace, index) => {\n    const fromPlace = city,\n      fromPosition = fromPlace.canonicalPosition,\n      toPosition = toPlace.canonicalPosition,\n      dx = wrapSourceX(toPlace.x - fromPlace.x),\n      toUnwrappedX = fromPlace.x + dx,\n      fromZ = fromPlace.z,\n      toZ = toPlace.z,\n      minX = Math.min(fromPlace.x, toUnwrappedX),\n      maxX = Math.max(fromPlace.x, toUnwrappedX),\n      minZ = Math.min(fromZ, toZ),\n      maxZ = Math.max(fromZ, toZ),\n      surfaceLengthM = greatCircleDistance(fromPosition, toPosition),\n      travel = travelMetrics(surfaceLengthM, \"good-road\");\n    return {\n      code: \`${'${city.code}'}/ROAD/${'${index}'}\`,\n      from: fromPlace.id,\n      to: toPlace.id,\n      fromX: fromPlace.x,\n      toX: toUnwrappedX,\n      fromZ,\n      toZ,\n      minX,\n      maxX,\n      minZ,\n      maxZ,\n      /** Compatibility centreline coordinate retained for diagnostics only. */\n      z: (fromZ + toZ) / 2,\n      fromPosition,\n      toPosition,\n      presentationLengthSourceUnits: Math.hypot(dx, toZ - fromZ),\n      surfaceLengthM,\n      walkSurface: \"good-road\" as const,\n      walkSpeedMps: travel.speedMps,\n      fantasyWalkSeconds: travel.fantasySeconds,\n      realWalkSeconds: travel.realSeconds,\n      centerline: undefined as readonly { x: number; z: number; position: LonLat }[] | undefined,\n    };\n  });\n});`;

geography = replaceOnce(geography, oldRoads, newRoads, 'replace sibling road chain with legal parent spokes');
write('src/geography.ts', geography);

let political = read('tests/political-atlas.test.ts');
political = replaceOnce(
  political,
  `  politicalRegistryCountsForSeed,\n  villages,`,
  `  politicalRegistryCountsForSeed,\n  roads,\n  villages,`,
  'import provisional settlement roads',
);
political = replaceOnce(
  political,
  `  assert.ok(\n    parentDistances.some((distance) => distance > 23_000),\n    \"village placement still behaves as if the old 23 km parent-radius ceiling were authoritative\",\n  );\n});`,
  `  assert.ok(\n    parentDistances.some((distance) => distance > 23_000),\n    \"village placement still behaves as if the old 23 km parent-radius ceiling were authoritative\",\n  );\n\n  const provisionalRoads = roads.filter((road) => /\\/CITY\\/\\d+\\/ROAD\\/\\d+$/.test(road.code));\n  assert.equal(provisionalRoads.length, villages.length, \"every village needs one legal provisional parent access reserve\");\n  for (const village of villages) {\n    const parentId = village.id.split(\"/\").slice(0, 3).join(\"/\"),\n      link = provisionalRoads.find((road) => road.from === parentId && road.to === village.id);\n    assert.ok(link, \`${'${village.code}'} is still dependent on sibling-order road chaining\`);\n  }\n});`,
  'assert parent access replaces sibling chain',
);
write('tests/political-atlas.test.ts', political);

console.log('WP-S004 sibling-chain authority removed; legal parent access retained');