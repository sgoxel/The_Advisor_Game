"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");

const repoRoot=path.resolve(__dirname,"../..");
const modulePath=path.join(repoRoot,"scripts/ui/advisor-toolbelt-ui.js");

delete global.AdvisorToolbeltUI;
global.SeedSystem={
  getCampaign(){return {seed:"WP-S011-009-SEED",protagonistId:"protagonist"}},
  getSettings(){return {seed:"WP-S011-009-SEED"}}
};
global.GameTime={getTimestampKey(){return "1201-10-01 09:40:00"}};
global.AdvisorProgression={
  getSkill(_seed,skill){
    const level={insight:8,rhetoric:6,diplomacy:7,stewardship:9,command:5,intrigue:8}[skill]||1;
    return {skill,level,totalXp:level*100,currentLevelXp:40,nextLevelXp:100,atMaxLevel:false};
  }
};
global.AdvisorInsight={listResults(){return [{id:"INS-LIVE",status:"Useful evidence",confidence:.8,sourceId:"MEM-1",fantasyTimestamp:"1201-10-01 09:38:00"}]}};
global.AdvisorRhetoric={listOutcomes(){return []}};
global.AdvisorDiplomacy={listOutcomes(){return []}};
global.AdvisorStewardship={listReports(){return []}};
global.AdvisorCommand={listAnalyses(){return []}};
global.AdvisorIntrigue={listAnalyses(){return []}};
global.AdvisorToolResolutionBoundary={listResolutions(){return [{id:"ATR-LIVE",tool:"insight",mode:"auto",fantasyTimestamp:"1201-10-01 09:39:00"}]}};
global.ActionExecutor={execute(){throw new Error("Toolbelt UI must never execute actions")}};
global.ProtagonistCommandEvaluator={evaluate(){throw new Error("Toolbelt UI must never decide for protagonist")}};

const UI=require(modulePath);
assert.equal(UI.VERSION,"advisor-toolbelt-ui-v1");
assert.deepStrictEqual(UI.SKILLS,["insight","rhetoric","diplomacy","stewardship","command","intrigue"]);
assert.deepStrictEqual(UI.EVIDENCE_MODES,["overview","success","uncertain","blocked"]);

const proof=UI.proof();
assert.equal(proof.pass,true);
assert.equal(proof.eventDriven,true);
assert.equal(proof.boundedReads,true);
assert.equal(proof.perFrameRender,false);
assert.equal(proof.fullWorldScan,false);
assert.equal(proof.directWorldMutation,false);
assert.equal(proof.directActionExecution,false);
assert.equal(proof.fixtureAuthority,false);
assert.equal(proof.modes.uncertain.uncertainty,true);
assert.equal(proof.modes.blocked.blocked,true);

const live=UI.currentModel();
assert.equal(live.fixture,false);
assert.equal(live.skills.length,6);
assert.equal(live.selected,"insight");
assert.equal(live.result.id,"INS-LIVE");
assert.equal(live.result.authority,"Advisory");
assert.equal(live.result.confidence,.8);
assert.equal(live.recent.length,1);
assert.equal(live.recent[0].authority,"Advisory");

const success=UI.evidenceModel("success");
assert.equal(success.selected,"stewardship");
assert.equal(success.result.status,"Stable with pressure");
assert.equal(success.result.authority,"Advisory");

const uncertain=UI.evidenceModel("uncertain");
assert.equal(uncertain.selected,"intrigue");
assert.equal(uncertain.result.uncertainty,true);
assert(uncertain.result.details.some(row=>row.label==="Conflict"));

const blocked=UI.evidenceModel("blocked");
assert.equal(blocked.selected,"command");
assert.equal(blocked.result.blocked,true);
assert(blocked.result.details.some(row=>row.value.includes("No legitimate command authority")));
assert(blocked.result.details.some(row=>row.value==="No order issued"));

const snapshot=UI.snapshot();
assert.equal(snapshot.authority.eventDriven,true);
assert.equal(snapshot.authority.boundedReads,true);
assert.equal(snapshot.authority.perFrameRender,false);
assert.equal(snapshot.authority.fullWorldScan,false);
assert.equal(snapshot.authority.wholeHistoryScan,false);
assert.equal(snapshot.authority.directWorldMutation,false);
assert.equal(snapshot.authority.directActionExecution,false);
assert.equal(snapshot.authority.progressionMutation,false);
assert.equal(snapshot.authority.relationshipMutation,false);
assert.equal(snapshot.authority.providerPayloadRendered,false);
assert.equal(snapshot.authority.fixtureAuthority,false);
assert.equal(snapshot.authority.protagonistDecisionAuthority,false);
assert.equal(snapshot.authority.simulationValidationBypass,false);
assert.equal(snapshot.limits.maxRecentResults,4);
assert.equal(snapshot.limits.skillCount,6);

const source=fs.readFileSync(modulePath,"utf8");
for(const forbidden of [
  "AdvisorProgression.award","applyDelta(","ActionExecutor.","ProtagonistCommandEvaluator.",
  ".analyze(",".assess(",".recordOutcome(",".autoResolve(",".assistedResolve("
])assert(!source.includes(forbidden),"presentation UI must not call mutation/execution API: "+forbidden);
for(const required of [
  "eventDriven:true","boundedReads:true","perFrameRender:false","fullWorldScan:false",
  "directWorldMutation:false","directActionExecution:false","fixtureAuthority:false"
])assert(source.includes(required),"missing authority marker "+required);

const index=fs.readFileSync(path.join(repoRoot,"index.html"),"utf8");
const toolScript="scripts/ui/advisor-toolbelt-ui.js?v=advisor-toolbelt-ui-v1";
assert(index.includes(toolScript),"canonical root must load AdvisorToolbeltUI");
assert(index.indexOf(toolScript)<index.indexOf("scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1"),"toolbelt should load before chat for cross-surface presentation coordination");

const css=fs.readFileSync(path.join(repoRoot,"styles/main.css"),"utf8");
for(const selector of [".advisor-toolbelt-launcher{",".advisor-toolbelt-panel{",".advisor-tool-skills{",".advisor-tool-result{"])assert(css.includes(selector),"missing toolbelt CSS "+selector);
assert(css.includes("@media(max-width:520px)"));
assert(css.includes("@media(max-height:430px) and (orientation:landscape)"));

console.log(JSON.stringify({
  wp:"WP-S011-009",
  pass:true,
  classification:"MIXED",
  skills:UI.SKILLS,
  evidenceModes:UI.EVIDENCE_MODES,
  authority:snapshot.authority,
  bounds:snapshot.limits,
  productionRead:{result:live.result.id,recent:live.recent.length}
},null,2));
