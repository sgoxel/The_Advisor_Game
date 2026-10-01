(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistStatusUI=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-status-ui-v1";
const ADVANCEMENT_READOUT_VERSION="wp-s013-009-v1";
const EVIDENCE_MODES=Object.freeze(["healthy","pressure","injured","authority","unavailable"]);
const MAX_GOALS=3,MAX_ITEMS=4,MAX_GUIDANCE=3,MAX_SCOPES=4,MAX_TRAITS=4,MAX_COMMITMENTS=4,MAX_OUTCOMES=4,MAX_BLOCKERS=4;
const state={evidenceMode:null,modelBuilds:0,runtimeBuilds:0,evidenceBuilds:0,lastModel:null};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=120){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function esc(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function pct(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):fallback}
function milliPct(value,fallback=0){const n=Number(value);return Number.isFinite(n)?pct(n/1000,fallback):fallback}
function title(value){return cleanText(value,120).replace(/(^|[-_ ])([a-z])/g,(_,a,b)=>a+b.toUpperCase())}
function normalizeTraits(profile){
  const traits=profile?.personality?.traits||profile?.traits||{};
  return Object.entries(traits).slice(0,MAX_TRAITS).map(([key,value])=>freeze({label:title(key),value:pct(value,50)}));
}
function normalizeNeeds(snap){
  const src=snap?.pressureMilli||snap?.pressures||null;if(!src)return null;
  return ["hunger","fatigue","safety","social"].map(key=>freeze({key,label:title(key),value:snap?.pressureMilli?milliPct(src[key]):pct(src[key])}));
}
function normalizeGoals(snap){
  const rows=Array.isArray(snap?.records)?snap.records:[];
  return rows.filter(r=>r&&["active","deferred"].includes(String(r.status||"active"))).slice(0,MAX_GOALS).map(r=>freeze({
    id:cleanId(r.id||"",120)||null,label:cleanText(r.topic||r.title||r.goalType||"Goal",110),status:cleanId(r.status||"active",30),priority:pct(r.priority,50)
  }));
}
function normalizeInventory(snap){
  const rows=Array.isArray(snap?.records)?snap.records:Array.isArray(snap?.items)?snap.items:[];
  return rows.slice(0,MAX_ITEMS).map(r=>freeze({label:cleanText(r.label||r.name||r.itemName||r.itemId||r.id||"Possession",90),detail:cleanText(r.quantity!=null?("×"+r.quantity):(r.carryState||r.location||""),50)}));
}
function normalizeHealth(snap){
  if(!snap)return null;
  const injuries=Array.isArray(snap.activeInjuries)?snap.activeInjuries:Array.isArray(snap.injuries)?snap.injuries:[];
  return freeze({condition:snap.conditionMilli!=null?milliPct(snap.conditionMilli):pct(snap.condition,100),fatigue:snap.fatigueMilli!=null?milliPct(snap.fatigueMilli):pct(snap.fatigue,0),injuries:injuries.slice(0,2).map(x=>cleanText(x.label||x.kind||x.bodyRegion||"Injury",90))});
}
function normalizeAuthority(snap){
  if(!snap)return null;
  const role=snap.currentRole||snap.role||{},scopes=Array.isArray(snap.scopes)?snap.scopes:Array.isArray(role.scopes)?role.scopes:[];
  return freeze({role:cleanText(role.label||role.name||snap.roleLabel||snap.roleId||"Local resident",90),rankTier:Number.isFinite(Number(snap.rankTier??role.rankTier))?Number(snap.rankTier??role.rankTier):0,scopes:scopes.slice(0,MAX_SCOPES).map(x=>cleanText(x,80))});
}
function normalizeStatusContext(snap){
  if(!snap)return null;
  const role=snap.role||snap.currentRole||{},scopes=Array.isArray(snap.scopes)?snap.scopes:Array.isArray(role.scopes)?role.scopes:[];
  const duties=Array.isArray(snap.duties)?snap.duties:[],opportunities=Array.isArray(snap.opportunities)?snap.opportunities:[],commitments=Array.isArray(snap.commitments)?snap.commitments:[],outcomes=Array.isArray(snap.outcomes)?snap.outcomes:[];
  const advancement=snap.advancement||null,eligibility=snap.eligibility||null,availability=snap.availability&&typeof snap.availability==="object"?snap.availability:{};
  return freeze({
    role:cleanText(role.label||role.rankLabel||role.name||snap.roleLabel||role.roleId||snap.roleId||"Local resident",90),
    rankTier:Number.isFinite(Number(snap.rankTier??role.rankTier))?Number(snap.rankTier??role.rankTier):0,
    scopes:scopes.slice(0,MAX_SCOPES).map(x=>cleanText(x,80)),
    duties:duties.slice(0,MAX_COMMITMENTS).map(item=>freeze({label:cleanText(item?.label||item?.dutyId||item?.kind||item?.category||"Duty",110),detail:cleanText(item?.detail||item?.requiredScope||item?.state||item?.status||"Standing",90),state:cleanText(item?.state||item?.status||"standing",32),source:cleanText(item?.source||"Status obligations",48)})),
    commitments:commitments.slice(0,MAX_COMMITMENTS).map(item=>freeze({label:cleanText(item?.label||item?.kind||"Commitment",110),detail:cleanText(item?.detail||item?.state||item?.status||"",90),state:cleanText(item?.state||item?.status||"active",32),source:cleanText(item?.source||"Authoritative source",48)})),
    opportunities:opportunities.slice(0,MAX_SCOPES).map(item=>freeze({label:cleanText(item?.label||item?.title||item?.intent||item?.sourceNpcLabel||item?.opportunityId||"Opportunity",110),detail:cleanText(item?.detail||item?.sourceNpcRef?.id||item?.sourceRef?.id||item?.intent||item?.status||item?.reason||"Grounded context",90),state:cleanText(item?.state||item?.status||"available",32),source:cleanText(item?.source||"Patronage opportunity",48)})),
    eligibility:eligibility?freeze({status:cleanText(eligibility.status||"unknown",40),eligible:eligibility.eligible===true,targetRole:cleanText(eligibility.targetRoleLabel||eligibility.targetRoleId||"Advancement role",90),reason:cleanText(eligibility.reason||"",110),blockers:(Array.isArray(eligibility.blockers)?eligibility.blockers:[]).slice(0,MAX_BLOCKERS).map(x=>cleanText(x,90))}):null,
    advancement:advancement?freeze({status:cleanText(advancement.status||advancement.reason||"evaluated",50),selected:cleanText(advancement.selectedOpportunityId||advancement.selectedOpportunity?.opportunityId||"",120),reason:cleanText(advancement.reason||"",110),blockers:(Array.isArray(advancement.blockers)?advancement.blockers:Array.isArray(advancement.selectedOpportunity?.hardBlockers)?advancement.selectedOpportunity.hardBlockers:[]).slice(0,MAX_BLOCKERS).map(x=>cleanText(x,90)),available:Boolean(advancement.available!==false)}):null,
    outcomes:outcomes.slice(0,MAX_OUTCOMES).map(item=>freeze({label:cleanText(item?.label||item?.kind||item?.status||"Outcome",110),detail:cleanText(item?.detail||item?.reason||item?.id||"",100),state:cleanText(item?.state||item?.status||"recorded",32),source:cleanText(item?.source||"Authoritative outcome",48)})),
    availability:freeze({
      duties:availability.duties===true,commitments:availability.commitments===true,opportunities:availability.opportunities===true,eligibility:availability.eligibility===true,advancement:availability.advancement===true,outcomes:availability.outcomes===true
    })
  });
}
function normalizeGuidance(snap){
  const rows=Array.isArray(snap?.records)?snap.records:[];
  return rows.filter(r=>String(r.status||"active")==="active").slice(0,MAX_GUIDANCE).map(r=>freeze({label:cleanText(r.principle||r.topic||"Guidance",130),priority:pct(r.priority,50),stance:cleanId(r.stance||"neutral",30)}));
}
function sourceState(value,kind="authoritative"){return freeze({available:value!=null,kind:value==null?"unavailable":kind,value:value||null})}
function model(base){
  state.modelBuilds++;
  const identity=base.identity||null,needs=base.needs||null,goals=base.goals||null,inventory=base.inventory||null,health=base.health||null,authority=base.authority||null,status=base.status||null,opportunities=base.opportunities||null,advancement=base.advancement||null,guidance=base.guidance||null;
  const unavailable=["identity","needs","goals","inventory","health","authority","status","opportunities","advancement","guidance"].filter(key=>base[key]==null);
  const result=freeze({
    version:VERSION,mode:base.mode||"runtime",when:cleanText(base.when||"",32),
    identity:sourceState(identity),needs:sourceState(needs),goals:sourceState(goals),inventory:sourceState(inventory),health:sourceState(health),authority:sourceState(authority),status:sourceState(status),opportunities:sourceState(opportunities),advancement:sourceState(advancement),guidance:sourceState(guidance,"advisory"),
    unavailable:freeze(unavailable),readOnly:true,eventDriven:true,bounded:true,
    authorityFlags:freeze({directWorldMutation:false,directExecution:false,actionProposal:false,providerPayloadRendered:false,wholeWorldScan:false,perFrameRender:false,authoritativeVsAdvisoryLabeled:true})
  });
  state.lastModel=result;return result;
}
function evidenceModel(modeValue){
  state.evidenceBuilds++;
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"healthy",when="1201-09-30 14:20:00";
  const identity={id:"PROTAGONIST-7A12C4E9",name:"Seren Vale",subtitle:"Persistent protagonist · steady / empathetic",traits:[{label:"Resolve",value:72},{label:"Empathy",value:68},{label:"Caution",value:43}]};
  const inventory=[{label:"Travel cloak",detail:"carried"},{label:"Bread ration",detail:"×2"},{label:"Gate token",detail:"unique"}];
  const guidance=[{label:"Keep explicit promises unless safety makes them impossible.",priority:80,stance:"encourage"}];
  const authorityLow={role:"Village resident",rankTier:0,scopes:["self"]};
  const authorityHigh={role:"Village steward",rankTier:2,scopes:["self","settlement:administration","settlement:records"]};
  const blockedStatus=normalizeStatusContext({role:authorityLow,rankTier:0,scopes:authorityLow.scopes,duties:[],commitments:[],opportunities:[],eligibility:{status:"ineligible",eligible:false,targetRoleId:"guild-member",reason:"blocked",blockers:["authoritative-employment-required","qualifying-profession-required"]},advancement:null,outcomes:[],availability:{duties:true,commitments:true,opportunities:true,eligibility:true,advancement:false,outcomes:true}});
  const richStatus=normalizeStatusContext({role:authorityHigh,rankTier:2,scopes:authorityHigh.scopes,duties:[{label:"Attend village administration",detail:"settlement:administration",state:"standing",source:"Status obligations"}],commitments:[{label:"Squire service",detail:"Guard captain · duty window active",state:"active",source:"Service contract"},{label:"Formal guild oath",detail:"Guild hall · authority still backed",state:"active",source:"Oath ledger"}],opportunities:[{label:"Guildmaster sponsorship",detail:"advancement-sponsorship · N-GUILDMASTER",state:"available",source:"Patronage opportunity"},{label:"Watch-house service sponsorship",detail:"service-sponsorship · N-GUARD",state:"available",source:"Patronage opportunity"}],eligibility:{status:"eligible",eligible:true,targetRoleLabel:"Guild member",targetRoleId:"guild-member",reason:"requirements-satisfied",blockers:[]},advancement:{status:"pursue",selectedOpportunityId:"PAT-ADV-GUILD",reason:"Grounded advancement opportunity selected",blockers:[],available:true},outcomes:[{label:"Recent appointment",detail:"APP-7C21 · appointed",state:"appointed",source:"Appointment resolution"},{label:"Service result",detail:"SVR-11AA · completed",state:"completed",source:"Service contract"}],availability:{duties:true,commitments:true,opportunities:true,eligibility:true,advancement:true,outcomes:true}});
  const common={identity,inventory,guidance};
  if(mode==="authority")return model({...common,mode,when,needs:[{key:"hunger",label:"Hunger",value:26},{key:"fatigue",label:"Fatigue",value:33},{key:"safety",label:"Safety",value:19},{key:"social",label:"Social",value:42}],goals:[{id:"GOAL-LEDGER",label:"Review storehouse allocations",status:"active",priority:82}],health:{condition:91,fatigue:29,injuries:[]},authority:authorityHigh,status:richStatus,opportunities:richStatus.opportunities,advancement:richStatus.advancement,guidance:[...guidance,{label:"Use office authority only for duties that genuinely require it.",priority:92,stance:"caution"}]});
  if(mode==="unavailable")return model({mode,when,identity,needs:[{key:"hunger",label:"Hunger",value:33},{key:"fatigue",label:"Fatigue",value:24},{key:"safety",label:"Safety",value:15},{key:"social",label:"Social",value:28}],goals:null,inventory:null,health:{condition:88,fatigue:24,injuries:[]},authority:null,status:null,opportunities:null,advancement:null,guidance:null});
  const health=mode==="injured"?{condition:48,fatigue:86,injuries:["Sprained ankle · recovering"]}:mode==="pressure"?{condition:78,fatigue:55,injuries:[]}:{condition:96,fatigue:12,injuries:[]};
  const needs=mode==="injured"?[{key:"hunger",label:"Hunger",value:41},{key:"fatigue",label:"Fatigue",value:86},{key:"safety",label:"Safety",value:66},{key:"social",label:"Social",value:31}]:mode==="pressure"?[{key:"hunger",label:"Hunger",value:84},{key:"fatigue",label:"Fatigue",value:61},{key:"safety",label:"Safety",value:27},{key:"social",label:"Social",value:58}]:[{key:"hunger",label:"Hunger",value:18},{key:"fatigue",label:"Fatigue",value:12},{key:"safety",label:"Safety",value:8},{key:"social",label:"Social",value:22}];
  const goals=mode==="injured"?[{id:"GOAL-REST",label:"Recover before leaving the village",status:"active",priority:96}]:mode==="pressure"?[{id:"GOAL-MEAL",label:"Find food before patrol",status:"active",priority:88}]:[{id:"GOAL-NORTH",label:"Inspect the north gate",status:"active",priority:74}];
  return model({...common,mode,when,needs,goals,health,authority:authorityLow,status:blockedStatus,opportunities:blockedStatus.opportunities,advancement:null});
}
function runtimeModel(ctx){
  state.runtimeBuilds++;
  const seed=cleanText(ctx?.seed||"",160),identityKey="protagonist",when=cleanText(ctx?.when||"",32);
  let profile=null,needs=null,goals=null,inventory=null,health=null,authority=null,statusSource=null,opportunities=null,eligibility=null,advancement=null,guidance=null;
  let service=null,oaths=null,appointments=null,patronageDecisions=null,serviceResults=null;
  const reads={profile:0,needs:0,goals:0,inventory:0,health:0,authority:0,status:0,opportunities:0,eligibility:0,advancement:0,service:0,oaths:0,outcomes:0,guidance:0};
  try{profile=root.ProtagonistProfile?.derive?.(seed,identityKey)||null;reads.profile++}catch(_){}
  try{needs=root.ProtagonistNeeds?.snapshot?.(seed,identityKey)||null;reads.needs++}catch(_){}
  try{goals=root.ProtagonistGoals?.snapshot?.(seed,identityKey)||null;reads.goals++}catch(_){}
  try{inventory=root.ProtagonistInventory?.snapshot?.(seed,identityKey)||null;reads.inventory++}catch(_){}
  try{health=root.ProtagonistHealth?.decisionContext?.(seed,identityKey)||root.ProtagonistHealth?.snapshot?.(seed,identityKey)||null;reads.health++}catch(_){}
  try{authority=root.ProtagonistAuthority?.snapshot?.(seed,identityKey)||root.ProtagonistAuthority?.decisionContext?.(seed,identityKey)||null;reads.authority++}catch(_){}
  try{if(root.ProtagonistStatusObligations?.decisionContext){const v=root.ProtagonistStatusObligations.decisionContext(seed,when,identityKey);statusSource=v?.ok===false?null:v;reads.status++}}catch(_){}
  try{if(root.ProtagonistPatronageOpportunities?.list){opportunities=root.ProtagonistPatronageOpportunities.list(seed,when,{limit:3},identityKey);if(!Array.isArray(opportunities))opportunities=[];reads.opportunities++}}catch(_){opportunities=null}
  try{if(root.ProtagonistAppointmentResolution?.catalog&&root.ProtagonistAppointmentResolution?.eligibility){const cat=root.ProtagonistAppointmentResolution.catalog().slice(0,1),target=cat[0]?.targetRoleId||cat[0]?.roleId||null;if(target)eligibility=root.ProtagonistAppointmentResolution.eligibility(seed,target,when,identityKey);reads.eligibility++}}catch(_){}
  try{if(root.ProtagonistAdvancementGoal?.snapshot){const v=root.ProtagonistAdvancementGoal.snapshot(seed,when,{opportunities:Array.isArray(opportunities)?opportunities:[]});advancement=v?.ok===true?v:null;reads.advancement++}}catch(_){}
  try{if(root.ProtagonistServiceContracts?.current){service=root.ProtagonistServiceContracts.current(seed,when,identityKey);reads.service++}}catch(_){}
  try{if(root.ProtagonistOathAllegiance?.currentContext){oaths=root.ProtagonistOathAllegiance.currentContext(seed,identityKey);reads.oaths++}}catch(_){}
  try{if(root.ProtagonistAppointmentResolution?.list)appointments=root.ProtagonistAppointmentResolution.list(seed,{limit:2},identityKey);if(root.ProtagonistPatronageOpportunities?.decisions)patronageDecisions=root.ProtagonistPatronageOpportunities.decisions(seed,{limit:2},identityKey);if(root.ProtagonistServiceContracts?.results)serviceResults=root.ProtagonistServiceContracts.results(seed,{limit:2},identityKey);if(root.ProtagonistAppointmentResolution?.list||root.ProtagonistPatronageOpportunities?.decisions||root.ProtagonistServiceContracts?.results)reads.outcomes++}catch(_){}
  try{guidance=root.ProtagonistGuidance?.snapshot?.(seed,identityKey)||null;reads.guidance++}catch(_){}
  const identity=profile?{id:cleanId(profile.protagonistId||"protagonist",120),name:cleanText(profile.birthIdentity?.fullName||"Protagonist",120),subtitle:"Persistent protagonist",traits:normalizeTraits(profile)}:null;
  const authorityRole=authority?.currentRole||authority?.role||null,authorityScopes=Array.isArray(authorityRole?.scopes)?authorityRole.scopes:Array.isArray(authority?.scopes)?authority.scopes:[],authorityRank=Number.isFinite(Number(authorityRole?.rankTier??authority?.rankTier))?Number(authorityRole?.rankTier??authority?.rankTier):0;
  const commitments=[];
  if(service)commitments.push({label:cleanText(service.roleType||"Service contract",90),detail:cleanText((service.patronRef?.id||"patron")+" · "+(service.effectiveState||service.state||"active"),100),state:service.effectiveState||service.state||"active",source:"Service contract"});
  if(oaths?.available&&Array.isArray(oaths.oaths))for(const oath of oaths.oaths.slice(0,2))commitments.push({label:"Formal oath",detail:cleanText((oath.institutionRef?.id||oath.counterpartRef?.id||"institution")+" · "+(oath.authorityStillBacked===false?"scope no longer backed":"authority backed"),100),state:oath.state||"active",source:"Oath ledger"});
  if(Array.isArray(statusSource?.obligations))for(const ob of statusSource.obligations.slice(0,2))commitments.push({label:cleanText(ob.label||ob.kind||"Obligation",100),detail:cleanText(ob.detail||ob.state||ob.status||"",90),state:ob.state||ob.status||"active",source:"Status obligations"});
  const outcomes=[];
  if(Array.isArray(appointments))for(const row of appointments.slice(0,2))outcomes.push({label:"Appointment",detail:cleanText((row.targetRoleId||"role")+" · "+(row.id||""),100),state:row.status||"appointed",source:"Appointment resolution"});
  if(Array.isArray(patronageDecisions))for(const row of patronageDecisions.slice(0,2))outcomes.push({label:"Patronage decision",detail:cleanText((row.intent||"opportunity")+" · "+(row.opportunityId||row.id||""),100),state:row.status||row.decision||"recorded",source:"Patronage decision"});
  if(Array.isArray(serviceResults))for(const row of serviceResults.slice(0,2))outcomes.push({label:"Service result",detail:cleanText((row.dutyId||"duty")+" · "+(row.id||""),100),state:row.resultState||"recorded",source:"Service contract"});
  const normalizedStatus=authorityRole?normalizeStatusContext({role:authorityRole,rankTier:authorityRank,scopes:authorityScopes,duties:Array.isArray(statusSource?.duties)?statusSource.duties:[],commitments,opportunities:Array.isArray(opportunities)?opportunities:[],eligibility,advancement,outcomes,availability:{duties:statusSource!=null,commitments:Boolean(statusSource||root.ProtagonistServiceContracts?.current||root.ProtagonistOathAllegiance?.currentContext),opportunities:opportunities!=null,eligibility:eligibility!=null,advancement:advancement!=null,outcomes:Boolean(root.ProtagonistAppointmentResolution?.list||root.ProtagonistPatronageOpportunities?.decisions||root.ProtagonistServiceContracts?.results)}}):null;
  const result=model({mode:"runtime",when,identity,needs:needs?normalizeNeeds(needs):null,goals:goals?normalizeGoals(goals):null,inventory:inventory?normalizeInventory(inventory):null,health:normalizeHealth(health),authority:normalizeAuthority(authority),status:normalizedStatus,opportunities:opportunities==null?null:(normalizedStatus?.opportunities||[]),advancement:advancement?normalizedStatus?.advancement:null,guidance:guidance?normalizeGuidance(guidance):null});
  state.lastReadTelemetry=freeze({readCount:Object.values(reads).reduce((a,b)=>a+b,0),reads:freeze(reads),maxReadCount:14,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false});
  return result;
}
function currentModel(ctx){return state.evidenceMode?evidenceModel(state.evidenceMode):runtimeModel(ctx||{})}
function setEvidenceMode(modeValue){state.evidenceMode=EVIDENCE_MODES.includes(String(modeValue||""))?String(modeValue):null;return currentModel({seed:"EVIDENCE",when:"1201-09-30 14:20:00"})}
function chip(label,kind){return '<span class="advisor-status-chip '+(kind||"")+'">'+esc(label)+'</span>'}
function cardHead(titleText,label){return '<div class="advisor-status-card-head"><strong>'+esc(titleText)+'</strong><span>'+esc(label)+'</span></div>'}
function meters(rows){
  if(!rows?.length)return '<div class="advisor-status-empty">No current need/condition values are available.</div>';
  return '<div class="advisor-status-meters">'+rows.map(r=>'<div class="advisor-status-meter" data-alert="'+String(r.value>=60&&r.value<80)+'" data-danger="'+String(r.value>=80)+'"><label>'+esc(r.label)+'</label><span class="advisor-status-meter-track"><i class="advisor-status-meter-fill" style="width:'+pct(r.value)+'%"></i></span><b>'+pct(r.value)+'</b></div>').join("")+'</div>';
}
function lines(rows,emptyText){
  if(!rows?.length)return '<div class="advisor-status-empty">'+esc(emptyText)+'</div>';
  return '<div class="advisor-status-lines">'+rows.map(r=>'<div class="advisor-status-line"><strong>'+esc(r.label||"State")+'</strong><span>'+esc(r.detail||r.status||((r.priority!=null)?("P"+r.priority):""))+'</span></div>').join("")+'</div>';
}
function markup(modelValue){
  const m=modelValue||state.lastModel||evidenceModel("healthy"),identity=m.identity.value,needs=m.needs.value,goals=m.goals.value,inventory=m.inventory.value,health=m.health.value,authority=m.authority.value,guidance=m.guidance.value,statusContext=m.status.value||null;
  const open=m.mode!=="runtime"?" open":"";
  const subtitle=authority?authority.role:(m.authority.available?"Role available":"Role unavailable");
  const dominantNeed=Array.isArray(needs)&&needs.length?needs.slice().sort((a,b)=>b.value-a.value||String(a.key).localeCompare(String(b.key)))[0]:null;
  let signalLabel="Grounded",signalKind="";
  if(m.unavailable.length){signalLabel=m.unavailable.length+" unavailable";signalKind="unavailable"}
  else if(health?.injuries?.length||Number(health?.fatigue)>=80){signalLabel=(health?.injuries?.length?"Injury · ":"")+"Fatigue "+pct(health?.fatigue);signalKind="alert"}
  else if(dominantNeed&&dominantNeed.value>=60){signalLabel=dominantNeed.label+" "+pct(dominantNeed.value);signalKind="alert"}
  else if(authority&&Number(authority.rankTier)>=2){signalLabel="Rank "+authority.rankTier;signalKind=""}
  const traitHtml=identity?.traits?.length?'<div class="advisor-status-traits">'+identity.traits.slice(0,MAX_TRAITS).map(t=>'<span class="advisor-status-trait">'+esc(t.label)+' '+esc(t.value)+'</span>').join("")+'</div>':"";
  const healthRows=health?[{label:"Condition",detail:health.condition+"%"},{label:"Fatigue",detail:health.fatigue+"%"},...(health.injuries||[]).map(x=>({label:x,detail:"constraint"}))]:null;
  const authorityRows=authority?[{label:authority.role,detail:"rank "+authority.rankTier},...(authority.scopes||[]).slice(0,MAX_SCOPES).map(x=>({label:title(x),detail:"scope"}))]:null;
  const commitmentRows=statusContext?[...(statusContext.duties||[]).map(x=>({label:x.label,detail:(x.state||"standing")+" · "+(x.detail||x.source||"")})),...(statusContext.commitments||[]).map(x=>({label:x.label,detail:(x.state||"active")+" · "+(x.detail||x.source||"")}))].slice(0,MAX_COMMITMENTS):null;
  const advancementRows=[];
  if(statusContext?.eligibility)advancementRows.push({label:statusContext.eligibility.targetRole,detail:statusContext.eligibility.status+(statusContext.eligibility.reason?" · "+statusContext.eligibility.reason:"")});
  if(statusContext?.eligibility?.blockers?.length)advancementRows.push({label:"Blocker",detail:statusContext.eligibility.blockers[0]});
  if(statusContext?.advancement)advancementRows.push({label:"Selection",detail:statusContext.advancement.status+(statusContext.advancement.selected?" · "+statusContext.advancement.selected:"")});
  if(statusContext?.opportunities?.length)advancementRows.push({label:statusContext.opportunities[0].label,detail:statusContext.opportunities[0].state+" · "+statusContext.opportunities[0].detail});
  if(statusContext?.outcomes?.length)advancementRows.push({label:statusContext.outcomes[0].label,detail:statusContext.outcomes[0].state+" · "+statusContext.outcomes[0].detail});
  const commitmentEmpty=statusContext?.availability?.commitments===false&&statusContext?.availability?.duties===false?"Commitment sources unavailable.":"No active grounded service, oath, duty, or obligation.";
  const advancementEmpty=statusContext?.availability?.eligibility===false&&statusContext?.availability?.opportunities===false&&statusContext?.availability?.advancement===false?"Advancement sources unavailable; no eligibility is inferred.":"No grounded advancement opportunity or recent outcome is available.";
  const guidanceRows=guidance?.map(x=>({label:x.label,detail:(x.stance||"advice")+" · P"+x.priority}));
  return '<details class="advisor-status-readout" data-status-mode="'+esc(m.mode)+'"'+open+'>'+
    '<summary><span class="advisor-status-summary-copy"><small>PROTAGONIST READOUT</small><strong>'+esc(identity?.name||"Current state")+' · '+esc(subtitle)+'</strong></span><span class="advisor-status-summary-meta">'+chip("Current","")+chip(signalLabel,signalKind)+'</span></summary>'+
    '<div class="advisor-status-body">'+
      '<section class="advisor-status-identity"><div><h3>'+esc(identity?.name||"Identity unavailable")+'</h3><p>'+esc(identity?.subtitle||"No identity snapshot supplied")+'</p></div>'+traitHtml+'</section>'+
      '<div class="advisor-status-grid">'+
        '<section class="advisor-status-card">'+cardHead("Needs / pressure","Authoritative")+meters(needs)+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Health","Authoritative")+lines(healthRows,"Health state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Goals","Authoritative")+lines(goals,"Goal state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Inventory","Authoritative")+lines(inventory,"Inventory state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Role / authority","Authoritative")+lines(authorityRows,"Rank and authority unavailable.")+'</section>'+
        '<section class="advisor-status-card" data-status-section="commitments">'+cardHead("Duties / commitments",statusContext?"Grounded":"Unavailable")+lines(commitmentRows,commitmentEmpty)+'</section>'+
        '<section class="advisor-status-card" data-status-section="advancement">'+cardHead("Advancement / patronage",statusContext?"Grounded":"Unavailable")+lines(advancementRows,advancementEmpty)+'</section>'+
        '<section class="advisor-status-card" data-kind="'+(m.guidance.available?"advisory":"unavailable")+'">'+cardHead("Long-term guidance",m.guidance.available?"Advisory":"Unavailable")+lines(guidanceRows,"No guidance snapshot available.")+(m.guidance.available?'<p class="advisor-status-note advisory">Guidance can inform evaluation; it never grants authority or forces an action.</p>':"")+'</section>'+
      '</div>'+
      '<footer class="advisor-status-foot"><span>'+esc(m.when||"Fantasy time unavailable")+'</span><span>Read-only · event-driven · bounded</span></footer>'+
    '</div></details>';
}
function snapshot(){const m=state.lastModel;return freeze({version:VERSION,evidenceMode:state.evidenceMode,modelBuilds:state.modelBuilds,runtimeBuilds:state.runtimeBuilds,evidenceBuilds:state.evidenceBuilds,lastMode:m?.mode||null,unavailable:m?.unavailable||freeze([]),readTelemetry:state.lastReadTelemetry||freeze({readCount:0,maxReadCount:14,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false}),authority:m?.authorityFlags||freeze({eventDriven:true,directWorldMutation:false,directExecution:false,wholeWorldScan:false,perFrameRender:false})})}

try{
  const p=typeof URLSearchParams!=="undefined"&&root.location?.search?new URLSearchParams(root.location.search):null;
  const requested=p?.get?.("advisorStatusEvidence");if(EVIDENCE_MODES.includes(requested))state.evidenceMode=requested;
}catch(_){}

return freeze({VERSION,ADVANCEMENT_READOUT_VERSION,EVIDENCE_MODES,MAX_GOALS,MAX_ITEMS,MAX_GUIDANCE,MAX_SCOPES,MAX_COMMITMENTS,MAX_OUTCOMES,MAX_BLOCKERS,evidenceModel,runtimeModel,currentModel,setEvidenceMode,markup,snapshot});
});