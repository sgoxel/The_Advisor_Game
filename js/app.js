import { exportCampaignState } from './campaign-save.js';
import { importCampaignState } from './campaign-import.js';
import { createPhase1Simulation } from './phase1-runtime.js';
import { bindLocalization } from './i18n.js';
import { resolveSeededSimulationCheck } from './seeded-check-resolution.js';

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

export function createPublicSeededCheckInput(state, checkId = 'p02-public-check-a') {
  return Object.freeze({
    worldSeed: state.world.seed,
    generationVersion: state.world.generationVersion,
    checkId,
    context: Object.freeze({
      campaignId: state.campaignId,
      turn: state.world.turn,
      characterId: state.character.id,
    }),
  });
}

export function bindSeededCheckWorkflow(documentRef, simulation, t = (key) => key) {
  const runButton = documentRef.getElementById?.('run-seeded-check');
  const checkSelect = documentRef.getElementById?.('check-identity');

  const renderContext = () => {
    const state = simulation.getCampaignState();
    const input = createPublicSeededCheckInput(state, checkSelect?.value || 'p02-public-check-a');
    setText(documentRef, 'check-seed', input.worldSeed);
    setText(documentRef, 'check-generation', input.generationVersion);
    setText(documentRef, 'check-turn', input.context.turn);
    setText(documentRef, 'check-result', '—');
    setText(documentRef, 'check-percentile', '—');
    return input;
  };

  const run = () => {
    const input = createPublicSeededCheckInput(
      simulation.getCampaignState(),
      checkSelect?.value || 'p02-public-check-a'
    );
    const result = resolveSeededSimulationCheck(input);
    setText(documentRef, 'check-seed', input.worldSeed);
    setText(documentRef, 'check-generation', input.generationVersion);
    setText(documentRef, 'check-turn', input.context.turn);
    setText(documentRef, 'check-result', result.rollUint32);
    setText(documentRef, 'check-percentile', result.percentile);
    setLocalizedStatus(documentRef, 'check-status', 'status.checkResolved', 'success', t);
    return result;
  };

  checkSelect?.addEventListener?.('change', () => {
    renderContext();
    setLocalizedStatus(documentRef, 'check-status', 'status.checkReady', 'ready', t);
  });
  runButton?.addEventListener?.('click', run);
  renderContext();

  return { run, renderContext };
}

export function bindSaveWorkflow(documentRef, simulation = createPhase1Simulation(), t = (key) => key, onStateChange = () => {}) {
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
      onStateChange();
      setLocalizedStatus(documentRef, 'save-status', 'status.imported', 'success', t);
    } catch (error) {
      setWorkflowError(documentRef, error, t);
    }
  });

  resetButton?.addEventListener?.('click', () => {
    simulation.resetCampaignState();
    render();
    onStateChange();
    setLocalizedStatus(documentRef, 'save-status', 'status.reset', 'ready', t);
  });

  return { simulation, render };
}

export function initializeApp(documentRef = globalThis.document) {
  if (!documentRef) {
    return { ready: false, reason: 'document-unavailable' };
  }

  const localization = bindLocalization(documentRef, documentRef.documentElement?.lang ?? 'en');
  const simulation = createPhase1Simulation();
  const checkWorkflow = bindSeededCheckWorkflow(documentRef, simulation, localization.t);
  setLocalizedStatus(documentRef, 'app-status', 'status.ready', 'ready', localization.t);
  setLocalizedStatus(documentRef, 'check-status', 'status.checkReady', 'ready', localization.t);
  bindSaveWorkflow(documentRef, simulation, localization.t, checkWorkflow.renderContext);

  if (documentRef.documentElement?.dataset) {
    documentRef.documentElement.dataset.appReady = 'true';
  }
  return { ready: true, phase: APP_FOUNDATION.phase };
}

if (typeof document !== 'undefined') {
  initializeApp(document);
}
