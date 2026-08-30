window.Game = window.Game || {};

(function installMainRoadSemantics(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const MIN_CONTINUATION = 3;

  function isRoad(tile) {
    if (!tile) return false;
    if (tile.type === 'road') return true;
    const tags = tile.tags;
    if (tags instanceof Set) return tags.has('road');
    if (Array.isArray(tags)) return tags.includes('road');
    return false;
  }

  function hasRoad(grid, row, col) {
    return row >= 0 && col >= 0 && row < grid.length && Array.isArray(grid[row]) && col < grid[row].length && isRoad(grid[row][col]);
  }

  function key(row, col) {
    return `${row},${col}`;
  }

  function contiguousRuns(values) {
    const runs = [];
    let start = null;
    for (let i = 0; i <= values.length; i += 1) {
      const active = i < values.length && values[i];
      if (active && start === null) start = i;
      if (!active && start !== null) {
        if (i - start >= MIN_CONTINUATION) runs.push({ start, end: i - 1, length: i - start });
        start = null;
      }
    }
    return runs;
  }

  function addMembership(memberships, row, col, membership) {
    const cellKey = key(row, col);
    const list = memberships.get(cellKey) || [];
    list.push(Object.freeze(membership));
    memberships.set(cellKey, list);
  }

  function horizontalRuns(grid, memberships, segments) {
    const rows = grid.length;
    const cols = Math.max(0, ...grid.map((row) => Array.isArray(row) ? row.length : 0));
    for (let row = 0; row < rows - 1; row += 1) {
      const eligible = Array.from({ length: cols }, (_, col) => {
        if (!hasRoad(grid, row, col) || !hasRoad(grid, row + 1, col)) return false;
        // Three-or-more adjacent parallel lanes are ambiguous presentation input;
        // keep them ordinary rather than inventing which two form the main road.
        if (hasRoad(grid, row - 1, col) || hasRoad(grid, row + 2, col)) return false;
        return true;
      });
      for (const run of contiguousRuns(eligible)) {
        const id = `h:${row}:${run.start}-${run.end}`;
        segments.push(Object.freeze({ id, orientation: 'horizontal', laneA: row, laneB: row + 1, start: run.start, end: run.end, length: run.length }));
        for (let col = run.start; col <= run.end; col += 1) {
          const longitudinalRole = col === run.start ? 'start' : (col === run.end ? 'end' : 'middle');
          addMembership(memberships, row, col, { segmentId: id, orientation: 'horizontal', lane: 'a', longitudinalRole });
          addMembership(memberships, row + 1, col, { segmentId: id, orientation: 'horizontal', lane: 'b', longitudinalRole });
        }
      }
    }
  }

  function verticalRuns(grid, memberships, segments) {
    const rows = grid.length;
    const cols = Math.max(0, ...grid.map((row) => Array.isArray(row) ? row.length : 0));
    for (let col = 0; col < cols - 1; col += 1) {
      const eligible = Array.from({ length: rows }, (_, row) => {
        if (!hasRoad(grid, row, col) || !hasRoad(grid, row, col + 1)) return false;
        if (hasRoad(grid, row, col - 1) || hasRoad(grid, row, col + 2)) return false;
        return true;
      });
      for (const run of contiguousRuns(eligible)) {
        const id = `v:${col}:${run.start}-${run.end}`;
        segments.push(Object.freeze({ id, orientation: 'vertical', laneA: col, laneB: col + 1, start: run.start, end: run.end, length: run.length }));
        for (let row = run.start; row <= run.end; row += 1) {
          const longitudinalRole = row === run.start ? 'start' : (row === run.end ? 'end' : 'middle');
          addMembership(memberships, row, col, { segmentId: id, orientation: 'vertical', lane: 'a', longitudinalRole });
          addMembership(memberships, row, col + 1, { segmentId: id, orientation: 'vertical', lane: 'b', longitudinalRole });
        }
      }
    }
  }

  function classify(gridInput) {
    const grid = Array.isArray(gridInput) ? gridInput : [];
    const memberships = new Map();
    const segments = [];
    horizontalRuns(grid, memberships, segments);
    verticalRuns(grid, memberships, segments);

    const cells = {};
    for (const [cellKey, list] of memberships.entries()) {
      const orientations = Array.from(new Set(list.map((item) => item.orientation))).sort();
      const kind = orientations.length > 1 ? 'main-road-intersection' : 'main-road';
      cells[cellKey] = Object.freeze({
        kind,
        orientation: orientations.length === 1 ? orientations[0] : 'cross',
        memberships: Object.freeze(list.slice().sort((a, b) => a.segmentId.localeCompare(b.segmentId)))
      });
    }

    return Object.freeze({
      version: 'r04-main-road-semantics-v1',
      minContinuation: MIN_CONTINUATION,
      segments: Object.freeze(segments.slice().sort((a, b) => a.id.localeCompare(b.id))),
      cells: Object.freeze(cells)
    });
  }

  function semanticAt(classification, row, col) {
    return classification && classification.cells ? classification.cells[key(row, col)] || null : null;
  }

  Game.MainRoadSemantics = Object.freeze({
    MIN_CONTINUATION,
    isRoad,
    classify,
    semanticAt
  });
})(typeof window !== 'undefined' ? window : globalThis);
