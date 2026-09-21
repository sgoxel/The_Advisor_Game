(function(){
"use strict";
const KEY=GameConfig.storageKey;
const VALID=/^[A-Za-z0-9._-]{1,64}$/;
let campaign=null;

function normalize(v){return String(v||"").trim();}
function validate(v){
  const seed=normalize(v);
  if(!seed)return {ok:false,message:"Enter or generate a SEED first."};
  if(!VALID.test(seed))return {ok:false,message:"SEED contains unsupported characters."};
  return {ok:true,seed};
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(campaign));return true}
  catch(e){return false}
}
function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY)||"null");
    if(x&&VALID.test(x.seed)){
      campaign=Object.freeze({
        seed:x.seed,
        source:x.source==="generated"?"generated":"manual",
        startedAt:String(x.startedAt||""),
        restartCount:Number.isInteger(x.restartCount)?x.restartCount:0
      });
      return {ok:true,campaign};
    }
  }catch(e){}
  return {ok:false};
}
function clear(){
  campaign=null;
  try{localStorage.removeItem(KEY)}catch(e){}
}
function bytes(n){
  const a=new Uint8Array(n);
  if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);
  else for(let i=0;i<n;i++)a[i]=Math.floor(Math.random()*256);
  return a;
}
function generate(){
  const h=Array.from(bytes(8),b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
  return `ADVISOR-${h.slice(0,4)}-${h.slice(4,8)}-${h.slice(8,12)}-${h.slice(12,16)}`;
}
function start(v,source){
  if(campaign)return {ok:false,message:"A campaign is already active."};
  const t=validate(v); if(!t.ok)return t;
  campaign=Object.freeze({
    seed:t.seed,
    source:source==="generated"?"generated":"manual",
    startedAt:new Date().toISOString(),
    restartCount:0
  });
  const stored=save();
  return {ok:true,stored,message:stored?
    "Campaign started. The SEED is locked as the campaign root.":
    "Campaign started in memory. Browser storage is unavailable."};
}
function restart(){
  if(!campaign)return {ok:false,message:"No active campaign exists."};
  const original=campaign.seed;
  campaign=Object.freeze({
    seed:original,
    source:campaign.source,
    startedAt:campaign.startedAt,
    restartCount:campaign.restartCount+1
  });
  save();
  return {ok:true,unchanged:campaign.seed===original,message:"Runtime restarted with exactly the same SEED."};
}
function getCampaign(){return campaign}
function getSeed(){return campaign?campaign.seed:null}

window.SeedSystem=Object.freeze({
  validate,generate,start,restart,load,clear,getCampaign,getSeed
});
})();