(function(){
"use strict";

const VERSION="protagonist-decision-context-v1";
const MAX_REASONS=12;
const MAX_GOALS=8;
const MAX_SCOPES=16;
const MAX_MISSING_SOURCES=8;
const SOURCE_KEYS=Object.freeze(["personality","needs","goals","relationships","inventory","health","authority"]);
const telemetryState={builds:0,liveBuilds:0,invalid:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function clamp01(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):null}
function score01(value,max=100){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n/max)):null}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function reasonPush(list,code){const clean=cleanId(code,96);if(clean&&!list.includes(clean)&&list.length<MAX_REASONS)list.push(clean)}
function missingPush(list,key){if(!list.includes(key)&&list.length<MAX_MISSING_SOURCES)list.push(key)}
function factorRecord(available,value,reason){return freeze({available:Boolean(available),value:value==null?null:Number(value.toFixed(4)),reason:reason||null})}
function roleScopes(snapshot){const values=snapshot?.scopes||snapshot?.currentRole?.scopes||[];return Array.isArray(values)?values.map(x=>cleanId(x,120)).filter(Boolean).slice(0,MAX_SCOPES):[]}
function activeGoals(snapshot){
  const rows=Array.isArray(snapshot?.records)?snapshot.records:Array.isArray(snapshot?.goals)?snapshot.goals:[];
  return rows.filter(row=>row&&String(row.status||"active")==="active").slice(0,MAX_GOALS);
}
function pressureValue(snapshot,key){
  const milli=snapshot?.pressureMilli?.[key];if(Number.isFinite(Number(milli)))return score01(milli,100000);
  const display=snapshot?.pressures?.[key];return score01(display,100);
}
function personalityTraits(snapshot){return snapshot?.personality?.traits||snapshot?.traits||null}

function invalidResult(seed,when,reason){
  telemetryState.invalid++;
  return freeze({version:VERSION,ok:false,reason,seed:seed||null,when:when||null,contextId:null,decisionContext:null,reasons:freeze([]),missingSources:freeze(SOURCE_KEYS.slice()),bounded:true,directActionExecution:false,worldMutation:false});
}
function build(configValue){
  telemetryState.builds++;
  const config=plain(configValue)?configValue:{},seed=cleanText(config.seed,160),when=cleanText(config.when,32);
  if(!seed)return invalidResult(seed,when,"campaign-seed-required");
  if(!validWhen(when))return invalidResult(seed,when,"fantasy-time-required");
  const snapshots=plain(config.snapshots)?config.snapshots:{},reasons=[],missing=[];
  let value=0.5,urgency=0.5,socialAcceptability=0.5,dutyConflict=false;
  const factors={};

  const traits=personalityTraits(snapshots.personality);
  if(plain(traits)){
    const resolve=score01(traits.resolve),ambition=score01(traits.ambition),caution=score01(traits.caution),empathy=score01(traits.empathy);
    if(resolve!=null||ambition!=null||caution!=null||empathy!=null){
      const resolveV=resolve??0.5,ambitionV=ambition??0.5,cautionV=caution??0.5,empathyV=empathy??0.5;
      const personalityValue=(resolveV+ambitionV+(1-cautionV))/3;
      value+= (personalityValue-0.5)*0.12;
      socialAcceptability+= (empathyV-0.5)*0.08;
      factors.personality=factorRecord(true,personalityValue,"bounded-traits");
      if(cautionV>=0.75)reasonPush(reasons,"personality-cautious");
      if(resolveV>=0.75)reasonPush(reasons,"personality-resolute");
    }else{missingPush(missing,"personality");factors.personality=factorRecord(false,null,"invalid-or-unavailable")}
  }else{missingPush(missing,"personality");factors.personality=factorRecord(false,null,"unavailable")}

  const needKeys=["hunger","fatigue","safety","social"],needValues=needKeys.map(key=>[key,pressureValue(snapshots.needs,key)]).filter(([,v])=>v!=null);
  if(needValues.length){
    needValues.sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const [dominant,maxPressure]=needValues[0];
    urgency+=maxPressure*0.24;
    value-=maxPressure*0.08;
    factors.needs=factorRecord(true,maxPressure,"dominant-"+dominant);
    if(maxPressure>=0.75)reasonPush(reasons,"urgent-need-"+dominant);
  }else{missingPush(missing,"needs");factors.needs=factorRecord(false,null,"unavailable")}

  const goals=activeGoals(snapshots.goals);
  if(goals.length){
    let topPriority=0;
    for(const row of goals){const p=score01(row.priority,100);if(p!=null)topPriority=Math.max(topPriority,p)}
    value+=topPriority*0.14;urgency+=topPriority*0.10;
    factors.goals=factorRecord(true,topPriority,"active-goals-"+goals.length);
    reasonPush(reasons,topPriority>=0.75?"high-priority-commitment":"active-commitment");
    const conflicts=Array.isArray(config.conflictingGoalIds)?new Set(config.conflictingGoalIds.map(x=>cleanId(x,160)).filter(Boolean)):null;
    if(conflicts&&goals.some(row=>conflicts.has(cleanId(row.id,160)))){dutyConflict=true;reasonPush(reasons,"goal-conflict")}
  }else if(snapshots.goals&&Array.isArray(snapshots.goals.records)){factors.goals=factorRecord(true,0,"no-active-goals")}
  else{missingPush(missing,"goals");factors.goals=factorRecord(false,null,"unavailable")}

  const relationships=snapshots.relationships;
  if(plain(relationships)){
    const supplied=clamp01(relationships.socialAcceptability),trust=score01(relationships.trust,100);
    if(supplied!=null||trust!=null){
      const social=supplied??trust;
      socialAcceptability=social;
      factors.relationships=factorRecord(true,social,supplied!=null?"supplied-social-acceptability":"bounded-trust");
      if(social<0.35)reasonPush(reasons,"low-social-acceptability");
      if(social>=0.75)reasonPush(reasons,"high-social-acceptability");
    }else factors.relationships=factorRecord(true,null,"no-social-score");
    if(relationships.dutyConflict===true){dutyConflict=true;reasonPush(reasons,"duty-conflict")}
  }else{missingPush(missing,"relationships");factors.relationships=factorRecord(false,null,"unavailable")}

  const inventory=snapshots.inventory;
  if(plain(inventory)){
    const satisfied=inventory.requirementsSatisfied;
    if(typeof satisfied==="boolean"){
      factors.inventory=factorRecord(true,satisfied?1:0,satisfied?"requirements-satisfied":"requirements-missing");
      if(!satisfied){value-=0.20;urgency-=0.08;reasonPush(reasons,"inventory-requirement-missing")}
    }else factors.inventory=factorRecord(true,null,"no-requirement-claim");
  }else{missingPush(missing,"inventory");factors.inventory=factorRecord(false,null,"unavailable")}

  const health=snapshots.health;
  if(plain(health)){
    const condition=score01(health.conditionMilli,100000),fatigue=score01(health.fatigueMilli,100000);
    if(condition!=null||fatigue!=null){
      const constraint=Math.max(condition==null?0:1-condition,fatigue??0);
      value-=constraint*0.18;urgency-=constraint*0.12;
      factors.health=factorRecord(true,1-constraint,"health-capacity");
      if(constraint>=0.50)reasonPush(reasons,"health-constrained");
      else if(constraint<=0.15)reasonPush(reasons,"health-stable");
    }else factors.health=factorRecord(true,null,"no-bounded-health-score");
  }else{missingPush(missing,"health");factors.health=factorRecord(false,null,"unavailable")}

  const authority=snapshots.authority,requiredScope=cleanId(config.requiredAuthorityScope,120);
  if(plain(authority)){
    const scopes=roleScopes(authority),rankTier=Number(authority.rankTier??authority.currentRole?.rankTier);
    factors.authority=factorRecord(true,Number.isFinite(rankTier)?Math.max(0,Math.min(1,rankTier/4)):null,"bounded-authority-snapshot");
    if(requiredScope&&!scopes.includes(requiredScope)){value-=0.25;urgency-=0.10;reasonPush(reasons,"authority-scope-missing")}
    else if(requiredScope){reasonPush(reasons,"authority-scope-present")}
  }else{missingPush(missing,"authority");factors.authority=factorRecord(false,null,"unavailable");if(requiredScope){value-=0.25;urgency-=0.10;reasonPush(reasons,"authority-scope-unavailable")}}

  value=Math.max(0,Math.min(1,value));urgency=Math.max(0,Math.min(1,urgency));socialAcceptability=Math.max(0,Math.min(1,socialAcceptability));
  const decisionContext=freeze({value:Number(value.toFixed(4)),urgency:Number(urgency.toFixed(4)),socialAcceptability:Number(socialAcceptability.toFixed(4)),dutyConflict});
  const signature={seed,when,decisionContext,factors,reasons,missing,requiredAuthorityScope:requiredScope||null,conflictingGoalIds:Array.isArray(config.conflictingGoalIds)?config.conflictingGoalIds.slice(0,MAX_GOALS).map(x=>cleanId(x,160)):[]};
  return freeze({
    version:VERSION,ok:true,seed,when,contextId:"DCTX-"+hashText(stable(signature)),decisionContext,
    factors:freeze(factors),reasons:freeze(reasons.slice(0,MAX_REASONS)),missingSources:freeze(missing.slice(0,MAX_MISSING_SOURCES)),
    evaluatorBoundary:"ProtagonistCommandEvaluator",evaluatorCompatible:true,readOnly:true,bounded:true,
    bounds:freeze({maxReasons:MAX_REASONS,maxGoals:MAX_GOALS,maxScopes:MAX_SCOPES,maxMissingSources:MAX_MISSING_SOURCES}),
    authority:freeze({determinism:"Campaign SEED + Fantasy Game Time + supplied authoritative/validated snapshots",directActionExecution:false,worldMutation:false,positionMutation:false,teleportation:false,simulationValidationBypass:false,inventoryAuthority:false,rankAuthority:false,healthAuthority:false,goalAuthority:false,relationshipAuthority:false,fullWorldScan:false,perFrameScan:false,providerAuthority:false,presentationAuthority:false})
  });
}
function fromLive(seedValue,whenValue,optionsValue){
  telemetryState.liveBuilds++;
  const seed=cleanText(seedValue,160),when=cleanText(whenValue,32),options=plain(optionsValue)?optionsValue:{},identity=cleanId(options.identityKey||"protagonist",96)||"protagonist";
  const scope=root(),snapshots={
    personality:scope.ProtagonistProfile?.derive?.(seed,identity)||null,
    needs:scope.ProtagonistNeeds?.snapshot?.(seed,identity)||null,
    goals:scope.ProtagonistGoals?.snapshot?.(seed,identity)||null,
    relationships:plain(options.relationships)?clone(options.relationships):null,
    inventory:scope.ProtagonistInventory?.snapshot?.(seed,identity)||null,
    health:scope.ProtagonistHealth?.decisionContext?.(seed,identity)||null,
    authority:scope.ProtagonistAuthority?.decisionContext?.(seed,identity)||null
  };
  return build({seed,when,snapshots,conflictingGoalIds:options.conflictingGoalIds,requiredAuthorityScope:options.requiredAuthorityScope});
}
function telemetry(){return freeze({...telemetryState,fullWorldScan:false,perFrameScan:false,authority:false,bounded:true})}

root().ProtagonistDecisionContext=Object.freeze({VERSION,MAX_REASONS,MAX_GOALS,MAX_SCOPES,MAX_MISSING_SOURCES,SOURCE_KEYS,build,fromLive,telemetry});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistDecisionContext;
})();