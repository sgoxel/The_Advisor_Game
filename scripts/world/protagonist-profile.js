(function(){
"use strict";

const VERSION="protagonist-profile-v1";
const SCHEMA="ProtagonistProfile";
const SCHEMA_VERSION=1;
const DEFAULT_IDENTITY_KEY="protagonist";
const TRAIT_KEYS=Object.freeze(["resolve","empathy","curiosity","caution","ambition","sociability"]);
const GIVEN_NAMES=Object.freeze(["Aren","Bryn","Cael","Dara","Eryn","Fara","Galen","Hale","Iria","Joren","Kest","Lysa","Marek","Nia","Orin","Sela"]);
const FAMILY_NAMES=Object.freeze(["Ashmere","Briar","Cairn","Dunwell","Eldren","Fenwick","Glenward","Harth","Iver","Kestrel","Lorne","Morrow","Northam","Pryce","Rowan","Valeward"]);
const ORIGIN_TAGS=Object.freeze(["riverward","hillward","woodland","lakeland","crossroads","coastward","upland","lowland"]);
const MAX_PROFILE_BYTES=4096;

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out;
}
function freeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))freeze(item);return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function utf8Bytes(value){
  const text=String(value==null?"":value);
  if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
  let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n;
}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanIdentityKey(value){return cleanText(value||DEFAULT_IDENTITY_KEY,96).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")||DEFAULT_IDENTITY_KEY}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function unit(seed,identityKey,label){return (parseInt(hashText(seed+"|"+identityKey+"|"+label),16)>>>0)/0xFFFFFFFF}
function pick(list,seed,identityKey,label){return list[Math.min(list.length-1,Math.floor(unit(seed,identityKey,label)*list.length))]}
function score(seed,identityKey,label){return Math.round(15+unit(seed,identityKey,"trait:"+label)*70)}
function canonicalId(seed,identityKey){return "PROTAGONIST-"+hashText(seed+"|"+identityKey+"|identity-v1")}
function derive(seedValue,identityValue){
  const seed=requiredSeed(seedValue),identityKey=cleanIdentityKey(identityValue),protagonistId=canonicalId(seed,identityKey);
  const traits={};for(const key of TRAIT_KEYS)traits[key]=score(seed,identityKey,key);
  const givenName=pick(GIVEN_NAMES,seed,identityKey,"birth-given");
  const familyName=pick(FAMILY_NAMES,seed,identityKey,"birth-family");
  const birthIdentity=freeze({
    givenName,familyName,fullName:givenName+" "+familyName,
    lineageTag:"LINE-"+hashText(seed+"|"+identityKey+"|lineage-v1"),
    originTag:pick(ORIGIN_TAGS,seed,identityKey,"birth-origin"),
    metadataAuthority:"Campaign SEED + stable protagonist identity"
  });
  const personality=freeze({
    traits:freeze(traits),
    tendencies:freeze({
      riskTolerance:Math.round((traits.resolve+(100-traits.caution))/2),
      persistence:Math.round((traits.resolve+traits.ambition)/2),
      socialInitiative:Math.round((traits.empathy+traits.sociability)/2),
      explorationDrive:Math.round((traits.curiosity+traits.resolve)/2)
    }),
    fixedBaseline:true
  });
  const signatureBasis={schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,protagonistId,identityKey,birthIdentity,personality};
  const profileSignature=hashText(stableStringify(signatureBasis));
  const profile=freeze({
    ...signatureBasis,profileSignature,
    authority:freeze({
      identity:"Campaign SEED + stable protagonist identity",
      baselinePersonality:"Campaign SEED + stable protagonist identity",
      fantasyTimeDependent:false,realTimeDependent:false,presentationDependent:false,
      worldMutation:false,actionExecution:false,inventoryAuthority:false,rankAuthority:false,healthAuthority:false,relationshipAuthority:false
    }),
    persistence:freeze({mode:"seed-foundation",campaignSeedPersistedBy:"CampaignPersistence",storedMutableCopy:false}),
    bounds:freeze({traitCount:TRAIT_KEYS.length,maxProfileBytes:MAX_PROFILE_BYTES,serializedBytes:0,bounded:true})
  });
  const bounded=clone(profile);
  let serializedBytes=utf8Bytes(stableStringify(bounded));
  bounded.bounds.serializedBytes=serializedBytes;
  serializedBytes=utf8Bytes(stableStringify(bounded));
  bounded.bounds.serializedBytes=serializedBytes;
  if(serializedBytes>MAX_PROFILE_BYTES)throw new Error("Protagonist profile exceeded bounded size.");
  return freeze(bounded);
}
function fromCampaign(campaignValue,identityValue){
  const campaign=campaignValue&&typeof campaignValue==="object"?campaignValue:null;
  if(!campaign?.seed)throw new Error("Campaign with SEED is required.");
  return derive(campaign.seed,identityValue||campaign.protagonistId||campaign.protagonistIdentityKey||DEFAULT_IDENTITY_KEY);
}
function current(identityValue){
  const api=root().SeedSystem,campaign=api?.getCampaign?.()||null;
  if(campaign?.seed)return fromCampaign(campaign,identityValue);
  const seed=api?.getSettings?.()?.seed;
  return seed?derive(seed,identityValue||DEFAULT_IDENTITY_KEY):null;
}
function trait(seedValue,identityValue,traitName){
  const key=String(traitName||"").trim();if(!TRAIT_KEYS.includes(key))return null;
  return derive(seedValue,identityValue).personality.traits[key];
}
function summary(seedValue,identityValue){
  const profile=derive(seedValue,identityValue);
  return freeze({
    protagonistId:profile.protagonistId,name:profile.birthIdentity.fullName,profileSignature:profile.profileSignature,
    traits:freeze(clone(profile.personality.traits)),fixedBaseline:true,bounded:true,
    authority:profile.authority.identity,worldMutation:false,actionExecution:false
  });
}

root().ProtagonistProfile=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,DEFAULT_IDENTITY_KEY,TRAIT_KEYS,MAX_PROFILE_BYTES,
  derive,fromCampaign,current,trait,summary
});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistProfile;
})();