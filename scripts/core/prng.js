(function(){
"use strict";

function normalizeSeed(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
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

function randomUint32(seedValue,fantasyTimestampMs){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestampMs);
  return mixText(seed+"|"+String(timestamp));
}

function random(seedValue,fantasyTimestampMs){
  return randomUint32(seedValue,fantasyTimestampMs)/4294967296;
}

function verify(seedValue,fantasyTimestampMs){
  const seed=normalizeSeed(seedValue);
  const timestamp=normalizeFantasyTimestamp(fantasyTimestampMs);
  const first=randomUint32(seed,timestamp);
  const repeated=randomUint32(seed,timestamp);
  const nextTimestamp=randomUint32(seed,timestamp+1);
  return Object.freeze({
    value:first,
    repeatable:first===repeated,
    timeSensitive:first!==nextTimestamp,
    timestamp
  });
}

window.PRNG=Object.freeze({randomUint32,random,verify});
})();
