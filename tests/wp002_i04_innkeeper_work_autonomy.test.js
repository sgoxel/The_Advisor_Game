const assert = require('assert');
global.window = global;
require('../js/advisor_conversation_contract.js');
require('../js/innkeeper_work_autonomy.js');

const contract = global.Game.AdvisorConversationContract;
const autonomy = global.Game.InnkeeperWorkAutonomy;

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:main',
    campaignRef: 'campaign:test-seed',
    locationRef: 'tile:12,20',
    worldRef: 'seed:test-seed',
    regionRef: 'region:0,0',
    contextRevision: 7,
    campaignMinute: 180,
    adviceDispositionBias: 'receptive',
    knownFactRefs: ['fact:weather:clear'],
    ...overrides
  };
}

function evaluate(message, overrides = {}) {
  return autonomy.evaluate(contract.normalize(message, context(overrides)));
}

const authoritativeState = {
  actor: { id: 'protagonist:main', tile: [12, 20], resources: 11 },
  opportunities: [{ id: 'opportunity:existing' }],
  innkeeper: { id: 'npc:innkeeper:1', tile: [13, 20] }
};
const before = JSON.stringify(authoritativeState);

const accepted = evaluate('Please ask the innkeeper about work.', { adviceDispositionBias: 'receptive' });
assert.strictEqual(accepted.status, 'ready');
assert.strictEqual(accepted.authority, 'character-decision');
assert.strictEqual(accepted.driver, 'local-bot-compatible');
assert.strictEqual(accepted.intentKind, 'inquire-innkeeper-work');
assert.strictEqual(accepted.actorId, 'protagonist:main');
assert.strictEqual(accepted.outcome, 'consider-now');
assert.strictEqual(accepted.sourceDisposition, 'accepted');
assert.strictEqual(accepted.canRequestSimulationValidation, true);
assert.strictEqual(accepted.requiresSimulationValidation, true);

const delayed = evaluate('Please ask the innkeeper about work later.', { adviceDispositionBias: 'receptive' });
assert.strictEqual(delayed.status, 'ready');
assert.strictEqual(delayed.outcome, 'delay');
assert.strictEqual(delayed.canRequestSimulationValidation, false);
assert.strictEqual(delayed.requiresSimulationValidation, false);

const rejected = evaluate('Please ask the innkeeper about work.', { adviceDispositionBias: 'skeptical' });
assert.strictEqual(rejected.status, 'ready');
assert.strictEqual(rejected.outcome, 'reject');
assert.strictEqual(rejected.canRequestSimulationValidation, false);

const direct = evaluate('Talk to the innkeeper and ask about jobs.', { adviceDispositionBias: 'receptive' });
assert.strictEqual(direct.status, 'ready');
assert.strictEqual(direct.outcome, 'consider-now');
assert.strictEqual(direct.reinterpretedDirectControl, true,
  'Direct-control wording must be reinterpreted through Character autonomy, never executed as a player command.');

for (const decision of [accepted, delayed, rejected, direct]) {
  assert.strictEqual(decision.canSelectTarget, false);
  assert.strictEqual(decision.canCreateOpportunity, false);
  assert.strictEqual(decision.canCommitInteraction, false);
  assert.strictEqual(decision.canMoveActor, false);
  assert.strictEqual(decision.canAwardResources, false);
  assert.strictEqual(decision.canValidateAction, false);
  assert.strictEqual(decision.canExecuteAction, false);
  assert.strictEqual(decision.canResolveAction, false);
  assert.strictEqual(decision.canMutateWorld, false);
  assert.strictEqual(decision.authoritativeTargetRef, null);
  assert.strictEqual(decision.authoritativeOpportunityRef, null);
  assert(Object.isFrozen(decision), 'Autonomy decision must be immutable.');
}

assert.strictEqual(JSON.stringify(authoritativeState), before,
  'Autonomy evaluation must not mutate actor, resources, opportunity, target, or other authoritative world state.');

const unrelated = autonomy.evaluate(contract.normalize('Please ask the innkeeper about tonight\'s weather.', context()));
assert.strictEqual(unrelated.status, 'rejected');
assert.strictEqual(unrelated.reasonCode, 'WRONG_INTENT');
assert.strictEqual(unrelated.outcome, null);
assert.strictEqual(unrelated.canMutateWorld, false);

const invalidContext = autonomy.evaluate(contract.normalize(
  'Please ask the innkeeper about work.',
  context({ authority: 'renderer' })
));
assert.strictEqual(invalidContext.status, 'rejected');
assert.strictEqual(invalidContext.reasonCode, 'INVALID_ADVICE_RESULT');
assert.strictEqual(invalidContext.canRequestSimulationValidation, false);
assert.strictEqual(invalidContext.canMutateWorld, false);

const first = JSON.stringify(evaluate('Please ask the innkeeper about work.', { adviceDispositionBias: 'receptive' }));
const second = JSON.stringify(evaluate('Please ask the innkeeper about work.', { adviceDispositionBias: 'receptive' }));
assert.strictEqual(first, second, 'Equivalent Character decision inputs must produce deterministic output.');

console.log('WP-002/I04 innkeeper work autonomy regression: PASS');
