(function(){
"use strict";

const VALID=/^[A-Za-z0-9._-]{1,64}$/;
const SETTINGS_KEY=GameConfig.settingsStorageKey;
const CAMPAIGN_KEY=GameConfig.campaignStorageKey;
let settings={seed:GameConfig.defaultSeed};
let campaign=null;

function normalize(value){return String(value||"").trim()}
function validate(seedValue){
  const seed=normalize(seedValue);
  if(!seed)return {ok:false,message:"SEED Code cannot be empty."};
  if(!VALID.test(seed))return {ok:false,message:"SEED Code may use letters, numbers, underscore, dash and period only."};
  return {ok:true,seed};
}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));return true}catch(e){return false}
}
function loadSettings(){
  try{
    const raw=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");
    if(raw&&validate(raw.seed).ok)settings={seed:normalize(raw.seed)};
  }catch(e){}
  return settings;
}
function setSettingsSeed(value){
  const result=validate(value);
  if(!result.ok)return result;
  settings={seed:result.seed};
  const stored=saveSettings();
  return {ok:true,seed:result.seed,stored,message:stored?"Settings saved.":"Settings applied in memory. Browser storage is unavailable."};
}
function getSettings(){return {seed:settings.seed}}

function originProtagonist(){return WorldCoordinates.origin()}
function normalizeProtagonist(value){
  try{
    if(value&&value.x!=null&&value.y!=null)return WorldCoordinates.position(value.x,value.y);
  }catch(e){}
  return originProtagonist();
}
function saveCampaign(){
  try{localStorage.setItem(CAMPAIGN_KEY,JSON.stringify(campaign));return true}catch(e){return false}
}
function loadCampaign(){
  try{
    const raw=JSON.parse(localStorage.getItem(CAMPAIGN_KEY)||"null");
    if(raw&&validate(raw.seed).ok&&Number.isFinite(raw.realStartMs)&&raw.fantasyStart){
      campaign={
        seed:normalize(raw.seed),
        realStartMs:Number(raw.realStartMs),
        fantasyStart:raw.fantasyStart,
        protagonist:normalizeProtagonist(raw.protagonist),
        restartCount:Number.isInteger(raw.restartCount)?raw.restartCount:0
      };
      return {ok:true,campaign};
    }
  }catch(e){}
  campaign=null;
  return {ok:false};
}
function makeFantasyStart(now){
  return {
    year:now.getFullYear()+GameConfig.fantasyYearOffset,
    month:now.getMonth()+1,
    day:now.getDate(),
    hour:now.getHours(),
    minute:now.getMinutes(),
    second:now.getSeconds(),
    millisecond:now.getMilliseconds()
  };
}
function startNewCampaign(seedOverride){
  const candidate=seedOverride==null?settings.seed:seedOverride;
  const checked=validate(candidate);
  if(!checked.ok)return checked;
  const now=new Date();
  campaign={
    seed:checked.seed,
    realStartMs:now.getTime(),
    fantasyStart:makeFantasyStart(now),
    protagonist:originProtagonist(),
    restartCount:0
  };
  const stored=saveCampaign();
  return {ok:true,campaign,stored,message:"New campaign started."};
}
function restartCampaign(){
  if(!campaign)return {ok:false,message:"No active campaign exists."};
  const sameSeed=campaign.seed;
  const now=new Date();
  campaign={
    seed:sameSeed,
    realStartMs:now.getTime(),
    fantasyStart:makeFantasyStart(now),
    protagonist:originProtagonist(),
    restartCount:campaign.restartCount+1
  };
  saveCampaign();
  return {ok:true,campaign,message:"Campaign restarted with the same SEED."};
}
function getCampaign(){return campaign}
function getSeed(){return campaign?campaign.seed:null}

window.SeedSystem=Object.freeze({
  validate,loadSettings,setSettingsSeed,getSettings,
  loadCampaign,startNewCampaign,restartCampaign,getCampaign,getSeed
});
})();
