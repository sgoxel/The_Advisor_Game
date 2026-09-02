import { test, expect } from '@playwright/test';

test('dense NPC choke drains deterministically without starvation or overlap', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => window.Game?.NPCSpatial?.resolveOccupancy && window.Game?.State?.world?.originVillage);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const roadTiles = [];
    for (let col = 20; col <= 82; col += 1) roadTiles.push({ row: 50, col });
    const roads = new Set(roadTiles.map((tile) => `${tile.row},${tile.col}`));
    const village = { roadTiles, buildings: [] };
    const choke = { row: 50, col: 60 };

    const initial = Array.from({ length: 12 }, (_, index) => ({
      id: `crowd-${index}`,
      name: `Crowd ${index}`,
      row: 50,
      col: 36 + index,
      movementDecision: 'yield-wait',
      movementWaitStreak: index,
      anchors: {
        home: { row: 50, col: 36 + index, buildingId: null },
        work: { row: 50, col: 76 + (index % 4), buildingId: null },
        social: { ...choke, buildingId: null }
      }
    }));

    function runOnce(source, step) {
      const desired = new Map(source.map((npc) => [npc.id, { point: choke, activity: 'local-errand' }]));
      const result = Game.NPCSpatial.resolveOccupancy(source, desired, {
        village,
        roads,
        seed: 'ADMIN-CROWD-FAIRNESS',
        step
      });
      return source.map((npc) => {
        const resolved = result.resolved.get(npc.id);
        return {
          ...npc,
          row: resolved.point.row,
          col: resolved.point.col,
          movementDecision: resolved.decision,
          movementWaitStreak: resolved.waitStreak,
          movementBlockedBy: resolved.blockedBy,
          intendedRow: resolved.intended.row,
          intendedCol: resolved.intended.col
        };
      });
    }

    const first = runOnce(initial.map((npc) => ({ ...npc })), 100);
    const repeat = runOnce(initial.map((npc) => ({ ...npc })), 100);
    const firstWinner = first.find((npc) => npc.row === choke.row && npc.col === choke.col)?.id || null;

    const drainOrder = [];
    let active = initial.map((npc) => ({ ...npc }));
    const snapshots = [];
    for (let round = 0; round < 12 && active.length; round += 1) {
      const resolved = runOnce(active, 200 + round);
      const positions = resolved.map((npc) => `${npc.row},${npc.col}`);
      const winner = resolved.find((npc) => npc.row === choke.row && npc.col === choke.col);
      snapshots.push({
        round,
        count: resolved.length,
        unique: new Set(positions).size === positions.length,
        winner: winner?.id || null,
        maxWaitStreak: Math.max(0, ...resolved.map((npc) => npc.movementWaitStreak || 0)),
        instrumentationComplete: resolved.every((npc) => Number.isInteger(npc.intendedRow)
          && Number.isInteger(npc.intendedCol)
          && Number.isInteger(npc.movementWaitStreak))
      });
      if (!winner) break;
      drainOrder.push(winner.id);
      active = resolved.filter((npc) => npc.id !== winner.id);
    }

    return {
      firstWinner,
      first: first.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, decision: npc.movementDecision, wait: npc.movementWaitStreak })),
      repeat: repeat.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, decision: npc.movementDecision, wait: npc.movementWaitStreak })),
      drainOrder,
      snapshots
    };
  });

  // The most-starved contender wins first instead of relying only on a fresh per-minute hash.
  expect(evidence.firstWinner).toBe('crowd-11');
  expect(evidence.first).toEqual(evidence.repeat);

  // A 12-NPC queue must drain through the contested tile in a bounded 12 authoritative turns.
  expect(evidence.drainOrder).toHaveLength(12);
  expect(new Set(evidence.drainOrder).size).toBe(12);
  expect(evidence.snapshots.every((snapshot) => snapshot.unique)).toBe(true);
  expect(evidence.snapshots.every((snapshot) => snapshot.instrumentationComplete)).toBe(true);
  expect(evidence.snapshots.every((snapshot) => snapshot.winner)).toBe(true);
});
