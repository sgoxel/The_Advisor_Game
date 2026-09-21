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

function normalizeFantasyTimestamp(fantasyTimestampMs){
  if(!Number.isFinite(fantasyTimestampMs))throw new Error("Fantasy game timestamp is required.");
  const timestamp=Math.trunc(fantasyTimestampMs);
  if(!Number.isSafeInteger(timestamp))throw new Error("Fantasy game timestamp must be a safe integer.");
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
// stableKey only addresses a deterministic location/slot such as terrain:x:y or npc:0001.
// It is not an entropy source and must itself be derived from deterministic generation structure.
function foundationUint32(seedValue,stableKey){
  const seed=normalizeSeed(seedValue);
  const key=normalizeFoundationKey(stableKey);
  return mixText(seed+"|FOUNDATION|"+key);
}

function foundation(seedValue,stableKey){
  return foundationUint32(seedValue,stableKey)/4294967296;
}

// Live simulation actions. Exactly Campaign SEED + authoritative FantasyTimestamp.
function liveUint32(seedValue,fantasyTimestampMs){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestampMs);
  return mixText(seed+"|LIVE|"+String(timestamp));
}

function live(seedValue,fantasyTimestampMs){
  return liveUint32(seedValue,fantasyTimestampMs)/4294967296;
}

function verify(seedValue,fantasyTimestampMs){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestampMs);
  const foundationKey="wp002:foundation-proof";
  const foundationA=foundationUint32(seed,foundationKey);
  const foundationB=foundationUint32(seed,foundationKey);
  const liveA=liveUint32(seed,timestamp);
  const liveB=liveUint32(seed,timestamp);
  const liveNext=liveUint32(seed,timestamp+1);

  return Object.freeze({
    foundationKey,
    foundationValue:foundationA,
    foundationRepeatable:foundationA===foundationB,
    liveValue:liveA,
    liveRepeatable:liveA===liveB,
    liveTimeSensitive:liveA!==liveNext,
    timestamp
  });
}

window.PRNG=Object.freeze({
  foundationUint32,foundation,
  liveUint32,live,
  verify
});
})();
