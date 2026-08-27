import { exportCampaignState } from './campaign-save.js';
import { importCampaignState } from './campaign-import.js';
import { createPhase1Simulation } from './phase1-runtime.js';

export const APP_FOUNDATION = Object.freeze({
  phase: 'P01',
  title: 'Campaign State and Versioned Saves',
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
  const element = documentRef.getElementById(id);
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

function setWorkflowStatus(documentRef, message, state = 'ready') {
  const status = documentRef.getElementById('save-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

export function bindSaveWorkflow(documentRef, simulation = createPhase1Simulation()) {
  const saveText = documentRef.getElementById('save-json');
  const exportButton = documentRef.getElementById('export-save');
  const importButton = documentRef.getElementById('import-save');
  const resetButton = documentRef.getElementById('reset-campaign');

  const render = () => renderCampaignSummary(documentRef, simulation.getCampaignState());
  render();

  exportButton?.addEventListener('click', () => {
    const json = exportCampaignState(simulation.getCampaignState());
    if (saveText) saveText.value = json;
    setWorkflowStatus(documentRef, 'Exported versioned campaign JSON.', 'success');
  });

  importButton?.addEventListener('click', () => {
    try {
      if (!saveText || !saveText.value.trim()) throw new Error('Paste campaign JSON before importing.');
      importCampaignState(saveText.value, simulation);
      render();
      setWorkflowStatus(documentRef, 'Campaign imported after simulation validation.', 'success');
    } catch (error) {
      setWorkflowStatus(documentRef, error instanceof Error ? error.message : 'Campaign import failed.', 'error');
    }
  });

  resetButton?.addEventListener('click', () => {
    simulation.resetCampaignState();
    render();
    setWorkflowStatus(documentRef, 'Campaign reset to the Phase 1 demo state.', 'ready');
  });

  return { simulation, render };
}

export function initializeApp(documentRef = globalThis.document) {
  if (!documentRef) {
    return { ready: false, reason: 'document-unavailable' };
  }

  const status = documentRef.getElementById('app-status');
  if (status) {
    status.textContent = 'Ready';
    status.dataset.state = 'ready';
  }

  const workflow = bindSaveWorkflow(documentRef);
  documentRef.documentElement.dataset.appReady = 'true';
  return { ready: true, phase: APP_FOUNDATION.phase, workflow };
}

if (typeof document !== 'undefined') {
  initializeApp(document);
}
