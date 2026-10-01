const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

const modulePath=path.resolve(__dirname,'../world/protagonist-profile.js');
delete require.cache[modulePath];
const Profile=require(modulePath);
assert(Profile,'ProtagonistProfile should attach to window');

const seed='WP-S009-001-SEED-A';
const identity='protagonist';
const a=Profile.derive(seed,identity);
const replay=Profile.derive(seed,identity);
assert.deepStrictEqual(replay,a,'same SEED + identity must reproduce byte-stable profile');
assert(/^PROTAGONIST-[0-9A-F]{8}$/.test(a.protagonistId),'stable protagonist ID format invalid');
assert(/^LINE-[0-9A-F]{8}$/.test(a.birthIdentity.lineageTag),'birth identity lineage tag missing');
assert(a.birthIdentity.fullName.length>3,'birth identity name missing');
assert.equal(Object.keys(a.personality.traits).length,6,'unexpected trait count');
for(const [key,value] of Object.entries(a.personality.traits))assert(Number.isInteger(value)&&value>=15&&value<=85,key+' out of bounds');
assert(a.bounds.serializedBytes<=Profile.MAX_PROFILE_BYTES,'profile exceeded byte bound');
assert(Object.isFrozen(a)&&Object.isFrozen(a.personality)&&Object.isFrozen(a.personality.traits),'profile snapshots must be immutable');

const alternate=Profile.derive('WP-S009-001-SEED-B',identity);
assert.notEqual(alternate.profileSignature,a.profileSignature,'alternate SEED should diverge');
assert.notEqual(alternate.protagonistId,a.protagonistId,'alternate SEED should produce distinct canonical protagonist identity');
const alternateIdentity=Profile.derive(seed,'protagonist-alt');
assert.notEqual(alternateIdentity.profileSignature,a.profileSignature,'alternate stable identity input should diverge');

const campaign={seed,realStartMs:123456789,fantasyStart:{year:1201,month:2,day:3},protagonist:{x:'0',y:'0'},restartCount:0};
const beforeSave=Profile.fromCampaign(campaign);
const restoredCampaign=JSON.parse(JSON.stringify(campaign));
const afterSave=Profile.fromCampaign(restoredCampaign);
assert.deepStrictEqual(afterSave,beforeSave,'campaign save/load header roundtrip must not drift profile');

// Fantasy time, presentation, device and load state are deliberately irrelevant to fixed baseline identity/personality.
global.GameTime={getTimestampKey(){return '9999-12-31 23:59:59';}};
global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-A'};
const presentationA=Profile.derive(seed,identity);
global.GameTime={getTimestampKey(){return '1201-01-01 00:00:00';}};
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-B'};
const presentationB=Profile.derive(seed,identity);
assert.deepStrictEqual(presentationB,presentationA,'time/device/presentation state must not influence baseline profile');

let activeCampaign=campaign;
global.SeedSystem={getCampaign(){return activeCampaign;},getSettings(){return {seed:'SETTINGS-SEED'}}};
assert.deepStrictEqual(Profile.current(),beforeSave,'current() must resolve active campaign profile');
activeCampaign=null;
assert.equal(Profile.current().profileSignature,Profile.derive('SETTINGS-SEED','protagonist').profileSignature,'settings SEED fallback should remain deterministic');
assert.equal(Profile.trait(seed,identity,'resolve'),a.personality.traits.resolve,'bounded single-trait query mismatch');
assert.equal(Profile.trait(seed,identity,'not-a-trait'),null,'unknown trait must fail closed');
const summary=Profile.summary(seed,identity);
assert.equal(summary.profileSignature,a.profileSignature,'summary signature mismatch');
assert.equal(summary.worldMutation,false);
assert.equal(summary.actionExecution,false);

const repoRoot=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const profileScript='scripts/world/protagonist-profile.js?v=protagonist-profile-v1';
assert(html.includes(profileScript),'canonical root must load ProtagonistProfile');
assert(html.indexOf(profileScript)<html.indexOf('scripts/world/advisor-channel.js'),'ProtagonistProfile must load before Advisor consumers');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','GameTime','innerWidth','innerHeight','devicePixelRatio','navigator.']){
  assert(!source.includes(forbidden),'forbidden non-SEED baseline authority reference: '+forbidden);
}
assert(source.includes('worldMutation:false')&&source.includes('actionExecution:false'),'authority boundary flags missing');
assert(source.includes('storedMutableCopy:false'),'immutable seed-foundation persistence contract missing');

console.log(JSON.stringify({
  wp:'WP-S009-001',classification:'FUNCTIONAL',visual:'N/A — immutable profile foundation adds no rendered surface',pass:true,
  version:Profile.VERSION,protagonistId:a.protagonistId,profileSignature:a.profileSignature,alternateSignature:alternate.profileSignature,
  sameSeedReplay:true,alternateSeedDivergence:true,saveLoadStable:true,timeInvariant:true,presentationInvariant:true,
  traitCount:Profile.TRAIT_KEYS.length,serializedBytes:a.bounds.serializedBytes,maxProfileBytes:Profile.MAX_PROFILE_BYTES,
  persistenceMode:a.persistence.mode,persistenceAuthority:a.persistence.campaignSeedPersistedBy,
  worldMutation:a.authority.worldMutation,actionExecution:a.authority.actionExecution
},null,2));