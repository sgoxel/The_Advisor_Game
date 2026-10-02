(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.AdvisorSecurityReadoutUI=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="advisor-security-readout-v1";
const EVIDENCE_MODES=Object.freeze(["ordinary","threat","uncertain"]);
const MAX_THREATS=3,MAX_EQUIPMENT=4,MAX_OUTCOMES=3,MAX_SCOPES=4,MAX_SOURCE_READS=12,MAX_INJURIES=2;
const state={
  evidenceMode:null,queryChecked:false,explicitEvidence:null,
  modelBuilds:0,runtimeBuilds:0,evidenceBuilds:0,lastModel:null,
  sourceReads:{health:0,inventory:0,skill:0,authority:0,readiness:0,threats:0,outcomes:0}
};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]))}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function id(value,max=140){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function esc(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function title(value){return clean(value,100).replace(/(^|[-_: ])([a-z])/g,(_,a,b)=>a+b.toUpperCase())}
function pctMilli(value,fallback=null){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n/1000))):fallback}
function arr(value,max){return Array.isArray(value)?value.slice(0,max):[]}
function bump(key){if(Object.prototype.hasOwnProperty.call(state.sourceReads,key))state.sourceReads[key]++}
function safe(key,fn,fallback=null){bump(key);try{const out=fn();return out==null?fallback:out}catch(_){return fallback}}

function normalizeHealth(raw){
  if(!raw||raw.compatible===false||raw.exists===false)return null;
  const injuries=arr(raw.injuries||raw.activeInjuries,MAX_INJURIES).map(x=>clean(x?.label||x?.kind||x?.bodyRegion||"Injury",80));
  return freeze({
    condition:pctMilli(raw.conditionMilli,Number.isFinite(Number(raw.condition))?Math.round(Number(raw.condition)*100):null),
    fatigue:pctMilli(raw.fatigueMilli,Number.isFinite(Number(raw.fatigue))?Math.round(Number(raw.fatigue)*100):null),
    activeInjuryCount:Number.isFinite(Number(raw.activeInjuryCount))?Math.max(0,Math.floor(Number(raw.activeInjuryCount))):injuries.length,
    injuries:freeze(injuries)
  });
}
function normalizeSkill(raw){
  if(!raw)return null;
  const level=Number(raw.level);
  return freeze({skillId:"martial",level:Number.isFinite(level)?Math.max(0,Math.floor(level)):null,points:Number.isFinite(Number(raw.points))?Math.max(0,Math.floor(Number(raw.points))):null});
}
function normalizeAuthority(raw){
  if(!raw||raw.available===false||raw.exists===false)return null;
  const role=raw.currentRole||raw.role||{},scopes=arr(raw.scopes||role.scopes,MAX_SCOPES).map(x=>clean(x,90)).filter(Boolean),roleId=id(raw.roleId||role.roleId||"",90);
  return freeze({
    roleId:roleId||null,
    label:clean(raw.roleLabel||role.title||role.label||role.rankLabel||title(roleId)||"Local role",100),
    rankTier:Number.isFinite(Number(raw.rankTier??role.rankTier))?Math.max(0,Math.floor(Number(raw.rankTier??role.rankTier))):0,
    scopes:freeze(scopes)
  });
}
function equipmentCapability(record){
  const meta=record?.metadata&&typeof record.metadata==="object"?record.metadata:{};
  const weapon=id(meta.martialWeaponClass||"",32).toLowerCase(),protection=id(meta.martialProtectionClass||"",32).toLowerCase(),reach=id(meta.martialReachClass||"",32).toLowerCase(),range=id(meta.martialRangeClass||"",32).toLowerCase();
  if(!weapon&&!protection&&!reach&&!range)return null;
  return freeze({id:id(record?.id||record?.possessionId||"",120)||null,label:clean(record?.label||record?.name||record?.itemRef?.id||"Known equipment",90),weaponClass:weapon||null,protectionClass:protection||null,reachClass:reach||null,rangeClass:range||null,carried:record?.carryState==="carried"});
}
function normalizeInventory(raw){
  const records=arr(raw?.records||raw?.items,48),rows=[];
  for(const record of records){
    if(record?.ownershipState&&record.ownershipState!=="owned")continue;
    const cap=equipmentCapability(record);
    if(cap&&rows.length<MAX_EQUIPMENT)rows.push(cap);
  }
  return freeze(rows);
}
function normalizeThreat(row,index=0){
  if(!row||typeof row!=="object")return null;
  const epistemic=id(row.epistemicStatus||row.confidence||"unknown",30).toLowerCase(),status=id(row.status||"active",30).toLowerCase();
  if(status&&status!=="active")return null;
  return freeze({
    id:id(row.id||row.incidentId||("THREAT-"+index),140),
    label:clean(row.summary||row.label||title(row.category||"local threat"),150),
    severity:id(row.severity||"unknown",30).toLowerCase()||"unknown",
    epistemic:["confirmed","reported"].includes(epistemic)?epistemic:"unknown",
    location:clean(row.locationRef?.label||row.location?.label||row.locationRef?.id||row.location?.id||"Local area",100),
    source:clean(row.sourceSystem||row.sourceRef?.kind||row.source?.kind||"explicit evidence",80)
  });
}
function normalizeOutcome(row,index=0){
  if(!row||typeof row!=="object"||row.terminal===false)return null;
  const resultId=id(row.id||row.resultId||("RESULT-"+index),140),resolution=id(row.resolution||row.outcome||row.state||"recorded",60).toLowerCase();
  return freeze({id:resultId,label:title(resolution||"recorded outcome"),detail:clean(row.locationRef?.label||row.locationRef?.id||row.sourceRef?.id||"Terminal Simulation result",120),fantasyTimestamp:clean(row.fantasyTimestamp||row.timestamp||"",32),terminal:row.terminal!==false,source:clean(row.sourceSystem||row.requestSourceRef?.kind||row.sourceRef?.kind||"Simulation",80)});
}
function fallbackReadiness(health,skill,equipment){
  const known=Boolean(health||skill||equipment?.length);if(!known)return null;
  return freeze({available:true,score:null,status:"context-only",meaning:"Known personal readiness factors; no victory probability or outcome prediction.",martialLevel:skill?.level??null,condition:health?.condition??null,fatigue:health?.fatigue??null,activeInjuryCount:health?.activeInjuryCount??null,equipmentCount:equipment?.length||0,limitations:freeze([]),source:"Stage 1–13 authoritative context"});
}
function normalizeReadiness(raw,health,skill,equipment){
  if(!raw||raw.ok===false)return fallbackReadiness(health,skill,equipment);
  return freeze({
    available:true,
    score:Number.isFinite(Number(raw.readinessScore))?Math.max(0,Math.min(100,Math.round(Number(raw.readinessScore)))):null,
    status:clean(raw.readinessStatus||"context-only",50),
    meaning:clean(raw.readinessMeaning||"Personal readiness context only; not victory probability or outcome authority.",150),
    martialLevel:Number.isFinite(Number(raw.martialSkill?.level??raw.martialSkill))?Math.max(0,Math.floor(Number(raw.martialSkill?.level??raw.martialSkill))):(skill?.level??null),
    condition:pctMilli(raw.health?.conditionMilli,health?.condition??null),
    fatigue:pctMilli(raw.health?.fatigueMilli,health?.fatigue??null),
    activeInjuryCount:Number.isFinite(Number(raw.health?.activeInjuryCount))?Math.max(0,Math.floor(Number(raw.health.activeInjuryCount))):(health?.activeInjuryCount??null),
    equipmentCount:Array.isArray(raw.equipment)?Math.min(raw.equipment.length,MAX_EQUIPMENT):(equipment?.length||0),
    limitations:freeze(arr(raw.limitations,4).map(x=>clean(x,80))),
    source:"ProtagonistMartialReadiness"
  });
}
function buildModel(base){
  state.modelBuilds++;
  const threats=freeze(arr(base.threats,MAX_THREATS).filter(Boolean)),outcomes=freeze(arr(base.outcomes,MAX_OUTCOMES).filter(Boolean)),equipment=freeze(arr(base.equipment,MAX_EQUIPMENT).filter(Boolean)),sources=freeze(arr(base.sources,10));
  const activeKnown=threats.length,unknownThreat=Boolean(base.threatUnknown),summary=unknownThreat?"Threat picture uncertain":activeKnown?activeKnown+" known threat"+(activeKnown===1?"":"s"):"No known active threat";
  const out=freeze({
    version:VERSION,mode:base.mode||"runtime",when:clean(base.when||"",32),
    health:base.health||null,martialSkill:base.martialSkill||null,equipment,authority:base.authority||null,readiness:base.readiness||null,threats,outcomes,threatUnknown:unknownThreat,summary,sources,
    readOnly:true,eventDriven:true,bounded:true,
    limits:freeze({maxThreats:MAX_THREATS,maxEquipment:MAX_EQUIPMENT,maxOutcomes:MAX_OUTCOMES,maxScopes:MAX_SCOPES,maxSourceReads:MAX_SOURCE_READS}),
    authorityFlags:freeze({
      eventDriven:true,bounded:true,boundedReads:true,
      directWorldMutation:false,directActionExecution:false,combatResolution:false,retreatExecution:false,
      healthMutation:false,inventoryMutation:false,skillMutation:false,standingMutation:false,rankMutation:false,relationshipMutation:false,legalAuthority:false,
      protagonistDecisionBypass:false,simulationValidationBypass:false,
      fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameRead:false,presentationOnly:true
    })
  });
  state.lastModel=out;return out;
}
function evidenceModel(modeValue){
  state.evidenceBuilds++;
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"ordinary",when="1201-10-01 18:40:00";
  const health={condition:91,fatigue:24,activeInjuryCount:0,injuries:freeze([])},skill={skillId:"martial",level:4,points:760};
  const equipment=freeze([
    {id:"POS-SPEAR",label:"Watch spear",weaponClass:"standard",protectionClass:null,reachClass:"long",rangeClass:"none",carried:true},
    {id:"POS-JACK",label:"Padded jack",weaponClass:null,protectionClass:"light",reachClass:null,rangeClass:null,carried:true}
  ]);
  const authority={roleId:"squire",label:"Squire",rankTier:1,scopes:freeze(["self","local:protection","local:escort"])};
  const readiness={available:true,score:68,status:"prepared-with-constraints",meaning:"Personal readiness context only; not victory probability or outcome authority.",martialLevel:4,condition:91,fatigue:24,activeInjuryCount:0,equipmentCount:2,limitations:freeze([]),source:"explicit grounded evidence"};
  if(mode==="threat")return buildModel({mode,when,health,martialSkill:skill,equipment,authority,readiness,
    threats:freeze([
      {id:"SEC-EVID-1",summary:"Bandit activity confirmed near the north lane",severity:"serious",epistemicStatus:"confirmed",locationRef:{label:"North lane"},sourceSystem:"Simulation"},
      {id:"SEC-EVID-2",summary:"A resident reports movement by the old ford",severity:"moderate",epistemicStatus:"reported",locationRef:{label:"Old ford"},sourceSystem:"ResidentReport"}
    ].map(normalizeThreat)),
    outcomes:freeze([{id:"CBT-EVID-1",resolution:"protagonist-disengaged",terminal:true,locationRef:{label:"North lane"},fantasyTimestamp:"1201-10-01 18:28:00",sourceSystem:"Simulation"}].map(normalizeOutcome)),
    sources:freeze([{name:"Health",available:true,kind:"authoritative"},{name:"Inventory capability",available:true,kind:"authoritative"},{name:"Martial skill",available:true,kind:"authoritative"},{name:"Role / duty",available:true,kind:"authoritative"},{name:"Threat evidence",available:true,kind:"confirmed + reported"},{name:"Recent outcomes",available:true,kind:"terminal Simulation"}])
  });
  if(mode==="uncertain")return buildModel({mode,when,health,martialSkill:skill,equipment:freeze([]),authority:{roleId:"local-resident",label:"Local Resident",rankTier:0,scopes:freeze(["self"])},readiness:fallbackReadiness(health,skill,[]),
    threats:freeze([{id:"REP-EVID-U1",summary:"Unverified warning about activity beyond the village",severity:"unknown",epistemicStatus:"unknown",locationRef:{label:"Outer road"},sourceSystem:"unavailable"}].map(normalizeThreat)),
    outcomes:freeze([]),threatUnknown:true,
    sources:freeze([{name:"Health",available:true,kind:"authoritative"},{name:"Inventory capability",available:false,kind:"unavailable"},{name:"Martial skill",available:true,kind:"authoritative"},{name:"Role / duty",available:true,kind:"authoritative"},{name:"Threat evidence",available:false,kind:"reported source not grounded"},{name:"Recent outcomes",available:false,kind:"unavailable"}])
  });
  return buildModel({mode,when,health,martialSkill:skill,equipment,authority,readiness,threats:freeze([]),outcomes:freeze([]),
    sources:freeze([{name:"Health",available:true,kind:"authoritative"},{name:"Inventory capability",available:true,kind:"authoritative"},{name:"Martial skill",available:true,kind:"authoritative"},{name:"Role / duty",available:true,kind:"authoritative"},{name:"Threat evidence",available:true,kind:"none known"},{name:"Recent outcomes",available:true,kind:"none recent"}])
  });
}
function queryEvidence(){
  if(state.queryChecked)return;state.queryChecked=true;
  try{const mode=new URLSearchParams(root.location?.search||"").get("advisorSecurityEvidence");if(EVIDENCE_MODES.includes(mode))state.evidenceMode=mode}catch(_){}
}
function explicitInput(ctx){const raw=ctx?.securityEvidence||state.explicitEvidence;return raw&&typeof raw==="object"?raw:null}
function runtimeModel(ctxValue){
  state.runtimeBuilds++;for(const key of Object.keys(state.sourceReads))state.sourceReads[key]=0;
  const ctx=ctxValue&&typeof ctxValue==="object"?ctxValue:{},seed=clean(ctx.seed||root.SeedSystem?.getCampaign?.()?.seed||"",160),when=clean(ctx.when||root.GameTime?.getTimestampKey?.()||"",32),identity="protagonist",explicit=explicitInput(ctx);
  const healthRaw=safe("health",()=>root.ProtagonistHealth?.decisionContext?.(seed,identity)||root.ProtagonistHealth?.snapshot?.(seed,identity),null),health=normalizeHealth(healthRaw);
  const inventoryRaw=safe("inventory",()=>root.ProtagonistInventory?.snapshot?.(seed,identity),null),equipment=normalizeInventory(inventoryRaw);
  const skillRaw=safe("skill",()=>root.ProtagonistSkills?.getSkill?.(seed,"martial",identity),null),martialSkill=normalizeSkill(skillRaw);
  const authorityRaw=safe("authority",()=>root.ProtagonistAuthority?.decisionContext?.(seed,identity)||root.ProtagonistAuthority?.snapshot?.(seed,identity),null),authority=normalizeAuthority(authorityRaw);
  const optionalReadiness=explicit?.readiness||safe("readiness",()=>root.ProtagonistMartialReadiness?.context?.(seed,{equipmentDescriptors:arr(explicit?.equipmentDescriptors,12)},identity),null),readiness=normalizeReadiness(optionalReadiness,health,martialSkill,equipment);
  const threatRaw=Array.isArray(explicit?.threats)?explicit.threats:safe("threats",()=>root.LocalSecurityIncidents?.list?.(seed,{status:"active",limit:MAX_THREATS})||null,null),threats=arr(threatRaw,MAX_THREATS).map(normalizeThreat).filter(Boolean);
  const outcomeRaw=Array.isArray(explicit?.outcomes)?explicit.outcomes:safe("outcomes",()=>root.PersonalCombatExchange?.list?.(seed,{limit:MAX_OUTCOMES},identity)||null,null),outcomes=arr(outcomeRaw,MAX_OUTCOMES).map(normalizeOutcome).filter(Boolean);
  const explicitThreatUnknown=explicit?.threatUnknown===true,threatProviderAvailable=Array.isArray(explicit?.threats)||Boolean(root.LocalSecurityIncidents?.list),outcomeProviderAvailable=Array.isArray(explicit?.outcomes)||Boolean(root.PersonalCombatExchange?.list);
  const sources=freeze([
    {name:"Health",available:Boolean(health),kind:"authoritative"},
    {name:"Inventory capability",available:Boolean(inventoryRaw),kind:equipment.length?"authoritative metadata":"known inventory / capability may be unknown"},
    {name:"Martial skill",available:Boolean(martialSkill),kind:"authoritative"},
    {name:"Role / duty",available:Boolean(authority),kind:"authoritative"},
    {name:"Threat evidence",available:threatProviderAvailable&&!explicitThreatUnknown,kind:explicitThreatUnknown?"uncertain":(threats.length?"bounded known incidents":"none known")},
    {name:"Recent outcomes",available:outcomeProviderAvailable,kind:outcomes.length?"terminal Simulation":"none recent / unavailable"}
  ]);
  return buildModel({mode:"runtime",when,health,martialSkill,equipment,authority,readiness,threats,outcomes,threatUnknown:explicitThreatUnknown||!threatProviderAvailable,sources});
}
function currentModel(ctx){queryEvidence();return state.evidenceMode?evidenceModel(state.evidenceMode):runtimeModel(ctx||{})}
function setEvidenceMode(modeValue){state.evidenceMode=EVIDENCE_MODES.includes(String(modeValue||""))?String(modeValue):null;state.queryChecked=true;return state.evidenceMode?evidenceModel(state.evidenceMode):null}
function setExplicitEvidence(value){state.explicitEvidence=value&&typeof value==="object"?freeze(clone(value)):null;return state.explicitEvidence}
function toneForThreat(m){return m.threatUnknown?"unknown":m.threats.some(x=>x.severity==="critical"||x.severity==="serious")?"alert":m.threats.length?"watch":"clear"}
function rows(rowsValue,empty){
  const values=arr(rowsValue,8);
  if(!values.length)return '<p class="advisor-security-empty">'+esc(empty)+'</p>';
  return '<div class="advisor-security-rows">'+values.map(r=>'<div class="advisor-security-row"><div><strong>'+esc(r.label||"Record")+'</strong><small>'+esc(r.detail||r.location||r.source||"")+'</small></div>'+(r.badge?'<span data-tone="'+esc(r.tone||"")+'">'+esc(r.badge)+'</span>':r.id?'<code>'+esc(r.id)+'</code>':'')+'</div>').join("")+'</div>';
}
function equipmentRows(equipment){return equipment.map(x=>({id:x.id,label:x.label,detail:[x.weaponClass&&("weapon "+x.weaponClass),x.protectionClass&&("protection "+x.protectionClass),x.reachClass&&("reach "+x.reachClass),x.rangeClass&&("range "+x.rangeClass)].filter(Boolean).join(" · ")||"Known martial metadata"}))}
function threatRows(threats){return threats.map(x=>({id:x.id,label:x.label,detail:x.location+" · "+title(x.severity),badge:title(x.epistemic),tone:x.epistemic==="confirmed"?"confirmed":x.epistemic==="reported"?"reported":"unknown"}))}
function outcomeRows(outcomes){return outcomes.map(x=>({id:x.id,label:x.label,detail:[x.detail,x.fantasyTimestamp].filter(Boolean).join(" · ")}))}
function markup(modelValue){
  const m=modelValue||currentModel({}),health=m.health,skill=m.martialSkill,ready=m.readiness,authority=m.authority,open=state.evidenceMode?" open":"",unavailable=m.sources.filter(x=>!x.available).map(x=>x.name),threatTone=toneForThreat(m);
  const conditionRows=health?[{label:"Condition",detail:health.condition==null?"unknown":health.condition+"%"},{label:"Fatigue",detail:health.fatigue==null?"unknown":health.fatigue+"%"},{label:"Active injuries",detail:String(health.activeInjuryCount??health.injuries?.length??"unknown")}]:[];
  const readinessRows=[{label:"Martial skill",detail:skill?.level==null?"unknown":"level "+skill.level},{label:"Readiness",detail:ready?.score==null?title(ready?.status||"context only"):(ready.score+" · "+title(ready.status))},{label:"Equipment capability",detail:m.equipment.length?m.equipment.length+" known carried item"+(m.equipment.length===1?"":"s"):"unknown / none confirmed"}];
  const dutyRows=authority?[{label:authority.label,detail:"rank "+authority.rankTier},...authority.scopes.map(x=>({label:title(x),detail:"legitimate scope"}))]:[];
  return '<details class="advisor-security-readout" data-mode="'+esc(m.mode)+'"'+open+'>'+
    '<summary><span><small>SECURITY · READINESS</small><strong>'+esc(m.summary)+'</strong></span><span class="advisor-security-summary-meta"><b data-tone="'+esc(threatTone)+'">'+esc(threatTone==="clear"?"Clear":threatTone==="alert"?"Threat":"Watch")+'</b><i>Read-only</i></span></summary>'+
    '<div class="advisor-security-body"><section class="advisor-security-hero" data-tone="'+esc(threatTone)+'"><div><small>KNOWN SECURITY PICTURE</small><strong>'+esc(m.summary)+'</strong><span>'+esc(ready?.meaning||"Readiness and threat knowledge are separate from combat outcome authority.")+'</span></div><div class="advisor-security-score"><b>'+(ready?.score==null?'—':esc(ready.score))+'</b><span>READINESS</span></div></section>'+
    '<div class="advisor-security-grid">'+
      '<section class="advisor-security-card"><header><strong>Condition</strong><span>Authoritative</span></header>'+rows(conditionRows,"Health/fatigue state unavailable.")+'</section>'+
      '<section class="advisor-security-card"><header><strong>Martial readiness</strong><span>'+esc(ready?.source||"Context")+'</span></header>'+rows(readinessRows,"Readiness context unavailable.")+(m.equipment.length?'<div class="advisor-security-equipment">'+rows(equipmentRows(m.equipment),"No capability metadata.")+'</div>':'')+'</section>'+
      '<section class="advisor-security-card" data-tone="'+esc(threatTone)+'"><header><strong>Known threats</strong><span>'+m.threats.length+'/'+MAX_THREATS+'</span></header>'+rows(threatRows(m.threats),m.threatUnknown?"Threat data unavailable or uncertain; no threat is inferred.":"No grounded active threat is currently known.")+'</section>'+
      '<section class="advisor-security-card"><header><strong>Protection duty</strong><span>Authoritative</span></header>'+rows(dutyRows,"Legitimate protection duty/authority unavailable.")+'</section>'+
      '<section class="advisor-security-card"><header><strong>Recent terminal outcomes</strong><span>'+m.outcomes.length+'/'+MAX_OUTCOMES+'</span></header>'+rows(outcomeRows(m.outcomes),"No recent terminal Simulation outcome reference is available.")+'</section>'+
    '</div>'+
    (unavailable.length?'<p class="advisor-security-unavailable"><b>Unavailable:</b> '+esc(unavailable.join(", "))+'. Missing facts remain unknown; the readout does not invent security state.</p>':'')+
    '<footer><span>'+esc(m.when||"Fantasy time unavailable")+'</span><strong>PRESENTATION ONLY · no fight, retreat, health, inventory, standing, rank or relationship mutation</strong></footer></div></details>';
}
function snapshot(){
  const reads={...state.sourceReads},total=Object.values(reads).reduce((a,b)=>a+b,0);
  return freeze({version:VERSION,evidenceMode:state.evidenceMode,modelBuilds:state.modelBuilds,runtimeBuilds:state.runtimeBuilds,evidenceBuilds:state.evidenceBuilds,sourceReads:freeze(reads),sourceReadTotal:total,lastMode:state.lastModel?.mode||null,limits:{maxThreats:MAX_THREATS,maxEquipment:MAX_EQUIPMENT,maxOutcomes:MAX_OUTCOMES,maxScopes:MAX_SCOPES,maxSourceReads:MAX_SOURCE_READS},authority:state.lastModel?.authorityFlags||freeze({eventDriven:true,bounded:true,boundedReads:true,perFrameRead:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,directWorldMutation:false,directActionExecution:false,combatResolution:false,retreatExecution:false,healthMutation:false,inventoryMutation:false,skillMutation:false,standingMutation:false,rankMutation:false,relationshipMutation:false,legalAuthority:false,protagonistDecisionBypass:false,simulationValidationBypass:false,presentationOnly:true})});
}
function proof(){
  const ordinary=evidenceModel("ordinary"),threat=evidenceModel("threat"),uncertain=evidenceModel("uncertain");
  return freeze({pass:ordinary.threats.length===0&&ordinary.summary==="No known active threat"&&threat.threats.some(x=>x.epistemic==="confirmed")&&threat.threats.some(x=>x.epistemic==="reported")&&threat.outcomes.every(x=>x.terminal===true)&&uncertain.threatUnknown===true&&uncertain.summary==="Threat picture uncertain"&&threat.authorityFlags.directActionExecution===false&&threat.authorityFlags.combatResolution===false,ordinarySummary:ordinary.summary,threatCount:threat.threats.length,uncertainExplicit:uncertain.threatUnknown,terminalOutcomesOnly:threat.outcomes.every(x=>x.terminal===true),readOnly:true,eventDriven:true,bounded:true,directWorldMutation:false,directActionExecution:false,combatResolution:false});
}
return freeze({VERSION,EVIDENCE_MODES,MAX_THREATS,MAX_EQUIPMENT,MAX_OUTCOMES,MAX_SCOPES,MAX_SOURCE_READS,evidenceModel,runtimeModel,currentModel,setEvidenceMode,setExplicitEvidence,markup,snapshot,proof});
});
