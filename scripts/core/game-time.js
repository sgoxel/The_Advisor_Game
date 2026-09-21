(function(){
"use strict";

function pad2(n){return String(n).padStart(2,"0")}
function padYear(n){return String(n).padStart(4,"0")}

function fantasyStartToMs(start){
  return Date.UTC(
    start.year,
    start.month-1,
    start.day,
    start.hour,
    start.minute,
    start.second,
    start.millisecond||0
  );
}

function getNow(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign)return null;
  const elapsedRealMs=Math.max(0,Date.now()-campaign.realStartMs);
  const fantasyMs=fantasyStartToMs(campaign.fantasyStart)+(elapsedRealMs*GameConfig.gameTimeMultiplier);
  const d=new Date(fantasyMs);
  return {
    year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),
    hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()
  };
}
function formatDate(t){return t?`${pad2(t.day)}.${pad2(t.month)}.${padYear(t.year)}`:"—"}
function formatTime(t){return t?`${pad2(t.hour)}:${pad2(t.minute)}`:"—"}
function validateStartYear(){
  const c=SeedSystem.getCampaign();
  if(!c)return false;
  const realStart=new Date(c.realStartMs);
  return c.fantasyStart.year===realStart.getFullYear()+GameConfig.fantasyYearOffset;
}

window.GameTime=Object.freeze({getNow,formatDate,formatTime,validateStartYear});
})();
