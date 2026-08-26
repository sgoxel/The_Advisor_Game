import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../schemas/campaign-state.schema.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));

function collectPropertyNames(node, names = []) {
  if (!node || typeof node !== 'object') return names;
  if (node.properties && typeof node.properties === 'object') {
    names.push(...Object.keys(node.properties));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) collectPropertyNames(item, names);
    } else if (value && typeof value === 'object') {
      collectPropertyNames(value, names);
    }
  }
  return names;
}

test('campaign state schema is explicitly versioned and strict', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.schemaVersion, { type: 'integer', const: 1 });
  assert.deepEqual(
    schema.required,
    ['schemaVersion', 'campaignId', 'world', 'character', 'chronicle']
  );
});

test('world state preserves deterministic generation identity and state differences', () => {
  const world = schema.$defs.worldState;
  assert.equal(world.additionalProperties, false);
  for (const required of ['seed', 'generationVersion', 'turn', 'stateDifferences']) {
    assert.ok(world.required.includes(required), `world must require ${required}`);
  }
});

test('character state includes authoritative resume fields without direct player-control fields', () => {
  const character = schema.$defs.characterState;
  assert.equal(character.additionalProperties, false);
  for (const required of [
    'id',
    'name',
    'rank',
    'location',
    'personality',
    'goals',
    'memories',
    'relationships',
    'advisorTrust',
    'advisorInstructions',
    'resources',
    'decisionState'
  ]) {
    assert.ok(character.required.includes(required), `character must require ${required}`);
  }

  for (const forbidden of ['playerAction', 'forcedAction', 'directCommand']) {
    assert.ok(!(forbidden in character.properties), `${forbidden} must not be serializable`);
  }
});

test('schema does not define provider credentials or raw model traffic', () => {
  const names = collectPropertyNames(schema).map((name) => name.toLowerCase());
  const forbidden = [
    'apikey',
    'api_key',
    'credential',
    'credentials',
    'token',
    'secret',
    'modelrequest',
    'modelrequests',
    'modelresponse',
    'modelresponses',
    'rawrequest',
    'rawrequests',
    'rawresponse',
    'rawresponses'
  ];

  for (const key of forbidden) {
    assert.ok(!names.includes(key), `schema must not serialize ${key}`);
  }
});

test('rank progression matches README product order', () => {
  assert.deepEqual(schema.$defs.characterState.properties.rank.enum, [
    'Peasant',
    'Villager',
    'Squire',
    'Knight',
    'Baron',
    'Duke',
    'Lord',
    'Prince',
    'King',
    'Emperor'
  ]);
});
