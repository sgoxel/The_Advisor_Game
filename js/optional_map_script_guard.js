/*
  FILE PURPOSE:
  Keep optional same-origin startup map probes quiet when candidate JS bundles
  are absent, without weakening strict browser error checks or changing map data.
*/

window.Game = window.Game || {};

(function installOptionalMapScriptGuard() {
  if (typeof document === "undefined" || typeof window === "undefined") return;

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

  function probeOptionalScriptInWorker(url) {
    if (typeof Worker !== "function" || typeof Blob !== "function" || !URL || typeof URL.createObjectURL !== "function") {
      return Promise.resolve({ ok: false, unavailable: true });
    }

    const workerSource = `
      self.onmessage = async function (event) {
        try {
          const response = await fetch(event.data.url, { cache: "no-cache" });
          if (!response.ok) {
            self.postMessage({ ok: false, status: response.status });
            return;
          }
          const source = await response.text();
          self.postMessage({ ok: true, source: source });
        } catch (error) {
          self.postMessage({ ok: false, networkError: true });
        }
      };
    `;

    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));

    return new Promise((resolve) => {
      const worker = new Worker(workerUrl);
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve(result);
      };

      worker.onmessage = (event) => finish(event && event.data ? event.data : { ok: false });
      worker.onerror = () => finish({ ok: false, workerError: true });
      worker.postMessage({ url });
    });
  }

  head.appendChild = function appendChildWithOptionalMapProbe(node) {
    if (!isGuardedOptionalMapScript(node)) return appendChild(node);

    const requestedSrc = node.src;

    Promise.resolve().then(async () => {
      const probe = await probeOptionalScriptInWorker(requestedSrc);
      if (!probe || !probe.ok || typeof probe.source !== "string") {
        if (typeof node.onerror === "function") node.onerror.call(node, new Event("error"));
        return;
      }

      const objectUrl = URL.createObjectURL(new Blob([probe.source], { type: "text/javascript" }));
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
    }).catch(() => {
      if (typeof node.onerror === "function") node.onerror.call(node, new Event("error"));
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
