/*
  Admin #233 / R04 #237: deterministic logical-tile NPC occupancy, yielding,
  adjacent NPC dialogue, and development-only activity/dialogue bubbles.

  Simulation owns NPC identity/location/activity. Canvas bubbles are debug/presentation only.
*/
(function installNpcSpatialRuntime() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'admin-100x100-npc-spatial-v1';
  const MINUTES_PER_DAY = 24 * 60;
  const DIALOGUE_START = 0.65;
  const DIALOGUE_END = 0.80;
  const REGION_SIZE = Number(Game.SpatialWorld?.regionSize || Game.Config?.LOGICAL_REGION_TILES || 100);
  const oldNpcWorld = Game.NPCWorld;
  const oldNpcLife = Game.NPCLife;
  let renderHookInstalled = false;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function key(row, col) { return `${row},${col}`; }
  function point(value) { return { row: Math.trunc(Number(value?.row) || 0), col: Math.trunc(Number(value?.col) || 0) }; }
  function inBounds(p) { return p.row >= 0 && p.row < REGION_SIZE && p.col >= 0 && p.col < REGION_SIZE; }
  function distance(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }
  function same(a, b) { return a && b && a.row === b.row && a.col === b.col; }

  function authoritativeGameMinutes() {
    const captured = Game.GameTime?.capture?.();
    const value = Number(captured?.totalGameMinutes ?? Game.State?.world?.gameTime?.totalGameMinutes ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function dayPosition(totalGameMinutes, offsetMinutes = 0) {
    const shifted = Number(totalGameMinutes || 0) + Number(offsetMinutes || 0);
    const minuteOfDay = ((shifted % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return minuteOfDay / MINUTES_PER_DAY;
  }

  function originBinding(world, village) {
    const local = world.originBaseState?.protagonistOrigin || { localRow: village.center?.row || 50, localCol: village.center?.col || 50 };
    const player = world.player || {};
    const localRow = Number(local.localRow ?? village.center?.row ?? 50);
    const localCol = Number(local.localCol ?? village.center?.col ?? 50);
    const strategicRow = Number.isFinite(Number(player.row)) ? Number(player.row) : localRow;
    const strategicCol = Number.isFinite(Number(player.col)) ? Number(player.col) : localCol;
    return { localRow, localCol, strategicRow, strategicCol, rowOffset: strategicRow - localRow, colOffset: strategicCol - localCol };
  }

  function strategic(local, binding) {
    return { row: local.row + binding.rowOffset, col: local.col + binding.colOffset, localRow: local.row, localCol: local.col };
  }

  function convertRoute(route, binding) {
    return (route || []).map((p) => strategic(point(p), binding));
  }

  function buildingMap(village) {
    return new Map((village.buildings || []).map((building) => [building.id, building]));
  }

  function ensureSpatialNpcs() {
    const world = Game.State?.world;
    const village = world?.originVillage;
    if (!world || !village || !Array.isArray(village.population)) return false;

    if (oldNpcWorld?.bindFromOriginVillage) oldNpcWorld.bindFromOriginVillage();
    const binding = originBinding(world, village);
    const existing = new Map((world.npcs || []).map((npc) => [npc.id, npc]));
    const buildings = buildingMap(village);

    world.npcs = village.population.map((person, index) => {
      const prior = existing.get(person.id) || {};
      const homeBuilding = buildings.get(person.homeBuildingId);
      const workBuilding = buildings.get(person.workBuildingId) || homeBuilding;
      const home = strategic(point(person.homeTile || homeBuilding?.entrance || village.center), binding);
      const work = strategic(point(person.workTile || workBuilding?.entrance || village.center), binding);
      const social = strategic(point(person.socialTile || village.center), binding);
      const routes = person.routes || {};
      return {
        ...prior,
        id: person.id,
        authority: 'simulation',
        name: person.name,
        occupation: person.occupation,
        regionX: Number(person.regionX || 0),
        regionY: Number(person.regionY || 0),
        row: Number.isFinite(Number(prior.row)) ? Math.trunc(Number(prior.row)) : home.row,
        col: Number.isFinite(Number(prior.col)) ? Math.trunc(Number(prior.col)) : home.col,
        localRow: Number.isFinite(Number(prior.localRow)) ? Math.trunc(Number(prior.localRow)) : home.localRow,
        localCol: Number.isFinite(Number(prior.localCol)) ? Math.trunc(Number(prior.localCol)) : home.localCol,
        activity: prior.activity || 'home',
        controlledBy: 'simulation',
        playerControllable: false,
        // Small deterministic schedule offsets prevent synchronized crowds while
        // keeping every resident on the same authoritative 24-hour world clock.
        routineOffsetMs: undefined,
        routineOffsetGameMinutes: (hash32(`${person.id}|${index}`) % 121) - 60,
        movementDecision: prior.movementDecision || 'hold',
        dialogueWith: null,
        dialogueLine: null,
        anchors: {
          home: { buildingId: person.homeBuildingId, ...home },
          work: { buildingId: person.workBuildingId || workBuilding?.id || null, ...work },
          social: { buildingId: null, ...social }
        },
        spatialRoutes: {
          homeToWork: convertRoute(routes.homeToWork, binding),
          workToSocial: convertRoute(routes.workToSocial, binding),
          socialToHome: convertRoute(routes.socialToHome, binding)
        }
      };
    });

    world.npcRuntime = {
      ...(world.npcRuntime || {}),
      // Keep the legacy version/binding fields so the older render wrapper does not
      // rebuild/slice the population before this compatibility layer runs.
      version: world.npcRuntime?.version || 'r04-character-world-icons-v1',
      authority: 'simulation',
      seed: String(world.seed || ''),
      bindingKey: world.npcRuntime?.bindingKey || `${binding.localRow},${binding.localCol}->${binding.strategicRow},${binding.strategicCol}`,
      originBinding: binding,
      spatialVersion: VERSION,
      spatialRegionSize: REGION_SIZE,
      routineClockAuthority: 'Game.GameTime',
      lastSpatialGameMinutes: Number(world.npcRuntime?.lastSpatialGameMinutes ?? authoritativeGameMinutes()),
      collisionCount: 0,
      sideStepCount: 0,
      yieldWaitCount: 0
    };
    return true;
  }

  function routePoint(route, progress) {
    if (!Array.isArray(route) || !route.length) return null;
    if (route.length === 1) return point(route[0]);
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    return point(route[Math.min(route.length - 1, Math.floor(t * route.length))]);
  }

  function desiredFor(npc, totalGameMinutes) {
    const position = dayPosition(totalGameMinutes, npc.routineOffsetGameMinutes);
    if (position < 0.25) {
      return { point: routePoint(npc.spatialRoutes.homeToWork, position / 0.25) || point(npc.anchors.work), activity: 'commuting-to-work' };
    }
    if (position < 0.50) return { point: point(npc.anchors.work), activity: 'working' };
    if (position < 0.65) {
      return { point: routePoint(npc.spatialRoutes.workToSocial, (position - 0.50) / 0.15) || point(npc.anchors.social), activity: 'local-errand' };
    }
    if (position < 0.80) return { point: point(npc.anchors.social), activity: 'social' };
    return { point: routePoint(npc.spatialRoutes.socialToHome, (position - 0.80) / 0.20) || point(npc.anchors.home), activity: 'returning-home' };
  }

  function footprintContains(footprint, p) {
    return Boolean(footprint && p.row >= footprint.row && p.row < footprint.row + footprint.height && p.col >= footprint.col && p.col < footprint.col + footprint.width);
  }

  function roadSet(village) {
    return new Set((village?.roadTiles || []).map((p) => key(p.row, p.col)));
  }

  function buildingBlockedAt(village, p, npc) {
    for (const building of village?.buildings || []) {
      if (building.passable) continue;
      if (!footprintContains(building.footprint, p)) continue;
      if (building.id === npc?.anchors?.home?.buildingId && same(p, point(npc.anchors.home))) return false;
      if (building.id === npc?.anchors?.work?.buildingId && same(p, point(npc.anchors.work))) return false;
      return true;
    }
    return false;
  }

  function walkable(village, roads, npc, p) {
    if (!inBounds(p)) return false;
    if (same(p, point(npc?.anchors?.home)) || same(p, point(npc?.anchors?.work)) || same(p, point(npc?.anchors?.social))) return true;
    if (buildingBlockedAt(village, p, npc)) return false;
    if (roads.size) return roads.has(key(p.row, p.col));
    return true;
  }

  function sideCandidates(previous, desired, seedKey) {
    const dr = Math.sign(desired.row - previous.row);
    const dc = Math.sign(desired.col - previous.col);
    let candidates;
    if (Math.abs(dc) >= Math.abs(dr)) {
      candidates = [{ row: desired.row - 1, col: desired.col }, { row: desired.row + 1, col: desired.col }];
    } else {
      candidates = [{ row: desired.row, col: desired.col - 1 }, { row: desired.row, col: desired.col + 1 }];
    }
    if ((hash32(seedKey) & 1) === 1) candidates.reverse();
    return candidates;
  }

  function findDialoguePairTiles(village, roads, occupied, preferredPoints = []) {
    const preferred = preferredPoints.map(point).filter(inBounds);
    const structuralFallback = (village?.buildings || [])
      .map((building) => building?.entrance)
      .filter(Boolean)
      .map(point)
      .filter(inBounds);
    const anchors = preferred.length ? preferred : structuralFallback;
    const all = Array.from(roads).map((text) => {
      const [r, c] = text.split(',');
      return { row: Number(r), col: Number(c) };
    });
    const nearestAnchorDistance = (candidate) => anchors.length
      ? Math.min(...anchors.map((anchor) => distance(candidate, anchor)))
      : 0;
    all.sort((a, b) => nearestAnchorDistance(a) - nearestAnchorDistance(b) || a.row - b.row || a.col - b.col);
    const dirs = [[0,1],[1,0],[0,-1],[-1,0]];
    for (const first of all) {
      if (occupied.has(key(first.row, first.col))) continue;
      for (const [dr, dc] of dirs) {
        const second = { row: first.row + dr, col: first.col + dc };
        if (!roads.has(key(second.row, second.col))) continue;
        if (occupied.has(key(second.row, second.col))) continue;
        return [first, second];
      }
    }
    return null;
  }

  function chooseDialoguePlan(npcs, totalGameMinutes, village, roads) {
    if (npcs.length < 2) return null;
    const globalPosition = dayPosition(totalGameMinutes);
    if (globalPosition < DIALOGUE_START || globalPosition >= DIALOGUE_END) return null;
    const cycleIndex = Math.floor(Math.max(0, Number(totalGameMinutes) || 0) / MINUTES_PER_DAY);
    const seed = String(Game.State?.world?.seed || '');
    const first = hash32(`${seed}|${cycleIndex}|dialogue-speaker`) % npcs.length;
    let second = hash32(`${seed}|${cycleIndex}|dialogue-listener`) % npcs.length;
    if (second === first) second = (second + 1) % npcs.length;
    const preferredDialogueContext = [
      point(npcs[first]?.anchors?.social || npcs[first]),
      point(npcs[second]?.anchors?.social || npcs[second])
    ];
    const tiles = findDialoguePairTiles(village, roads, new Set(), preferredDialogueContext);
    if (!tiles) return null;
    return { speakerId: npcs[first].id, listenerId: npcs[second].id, tiles, cycleIndex };
  }

  function resolveOccupancy(npcs, desiredMap, context = {}) {
    const village = context.village || Game.State?.world?.originVillage;
    const roads = context.roads || roadSet(village);
    const seed = String(context.seed ?? Game.State?.world?.seed ?? '');
    const step = Math.max(0, Math.floor(Number(context.step) || 0));
    const dialoguePlan = context.dialoguePlan || null;
    const occupied = new Map();
    const resolved = new Map();
    let collisionCount = 0;
    let sideStepCount = 0;
    let yieldWaitCount = 0;

    if (dialoguePlan) {
      const pair = [dialoguePlan.speakerId, dialoguePlan.listenerId];
      pair.forEach((id, index) => {
        const npc = npcs.find((candidate) => candidate.id === id);
        if (!npc) return;
        const target = point(dialoguePlan.tiles[index]);
        occupied.set(key(target.row, target.col), id);
        resolved.set(id, { point: target, decision: 'dialogue-position', collided: false });
      });
    }

    const ordered = npcs
      .filter((npc) => !resolved.has(npc.id))
      .slice()
      .sort((a, b) => {
        const pa = hash32(`${seed}|${step}|${a.id}`);
        const pb = hash32(`${seed}|${step}|${b.id}`);
        return pa - pb || String(a.id).localeCompare(String(b.id));
      });

    for (const npc of ordered) {
      const previous = point(npc);
      const desired = point(desiredMap.get(npc.id)?.point || previous);
      const desiredKey = key(desired.row, desired.col);
      const candidates = [
        { point: desired, decision: same(previous, desired) ? 'hold' : 'move' },
        ...sideCandidates(previous, desired, `${seed}|${step}|${npc.id}`).map((candidate) => ({ point: candidate, decision: 'side-step' })),
        { point: previous, decision: 'yield-wait' },
        { point: { row: previous.row - 1, col: previous.col }, decision: 'yield-detour' },
        { point: { row: previous.row, col: previous.col + 1 }, decision: 'yield-detour' },
        { point: { row: previous.row + 1, col: previous.col }, decision: 'yield-detour' },
        { point: { row: previous.row, col: previous.col - 1 }, decision: 'yield-detour' }
      ];

      let chosen = null;
      for (const candidate of candidates) {
        const candidatePoint = point(candidate.point);
        const candidateKey = key(candidatePoint.row, candidatePoint.col);
        if (occupied.has(candidateKey)) continue;
        if (!walkable(village, roads, npc, candidatePoint)) continue;
        chosen = { point: candidatePoint, decision: candidate.decision, collided: candidateKey !== desiredKey };
        break;
      }
      if (!chosen) {
        // Emergency deterministic free-tile search across the complete bounded region.
        // A 100x100 region has a maximum in-bounds Manhattan separation of 198 tiles;
        // searching 2 * REGION_SIZE guarantees that legal remaining capacity is found
        // without relaxing no-overlap, building or road/path legality.
        outer: for (let radius = 1; radius <= REGION_SIZE * 2; radius += 1) {
          for (let dr = -radius; dr <= radius; dr += 1) {
            for (let dc = -radius; dc <= radius; dc += 1) {
              if (Math.abs(dr) + Math.abs(dc) !== radius) continue;
              const candidatePoint = { row: previous.row + dr, col: previous.col + dc };
              const candidateKey = key(candidatePoint.row, candidatePoint.col);
              if (occupied.has(candidateKey) || !walkable(village, roads, npc, candidatePoint)) continue;
              chosen = { point: candidatePoint, decision: 'yield-detour', collided: true };
              break outer;
            }
          }
        }
      }
      if (!chosen) throw new Error(`No collision-safe tile available for NPC ${npc.id}.`);
      if (chosen.collided) collisionCount += 1;
      if (chosen.decision === 'side-step') sideStepCount += 1;
      if (chosen.decision === 'yield-wait') yieldWaitCount += 1;
      occupied.set(key(chosen.point.row, chosen.point.col), npc.id);
      resolved.set(npc.id, chosen);
    }

    return { resolved, collisionCount, sideStepCount, yieldWaitCount };
  }

  function dialogueLine(speaker, listener) {
    try {
      return oldNpcLife?.ambientDialogue?.(speaker, listener, {
        location: Game.State?.world?.originVillage?.name || 'starter village',
        environment: Game.State?.world?.currentRegion?.theme || 'village',
        totalGameMinutes: Game.GameTime?.capture?.()?.totalGameMinutes ?? 0
      })?.line || `${speaker.name} and ${listener.name} are talking.`;
    } catch (_) {
      return `${speaker.name} and ${listener.name} are talking.`;
    }
  }

  function updateAt(_legacyElapsedMs = null) {
    const worldBefore = Game.State?.world;
    const totalGameMinutes = authoritativeGameMinutes();
    const step = Math.floor(totalGameMinutes);
    const priorRuntime = worldBefore?.npcRuntime;
    const priorStateKey = `${String(worldBefore?.seed || '')}|${String(priorRuntime?.bindingKey || '')}|${step}`;
    if (Array.isArray(worldBefore?.npcs) && worldBefore.npcs.length > 0 && priorRuntime?.lastRoutineStateKey === priorStateKey) {
      priorRuntime.lastSpatialGameMinutes = totalGameMinutes;
      return true;
    }

    if (!ensureSpatialNpcs()) return false;
    const world = Game.State.world;
    const village = world.originVillage;
    const roads = roadSet(village);
    const stateKey = `${String(world.seed || '')}|${String(world.npcRuntime?.bindingKey || '')}|${step}`;
    const desiredMap = new Map();
    for (const npc of world.npcs) desiredMap.set(npc.id, desiredFor(npc, totalGameMinutes));
    const dialoguePlan = chooseDialoguePlan(world.npcs, totalGameMinutes, village, roads);
    const resolution = resolveOccupancy(world.npcs, desiredMap, { village, roads, seed: world.seed, step, dialoguePlan });

    for (const npc of world.npcs) {
      const resolved = resolution.resolved.get(npc.id);
      const desired = desiredMap.get(npc.id);
      npc.row = resolved.point.row;
      npc.col = resolved.point.col;
      npc.localRow = npc.row - Number(world.npcRuntime.originBinding?.rowOffset || 0);
      npc.localCol = npc.col - Number(world.npcRuntime.originBinding?.colOffset || 0);
      npc.activity = desired?.activity || npc.activity || 'idle';
      npc.movementDecision = resolved.decision;
      npc.dialogueWith = null;
      npc.dialogueLine = null;
    }

    world.npcDialogues = [];
    if (dialoguePlan) {
      const speaker = world.npcs.find((npc) => npc.id === dialoguePlan.speakerId);
      const listener = world.npcs.find((npc) => npc.id === dialoguePlan.listenerId);
      if (speaker && listener) {
        const line = dialogueLine(speaker, listener);
        speaker.activity = 'talking';
        listener.activity = 'talking';
        speaker.dialogueWith = listener.id;
        listener.dialogueWith = speaker.id;
        speaker.dialogueLine = line;
        listener.dialogueLine = line;
        world.npcDialogues.push({
          authority: 'presentation-context',
          authoritativeFact: false,
          speakerId: speaker.id,
          listenerId: listener.id,
          line,
          adjacent: distance(point(speaker), point(listener)) === 1
        });
      }
    }

    world.npcRuntime.lastRoutineStateKey = stateKey;
    world.npcRuntime.lastSpatialGameMinutes = totalGameMinutes;
    world.npcRuntime.collisionCount = resolution.collisionCount;
    world.npcRuntime.sideStepCount = resolution.sideStepCount;
    world.npcRuntime.yieldWaitCount = resolution.yieldWaitCount;
    return true;
  }

  function capture() {
    return JSON.parse(JSON.stringify(Game.State?.world?.npcs || []));
  }

  function bubbleText(npc) {
    const activity = String(npc.activity || 'idle').replaceAll('-', ' ');
    const decision = npc.movementDecision && !['move', 'hold', 'dialogue-position'].includes(npc.movementDecision)
      ? ` · ${String(npc.movementDecision).replaceAll('-', ' ')}` : '';
    return `${npc.name}: ${activity}${decision}`;
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBubble(ctx, x, y, text, widthLimit = 240) {
    const paddingX = 6;
    const height = 18;
    const measured = Math.min(widthLimit, Math.max(56, ctx.measureText(text).width + paddingX * 2));
    const left = x - measured / 2;
    const top = y - height;
    ctx.fillStyle = 'rgba(15, 20, 27, 0.86)';
    ctx.strokeStyle = 'rgba(235, 225, 198, 0.82)';
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, left, top, measured, height, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f5f1e7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let output = text;
    while (ctx.measureText(output).width > measured - paddingX * 2 && output.length > 4) output = `${output.slice(0, -4)}…`;
    ctx.fillText(output, x, top + height / 2 + 0.5);
    return { width: measured, height };
  }

  function drawDevelopmentBubbles() {
    if (Game.Config?.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES === false) return;
    const canvas = oldNpcWorld?.ensureOverlay?.() || document.getElementById('npcWorldOverlay');
    const renderer = Game.Renderer;
    const world = Game.State?.world;
    if (!canvas || !renderer || !Array.isArray(world?.npcs)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.lineJoin = 'round';

    const paired = new Set();
    let dialoguePairCount = 0;
    for (const dialogue of world.npcDialogues || []) {
      const a = world.npcs.find((npc) => npc.id === dialogue.speakerId);
      const b = world.npcs.find((npc) => npc.id === dialogue.listenerId);
      if (!a || !b) continue;
      const pa = renderer.gridToScreen(a.row, a.col, 0, 0);
      const pb = renderer.gridToScreen(b.row, b.col, 0, 0);
      if (!Number.isFinite(pa.x) || !Number.isFinite(pb.x)) continue;
      paired.add(a.id);
      paired.add(b.id);
      const text = `${a.name} ↔ ${b.name}: ${dialogue.line}`;
      drawBubble(ctx, (pa.x + pb.x) / 2, Math.min(pa.y, pb.y) - 28, text, 320);
      dialoguePairCount += 1;
    }

    let activityBubbleCount = 0;
    world.npcs.forEach((npc, index) => {
      if (paired.has(npc.id)) return;
      if (Game.NPCRelevanceRuntime?.detailEligible && !Game.NPCRelevanceRuntime.detailEligible(npc)) return;
      const p = renderer.gridToScreen(npc.row, npc.col, 0, 0);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const laneOffset = (index % 3) * 4;
      drawBubble(ctx, p.x, p.y - 24 - laneOffset, bubbleText(npc), 220);
      activityBubbleCount += 1;
    });

    ctx.restore();
    canvas.dataset.activityBubbleCount = String(activityBubbleCount);
    canvas.dataset.dialoguePairCount = String(dialoguePairCount);
    canvas.dataset.spatialNpcVersion = VERSION;
    canvas.dataset.spatialRegionSize = String(REGION_SIZE);
    canvas.dataset.debugPresentationAuthority = 'presentation-only';
  }

  function drawPresentation() {
    oldNpcWorld?.drawPresentation?.();
    drawDevelopmentBubbles();
  }

  function replaceNpcLifeApi() {
    if (!oldNpcLife) return;
    const safeApplySchedules = function applySchedulesWithoutTeleport(totalGameMinutesInput = null) {
      if (!ensureSpatialNpcs()) return [];
      const results = [];
      for (const npc of Game.State.world.npcs) {
        const state = oldNpcLife.scheduleState(npc, totalGameMinutesInput);
        npc.dailySchedule = state;
        results.push(state);
      }
      return results;
    };
    const contextualConversation = function contextualConversationSpatial(context = {}) {
      const active = Game.State?.world?.npcDialogues?.[0];
      if (active) return Object.freeze({ ...active, version: VERSION, externalLlmRequired: false });
      return oldNpcLife.contextualConversation(context);
    };
    Game.NPCLife = Object.freeze({ ...oldNpcLife, version: VERSION, applySchedules: safeApplySchedules, contextualConversation });
  }

  function installRenderHook() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function spatialNpcRenderWorld(force) {
      const result = renderWorld(force);
      // updateAt() performs the authoritative same-minute state-key guard before it
      // calls ensureSpatialNpcs(). Do not remap the complete population on every
      // presentation frame only to have updateAt() immediately return.
      updateAt();
      oldNpcWorld?.drawPresentation?.();
      drawDevelopmentBubbles();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize() {
    if (!Game.NPCWorld || !Game.State?.world) return false;
    ensureSpatialNpcs();
    replaceNpcLifeApi();
    installRenderHook();
    const legacy = Game.NPCWorld;
    Game.NPCWorld = Object.freeze({
      ...legacy,
      spatialVersion: VERSION,
      regionSize: REGION_SIZE,
      maxVisibleNpcs: Math.max(Number(legacy.maxVisibleNpcs || 0), Number(Game.State.world.originVillage?.population?.length || 0)),
      updateAt,
      capture,
      drawPresentation,
      drawDevelopmentBubbles
    });
    updateAt();
    drawPresentation();
    return true;
  }

  Game.NPCSpatial = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    presentationAuthority: 'presentation-only',
    routineClockAuthority: 'Game.GameTime',
    regionSize: REGION_SIZE,
    ensureSpatialNpcs,
    resolveOccupancy,
    updateAt,
    capture,
    drawDevelopmentBubbles
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();