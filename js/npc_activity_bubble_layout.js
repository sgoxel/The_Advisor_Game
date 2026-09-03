/*
  R04 / #275 + #358: presentation-only dense NPC activity/dialogue bubble layout.

  This module never changes NPC positions, schedules, dialogue state, occupancy or
  Simulation truth. It suppresses the legacy bubble pass while the world renderer
  runs, then reuses the existing NPCSpatial bubble renderer with deterministic,
  viewport-bounded screen-space anchors. Lower-priority activity bubbles may be
  suppressed when no readable slot exists; character/world icons are never hidden.
*/
(function installNpcActivityBubbleLayout() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-activity-bubble-layout-v2-relevance-cull';
  const BUBBLE_HEIGHT = 18;
  const VIEWPORT_MARGIN = 6;
  const RELEVANCE_MARGIN = 48;
  const RECT_GAP = 3;
  let attempts = 0;
  let installed = false;
  let lastLayout = null;

  if (Game.NPCBubbleLayout?.version === VERSION) return;

  function bubblesEnabled() {
    return Game.Config?.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES !== false;
  }

  function withLegacyBubblesSuppressed(callback) {
    if (!Game.Config) return callback();
    const prior = Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES;
    Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    try {
      return callback();
    } finally {
      Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = prior;
    }
  }

  function withLegacyBubblesEnabled(callback) {
    if (!Game.Config) return callback();
    const prior = Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES;
    Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = true;
    try {
      return callback();
    } finally {
      Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = prior;
    }
  }

  function pointKey(row, col) {
    return `${Math.trunc(Number(row) || 0)},${Math.trunc(Number(col) || 0)}`;
  }

  function bubbleText(npc) {
    const activity = String(npc?.activity || 'idle').replaceAll('-', ' ');
    const decision = npc?.movementDecision && !['move', 'hold', 'dialogue-position'].includes(npc.movementDecision)
      ? ` · ${String(npc.movementDecision).replaceAll('-', ' ')}`
      : '';
    return `${npc?.name || 'NPC'}: ${activity}${decision}`;
  }

  function measureWidth(ctx, text, limit) {
    return Math.min(limit, Math.max(56, ctx.measureText(text).width + 12));
  }

  function rectFromAnchor(centerX, anchorY, width) {
    return {
      left: centerX - width / 2,
      right: centerX + width / 2,
      top: anchorY - BUBBLE_HEIGHT,
      bottom: anchorY,
      width,
      height: BUBBLE_HEIGHT
    };
  }

  function intersects(a, b, gap = RECT_GAP) {
    return !(
      a.right + gap <= b.left ||
      a.left >= b.right + gap ||
      a.bottom + gap <= b.top ||
      a.top >= b.bottom + gap
    );
  }

  function clampAnchor(centerX, anchorY, width, viewportWidth, viewportHeight) {
    const half = width / 2;
    const x = Math.max(VIEWPORT_MARGIN + half, Math.min(viewportWidth - VIEWPORT_MARGIN - half, centerX));
    const y = Math.max(VIEWPORT_MARGIN + BUBBLE_HEIGHT, Math.min(viewportHeight - VIEWPORT_MARGIN, anchorY));
    return { x, y };
  }

  function isRelevantPoint(point, viewportWidth, viewportHeight) {
    return Boolean(
      point &&
      Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= -RELEVANCE_MARGIN && point.x <= viewportWidth + RELEVANCE_MARGIN &&
      point.y >= -RELEVANCE_MARGIN && point.y <= viewportHeight + RELEVANCE_MARGIN
    );
  }

  function maxActivityBubbles(viewportWidth) {
    if (viewportWidth <= 480) return 7;
    if (viewportWidth <= 900) return 12;
    return 18;
  }

  function activityPriority(npc) {
    if (['yield-wait', 'yield-detour', 'side-step'].includes(npc?.movementDecision)) return 3;
    if (['commuting-to-work', 'local-errand', 'returning-home'].includes(npc?.activity)) return 2;
    if (npc?.activity === 'social') return 1;
    return 0;
  }

  function candidateOffsets(width, id) {
    const horizontal = Math.max(68, Math.min(150, width * 0.72));
    const flip = (String(id || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) & 1) ? -1 : 1;
    return [
      [0, 0], [0, -22], [0, -44], [0, -66],
      [flip * horizontal, -22], [-flip * horizontal, -22],
      [flip * horizontal, -44], [-flip * horizontal, -44],
      [flip * horizontal * 1.7, -44], [-flip * horizontal * 1.7, -44],
      [0, -88], [flip * horizontal, -88], [-flip * horizontal, -88],
      [0, -110]
    ];
  }

  function protectedIconRects(basePoints, viewportWidth, viewportHeight) {
    const worldSpaceScale = typeof Game.NPCWorld?.resolveWorldSpaceScale === 'function'
      ? Game.NPCWorld.resolveWorldSpaceScale(viewportWidth)
      : null;
    const halfWidth = Math.max(12, Number(worldSpaceScale?.width || 0) / 2 || 12);
    const height = Math.max(34, Number(worldSpaceScale?.height || 0) || 34);
    return Array.from(basePoints.values())
      .filter((entry) => isRelevantPoint(entry, viewportWidth, viewportHeight))
      .map((entry) => ({
        id: entry.id,
        left: entry.x - halfWidth,
        right: entry.x + halfWidth,
        top: entry.y - height,
        bottom: entry.y + 8
      }));
  }

  function slotFor(candidate, occupied, protectedIcons, viewportWidth, viewportHeight) {
    const offsets = candidateOffsets(candidate.width, candidate.id);
    for (const [dx, dy] of offsets) {
      const anchor = clampAnchor(candidate.baseX + dx, candidate.baseAnchorY + dy, candidate.width, viewportWidth, viewportHeight);
      const rect = rectFromAnchor(anchor.x, anchor.y, candidate.width);
      if (occupied.some((other) => intersects(rect, other.rect))) continue;
      if (protectedIcons.some((icon) => intersects(rect, icon, 1))) continue;
      return { anchor, rect };
    }
    return null;
  }

  function computeLayout(renderer, ctx, canvas, world) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const viewportWidth = Math.max(1, Number(rect.width) || canvas.width / dpr || window.innerWidth || 1);
    const viewportHeight = Math.max(1, Number(rect.height) || canvas.height / dpr || window.innerHeight || 1);
    const baseGridToScreen = renderer.gridToScreen.bind(renderer);
    const npcs = Array.isArray(world?.npcs) ? world.npcs : [];
    const basePoints = new Map();

    for (const npc of npcs) {
      const p = baseGridToScreen(npc.row, npc.col, 0, 0);
      basePoints.set(pointKey(npc.row, npc.col), {
        id: npc.id,
        x: Number(p?.x),
        y: Number(p?.y),
        npc
      });
    }

    const protectedIcons = protectedIconRects(basePoints, viewportWidth, viewportHeight);
    const adjustments = new Map();
    const occupied = [];
    const boxes = [];
    const pairedIds = new Set();
    const suppressedIds = [];
    const culledIds = [];
    const cullReasons = {};

    for (const entry of basePoints.values()) {
      if (isRelevantPoint(entry, viewportWidth, viewportHeight)) continue;
      adjustments.set(pointKey(entry.npc.row, entry.npc.col), { x: NaN, y: NaN, suppressed: true });
      culledIds.push(entry.id);
      cullReasons[entry.id] = 'outside-viewport-relevance-envelope';
    }

    const dialogue = (world?.npcDialogues || []).find((entry) => {
      const a = npcs.find((npc) => npc.id === entry.speakerId);
      const b = npcs.find((npc) => npc.id === entry.listenerId);
      if (!a || !b) return false;
      const pa = basePoints.get(pointKey(a.row, a.col));
      const pb = basePoints.get(pointKey(b.row, b.col));
      return isRelevantPoint(pa, viewportWidth, viewportHeight) && isRelevantPoint(pb, viewportWidth, viewportHeight);
    }) || null;

    if (dialogue) {
      const a = npcs.find((npc) => npc.id === dialogue.speakerId);
      const b = npcs.find((npc) => npc.id === dialogue.listenerId);
      const ka = pointKey(a.row, a.col);
      const kb = pointKey(b.row, b.col);
      const pa = basePoints.get(ka);
      const pb = basePoints.get(kb);
      if (pa && pb && Number.isFinite(pa.x) && Number.isFinite(pa.y) && Number.isFinite(pb.x) && Number.isFinite(pb.y)) {
        pairedIds.add(a.id);
        pairedIds.add(b.id);
        const text = `${a.name} ↔ ${b.name}: ${dialogue.line}`;
        const width = measureWidth(ctx, text, 320);
        const baseCenterX = (pa.x + pb.x) / 2;
        const baseAnchorY = Math.min(pa.y, pb.y) - 28;
        const candidate = { id: `dialogue:${a.id}:${b.id}`, baseX: baseCenterX, baseAnchorY, width };
        const placed = slotFor(candidate, occupied, protectedIcons, viewportWidth, viewportHeight) || (() => {
          const anchor = clampAnchor(baseCenterX, baseAnchorY - 44, width, viewportWidth, viewportHeight);
          return { anchor, rect: rectFromAnchor(anchor.x, anchor.y, width) };
        })();
        const dx = placed.anchor.x - baseCenterX;
        const dy = placed.anchor.y - baseAnchorY;
        adjustments.set(ka, { x: pa.x + dx, y: pa.y + dy, suppressed: false });
        adjustments.set(kb, { x: pb.x + dx, y: pb.y + dy, suppressed: false });
        occupied.push({ id: candidate.id, rect: placed.rect });
        boxes.push({ id: candidate.id, kind: 'dialogue', rect: placed.rect });
      }
    }

    const activities = npcs
      .map((npc, index) => ({ npc, index, point: basePoints.get(pointKey(npc.row, npc.col)) }))
      .filter((entry) => !pairedIds.has(entry.npc.id) && isRelevantPoint(entry.point, viewportWidth, viewportHeight))
      .sort((a, b) => activityPriority(b.npc) - activityPriority(a.npc) || a.point.y - b.point.y || String(a.npc.id).localeCompare(String(b.npc.id)));

    const maximum = maxActivityBubbles(viewportWidth);
    let placedActivity = 0;
    for (const entry of activities) {
      const { npc, index, point: p } = entry;
      const key = pointKey(npc.row, npc.col);
      if (placedActivity >= maximum) {
        adjustments.set(key, { x: NaN, y: NaN, suppressed: true });
        suppressedIds.push(npc.id);
        continue;
      }
      const width = measureWidth(ctx, bubbleText(npc), 220);
      const laneOffset = (index % 3) * 4;
      const candidate = {
        id: npc.id,
        baseX: p.x,
        baseAnchorY: p.y - 24 - laneOffset,
        width
      };
      const placed = slotFor(candidate, occupied, protectedIcons, viewportWidth, viewportHeight);
      if (!placed) {
        adjustments.set(key, { x: NaN, y: NaN, suppressed: true });
        suppressedIds.push(npc.id);
        continue;
      }
      const dx = placed.anchor.x - candidate.baseX;
      const dy = placed.anchor.y - candidate.baseAnchorY;
      adjustments.set(key, { x: p.x + dx, y: p.y + dy, suppressed: false });
      occupied.push({ id: npc.id, rect: placed.rect });
      boxes.push({ id: npc.id, kind: 'activity', rect: placed.rect, priority: activityPriority(npc) });
      placedActivity += 1;
    }

    for (const [key, entry] of basePoints.entries()) {
      if (adjustments.has(key) || pairedIds.has(entry.id)) continue;
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) adjustments.set(key, { x: NaN, y: NaN, suppressed: true });
    }

    let overlapCount = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (intersects(boxes[i].rect, boxes[j].rect, 0)) overlapCount += 1;
      }
    }

    return {
      adjustments,
      baseGridToScreen,
      boxes,
      suppressedIds,
      culledIds,
      cullReasons,
      viewport: { width: viewportWidth, height: viewportHeight },
      maximumActivityBubbles: maximum,
      overlapCount,
      pairedIds: Array.from(pairedIds)
    };
  }

  function install() {
    if (installed) return true;
    const renderer = Game.Renderer;
    const spatial = Game.NPCSpatial;
    const npcWorld = Game.NPCWorld;
    if (!renderer || typeof renderer.renderWorld !== 'function' || !spatial?.drawDevelopmentBubbles || !npcWorld?.drawPresentation) return false;

    const originalSpatialDraw = spatial.drawDevelopmentBubbles.bind(spatial);
    const originalWorldDrawPresentation = npcWorld.drawPresentation.bind(npcWorld);
    const originalRenderWorld = renderer.renderWorld.bind(renderer);

    function drawLayoutBubbles() {
      if (!bubblesEnabled()) return false;
      const canvas = document.getElementById('npcWorldOverlay');
      const world = Game.State?.world;
      if (!canvas || !Array.isArray(world?.npcs)) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      ctx.save();
      ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
      const layout = computeLayout(renderer, ctx, canvas, world);
      ctx.restore();

      const currentGridToScreen = renderer.gridToScreen;
      renderer.gridToScreen = function bubbleLayoutGridToScreen(row, col, ...rest) {
        const key = pointKey(row, col);
        const adjusted = layout.adjustments.get(key);
        if (adjusted?.suppressed) return { x: NaN, y: NaN };
        if (adjusted && Number.isFinite(adjusted.x) && Number.isFinite(adjusted.y)) return { x: adjusted.x, y: adjusted.y };
        return layout.baseGridToScreen(row, col, ...rest);
      };
      try {
        withLegacyBubblesEnabled(() => originalSpatialDraw());
      } finally {
        renderer.gridToScreen = currentGridToScreen;
      }

      canvas.dataset.bubbleLayoutVersion = VERSION;
      canvas.dataset.activityBubbleSuppressedCount = String(layout.suppressedIds.length);
      canvas.dataset.activityBubbleCulledCount = String(layout.culledIds.length);
      canvas.dataset.bubbleLayoutOverlapCount = String(layout.overlapCount);
      canvas.dataset.bubbleLayoutMaxActivity = String(layout.maximumActivityBubbles);
      lastLayout = {
        version: VERSION,
        authority: 'presentation-only',
        boxes: layout.boxes,
        suppressedIds: layout.suppressedIds,
        culledIds: layout.culledIds,
        cullReasons: layout.cullReasons,
        viewport: layout.viewport,
        overlapCount: layout.overlapCount,
        maximumActivityBubbles: layout.maximumActivityBubbles,
        pairedIds: layout.pairedIds
      };
      return true;
    }

    renderer.renderWorld = function npcBubbleLayoutRenderWorld(...args) {
      const enabled = bubblesEnabled();
      const result = withLegacyBubblesSuppressed(() => originalRenderWorld(...args));
      if (enabled) drawLayoutBubbles();
      return result;
    };

    Game.NPCWorld = Object.freeze({
      ...npcWorld,
      drawPresentation(...args) {
        const enabled = bubblesEnabled();
        const result = withLegacyBubblesSuppressed(() => originalWorldDrawPresentation(...args));
        if (enabled) drawLayoutBubbles();
        return result;
      },
      drawDevelopmentBubbles: drawLayoutBubbles
    });

    Game.NPCSpatial = Object.freeze({
      ...spatial,
      drawDevelopmentBubbles: drawLayoutBubbles
    });

    Game.NPCBubbleLayout = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      get installed() { return installed; },
      draw: drawLayoutBubbles,
      snapshot() { return lastLayout ? JSON.parse(JSON.stringify(lastLayout)) : null; }
    });

    installed = true;
    return true;
  }

  function settle() {
    attempts += 1;
    if (!install() && attempts < 600) requestAnimationFrame(settle);
  }

  if (document.readyState === 'complete') requestAnimationFrame(settle);
  else window.addEventListener('load', () => requestAnimationFrame(settle), { once: true });
})();