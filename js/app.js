export const APP_FOUNDATION = Object.freeze({
  phase: 'P01',
  title: 'Campaign State and Versioned Saves',
  runtime: 'static-client',
  coreRule: 'Player advises -> AI Character decides -> Simulation validates -> World reacts.'
});

export function initializeApp(documentRef = globalThis.document) {
  if (!documentRef) {
    return { ready: false, reason: 'document-unavailable' };
  }

  const status = documentRef.getElementById('app-status');
  if (status) {
    status.textContent = 'Ready';
    status.dataset.state = 'ready';
  }

  documentRef.documentElement.dataset.appReady = 'true';
  return { ready: true, phase: APP_FOUNDATION.phase };
}

if (typeof document !== 'undefined') {
  initializeApp(document);
}
