(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistStatusUI=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-status-ui-v1";
const EVIDENCE_MODES=Object.freeze(["healthy","pressure","injured","authority","unavailable"]);
const MAX_GOALS=3,MAX_ITEMS=4,MAX_GUIDANCE=3,MAX_SCOPES=4,MAX_TRAITS=4;
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
function normalizeGuidance(snap){
  const rows=Array.isArray(snap?.records)?snap.records:[];
  return rows.filter(r=>String(r.status||"active")==="active").slice(0,MAX_GUIDANCE).map(r=>freeze({label:cleanText(r.principle||r.topic||"Guidance",130),priority:pct(r.priority,50),stance:cleanId(r.stance||"neutral",30)}));
}
function sourceState(value,kind="authoritative"){return freeze({available:value!=null,kind:value==null?"unavailable":kind,value:value||null})}
function model(base){
  state.modelBuilds++;
  const identity=base.identity||null,needs=base.needs||null,goals=base.goals||null,inventory=base.inventory||null,health=base.health||null,authority=base.authority||null,guidance=base.guidance||null;
  const unavailable=["identity","needs","goals","inventory","health","authority","guidance"].filter(key=>base[key]==null);
  const result=freeze({
    version:VERSION,mode:base.mode||"runtime",when:cleanText(base.when||"",32),
    identity:sourceState(identity),needs:sourceState(needs),goals:sourceState(goals),inventory:sourceState(inventory),health:sourceState(health),authority:sourceState(authority),guidance:sourceState(guidance,"advisory"),
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
  if(mode==="healthy")return model({mode,when,identity,needs:[{key:"hunger",label:"Hunger",value:18},{key:"fatigue",label:"Fatigue",value:12},{key:"safety",label:"Safety",value:8},{key:"social",label:"Social",value:22}],goals:[{id:"GOAL-NORTH",label:"Inspect the north gate",status:"active",priority:74}],inventory,health:{condition:96,fatigue:12,injuries:[]},authority:authorityLow,guidance});
  if(mode==="pressure")return model({mode,when,identity,needs:[{key:"hunger",label:"Hunger",value:84},{key:"fatigue",label:"Fatigue",value:61},{key:"safety",label:"Safety",value:27},{key:"social",label:"Social",value:58}],goals:[{id:"GOAL-PROMISE",label:"Deliver the miller's message",status:"active",priority:91},{id:"GOAL-MEAL",label:"Find food before patrol",status:"active",priority:88}],inventory,health:{condition:78,fatigue:55,injuries:[]},authority:authorityLow,guidance});
  if(mode==="injured")return model({mode,when,identity,needs:[{key:"hunger",label:"Hunger",value:41},{key:"fatigue",label:"Fatigue",value:86},{key:"safety",label:"Safety",value:66},{key:"social",label:"Social",value:31}],goals:[{id:"GOAL-REST",label:"Recover before leaving the village",status:"active",priority:96},{id:"GOAL-GATE",label:"Gate inspection",status:"deferred",priority:72}],inventory,health:{condition:48,fatigue:86,injuries:["Sprained ankle · recovering"]},authority:authorityLow,guidance});
  if(mode==="authority")return model({mode,when,identity:{...identity,subtitle:"Persistent protagonist · entrusted local office"},needs:[{key:"hunger",label:"Hunger",value:26},{key:"fatigue",label:"Fatigue",value:33},{key:"safety",label:"Safety",value:19},{key:"social",label:"Social",value:42}],goals:[{id:"GOAL-LEDGER",label:"Review storehouse allocations",status:"active",priority:82}],inventory,health:{condition:91,fatigue:29,injuries:[]},authority:authorityHigh,guidance:[...guidance,{label:"Use office authority only for duties that genuinely require it.",priority:92,stance:"caution"}]});
  return model({mode,when,identity,needs:[{key:"hunger",label:"Hunger",value:33},{key:"fatigue",label:"Fatigue",value:24},{key:"safety",label:"Safety",value:15},{key:"social",label:"Social",value:28}],goals:null,inventory:null,health:{condition:88,fatigue:24,injuries:[]},authority:null,guidance:null});
}
function runtimeModel(ctx){
  state.runtimeBuilds++;
  const seed=cleanText(ctx?.seed||"",160),identityKey="protagonist",when=cleanText(ctx?.when||"",32);
  let profile=null,needs=null,goals=null,inventory=null,health=null,authority=null,guidance=null;
  try{profile=root.ProtagonistProfile?.derive?.(seed,identityKey)||null}catch(_){}
  try{needs=root.ProtagonistNeeds?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{goals=root.ProtagonistGoals?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{inventory=root.ProtagonistInventory?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{health=root.ProtagonistHealth?.decisionContext?.(seed,identityKey)||root.ProtagonistHealth?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{authority=root.ProtagonistAuthority?.decisionContext?.(seed,identityKey)||root.ProtagonistAuthority?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{guidance=root.ProtagonistGuidance?.snapshot?.(seed,identityKey)||null}catch(_){}
  const identity=profile?{id:cleanId(profile.protagonistId||"protagonist",120),name:cleanText(profile.birthIdentity?.fullName||"Protagonist",120),subtitle:"Persistent protagonist",traits:normalizeTraits(profile)}:null;
  return model({mode:"runtime",when,identity,needs:needs?normalizeNeeds(needs):null,goals:goals?normalizeGoals(goals):null,inventory:inventory?normalizeInventory(inventory):null,health:normalizeHealth(health),authority:normalizeAuthority(authority),guidance:guidance?normalizeGuidance(guidance):null});
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
  const m=modelValue||state.lastModel||evidenceModel("healthy"),identity=m.identity.value,needs=m.needs.value,goals=m.goals.value,inventory=m.inventory.value,health=m.health.value,authority=m.authority.value,guidance=m.guidance.value;
  const open=m.mode!=="runtime"?" open":"";
  const subtitle=authority?authority.role:(m.authority.available?"Role available":"Role unavailable");
  const traitHtml=identity?.traits?.length?'<div class="advisor-status-traits">'+identity.traits.slice(0,MAX_TRAITS).map(t=>'<span class="advisor-status-trait">'+esc(t.label)+' '+esc(t.value)+'</span>').join("")+'</div>':"";
  const healthRows=health?[{label:"Condition",detail:health.condition+"%"},{label:"Fatigue",detail:health.fatigue+"%"},...(health.injuries||[]).map(x=>({label:x,detail:"constraint"}))]:null;
  const authorityRows=authority?[{label:authority.role,detail:"rank "+authority.rankTier},...(authority.scopes||[]).slice(0,MAX_SCOPES).map(x=>({label:title(x),detail:"scope"}))]:null;
  const guidanceRows=guidance?.map(x=>({label:x.label,detail:(x.stance||"advice")+" · P"+x.priority}));
  return '<details class="advisor-status-readout" data-status-mode="'+esc(m.mode)+'"'+open+'>'+
    '<summary><span class="advisor-status-summary-copy"><small>PROTAGONIST READOUT</small><strong>'+esc(identity?.name||"Current state")+' · '+esc(subtitle)+'</strong></span><span class="advisor-status-summary-meta">'+chip("Current","")+chip(m.unavailable.length?m.unavailable.length+" unavailable":"grounded",m.unavailable.length?"unavailable":"")+'</span></summary>'+
    '<div class="advisor-status-body">'+
      '<section class="advisor-status-identity"><div><h3>'+esc(identity?.name||"Identity unavailable")+'</h3><p>'+esc(identity?.subtitle||"No identity snapshot supplied")+'</p></div>'+traitHtml+'</section>'+
      '<div class="advisor-status-grid">'+
        '<section class="advisor-status-card">'+cardHead("Needs / pressure","Authoritative")+meters(needs)+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Health","Authoritative")+lines(healthRows,"Health state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Goals","Authoritative")+lines(goals,"Goal state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Inventory","Authoritative")+lines(inventory,"Inventory state unavailable.")+'</section>'+
        '<section class="advisor-status-card">'+cardHead("Role / authority","Authoritative")+lines(authorityRows,"Rank and authority unavailable.")+'</section>'+
        '<section class="advisor-status-card" data-kind="'+(m.guidance.available?"advisory":"unavailable")+'">'+cardHead("Long-term guidance",m.guidance.available?"Advisory":"Unavailable")+lines(guidanceRows,"No guidance snapshot available.")+(m.guidance.available?'<p class="advisor-status-note advisory">Guidance can inform evaluation; it never grants authority or forces an action.</p>':"")+'</section>'+
      '</div>'+
      '<footer class="advisor-status-foot"><span>'+esc(m.when||"Fantasy time unavailable")+'</span><span>Read-only · event-driven</span></footer>'+
    '</div></details>';
}
function snapshot(){const m=state.lastModel;return freeze({version:VERSION,evidenceMode:state.evidenceMode,modelBuilds:state.modelBuilds,runtimeBuilds:state.runtimeBuilds,evidenceBuilds:state.evidenceBuilds,lastMode:m?.mode||null,unavailable:m?.unavailable||freeze([]),authority:m?.authorityFlags||freeze({eventDriven:true,directWorldMutation:false,directExecution:false,wholeWorldScan:false,perFrameRender:false})})}

try{
  const p=typeof URLSearchParams!=="undefined"&&root.location?.search?new URLSearchParams(root.location.search):null;
  const requested=p?.get?.("advisorStatusEvidence");if(EVIDENCE_MODES.includes(requested))state.evidenceMode=requested;
}catch(_){}

return freeze({VERSION,EVIDENCE_MODES,MAX_GOALS,MAX_ITEMS,MAX_GUIDANCE,MAX_SCOPES,evidenceModel,runtimeModel,currentModel,setEvidenceMode,markup,snapshot});
});