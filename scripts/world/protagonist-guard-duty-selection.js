(function(root,factory){
  "use strict";
  const api=factory(root||globalThis);
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root){root.ProtagonistGuardDutySelection=api;root.GuardDutySelection=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";
  const VERSION="protagonist-guard-duty-selection-v1";
  const MAX_CANDIDATES=12;
  const MAX_RESULT_BYTES=32768;
  const MAX_LOCATIONS=8;
  const MAX_ITEMS=16;
  const VALID_DUTIES=Object.freeze(["patrol","escort","watch","accompany","stand-down","defer"]);
  const VALID_ROLES=Object.freeze(["guard","village-guard","watchman","sentry","patrol-guard","local-guard"]);
  function F(v){if(v==null||typeof v!="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
  function C(v){if(v==null||typeof v!="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]))}
  function S(v){if(v==null||typeof v!="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
  function H(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
  function B(v){const t=String(v==null?"":v);return typeof TextEncoder!=="undefined"?new TextEncoder().encode(t).length:t.length}
  function T(v,n=160){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
  function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
  function P(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
  function clamp(n,min,max,def){const value=Number(n);if(!Number.isFinite(value))return def;return Math.max(min,Math.min(max,value));}
  function clamp01(n,def){const value=Number(n);if(!Number.isFinite(value))return def;return Math.max(0,Math.min(1,value));}
  function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""));}
  function seed(v){const s=T(v,160);if(!s)throw new Error("Campaign SEED is required.");return s}
  function ref(v){if(!P(v))return null;const kind=I(v.kind||v.type||"entity",80),id=I(v.id||v.entityId||v.refId||v.personId||v.locationId||v.targetId||"",180);return kind&&id?F({kind,id}):null}
  function sameRef(a,b){const x=ref(a),y=ref(b);return !!x&&!!y&&x.kind===y.kind&&x.id===y.id}
  function withLabel(raw,kind){const value=P(raw)?raw:{};const id=I(value.id||value.refId||value.entityId||value.locationId||value.personId||value.targetId,180);const label=T(value.label||value.name||value.title||id,120);return F({kind:I(kind||value.kind||value.type||"entity",80),id,label,routeAvailable:value.routeAvailable===true||value.routeAvailable===false?value.routeAvailable:undefined})}
  function normalizeCandidate(value){
    const item=P(value)?value:{};
    const kind=I(item.kind||item.type||item.category||"location",80).toLowerCase();
    const id=I(item.id||item.refId||item.entityId||item.locationId||item.personId||item.targetId,180);
    const label=T(item.label||item.name||item.title||id,120);
    if(!id) return null;
    return F({kind, id, label, routeAvailable:item.routeAvailable===true||item.routeAvailable===false?item.routeAvailable:undefined});
  }
  function activityRows(seedValue){
    const rows=Array.isArray(root?.DailyActivity?.build?.(seedValue))?root.DailyActivity.build(seedValue):[];
    return rows.slice(0,MAX_ITEMS).filter(x=>x&&x.id).map(x=>F({id:I(x.id,180),displayName:T(x.displayName||x.name||x.id,120),professionId:I(x.profession||x.role||"resident",80).toLowerCase(),workplaceId:I(x.workplaceId,180),role:I(x.role||x.kind||"resident",80).toLowerCase()}));
  }
  function authoritySnapshot(seedValue,identityValue){
    try{return root?.ProtagonistAuthority?.snapshot?.(seedValue,identityValue)||root?.ProtagonistAuthority?.decisionContext?.(seedValue,identityValue)||null}catch(_){return null}
  }
  function statusContext(seedValue,whenValue,identityValue){
    try{return root?.ProtagonistStatusObligations?.decisionContext?.(seedValue,whenValue,identityValue)||root?.ProtagonistStatusObligations?.resolve?.(seedValue,whenValue,identityValue)||null}catch(_){return null}
  }
  function serviceContext(seedValue,identityValue){
    try{return root?.ProtagonistServiceContracts?.read?.(seedValue,identityValue)||root?.ProtagonistServiceContracts?.current?.(seedValue,identityValue)||null}catch(_){return null}
  }
  function healthSnapshot(seedValue,identityValue){
    try{return root?.ProtagonistHealth?.snapshot?.(seedValue,identityValue)||root?.ProtagonistHealth?.decisionContext?.(seedValue,identityValue)||null}catch(_){return null}
  }
  function goalsList(seedValue,identityValue){
    try{return root?.ProtagonistGoals?.list?.(seedValue,{status:"active",limit:MAX_CANDIDATES},identityValue)||root?.ProtagonistGoals?.snapshot?.(seedValue,identityValue)||[] }catch(_){return []}
  }
  function getRoleId(role){const raw=String(role||"").toLowerCase();return raw.includes("guard")?"guard":(raw.includes("squire")?"squire":"local-resident");}
  function canOfferGuardService(auth){
    const role=String(auth?.currentRole?.roleId||auth?.roleId||"local-resident").toLowerCase();
    return VALID_ROLES.includes(role)||role.includes("guard")||role.includes("sentry")||role.includes("watch");
  }
  function normalizeContext(inputValue){
    const value=P(inputValue)?inputValue:{};
    return F({
      patrolRoute:normalizeCandidate(value.patrolRoute||value.patrol||value.route),
      escortTarget:normalizeCandidate(value.escortTarget||value.escort||value.target),
      watchLocation:normalizeCandidate(value.watchLocation||value.watch||value.standWatch),
      protectedTarget:normalizeCandidate(value.protectedTarget||value.protectTarget||value.protectedPerson||value.protectsTarget),
      routeAvailable:value.routeAvailable===true||value.routeAvailable===false?value.routeAvailable:undefined,
      authority: P(value.authority)?value.authority:null,
      health: P(value.health)?value.health:null,
      obligations: Array.isArray(value.obligations)?value.obligations:[],
      goals: Array.isArray(value.goals)?value.goals:[],
      service: P(value.service)?value.service:null
    });
  }
  function chooseRoleGuard(seedValue,whenValue,identityValue,selectValue){
    const authority=(P(selectValue?.authority)?selectValue.authority:(authoritySnapshot(seedValue,identityValue) || null));
    const roleId=String(authority?.currentRole?.roleId||authority?.roleId||"local-resident").toLowerCase();
    return VALID_ROLES.includes(roleId)||roleId.includes("guard")||roleId.includes("watch")||roleId.includes("sentry");
  }
  function evaluate(configValue){
    const config=P(configValue)?configValue:{};
    const seedValue=seed(config.seed||config.campaignSeed||config.worldSeed);
    const when=String(config.when||config.fantasyTimestamp||config.timestamp||"");
    if(!validTs(when))return F({ok:false,reason:"fantasy-timestamp-required",proposalOnly:true,duty:null,selectedDuty:null,selectedProposal:null,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,simulationValidationRequired:true});
    const identity=I(config.identity||config.identityKey||"protagonist",96)||"protagonist";
    const health=(P(config.health)?config.health:(healthSnapshot(seedValue,identity) || {}));
    const service=(P(config.service)?config.service:(serviceContext(seedValue,identity) || {}));
    const status=(P(config.status)?config.status:(statusContext(seedValue,when,identity) || {}));
    const goalRows=goalsList(seedValue,identity);
    const normalized=normalizeContext(config);
    const auth=(P(config.authority)?config.authority:(authoritySnapshot(seedValue,identity) || {}));
    const roleId=String(auth?.currentRole?.roleId||auth?.roleId||"local-resident").toLowerCase();
    const dutyCandidate=normalized.patrolRoute||normalized.escortTarget||normalized.watchLocation||normalized.protectedTarget;
    const conditionBad=Number(health?.conditionMilli??health?.condition??92000) < 30000 || Number(health?.fatigueMilli??health?.fatigue??0) > 70000 || Number(health?.activeInjuryCount??health?.injuryCount??0) > 1;
    const urgentNeed = Number(health?.fatigueMilli??health?.fatigue??0) > 80000 || Number(health?.injuryBurdenMilli??health?.injuryBurden??0) > 50000;
    const hasActiveDuty = Array.isArray(status?.obligations)&&status.obligations.some(o=>String(o?.state||"")==="active"||String(o?.kind||"").includes("employment")||String(o?.category||" ").includes("duty"));
    const hasServiceDuty = Boolean(service?.ledger?.activeContractId||service?.activeContractId||service?.activeServiceContractId);
    const strongNeed = Array.isArray(goalRows)&&goalRows.some(g=>Number(g?.priority||0)>=80);
    const guardRole=chooseRoleGuard(seedValue,when,identity,{authority:auth});
    const explicitRoute=typeof config.routeAvailable==="boolean"?config.routeAvailable:(typeof normalized.routeAvailable==="boolean"?normalized.routeAvailable:undefined);
    const routeAvailable = explicitRoute===true || explicitRoute===false ? explicitRoute : !!(normalized.patrolRoute?.routeAvailable===true || normalized.escortTarget?.routeAvailable===true || normalized.watchLocation?.routeAvailable===true || normalized.protectedTarget?.routeAvailable===true);
    const ready = guardRole && !conditionBad && !urgentNeed && !hasActiveDuty && !hasServiceDuty;
    let chosenDuty="stand-down";
    let reasons=[];
    if(!guardRole){reasons.push("guard-role-required");}
    else if(conditionBad||urgentNeed){reasons.push("health-prevents-duty"); chosenDuty="defer";}
    else if(hasActiveDuty||hasServiceDuty){reasons.push("active-duty-conflict"); chosenDuty="defer";}
    else if(normalized.escortTarget && routeAvailable){chosenDuty="escort"; reasons.push("legitimate-escort-duty");}
    else if(normalized.patrolRoute && routeAvailable){chosenDuty="patrol"; reasons.push("grounded-patrol-route");}
    else if(normalized.watchLocation && routeAvailable){chosenDuty="watch"; reasons.push("local-watch-duty");}
    else if(normalized.protectedTarget && routeAvailable){chosenDuty="accompany"; reasons.push("grounded-protection-duty");}
    else if(!dutyCandidate && !guardRole){chosenDuty="stand-down"; reasons.push("no-legitimate-duty");}
    else if(!dutyCandidate){chosenDuty="stand-down"; reasons.push("missing-grounded-duty-target");}
    else if(!routeAvailable){chosenDuty="defer"; reasons.push("route-not-available");}
    else if(strongNeed && !guardRole){chosenDuty="defer"; reasons.push("priority-conflict");}
    else if(!ready){chosenDuty="defer"; reasons.push("duty-readiness-incomplete");}
    if(chosenDuty!=="stand-down"&&chosenDuty!=="defer"&&(!guardRole||!dutyCandidate||!routeAvailable)){
      chosenDuty="stand-down"; reasons=["guard-duty-selection-invalid"];
    }
    const dutyKey=VALID_DUTIES.includes(chosenDuty)?chosenDuty:"stand-down";
    const proposalId="GDUTY-"+H(S({seed:seedValue,when,identity,duty:dutyKey,routeAvailable,guardRole}));
    const params={seed:seedValue,when,identity,selectedDuty:dutyKey,guardRole:Boolean(guardRole),targetId:ref(normalized.escortTarget||normalized.protectedTarget||normalized.watchLocation||normalized.patrolRoute)?.id||null};
    const selectedProposal=F({proposalId,commandId:"protagonist.propose_guard_duty",source:"protagonist-guard-duty-selection",parameters:params,grounded:true,validated:true,proposalOnly:true,simulationValidationRequired:true});
    const result=F({ok:true,version:VERSION,seed:seedValue,when,identity,selectedDuty:dutyKey,reason:reasons[0]||"grounded-duty-selected",selectionId:"GUARD-DUTY-"+H(S({seed:seedValue,when,identity,duty:dutyKey})),selectedProposal:selectedProposal,proposalOnly:true,requiresRuntimeValidation:true,status:dutyKey==="stand-down"||dutyKey==="defer"?"proposal-only":"proposal-ready",bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,simulationValidationRequired:true,guardRole:Boolean(guardRole),routeAvailable:Boolean(routeAvailable),reasons:reasons.slice(0,MAX_CANDIDATES),authority:F({roleId:roleId,guardAuthority:Boolean(guardRole),proposalOnly:true,simulationValidationRequired:true}),readOnly:true,worldMutation:false,relationshipMutation:false,resourceFabrication:false,actorFabrication:false,npcPatrolAuthority:false,guardCommandAuthority:false,locationReadLimit:MAX_LOCATIONS,candidateReadLimit:MAX_CANDIDATES,serializedBytes:0});
    const serializedBytes=B(S(result));
    if(serializedBytes>MAX_RESULT_BYTES){return F({ok:false,reason:"result-byte-budget-exceeded",proposalOnly:true,duty:null,selectedDuty:null,selectedProposal:null,serializedBytes,limit:MAX_RESULT_BYTES,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,simulationValidationRequired:true});}
    return F({...result,serializedBytes});
  }
  function selectDuty(configValue){return evaluate(configValue);}
  function resolve(configValue){return evaluate(configValue);}
  function decisionContext(seedValue,whenValue,identityValue,selectValue){return evaluate({seed:seedValue,when:whenValue,identity:identityValue,...(P(selectValue)?selectValue:{})});}
  function snapshot(seedValue,identityValue,optionsValue){
    const seedResult=seed(seedValue);const when=String((P(optionsValue)&&optionsValue.when)||(root?.GameTime?.getTimestampKey?.())||"");
    const role = authoritySnapshot(seedResult,identityValue);const health = healthSnapshot(seedResult,identityValue);const status = statusContext(seedResult,when,identityValue);const service = serviceContext(seedResult,identityValue);
    return F({version:VERSION,seed:seedResult,when:when||null,identity:I(identityValue||"protagonist",96)||"protagonist",guardRole:Boolean(canOfferGuardService(role)),health:health||null,status:status||null,service:service||null,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,bounded:true,proposalOnly:true,simulationValidationRequired:true});
  }
  function telemetry(){return F({version:VERSION,bounded:true,proposalOnly:true,simulationValidationRequired:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,maxResultBytes:MAX_RESULT_BYTES,maxCandidates:MAX_CANDIDATES,maxLocations:MAX_LOCATIONS,maxItems:MAX_ITEMS})}
  return F({VERSION,MAX_CANDIDATES,MAX_RESULT_BYTES,MAX_LOCATIONS,MAX_ITEMS,VALID_DUTIES,VALID_ROLES,evaluate,selectDuty,select:selectDuty,resolve,decisionContext,snapshot,telemetry});
});
