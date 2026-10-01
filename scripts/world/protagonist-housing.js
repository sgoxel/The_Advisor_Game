(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistHousing=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-housing-v1",SCHEMA="ProtagonistHousingLedger",SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-housing-ledger",REGISTRY_KEY="residence-and-obligations";
const MAX_HISTORY=24,MAX_PAYMENTS=48,MAX_OPERATION_IDS=64,MAX_QUERY_RESULTS=12,MAX_LEDGER_BYTES=32768,RENT_CADENCE_DAYS=7;
const BASIS=Object.freeze(["seed-free-shelter","free","owned","rented"]);
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]))}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v??"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function B(v){return typeof TextEncoder!=="undefined"?new TextEncoder().encode(String(v)).length:String(v).length}
function T(v,n=160){return String(v??"").trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function P(v){return!!v&&typeof v==="object"&&!Array.isArray(v)}
function seed(v){const s=T(v);if(!s)throw new Error("Campaign SEED is required.");return s}
function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""))}
function ts(v){const x=T(v,32);if(!validTs(x))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return x}
function actor(s,k){try{return root?.ProtagonistProfile?.derive?.(s,k)?.protagonistId||("PROTAGONIST-"+H(s+"|"+k+"|identity-v1"))}catch(_){return"PROTAGONIST-"+H(s+"|"+k+"|identity-v1")}}
function ref(v){if(!P(v))return null;const kind=I(v.kind||v.type,64),id=I(v.id||v.refId||v.entityId,160);return kind&&id?F({kind,id}):null}
function auth(s,v){const x=P(v)?v:{};if(x.authority!=="simulation"||x.authoritative!==true)return{ok:false,reason:"simulation-authority-required"};if(T(x.campaignSeed)!==s)return{ok:false,reason:"campaign-seed-mismatch"};const operationId=I(x.operationId||x.eventId||x.id);if(!operationId)return{ok:false,reason:"operation-id-required"};try{return{ok:true,operationId,fantasyTimestamp:ts(x.fantasyTimestamp||x.timestamp)}}catch(e){return{ok:false,reason:String(e.message||e)}}}
function parseStamp(v){const m=/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v||""));if(!m)return null;const y=+m[1],mo=+m[2],d=+m[3],h=+m[4],mi=+m[5],sec=+m[6];if(mo<1||mo>12||d<1||d>31||h>23||mi>59||sec>59)return null;return{y,mo,d,h,mi,sec}}
function dayNumber(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe-719468}
function civil(day){let z=day+719468;const era=Math.floor(z/146097),doe=z-era*146097,yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);let y=yoe+era*400;const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100)),mp=Math.floor((5*doy+2)/153),d=doy-Math.floor((153*mp+2)/5)+1,m=mp+(mp<10?3:-9);y+=m<=2?1:0;return{y,m,d}}
function scalar(v){const p=parseStamp(v);return p?dayNumber(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.sec:null}
function addDays(v,days){const p=parseStamp(v);if(!p)return null;const c=civil(dayNumber(p.y,p.mo,p.d)+Math.floor(days)),pad=n=>String(n).padStart(2,"0");return String(c.y).padStart(4,"0")+"-"+pad(c.m)+"-"+pad(c.d)+" "+pad(p.h)+":"+pad(p.mi)+":"+pad(p.sec)}
function residenceCatalog(seedValue){
  const s=seed(seedValue),rows=[];
  for(const x of (root?.HousePlans?.build?.(s)||[]).slice(0,8)){
    const rid=I(x?.id);if(!rid)continue;
    const interior=root?.BuildingInteriors?.get?.(s,rid);
    rows.push(F({residenceRef:F({kind:"building",id:rid}),residenceType:I(x?.kind||"house",48)||"house",label:T(interior?.label||("Home "+rid),96),sourceSystem:"HousePlans",rentEligible:true}));
  }
  for(const x of (root?.SpecialLots?.build?.(s)||[]).slice(0,12)){
    if(x?.function!=="lodging"||x?.enterable!==true)continue;
    const rid=I(x.id);if(!rid||rows.some(r=>r.residenceRef.id===rid))continue;
    rows.push(F({residenceRef:F({kind:"building",id:rid}),residenceType:I(x.kind||"lodging",48)||"lodging",label:T(x.label||("Lodging "+rid),96),sourceSystem:"SpecialLots",rentEligible:true}));
  }
  return F(rows.slice(0,12));
}
function resolveResidence(seedValue,value){const r=ref(value),rows=residenceCatalog(seedValue);if(!r)return null;const found=rows.find(x=>x.residenceRef.id===r.id);return found?F(C(found)):null}
function ctx(seedValue,identityValue){const s=seed(seedValue),identityKey=I(identityValue||"protagonist",96)||"protagonist",protagonistId=actor(s,identityKey),ws=root?.WorldState,structural=ws?.structuralRef?.(s,REGISTRY_KIND,protagonistId,REGISTRY_KEY,{role:"protagonist-housing",protagonistId,identityKey,authority:"ProtagonistHousing"})||null;return F({seed:s,identityKey,protagonistId,ref:structural})}
function foundation(c){
  const rows=residenceCatalog(c.seed),homes=rows.filter(x=>x.sourceSystem==="HousePlans");if(!rows.length)return null;
  const source=homes.length?homes:rows,picked=source[parseInt(H(c.seed+"|"+c.protagonistId+"|starting-shelter-v1"),16)%source.length];
  const payload={seed:c.seed,protagonistId:c.protagonistId,residenceRef:picked.residenceRef,occupancyBasis:"seed-free-shelter",sourceRef:{kind:"campaign-seed-foundation",id:"STARTING-SHELTER-"+H(c.seed+"|"+c.protagonistId)},version:VERSION};
  return F({id:"HSG-"+H(S(payload)),residenceRef:F(C(picked.residenceRef)),residenceType:picked.residenceType,residenceLabel:picked.label,residenceSourceSystem:picked.sourceSystem,occupancyBasis:"seed-free-shelter",rentCopper:0,currency:"copper",cadenceDays:0,validFrom:null,lastPaidCycle:0,sourceRef:F(payload.sourceRef),establishedBy:"Campaign SEED foundation",foundation:true});
}
function empty(c){return{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:c.seed,protagonistId:c.protagonistId,identityKey:c.identityKey,registryId:c.ref?.id||null,revision:0,current:C(foundation(c)),history:[],payments:[],recentOperations:[]}}
function arrangementValid(x,c){
  if(!P(x)||!/^HSG-[0-9A-F]{8}$/.test(String(x.id||""))||!BASIS.includes(x.occupancyBasis)||!ref(x.residenceRef)||!resolveResidence(c.seed,x.residenceRef)||!ref(x.sourceRef)||!Number.isInteger(x.rentCopper)||x.rentCopper<0||x.rentCopper>1000||!Number.isInteger(x.cadenceDays)||x.cadenceDays<0||x.cadenceDays>31||!Number.isInteger(x.lastPaidCycle)||x.lastPaidCycle<0)return false;
  if(x.foundation===true){const f=foundation(c);return!!f&&S(x)===S(f)}
  if(x.foundation!==false||x.occupancyBasis==="seed-free-shelter"||!validTs(x.validFrom))return false;
  const expected="HSG-"+H(S({seed:c.seed,protagonistId:c.protagonistId,residenceRef:x.residenceRef,occupancyBasis:x.occupancyBasis,validFrom:x.validFrom,sourceRef:x.sourceRef,version:VERSION}));
  if(expected!==x.id)return false;
  if(x.occupancyBasis==="rented")return x.rentCopper>0&&x.cadenceDays===RENT_CADENCE_DAYS;
  return x.rentCopper===0&&x.cadenceDays===0;
}
function paymentValid(x){return P(x)&&/^RNP-[0-9A-F]{8}$/.test(String(x.paymentId||""))&&/^OBL-[0-9A-F]{8}$/.test(String(x.obligationId||""))&&/^HSG-[0-9A-F]{8}$/.test(String(x.arrangementId||""))&&Number.isInteger(x.cycle)&&x.cycle>0&&Number.isInteger(x.amount)&&x.amount>0&&validTs(x.dueAt)&&validTs(x.fantasyTimestamp)&&I(x.wealthOperationId)===x.wealthOperationId&&(x.status==="pending"||x.status==="paid")&&(x.status!=="paid"||/^TXN-[0-9A-F]{8}$/.test(String(x.transactionId||"")))}
function compatible(l,c){
  if(!P(l)||l.schema!==SCHEMA||l.schemaVersion!==SCHEMA_VERSION||l.version!==VERSION||l.seed!==c.seed||l.protagonistId!==c.protagonistId||l.identityKey!==c.identityKey||l.registryId!==(c.ref?.id||null)||!Number.isInteger(l.revision)||l.revision<0||!arrangementValid(l.current,c)||!Array.isArray(l.history)||l.history.length>MAX_HISTORY||!Array.isArray(l.payments)||l.payments.length>MAX_PAYMENTS||!Array.isArray(l.recentOperations)||l.recentOperations.length>MAX_OPERATION_IDS)return false;
  for(const x of l.history)if(!arrangementValid(x,c))return false;
  for(const x of l.payments)if(!paymentValid(x))return false;
  const ops=new Set();for(const x of l.recentOperations){if(!P(x)||!I(x.operationId)||!/^SIG-[0-9A-F]{16}$/.test(String(x.signature||""))||!/^HSG-[0-9A-F]{8}$/.test(String(x.arrangementId||""))||ops.has(x.operationId))return false;ops.add(x.operationId)}
  return B(S(l))<=MAX_LEDGER_BYTES;
}
function read(seedValue,identityValue){const c=ctx(seedValue,identityValue),f=foundation(c);if(!f)return{ok:false,c,ledger:null,reason:"foundation-residence-unavailable"};const resolved=c.ref&&root?.WorldState?.resolve?.(c.seed,c.ref),raw=resolved?.current?.protagonistHousing;if(raw==null)return{ok:true,c,ledger:empty(c),reason:"foundation"};return compatible(raw,c)?{ok:true,c,ledger:C(raw),reason:"ok"}:{ok:false,c,ledger:null,reason:"housing-ledger-incompatible"}}
function write(seedValue,identityValue,l,reason){const r=read(seedValue,identityValue);if(!r.ok)return F({ok:false,reason:r.reason});if(!r.c.ref||!root?.WorldState?.applyDelta)return F({ok:false,reason:"world-state-unavailable"});const n=C(l);Object.assign(n,{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:r.c.seed,protagonistId:r.c.protagonistId,identityKey:r.c.identityKey,registryId:r.c.ref.id,revision:(Number(n.revision)||0)+1});if(!compatible(n,r.c))return F({ok:false,reason:"housing-invalid-or-over-budget"});const out=root.WorldState.applyDelta(r.c.seed,r.c.ref,{protagonistHousing:n},reason);return F({ok:!!out?.ok,reason:out?.reason||"ok",ledgerRevision:n.revision,serializedBytes:B(S(n)),deltaRevision:Number(out?.entry?.revision||0)})}
function arrangementSignature(c,a,input,residence){const payload=S({version:VERSION,seed:c.seed,protagonistId:c.protagonistId,operationId:a.operationId,fantasyTimestamp:a.fantasyTimestamp,residenceRef:residence.residenceRef,occupancyBasis:input.occupancyBasis,sourceRef:input.sourceRef});return"SIG-"+H("A|"+payload)+H("B|"+payload)}
function remember(l,row){l.recentOperations=[...l.recentOperations.filter(x=>x.operationId!==row.operationId),row].slice(-MAX_OPERATION_IDS)}
function establish(seedValue,inputValue,optionsValue,identityValue){
  let s;try{s=seed(seedValue)}catch(e){return F({ok:false,reason:String(e.message||e)})}
  const a=auth(s,optionsValue);if(!a.ok)return F(a);
  const input=P(inputValue)?inputValue:{},basis=I(input.occupancyBasis,48).toLowerCase(),sourceRef=ref(input.sourceRef),residence=resolveResidence(s,input.residenceRef);
  if(!["free","owned","rented"].includes(basis))return F({ok:false,reason:"occupancy-basis-invalid"});
  if(!sourceRef)return F({ok:false,reason:"housing-source-reference-required"});
  if(!residence)return F({ok:false,reason:"residence-mismatch"});
  const r=read(s,identityValue);if(!r.ok)return F({ok:false,reason:r.reason});
  const normalized={occupancyBasis:basis,sourceRef},sig=arrangementSignature(r.c,a,normalized,residence),found=r.ledger.recentOperations.find(x=>x.operationId===a.operationId);
  if(found){if(found.signature!==sig)return F({ok:false,reason:"duplicate-operation-conflict"});const prior=[r.ledger.current,...r.ledger.history].find(x=>x.id===found.arrangementId)||r.ledger.current;return F({ok:true,reason:"duplicate-arrangement",duplicate:true,arrangement:F(C(prior))})}
  const rentCopper=basis==="rented"?4+(parseInt(H(S({seed:s,protagonistId:r.c.protagonistId,residenceRef:residence.residenceRef,sourceRef,version:VERSION})),16)%7):0,cadenceDays=basis==="rented"?RENT_CADENCE_DAYS:0;
  const payload={seed:s,protagonistId:r.c.protagonistId,residenceRef:residence.residenceRef,occupancyBasis:basis,validFrom:a.fantasyTimestamp,sourceRef,version:VERSION};
  const arrangement=F({id:"HSG-"+H(S(payload)),residenceRef:F(C(residence.residenceRef)),residenceType:residence.residenceType,residenceLabel:residence.label,residenceSourceSystem:residence.sourceSystem,occupancyBasis:basis,rentCopper,currency:"copper",cadenceDays,validFrom:a.fantasyTimestamp,lastPaidCycle:0,sourceRef:F(C(sourceRef)),establishedBy:"validated Simulation housing outcome",foundation:false});
  const l=C(r.ledger);l.history=[...l.history,C(l.current)].slice(-MAX_HISTORY);l.current=C(arrangement);remember(l,{operationId:a.operationId,signature:sig,arrangementId:arrangement.id});
  const w=write(s,identityValue,l,"protagonist-housing-establish:"+arrangement.id);
  return F({...w,duplicate:false,arrangement:w.ok?arrangement:null});
}
function obligationFromArrangement(a,when){
  if(!a||a.occupancyBasis!=="rented")return null;
  const cycle=a.lastPaidCycle+1,dueAt=addDays(a.validFrom,a.cadenceDays*cycle);if(!dueAt)return null;
  const now=scalar(when),due=scalar(dueAt);if(now==null||due==null)return null;
  const status=now<due?"upcoming":now===due?"due":"overdue",obligationId="OBL-"+H(S({arrangementId:a.id,cycle,dueAt,amount:a.rentCopper,version:VERSION}));
  return F({obligationId,arrangementId:a.id,residenceRef:F(C(a.residenceRef)),cycle,amount:a.rentCopper,currency:a.currency,cadenceDays:a.cadenceDays,dueAt,status,overdue:status==="overdue",paymentRequired:status!=="upcoming",sourceRef:F({kind:"housing-arrangement",id:a.id})});
}
function obligation(seedValue,whenValue,identityValue){let when;try{when=ts(whenValue)}catch(e){return F({ok:false,reason:String(e.message||e),obligation:null})}const r=read(seedValue,identityValue);if(!r.ok)return F({ok:false,reason:r.reason,obligation:null});const o=obligationFromArrangement(r.ledger.current,when);return F({ok:true,reason:o?o.status:"no-rent-obligation",obligation:o,readOnly:true})}
function removePending(seedValue,identityValue,paymentId){const r=read(seedValue,identityValue);if(!r.ok)return;const l=C(r.ledger),before=l.payments.length;l.payments=l.payments.filter(x=>!(x.paymentId===paymentId&&x.status==="pending"));if(l.payments.length!==before)write(seedValue,identityValue,l,"protagonist-housing-payment-abort:"+paymentId)}
function pay(seedValue,inputValue,optionsValue,identityValue){
  let s;try{s=seed(seedValue)}catch(e){return F({ok:false,reason:String(e.message||e)})}
  const a=auth(s,optionsValue);if(!a.ok)return F(a);
  const r=read(s,identityValue);if(!r.ok)return F({ok:false,reason:r.reason});
  const input=P(inputValue)?inputValue:{},inputObligation=I(input.obligationId),inputResidence=ref(input.residenceRef),existing=inputObligation?r.ledger.payments.find(x=>x.obligationId===inputObligation):null;
  if(existing?.status==="paid")return F({ok:true,reason:"duplicate-rent-payment",duplicate:true,paymentId:existing.paymentId,obligationId:existing.obligationId,transactionId:existing.transactionId,amount:existing.amount,currency:"copper",residenceRef:F(C(r.ledger.current.residenceRef))});
  const o=obligationFromArrangement(r.ledger.current,a.fantasyTimestamp);if(!o)return F({ok:false,reason:"no-rent-obligation"});
  if(inputObligation!==o.obligationId)return F({ok:false,reason:"obligation-mismatch",currentObligationId:o.obligationId});
  if(!inputResidence||S(inputResidence)!==S(o.residenceRef))return F({ok:false,reason:"residence-mismatch"});
  if(o.status==="upcoming")return F({ok:false,reason:"rent-not-due",obligation:o});
  let payment=existing||null;if(payment&&payment.arrangementId!==o.arrangementId)return F({ok:false,reason:"payment-arrangement-mismatch"});
  if(!payment){
    const paymentId="RNP-"+H(o.obligationId),operationId="RENT-"+H(paymentId),row={paymentId,obligationId:o.obligationId,arrangementId:o.arrangementId,cycle:o.cycle,amount:o.amount,dueAt:o.dueAt,fantasyTimestamp:a.fantasyTimestamp,status:"pending",transactionId:null,wealthOperationId:operationId};
    const l=C(r.ledger);l.payments=[...l.payments,C(row)].slice(-MAX_PAYMENTS);
    const prep=write(s,identityValue,l,"protagonist-housing-payment-prepare:"+paymentId);if(!prep.ok)return F({ok:false,reason:prep.reason});
    payment=F(row);
  }
  const wealth=root?.ProtagonistWealth;if(!wealth?.debit){removePending(s,identityValue,payment.paymentId);return F({ok:false,reason:"protagonist-wealth-unavailable",obligation:o})}
  const debited=wealth.debit(s,payment.amount,{reasonCode:"housing-rent",sourceRef:{kind:"housing-obligation",id:payment.obligationId},transferRef:{kind:"residence",id:o.residenceRef.id}},{authority:"simulation",authoritative:true,campaignSeed:s,operationId:payment.wealthOperationId,fantasyTimestamp:payment.fantasyTimestamp},identityValue);
  if(!debited?.ok){removePending(s,identityValue,payment.paymentId);return F({ok:false,reason:debited?.reason||"rent-debit-failed",insufficientFunds:debited?.reason==="insufficient-funds",obligation:o,balance:debited?.balance??null,required:payment.amount,currencyChanged:false})}
  const refreshed=read(s,identityValue);if(!refreshed.ok)return F({ok:false,reason:refreshed.reason,currencyMayBeCommitted:true,transactionId:debited.transactionId});
  const l=C(refreshed.ledger),row=l.payments.find(x=>x.paymentId===payment.paymentId);if(!row)return F({ok:false,reason:"housing-payment-record-missing",currencyMayBeCommitted:true,transactionId:debited.transactionId});
  row.status="paid";row.transactionId=I(debited.transactionId);if(l.current.id===o.arrangementId)l.current.lastPaidCycle=Math.max(l.current.lastPaidCycle,o.cycle);
  const saved=write(s,identityValue,l,"protagonist-housing-payment-paid:"+payment.paymentId);
  if(!saved.ok)return F({ok:false,reason:"housing-payment-finalize-failed",currencyMayBeCommitted:true,transactionId:debited.transactionId,paymentId:payment.paymentId});
  return F({ok:true,reason:debited.duplicate?"duplicate-rent-payment":"rent-paid",duplicate:debited.duplicate===true,paymentId:payment.paymentId,obligationId:o.obligationId,transactionId:I(debited.transactionId),amount:o.amount,currency:o.currency,residenceRef:F(C(o.residenceRef)),cycle:o.cycle,currencyChanged:debited.duplicate!==true,authority:"Simulation housing obligation -> ProtagonistWealth"});
}
function recentPayments(seedValue,optionsValue,identityValue){const r=read(seedValue,identityValue);if(!r.ok)return F([]);const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(optionsValue?.limit)||MAX_QUERY_RESULTS)));return F(C(r.ledger.payments).reverse().slice(0,limit).map(F))}
function snapshot(seedValue,whenValue,identityValue){const r=read(seedValue,identityValue);if(!r.ok)return F({version:VERSION,compatible:false,reason:r.reason,current:null});const when=validTs(whenValue)?String(whenValue):null,o=when?obligationFromArrangement(r.ledger.current,when):null;return F({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,current:F(C(r.ledger.current)),obligation:o,paymentCount:r.ledger.payments.length,historyCount:r.ledger.history.length,recentPayments:F(C(r.ledger.payments).slice(-MAX_QUERY_RESULTS).reverse().map(F)),serializedBytes:B(S(r.ledger)),bounds:F({maxHistory:MAX_HISTORY,maxPayments:MAX_PAYMENTS,maxOperationIds:MAX_OPERATION_IDS,maxQueryResults:MAX_QUERY_RESULTS,maxLedgerBytes:MAX_LEDGER_BYTES,maxResidenceCatalog:12}),persistenceAuthority:"WorldState CampaignStateDelta",foundationAuthority:"Campaign SEED + bounded real Starting Village residences",changeAuthority:"validated Simulation housing outcomes only",paymentAuthority:"ProtagonistWealth debit only",chronologyAuthority:"Fantasy Game Time",eventDriven:true,bounded:true,fullWorldScan:false,fullSettlementScan:false,wholePropertyScan:false,wholeHistoryScan:false,perFrameBilling:false,directCurrencyMutation:false,directWorldMutation:false,ownershipAuthority:false,evictionAuthority:false,relationshipAuthority:false,presentationAuthority:false})}
function decisionContext(seedValue,whenValue,identityValue){const s=snapshot(seedValue,whenValue,identityValue);if(!s.compatible)return F({available:false,reason:s.reason,source:"ProtagonistHousing",readOnly:true});const o=s.obligation,status=o?.status||"shelter-secure",pressure=status==="overdue"?100000:status==="due"?75000:status==="upcoming"?25000:0;return F({available:true,arrangementId:s.current.id,residenceRef:F(C(s.current.residenceRef)),occupancyBasis:s.current.occupancyBasis,obligationId:o?.obligationId||null,obligationStatus:status,dueCopper:o?.amount||0,overdue:status==="overdue",pressureMilli:pressure,source:"ProtagonistHousing authoritative state",readOnly:true,bounded:true,directActionExecution:false,forcedEviction:false,directCurrencyMutation:false})}
return F({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,MAX_HISTORY,MAX_PAYMENTS,MAX_OPERATION_IDS,MAX_QUERY_RESULTS,MAX_LEDGER_BYTES,RENT_CADENCE_DAYS,residenceCatalog,resolveResidence,establish,obligation,pay,recentPayments,snapshot,decisionContext});
});
