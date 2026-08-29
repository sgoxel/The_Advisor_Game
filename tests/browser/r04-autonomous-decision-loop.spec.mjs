import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('./');
  for (const src of [
    './js/action_legality.js', './js/spatial_action_legality.js', './js/interaction_target.js',
    './js/interaction_validation.js', './js/world_action_resolution.js', './js/protagonist_driver_intent.js',
    './js/local_bot_driver.js', './js/autonomous_action_execution.js', './js/autonomous_decision_loop.js'
  ]) await page.addScriptTag({ url: src });
  await page.waitForFunction(() => Boolean(
    window.Game?.AutonomousDecisionLoop?.prepare &&
    window.Game?.AutonomousActionExecution?.execute &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.CampaignPersistence?.serializeSave
  ));
  await page.evaluate(() => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.GameTime.stop();
    game.GameTime.setForTest(600);
    game.State.world.seed = 'seed-42'; game.State.world.rows = 3; game.State.world.cols = 3;
    game.State.world.terrain = [[tile(),tile(),tile()],[tile(),tile(),tile()],[tile(),tile(),tile()]];
    Object.assign(game.State.world.player, { row:0,col:0,moving:false,startRow:0,startCol:0,targetRow:0,targetCol:0,progress:1,pathQueue:[] });
    game.WorldDeltaPersistence.clearAll();
  });
}

const context = (minute = 600, revision = 31, extra = {}) => ({
  authority:'simulation', actorId:'protagonist:1', campaignRef:'campaign:alpha', locationRef:'site:village-square',
  worldRef:'world:seed-42', regionRef:'region:0,0', contextRevision:revision, campaignMinute:minute,
  actorStateRef:'state:ready', needs:{work:70}, relevance:'active', regionX:0, regionY:0, intervalMinutes:5, ...extra
});
const move = (extra = {}) => ({ id:'opportunity:move-east', goalType:'travel', actionType:'move', locationRef:'site:village-square', priority:10, urgency:20, distance:2, ...extra });
const execution = (revision = 31, traversable = true) => ({
  authority:'simulation', revision, routes:[{
    opportunityId:'opportunity:move-east', kind:'spatial', destinationRef:'destination:1,1',
    validationContext:{ authority:'simulation', actorId:'protagonist:1', campaignRef:'campaign:alpha', locationRef:'site:village-square', worldRef:'world:seed-42', regionRef:'region:0,0', revision, actorTags:['walking'], actions:{move:{enabled:true,requiresDestination:true}}, destinations:[{ref:'destination:1,1',worldRef:'world:seed-42',regionRef:'region:0,0',available:true,traversable}] },
    resolutionContext:{ authority:'simulation', revision, spatialRules:[{destinationRef:'destination:1,1',row:1,col:1}] }
  }]
});

test.beforeEach(async ({ page }) => boot(page));

test('authoritative campaign minute gates deterministic wait and avoids duplicate execution', async ({ page }) => {
  const out = await page.evaluate(({ c, opportunity, route }) => {
    const game = window.Game, loop = game.AutonomousDecisionLoop;
    const prepared = loop.prepare(c, [opportunity]);
    const first = loop.resolvePrepared(prepared.prepared, c, route);
    const sameMinute = loop.prepare(c, [opportunity]);
    game.GameTime.setForTest(c.campaignMinute + 5);
    const later = loop.prepare({ ...c, campaignMinute: c.campaignMinute + 5 }, [opportunity]);
    return { first, sameMinute, later, pos:{row:game.State.world.player.row,col:game.State.world.player.col}, checkpoint:loop.readCheckpoint(c) };
  }, { c:context(), opportunity:move(), route:execution() });
  expect(out.first).toMatchObject({ status:'resolved', reasonCode:'OK' });
  expect(out.sameMinute).toMatchObject({ status:'wait', reasonCode:'WAIT_INTERVAL', nextDecisionMinute:605 });
  expect(out.later.status).toBe('ready');
  expect(out.pos).toEqual({row:1,col:1});
  expect(out.checkpoint).toMatchObject({ serial:1, campaignMinute:600, contextRevision:31, lastStatus:'resolved' });
});

test('prepared work becomes stale when authoritative revision advances and cannot mutate', async ({ page }) => {
  const out = await page.evaluate(({ c, opportunity, route }) => {
    const game=window.Game, loop=game.AutonomousDecisionLoop;
    const prepared=loop.prepare(c,[opportunity]);
    const before=game.AuthoritativeState.canonicalStringify(game.State);
    const stale=loop.resolvePrepared(prepared.prepared,{...c,contextRevision:c.contextRevision+1},route);
    return {stale,before,after:game.AuthoritativeState.canonicalStringify(game.State),delta:game.WorldDeltaPersistence.capture(game.State.world.seed)};
  }, {c:context(),opportunity:move(),route:execution()});
  expect(out.stale).toMatchObject({status:'stale',reasonCode:'STALE_PREPARED_WORK'});
  expect(out.after).toBe(out.before);
  expect(out.delta.regions).toHaveLength(0);
});

test('prepared work becomes stale when authoritative campaign time advances', async ({ page }) => {
  const out = await page.evaluate(({ c, opportunity, route }) => {
    const game=window.Game, loop=game.AutonomousDecisionLoop;
    const prepared=loop.prepare(c,[opportunity]);
    const before=game.AuthoritativeState.canonicalStringify(game.State);
    game.GameTime.setForTest(c.campaignMinute + 1);
    const stale=loop.resolvePrepared(prepared.prepared,{...c,campaignMinute:c.campaignMinute+1},route);
    return {stale,before,after:game.AuthoritativeState.canonicalStringify(game.State),delta:game.WorldDeltaPersistence.capture(game.State.world.seed)};
  }, {c:context(),opportunity:move(),route:execution()});
  expect(out.stale).toMatchObject({status:'stale',reasonCode:'STALE_PREPARED_WORK',authoritativeCampaignMinute:601});
  expect(out.after).toBe(out.before);
  expect(out.delta.regions).toHaveLength(0);
});

test('schedule, location and relevance filtering are bounded and deterministic', async ({ page }) => {
  const out = await page.evaluate(({ c, base }) => {
    const loop=window.Game.AutonomousDecisionLoop;
    const many=Array.from({length:60},(_,i)=>({...base,id:`opp:${String(i).padStart(2,'0')}`,priority:i,timeWindows:[{startMinute:590,endMinute:610}]}));
    many.push({...base,id:'wrong-location',locationRef:'site:elsewhere'});
    many.push({...base,id:'closed',timeWindows:[{startMinute:700,endMinute:800}]});
    const ready=loop.prepare(c,many);
    const far=loop.prepare({...c,relevance:'far'},many);
    return {count:ready.prepared?.opportunities?.length, ids:ready.prepared?.opportunities?.map(x=>x.id), far};
  }, {c:context(),base:move()});
  expect(out.count).toBe(24);
  expect(out.ids).toEqual(Array.from({length:24},(_,i)=>`opp:${String(i).padStart(2,'0')}`));
  expect(out.far).toMatchObject({status:'idle',reasonCode:'IRRELEVANT_CONTEXT'});
});

test('rejected decision records deterministic short retry without world mutation', async ({ page }) => {
  const out = await page.evaluate(({c,opportunity,route})=>{
    const game=window.Game, loop=game.AutonomousDecisionLoop;
    const prepared=loop.prepare(c,[opportunity]);
    const rejected=loop.resolvePrepared(prepared.prepared,c,route);
    const before=game.AuthoritativeState.capture(game.State);
    const retryNow=loop.prepare(c,[opportunity]);
    game.GameTime.setForTest(c.campaignMinute+1);
    const retryLater=loop.prepare({...c,campaignMinute:c.campaignMinute+1},[opportunity]);
    return {rejected,retryNow,retryLater,before,after:game.AuthoritativeState.capture(game.State),checkpoint:loop.readCheckpoint(c)};
  },{c:context(),opportunity:move(),route:execution(31,false)});
  expect(out.rejected.status).toBe('rejected');
  expect(out.retryNow).toMatchObject({status:'wait',reasonCode:'WAIT_INTERVAL',nextDecisionMinute:601});
  expect(out.retryLater.status).toBe('ready');
  expect(out.after.world.protagonist).toEqual(out.before.world.protagonist);
  expect(out.checkpoint.lastStatus).toBe('rejected');
});

test('save/load restores decision checkpoint and authoritative time so resume cannot replay the same decision', async ({ page }) => {
  const out=await page.evaluate(({c,opportunity,route})=>{
    const game=window.Game, loop=game.AutonomousDecisionLoop;
    const prepared=loop.prepare(c,[opportunity]); loop.resolvePrepared(prepared.prepared,c,route);
    const saved=game.CampaignPersistence.serializeSave();
    game.WorldDeltaPersistence.clearAll(); game.GameTime.setForTest(700); Object.assign(game.State.world.player,{row:0,col:0});
    const loaded=game.CampaignPersistence.loadSave(saved);
    const resumedMinute=Math.floor(game.GameTime.capture().totalGameMinutes);
    const resumed=loop.prepare({...c,campaignMinute:resumedMinute},[opportunity]);
    return {loaded:loaded.ok,resumed,resumedMinute,checkpoint:loop.readCheckpoint(c),pos:{row:game.State.world.player.row,col:game.State.world.player.col}};
  },{c:context(),opportunity:move(),route:execution()});
  expect(out.loaded).toBe(true);
  expect(out.resumedMinute).toBe(600);
  expect(out.resumed).toMatchObject({status:'wait',reasonCode:'WAIT_INTERVAL'});
  expect(out.checkpoint).toMatchObject({serial:1,campaignMinute:600,lastStatus:'resolved'});
  expect(out.pos).toEqual({row:1,col:1});
});

test('mismatched or presentation-owned campaign time cannot schedule autonomous work', async ({ page }) => {
  const out=await page.evaluate(({c,opportunity})=>{
    const game=window.Game, loop=game.AutonomousDecisionLoop;
    const before=game.WorldDeltaPersistence.capture(game.State.world.seed);
    const mismatched=loop.prepare({...c,campaignMinute:c.campaignMinute+1},[opportunity]);
    const presentation=loop.prepare({...c,authority:'presentation'},[opportunity]);
    const after=game.WorldDeltaPersistence.capture(game.State.world.seed);
    return {mismatched,presentation,before,after};
  },{c:context(),opportunity:move()});
  expect(out.mismatched).toMatchObject({status:'rejected',reasonCode:'CAMPAIGN_TIME_MISMATCH',authoritativeCampaignMinute:600});
  expect(out.presentation).toMatchObject({status:'rejected',reasonCode:'NON_SIMULATION_CONTEXT'});
  expect(out.after).toEqual(out.before);
});
