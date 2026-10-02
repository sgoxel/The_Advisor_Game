// WP-S013-007: bounded read-only status duties, privileges, and obligation context.
(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistStatusObligations=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-status-obligations-v1";
const MAX_SCOPES=16,MAX_PRIVILEGES=8,MAX_RESTRICTIONS=8,MAX_DUTIES=8,MAX_OBLIGATIONS=8,MAX_WORK_BLOCKS=4,MAX_RESULT_BYTES=32768;
const PRIVILEGE_RULES=Object.freeze([
 Object.freeze({category:"self-directed-local-action",scope:"self",label:"Act on personal local matters"}),
 Object.freeze({category:"guild-participation",scope:"guild:participate",label:"Participate in guild activity"}),
 Object.freeze({category:"settlement-administration",scope:"settlement:administration",label:"Perform settlement administration"}),
 Object.freeze({category:"request-local-assistance",scope:"settlement:request-assistance",label:"Request settlement assistance"}),
 Object.freeze({category:"regional-adjudication",scope:"region:adjudication",label:"Participate in regional adjudication"}),
 Object.freeze({category:"request-regional-assistance",scope:"region:request-assistance",label:"Request regional assistance"}),
 Object.freeze({category:"realm-advice",scope:"realm:advise",label:"Offer realm-level advice"}),
 Object.freeze({category:"request-realm-audience",scope:"realm:request-audience",label:"Request a realm audience"})
]);
const DUTY_RULES=Object.freeze([
 Object.freeze({dutyId:"guild-participation",scope:"guild:participate",category:"guild-participation",label:"Honor guild participation responsibilities"}),
 Object.freeze({dutyId:"settlement-administration",scope:"settlement:administration",category:"settlement-administration",label:"Attend settlement administration responsibilities"}),
 Object.freeze({dutyId:"regional-adjudication",scope:"region:adjudication",category:"regional-adjudication",label:"Attend regional adjudication responsibilities"}),
 Object.freeze({dutyId:"realm-counsel",scope:"realm:advise",category:"realm-advice",label:"Attend realm counsel responsibilities"})
]);
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]))}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v??"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function B(v){return typeof TextEncoder!=="undefined"?new TextEncoder().encode(String(v)).length:String(v).length}
function T(v,n=160){return String(v??"").trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function P(v){return!!v&&typeof v==="object"&&!Array.isArray(v)}
function seed(v){const s=T(v);if(!s)throw new Error("Campaign SEED is required.");return s}
function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""))}
function ref(v){if(!P(v))return null;const kind=I(v.kind||v.type||"entity",80),id=I(v.id||v.refId||v.entityId,160);return kind&&id?F({kind,id}):null}
function uniq(values,max){const out=[];for(const raw of Array.isArray(values)?values:[]){const id=I(raw,120);if(id&&!out.includes(id))out.push(id);if(out.length>=max)break}return out}
function authority(seedValue,identityValue){try{return root?.ProtagonistAuthority?.snapshot?.(seedValue,identityValue)||null}catch(_){return null}}
function housing(seedValue,whenValue,identityValue){try{return root?.ProtagonistHousing?.decisionContext?.(seedValue,whenValue,identityValue)||null}catch(_){return null}}
function employment(seedValue,whenValue,identityValue){try{return root?.ProtagonistEmployment?.current?.(seedValue,whenValue,identityValue)||null}catch(_){return null}}
function priorityRank(v){return v==="high"?3:v==="medium"?2:v==="low"?1:0}
function resolve(seedValue,whenValue,identityValue){
 let s;try{s=seed(seedValue)}catch(e){return F({ok:false,reason:String(e.message||e)})}
 const when=T(whenValue,32);if(!validTs(when))return F({ok:false,reason:"fantasy-timestamp-required"});
 const auth=authority(s,identityValue);if(!auth?.exists||!auth.currentRole?.roleId)return F({ok:false,reason:"protagonist-authority-unavailable",readOnly:true,directActionExecution:false});
 const scopes=uniq(auth.currentRole.scopes,MAX_SCOPES);if((auth.currentRole.scopes||[]).length>MAX_SCOPES)return F({ok:false,reason:"authority-scope-cap-exceeded"});
 const scopeSet=new Set(scopes),privileges=[],restrictedActions=[],duties=[],obligations=[];
 for(const rule of PRIVILEGE_RULES){
  const row=F({category:rule.category,label:rule.label,requiredScope:rule.scope,sourceRef:F({kind:"authority-scope",id:rule.scope}),permissionOnly:true,guaranteedSuccess:false,simulationValidationRequired:true});
  (scopeSet.has(rule.scope)?privileges:restrictedActions).push(row);
 }
 for(const rule of DUTY_RULES){
  if(!scopeSet.has(rule.scope))continue;
  const obligationId="OBL-ROLE-"+H(S({seed:s,roleId:auth.currentRole.roleId,scope:rule.scope,dutyId:rule.dutyId}));
  duties.push(F({dutyId:rule.dutyId,category:rule.category,label:rule.label,requiredScope:rule.scope,sourceRef:F({kind:"authority-scope",id:rule.scope}),obligationId,readOnly:true}));
  obligations.push(F({id:obligationId,kind:"status-duty",category:rule.category,label:rule.label,state:"standing",priority:"normal",dueAt:null,locationRef:null,sourceRef:F({kind:"authority-scope",id:rule.scope}),persistent:false,derivedFromAuthority:true,proposalOnly:true}));
 }
 const emp=employment(s,when,identityValue);
 if(emp?.ok===true&&emp.status==="active"&&P(emp.contract)&&obligations.length<MAX_OBLIGATIONS){
  const contract=emp.contract,contractId=I(contract.id),workplaceRef=ref(contract.workplaceRef),employerRef=ref(contract.employerRef),blocks=(Array.isArray(contract.workBlocks)?contract.workBlocks:[]).slice(0,MAX_WORK_BLOCKS).map((x,i)=>F({id:I(x?.id||("block-"+i),80),startMinute:Number(x?.startMinute),endMinute:Number(x?.endMinute)}));
  if(contractId){
   const id="OBL-EMP-"+H(S({seed:s,contractId}));
   obligations.push(F({id,kind:"employment-duty",category:"active-work-commitment",label:"Honor active work commitment",state:"active",priority:"normal",dueAt:null,locationRef:workplaceRef,sourceRef:F({kind:"employment-contract",id:contractId}),employerRef,workBlocks:F(blocks),persistentSource:"ProtagonistEmployment",persistent:true,proposalOnly:true}));
  }
 }
 const house=housing(s,when,identityValue);
 if(house?.ok===true&&P(house.obligation)&&house.obligation.state&&house.obligation.state!=="none"&&obligations.length<MAX_OBLIGATIONS){
  const o=house.obligation,residenceRef=ref(house.residenceRef),rawId=I(o.obligationId)||("housing-"+H(S({seed:s,residenceRef,amount:o.amountCopper,nextDueAt:o.nextDueAt}))),id="OBL-HOU-"+H(S({seed:s,rawId}));
  obligations.push(F({id,kind:"housing-obligation",category:"housing-payment",label:"Meet housing obligation",state:I(o.state,32),priority:I(o.priority,24)||"low",dueAt:validTs(o.nextDueAt)?String(o.nextDueAt):null,amountCopper:Number.isFinite(Number(o.amountCopper))?Math.max(0,Math.floor(Number(o.amountCopper))):null,locationRef:residenceRef,sourceRef:F({kind:"housing-obligation",id:rawId}),persistentSource:"ProtagonistHousing",persistent:true,proposalOnly:true}));
 }
 const ordered=obligations.slice(0,MAX_OBLIGATIONS).sort((a,b)=>priorityRank(b.priority)-priorityRank(a.priority)||String(a.id).localeCompare(String(b.id)));
 const result={ok:true,version:VERSION,fantasyTimestamp:when,role:F({roleId:I(auth.currentRole.roleId,80),title:T(auth.currentRole.title,120),rankTier:Number(auth.currentRole.rankTier),rankLabel:I(auth.currentRole.rankLabel,80),scopes:F(scopes)}),duties:F(duties.slice(0,MAX_DUTIES)),privileges:F(privileges.slice(0,MAX_PRIVILEGES)),restrictedActions:F(restrictedActions.slice(0,MAX_RESTRICTIONS)),obligations:F(ordered),sources:F({authority:"ProtagonistAuthority",employment:emp?.ok===true?"ProtagonistEmployment":"unavailable",housing:house?.ok===true?"ProtagonistHousing":"unavailable"}),bounds:F({maxScopes:MAX_SCOPES,maxPrivileges:MAX_PRIVILEGES,maxRestrictions:MAX_RESTRICTIONS,maxDuties:MAX_DUTIES,maxObligations:MAX_OBLIGATIONS,maxWorkBlocks:MAX_WORK_BLOCKS,maxResultBytes:MAX_RESULT_BYTES}),readOnly:true,proposalOnly:true,eventDriven:true,derivedStateOnly:true,persistenceAuthority:"underlying source systems only",chronologyAuthority:"Fantasy Game Time",privilegeGuaranteesSuccess:false,simulationValidationRequired:true,authorityMutation:false,economyMutation:false,propertyMutation:false,militaryMutation:false,legalMutation:false,relationshipMutation:false,worldMutation:false,resourceFabrication:false,actorFabrication:false,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false};
 const bytes=B(S(result));if(bytes>MAX_RESULT_BYTES)return F({ok:false,reason:"status-context-over-budget",serializedBytes:bytes,maxResultBytes:MAX_RESULT_BYTES});
 result.serializedBytes=bytes;return F(result);
}
function checkPrivilege(seedValue,categoryValue,whenValue,identityValue){
 const category=I(categoryValue,120),rule=PRIVILEGE_RULES.find(x=>x.category===category);if(!rule)return F({ok:false,reason:"unsupported-privilege-category",category,permitted:false,readOnly:true});
 const state=resolve(seedValue,whenValue,identityValue);if(!state.ok)return F({ok:false,reason:state.reason,category,permitted:false,readOnly:true});
 const permitted=state.role.scopes.includes(rule.scope);return F({ok:true,reason:permitted?"scope-present":"missing-authority-scope",category,requiredScope:rule.scope,permitted,permissionOnly:true,guaranteedSuccess:false,simulationValidationRequired:true,readOnly:true,directActionExecution:false});
}
function decisionContext(seedValue,whenValue,identityValue){
 const state=resolve(seedValue,whenValue,identityValue);if(!state.ok)return state;
 return F({ok:true,version:VERSION,fantasyTimestamp:state.fantasyTimestamp,role:state.role,duties:state.duties,privileges:state.privileges,restrictedActions:state.restrictedActions,obligations:state.obligations,bounds:state.bounds,readOnly:true,proposalOnly:true,simulationValidationRequired:true,directActionExecution:false,worldMutation:false,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false});
}
function telemetry(){return F({version:VERSION,bounded:true,eventDriven:true,derivedStateOnly:true,maxScopes:MAX_SCOPES,maxPrivileges:MAX_PRIVILEGES,maxRestrictions:MAX_RESTRICTIONS,maxDuties:MAX_DUTIES,maxObligations:MAX_OBLIGATIONS,maxWorkBlocks:MAX_WORK_BLOCKS,maxResultBytes:MAX_RESULT_BYTES,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,authorityMutation:false,economyMutation:false,propertyMutation:false,militaryMutation:false,legalMutation:false,relationshipMutation:false,worldMutation:false})}
return F({VERSION,MAX_SCOPES,MAX_PRIVILEGES,MAX_RESTRICTIONS,MAX_DUTIES,MAX_OBLIGATIONS,MAX_WORK_BLOCKS,MAX_RESULT_BYTES,PRIVILEGE_RULES,DUTY_RULES,resolve,checkPrivilege,decisionContext,telemetry});
});
