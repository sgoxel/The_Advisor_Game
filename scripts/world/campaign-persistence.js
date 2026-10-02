(function(){
"use strict";

const SCHEMA="AdvisorCampaignSave";
const SAVE_SCHEMA_VERSION=1;
const SIMULATION_RULES_VERSION="advisor-simulation-rules-v1";
const STORAGE_KEY=GameConfig.campaignStorageKey+".versioned-save.v1";
const MAX_SAVE_BYTES=1024*1024;
let gate=Object.freeze({phase:"idle",ready:false,reason:"not-restored",seed:null,targetTimestamp:null});

function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))deepFreeze(item);
  return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function utf8Bytes(value){
  const text=String(value==null?"":value);
  if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
  let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n;
}
function currentGeneratorVersion(){return String(window.WorldState?.WORLD_GENERATOR_VERSION||"")}
function campaignKey(campaign){return campaign?[String(campaign.seed||""),Number(campaign.realStartMs||0),Number(campaign.restartCount||0)].join("|"):null}
function setGate(phase,ready,reason,seed,targetTimestamp){
  gate=Object.freeze({phase:String(phase),ready:Boolean(ready),reason:String(reason||""),seed:seed==null?null:String(seed),targetTimestamp:targetTimestamp||null});
  return gate;
}
function saveBody(save){const body=clone(save);delete body.checksum;delete body.serializedBytes;return body}
function checksumFor(save){return hashText(stableStringify(saveBody(save)))}
function deltaIndex(worldState){
  const groups={global:[],country:[],diplomacy:[],region:[],settlement:[],npc:[],event:[],other:[]};
  for(const item of Object.values(worldState?.entries||{})){
    const kind=String(item?.entityKind||"other");
    const bucket=Object.prototype.hasOwnProperty.call(groups,kind)?kind:
      (kind.startsWith("settlement")?"settlement":kind.startsWith("npc")?"npc":kind.startsWith("country")?"country":
      kind.startsWith("region")?"region":kind.startsWith("diplomacy")?"diplomacy":(["world","campaign"].includes(kind)?"global":"other"));
    groups[bucket].push(String(item.entityId));
  }
  for(const key of Object.keys(groups))groups[key].sort();
  return deepFreeze(groups);
}
function publicHeader(campaign){
  return deepFreeze({
    seed:String(campaign.seed),realStartMs:Number(campaign.realStartMs),
    fantasyStart:clone(campaign.fantasyStart),protagonist:clone(campaign.protagonist),
    restartCount:Number(campaign.restartCount||0)
  });
}
function seal(bodyValue){
  const body=clone(bodyValue),checksum=hashText(stableStringify(body)),serializedBytes=utf8Bytes(stableStringify(body));
  return deepFreeze({...body,checksum,serializedBytes});
}
function createSave(optionsValue){
  const options=optionsValue||{},campaign=options.campaign||window.SeedSystem?.getCampaign?.();
  window.GeneratedWorldStore?.flushSoon?.("authoritative-save");
  if(!campaign?.seed)return deepFreeze({ok:false,reason:"campaign-required"});
  const seed=String(campaign.seed);
  if(!window.WorldState?.serializeState||!window.EventScheduler?.serialize||!window.CatchUpSimulation?.serializeState){
    return deepFreeze({ok:false,reason:"persistence-dependencies-unavailable"});
  }
  try{window.CatchUpSimulation.persist?.(seed)}catch(_){}
  const worldState=window.WorldState.serializeState(seed);
  const schedulerState=window.EventScheduler.serialize(seed);
  const catchUpState=window.CatchUpSimulation.serializeState(seed);
  if(!worldState||!schedulerState||!catchUpState)return deepFreeze({ok:false,reason:"authoritative-state-unavailable"});
  const body={
    schema:SCHEMA,saveSchemaVersion:SAVE_SCHEMA_VERSION,
    worldGeneratorVersion:currentGeneratorVersion(),simulationRulesVersion:SIMULATION_RULES_VERSION,
    campaignKey:campaignKey(campaign),seed,campaign:publicHeader(campaign),
    gameTime:{
      creationFantasyTimestamp:window.GameTime?.toTimestampKey?.(campaign.fantasyStart)||null,
      currentAuthoritativeFantasyTimestamp:window.GameTime?.getTimestampKey?.()||catchUpState.lastAuthoritativeTimestamp||null,
      catchUpLastAuthoritativeTimestamp:catchUpState.lastAuthoritativeTimestamp||null,
      catchUpCursorTimestamp:catchUpState.cursorTimestamp||null,
      offlineProgressionPolicy:clone(window.GameTime?.offlineProgressionPolicy?.()||{}),
      capturedRealMs:Number(options.capturedRealMs??Date.now())
    },
    campaignStateDelta:clone(worldState),
    deltaIndex:clone(deltaIndex(worldState)),
    schedulerState:clone(schedulerState),
    catchUpState:clone(catchUpState),
    compatibility:{
      foundationSchemaVersion:Number(worldState.foundationSchemaVersion||0),
      deltaSchemaVersion:Number(worldState.version||0),
      schedulerSchemaVersion:Number(schedulerState.schemaVersion||0),
      catchUpSchemaVersion:Number(catchUpState.schemaVersion||0),
      migrationApplied:null
    },
    sparse:true,wholeWorldSerialized:false,renderStateSerialized:false,cameraStateSerialized:false,
    createdBy:"CampaignPersistence"
  };
  const save=seal(body);
  if(save.serializedBytes>MAX_SAVE_BYTES)return deepFreeze({ok:false,reason:"save-size-budget-exceeded",serializedBytes:save.serializedBytes,maxSaveBytes:MAX_SAVE_BYTES});
  if(options.persist!==false){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(save));}catch(error){return deepFreeze({ok:false,reason:"storage-unavailable",error:String(error),save});}
  }
  return deepFreeze({ok:true,reason:"ok",save});
}
function validate(saveValue){
  const save=saveValue||null;
  if(!save||typeof save!=="object")return deepFreeze({ok:false,reason:"save-required"});
  if(save.schema!==SCHEMA)return deepFreeze({ok:false,reason:"save-schema-mismatch"});
  if(Number(save.saveSchemaVersion)!==SAVE_SCHEMA_VERSION)return deepFreeze({ok:false,reason:"save-version-incompatible",recordedVersion:Number(save.saveSchemaVersion)||0,currentVersion:SAVE_SCHEMA_VERSION});
  if(String(save.worldGeneratorVersion||"")!==currentGeneratorVersion())return deepFreeze({ok:false,reason:"generator-version-incompatible",recordedVersion:String(save.worldGeneratorVersion||""),currentVersion:currentGeneratorVersion()});
  if(String(save.simulationRulesVersion||"")!==SIMULATION_RULES_VERSION)return deepFreeze({ok:false,reason:"simulation-version-incompatible",recordedVersion:String(save.simulationRulesVersion||""),currentVersion:SIMULATION_RULES_VERSION});
  if(!save.campaign?.seed||String(save.seed)!==String(save.campaign.seed)||String(save.campaignKey)!==campaignKey(save.campaign))return deepFreeze({ok:false,reason:"campaign-header-invalid"});
  const bytes=utf8Bytes(stableStringify(saveBody(save)));
  if(bytes>MAX_SAVE_BYTES)return deepFreeze({ok:false,reason:"save-size-budget-exceeded",serializedBytes:bytes,maxSaveBytes:MAX_SAVE_BYTES});
  if(String(save.checksum||"")!==checksumFor(save))return deepFreeze({ok:false,reason:"checksum-mismatch"});
  if(save.campaignStateDelta?.schema!=="CampaignStateDelta"||String(save.campaignStateDelta.seed)!==String(save.seed))return deepFreeze({ok:false,reason:"world-state-invalid"});
  if(save.campaignStateDelta.worldGeneratorVersion!==save.worldGeneratorVersion)return deepFreeze({ok:false,reason:"world-state-generator-mismatch"});
  if(save.schedulerState?.schema!==window.EventScheduler?.SCHEMA||Number(save.schedulerState?.schemaVersion)!==Number(window.EventScheduler?.SCHEMA_VERSION)||String(save.schedulerState?.seed)!==String(save.seed))return deepFreeze({ok:false,reason:"scheduler-state-invalid"});
  if(save.catchUpState?.schema!==window.CatchUpSimulation?.SCHEMA||Number(save.catchUpState?.schemaVersion)!==Number(window.CatchUpSimulation?.SCHEMA_VERSION)||String(save.catchUpState?.seed)!==String(save.seed))return deepFreeze({ok:false,reason:"catch-up-state-invalid"});
  const entries=Object.values(save.campaignStateDelta.entries||{}),ids=new Set();
  for(const item of entries){if(!item?.entityId||ids.has(item.entityId))return deepFreeze({ok:false,reason:"stable-entity-id-invalid"});ids.add(item.entityId)}
  const indexed=[...Object.values(save.deltaIndex||{}).flat()].sort();
  const actual=entries.map(item=>String(item.entityId)).sort();
  if(stableStringify(indexed)!==stableStringify(actual))return deepFreeze({ok:false,reason:"delta-index-mismatch"});
  return deepFreeze({ok:true,reason:"ok",seed:String(save.seed),entryCount:entries.length,serializedBytes:Number(save.serializedBytes||bytes),checksum:String(save.checksum)});
}
function stored(){
  try{
    const save=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"),checked=validate(save);
    return deepFreeze(checked.ok?{ok:true,reason:"ok",save:deepFreeze(save),validation:checked}:{ok:false,reason:checked.reason,validation:checked});
  }catch(error){return deepFreeze({ok:false,reason:"stored-save-corrupt",error:String(error)});}
}
function storageBackup(keys){
  const out={};for(const key of keys){try{out[key]=localStorage.getItem(key)}catch(_){out[key]=null}}return out;
}
function restoreStorage(snapshot){for(const [key,value] of Object.entries(snapshot)){try{if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch(_){}}}
async function restoreAndResume(saveValue,optionsValue){
  const options=optionsValue||{},checked=validate(saveValue);
  if(!checked.ok){setGate("rejected",false,checked.reason,null,null);return deepFreeze({ok:false,complete:false,authoritativeReady:false,reason:checked.reason,validation:checked});}
  const save=saveValue,keys=[GameConfig.campaignStorageKey,window.WorldState.STORAGE_KEY,window.CatchUpSimulation.STORAGE_KEY,STORAGE_KEY],backup=storageBackup(keys);
  const previousCampaign=clone(window.SeedSystem?.getCampaign?.()||null);
  setGate("validated",false,"validated",save.seed,null);
  try{
    localStorage.setItem(GameConfig.campaignStorageKey,JSON.stringify(save.campaign));
    const loaded=window.SeedSystem.loadCampaign();
    if(!loaded?.ok||String(loaded.campaign?.seed)!==String(save.seed)||campaignKey(loaded.campaign)!==String(save.campaignKey))throw new Error("campaign-header-restore-failed");
    const campaign=loaded.campaign;
    if(window.GeneratedWorldStore?.bindCampaign)await window.GeneratedWorldStore.bindCampaign(campaign,{primeLimit:128,resumeReason:"campaign-restore"});
    setGate("restoring-deltas",false,"restoring",save.seed,null);
    const world=window.WorldState.restoreSerializedState(campaign,save.campaignStateDelta);
    if(!world?.ok)throw new Error("world-state-restore-failed:"+String(world?.reason||"unknown"));
    const catchUp=window.CatchUpSimulation.restoreSerializedState(campaign,save.catchUpState,{schedulerState:save.schedulerState});
    if(!catchUp?.ok)throw new Error("catch-up-restore-failed:"+String(catchUp?.reason||"unknown"));
    const target=String(options.targetTimestamp||window.GameTime.getTimestampKey()||save.gameTime.currentAuthoritativeFantasyTimestamp);
    setGate("catch-up",false,"catch-up-in-progress",save.seed,target);
    const resumed=await window.CatchUpSimulation.resumeTo(save.seed,target,{maxBatches:options.maxBatches||16,maxSlices:options.maxSlices||1024,priority:options.priority||"current"});
    if(!resumed?.complete||!window.CatchUpSimulation.authoritativeReady(save.seed))throw new Error("authoritative-catch-up-incomplete");
    const checkpoint=createSave({campaign,persist:true,capturedRealMs:Number(options.capturedRealMs??Date.now())});
    if(!checkpoint?.ok)throw new Error("post-resume-checkpoint-failed:"+String(checkpoint?.reason||"unknown"));
    setGate("ready",true,"authoritative-ready",save.seed,target);
    const delta=window.WorldState.deltaSnapshot(save.seed),scheduler=window.EventScheduler.snapshot(save.seed),catchSnap=window.CatchUpSimulation.snapshot(save.seed);
    return deepFreeze({
      ok:true,complete:true,authoritativeReady:true,reason:"ok",campaign:clone(campaign),
      targetTimestamp:target,catchUp:resumed,
      signatures:{
        delta:hashText(stableStringify(delta.entries)),scheduler:hashText(stableStringify(scheduler.queue)),
        catchUp:hashText(stableStringify({lastAuthoritativeTimestamp:catchSnap.lastAuthoritativeTimestamp,cursorTimestamp:catchSnap.cursorTimestamp,importantLedger:catchSnap.importantLedger}))
      },
      deltaEntryCount:delta.entryCount,schedulerPending:scheduler.pending,
      checkpointChecksum:checkpoint.save.checksum,checkpointBytes:checkpoint.save.serializedBytes,gate
    });
  }catch(error){
    restoreStorage(backup);
    try{window.EventScheduler?.reset?.(save.seed)}catch(_){}
    try{
      const prior=window.SeedSystem?.loadCampaign?.();
      if(prior?.ok){
        window.WorldState?.bindCampaign?.(prior.campaign,{reset:false});
        window.CatchUpSimulation?.bindCampaign?.(prior.campaign,{reset:false});
      }else if(previousCampaign?.seed){
        localStorage.setItem(GameConfig.campaignStorageKey,JSON.stringify(previousCampaign));
        const restored=window.SeedSystem.loadCampaign();
        if(restored?.ok){window.WorldState?.bindCampaign?.(restored.campaign,{reset:false});window.CatchUpSimulation?.bindCampaign?.(restored.campaign,{reset:false});}
      }
    }catch(_){}
    setGate("failed",false,String(error),save.seed,null);
    return deepFreeze({ok:false,complete:false,authoritativeReady:false,reason:"restore-failed",error:String(error),gate});
  }
}
async function loadStoredAndResume(optionsValue){
  const record=stored();
  if(!record.ok)return deepFreeze({ok:false,complete:false,authoritativeReady:false,reason:record.reason});
  return restoreAndResume(record.save,optionsValue);
}
function clearStored(){try{localStorage.removeItem(STORAGE_KEY);return true}catch(_){return false}}
function resumeStatus(){return gate}
function signature(saveValue){return hashText(stableStringify(saveBody(saveValue)))}

window.CampaignPersistence=Object.freeze({
  SCHEMA,SAVE_SCHEMA_VERSION,SIMULATION_RULES_VERSION,STORAGE_KEY,MAX_SAVE_BYTES,
  createSave,validate,stored,restoreAndResume,loadStoredAndResume,clearStored,resumeStatus,signature
});
})();