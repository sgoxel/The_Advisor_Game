import { exportCampaignState } from './campaign-save.js';
import { importCampaignState } from './campaign-import.js';
import { createPhase1Simulation } from './phase1-runtime.js';
import { bindLocalization } from './i18n.js';

export const APP_FOUNDATION = Object.freeze({
  phase: 'P02',
  title: 'Seeded Checks and RNG Contract',
  runtime: 'static-client',
  coreRule: 'Player advises -> AI Character decides -> Simulation validates -> World reacts.'
});

export function summarizeCampaign(state) {
  const gold = state.character.resources.find((resource) => resource.id === 'Gold')?.amount ?? 0;
  return {
    campaignId: state.campaignId,
    seed: state.world.seed,
    turn: state.world.turn,
    character: state.character.name,
    rank: state.character.rank,
    gold,
  };
}

function setText(documentRef, id, value) {
  const element = documentRef.getElementById?.(id);
  if (element) element.textContent = String(value);
}

export function renderCampaignSummary(documentRef, state) {
  const summary = summarizeCampaign(state);
  setText(documentRef, 'campaign-id', summary.campaignId);
  setText(documentRef, 'campaign-seed', summary.seed);
  setText(documentRef, 'campaign-turn', summary.turn);
  setText(documentRef, 'character-name', summary.character);
  setText(documentRef, 'character-rank', summary.rank);
  setText(documentRef, 'character-gold', summary.gold);
  return summary;
}

function setLocalizedStatus(documentRef, id, key, state, t) {
  const status = documentRef.getElementById?.(id);
  if (!status) return;
  status.dataset.i18nStatus = key;
  status.textContent = t(key);
  status.dataset.state = state;
}

function setWorkflowError(documentRef, error, t) {
  const status = documentRef.getElementById?.('save-status');
  if (!status) return;
  delete status.dataset.i18nStatus;
  status.textContent = error instanceof Error ? error.message : t('status.importFailed');
  status.dataset.state = 'error';
}

export function bindSaveWorkflow(documentRef, simulation = createPhase1Simulation(), t = (key) => key) {
  const saveText = documentRef.getElementById?.('save-json');
  const exportButton = documentRef.getElementById?.('export-save');
  const importButton = documentRef.getElementById?.('import-save');
  const resetButton = documentRef.getElementById?.('reset-campaign');

  const render = () => renderCampaignSummary(documentRef, simulation.getCampaignState());
  render();

  exportButton?.addEventListener?.('click', () => {
    const json = exportCampaignState(simulation.getCampaignState());
    if (saveText) saveText.value = json;
    setLocalizedStatus(documentRef, 'save-status', 'status.exported', 'success', t);
  });

  importButton?.addEventListener?.('click', () => {
    try {
      if (!saveText || !saveText.value.trim()) {
        setLocalizedStatus(documentRef, 'save-status', 'status.importPrompt', 'error', t);
        return;
      }
      importCampaignState(saveText.value, simulation);
      render();
      setLocalizedStatus(documentRef, 'save-status', 'status.imported', 'success', t);
    } catch (error) {
      setWorkflowError(documentRef, error, t);
    }
  });

  resetButton?.addEventListener?.('click', () => {
    simulation.resetCampaignState();
    render();
    setLocalizedStatus(documentRef, 'save-status', 'status.reset', 'ready', t);
  });

  return { simulation, render };
}

export function initializeApp(documentRef = globalThis.document) {
  if (!documentRef) {
    return { ready: false, reason: 'document-unavailable' };
  }

  const localization = bindLocalization(documentRef, documentRef.documentElement?.lang ?? 'en');
  setLocalizedStatus(documentRef, 'app-status', 'status.ready', 'ready', localization.t);
  bindSaveWorkflow(documentRef, createPhase1Simulation(), localization.t);

  if (documentRef.documentElement?.dataset) {
    documentRef.documentElement.dataset.appReady = 'true';
  }
  return { ready: true, phase: APP_FOUNDATION.phase };
}

if (typeof document !== 'undefined') {
  initializeApp(document);
}
