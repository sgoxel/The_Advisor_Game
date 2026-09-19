const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'npc_workplaces.js'), 'utf8');
const context = {
  window: { Game: {} },
  document: { readyState: 'loading', addEventListener() {} },
  console
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc_workplaces.js' });

const workplaces = context.window.Game.NPCWorkplaces;
assert(workplaces, 'NPCWorkplaces must install');

const buildings = [
  { id: 'building:smithy', type: 'smithy', role: 'production', width: 10, height: 10 },
  { id: 'building:mill', type: 'mill', role: 'production', width: 10, height: 10 },
  { id: 'building:market', type: 'market', role: 'trade', width: 10, height: 10 },
  { id: 'building:workshop', type: 'workshop', role: 'labor', width: 10, height: 10 }
];
const village = { buildings, population: [] };

assert.strictEqual(workplaces.isCompatible(buildings[0], 'miller'), false, 'miller must reject smithy even though both have production role');
assert.strictEqual(workplaces.isCompatible(buildings[1], 'miller'), true, 'miller must accept mill');
assert.strictEqual(workplaces.isCompatible(buildings[0], 'blacksmith'), true, 'blacksmith must accept smithy');
assert.strictEqual(workplaces.isCompatible(buildings[2], 'trader'), true, 'trader must accept market');
assert.strictEqual(workplaces.isCompatible(buildings[3], 'laborer'), true, 'laborer must accept workshop/labor');

const residents = [
  { id: 'mira', profession: 'miller' },
  { id: 'borin', profession: 'blacksmith' },
  { id: 'elin', profession: 'trader' },
  { id: 'hale', profession: 'laborer' }
];
const first = workplaces.assign('seed-a', village, residents);
const second = workplaces.assign('seed-a', village, residents);
assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)), 'equivalent seed/village/professions must assign deterministically');

const byId = new Map(first.assignments.map((entry) => [entry.id, entry]));
assert.strictEqual(byId.get('mira').workplaceBuildingId, 'building:mill', 'miller must resolve to mill, never smithy');
assert.strictEqual(byId.get('borin').workplaceBuildingId, 'building:smithy', 'blacksmith must resolve to smithy');
assert.strictEqual(byId.get('elin').workplaceBuildingId, 'building:market', 'trader must resolve to market');
assert.strictEqual(byId.get('hale').workplaceBuildingId, 'building:workshop', 'laborer must resolve to workshop');

const withoutMill = workplaces.assign('seed-a', { buildings: buildings.filter((b) => b.type !== 'mill') }, [{ id: 'mira', profession: 'miller' }]);
assert.strictEqual(withoutMill.assignments[0].workplaceKind, 'unassigned-incompatible-or-full', 'missing compatible workplace must remain truthful');
assert.strictEqual(withoutMill.assignments[0].workplaceBuildingId, null, 'missing compatible workplace must not fall back to smithy');

const rematerialized = workplaces.assign('seed-a', village, [{ id: 'mira', profession: 'miller', workplaceBuildingId: 'building:smithy' }]);
assert.strictEqual(rematerialized.assignments[0].workplaceBuildingId, 'building:mill', 'stale incompatible presentation/persisted hint must not survive authoritative recomputation');

console.log('PASS NPC workplace profession compatibility regression');
