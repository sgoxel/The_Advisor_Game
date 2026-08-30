import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageInteriors?.snapshot &&
    window.Game?.Input?.buildPathToTarget &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game?.State?.world?.buildingInteriors?.interiors?.length
  ), null, { timeout: 20_000 });
}

function touches(a, b) { return Math.abs(a.row-b.row)+Math.abs(a.col-b.col) === 1; }

test('authoritative buildings materialize seamless same-world rooms, walls and door paths', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G=window.Game, world=G.State.world;
    const buildingsBefore=JSON.stringify(world.originVillage.buildings);
    G.StarterVillageInteriors.materialize(world);
    const snap=G.StarterVillageInteriors.snapshot();
    const home=world.originVillage.buildings.find(b=>b.type==='home');
    const interior=snap.interiors.find(i=>i.buildingId===home.id);
    const inside=interior.rooms[0];
    const target={row:inside.row+Math.min(1,inside.height-1),col:inside.col+Math.min(1,inside.width-1)};
    world.player.row=interior.entrance.row; world.player.col=interior.entrance.col;
    world.player.targetRow=world.player.row; world.player.targetCol=world.player.col; world.player.moving=false;
    const path=G.Input.buildPathToTarget(target.row,target.col);
    const floorStates=interior.floors.map(p=>({p,blocked:G.Input.isBlockedTile(p.row,p.col),tags:[...(world.terrain[p.row][p.col].tags||[])]}));
    const wallStates=interior.walls.map(p=>({p,blocked:G.Input.isBlockedTile(p.row,p.col)}));
    const firstIdentity=interior.buildingId;
    G.StarterVillageInteriors.materialize(world);
    const second=G.StarterVillageInteriors.snapshot().interiors.find(i=>i.buildingId===firstIdentity);
    return {authority:snap.authority,buildingCount:world.originVillage.buildings.length,interiorCount:snap.interiors.length,
      homeRooms:interior.rooms,entrance:interior.entrance,door:interior.door,path,floorStates,wallStates,
      buildingsBefore,buildingsAfter:JSON.stringify(world.originVillage.buildings),secondIdentity:second?.buildingId,
      floorIndexSize:world.buildingInteriors.floorIndex.size,wallIndexSize:world.buildingInteriors.wallIndex.size};
  });

  expect(evidence.authority).toBe('simulation-derived');
  expect(evidence.interiorCount).toBeGreaterThanOrEqual(20);
  expect(evidence.interiorCount).toBeLessThanOrEqual(evidence.buildingCount);
  expect(evidence.homeRooms.length).toBeGreaterThanOrEqual(2);
  expect(touches(evidence.entrance,evidence.door)).toBe(true);
  expect(evidence.path.length).toBeGreaterThan(1);
  expect(evidence.path.some(p=>p.row===evidence.door.row&&p.col===evidence.door.col)).toBe(true);
  expect(evidence.floorStates.every(item=>item.blocked===false)).toBe(true);
  expect(evidence.wallStates.length).toBeGreaterThan(0);
  expect(evidence.wallStates.every(item=>item.blocked===true)).toBe(true);
  expect(evidence.floorIndexSize).toBeGreaterThan(0);
  expect(evidence.wallIndexSize).toBeGreaterThan(0);
  expect(evidence.buildingsAfter).toBe(evidence.buildingsBefore);
  expect(evidence.secondIdentity).toBeTruthy();
});

test('same SEED rebuild preserves interior identity and room geometry', async ({ page }) => {
  await ready(page);
  const evidence=await page.evaluate(() => {
    const G=window.Game, seed=G.State.settings.seed;
    const before=G.StarterVillageInteriors.snapshot().interiors.map(i=>({buildingId:i.buildingId,footprint:i.footprint,entrance:i.entrance,door:i.door,rooms:i.rooms}));
    const generated=G.Terrain.generateWorld(seed,100,100);
    if (Array.isArray(generated.grid)) G.State.world.terrain=generated.grid;
    if (generated.originVillageBase?.village) G.State.world.originVillage=generated.originVillageBase.village;
    G.StarterVillageInteriors.materialize(G.State.world);
    const after=G.StarterVillageInteriors.snapshot().interiors.map(i=>({buildingId:i.buildingId,footprint:i.footprint,entrance:i.entrance,door:i.door,rooms:i.rooms}));
    return {before:JSON.stringify(before),after:JSON.stringify(after)};
  });
  expect(evidence.after).toBe(evidence.before);
});

for (const viewport of [
  {name:'phone',width:390,height:844}, {name:'tablet',width:820,height:1180}, {name:'desktop',width:1440,height:900}
]) {
  test(`interior cutaway remains passive and bounded on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({width:viewport.width,height:viewport.height}); await ready(page);
    const evidence=await page.evaluate(async () => {
      const G=window.Game, interior=G.StarterVillageInteriors.snapshot().interiors.find(i=>i.rooms.length>=2) || G.StarterVillageInteriors.snapshot().interiors[0];
      const floor=interior.floors.find(p=>p.row!==interior.door.row||p.col!==interior.door.col);
      G.State.world.player.row=floor.row;G.State.world.player.col=floor.col;G.State.world.player.targetRow=floor.row;G.State.world.player.targetCol=floor.col;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const overlay=document.getElementById('starterVillageInteriorOverlay'); const rect=overlay?.getBoundingClientRect();
      return {active:overlay?.dataset.activeBuildingId,expected:interior.buildingId,pointer:overlay?getComputedStyle(overlay).pointerEvents:null,
        rect:rect?{width:rect.width,height:rect.height}:null,exteriorOpacity:document.getElementById('starterVillageExteriorOverlay')?.style.opacity||''};
    });
    expect(evidence.active).toBe(evidence.expected);
    expect(evidence.pointer).toBe('none');
    expect(evidence.rect?.width).toBeGreaterThan(100); expect(evidence.rect?.height).toBeGreaterThan(100);
    expect(Number(evidence.exteriorOpacity||1)).toBeLessThan(1);
  });
}
