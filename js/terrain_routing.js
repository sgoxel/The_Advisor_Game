/* R04 / #325: deterministic shared exterior terrain walkability and path-cost routing core. */
(function installTerrainRouting() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-terrain-routing-v1';
  const DIRS = Object.freeze([[-1, 0], [0, 1], [1, 0], [0, -1]]);

  function normalized(value) { return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-'); }
  function key(point) { return `${point.row},${point.col}`; }
  function point(value) { return { row: Math.trunc(Number(value?.row) || 0), col: Math.trunc(Number(value?.col) || 0) }; }
  function tagsOf(tile) {
    if (tile?.tags instanceof Set) return tile.tags;
    return new Set(Array.isArray(tile?.tags) ? tile.tags : []);
  }
  function isWater(tile) {
    return Boolean(tile?.water) || ['lake', 'river', 'water', 'ocean', 'sea'].includes(normalized(tile?.type));
  }
  function isMountain(tile) {
    return normalized(tile?.type) === 'mountain' || Boolean(tile?.cliff || tile?.steep);
  }
  function isWalkableTile(tile) {
    if (!tile) return false;
    const tags = tagsOf(tile);
    if (tile.blocked || tile.obstacle || tile.solid || tags.has('blocked')) return false;
    if (isWater(tile) || isMountain(tile)) return false;
    return true;
  }
  function traversalCost(tile) {
    if (!isWalkableTile(tile)) return Infinity;
    const tags = tagsOf(tile);
    const type = normalized(tile?.type);
    if (tile?.road || tags.has('road') || type === 'road') return 1;
    if (type === 'dirt' || type === 'field') return 1.5;
    if (type === 'grass' || type === 'settlement') return 2;
    if (type === 'forest') return 4;
    return 2.5;
  }
  function inside(terrain, p) {
    return p.row >= 0 && p.col >= 0 && p.row < terrain.length && p.col < (terrain[p.row]?.length || 0);
  }
  function heuristic(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }
  function reconstruct(parent, end) {
    const result = [point(end)];
    let cursor = key(end);
    while (parent.has(cursor)) {
      const previous = parent.get(cursor);
      result.push(point(previous));
      cursor = key(previous);
    }
    return result.reverse();
  }
  function findPath(terrain, startInput, goalInput, options = {}) {
    if (!Array.isArray(terrain) || !terrain.length) return [];
    const start = point(startInput), goal = point(goalInput);
    if (!inside(terrain, start) || !inside(terrain, goal)) return [];
    const occupied = options.occupied instanceof Set ? options.occupied : new Set(options.occupied || []);
    const allowGoalOccupied = options.allowGoalOccupied !== false;
    const open = [{ point: start, g: 0, f: heuristic(start, goal) }];
    const best = new Map([[key(start), 0]]);
    const parent = new Map();

    while (open.length) {
      open.sort((a, b) => a.f - b.f || a.g - b.g || a.point.row - b.point.row || a.point.col - b.point.col);
      const current = open.shift();
      if (current.point.row === goal.row && current.point.col === goal.col) return reconstruct(parent, current.point);
      for (const [dr, dc] of DIRS) {
        const next = { row: current.point.row + dr, col: current.point.col + dc };
        if (!inside(terrain, next)) continue;
        const nextKey = key(next);
        if (occupied.has(nextKey) && !(allowGoalOccupied && next.row === goal.row && next.col === goal.col)) continue;
        const cost = traversalCost(terrain[next.row][next.col]);
        if (!Number.isFinite(cost)) continue;
        const candidate = current.g + cost;
        if (candidate >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, candidate);
        parent.set(nextKey, current.point);
        open.push({ point: next, g: candidate, f: candidate + heuristic(next, goal) });
      }
    }
    return [];
  }

  Game.TerrainRouting = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    isWalkableTile,
    traversalCost,
    findPath
  });
})();
