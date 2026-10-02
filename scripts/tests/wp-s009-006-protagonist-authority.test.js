const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
function clone(v){return v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):clone(v);return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
const stores=new Map();
function fresh(seed){return {schema:'CampaignStateDelta',seed,sequence:0,entries:{}};}
function ensure(seed){if(!stores.has(seed))stores.set(seed,fresh(seed));return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return {id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const state=ensure(seed),entry=state.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry};},
  applyDelta(seed,ref,changes,reason){const state=ensure(seed),prev=state.entries[ref.id];state.sequence++;state.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:state.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(state.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,serialized){stores.set(String(campaign.seed),clone(serialized));return {ok:true};}
};
global.ProtagonistProfile={derive(s,key='protagonist'){return {protagonistId:'PROTAGONIST-'+hash(s+'|'+key+'|identity-v1')}}};
let now='1201-04-01 06:00:00';
global.GameTime={getTimestampKey(){return now;}};

const seed='WP-S009-006-SEED-A',otherSeed='WP-S009-006-SEED-B',identity='protagonist';
const modulePath=path.resolve(__dirname,'../world/protagonist-authority.js');
delete require.cache[modulePath];
const Authority=require(modulePath);
assert(Authority,'ProtagonistAuthority should attach to window');
const sim=(transitionId,targetRoleId,sourceId='COUNCIL-1',extra={})=>({authority:'simulation',authoritative:true,transitionId,fantasyTimestamp:now,evidence:{type:'legitimate-role-transition',validated:true,targetRoleId,sourceRef:{kind:'institution',id:sourceId}},...extra});

const init=Authority.initialize(seed,identity,now);
assert.equal(init.ok,true);assert.equal(init.created,true);
const base=Authority.snapshot(seed,identity);
assert.equal(base.exists,true);assert.equal(base.currentRole.roleId,'local-resident');assert.equal(base.currentRole.rankTier,0);assert.deepStrictEqual(base.currentRole.scopes,['self']);
assert.equal(base.serializedBytes<=Authority.MAX_STATE_BYTES,true);
assert.equal(Authority.hasScope(seed,'self',identity),true);assert.equal(Authority.hasScope(seed,'settlement:administration',identity),false);

const baselineSave=WorldState.serializeState(seed);
const forged=Authority.transition(seed,identity,'village-steward',{authority:'ui',authoritative:true,transitionId:'UI-GRANT',fantasyTimestamp:now,evidence:{type:'legitimate-role-transition',validated:true,targetRoleId:'village-steward',sourceRef:{kind:'ui',id:'BUTTON'}}});
assert.equal(forged.ok,false);assert.equal(forged.reason,'simulation-authority-required');assert.equal(Authority.snapshot(seed,identity).currentRole.roleId,'local-resident');
const unsupported=Authority.transition(seed,identity,'king',sim('KING','king'));
assert.equal(unsupported.ok,false);assert.equal(unsupported.reason,'unsupported-role');
const missingEvidence=Authority.transition(seed,identity,'guild-member',{authority:'simulation',authoritative:true,transitionId:'NO-EVIDENCE',fantasyTimestamp:now});
assert.equal(missingEvidence.ok,false);assert.equal(missingEvidence.reason,'validated-transition-evidence-required');
const mismatch=Authority.transition(seed,identity,'guild-member',sim('MISMATCH','village-steward'));
assert.equal(mismatch.ok,false);assert.equal(mismatch.reason,'transition-evidence-target-mismatch');

now='1201-04-01 08:00:00';
const guild=Authority.transition(seed,identity,'guild-member',sim('PROMOTE-1','guild-member','GUILD-ALPHA'));
assert.equal(guild.ok,true);assert(/^AUTH-[0-9A-F]{8}$/.test(guild.transition.id));assert.equal(guild.snapshot.currentRole.roleId,'guild-member');assert.equal(guild.snapshot.currentRole.rankTier,1);assert.equal(Authority.hasScope(seed,'guild:participate',identity),true);assert.equal(Authority.hasScope(seed,'region:adjudication',identity),false);
const duplicate=Authority.transition(seed,identity,'guild-member',sim('PROMOTE-1','guild-member','GUILD-ALPHA'));
assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.snapshot.history.length,1);

now='1201-04-02 09:30:00';
const steward=Authority.transition(seed,identity,'village-steward',sim('PROMOTE-2','village-steward','VILLAGE-COUNCIL'));
assert.equal(steward.ok,true);assert.equal(steward.snapshot.currentRole.roleId,'village-steward');assert.equal(steward.snapshot.currentRole.rankTier,2);assert.deepStrictEqual(steward.snapshot.currentRole.scopes,['self','settlement:administration','settlement:request-assistance']);
const permissions=Authority.filterScopes(seed,['self','settlement:administration','region:adjudication','self'],identity);
assert.deepStrictEqual(permissions.granted,['self','settlement:administration']);assert.deepStrictEqual(permissions.rejected,['region:adjudication']);assert.equal(permissions.readOnly,true);assert.equal(permissions.actionValidationBypass,false);

const beforeRewind=Authority.snapshot(seed,identity);
const rewind=Authority.transition(seed,identity,'regional-magistrate',{...sim('REWIND','regional-magistrate','REGION-COUNCIL'),fantasyTimestamp:'1201-04-01 09:00:00'});
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-authority-state');assert.deepStrictEqual(Authority.snapshot(seed,identity).currentRole,beforeRewind.currentRole);

const saved=WorldState.serializeState(seed),preReload=Authority.snapshot(seed,identity);
stores.set(seed,fresh(seed));assert.equal(Authority.snapshot(seed,identity).exists,false);
WorldState.restoreSerializedState({seed},saved);const restored=Authority.snapshot(seed,identity);
assert.deepStrictEqual(restored.currentRole,preReload.currentRole);assert.deepStrictEqual(restored.history,preReload.history);assert.deepStrictEqual(restored.recentTransitionIds,preReload.recentTransitionIds);

WorldState.restoreSerializedState({seed},baselineSave);now='1201-04-01 08:00:00';
const replayA=Authority.transition(seed,identity,'guild-member',sim('PROMOTE-1','guild-member','GUILD-ALPHA'));
const replayRecord=clone(replayA.transition);
WorldState.restoreSerializedState({seed},baselineSave);now='1201-04-01 08:00:00';
const replayB=Authority.transition(seed,identity,'guild-member',sim('PROMOTE-1','guild-member','GUILD-ALPHA'));
assert.deepStrictEqual(replayB.transition,replayRecord,'same SEED + fantasy time + evidence must replay identically');

now='1201-04-01 06:00:00';assert(Authority.initialize(otherSeed,identity,now).ok);const other=Authority.snapshot(otherSeed,identity);assert.notEqual(other.protagonistId,base.protagonistId);assert.equal(other.currentRole.roleId,'local-resident');
global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-a'};const presentationA=Authority.snapshot(otherSeed,identity);
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-b'};const presentationB=Authority.snapshot(otherSeed,identity);assert.deepStrictEqual(presentationB,presentationA,'presentation/device state influenced authority');

const ctx=Authority.decisionContext(seed,identity);assert.equal(ctx.readOnly,true);assert.equal(ctx.directActionExecution,false);assert.equal(ctx.worldMutation,false);
const telemetry=Authority.telemetry();assert(telemetry.reads>0&&telemetry.writes>0&&telemetry.transitions>0&&telemetry.rejections>0&&telemetry.queries>0);assert.equal(telemetry.fullWorldScan,false);assert.equal(telemetry.perFrameScan,false);assert.equal(telemetry.authority,false);
const final=Authority.snapshot(seed,identity);assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(final.chronologyAuthority,'Fantasy Game Time');assert.equal(final.mutationAuthority,'explicit Simulation-authorized role transitions');assert.equal(final.scopeAuthority,'fixed role catalog only');assert.equal(final.directActionExecution,false);assert.equal(final.directWorldMutation,false);assert.equal(final.directPositionMutation,false);assert.equal(final.teleportation,false);assert.equal(final.routeValidationBypass,false);assert.equal(final.resourceValidationBypass,false);assert.equal(final.actionValidationBypass,false);assert.equal(final.dialogueGrantAuthority,false);assert.equal(final.llmGrantAuthority,false);assert.equal(final.uiGrantAuthority,false);

const source=fs.readFileSync(modulePath,'utf8');for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);assert(source.includes('options?.authority!=="simulation"'));assert(source.includes('fullWorldScan:false')&&source.includes('perFrameScan:false'));
const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');if(fs.existsSync(indexPath)){const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-authority.js?v=protagonist-authority-v1';assert(html.includes(script),'canonical root must load ProtagonistAuthority');assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-health.js?v=protagonist-health-v1'));assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));}

console.log(JSON.stringify({wp:'WP-S009-006',classification:'FUNCTIONAL',visual:'N/A — authoritative rank/role state adds no rendered surface',pass:true,version:Authority.VERSION,baselineRole:'local-resident',validTransition:true,forgedAuthorityRejected:true,unsupportedRoleRejected:true,evidenceMismatchRejected:true,duplicateIdempotence:true,rewindRejected:true,saveReload:true,replayStable:true,campaignIsolation:true,presentationInvariant:true,scopeFilterBounded:true,maxHistory:Authority.MAX_HISTORY,maxRecentTransitionIds:Authority.MAX_RECENT_TRANSITIONS,maxQueryScopes:Authority.MAX_QUERY_SCOPES,maxStateBytes:Authority.MAX_STATE_BYTES,persistenceAuthority:final.persistenceAuthority,chronologyAuthority:final.chronologyAuthority,mutationAuthority:final.mutationAuthority,fullWorldScan:final.fullWorldScan,perFrameScan:final.perFrameScan,directActionExecution:final.directActionExecution,telemetry},null,2));
