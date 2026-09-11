const assert = require('assert');
global.window = global;
require('../js/advisor_conversation_contract.js');

const contract = global.Game.AdvisorConversationContract;

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

const inputContext = context();
const before = JSON.stringify(inputContext);
const result = contract.normalize('Please ask the innkeeper about work.', inputContext);

assert.strictEqual(result.status, 'ready');
assert.strictEqual(result.authority, 'character-advice');
assert.strictEqual(result.canMutateWorld, false);
assert.strictEqual(result.canValidateAction, false);
assert.strictEqual(result.canExecuteAction, false);
assert.strictEqual(result.canResolveAction, false);
assert.strictEqual(JSON.stringify(inputContext), before, 'Normalizing Advisor text must not mutate Simulation context.');

assert(result.intent, 'The bounded innkeeper-work inquiry intent must be recognized.');
assert.strictEqual(result.intent.kind, 'inquire-innkeeper-work');
assert.strictEqual(result.intent.authority, 'character-consideration');
assert.strictEqual(result.intent.purpose, 'ask-local-innkeeper-about-work');
assert.strictEqual(result.intent.targetRole, 'innkeeper');
assert.strictEqual(result.intent.requiresCharacterDecision, true);
assert.strictEqual(result.intent.requiresSimulationValidation, true);
assert.strictEqual(result.intent.canCommitInteraction, false);
assert.strictEqual(result.intent.canCreateOpportunity, false);
assert.strictEqual(result.intent.canMoveActor, false);
assert.strictEqual(result.intent.authoritativeTargetRef, null);
assert.strictEqual(result.intent.authoritativeOpportunityRef, null);
assert.strictEqual(result.record.advisor.intent, result.intent);
assert(Object.isFrozen(result.intent), 'Intent must be immutable.');
assert(Object.isFrozen(result), 'Normalized Advisor result must remain immutable.');

const directLanguage = contract.normalize('Talk to the innkeeper and ask about jobs.', inputContext);
assert.strictEqual(directLanguage.intent.kind, 'inquire-innkeeper-work');
assert.strictEqual(directLanguage.record.advisor.directControlLanguageReinterpreted, true,
  'Direct-control wording must remain reinterpreted as non-binding advice.');
assert.strictEqual(directLanguage.intent.canCommitInteraction, false);

const unrelated = contract.normalize('Please ask the innkeeper about tonight\'s weather.', inputContext);
assert.strictEqual(unrelated.intent, null, 'Unrelated innkeeper conversation must not become a work-inquiry intent.');

const workWithoutRole = contract.normalize('Please look for work.', inputContext);
assert.strictEqual(workWithoutRole.intent, null, 'Generic work advice is outside this atomic intent contract.');

const invalid = contract.normalize('Please ask the innkeeper about work.', context({ authority: 'renderer' }));
assert.strictEqual(invalid.status, 'rejected');
assert.strictEqual(invalid.intent, null);
assert.strictEqual(invalid.canMutateWorld, false);

const first = contract.canonicalStringify('Please ask the innkeeper about work.', inputContext);
const second = contract.canonicalStringify('Please ask the innkeeper about work.', inputContext);
assert.strictEqual(first, second, 'Equivalent Advisor inputs must produce deterministic canonical output.');

console.log('WP-002/I01 innkeeper work inquiry intent regression: PASS');
