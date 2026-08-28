/* R02 / #140: compact deterministic SEED-derived base political geography. */
(function installPoliticalGeography() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-political-geography-v1';
  const REALM_SPAN = 12;
  const PROVINCE_SPAN = 4;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function intCoord(value, name) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer.`);
    return n;
  }

  function requireComposition() {
    if (!Game.WorldComposition?.composeRegion) {
      throw new Error('WorldComposition is required before political geography queries.');
    }
    return Game.WorldComposition;
  }

  function macroAnchor(seed, macroX, macroY) {
    const jitterX = (hash32(`${seed}|realm:${macroX}:${macroY}|jx`) % 5) - 2;
    const jitterY = (hash32(`${seed}|realm:${macroX}:${macroY}|jy`) % 5) - 2;
    return Object.freeze({
      x: macroX * REALM_SPAN + Math.floor(REALM_SPAN / 2) + jitterX,
      y: macroY * REALM_SPAN + Math.floor(REALM_SPAN / 2) + jitterY
    });
  }

  function environmentDistance(a, b) {
    const fields = ['waterRatio', 'forestRatio', 'mountainRatio', 'hillRatio', 'meanElevation'];
    return fields.reduce((total, field) => total + Math.abs(Number(a?.[field] || 0) - Number(b?.[field] || 0)), 0);
  }

  function realmCandidate(seed, macroX, macroY) {
    const composition = requireComposition();
    const anchor = macroAnchor(seed, macroX, macroY);
    const anchorRegion = composition.composeRegion(seed, anchor.x, anchor.y);
    const terrainKey = [
      anchorRegion.environmentFeatures.join(','),
      anchorRegion.environment.waterRatio,
      anchorRegion.environment.meanElevation,
      anchorRegion.connections.continuityKey
    ].join('|');
    const identityHash = hash32(`${seed}|realm:${macroX}:${macroY}|${terrainKey}`);
    return Object.freeze({
      id: `realm:${identityHash.toString(16).padStart(8, '0')}`,
      macroX,
      macroY,
      anchor,
      anchorEnvironment: anchorRegion.environment,
      terrainIdentity: identityHash.toString(16).padStart(8, '0')
    });
  }

  function selectRealm(seed, regionX, regionY) {
    const composition = requireComposition();
    const region = composition.composeRegion(seed, regionX, regionY);
    const baseMacroX = Math.floor(regionX / REALM_SPAN);
    const baseMacroY = Math.floor(regionY / REALM_SPAN);
    let best = null;

    for (let my = baseMacroY - 1; my <= baseMacroY + 1; my += 1) {
      for (let mx = baseMacroX - 1; mx <= baseMacroX + 1; mx += 1) {
        const candidate = realmCandidate(seed, mx, my);
        const dx = regionX - candidate.anchor.x;
        const dy = regionY - candidate.anchor.y;
        const distanceCost = (dx * dx) + (dy * dy);
        const geographyCost = environmentDistance(region.environment, candidate.anchorEnvironment) * 18;
        const routeBonus = region.connections && Object.values(region.connections.roads || {}).some(Boolean) ? -2 : 0;
        const tieBreak = (hash32(`${seed}|${regionX}:${regionY}|${candidate.id}`) % 1000) / 1000000;
        const score = distanceCost + geographyCost + routeBonus + tieBreak;
        if (!best || score < best.score) best = { candidate, score };
      }
    }
    return Object.freeze({ ...best.candidate, selectionScore: Number(best.score.toFixed(6)) });
  }

  function provinceState(seed, regionX, regionY, realm) {
    const px = Math.floor(regionX / PROVINCE_SPAN);
    const py = Math.floor(regionY / PROVINCE_SPAN);
    const composition = requireComposition().composeRegion(seed, regionX, regionY);
    const terrainClass = composition.environmentFeatures[0] || (composition.environment.meanElevation >= 0.5 ? 'upland' : 'lowland');
    const idHash = hash32(`${seed}|${realm.id}|province:${px}:${py}|${terrainClass}`);
    return Object.freeze({
      id: `region-polity:${idHash.toString(16).padStart(8, '0')}`,
      base: true,
      authority: 'simulation',
      realmId: realm.id,
      provinceX: px,
      provinceY: py,
      terrainClass
    });
  }

  function edgePair(x, y, direction) {
    const delta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[direction];
    if (!delta) throw new TypeError('direction must be north, east, south, or west.');
    const neighbor = { x: x + delta[0], y: y + delta[1] };
    const a = `${x},${y}`;
    const b = `${neighbor.x},${neighbor.y}`;
    return Object.freeze({ neighbor, key: a < b ? `${a}|${b}` : `${b}|${a}` });
  }

  function borderDescriptor(seed, regionX, regionY, direction) {
    const composition = requireComposition();
    const pair = edgePair(regionX, regionY, direction);
    const hereRealm = selectRealm(seed, regionX, regionY);
    const thereRealm = selectRealm(seed, pair.neighbor.x, pair.neighbor.y);
    const here = composition.composeRegion(seed, regionX, regionY);
    const there = composition.composeRegion(seed, pair.neighbor.x, pair.neighbor.y);
    const waterBarrier = Math.max(here.environment.waterRatio, there.environment.waterRatio);
    const mountainBarrier = Math.max(here.environment.mountainRatio, there.environment.mountainRatio);
    const routeConnected = Object.values(here.connections.roads || {}).some(Boolean) && Object.values(there.connections.roads || {}).some(Boolean);
    let physicalConstraint = 'open-terrain';
    if (waterBarrier >= 0.28) physicalConstraint = 'water-frontier';
    else if (mountainBarrier >= 0.18) physicalConstraint = 'mountain-frontier';
    else if (routeConnected) physicalConstraint = 'route-corridor';
    const realmBoundary = hereRealm.id !== thereRealm.id;
    return Object.freeze({
      id: `base-border:${hash32(`${seed}|${pair.key}`).toString(16).padStart(8, '0')}`,
      base: true,
      authority: 'simulation',
      edgeKey: pair.key,
      neighborRegionX: pair.neighbor.x,
      neighborRegionY: pair.neighbor.y,
      realmBoundary,
      realmId: hereRealm.id,
      neighborRealmId: thereRealm.id,
      physicalConstraint,
      permeability: physicalConstraint === 'route-corridor' ? 'high' : physicalConstraint === 'open-terrain' ? 'medium' : 'low',
      mutableCampaignOverrideAllowed: true
    });
  }

  function baseRegion(seedInput, regionXInput, regionYInput) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const composition = requireComposition().composeRegion(seed, regionX, regionY);
    const realm = selectRealm(seed, regionX, regionY);
    const province = provinceState(seed, regionX, regionY, realm);
    const settlementAffiliation = composition.settlement ? Object.freeze({
      settlementId: composition.settlement.id,
      realmId: realm.id,
      provinceId: province.id,
      base: true
    }) : null;
    const borders = {};
    for (const direction of ['north', 'east', 'south', 'west']) borders[direction] = borderDescriptor(seed, regionX, regionY, direction);
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      base: true,
      seed,
      regionX,
      regionY,
      realm: Object.freeze({
        id: realm.id,
        base: true,
        authority: 'simulation',
        macroX: realm.macroX,
        macroY: realm.macroY,
        anchor: realm.anchor,
        terrainIdentity: realm.terrainIdentity
      }),
      province,
      settlementAffiliation,
      borders: Object.freeze(borders),
      geographyContext: Object.freeze({
        environmentFeatures: Object.freeze([...composition.environmentFeatures]),
        connectionKey: composition.connections.continuityKey,
        compositionFingerprint: composition.baseFingerprint
      }),
      presentationAuthority: false
    });
  }

  function resolveCurrent(baseState, campaignHistory = {}) {
    if (!baseState || baseState.authority !== 'simulation' || baseState.base !== true) {
      throw new TypeError('Simulation-owned base political geography is required.');
    }
    const history = campaignHistory && typeof campaignHistory === 'object' ? campaignHistory : {};
    const realmId = String(history.realmId || baseState.realm.id);
    const provinceId = String(history.provinceId || baseState.province.id);
    const settlementRealmId = baseState.settlementAffiliation
      ? String(history.settlementRealmId || realmId)
      : null;
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      sourceBase: Object.freeze({
        realmId: baseState.realm.id,
        provinceId: baseState.province.id,
        settlementRealmId: baseState.settlementAffiliation?.realmId || null
      }),
      current: Object.freeze({
        realmId,
        provinceId,
        settlementRealmId,
        borderOverrides: Object.freeze({ ...(history.borderOverrides || {}) })
      }),
      basePreserved: true,
      presentationAuthority: false
    });
  }

  function neighborhood(seedInput, centerXInput, centerYInput, radius = 1) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const centerX = intCoord(centerXInput, 'centerX');
    const centerY = intCoord(centerYInput, 'centerY');
    const r = Math.max(0, Math.min(2, Math.trunc(Number(radius) || 0)));
    const regions = [];
    for (let y = centerY - r; y <= centerY + r; y += 1) {
      for (let x = centerX - r; x <= centerX + r; x += 1) regions.push(baseRegion(seed, x, y));
    }
    return Object.freeze(regions);
  }

  Game.PoliticalGeography = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    baseRegion,
    borderDescriptor,
    neighborhood,
    resolveCurrent
  });
})();
