(function(){
"use strict";
const e={};
let restoredCampaign=false;
let clockTimer=null;
const ids=[
  "mainMenuButton","settingsButton","mainMenuPopup","settingsPopup","resumeButton","newCampaignButton","restartCampaignButton",
  "menuMessage","seedInput","saveSettingsButton","settingsMessage","gameDate","gameTime","campaignState","statusMessage",
  "detailState","detailGameDate","detailGameTime","vDate","vPersist",
  "prngSeed","prngTimestamp","prngValue","vPrngRepeat","vPrngTime","vPrngSource"
];
function cache(){ids.forEach(id=>e[id]=document.getElementById(id))}
function openPopup(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function closePopup(id){document.getElementById(id).hidden=true;document.body.style.overflow=""}
function closeAll(){document.querySelectorAll(".fullscreen-popup").forEach(p=>p.hidden=true);document.body.style.overflow=""}
function setCheck(node,pass,waiting){node.textContent=pass?"PASS":waiting;node.classList.toggle("pass",pass)}

function renderPRNG(fantasyTimestampMs){
  const campaign=SeedSystem.getCampaign();
  if(!campaign||fantasyTimestampMs==null){
    e.prngSeed.textContent=campaign?campaign.seed:"—";
    e.prngTimestamp.textContent="—";
    e.prngValue.textContent="—";
    setCheck(e.vPrngRepeat,false,"WAITING");
    setCheck(e.vPrngTime,false,"WAITING");
    setCheck(e.vPrngSource,PRNG.randomUint32.length===2,"FAIL");
    return;
  }
  const proof=PRNG.verify(campaign.seed,fantasyTimestampMs);
  e.prngSeed.textContent=campaign.seed;
  e.prngTimestamp.textContent=GameTime.formatTimestamp(GameTime.fromTimestampMs(proof.timestamp));
  e.prngValue.textContent=String(proof.value);
  setCheck(e.vPrngRepeat,proof.repeatable,"FAIL");
  setCheck(e.vPrngTime,proof.timeSensitive,"FAIL");
  setCheck(e.vPrngSource,PRNG.randomUint32.length===2&&PRNG.random.length===2,"FAIL");
}
function renderStatic(){
  const campaign=SeedSystem.getCampaign();
  e.campaignState.textContent=campaign?"ACTIVE":"NOT STARTED";
  e.detailState.textContent=campaign?"Active":"Not started";
  e.restartCampaignButton.disabled=!campaign;
  e.resumeButton.disabled=!campaign;
  setCheck(e.vDate,!!campaign&&GameTime.validateStartYear(),campaign?"FAIL":"WAITING");
  setCheck(e.vPersist,!!campaign&&restoredCampaign,campaign?"RELOAD PAGE TO VERIFY":"WAITING");
}

function renderClock(){
  const fantasyTimestampMs=GameTime.getTimestampMs();
  const t=GameTime.fromTimestampMs(fantasyTimestampMs);
  const date=GameTime.formatDate(t);
  const time=GameTime.formatTime(t);
  e.gameDate.textContent=date;e.gameTime.textContent=time;
  e.detailGameDate.textContent=date;e.detailGameTime.textContent=time;
  renderPRNG(fantasyTimestampMs);
}
function startClock(){
  if(clockTimer)clearInterval(clockTimer);
  renderClock();
  clockTimer=setInterval(renderClock,250);
}
function startNewCampaign(){
  const result=SeedSystem.startNewCampaign();
  restoredCampaign=false;
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent="Campaign running. Game time advances 24× real time.";
  renderStatic();startClock();closePopup("mainMenuPopup");
}
function restartCampaign(){
  const result=SeedSystem.restartCampaign();
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent=result.ok?"Campaign restarted with the same SEED.":result.message;
  renderStatic();startClock();
  if(result.ok)closePopup("mainMenuPopup");
}
function saveSettings(){
  const result=SeedSystem.setSettingsSeed(e.seedInput.value);
  e.settingsMessage.textContent=result.message;
  if(result.ok)e.seedInput.value=result.seed;
}
function init(){
  cache();
  SeedSystem.loadSettings();
  e.seedInput.value=SeedSystem.getSettings().seed;
  const restored=SeedSystem.loadCampaign();
  restoredCampaign=restored.ok;

  e.mainMenuButton.onclick=()=>openPopup("mainMenuPopup");
  e.settingsButton.onclick=()=>{e.seedInput.value=SeedSystem.getSettings().seed;openPopup("settingsPopup")};
  e.resumeButton.onclick=()=>closePopup("mainMenuPopup");
  e.newCampaignButton.onclick=startNewCampaign;
  e.restartCampaignButton.onclick=restartCampaign;
  e.saveSettingsButton.onclick=saveSettings;
  document.querySelectorAll("[data-close-popup]").forEach(btn=>btn.onclick=()=>closePopup(btn.dataset.closePopup));
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeAll()});

  if(restored.ok)e.statusMessage.textContent="Campaign restored. Game time continued while the page was closed.";
  else e.statusMessage.textContent="Open Main Menu to start a campaign.";

  renderStatic();startClock();
}
window.AppUI=Object.freeze({init});
})();
