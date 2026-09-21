(function(){
"use strict";

function normalizeSeed(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
}

function normalizeFoundationKey(stableKey){
  const key=String(stableKey==null?"":stableKey);
  if(!key)throw new Error("Deterministic foundation key is required.");
  return key;
}

function normalizeFantasyTimestamp(fantasyTimestamp){
  const timestamp=String(fantasyTimestamp==null?"":fantasyTimestamp);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)){
    throw new Error("FantasyTimestamp must use date, hour, minute and second only: YYYY-MM-DD HH:MM:SS.");
  }
  return timestamp;
}

function mixText(text){
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  hash^=hash>>>16;
  hash=Math.imul(hash,2246822507);
  hash^=hash>>>13;
  hash=Math.imul(hash,3266489909);
  hash^=hash>>>16;
  return hash>>>0;
}

// Time-independent world-foundation generation.
// stableKey addresses a deterministic structural location/slot such as terrain:x:y or npc:0001.
function foundationUint32(seedValue,stableKey){
  const seed=normalizeSeed(seedValue);
  const key=normalizeFoundationKey(stableKey);
  return mixText(seed+"|FOUNDATION|"+key);
}

function foundation(seedValue,stableKey){
  return foundationUint32(seedValue,stableKey)/4294967296;
}

// Live simulation actions use exactly Campaign SEED + FantasyTimestamp.
// FantasyTimestamp has second precision only; milliseconds are invalid.
function liveUint32(seedValue,fantasyTimestamp){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestamp);
  return mixText(seed+"|LIVE|"+timestamp);
}

function live(seedValue,fantasyTimestamp){
  return liveUint32(seedValue,fantasyTimestamp)/4294967296;
}

function verify(seedValue,fantasyTimestamp){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestamp);
  const foundationKey="wp002:foundation-proof";
  const foundationA=foundationUint32(seed,foundationKey);
  const foundationB=foundationUint32(seed,foundationKey);
  const liveA=liveUint32(seed,timestamp);
  const liveB=liveUint32(seed,timestamp);

  return Object.freeze({
    foundationKey,
    foundationValue:foundationA,
    foundationRepeatable:foundationA===foundationB,
    liveValue:liveA,
    liveRepeatable:liveA===liveB,
    timestamp
  });
}

window.PRNG=Object.freeze({
  foundationUint32,foundation,
  liveUint32,live,
  verify
});
})();
