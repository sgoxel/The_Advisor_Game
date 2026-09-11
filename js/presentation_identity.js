/* WP-111/I01: presentation-only stable keys derived from authoritative identities. */
(function installPresentationIdentity(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp111-i01-presentation-identity-v1';

  function clean(value) {
    const text = String(value ?? '').trim();
    return text || null;
  }

  function key(kind, identity) {
    const id = clean(identity);
    return id ? `${kind}:${id}` : null;
  }

  function npc(npcState) {
    return key('npc', npcState?.id);
  }

  function protagonist(playerState) {
    return key('protagonist', playerState?.id || playerState?.characterId || playerState?.stableId);
  }

  function worldObject(descriptor) {
    return key('world-object', descriptor?.objectId || descriptor?.id);
  }

  Game.PresentationIdentity = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    npc,
    protagonist,
    worldObject
  });

  // WP-111/I03: the culling module consumes these stable presentation keys and remains
  // presentation-only. It patches only the exported NPC presentation draw path; Simulation
  // coordinates, legality, relevance and identity remain untouched.
  Game.Utils?.loadScriptOnce?.('js/npc_culling_hysteresis.js', 'wp111NpcCullingHysteresisModule');
})(typeof window !== 'undefined' ? window : globalThis);
