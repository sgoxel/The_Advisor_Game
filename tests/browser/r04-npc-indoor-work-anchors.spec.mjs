import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCSpatial?.ensureSpatialNpcs &&
    window.Game?.NPCWorkplaces?.sync &&
    window.Game?.StarterVillageInteriors?.materialize &&
    window.Game?.NPCIndoorWorkAnchors?.assignIndoorAnchors &&
    window.Game?.NPCTerrainRouting?.refreshRoutes &&
    window.Game?.State?.world?.originVillage?.buildings?.length
  ), null, { timeout: 20_000 });
}

function localPoint(value) {
  return {
    row: Number(value?.localRow ?? value?.row),
    col: Number(value?.localCol ?? value?.col)
  };
}

function same(a, b) {
  return Boolean(a && b && Number(a.row) === Number(b.row) && Number(a.col) === Number(b.col));
}

test('indoor workers resolve to unique walkable anchors inside their assigned workplace', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const world = G.State.world;
    G.NPCSpatial.ensureSpatialNpcs();
    G.StarterVillageInteriors.materialize(world);
    G.NPCWorkplaces.sync();
    G.NPCIndoorWorkAnchors.assignIndoorAnchors();
    G.NPCTerrainRouting.refreshRoutes();

    const assignments = new Map((world.npcWorkplaces?.assignments || []).map((item) => [String(item.id), item]));
    const interiors = new Map((world.buildingInteriors?.interiors || []).map((item) => [String(item.buildingId), item]));
    const records = [];
    const outdoor = [];
    const guardDuty = [];

    for (const npc of world.npcs || []) {
      const assignment = assignments.get(String(npc.id));
      if (!assignment) continue;
      if (assignment.workplaceKind === 'outdoor-worksite-required') {
        outdoor.push({ id: npc.id, anchor: npc.indoorWorkAnchor });
        continue;
      }
      const profession = String(assignment.profession || '').trim().toLowerCase();
      if (profession === 'guard' || profession === 'militia') {
        guardDuty.push({
          id: npc.id,
          anchor: npc.indoorWorkAnchor,
          source: npc.anchors?.work?.source || null,
          indoor: npc.anchors?.work?.indoor === true
        });
        continue;
      }
      if (assignment.workplaceKind !== 'building' || !assignment.workplaceBuildingId) continue;
      const interior = interiors.get(String(assignment.workplaceBuildingId));
      if (!interior) continue;
      const anchor = npc.indoorWorkAnchor;
      const localAnchor = anchor ? { row: Number(anchor.localRow), col: Number(anchor.localCol) } : null;
      const floorMatch = Boolean(localAnchor && interior.floors.some((point) => point.row === localAnchor.row && point.col === localAnchor.col));
      const tile = localAnchor ? world.terrain?.[localAnchor.row]?.[localAnchor.col] : null;
      records.push({
        id: npc.id,
        buildingId: String(assignment.workplaceBuildingId),
        capacitySlot: assignment.capacitySlot,
        anchor: localAnchor,
        floorMatch,
        walkable: Boolean(tile && G.TerrainRouting.isWalkableTile(tile)),
        isDoor: Boolean(localAnchor && localAnchor.row === interior.door.row && localAnchor.col === interior.door.col),
        anchorBuildingId: anchor?.buildingId || null,
        source: npc.anchors?.work?.source || null,
        indoor: npc.anchors?.work?.indoor === true
      });
    }

    return {
      authority: world.npcIndoorWorkAnchors?.authority,
      version: world.npcIndoorWorkAnchors?.version,
      resolvedCount: world.npcIndoorWorkAnchors?.resolvedCount || 0,
      unresolvedCount: world.npcIndoorWorkAnchors?.unresolvedCount || 0,
      records,
      outdoor,
      guardDuty
    };
  });

  expect(evidence.authority).toBe('simulation-derived');
  expect(evidence.version).toBe('r04-npc-post-routing-integration-v5');
  expect(evidence.records.length).toBeGreaterThan(0);
  expect(evidence.resolvedCount).toBe(evidence.records.length);
  expect(evidence.unresolvedCount).toBe(0);

  const occupied = new Set();
  const byBuilding = new Map();
  for (const record of evidence.records) {
    expect(record.anchor).not.toBeNull();
    expect(record.anchorBuildingId).toBe(record.buildingId);
    expect(record.floorMatch).toBe(true);
    expect(record.walkable).toBe(true);
    expect(record.isDoor).toBe(false);
    expect(record.indoor).toBe(true);
    expect(record.source).toBe('npc-workplaces+starter-village-interiors');
    const tileKey = `${record.anchor.row},${record.anchor.col}`;
    expect(occupied.has(tileKey)).toBe(false);
    occupied.add(tileKey);
    byBuilding.set(record.buildingId, (byBuilding.get(record.buildingId) || 0) + 1);
  }

  expect(Array.from(byBuilding.values()).some((count) => count > 1)).toBe(true);
  for (const record of evidence.outdoor) expect(record.anchor).toBeNull();
  expect(evidence.guardDuty.length).toBeGreaterThan(0);
  for (const record of evidence.guardDuty) {
    expect(record.anchor).toBeNull();
    expect(record.indoor).toBe(false);
    expect(record.source).toBe('guard-duty-anchors');
  }
});

test('home-to-work routes enter through the authoritative entrance and door before the interior anchor', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const world = G.State.world;
    G.NPCSpatial.ensureSpatialNpcs();
    G.NPCIndoorWorkAnchors.assignIndoorAnchors();
    G.NPCTerrainRouting.refreshRoutes();
    const interiors = new Map((world.buildingInteriors?.interiors || []).map((item) => [String(item.buildingId), item]));

    return (world.npcs || []).filter((npc) => npc.indoorWorkAnchor).map((npc) => {
      const interior = interiors.get(String(npc.indoorWorkAnchor.buildingId));
      const route = (npc.spatialRoutes?.homeToWork || []).map((value) => ({
        row: Number(value.localRow ?? value.row),
        col: Number(value.localCol ?? value.col)
      }));
      const anchor = { row: Number(npc.indoorWorkAnchor.localRow), col: Number(npc.indoorWorkAnchor.localCol) };
      const entranceIndex = route.findIndex((point) => point.row === interior.entrance.row && point.col === interior.entrance.col);
      const doorIndex = route.findIndex((point) => point.row === interior.door.row && point.col === interior.door.col);
      const anchorIndex = route.findIndex((point) => point.row === anchor.row && point.col === anchor.col);
      return {
        id: npc.id,
        buildingId: npc.indoorWorkAnchor.buildingId,
        entranceIndex,
        doorIndex,
        anchorIndex,
        routeLength: route.length,
        end: route[route.length - 1] || null,
        anchor
      };
    });
  });

  expect(evidence.length).toBeGreaterThan(0);
  for (const record of evidence) {
    expect(record.routeLength).toBeGreaterThan(2);
    expect(record.entranceIndex).toBeGreaterThanOrEqual(0);
    expect(record.doorIndex).toBeGreaterThan(record.entranceIndex);
    expect(record.anchorIndex).toBeGreaterThan(record.doorIndex);
    expect(same(record.end, record.anchor)).toBe(true);
  }
});

test('indoor anchor allocation is deterministic and does not rewrite workplace identity', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const world = G.State.world;
    G.NPCSpatial.ensureSpatialNpcs();
    G.NPCWorkplaces.sync();
    const workplaceBefore = JSON.stringify(world.npcWorkplaces);
    G.NPCIndoorWorkAnchors.assignIndoorAnchors();
    const first = JSON.stringify(world.npcIndoorWorkAnchors);
    const workplaceAfterFirst = JSON.stringify(world.npcWorkplaces);
    G.NPCIndoorWorkAnchors.assignIndoorAnchors();
    const second = JSON.stringify(world.npcIndoorWorkAnchors);
    const workplaceAfterSecond = JSON.stringify(world.npcWorkplaces);
    return { workplaceBefore, workplaceAfterFirst, workplaceAfterSecond, first, second };
  });

  expect(evidence.second).toBe(evidence.first);
  expect(evidence.workplaceAfterFirst).toBe(evidence.workplaceBefore);
  expect(evidence.workplaceAfterSecond).toBe(evidence.workplaceBefore);
});
