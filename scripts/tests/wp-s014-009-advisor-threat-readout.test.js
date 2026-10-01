'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const modulePath = path.join(repoRoot, 'scripts/ui/advisor-threat-readout-ui.js');

delete require.cache[require.resolve(modulePath)];

global.window = global;
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;

global.SeedSystem = {
  getCampaign(){ return { seed: 'WP-S014-009-SEED', protagonistId: 'protagonist' }; },
  getSettings(){ return { seed: 'WP-S014-009-SEED' }; }
};
global.GameTime = { getTimestampKey(){ return '1201-10-01 18:15:00'; } };
global.LocalSecurityIncidents = {
  list(seed, opts){
    return [
      { id: 'SEC-01', category: 'banditry', severity: 'serious', status: 'active', summary: 'Banditry near the south road', locationRef: { label: 'South road' } },
      { id: 'SEC-02', category: 'security', severity: 'moderate', status: 'active', summary: 'Patrol disturbance', locationRef: { label: 'West gate' } }
    ].slice(0, opts && opts.limit || 10);
  }
};
global.ProtagonistMartialReadiness = {
  context(seed, options){
    return { ok: true, readinessScore: 64, status: 'prepared-with-constraints', limitations: ['active-injury', 'high-fatigue'] };
  }
};

const UI = require(modulePath);
assert.equal(UI.VERSION, 'advisor-threat-readout-v1');
assert.deepStrictEqual(UI.EVIDENCE_MODES, ['ordinary', 'alerted', 'ready', 'blocked', 'unavailable']);

const ordinary = UI.evidenceModel('ordinary');
assert.equal(ordinary.threat.status, 'clear');
assert.equal(ordinary.readiness.status, 'prepared-with-constraints');

const alerted = UI.evidenceModel('alerted');
assert.equal(alerted.threat.status, 'elevated');
assert.equal(alerted.readiness.status, 'prepared-with-constraints');

const today = UI.currentModel({ seed: 'WP-S014-009-SEED', when: '1201-10-01 18:15:00' });
assert.equal(today.threat.status, 'elevated');
assert.equal(today.readiness.status, 'prepared-with-constraints');
assert(today.summary.includes('Threat') || today.summary.includes('security'));
assert(today.sources.some(s => s.name === 'LocalSecurityIncidents'));
assert(today.sources.some(s => s.name === 'ProtagonistMartialReadiness'));

const markup = UI.markup(today);
for (const phrase of ['THREAT · SECURITY · READINESS', 'Local security', 'Martial readiness', 'Read-only', 'PRESENTATION ONLY']) {
  assert(markup.includes(phrase), 'missing phrase: ' + phrase);
}

const proof = UI.proof();
assert.equal(proof.pass, true);
assert.equal(proof.eventDriven, true);
assert.equal(proof.boundedReads, true);
assert.equal(proof.fullWorldScan, false);
assert.equal(proof.directWorldMutation, false);
assert.equal(proof.directActionExecution, false);

const snapshot = UI.snapshot();
assert.equal(snapshot.authority.eventDriven, true);
assert.equal(snapshot.authority.boundedReads, true);
assert.equal(snapshot.authority.perFrameRender, false);
assert.equal(snapshot.authority.fullWorldScan, false);
assert.equal(snapshot.authority.DirectWorldMutation, undefined);
assert.equal(snapshot.authority.directWorldMutation, false);
assert.equal(snapshot.authority.directActionExecution, false);
assert.equal(snapshot.authority.threatAuthority, false);
assert.equal(snapshot.authority.readinessAuthority, false);
assert.equal(snapshot.authority.presentationOnly, true);

const source = fs.readFileSync(modulePath, 'utf8');
for (const forbidden of ['ActionExecutor.execute', 'ProtagonistCommandEvaluator.evaluate', 'execute(', 'evaluate(', 'setInterval(', 'requestAnimationFrame', 'Date.now']) {
  assert(!source.includes(forbidden), 'forbidden mutation/action path: ' + forbidden);
}

const index = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const scriptTag = 'scripts/ui/advisor-threat-readout-ui.js?v=advisor-threat-readout-v1';
assert(index.includes(scriptTag), 'script tag missing from index.html');
assert(index.indexOf(scriptTag) < index.indexOf('scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1'), 'threat readout should load before chat');

const css = fs.readFileSync(path.join(repoRoot, 'styles/main.css'), 'utf8');
for (const selector of ['.advisor-threat-readout{', '.advisor-threat-body{', '.advisor-threat-meter{', '.advisor-threat-grid{']) {
  assert(css.includes(selector), 'missing CSS selector: ' + selector);
}
assert(css.includes('@media(max-width:520px)'));
assert(css.includes('@media(max-height:430px) and (orientation:landscape)'));

console.log(JSON.stringify({
  wp: 'WP-S014-009',
  pass: true,
  classification: 'MIXED',
  threatStatus: today.threat.status,
  readinessStatus: today.readiness.status,
  incidentCount: today.threat.count,
  mutationGuard: true
}, null, 2));
