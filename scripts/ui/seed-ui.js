(function(){
"use strict";

let e={};
let generated=null;
let reloadVerified=false;
let restartVerified=false;

const ids=[
  "seedInput","generateButton","startButton","restartButton","newButton",
  "message","state","currentSeed","source","restarts",
  "activeState","detailSeed","detailSource","detailRestarts",
  "vVisible","vLocked","vReload","vRestart"
];

function cache(){
  ids.forEach(id=>e[id]=document.getElementById(id));
}

function setCheck(node,pass,text){
  node.textContent=pass?"PASS":text;
  node.classList.toggle("pass",pass);
}

function setMessage(text){
  e.message.textContent=text||"";
}

function render(){
  const c=SeedSystem.getCampaign();
  const active=!!c;

  e.seedInput.disabled=active;
  e.generateButton.disabled=active;
  e.startButton.disabled=active;
  e.restartButton.disabled=!active;
  e.newButton.disabled=!active;

  e.state.textContent=active?"ACTIVE":"NOT STARTED";
  e.currentSeed.textContent=active?c.seed:"—";
  e.source.textContent=active?c.source:"—";
  e.restarts.textContent=active?String(c.restartCount):"0";

  e.activeState.textContent=active?"Active":"Not started";
  e.detailSeed.textContent=active?c.seed:"—";
  e.detailSource.textContent=active?c.source:"—";
  e.detailRestarts.textContent=active?String(c.restartCount):"0";

  setCheck(e.vVisible,active&&e.currentSeed.textContent===c.seed,"WAITING");
  setCheck(e.vLocked,active,"WAITING");
  setCheck(e.vReload,active&&reloadVerified,active?"RELOAD PAGE TO VERIFY":"WAITING");
  setCheck(e.vRestart,active&&restartVerified,active?"USE RESTART SAME SEED":"WAITING");
}

function init(){
  cache();

  e.generateButton.onclick=()=>{
    generated=SeedSystem.generate();
    e.seedInput.value=generated;
    setMessage("New SEED generated. Start the campaign to lock it.");
  };

  e.startButton.onclick=()=>{
    const r=SeedSystem.start(
      e.seedInput.value,
      e.seedInput.value===generated?"generated":"manual"
    );

    setMessage(r.message);

    if(r.ok){
      reloadVerified=false;
      restartVerified=false;
      render();
    }
  };

  e.restartButton.onclick=()=>{
    const before=SeedSystem.getSeed();
    const r=SeedSystem.restart();

    restartVerified=
      r.ok &&
      r.unchanged &&
      before===SeedSystem.getSeed();

    setMessage(r.message);
    render();
  };

  e.newButton.onclick=()=>{
    SeedSystem.clear();
    generated=null;
    reloadVerified=false;
    restartVerified=false;
    e.seedInput.value="";
    setMessage("Campaign cleared. Enter or generate a new SEED.");
    render();
  };

  const restored=SeedSystem.load();

  if(restored.ok){
    reloadVerified=true;
    e.seedInput.value=restored.campaign.seed;
    setMessage("Existing campaign SEED restored from browser storage.");
  }else{
    setMessage("Enter or generate a SEED to begin.");
  }

  render();
}

window.SeedUI=Object.freeze({init});
})();