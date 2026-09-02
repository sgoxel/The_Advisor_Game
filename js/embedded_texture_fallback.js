/*
  R04 / #355: lazy embedded terrain-texture fallback.

  Normal public/static startup should use the canonical external texture files.
  The 3.77 MB embedded payload remains unchanged and is loaded only when one of
  those external terrain textures cannot be fetched. file:// keeps an eager
  fallback because browser fetch interception is not available for direct local
  Image loads and offline behavior must remain deterministic.
*/
(function installEmbeddedTextureFallback(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const Config = Game.Config || {};
  const EMBEDDED_SCRIPT = 'js/embedded_textures.js';
  const SCRIPT_ID = 'r04EmbeddedTexturesFallbackPayload';
  const textureFiles = new Set(Object.values(Config.TEXTURE_FILES || {}).map(String));
  const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
  let payloadPromise = null;

  function fileNameFrom(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return new URL(String(raw || ''), global.location?.href || 'http://localhost/').pathname.split('/').pop() || '';
    } catch (_) {
      return String(typeof input === 'string' ? input : input?.url || '').split('/').pop() || '';
    }
  }

  function isTerrainTextureRequest(input) {
    return textureFiles.has(fileNameFrom(input));
  }

  function ensurePayload() {
    if (Game.EmbeddedTextures && Object.keys(Game.EmbeddedTextures).length) return Promise.resolve(Game.EmbeddedTextures);
    if (payloadPromise) return payloadPromise;

    payloadPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID);
      const finish = () => {
        const embedded = Game.EmbeddedTextures || {};
        if (Object.keys(embedded).length) resolve(embedded);
        else reject(new Error('Embedded terrain texture payload loaded without assets.'));
      };
      if (existing) {
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener('error', () => reject(new Error('Embedded terrain texture payload failed to load.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = EMBEDDED_SCRIPT;
      script.async = false;
      script.dataset.fallbackOnly = 'true';
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => reject(new Error('Embedded terrain texture payload failed to load.')), { once: true });
      document.head.appendChild(script);
    });
    return payloadPromise;
  }

  async function fallbackResponse(input, originalError) {
    const fileName = fileNameFrom(input);
    const embedded = await ensurePayload();
    const dataUrl = embedded[fileName];
    if (!dataUrl || !nativeFetch) throw originalError || new Error(`Missing embedded terrain texture: ${fileName}`);
    return nativeFetch(dataUrl);
  }

  if (nativeFetch) {
    global.fetch = async function embeddedTextureFallbackFetch(input, init) {
      if (!isTerrainTextureRequest(input)) return nativeFetch(input, init);
      try {
        const response = await nativeFetch(input, init);
        if (response && response.ok) return response;
        return fallbackResponse(input, new Error(`External terrain texture unavailable: ${fileNameFrom(input)}`));
      } catch (error) {
        return fallbackResponse(input, error);
      }
    };
  }

  // Direct file:// texture loads do not pass through fetch in renderer.js. Load
  // the unchanged embedded payload on that explicitly offline/local path only.
  if (global.location?.protocol === 'file:') ensurePayload().catch((error) => console.warn('Embedded terrain fallback unavailable.', error));

  Game.EmbeddedTextureFallback = Object.freeze({
    version: 'r04-embedded-texture-fallback-v1',
    payloadUrl: EMBEDDED_SCRIPT,
    isTerrainTextureRequest,
    ensurePayload,
    get payloadRequested() { return Boolean(payloadPromise); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
