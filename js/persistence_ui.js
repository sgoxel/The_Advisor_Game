/* R02-T07/#89: presentation-only persistence controls bound to authoritative campaign APIs. */
window.Game = window.Game || {};

(function () {
  const Game = window.Game;

  function install() {
    if (Game.PersistenceUI || !Game.CampaignPersistence || !Game.State) return;
    const ribbon = document.querySelector('.ribbon');
    const app = document.getElementById('app');
    if (!ribbon || !app) return;

    const style = document.createElement('style');
    style.textContent = `
      .persistence-tools{display:flex;align-items:center;gap:6px;margin-left:auto;padding:4px 6px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(16,24,34,.78);backdrop-filter:blur(4px);min-height:44px}
      .persistence-seed{display:flex;align-items:center;gap:4px;min-width:0}
      .persistence-seed-value{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/1.2 system-ui,sans-serif}
      .persistence-status{display:flex;align-items:center;gap:5px;min-width:72px;font:600 12px/1.2 system-ui,sans-serif}
      .persistence-status-symbol{width:10px;height:10px;border:2px solid currentColor;border-radius:50%;box-sizing:border-box}
      .persistence-action{min-width:44px;min-height:44px;padding:7px 10px;border:1px solid rgba(255,255,255,.28);border-radius:7px;background:rgba(255,255,255,.08);color:inherit;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer}
      .persistence-action:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      .persistence-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,8,12,.52)}
      .persistence-overlay[hidden]{display:none}
      .persistence-sheet{width:min(500px,calc(100vw - 32px));max-height:80vh;overflow:auto;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(17,25,35,.97);box-shadow:0 18px 55px rgba(0,0,0,.45);padding:18px;color:#fff;font-family:system-ui,sans-serif}
      .persistence-sheet h2{margin:0 0 12px;font-size:20px}.persistence-sheet p{margin:8px 0;line-height:1.4}
      .persistence-sheet-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.persistence-sheet-actions .persistence-action{flex:1 1 140px}
      .persistence-file{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
      .persistence-result{border-left:3px solid currentColor;padding:8px 10px;margin:12px 0;background:rgba(255,255,255,.06)}
      .persistence-meta{font-size:12px;opacity:.86;overflow-wrap:anywhere}
      @media(max-width:720px){.persistence-tools{position:absolute;left:8px;right:8px;top:58px;z-index:30;margin:0;justify-content:space-between}.persistence-seed-value{max-width:32vw}.persistence-overlay{align-items:flex-end;padding:0}.persistence-sheet{width:100%;max-height:72vh;border-radius:14px 14px 0 0;padding:16px}.persistence-sheet-actions{display:grid;grid-template-columns:1fr}.persistence-sheet-actions .persistence-action{width:100%}}
      @media(max-width:720px) and (orientation:landscape){.persistence-overlay{align-items:stretch;justify-content:flex-end;background:rgba(4,8,12,.38)}.persistence-sheet{width:min(440px,64vw);max-height:none;border-radius:12px 0 0 12px}}
      @media(prefers-reduced-motion:reduce){.persistence-tools,.persistence-sheet{scroll-behavior:auto}}
    `;
    document.head.appendChild(style);

    const tools = document.createElement('div');
    tools.className = 'persistence-tools';
    tools.setAttribute('aria-label', 'Campaign persistence controls');
    tools.innerHTML = `
      <div class="persistence-seed">
        <span aria-hidden="true">✦</span>
        <span id="persistenceSeedValue" class="persistence-seed-value"></span>
        <button id="copySeedBtn" class="persistence-action" type="button" aria-label="Copy world seed">Copy</button>
      </div>
      <div class="persistence-status" role="status" aria-live="polite"><span class="persistence-status-symbol" aria-hidden="true"></span><span id="persistenceStatusText">Ready</span></div>
      <button id="exportSaveBtn" class="persistence-action" type="button">Export save</button>
      <button id="importSaveBtn" class="persistence-action" type="button">Import / Load</button>`;
    ribbon.appendChild(tools);

    const overlay = document.createElement('div');
    overlay.className = 'persistence-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="persistence-sheet" role="dialog" aria-modal="true" aria-labelledby="persistenceDialogTitle" aria-describedby="persistenceDialogStatus">
        <h2 id="persistenceDialogTitle">Import or load campaign</h2>
        <p>Choose a campaign save. The current campaign remains active until validation succeeds and you explicitly load it.</p>
        <input id="campaignSaveFile" class="persistence-file" type="file" accept="application/json,.json" />
        <button id="chooseSaveFileBtn" class="persistence-action" type="button">Choose save file</button>
        <div id="persistenceDialogStatus" class="persistence-result" role="status" aria-live="polite">No file selected.</div>
        <div id="persistenceValidatedMeta" class="persistence-meta"></div>
        <div class="persistence-sheet-actions">
          <button id="cancelLoadBtn" class="persistence-action" type="button">Cancel</button>
          <button id="loadCampaignBtn" class="persistence-action" type="button" disabled>Load campaign</button>
        </div>
      </section>`;
    app.appendChild(overlay);

    const seedValue = tools.querySelector('#persistenceSeedValue');
    const statusText = tools.querySelector('#persistenceStatusText');
    const importBtn = tools.querySelector('#importSaveBtn');
    const exportBtn = tools.querySelector('#exportSaveBtn');
    const copyBtn = tools.querySelector('#copySeedBtn');
    const fileInput = overlay.querySelector('#campaignSaveFile');
    const chooseBtn = overlay.querySelector('#chooseSaveFileBtn');
    const cancelBtn = overlay.querySelector('#cancelLoadBtn');
    const loadBtn = overlay.querySelector('#loadCampaignBtn');
    const dialogStatus = overlay.querySelector('#persistenceDialogStatus');
    const meta = overlay.querySelector('#persistenceValidatedMeta');
    let validatedText = null;
    let returnFocus = importBtn;

    function currentSeed() { return String(Game.State?.world?.seed || ''); }
    function refreshSeed() {
      const seed = currentSeed();
      seedValue.textContent = `Seed: ${seed || '—'}`;
      seedValue.title = seed;
      seedValue.setAttribute('aria-label', seed ? `World seed ${seed}` : 'World seed unavailable');
    }
    function setStatus(text) { statusText.textContent = text; }
    function resetDialog() {
      validatedText = null;
      fileInput.value = '';
      loadBtn.disabled = true;
      dialogStatus.textContent = 'No file selected.';
      meta.textContent = '';
    }
    function openDialog() {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : importBtn;
      resetDialog();
      overlay.hidden = false;
      chooseBtn.focus();
    }
    function closeDialog() {
      overlay.hidden = true;
      resetDialog();
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    }
    function validationMessage(result) {
      if (result.code === 'UNSUPPORTED_VERSION') return ['Save version not supported', result.message];
      if (result.code === 'SEED_MISMATCH') return ['Seed differs from current campaign', result.message];
      if (result.code === 'INVALID_JSON' || result.code === 'INVALID_ENVELOPE' || result.code === 'UNSUPPORTED_FORMAT') return ['Invalid save file', result.message];
      return ['Save data is incomplete', result.message || 'This file could not be validated as a supported campaign save.'];
    }

    exportBtn.addEventListener('click', () => {
      try {
        const result = Game.CampaignPersistence.downloadSave();
        setStatus('Save exported');
        window.setTimeout(() => setStatus('Ready'), 2500);
        exportBtn.title = result.filename;
      } catch (_error) { setStatus("Couldn't export save"); }
    });
    importBtn.addEventListener('click', openDialog);
    chooseBtn.addEventListener('click', () => fileInput.click());
    cancelBtn.addEventListener('click', closeDialog);
    copyBtn.addEventListener('click', async () => {
      const seed = currentSeed();
      if (!seed) return;
      try {
        await navigator.clipboard.writeText(seed);
        setStatus('Seed copied');
      } catch (_error) {
        const temp = document.createElement('textarea'); temp.value = seed; document.body.appendChild(temp); temp.select(); document.execCommand('copy'); temp.remove(); setStatus('Seed copied');
      }
      window.setTimeout(() => setStatus('Ready'), 1800);
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const checked = Game.CampaignPersistence.validateSave(text);
        if (!checked.ok) {
          const [heading, detail] = validationMessage(checked);
          dialogStatus.textContent = `${heading}. ${detail}`;
          meta.textContent = `Selected file: ${file.name}`;
          loadBtn.disabled = true;
          validatedText = null;
          return;
        }
        validatedText = text;
        dialogStatus.textContent = 'Ready to load. Validation succeeded.';
        meta.textContent = `File: ${file.name} · Seed: ${checked.authoritativeState.world.seed} · Version: ${Game.CampaignPersistence.version}`;
        loadBtn.disabled = false;
        loadBtn.focus();
      } catch (_error) {
        dialogStatus.textContent = 'Invalid save file. This file could not be read or validated.';
        loadBtn.disabled = true;
        validatedText = null;
      }
    });
    loadBtn.addEventListener('click', () => {
      if (!validatedText) return;
      const loaded = Game.CampaignPersistence.loadSave(validatedText);
      if (!loaded.ok) {
        const [heading, detail] = validationMessage(loaded);
        dialogStatus.textContent = `Campaign could not be loaded. ${heading}. ${detail}`;
        loadBtn.disabled = true;
        return;
      }
      refreshSeed();
      setStatus('Campaign loaded');
      closeDialog();
      window.setTimeout(() => setStatus('Ready'), 2500);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]),input:not([disabled])')).filter((node) => !node.classList.contains('persistence-file'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    refreshSeed();
    window.setInterval(refreshSeed, 1000);
    Game.PersistenceUI = Object.freeze({ refreshSeed, openDialog, closeDialog });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
