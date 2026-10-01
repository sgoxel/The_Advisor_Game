(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistAdvancementGoal=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-advancement-goal-v1";
const MAX_OPPORTUNITIES=12;
const MAX_GOALS=8;
const MAX_REASONS=12;
const MAX_RELATIONSHIPS=8;
const MAX_RESULT_BYTES=49152;
const DECISIONS=Object.freeze(["pursue","defer","reject","maintain-current-role"]);
const KIND_WEIGHTS=Object.freeze({
  "promotion":Object.freeze({base:62,ambition:16,resolve:10,curiosity:3,caution:-10,trust:10,respect:10,loyalty:4,suspicion:-10,fear:-8,resentment:-6,goal:12,authority:10,standing:12,economy:6,health:-16,needs:-14,obligations:-10,employment:-4}),
  "appointment":Object.freeze({base:64,ambition:14,resolve:12,curiosity:4,caution:-10,trust:12,respect:12,loyalty:4,suspicion:-10,fear:-8,resentment:-6,goal:12,authority:14,standing:10,economy:5,health:-14,needs:-12,obligations:-10,employment:-4}),
  "patronage":Object.freeze({base:58,ambition:10,resolve:6,curiosity:4,caution:-6,trust:16,respect:14,loyalty:10,suspicion:-10,fear:-6,resentment:-6,goal:14,authority:4,standing:6,economy:4,health:-8,needs:-8,obligations:-6,employment:-2}),
  "training":Object.freeze({base:52,ambition:8,resolve:8,curiosity:14,caution:-8,trust:8,respect:8,loyalty:2,suspicion:-6,fear:-4,resentment:-4,goal:12,authority:4,standing:4,economy:3,health:-4,needs:-6,obligations:-4,employment:-2}),
  "service":Object.freeze({base:48,ambition:6,resolve:8,curiosity:2,caution:-4,trust:8,respect:8,loyalty:14,suspicion:-6,fear:-4,resentment:-6,goal:10,authority:8,standing:6,economy:3,health:-6,needs:-8,obligations:-12,employment:-6}),
  "career":Object.freeze({base:56,ambition:12,resolve:8,curiosity:8,caution:-8,trust:8,respect:8,loyalty:4,suspicion:-8,fear:-6,resentment:-4,goal:14,authority:8,standing:8,economy:10,health:-8,needs:-10,obligations:-8,employment:-8}),
  "other":Object.freeze({base:46,ambition:6,resolve:6,curiosity:4,caution:-6,trust:6,respect:6,loyalty:4,suspicion:-6,fear:-4,resentment:-4,goal:8,authority:4,standing:4,economy:2,health:-6,needs:-6,obligations:-6,employment:-2})
});
const telemetryState={evaluations:0,liveBuilds:0,pursues:0,defers:0,rejects:0,maintains:0,invalid:0,socialReads:0,opportunityReads:0};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function parts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function secondIndex(value){const p=parts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null}
function clamp01(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback}
function clamp100(value,fallback=50){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):fallback}
function score01(value,max=100){const n=Number(value);if(!Number.isFinite(n))return null;if(n>=0&&n<=1)return n;return Math.max(0,Math.min(1,n/max))}
function average(values){const list=(Array.isArray(values)?values:[]).filter(v=>Number.isFinite(Number(v)));if(!list.length)return null;return list.reduce((sum,v)=>sum+Number(v),0)/list.length}
function root(){return typeof window!=="undefined"?window:globalThis}
function requiredSeed(value){const seed=clean(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist"}
function protagonistId(seed,key){try{return root().ProtagonistProfile?.derive?.(seed,key)?.protagonistId||("PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1"))}catch(_){return"PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1")}}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function safeList(fn){try{return Array.isArray(fn?.())?fn():null}catch(_){return null}}
function safeCall(fn,...args){try{return fn?.(...args)||null}catch(_){return null}}
function normalizeTraits(value){
  const raw=plain(value)&&plain(value.traits)?value.traits:plain(value)&&plain(value.personality?.traits)?value.personality.traits:plain(value)?value:{};
  const trait=v=>score01(raw[v],100);
  return freeze({
    resolve:trait("resolve")??0.5,
    empathy:trait("empathy")??0.5,
    curiosity:trait("curiosity")??0.5,
    caution:trait("caution")??0.5,
    ambition:trait("ambition")??0.5,
    sociability:trait("sociability")??0.5
  });
}
function normalizeProfile(value){
  if(!plain(value))return freeze({traits:freeze({resolve:0.5,empathy:0.5,curiosity:0.5,caution:0.5,ambition:0.5,sociability:0.5}),fixedBaseline:false});
  return freeze({traits:normalizeTraits(value),fixedBaseline:value.fixedBaseline===true});
}
function normalizeNeedPressure(value){
  const raw=plain(value)&&plain(value.pressureMilli)?value.pressureMilli:plain(value)&&plain(value.pressures)?value.pressures:plain(value)?value:{};
  const read=key=>score01(raw[key],100000)??score01(raw[key],100);
  return freeze({hunger:read("hunger")??0,fatigue:read("fatigue")??0,safety:read("safety")??0,social:read("social")??0});
}
function normalizeHealth(value){
  if(!plain(value))return freeze({condition:0.5,fatigue:0.25});
  const condition=score01(value.conditionMilli!=null?value.conditionMilli:value.condition,100000)??score01(value.conditionScore,10)??0.5;
  const fatigue=score01(value.fatigueMilli!=null?value.fatigueMilli:value.fatigue,100000)??0.25;
  return freeze({condition,fatigue});
}
function normalizeGoals(value){
  const rows=Array.isArray(value?.records)?value.records:Array.isArray(value?.goals)?value.goals:Array.isArray(value)?value:[],out=[];
  for(const row of rows.slice(0,MAX_GOALS)){
    const id=cleanId(row?.id||row?.goalId||"",160);if(!id)continue;
    const priority=clamp100(row?.priority,50);
    out.push(freeze({id,priority,topic:clean(row?.topic||row?.title||row?.goal||"",120),status:cleanId(row?.status||"active",40).toLowerCase()}));
  }
  return freeze(out.filter(row=>row.status==="active"));
}
function normalizeAuthority(value){
  if(!plain(value))return freeze({available:false,roleId:null,rankTier:null,rankLabel:null,scopes:freeze([])});
  const current=plain(value.currentRole)?value.currentRole:value;
  const scopes=Array.isArray(current.scopes)?current.scopes.slice(0,16).map(x=>cleanId(x,120)).filter(Boolean):[];
  const rankTier=current.rankTier!=null?Number(current.rankTier):value.rankTier!=null?Number(value.rankTier):null;
  return freeze({available:true,roleId:cleanId(current.roleId||value.roleId||"",80)||null,rankTier:Number.isFinite(rankTier)?rankTier:null,rankLabel:cleanId(current.rankLabel||value.rankLabel||"",80)||null,scopes:freeze(scopes)});
}
function normalizeStanding(value){
  if(!plain(value))return freeze({available:false,score:null,rankTier:null,domains:freeze({})});
  const domains=plain(value.domains)?value.domains:plain(value.foundation)?value.foundation:{},scores=[];
  for(const v of Object.values(domains))if(Number.isFinite(Number(v?.score)))scores.push(Number(v.score));else if(Number.isFinite(Number(v)))scores.push(Number(v));
  const score=scores.length?average(scores):null;
  const rankTier=Number.isFinite(Number(value.rankTier))?Number(value.rankTier):null;
  return freeze({available:true,score:score==null?null:Number(score.toFixed(4)),rankTier,domains:freeze(clone(domains))});
}
function normalizeEmployment(value){
  if(!plain(value))return freeze({available:false,status:"none",contract:null});
  const contract=plain(value.contract)?value.contract:null;
  return freeze({available:true,status:cleanId(value.status||"none",24).toLowerCase()||"none",contract:contract?freeze(clone(contract)):null});
}
function normalizeWealth(value){
  if(!plain(value))return freeze({available:false,balanceCopper:null,reserveCopper:null});
  const balance=Number.isFinite(Number(value.balanceCopper))?Math.max(0,Math.floor(Number(value.balanceCopper))):Number.isFinite(Number(value.balance))?Math.max(0,Math.floor(Number(value.balance))):null;
  const reserve=Number.isFinite(Number(value.reserveCopper))?Math.max(0,Math.floor(Number(value.reserveCopper))):null;
  return freeze({available:true,balanceCopper:balance,reserveCopper:reserve});
}
function normalizeObligations(value){
  const rows=Array.isArray(value?.obligations)?value.obligations:Array.isArray(value)?value:[],out=[];
  for(const row of rows.slice(0,8)){
    const kind=cleanId(row?.kind||row?.type||"",80).toLowerCase();if(!kind)continue;
    const state=cleanId(row?.state||"standing",32).toLowerCase()||"standing";
    out.push(freeze({kind,state,priority:cleanId(row?.priority||"",24).toLowerCase()||null,dueAt:clean(row?.dueAt||row?.nextDueAt||"",32)||null,obligationId:cleanId(row?.obligationId||row?.id||"",160)||null}));
  }
  const dueCount=out.filter(row=>["due","overdue","payment-pending"].includes(row.state)).length;
  return freeze({available:true,rows:freeze(out),dueCount});
}
function normalizeRelationship(value){
  const raw=plain(value?.values)?value.values:plain(value)&&plain(value.relationship)?value.relationship.values:plain(value)?value:{};
  return freeze({
    trust:clamp01(raw.trust,0.5),
    respect:clamp01(raw.respect,0.5),
    suspicion:clamp01(raw.suspicion,0.25),
    fear:clamp01(raw.fear,0.1),
    loyalty:clamp01(raw.loyalty,0.35),
    resentment:clamp01(raw.resentment,0.1)
  });
}
function normalizePrerequisites(value){
  const raw=plain(value)?value:{},blockers=Array.isArray(raw.blockers)?raw.blockers:[],list=[];
  for(const blocker of blockers.slice(0,MAX_REASONS)){const id=cleanId(blocker,96);if(id&&!list.includes(id))list.push(id)}
  return freeze({satisfied:raw.satisfied!==false,blockers:freeze(list),notes:clean(raw.notes||"",160)||null});
}
function normalizeOpportunity(value,index){
  const raw=plain(value)?value:{},id=cleanId(raw.opportunityId||raw.id||raw.candidateId||("ADV-"+index),160),kindRaw=cleanId(raw.kind||raw.type||raw.intent||"",48).toLowerCase();
  const kind=KIND_WEIGHTS[kindRaw]?kindRaw:(raw.targetRoleId||raw.targetRankTier!=null?"promotion":raw.targetProfessionId?"career":raw.sourceNpcId||raw.sourceNpcRef?"patronage":"other");
  const sourceNpcRef=plain(raw.sourceNpcRef)?freeze({kind:cleanId(raw.sourceNpcRef.kind||"resident",40).toLowerCase()||"resident",id:cleanId(raw.sourceNpcRef.id||raw.sourceNpcRef.refId||"",160)||null}):null;
  const sourceNpcId=cleanId(raw.sourceNpcId||raw.sponsorId||raw.counterpartId||sourceNpcRef?.id||"",160)||null;
  const proposal=raw.proposal&&plain(raw.proposal)?freeze(clone(raw.proposal)):null;
  const relationship=normalizeRelationship(raw.social||raw.relationship||raw.relationships||raw.relationshipSummary||raw.socialContext||raw);
  const prerequisites=normalizePrerequisites(raw.prerequisites||raw.requirements);
  const goalLinks=[];for(const g of Array.isArray(raw.goalLinks)?raw.goalLinks:Array.isArray(raw.goals)?raw.goals:[]){const goalId=cleanId(g,160);if(goalId&&!goalLinks.includes(goalId)&&goalLinks.length<MAX_GOALS)goalLinks.push(goalId)}
  const requiredScopes=[];for(const s of Array.isArray(raw.requiredAuthorityScopes)?raw.requiredAuthorityScopes:Array.isArray(raw.requiredScopes)?raw.requiredScopes:[]){const scope=cleanId(s,120);if(scope&&!requiredScopes.includes(scope)&&requiredScopes.length<MAX_RELATIONSHIPS)requiredScopes.push(scope)}
  const requiredObligations=[];for(const o of Array.isArray(raw.requiredObligationIds)?raw.requiredObligationIds:Array.isArray(raw.obligationIds)?raw.obligationIds:[]){const obligation=cleanId(o,160);if(obligation&&!requiredObligations.includes(obligation)&&requiredObligations.length<MAX_RELATIONSHIPS)requiredObligations.push(obligation)}
  const opensAt=clean(raw.opensAt||raw.availableFrom||raw.validFrom||"",32)||null,closesAt=clean(raw.expiresAt||raw.closesAt||raw.validUntil||"",32)||null;
  const targetRankTier=Number.isFinite(Number(raw.targetRankTier))?Number(raw.targetRankTier):null;
  const costCopper=Number.isFinite(Number(raw.costCopper))?Math.max(0,Math.floor(Number(raw.costCopper))):null;
  const obligationCostCopper=Number.isFinite(Number(raw.obligationCostCopper))?Math.max(0,Math.floor(Number(raw.obligationCostCopper))):null;
  const importance=clamp100(raw.priority!=null?raw.priority:raw.importance,50);
  const label=clean(raw.label||raw.name||raw.title||kind,120);
  const targetRoleId=cleanId(raw.targetRoleId||raw.roleId||raw.promotionRoleId||"",80)||null;
  const targetProfessionId=cleanId(raw.targetProfessionId||raw.professionId||"",80)||null;
  return freeze({
    opportunityId:id,kind,label,available:raw.available!==false,grounded:raw.grounded!==false,priority:importance,
    sourceNpcRef,sourceNpcId,targetRoleId,targetProfessionId,targetRankTier,requiredAuthorityScopes:freeze(requiredScopes),
    requiredObligationIds:freeze(requiredObligations),goalLinks:freeze(goalLinks),relationship,prerequisites,
    opensAt,closesAt,costCopper,obligationCostCopper,
    proposal:proposal||null,proposalRequired:raw.proposalRequired!==false,reason:clean(raw.reason||"",160)||null
  });
}
function buildProposal(seed,when,opportunity){
  if(opportunity.proposal)return opportunity.proposal;
  const sourceId=opportunity.sourceNpcRef?.id||opportunity.sourceNpcId||opportunity.targetProfessionId||opportunity.targetRoleId||null;
  const topic=clean(opportunity.label||opportunity.kind||opportunity.targetRoleId||opportunity.targetProfessionId||"advancement",160);
  const personId=sourceId&&sourceId!==opportunity.targetProfessionId&&sourceId!==opportunity.targetRoleId?sourceId:null;
  const proposal=personId?{
    commandId:"advisor.propose_interaction",
    parameters:{personId,topic},
    source:"protagonist-advancement-goal"
  }:{
    commandId:"advisor.propose_advice",
    parameters:{topic},
    source:"protagonist-advancement-goal"
  };
  return freeze({proposalId:"ADVPROP-"+hashText(stable({seed,when,opportunityId:opportunity.opportunityId,proposal})),commandId:proposal.commandId,parameters:freeze(clone(proposal.parameters)),source:proposal.source});
}
function goalAlignment(opportunity,goals){
  if(!opportunity.goalLinks.length||!goals.length)return {support:0,matched:[]};
  const matched=[];let support=0;
  for(const goal of goals){if(opportunity.goalLinks.includes(goal.id)){matched.push(goal.id);support+=goal.priority}}
  return {support,matched};
}
function relationshipSignal(relationship){
  const trust=clamp01(relationship?.trust,0.5),respect=clamp01(relationship?.respect,0.5),suspicion=clamp01(relationship?.suspicion,0.25),fear=clamp01(relationship?.fear,0.1),loyalty=clamp01(relationship?.loyalty,0.35),resentment=clamp01(relationship?.resentment,0.1);
  const confidence=(trust+respect+loyalty)/3;
  const caution=(suspicion+fear+resentment)/3;
  return freeze({trust,respect,suspicion,fear,loyalty,resentment,confidence, caution,score:(confidence-caution)*100});
}
function pressureScore(needs){
  const hunger=clamp01(needs?.hunger,0),fatigue=clamp01(needs?.fatigue,0),safety=clamp01(needs?.safety,0),social=clamp01(needs?.social,0);
  return freeze({hunger,fatigue,safety,social,pressure:(hunger*.38+fatigue*.28+safety*.18+social*.16)*100});
}
function healthScore(health){
  const condition=clamp01(health?.condition,0.5),fatigue=clamp01(health?.fatigue,0.25);
  return freeze({condition,fatigue,capacity:Math.max(0,Math.min(100,condition*100-fatigue*30))});
}
function rankFit(opportunity,authority,standing){
  const currentRank=Number.isFinite(Number(authority?.rankTier))?Number(authority.rankTier):Number.isFinite(Number(standing?.rankTier))?Number(standing.rankTier):0;
  const targetRank=Number.isFinite(Number(opportunity.targetRankTier))?Number(opportunity.targetRankTier):currentRank;
  const gap=targetRank-currentRank;
  return freeze({currentRank,targetRank,gap,fit:gap<=0?8:gap===1?14:gap===2?8:gap===3?2:-12});
}
function obligationPressure(obligations){
  const dueCount=Number(obligations?.dueCount||0),rows=Array.isArray(obligations?.rows)?obligations.rows:[],activePenalty=rows.some(row=>row.state==="payment-pending")?8:0;
  return freeze({dueCount,pressure:Math.min(100,dueCount*18+activePenalty)});
}
function economicFit(opportunity,wealth,employment,obligations,healthPressure){
  const balance=Number.isFinite(Number(wealth?.balanceCopper))?Number(wealth.balanceCopper):null;
  const reserve=Number.isFinite(Number(wealth?.reserveCopper))?Number(wealth.reserveCopper):0;
  const cost=Number.isFinite(Number(opportunity.costCopper))?Number(opportunity.costCopper):0;
  const obligationCost=Number.isFinite(Number(opportunity.obligationCostCopper))?Number(opportunity.obligationCostCopper):0;
  const available=balance==null?true:balance>=cost+obligationCost;
  const stress=(!available?24:0)+(balance!=null&&reserve&&balance<reserve?10:0)+(employment?.status==="active"&&obligations.dueCount>0?8:0)+(healthPressure>65?10:0);
  return freeze({balance,available,cost,obligationCost,stress});
}
function maintainCandidate(context){
  const {traits,needs,health,obligations,authority}=context;
  const rankTier=Number.isFinite(Number(authority?.rankTier))?Number(authority.rankTier):0;
  const pressure=pressureScore(needs).pressure;
  const healthCap=healthScore(health).capacity;
  const obligation=obligationPressure(obligations).pressure;
  const ambition=traits.ambition*100,caution=traits.caution*100,resolve=traits.resolve*100;
  const stability=52+(caution*.18)+(healthCap*.12)+(obligation*.14)+(pressure*.10)-(ambition*.12)-(resolve*.04)-(rankTier*2);
  return freeze({
    opportunityId:"maintain-current-role",
    kind:"maintain-current-role",
    label:"Maintain current role",
    available:true,
    grounded:true,
    priority:50,
    score:Number(Math.max(0,Math.min(100,stability)).toFixed(4)),
    blockers:freeze([]),
    hardBlockers:freeze([]),
    softBlockers:freeze([]),
    reason:pressure>=60||obligation>=30||healthCap<55?"stability-preserved":"current-role-maintained",
    proposal:null,
    selected:false,
    maintain:true
  });
}
function classifyBlockers(opportunity,context,fit,pressure,healthCap,economic){
  const hard=[];const soft=[];
  if(!opportunity.available)hard.push("opportunity-unavailable");
  if(!opportunity.grounded)hard.push("opportunity-not-grounded");
  if(!opportunity.prerequisites.satisfied)for(const blocker of opportunity.prerequisites.blockers.length?opportunity.prerequisites.blockers:["prerequisite-unsatisfied"]){hard.push(blocker);}
  if(opportunity.opensAt&&validWhen(opportunity.opensAt)&&secondIndex(opportunity.opensAt)>secondIndex(context.when))soft.push("not-yet-open");
  if(opportunity.closesAt&&validWhen(opportunity.closesAt)&&secondIndex(opportunity.closesAt)<secondIndex(context.when))hard.push("opportunity-expired");
  if(opportunity.requiredAuthorityScopes.some(scope=>!context.authority.scopes.includes(scope)))hard.push("authority-scope-missing");
  if(opportunity.requiredObligationIds.length&&(!context.obligations.rows.length||!opportunity.requiredObligationIds.every(id=>context.obligations.rows.some(row=>row.obligationId===id))))soft.push("obligation-mismatch");
  if(fit.gap>2)hard.push("rank-gap-too-large");
  if(pressure.pressure>=70)soft.push("need-pressure-high");
  if(healthCap<45)soft.push("health-too-low");
  if(!economic.available)soft.push("insufficient-funds");
  return freeze({hard:freeze([...new Set(hard)].slice(0,MAX_REASONS)),soft:freeze([...new Set(soft)].slice(0,MAX_REASONS))});
}
function scoreOpportunity(opportunity,context){
  const kindWeights=KIND_WEIGHTS[opportunity.kind]||KIND_WEIGHTS.other;
  const trait=context.traits,pressure=context.pressures,health=context.health,economic=context.economic,obligations=context.obligationPressure,fit=context.rankFit,relationship=relationshipSignal(opportunity.relationship),alignment=goalAlignment(opportunity,context.goals);
  let score=kindWeights.base;
  score+=trait.ambition*kindWeights.ambition;
  score+=trait.resolve*kindWeights.resolve;
  score+=trait.curiosity*kindWeights.curiosity;
  score+=trait.caution*kindWeights.caution;
  score+=relationship.trust*kindWeights.trust;
  score+=relationship.respect*kindWeights.respect;
  score+=relationship.loyalty*kindWeights.loyalty;
  score+=relationship.suspicion*kindWeights.suspicion;
  score+=relationship.fear*kindWeights.fear;
  score+=relationship.resentment*kindWeights.resentment;
  score+=alignment.support*0.12*kindWeights.goal;
  score+=fit.fit*kindWeights.standing;
  score+=fit.gap<=0?kindWeights.authority:kindWeights.authority*0.55;
  score+=economic.available?kindWeights.economy:kindWeights.economy-18;
  score+=health.capacity*kindWeights.health/100;
  score+=pressure.pressure*kindWeights.needs/100;
  score+=obligations.pressure*kindWeights.obligations/100;
  score+=context.employment.status==="active"?kindWeights.employment:0;
  score+=opportunity.priority*0.18;
  score+=opportunity.goalLinks.length?Math.min(12,alignment.support*0.06):0;
  if(opportunity.targetRoleId&&context.authority.roleId&&opportunity.targetRoleId===context.authority.roleId)score-=18;
  if(opportunity.targetProfessionId&&context.employment.contract?.professionId&&opportunity.targetProfessionId===context.employment.contract.professionId)score-=8;
  if(opportunity.costCopper!=null&&economic.balance!=null&&economic.balance<opportunity.costCopper)score-=24;
  if(opportunity.obligationCostCopper!=null&&economic.balance!=null&&economic.balance<opportunity.obligationCostCopper)score-=16;
  if(opportunity.kind==="appointment"&&fit.gap<=0)score-=22;
  if(opportunity.kind==="promotion"&&fit.gap<=0)score-=14;
  if(opportunity.kind==="career"&&trait.curiosity>0.65)score+=4;
  const tie=parseInt(hashText(stable({seed:context.seed,when:context.when,opportunityId:opportunity.opportunityId,kind:opportunity.kind})),16)>>>0;
  return freeze({score:Number(Math.max(0,Math.min(100,score)).toFixed(4)),tie,relationship,alignment,fit,economic,hard:freeze([]),soft:freeze([])});
}
function normalizeContext(configValue){
  const config=plain(configValue)?configValue:{},seed=clean(config.seed,160),when=clean(config.when,32),identity=identityKey(config.identityKey||config.identity||"protagonist"),profile=normalizeProfile(config.profile),needs=normalizeNeedPressure(config.needs),health=normalizeHealth(config.health),goals=normalizeGoals(config.goals),authority=normalizeAuthority(config.authority),standing=normalizeStanding(config.standing),employment=normalizeEmployment(config.employment),wealth=normalizeWealth(config.wealth),obligations=normalizeObligations(config.obligations||config.statusObligations),opportunitiesRaw=Array.isArray(config.opportunities)?config.opportunities:Array.isArray(config.candidates)?config.candidates:[],opportunities=[];
  for(let i=0;i<opportunitiesRaw.length&&i<MAX_OPPORTUNITIES;i++)opportunities.push(normalizeOpportunity(opportunitiesRaw[i],i));
  return freeze({seed,when,identity,profile,traits:profile.traits,needs,health,goals,authority,standing,employment,wealth,obligations,opportunities:freeze(opportunities),relationships:plain(config.relationships)?freeze(clone(config.relationships)):null});
}
function evaluate(configValue){
  telemetryState.evaluations++;
  const context=normalizeContext(configValue);
  if(!context.seed)return freeze({version:VERSION,ok:false,reason:"campaign-seed-required",status:"invalid",decisionId:null,selectedOpportunity:null,selectedProposal:null,evaluated:freeze([]),bounded:true,requiresRuntime:false});
  if(!validWhen(context.when))return freeze({version:VERSION,ok:false,reason:"fantasy-time-required",status:"invalid",decisionId:null,selectedOpportunity:null,selectedProposal:null,evaluated:freeze([]),bounded:true,requiresRuntime:false});
  if(context.opportunities.length>MAX_OPPORTUNITIES)return freeze({version:VERSION,ok:false,reason:"opportunity-limit-exceeded",status:"invalid",decisionId:null,selectedOpportunity:null,selectedProposal:null,evaluated:freeze([]),bounded:true,requiresRuntime:false,maxOpportunities:MAX_OPPORTUNITIES});
  const pressures=pressureScore(context.needs),health=healthScore(context.health),obligationPressureRow=obligationPressure(context.obligations),maintain=maintainCandidate({seed:context.seed,when:context.when,traits:context.traits,needs:context.needs,health:context.health,obligations:context.obligations,authority:context.authority});
  const evaluated=[],valid=[];
  for(const opportunity of context.opportunities){
    const scoring=scoreOpportunity(opportunity,{...context,pressures,health,obligationPressure:obligationPressureRow,rankFit:rankFit(opportunity,context.authority,context.standing),economic:economicFit(opportunity,context.wealth,context.employment,context.obligations,health.capacity)});
    const blockers=classifyBlockers(opportunity,{...context,when:context.when},scoring.fit,pressures,health.capacity,scoring.economic);
    const hard=blockers.hard.slice(0,MAX_REASONS),soft=blockers.soft.slice(0,MAX_REASONS);
    let decision="reject",reason="opportunity-blocked";
    if(hard.length===0&&soft.length===0&&scoring.score>=70){decision="pursue";reason="opportunity-strong";}
    else if(hard.length===0&&(soft.length>0||scoring.score>=45)){decision="defer";reason=soft.length?"opportunity-not-now":"opportunity-possible";}
    else if(hard.length===0&&scoring.score<45){decision="reject";reason="opportunity-weak";}
    else if(hard.length>0){decision="reject";reason=hard[0];}
    const row=freeze({
      opportunityId:opportunity.opportunityId,kind:opportunity.kind,label:opportunity.label,score:scoring.score,decision,reason,
      hardBlockers:freeze(hard),softBlockers:freeze(soft),goalSupport:scoring.alignment.support,matchedGoalIds:freeze(scoring.alignment.matched),
      rankFit:scoring.fit,relationship:scoring.relationship,economic:scoring.economic,proposalId:opportunity.proposal?.proposalId||null
    });
    evaluated.push(row);
    if(decision!=="reject")valid.push({opportunity,scoring,decision,reason,hard,soft,row});
  }
  const bestValidScore=Math.max(0,...valid.map(item=>Number.isFinite(item.row.score)?item.row.score:0));
  const rankedRejected=[...evaluated].sort((a,b)=>(Number.isFinite(b.score)?b.score:-1)-(Number.isFinite(a.score)?a.score:-1)||a.opportunityId.localeCompare(b.opportunityId));
  if(!valid.length&&rankedRejected.length){
    const topRejected=rankedRejected[0];
    const selectedOpportunity=freeze({
      opportunityId:topRejected.opportunityId,kind:topRejected.kind,label:topRejected.label,score:Number.isFinite(topRejected.score)?topRejected.score:null,
      reason:topRejected.reason,hardBlockers:topRejected.hardBlockers,softBlockers:topRejected.softBlockers,targetRoleId:null,targetProfessionId:null,targetRankTier:null
    });
    telemetryState.rejects++;
    return freeze({
      version:VERSION,ok:true,seed:context.seed,when:context.when,status:"reject",disposition:"reject",reason:topRejected.reason,
      decisionId:"ADVDEC-"+hashText(stable({seed:context.seed,when:context.when,status:"reject",opportunityId:topRejected.opportunityId,reason:topRejected.reason})),
      selectedOpportunity,selectedProposal:null,selectedOpportunityId:selectedOpportunity.opportunityId,selectedProposalId:null,
      selectedCandidate:freeze({opportunityId:selectedOpportunity.opportunityId,kind:selectedOpportunity.kind,score:selectedOpportunity.score}),
      evaluated:freeze([...evaluated,{opportunityId:maintain.opportunityId,kind:maintain.kind,label:maintain.label,score:maintain.score,decision:"maintain-current-role",reason:maintain.reason,hardBlockers:freeze([]),softBlockers:freeze([]),goalSupport:0,matchedGoalIds:freeze([]),rankFit:freeze({currentRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,targetRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,gap:0,fit:10}),relationship:freeze({trust:0.5,respect:0.5,suspicion:0.25,fear:0.1,loyalty:0.35,resentment:0.1,confidence:0.45,caution:0.15,score:30}),economic:freeze({balance:context.wealth.balanceCopper,available:true,cost:0,obligationCost:0,stress:0}),proposalId:null}]),
      decisionContext:freeze({traits:context.traits,needs:context.needs,health:context.health,goals:context.goals,authority:context.authority,standing:context.standing,employment:context.employment,wealth:context.wealth,obligations:context.obligations,pressure:pressures,healthCapacity:health.capacity,obligationPressure:obligationPressureRow.pressure,opportunityCount:context.opportunities.length,maintainScore:maintain.score}),
      maintain,
      bounds:freeze({maxOpportunities:MAX_OPPORTUNITIES,maxGoals:MAX_GOALS,maxReasons:MAX_REASONS,maxRelationships:MAX_RELATIONSHIPS,maxResultBytes:MAX_RESULT_BYTES}),
      authority:freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded supplied/live authority context",directActionExecution:false,worldMutation:false,simulationValidationBypass:false,fullWorldScan:false,perFrameScan:false,providerAuthority:false}),
      handoff:freeze({boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",proposalOnly:false,requiresRuntimeValidation:false,directActionExecution:false}),
      bounded:true
    });
  }
  const maintainWinner=maintain.score>=bestValidScore;
  let selectedOpportunity=null,selectedProposal=null,status="maintain-current-role",reason=maintain.reason,decisionId="ADVDEC-"+hashText(stable({seed:context.seed,when:context.when,status:"maintain-current-role",maintain:maintain.score}));
  if(!maintainWinner){
    valid.sort((a,b)=>b.row.score-a.row.score||a.scoring.tie-b.scoring.tie||a.opportunity.opportunityId.localeCompare(b.opportunity.opportunityId));
    const top=valid[0]||null;
    if(top){
      selectedOpportunity=freeze({opportunityId:top.opportunity.opportunityId,kind:top.opportunity.kind,label:top.opportunity.label,score:top.row.score,reason:top.reason,hardBlockers:top.hard,softBlockers:top.soft,targetRoleId:top.opportunity.targetRoleId||null,targetProfessionId:top.opportunity.targetProfessionId||null,targetRankTier:top.opportunity.targetRankTier});
      if(top.decision==="pursue"){
        status="pursue";reason=top.reason;selectedProposal=buildProposal(context.seed,context.when,top.opportunity);telemetryState.pursues++;
      }else if(top.decision==="defer"){
        status="defer";reason=top.reason;telemetryState.defers++;
      }else{
        status="reject";reason=top.reason;telemetryState.rejects++;
      }
      decisionId="ADVDEC-"+hashText(stable({seed:context.seed,when:context.when,status,opportunityId:top.opportunity.opportunityId,reason}));
    }else{
      telemetryState.maintains++;
      const result=freeze({
        version:VERSION,ok:true,seed:context.seed,when:context.when,status:"maintain-current-role",disposition:"maintain-current-role",
        reason:maintain.reason,decisionId,selectedOpportunity:null,selectedProposal:null,selectedOpportunityId:null,selectedProposalId:null,
        selectedCandidate:null,evaluated:freeze([...evaluated,{opportunityId:maintain.opportunityId,kind:maintain.kind,label:maintain.label,score:maintain.score,decision:"maintain-current-role",reason:maintain.reason,hardBlockers:freeze([]),softBlockers:freeze([]),goalSupport:0,matchedGoalIds:freeze([]),rankFit:freeze({currentRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,targetRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,gap:0,fit:10}),relationship:freeze({trust:0.5,respect:0.5,suspicion:0.25,fear:0.1,loyalty:0.35,resentment:0.1,confidence:0.45,caution:0.15,score:30}),economic:freeze({balance:context.wealth.balanceCopper,available:true,cost:0,obligationCost:0,stress:0}),proposalId:null}]),maintain:maintain,
        decisionContext:freeze({
          traits:context.traits,needs:context.needs,health:context.health,goals:context.goals,authority:context.authority,standing:context.standing,employment:context.employment,wealth:context.wealth,obligations:context.obligations,
          pressure:pressures,healthCapacity:health.capacity,obligationPressure:obligationPressureRow.pressure,opportunityCount:context.opportunities.length,maintainScore:maintain.score
        }),
        bounds:freeze({maxOpportunities:MAX_OPPORTUNITIES,maxGoals:MAX_GOALS,maxReasons:MAX_REASONS,maxRelationships:MAX_RELATIONSHIPS,maxResultBytes:MAX_RESULT_BYTES}),
        authority:freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded supplied/live authority context",directActionExecution:false,worldMutation:false,simulationValidationBypass:false,fullWorldScan:false,perFrameScan:false,providerAuthority:false})
      });
      return result;
    }
  }else{
    telemetryState.maintains++;
  }
  const decisionContext=freeze({
    traits:context.traits,needs:context.needs,health:context.health,goals:context.goals,authority:context.authority,standing:context.standing,employment:context.employment,wealth:context.wealth,obligations:context.obligations,
    pressure:pressures,healthCapacity:health.capacity,obligationPressure:obligationPressureRow.pressure,opportunityCount:context.opportunities.length,maintainScore:maintain.score
  });
  const result=freeze({
    version:VERSION,ok:true,seed:context.seed,when:context.when,status,disposition:status,reason,decisionId,
    selectedOpportunity,selectedProposal,selectedOpportunityId:selectedOpportunity?.opportunityId||null,selectedProposalId:selectedProposal?.proposalId||null,
    selectedCandidate:selectedOpportunity?freeze({opportunityId:selectedOpportunity.opportunityId,kind:selectedOpportunity.kind,score:selectedOpportunity.score}):null,
    evaluated:freeze([...evaluated,{opportunityId:maintain.opportunityId,kind:maintain.kind,label:maintain.label,score:maintain.score,decision:"maintain-current-role",reason:maintain.reason,hardBlockers:freeze([]),softBlockers:freeze([]),goalSupport:0,matchedGoalIds:freeze([]),rankFit:freeze({currentRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,targetRank:Number.isFinite(Number(context.authority.rankTier))?Number(context.authority.rankTier):0,gap:0,fit:10}),relationship:freeze({trust:0.5,respect:0.5,suspicion:0.25,fear:0.1,loyalty:0.35,resentment:0.1,confidence:0.45,caution:0.15,score:30}),economic:freeze({balance:context.wealth.balanceCopper,available:true,cost:0,obligationCost:0,stress:0}),proposalId:null}]),
    decisionContext,
    maintain,
    bounds:freeze({maxOpportunities:MAX_OPPORTUNITIES,maxGoals:MAX_GOALS,maxReasons:MAX_REASONS,maxRelationships:MAX_RELATIONSHIPS,maxResultBytes:MAX_RESULT_BYTES}),
    authority:freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded supplied/live authority context",directActionExecution:false,worldMutation:false,simulationValidationBypass:false,fullWorldScan:false,perFrameScan:false,providerAuthority:false}),
    handoff:freeze({boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",proposalOnly:Boolean(selectedProposal),requiresRuntimeValidation:Boolean(selectedProposal),directActionExecution:false}),
    bounded:true
  });
  telemetryState[status==="pursue"?"pursues":status==="defer"?"defers":status==="reject"?"rejects":"maintains"]++;
  return result;
}
function gatherLiveOpportunities(seed,when,identity,options){
  if(Array.isArray(options?.opportunities)||Array.isArray(options?.candidates))return Array.isArray(options.opportunities)?options.opportunities.slice(0,MAX_OPPORTUNITIES):options.candidates.slice(0,MAX_OPPORTUNITIES);
  const collected=[];
  try{const list=root().ProtagonistPatronageOpportunities?.list?.(seed,when,{limit:MAX_OPPORTUNITIES},identity);if(Array.isArray(list))collected.push(...list)}catch(_){}
  try{const list=root().ProtagonistProfessionOpportunities?.list?.(seed,when,{openOnly:true,limit:MAX_OPPORTUNITIES},identity);if(Array.isArray(list))collected.push(...list)}catch(_){}
  return collected.slice(0,MAX_OPPORTUNITIES);
}
function fromLive(seedValue,whenValue,optionsValue){
  telemetryState.liveBuilds++;
  const options=plain(optionsValue)?optionsValue:{},seed=clean(seedValue,160),when=clean(whenValue,32),identity=identityKey(options.identityKey||options.identity||"protagonist");
  let profile=null,needs=null,health=null,goals=null,authority=null,standing=null,employment=null,wealth=null,obligations=null,relationships=plain(options.relationships)?options.relationships:null;
  try{profile=options.profile||root().ProtagonistProfile?.summary?.(seed,identity)||root().ProtagonistProfile?.derive?.(seed,identity)||null}catch(_){}
  try{needs=options.needs||root().ProtagonistNeeds?.snapshot?.(seed,identity)||null}catch(_){}
  try{health=options.health||root().ProtagonistHealth?.snapshot?.(seed,identity)||null}catch(_){}
  try{goals=options.goals||root().ProtagonistGoals?.snapshot?.(seed,identity)||root().ProtagonistGoals?.list?.(seed,{limit:MAX_GOALS},identity)||null}catch(_){}
  try{authority=options.authority||root().ProtagonistAuthority?.snapshot?.(seed,identity)||null}catch(_){}
  try{standing=options.standing||root().ProtagonistStanding?.snapshot?.(seed,identity)||null}catch(_){}
  try{employment=options.employment||root().ProtagonistEmployment?.current?.(seed,when,identity)||null}catch(_){}
  try{wealth=options.wealth||root().ProtagonistWealth?.snapshot?.(seed,identity)||null}catch(_){}
  try{obligations=options.obligations||root().ProtagonistStatusObligations?.resolve?.(seed,when,identity)||null}catch(_){}
  const opportunities=gatherLiveOpportunities(seed,when,identity,options).map((opportunity,index)=>{
    const raw=clone(opportunity);
    if(!relationships&&raw?.sourceNpcId&&root().SocialState?.dialogueContext){const social=safeCall(root().SocialState.dialogueContext,seed,raw.sourceNpcId);if(social)raw.social=social;}
    return normalizeOpportunity(raw,index);
  });
  return evaluate({seed,when,identityKey:identity,profile,needs,health,goals,authority,standing,employment,wealth,obligations,relationships,opportunities});
}
function evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const result=plain(resultValue)?resultValue:{},options=plain(optionsValue)?optionsValue:{};
  if(result.ok!==true||result.status!=="pursue"||!result.selectedProposal)return freeze({ok:false,reason:"selected-advancement-proposal-required",config:null});
  return freeze({ok:true,reason:"advancement-proposal-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",executionDisabled:true,config:freeze({seed:clean(result.seed,160),when:clean(result.when,32),snapshot:snapshotValue||null,proposal:result.selectedProposal,decisionContext:decisionContextValue||result.decisionContext,actorId:cleanId(options.actorId||"protagonist",120)||"protagonist",execute:false,advancementDecisionId:result.decisionId})});
}
function runtimeInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const handoff=evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue);
  if(!handoff.ok)return handoff;
  return freeze({ok:true,reason:"advancement-runtime-handoff-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",executionDisabled:true,directActionExecution:false,directRankMutation:false,directRelationshipMutation:false,directWorldMutation:false,evaluatorHandoff:handoff});
}
function snapshot(seedValue,whenValue,optionsValue){return fromLive(seedValue,whenValue,optionsValue)}
function telemetry(){return freeze({...telemetryState,bounded:true,fullWorldScan:false,perFrameScan:false,authority:false})}

root().ProtagonistAdvancementGoal=Object.freeze({
  VERSION,MAX_OPPORTUNITIES,MAX_GOALS,MAX_REASONS,MAX_RELATIONSHIPS,MAX_RESULT_BYTES,DECISIONS,KIND_WEIGHTS,
  evaluate,fromLive,evaluatorInput,runtimeInput,snapshot,telemetry
});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistAdvancementGoal;
return root().ProtagonistAdvancementGoal;
});
