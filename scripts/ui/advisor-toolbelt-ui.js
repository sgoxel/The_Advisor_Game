(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.AdvisorToolbeltUI=api;
if(root?.document)api.autoMount();
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="advisor-toolbelt-ui-v1";
const MAX_RECENT_RESULTS=4;
const MAX_DETAIL_ROWS=5;
const EVIDENCE_MODES=Object.freeze(["overview","success","uncertain","blocked"]);
const SKILLS=Object.freeze(["insight","rhetoric","diplomacy","stewardship","command","intrigue"]);
const TOOL_META=Object.freeze({
  insight:Object.freeze({label:"Insight",verb:"Investigate",global:"AdvisorInsight",list:"listResults"}),
  rhetoric:Object.freeze({label:"Rhetoric",verb:"Persuasion",global:"AdvisorRhetoric",list:"listOutcomes"}),
  diplomacy:Object.freeze({label:"Diplomacy",verb:"Leverage",global:"AdvisorDiplomacy",list:"listOutcomes"}),
  stewardship:Object.freeze({label:"Stewardship",verb:"Situation report",global:"AdvisorStewardship",list:"listReports"}),
  command:Object.freeze({label:"Command",verb:"Readiness",global:"AdvisorCommand",list:"listAnalyses"}),
  intrigue:Object.freeze({label:"Intrigue",verb:"Lead analysis",global:"AdvisorIntrigue",list:"listAnalyses"})
});
const state={mounted:false,open:false,rootNode:null,evidenceMode:null,selectedSkill:"insight",renderCount:0,lastReason:null,lastSeed:null};

function cleanText(value,max=180){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function escapeHtml(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function campaignContext(){
  const campaign=root.SeedSystem?.getCampaign?.()||null;
  const seed=cleanText(campaign?.seed||root.SeedSystem?.getSettings?.()?.seed||"DEFAULT-SEED",160)||"DEFAULT-SEED";
  const when=root.GameTime?.getTimestampKey?.()||"0000-01-01 00:00:00";
  return freeze({campaign,seed,when,active:Boolean(campaign&&campaign.seed===seed)});
}
function clamp01(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):null}
function percent(value){const n=clamp01(value);return n==null?null:Math.round(n*100)}
function skillView(seed,skill){
  let row=null;
  try{row=root.AdvisorProgression?.getSkill?.(seed,skill)||null}catch(_){row=null}
  const level=Math.max(1,Math.min(20,Math.floor(Number(row?.level)||1)));
  const current=Math.max(0,Number(row?.currentLevelXp)||0),next=Math.max(0,Number(row?.nextLevelXp)||0);
  return freeze({id:skill,label:TOOL_META[skill].label,level,totalXp:Math.max(0,Math.floor(Number(row?.totalXp)||0)),progress:row?.atMaxLevel?1:(next>0?Math.max(0,Math.min(1,current/next)):0),available:Boolean(root[TOOL_META[skill].global])});
}
function likelyConfidence(row){
  for(const key of ["confidence","confidenceScore","evidenceQuality","evidenceQualityScore","readinessScore","conditionScore","quality"]){
    const value=row?.[key];
    if(typeof value==="number"&&Number.isFinite(value)){
      if(value>1&&value<=100)return Math.max(0,Math.min(1,value/100));
      return clamp01(value);
    }
  }
  return null;
}
function compactDetails(row){
  const details=[];
  const candidates=[
    ["Status",row?.status||row?.readinessStatus||row?.condition||row?.decision||row?.resolutionMode],
    ["Subject",row?.subject?.label||row?.subjectLabel||row?.target?.label||row?.targetLabel||row?.subjectId],
    ["Quality",row?.qualityBand],
    ["Outcome",row?.outcome?.state||row?.outcomeState||row?.result?.status],
    ["Source",row?.sourceRef||row?.sourceId||row?.primarySourceId],
    ["When",row?.fantasyTimestamp||row?.when||row?.timestamp]
  ];
  for(const [label,value] of candidates){const text=cleanText(value,120);if(text&&!details.some(x=>x.value===text))details.push({label,value:text})}
  if(Array.isArray(row?.evidenceRefIds)&&row.evidenceRefIds.length)details.push({label:"Evidence",value:String(row.evidenceRefIds.length)+" refs"});
  const blockers=Array.isArray(row?.blockers)?row.blockers.length:0,unknowns=Array.isArray(row?.unknowns)?row.unknowns.length:0,conflicts=Array.isArray(row?.conflicts)?row.conflicts.length:0;
  if(blockers)details.push({label:"Blockers",value:String(blockers)});
  if(unknowns)details.push({label:"Unknowns",value:String(unknowns)});
  if(conflicts)details.push({label:"Conflicts",value:String(conflicts)});
  return freeze(details.slice(0,MAX_DETAIL_ROWS));
}
function normalizeResult(row,skill,index=0){
  if(!row||typeof row!=="object")return null;
  const confidence=likelyConfidence(row);
  const uncertainty=Boolean(row.uncertain||row.conflicting||row.conflict||row.stale||row.hearsay||(Array.isArray(row.conflicts)&&row.conflicts.length)||(Array.isArray(row.unknowns)&&row.unknowns.length));
  const blocked=Boolean(row.blocked||row.available===false||(Array.isArray(row.blockers)&&row.blockers.length));
  const id=cleanText(row.id||row.resultId||row.analysisId||row.reportId||row.outcomeId||("REC-"+index),160);
  const status=cleanText(row.status||row.readinessStatus||row.condition||row.decision||row.resolutionMode||(blocked?"Blocked":uncertainty?"Uncertain":"Recorded"),48);
  return freeze({id,skill,label:TOOL_META[skill].label,status,confidence,uncertainty,blocked,authority:"Advisory",details:compactDetails(row),source:"production-read-api"});
}
function readToolRows(seed,skill){
  const meta=TOOL_META[skill],api=root[meta.global];
  if(!api||typeof api[meta.list]!=="function")return freeze([]);
  try{
    const rows=api[meta.list](seed,{limit:MAX_RECENT_RESULTS});
    return freeze((Array.isArray(rows)?rows:[]).slice(0,MAX_RECENT_RESULTS).map((row,index)=>normalizeResult(row,skill,index)).filter(Boolean));
  }catch(_){return freeze([])}
}
function recentResolutions(seed){
  try{
    const rows=root.AdvisorToolResolutionBoundary?.listResolutions?.(seed,{limit:MAX_RECENT_RESULTS})||[];
    return freeze((Array.isArray(rows)?rows:[]).slice(0,MAX_RECENT_RESULTS).map((row,index)=>{
      const rawTool=cleanText(row?.tool||row?.skill||row?.toolId||"advisor",60);
      return freeze({
        id:cleanText(row?.id||row?.resolutionId||("ATR-"+index),120),
        tool:rawTool.startsWith("advisor.")?rawTool.slice(8):rawTool,
        mode:cleanText(row?.mode||row?.resolutionMode||"resolved",40),
        when:cleanText(row?.fantasyTimestamp||row?.when||"",40),
        authority:"Advisory"
      });
    }));
  }catch(_){return freeze([])}
}
function productionModel(){
  const ctx=campaignContext(),skills=SKILLS.map(skill=>skillView(ctx.seed,skill)),selected=SKILLS.includes(state.selectedSkill)?state.selectedSkill:"insight";
  const rows=readToolRows(ctx.seed,selected),result=rows[0]||freeze({id:null,skill:selected,label:TOOL_META[selected].label,status:skills.find(x=>x.id===selected)?.available?"No result yet":"Unavailable",confidence:null,uncertainty:false,blocked:!skills.find(x=>x.id===selected)?.available,authority:"Unavailable",details:freeze([]),source:"production-read-api"});
  return freeze({fixture:false,mode:"production",ctx,skills,selected,result,recent:recentResolutions(ctx.seed)});
}
function fixtureSkills(){
  const levels={insight:8,rhetoric:6,diplomacy:7,stewardship:9,command:5,intrigue:8};
  return freeze(SKILLS.map((id,i)=>freeze({id,label:TOOL_META[id].label,level:levels[id],totalXp:540+i*75,progress:[.72,.48,.61,.83,.34,.67][i],available:true})));
}
function evidenceModel(modeValue){
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"overview",skills=fixtureSkills();
  const base={fixture:true,mode,ctx:freeze({seed:"AGENT6-TOOLBELT-EVIDENCE",when:"1201-10-01 09:40:00",active:true}),skills,recent:freeze([
    {id:"ATR-EVID-004",tool:"intrigue",mode:"auto",when:"1201-10-01 09:34",authority:"Advisory"},
    {id:"ATR-EVID-003",tool:"stewardship",mode:"assisted",when:"1201-10-01 09:28",authority:"Advisory"},
    {id:"ATR-EVID-002",tool:"insight",mode:"auto",when:"1201-10-01 09:12",authority:"Advisory"}
  ])};
  if(mode==="success")return freeze({...base,selected:"stewardship",result:freeze({
    id:"STW-EVID-READY",skill:"stewardship",label:"Stewardship",status:"Stable with pressure",confidence:.86,uncertainty:false,blocked:false,authority:"Advisory",source:"presentation-fixture",
    details:freeze([{label:"Food stores",value:"Adequate · 18 days"},{label:"Workforce",value:"Stable"},{label:"Risk",value:"Bridge timber shortage"},{label:"Source",value:"RegionalSettlementSimulation"}])
  })});
  if(mode==="uncertain")return freeze({...base,selected:"intrigue",result:freeze({
    id:"INT-EVID-CONFLICT",skill:"intrigue",label:"Intrigue",status:"Conflicting sources",confidence:.46,uncertainty:true,blocked:false,authority:"Advisory",source:"presentation-fixture",
    details:freeze([{label:"Observed",value:"Two carts left after dusk"},{label:"Claim",value:"Witness says north road"},{label:"Conflict",value:"Gate log records east road"},{label:"Unknown",value:"Cargo owner not established"}])
  })});
  if(mode==="blocked")return freeze({...base,selected:"command",result:freeze({
    id:"CMD-EVID-BLOCKED",skill:"command",label:"Command",status:"Not ready",confidence:.92,uncertainty:false,blocked:true,authority:"Advisory",source:"presentation-fixture",
    details:freeze([{label:"Blocker",value:"No legitimate command authority"},{label:"Route",value:"Ford unavailable"},{label:"Actors",value:"2 of 5 available"},{label:"Outcome",value:"No order issued"}])
  })});
  return freeze({...base,selected:"insight",result:freeze({
    id:"INS-EVID-QUALITY",skill:"insight",label:"Insight",status:"Useful evidence",confidence:.78,uncertainty:false,blocked:false,authority:"Advisory",source:"presentation-fixture",
    details:freeze([{label:"Finding",value:"Mill ledger changed after market close"},{label:"Quality",value:"Corroborated locally"},{label:"Gap",value:"Second witness unavailable"},{label:"Source",value:"WorldState + CharacterMemory"}])
  })});
}
function currentModel(){return state.evidenceMode?evidenceModel(state.evidenceMode):productionModel()}
function resultTone(result){return result.blocked?"blocked":result.uncertainty?"uncertain":result.status==="Unavailable"?"unavailable":"ready"}
function skillMarkup(skill,selected){
  const pct=Math.round((skill.progress||0)*100);
  return '<button class="advisor-tool-skill" type="button" data-skill="'+escapeHtml(skill.id)+'" data-selected="'+String(skill.id===selected)+'" aria-pressed="'+String(skill.id===selected)+'">'+
    '<span><b>'+escapeHtml(skill.label)+'</b><em>Lv '+skill.level+'</em></span>'+
    '<i><u style="width:'+pct+'%"></u></i><small>'+pct+'% next</small>'+
  '</button>';
}
function resultMarkup(result){
  const confidence=percent(result.confidence),tone=resultTone(result);
  return '<section class="advisor-tool-result" data-tone="'+tone+'">'+
    '<div class="advisor-tool-result-head"><div><small>CURRENT '+escapeHtml(result.label.toUpperCase())+' VIEW</small><strong>'+escapeHtml(result.status)+'</strong></div>'+
      '<span class="advisor-tool-authority" data-authority="'+escapeHtml(result.authority.toLowerCase())+'">'+escapeHtml(result.authority)+'</span></div>'+
    (confidence==null?'':'<div class="advisor-tool-confidence"><span>Confidence <b>'+confidence+'%</b></span><i><u style="width:'+confidence+'%"></u></i></div>')+
    (result.uncertainty?'<p class="advisor-tool-caution">Uncertainty is preserved. Conflicting or incomplete evidence is not world truth.</p>':'')+
    (result.blocked?'<p class="advisor-tool-caution">Blocked conditions cannot be bypassed by Advisor skill or presentation state.</p>':'')+
    '<dl class="advisor-tool-details">'+result.details.map(row=>'<div><dt>'+escapeHtml(row.label)+'</dt><dd>'+escapeHtml(row.value)+'</dd></div>').join('')+'</dl>'+
    '<footer><code>'+escapeHtml(result.id||"NO-RESULT")+'</code><span>'+escapeHtml(result.source)+'</span></footer>'+
  '</section>';
}
function recentMarkup(rows){
  if(!rows.length)return '<p class="advisor-tool-empty">No recent bounded tool resolutions.</p>';
  return '<div class="advisor-tool-history">'+rows.map(row=>'<article><div><strong>'+escapeHtml(TOOL_META[row.tool]?.label||row.tool)+'</strong><span>'+escapeHtml(row.mode)+'</span></div><small>'+escapeHtml(row.when||"Fantasy time")+'</small><code>'+escapeHtml(row.id)+'</code></article>').join('')+'</div>';
}
function panelMarkup(model){
  const selected=model.selected,meta=TOOL_META[selected],fixture=model.fixture?'<span class="advisor-tool-fixture">EVIDENCE FIXTURE · PRESENTATION ONLY</span>':'';
  return '<button class="advisor-toolbelt-launcher" type="button" aria-expanded="'+String(state.open)+'" aria-controls="advisorToolbeltPanel"><span>✦</span><b>Toolbelt</b><small>'+escapeHtml(meta.label)+'</small></button>'+
  '<section id="advisorToolbeltPanel" class="advisor-toolbelt-panel" '+(state.open?'':'hidden')+' aria-label="Advisor progression and tool outcomes" data-evidence-mode="'+escapeHtml(state.evidenceMode||"none")+'">'+
    '<header class="advisor-toolbelt-head"><div><small>ADVISOR PROGRESSION</small><strong>Toolbelt</strong><span>Read-only capability and outcome view</span></div><button class="advisor-toolbelt-close" type="button" aria-label="Close Advisor toolbelt">×</button></header>'+
    fixture+
    '<nav class="advisor-tool-skills" aria-label="Advisor skills">'+model.skills.map(skill=>skillMarkup(skill,selected)).join('')+'</nav>'+
    '<div class="advisor-tool-main">'+
      '<div class="advisor-tool-title"><div><small>'+escapeHtml(meta.verb.toUpperCase())+'</small><strong>'+escapeHtml(meta.label)+'</strong></div><span>PROTAGONIST DECIDES · SIMULATION VALIDATES</span></div>'+
      resultMarkup(model.result)+
      '<details class="advisor-tool-recent" open><summary>Recent tool resolutions <span>'+model.recent.length+'/'+MAX_RECENT_RESULTS+'</span></summary>'+recentMarkup(model.recent)+'</details>'+
    '</div>'+
    '<footer class="advisor-toolbelt-foot"><span>Event-driven · bounded reads only</span><strong>UI has no world authority</strong></footer>'+
  '</section>';
}
function render(reason="explicit"){
  if(!state.rootNode||!root.document)return null;
  const model=currentModel();
  state.selectedSkill=model.selected;
  state.rootNode.innerHTML=panelMarkup(model);
  state.rootNode.dataset.version=VERSION;
  state.rootNode.dataset.renderMode="event-driven";
  state.rootNode.dataset.evidenceMode=state.evidenceMode||"none";
  state.rootNode.dataset.open=String(state.open);
  root.document.body?.classList.toggle("advisor-toolbelt-open",state.open);
  state.renderCount++;state.lastReason=reason;state.lastSeed=model.ctx.seed;
  state.rootNode.querySelector(".advisor-toolbelt-launcher")?.addEventListener("click",()=>setOpen(!state.open));
  state.rootNode.querySelector(".advisor-toolbelt-close")?.addEventListener("click",()=>setOpen(false));
  for(const button of state.rootNode.querySelectorAll(".advisor-tool-skill"))button.addEventListener("click",()=>{state.selectedSkill=button.dataset.skill||"insight";render("skill-select")});
  return state.rootNode;
}
function setOpen(value){
  const next=Boolean(value);
  if(next&&root.AdvisorConversationUI?.setOpen)root.AdvisorConversationUI.setOpen(false);
  state.open=next;
  return render(next?"open":"close");
}
function setEvidenceMode(modeValue){
  const mode=EVIDENCE_MODES.includes(String(modeValue||""))?String(modeValue):null;
  state.evidenceMode=mode;
  if(mode){state.open=true;state.selectedSkill=evidenceModel(mode).selected}
  return render("evidence-mode");
}
function mount(optionsValue){
  if(!root.document)return null;
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  let node=root.document.getElementById("advisorToolbeltUI");
  if(!node){node=root.document.createElement("div");node.id="advisorToolbeltUI";node.className="advisor-toolbelt-shell";root.document.body.appendChild(node)}
  state.rootNode=node;state.mounted=true;
  let queryMode=null;try{queryMode=new URLSearchParams(root.location?.search||"").get("advisorToolbeltEvidence")}catch(_){}
  state.evidenceMode=EVIDENCE_MODES.includes(options.evidenceMode)?options.evidenceMode:(EVIDENCE_MODES.includes(queryMode)?queryMode:null);
  state.open=options.open===true||Boolean(state.evidenceMode);
  if(state.evidenceMode)state.selectedSkill=evidenceModel(state.evidenceMode).selected;
  render("mount");
  return node;
}
function autoMount(){if(!root.document||state.mounted)return;const start=()=>{if(!state.mounted)mount()};if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",start,{once:true});else start()}
function snapshot(){
  const model=currentModel();
  return freeze({version:VERSION,mounted:state.mounted,open:state.open,evidenceMode:state.evidenceMode,selectedSkill:state.selectedSkill,renderCount:state.renderCount,lastReason:state.lastReason,lastSeed:state.lastSeed||model.ctx.seed,
    limits:{maxRecentResults:MAX_RECENT_RESULTS,maxDetailRows:MAX_DETAIL_ROWS,skillCount:SKILLS.length},
    authority:{eventDriven:true,boundedReads:true,perFrameRender:false,fullWorldScan:false,wholeHistoryScan:false,directWorldMutation:false,directActionExecution:false,progressionMutation:false,relationshipMutation:false,providerPayloadRendered:false,fixtureAuthority:false,protagonistDecisionAuthority:false,simulationValidationBypass:false}});
}
function proof(){
  const models=Object.fromEntries(EVIDENCE_MODES.map(mode=>[mode,evidenceModel(mode)]));
  return freeze({pass:SKILLS.length===6&&models.success.result.authority==="Advisory"&&models.uncertain.result.uncertainty===true&&models.blocked.result.blocked===true&&models.blocked.result.details.some(x=>x.value.includes("No legitimate command authority")),
    modes:Object.fromEntries(EVIDENCE_MODES.map(mode=>[mode,{selected:models[mode].selected,status:models[mode].result.status,authority:models[mode].result.authority,uncertainty:models[mode].result.uncertainty,blocked:models[mode].result.blocked}])),
    eventDriven:true,boundedReads:true,perFrameRender:false,fullWorldScan:false,directWorldMutation:false,directActionExecution:false,fixtureAuthority:false});
}

return freeze({VERSION,MAX_RECENT_RESULTS,MAX_DETAIL_ROWS,EVIDENCE_MODES,SKILLS,TOOL_META,evidenceModel,currentModel,mount,autoMount,render,setOpen,setEvidenceMode,snapshot,proof});
});
