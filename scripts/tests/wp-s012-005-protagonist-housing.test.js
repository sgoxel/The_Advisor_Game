const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const C=v=>v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(C):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]));
function merge(a,b){const o=C(a||{});for(const[k,v]of Object.entries(b||{}))o[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(o[k],v):C(v);return o}
function H(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
const stores=new Map(),fresh=s=>({schema:'CampaignStateDelta',seed:s,sequence:0,entries:{}}),ensure=s=>(stores.has(s)||stores.set(s,fresh(s)),stores.get(s));
global.WorldState={
  structuralRef(s,k,p,keyName,initial){return{id:'STR|'+k.toUpperCase()+'|'+H([s,k,p,keyName].join('|')),kind:k,key:{initial:C(initial||{})}}},
  resolve(s,r){const st=ensure(s),e=st.entries[r.id];return{current:merge(r.key?.initial||{},e?.changes||{}),delta:e||null}},
  applyDelta(s,r,changes,reason){const st=ensure(s),p=st.entries[r.id];st.sequence++;st.entries[r.id]={revision:(p?.revision||0)+1,reason,changes:merge(p?.changes||{},changes)};return{ok:true,reason:'ok',entry:C(st.entries[r.id])}},
  serializeState(s){return C(ensure(s))},
  restoreSerializedState(c,x){stores.set(String(c.seed),C(x));return{ok:true}}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1'),personality:{traits:{resolve:55,ambition:45,caution:55,empathy:60}}}}};
global.HousePlans={build(){return[{id:'H1',kind:'house'},{id:'H2',kind:'cabin'},{id:'H3',kind:'house'}]}};
global.SpecialLots={build(){return[{id:'S1',kind:'tavern',label:'Tavern & Lodging',function:'lodging',enterable:true},{id:'S2',kind:'shop',label:'Village Shop',function:'market',enterable:true}]}};
global.BuildingInteriors={get(_s,id){return{label:id==='H1'?'North House':id==='H2'?'River Cabin':'South House'}}};

const Wealth=require(path.resolve(__dirname,'../world/protagonist-wealth.js'));global.ProtagonistWealth=Wealth;
const Housing=require(path.resolve(__dirname,'../world/protagonist-housing.js'));global.ProtagonistHousing=Housing;
const DecisionContext=require(path.resolve(__dirname,'../world/protagonist-decision-context.js'));
const seed='WP-S012-005-A',other='WP-S012-005-B',foundationWhen='1201-05-01 08:00:00';
const sim=(when,operationId,seedValue=seed)=>({authority:'simulation',authoritative:true,campaignSeed:seedValue,operationId,fantasyTimestamp:when});

const foundation=Housing.snapshot(seed,foundationWhen);
assert(foundation.compatible);assert.equal(foundation.current.occupancyBasis,'seed-free-shelter');assert.equal(foundation.current.rentCopper,0);assert.equal(foundation.current.residenceSourceSystem,'HousePlans');assert(Housing.resolveResidence(seed,foundation.current.residenceRef));assert.equal(foundation.obligation,null);

const ownedInput={occupancyBasis:'owned',residenceRef:{kind:'building',id:'H2'},sourceRef:{kind:'simulation-housing-result',id:'OWN-1'}};
const owned=Housing.establish(seed,ownedInput,sim('1201-05-01 09:00:00','EST-OWN'));
assert(owned.ok&&!owned.duplicate);assert.equal(owned.arrangement.occupancyBasis,'owned');assert.equal(owned.arrangement.rentCopper,0);assert.equal(Housing.obligation(seed,'1201-05-20 09:00:00').obligation,null);
const ownedDup=Housing.establish(seed,ownedInput,sim('1201-05-01 09:00:00','EST-OWN'));assert(ownedDup.ok&&ownedDup.duplicate&&ownedDup.arrangement.id===owned.arrangement.id);
const ownedConflict=Housing.establish(seed,{...ownedInput,occupancyBasis:'free'},sim('1201-05-01 09:00:00','EST-OWN'));assert(!ownedConflict.ok&&ownedConflict.reason==='duplicate-operation-conflict');

const invalidResidence=Housing.establish(seed,{occupancyBasis:'rented',residenceRef:{kind:'building',id:'S999'},sourceRef:{kind:'simulation-housing-result',id:'RENT-BAD'}},sim('1201-05-02 09:00:00','EST-BAD'));
assert(!invalidResidence.ok&&invalidResidence.reason==='residence-mismatch');

const rentInput={occupancyBasis:'rented',residenceRef:{kind:'building',id:'S1'},sourceRef:{kind:'simulation-housing-result',id:'RENT-1'}};
const rented=Housing.establish(seed,rentInput,sim('1201-05-02 09:00:00','EST-RENT'));
assert(rented.ok&&!rented.duplicate);assert.equal(rented.arrangement.occupancyBasis,'rented');assert.equal(rented.arrangement.residenceSourceSystem,'SpecialLots');assert(rented.arrangement.rentCopper>=4&&rented.arrangement.rentCopper<=10);assert.equal(rented.arrangement.cadenceDays,7);

const upcoming=Housing.obligation(seed,'1201-05-08 09:00:00').obligation;assert(upcoming&&upcoming.status==='upcoming');
const due=Housing.obligation(seed,'1201-05-09 09:00:00').obligation;assert(due&&due.status==='due'&&/^OBL-/.test(due.obligationId));
const overdue=Housing.obligation(seed,'1201-05-09 10:00:00').obligation;assert(overdue&&overdue.status==='overdue'&&overdue.overdue);

const baseCtx=DecisionContext.build({seed,when:'1201-05-09 10:00:00',snapshots:{}});
const housingRead=Housing.decisionContext(seed,'1201-05-09 10:00:00');
const housingCtx=DecisionContext.build({seed,when:'1201-05-09 10:00:00',snapshots:{housing:housingRead}});
assert(baseCtx.ok&&housingCtx.ok);assert(housingCtx.factors.housing.available);assert(housingCtx.reasons.includes('housing-obligation-overdue'));assert(housingCtx.decisionContext.urgency>baseCtx.decisionContext.urgency);assert.equal(housingCtx.authority.directActionExecution,false);assert.equal(housingCtx.authority.housingAuthority,false);assert.equal(housingRead.forcedEviction,false);

const balanceBeforeMismatch=Wealth.snapshot(seed).balance;
const mismatchedPayment=Housing.pay(seed,{obligationId:overdue.obligationId,residenceRef:{kind:'building',id:'H1'}},sim('1201-05-09 10:01:00','PAY-BAD'));
assert(!mismatchedPayment.ok&&mismatchedPayment.reason==='residence-mismatch');assert.equal(Wealth.snapshot(seed).balance,balanceBeforeMismatch);

const drainAmount=Wealth.snapshot(seed).balance;assert(drainAmount>0);
const drain=Wealth.debit(seed,drainAmount,{reasonCode:'test-drain',sourceRef:{kind:'test',id:'DRAIN'}},sim('1201-05-09 10:02:00','DRAIN-FUNDS'));
assert(drain.ok&&Wealth.snapshot(seed).balance===0);
const insufficient=Housing.pay(seed,{obligationId:overdue.obligationId,residenceRef:overdue.residenceRef},sim('1201-05-09 10:03:00','PAY-LOW'));
assert(!insufficient.ok&&insufficient.reason==='insufficient-funds'&&insufficient.insufficientFunds===true&&insufficient.currencyChanged===false);assert.equal(Housing.snapshot(seed,'1201-05-09 10:04:00').paymentCount,0);assert.equal(Housing.obligation(seed,'1201-05-09 10:04:00').obligation.status,'overdue');

const topup=Wealth.credit(seed,50,{reasonCode:'test-topup',sourceRef:{kind:'test',id:'TOPUP'}},sim('1201-05-09 10:05:00','TOPUP-FUNDS'));assert(topup.ok);
const beforePay=Wealth.snapshot(seed).balance;
const paid=Housing.pay(seed,{obligationId:overdue.obligationId,residenceRef:overdue.residenceRef},sim('1201-05-09 10:06:00','PAY-GOOD'));
assert(paid.ok&&!paid.duplicate&&/^RNP-/.test(paid.paymentId)&&/^TXN-/.test(paid.transactionId));assert.equal(Wealth.snapshot(seed).balance,beforePay-paid.amount);
const balanceAfterPay=Wealth.snapshot(seed).balance;
const duplicatePay=Housing.pay(seed,{obligationId:overdue.obligationId,residenceRef:overdue.residenceRef},sim('1201-05-09 10:07:00','PAY-DUP'));
assert(duplicatePay.ok&&duplicatePay.duplicate&&duplicatePay.transactionId===paid.transactionId);assert.equal(Wealth.snapshot(seed).balance,balanceAfterPay);assert.equal(Housing.snapshot(seed,'1201-05-09 10:08:00').current.lastPaidCycle,1);

const secondCycle=Housing.obligation(seed,'1201-05-16 09:00:00').obligation;
assert(secondCycle&&secondCycle.cycle===2&&secondCycle.status==='due'&&secondCycle.obligationId!==overdue.obligationId);

const saved=C(WorldState.serializeState(seed)),preReloadHousing=Housing.snapshot(seed,'1201-05-16 09:00:00'),preReloadWealth=Wealth.snapshot(seed);
stores.set(seed,fresh(seed));assert.equal(Housing.snapshot(seed,'1201-05-16 09:00:00').current.occupancyBasis,'seed-free-shelter');
WorldState.restoreSerializedState({seed},saved);
delete require.cache[require.resolve(path.resolve(__dirname,'../world/protagonist-housing.js'))];
const Reloaded=require(path.resolve(__dirname,'../world/protagonist-housing.js'));global.ProtagonistHousing=Reloaded;
assert.deepStrictEqual(Reloaded.snapshot(seed,'1201-05-16 09:00:00'),preReloadHousing);assert.equal(Wealth.snapshot(seed).balance,preReloadWealth.balance);
const dupAfterReload=Reloaded.pay(seed,{obligationId:overdue.obligationId,residenceRef:overdue.residenceRef},sim('1201-05-16 10:00:00','PAY-RELOAD-DUP'));
assert(dupAfterReload.ok&&dupAfterReload.duplicate&&dupAfterReload.transactionId===paid.transactionId);

const otherFoundation=Reloaded.snapshot(other,foundationWhen);
assert(otherFoundation.compatible&&otherFoundation.paymentCount===0&&otherFoundation.current.occupancyBasis==='seed-free-shelter');
assert.equal(Reloaded.establish(other,rentInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'BAD-SEED',fantasyTimestamp:'1201-05-02 09:00:00'}).reason,'campaign-seed-mismatch');

const finalSnap=Reloaded.snapshot(seed,'1201-05-16 10:00:00');
assert(finalSnap.serializedBytes<=Reloaded.MAX_LEDGER_BYTES);assert(finalSnap.paymentCount<=Reloaded.MAX_PAYMENTS);assert(finalSnap.historyCount<=Reloaded.MAX_HISTORY);
for(const key of ['fullWorldScan','fullSettlementScan','wholePropertyScan','wholeHistoryScan','perFrameBilling','directCurrencyMutation','directWorldMutation','ownershipAuthority','evictionAuthority','relationshipAuthority','presentationAuthority'])assert.equal(finalSnap[key],false,key+' authority/scan must remain false');

const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script='scripts/world/protagonist-housing.js?v=protagonist-housing-v1';
assert(html.includes(script));assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-wealth.js?v=protagonist-wealth-v1'));assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-decision-context.js?v=protagonist-decision-context-v1'));
const src=fs.readFileSync(path.resolve(__dirname,'../world/protagonist-housing.js'),'utf8');
for(const bad of ['Math.random(','Date.now(','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!src.includes(bad),'non-authoritative input: '+bad);
for(const marker of ['fullWorldScan:false','wholePropertyScan:false','perFrameBilling:false','directCurrencyMutation:false','ownershipAuthority:false','evictionAuthority:false','relationshipAuthority:false'])assert(src.includes(marker),'missing guard '+marker);

console.log(JSON.stringify({
  wp:'WP-S012-005',classification:'FUNCTIONAL',visual:'N/A — authoritative housing/rent state adds no rendered surface',pass:true,
  foundationShelter:foundation.current.id,ownedShelter:owned.arrangement.id,rentalArrangement:rented.arrangement.id,firstObligation:overdue.obligationId,successfulPayment:paid.paymentId,wealthTransaction:paid.transactionId,
  insufficientFundsOverduePreserved:true,duplicateBillingProtected:true,residenceMismatchRejected:true,saveReload:true,campaignIsolation:true,decisionContextExposure:true,forcedEviction:false,directCurrencyMutation:false,directWorldMutation:false,
  bounds:finalSnap.bounds,fullWorldScan:false,wholePropertyScan:false,perFrameBilling:false
},null,2));
