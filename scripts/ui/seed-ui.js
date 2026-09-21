(function(){
"use strict";
let e={},generated=null,reloadVerified=false,restartVerified=false;
const ids=["seedInput","generateButton","startButton","restartButton","newButton","message","state","currentSeed","activeState","source","restarts","vVisible","vLocked","vReload","vRestart"];

function cache(){ids.forEach(id=>e[id]=document.getElementById(id))}
function check(node,pass,text){
  node.textContent=pass?"PASS":text;
  node.classList.toggle("pass",pass);
}
function render(){
  const c=SeedSystem.getCampaign(),active=!!c;
  e.seedInput.disabled=active;
  e.generateButton.disabled=active;
  e.startButton.disabled=active;
  e.restartButton.disabled=!active;
  e.newButton.disabled=!active;
  e.state.textContent=active?"ACTIVE":"NOT STARTED";
  e.currentSeed.textContent=active?c.seed:"—";
  e.activeState.textContent=active?"Active":"Not started";
  e.source.textContent=active?c.source:"—";
  e.restarts.textContent=active?String(c.restartCount):"0";
  check(e.vVisible,active&&e.currentSeed.textContent===c.seed,"WAITING");
  check(e.vLocked,active,"WAITING");
  check(e.vReload,active&&reloadVerified,active?"RELOAD PAGE TO VERIFY":"WAITING");
  check(e.vRestart,active&&restartVerified,active?"USE RESTART SAME SEED":"WAITING");
}
function msg(t){e.message.textContent=t}
function init(){
  cache();
  e.generateButton.onclick=()=>{
    generated=SeedSystem.generate();
    e.seedInput.value=generated;
    msg("New SEED generated. Start the campaign to lock it.");
  };
  e.startButton.onclick=()=>{
    const r=SeedSystem.start(e.seedInput.value,e.seedInput.value===generated?"generated":"manual");
    msg(r.message);
    if(r.ok){reloadVerified=false;restartVerified=false;render()}
  };
  e.restartButton.onclick=()=>{
    const before=SeedSystem.getSeed();
    const r=SeedSystem.restart();
    restartVerified=r.ok&&r.unchanged&&before===SeedSystem.getSeed();
    msg(r.message);
    render();
  };
  e.newButton.onclick=()=>{
    SeedSystem.clear();
    generated=null;reloadVerified=false;restartVerified=false;
    e.seedInput.value="";
    msg("Campaign cleared. Enter or generate a new SEED.");
    render();
  };
  const restored=SeedSystem.load();
  if(restored.ok){
    reloadVerified=true;
    e.seedInput.value=restored.campaign.seed;
    msg("Existing campaign SEED restored from browser storage.");
  }else msg("Enter a SEED or generate one to begin.");
  render();
}
window.SeedUI=Object.freeze({init});
})();