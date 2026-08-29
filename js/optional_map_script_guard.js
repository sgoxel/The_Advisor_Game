/*
  FILE PURPOSE:
  Keep optional same-origin startup map probes quiet when candidate JS bundles
  are absent, without weakening strict browser error checks or changing map data.
*/

window.Game = window.Game || {};

(function installOptionalMapScriptGuard() {
  if (typeof document === "undefined" || typeof window === "undefined" || typeof fetch !== "function") return;

  const head = document.head;
  if (!head || head.__simsoftOptionalMapScriptGuardInstalled) return;

  const appendChild = head.appendChild.bind(head);

  function isGuardedOptionalMapScript(node) {
    if (!(node instanceof HTMLScriptElement) || !node.src) return false;
    if (window.location && window.location.protocol === "file:") return false;

    try {
      const url = new URL(node.src, window.location.href);
      if (!/^https?:$/.test(url.protocol)) return false;
      if (url.origin !== window.location.origin) return false;
      return /\/map\/.*\.js$/i.test(url.pathname);
    } catch (error) {
      return false;
    }
  }

  head.appendChild = function appendChildWithOptionalMapProbe(node) {
    if (!isGuardedOptionalMapScript(node)) return appendChild(node);

    const requestedSrc = node.src;

    Promise.resolve().then(async () => {
      try {
        const response = await fetch(requestedSrc, { cache: "no-cache" });
        if (!response.ok) {
          if (typeof node.onerror === "function") node.onerror.call(node, new Event("error"));
          return;
        }

        const source = await response.text();
        const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        const originalOnload = node.onload;
        const originalOnerror = node.onerror;
        let cleaned = false;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          URL.revokeObjectURL(objectUrl);
        };

        node.onload = function guardedScriptLoad(event) {
          cleanup();
          if (typeof originalOnload === "function") originalOnload.call(node, event);
        };
        node.onerror = function guardedScriptError(event) {
          cleanup();
          if (typeof originalOnerror === "function") originalOnerror.call(node, event);
        };
        node.src = objectUrl;
        appendChild(node);
      } catch (error) {
        if (typeof node.onerror === "function") node.onerror.call(node, new Event("error"));
      }
    });

    return node;
  };

  Object.defineProperty(head, "__simsoftOptionalMapScriptGuardInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
