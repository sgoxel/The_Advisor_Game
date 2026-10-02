'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const C=v=>v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(C):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]));
function merge(a,b){const o=C(a||{});for(const[k,v]of Object.entries(b||{}))o[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(o[k],v):C(v);return o}
function H(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
const stores=new Map(),fresh=s=>({seed:s,sequence:0,entries:{}}),ensure=s=>(stores.has(s)||stores.set(s,fresh(s)),stores.get(s));
global.WorldState={
 structuralRef(s,k,p,keyName,initial){return{id:'STR|'+String(k).toUpperCase()+'|'+H([s,k,p,keyName].join('|')),kind:k,key:{initial:C(initial||{})}}},
 resolve(s,r){const st=ensure(s),e=st.entries[r.id];return{current:merge(r.key?.initial||{},e?.changes||{}),delta:e||null}},
 applyDelta(s,r,changes,reason){const st=ensure(s),p=st.entries[r.id];st.sequence++;st.entries[r.id]={entityId:r.id,entityKind:r.kind,revision:(p?.revision||0)+1,sequence:st.sequence,reason,changes:merge(p?.changes||{},changes)};return{ok:true,reason:'ok',entry:C(st.entries[r.id]),resolved:this.resolve(s,r)}},
 serializeState(s){return C(ensure(s))},
 restoreSerializedState(c,x){stores.set(String(c.seed),C(x));return{ok:true}},
 clearFoundationCache(){}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};

const root=path.resolve(__dirname,'../..');
const plan={id:'SETTLEMENT-WP8',name:'Ashford',classId:'village',population:{planned:420},prosperity:{value:.56},tradeMarketTendency:.63,inputs:{local:{resources:{agriculture:.78,mineral:.44,timber:.61,water:.74}}}};
const composition={id:'SBC-WP8',revision:'SBCF-WP8',settlementId:plan.id,selected:[{id:'general-shop',label:'Shop',category:'trade',count:1},{id:'inn-tavern',label:'Inn',category:'trade',count:1},{id:'smithy',label:'Smithy',category:'production-storage',count:1}]};
const distantPlan={...C(plan),id:'SETTLEMENT-DISTANT',name:'Distant Ford'},distantComposition={...C(composition),id:'SBC-DISTANT',revision:'SBCF-DISTANT',settlementId:distantPlan.id};
const seed='WP-S012-008-A',other='WP-S012-008-B',t0='1201-06-01 09:00:00';
const LocalMarket=require(path.join(root,'scripts/world/local-market.js'));
const Inventory=require(path.join(root,'scripts/world/protagonist-inventory.js'));
const Wealth=require(path.join(root,'scripts/world/protagonist-wealth.js'));
const Tx=require(path.join(root,'scripts/world/economic-transaction.js'));
global.LocalMarket=LocalMarket;global.ProtagonistInventory=Inventory;global.ProtagonistWealth=Wealth;global.EconomicTransaction=Tx;
const Consequences=require(path.join(root,'scripts/world/local-market-consequences.js'));global.LocalMarketConsequences=Consequences;
const marketOptions={composition},sim=(s,when,extra={})=>({authority:'simulation',authoritative:true,campaignSeed:s,fantasyTimestamp:when,marketOptions,...extra});
function snap(s=seed,when=t0,p=plan,comp=composition){return LocalMarket.snapshot(s,when,p,{composition:comp})}
function q(s,when,kind,off,quantity=1,p=plan,comp=composition){return Tx.quote(s,when,p,{kind,offerId:off.offerId,providerRef:off.providerRef,quantity},{marketOptions:{composition:comp}})}
function inputFrom(x,requestId){const z=x.quote;return{requestId,quoteId:z.quoteId,marketSnapshotId:z.marketSnapshotId,offerId:z.offerId,providerRef:z.providerRef,subjectRef:z.subjectRef,kind:z.kind,quantity:z.quantity,unitPriceCopper:z.unitPriceCopper,totalPriceCopper:z.totalPriceCopper}}
function exec(s,p,comp,x,requestId,when){return Tx.execute(s,p,inputFrom(x,requestId),sim(s,when,{marketOptions:{composition:comp}}))}

const before=snap(),ration=before.offers.find(x=>x.itemRef?.id==='TRAVEL-RATION'),lodging=before.offers.find(x=>x.serviceRef?.id==='LODGING-NIGHT');
assert(before.ok&&ration&&lodging&&ration.quantityAvailable>=3);
const baseQty=ration.quantityAvailable,distantBefore=snap(seed,t0,distantPlan,distantComposition),distantRationBefore=distantBefore.offers.find(x=>x.itemRef?.id==='TRAVEL-RATION');assert(distantRationBefore);
assert(Wealth.credit(seed,1000,{reasonCode:'wp8-funds',sourceRef:{kind:'test',id:'FUNDS'}},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'WP8-FUNDS',fantasyTimestamp:'1201-06-01 08:59:00'}).ok);

const buyQ=q(seed,t0,'buy',ration,2),buy=exec(seed,plan,composition,buyQ,'REQ-WP8-BUY',t0);assert(buy.ok&&!buy.duplicate&&buy.marketConsequence?.applied);
const afterBuy=snap(seed,'1201-06-01 09:01:00'),afterBuyRation=afterBuy.offers.find(x=>x.offerId===ration.offerId);
assert.equal(afterBuyRation.quantityAvailable,baseQty-2);assert.equal(afterBuyRation.campaignStockDelta,-2);assert(afterBuyRation.economicConsequenceRef?.id);assert(afterBuy.consequence.revision>0);
const leaveReturn=snap(seed,'1201-06-02 09:00:00'),returnRation=leaveReturn.offers.find(x=>x.offerId===ration.offerId);assert.equal(returnRation.quantityAvailable,baseQty-2);

const duplicate=Tx.execute(seed,plan,inputFrom(buyQ,'REQ-WP8-BUY'),sim(seed,'1201-06-02 09:01:00',{marketOptions}));assert(duplicate.ok&&duplicate.duplicate&&duplicate.marketConsequence?.duplicate);
assert.equal(snap(seed,'1201-06-02 09:02:00').offers.find(x=>x.offerId===ration.offerId).quantityAvailable,baseQty-2);
assert.equal(Consequences.snapshot(seed,plan.id).eventCount,1);

const sellOffer=snap(seed,'1201-06-02 09:03:00').offers.find(x=>x.offerId===ration.offerId),sellQ=q(seed,'1201-06-02 09:03:00','sell',sellOffer,1),sell=exec(seed,plan,composition,sellQ,'REQ-WP8-SELL','1201-06-02 09:03:00');assert(sell.ok&&sell.marketConsequence?.applied);
const afterSell=snap(seed,'1201-06-02 09:04:00').offers.find(x=>x.offerId===ration.offerId);assert.equal(afterSell.quantityAvailable,baseQty-1);assert.equal(afterSell.campaignStockDelta,-1);

const serviceOffer=snap(seed,'1201-06-02 09:05:00').offers.find(x=>x.offerId===lodging.offerId),serviceQ=q(seed,'1201-06-02 09:05:00','service',serviceOffer,1),service=exec(seed,plan,composition,serviceQ,'REQ-WP8-SERVICE','1201-06-02 09:05:00');assert(service.ok&&service.marketConsequence?.applied);
assert.equal(snap(seed,'1201-06-02 09:06:00').offers.find(x=>x.offerId===ration.offerId).quantityAvailable,baseQty-1);
assert.equal(Consequences.snapshot(seed,plan.id).eventCount,3);

const saved=C(WorldState.serializeState(seed)),preReload=snap(seed,'1201-06-03 10:00:00'),preCon=C(Consequences.snapshot(seed,plan.id));
stores.set(seed,fresh(seed));assert.equal(Consequences.snapshot(seed,plan.id).eventCount,0);
WorldState.restoreSerializedState({seed},saved);
delete require.cache[require.resolve(path.join(root,'scripts/world/local-market-consequences.js'))];
const ReloadedConsequences=require(path.join(root,'scripts/world/local-market-consequences.js'));global.LocalMarketConsequences=ReloadedConsequences;
const postReload=snap(seed,'1201-06-03 10:00:00'),postCon=ReloadedConsequences.snapshot(seed,plan.id);
assert.deepStrictEqual(postReload.offers.map(x=>[x.offerId,x.quantityAvailable,x.campaignStockDelta||0]),preReload.offers.map(x=>[x.offerId,x.quantityAvailable,x.campaignStockDelta||0]));
assert.deepStrictEqual(postCon.events,preCon.events);

const distantAfter=snap(seed,'1201-06-03 10:00:00',distantPlan,distantComposition),distantRationAfter=distantAfter.offers.find(x=>x.offerId===distantRationBefore.offerId);
assert.equal(distantAfter.consequence.eventCount,0);assert.equal(distantRationAfter.quantityAvailable,distantRationBefore.quantityAvailable);assert.equal(distantRationAfter.campaignStockDelta,undefined);
const otherSnap=snap(other,'1201-06-03 10:00:00'),otherRation=otherSnap.offers.find(x=>x.itemRef?.id==='TRAVEL-RATION');assert(otherRation);assert.equal(otherSnap.consequence.eventCount,0);assert.equal(otherRation.campaignStockDelta,undefined);

const realTx=global.EconomicTransaction;global.EconomicTransaction={get(){return{id:'EXC-11111111',state:'pending',kind:'buy',fantasyTimestamp:'1201-06-03 11:00:00',quote:{settlementId:plan.id,offerId:ration.offerId,providerRef:ration.providerRef,subjectRef:ration.itemRef,quantity:1}}}};const pendingReject=ReloadedConsequences.consume(seed,'EXC-11111111');global.EconomicTransaction=realTx;assert(!pendingReject.ok&&pendingReject.reason==='terminal-completed-economic-transaction-required');
assert.equal(ReloadedConsequences.consume(seed,'EXC-FFFFFFFF').reason,'economic-transaction-evidence-unavailable');

const finalSnap=ReloadedConsequences.snapshot(seed,plan.id);assert(finalSnap.compatible&&finalSnap.eventCount<=ReloadedConsequences.MAX_EVENTS&&finalSnap.affectedOfferCount<=ReloadedConsequences.MAX_AFFECTED_OFFERS&&finalSnap.serializedBytes<=ReloadedConsequences.MAX_LEDGER_BYTES);
for(const key of ['foundationMutation','fullWorldScan','wholeMarketScan','wholeHistoryScan','perFrameScan','cacheAuthority','presentationAuthority','directCurrencyMutation','directInventoryMutation','directSettlementEconomyMutation'])assert.equal(finalSnap[key],false,key);
assert.equal(finalSnap.sparseCampaignDelta,true);assert.equal(finalSnap.localMaterializationOnly,true);

const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script='scripts/world/local-market-consequences.js?v=local-market-consequences-v1';assert(html.includes(script));assert(html.indexOf(script)>html.indexOf('scripts/world/economic-transaction.js?v=economic-transaction-v1'));assert(html.indexOf(script)<html.indexOf('scripts/world/protagonist-housing.js?v=protagonist-housing-v1'));
const source=fs.readFileSync(path.join(root,'scripts/world/local-market-consequences.js'),'utf8'),marketSource=fs.readFileSync(path.join(root,'scripts/world/local-market.js'),'utf8'),txSource=fs.readFileSync(path.join(root,'scripts/world/economic-transaction.js'),'utf8');
for(const bad of ['Math.random(','Date.now(','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(bad),'forbidden non-authoritative input '+bad);
for(const marker of ['sparseCampaignDelta:true','localMaterializationOnly:true','fullWorldScan:false','wholeMarketScan:false','perFrameScan:false'])assert(source.includes(marker),'missing consequence guard '+marker);
assert(marketSource.includes('campaignConsequences:"WorldState sparse LocalMarketConsequences when available"'));assert(txSource.includes('market-consequence-persistence-failed'));assert(txSource.includes('consequences?.hasApplied?.'));

console.log(JSON.stringify({wp:'WP-S012-008',classification:'FUNCTIONAL',visual:'N/A — sparse market consequence persistence adds no rendered surface',pass:true,purchaseStock:{before:baseQty,after:afterBuyRation.quantityAvailable},saleRestock:{after:afterSell.quantityAvailable},serviceConsequence:service.marketConsequence.consequenceId,leaveReturnPersistence:true,saveReloadPersistence:true,duplicateIdempotence:true,terminalEvidenceRequired:true,distantMarketUntouched:true,campaignIsolation:true,bounds:finalSnap.bounds,sparseCampaignDelta:true,localMaterializationOnly:true,foundationMutation:false,fullWorldScan:false,wholeMarketScan:false,wholeHistoryScan:false,perFrameScan:false},null,2));
