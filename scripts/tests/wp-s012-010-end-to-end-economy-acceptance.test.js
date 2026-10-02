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
 restoreSerializedState(c,x){stores.set(String(c.seed),C(x));return{ok:true,reason:'ok'}},
 clearFoundationCache(){}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};

const root=path.resolve(__dirname,'../..');
const plan={id:'SETTLEMENT-WP10',name:'Ashford',classId:'village',role:'starting-village',center:{x:'0',y:'0'},population:{planned:420},prosperity:{value:.56},tradeMarketTendency:.63,inputs:{local:{resources:{agriculture:.78,mineral:.44,timber:.61,water:.74}}}};
const composition={id:'SBC-WP10',revision:'SBCF-WP10',settlementId:plan.id,selected:[{id:'general-shop',label:'Shop',category:'trade',count:1},{id:'inn-tavern',label:'Inn',category:'trade',count:1},{id:'smithy',label:'Smithy',category:'production-storage',count:1}]};
const distantPlan={...C(plan),id:'SETTLEMENT-WP10-DISTANT',name:'Distant Ford'},distantComposition={...C(composition),id:'SBC-WP10-DISTANT',revision:'SBCF-WP10-DISTANT',settlementId:distantPlan.id};

const LocalMarket=require(path.join(root,'scripts/world/local-market.js'));
const Inventory=require(path.join(root,'scripts/world/protagonist-inventory.js'));
const Wealth=require(path.join(root,'scripts/world/protagonist-wealth.js'));
global.LocalMarket=LocalMarket;global.ProtagonistInventory=Inventory;global.ProtagonistWealth=Wealth;

const workEvidence=new Map();
global.ProtagonistInteractionPipeline={claimCompletion(seed,input){const row=workEvidence.get(input.resultId)||workEvidence.get(input.attemptId);if(!row)return{ok:false,reason:'interaction-not-found'};if(row.status!=='terminal-success'||row.simulation?.authoritativeTerminalSuccess!==true)return{ok:false,reason:'claimed-success-not-authoritative',interaction:row};return{ok:true,reason:'already-authoritative-terminal-success',interaction:C(row)};}};
const Employment=require(path.join(root,'scripts/world/protagonist-employment.js'));global.ProtagonistEmployment=Employment;
const Tx=require(path.join(root,'scripts/world/economic-transaction.js'));global.EconomicTransaction=Tx;
const Consequences=require(path.join(root,'scripts/world/local-market-consequences.js'));global.LocalMarketConsequences=Consequences;
const Economic=require(path.join(root,'scripts/world/protagonist-economic-priority.js'));

const seed='AGENT6-WP-S012-010',tActivate='1201-10-01 08:50:00',tWork='1201-10-01 09:00:00',tDone='1201-10-01 09:00:30',tPay='1201-10-01 09:01:00',tBuy='1201-10-01 09:02:00';
const workContext={employerRef:{kind:'resident',id:'NPC-SMITH-MASTER'},workplaceRef:{kind:'building',id:'BLD-SMITHY'},contextRef:{kind:'employment-context',id:'CTX-SMITHY-WORK'},professionId:'smith',workBlocks:[{id:'day',startMinute:480,endMinute:1020}],workTargetIds:['SMITHY:workbench'],validFrom:'1201-10-01 00:00:00',validUntil:'1201-10-02 23:59:59'};
const derived=Employment.derive(seed,workContext);assert(derived.ok);
const activated=Employment.activate(seed,derived.contract,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'WP10-CONTRACT-ACTIVATE',fantasyTimestamp:tActivate});assert(activated.ok);
const work={attemptId:'IAX-WP10WORK',resultId:'IRX-WP10WORK',targetId:'SMITHY:workbench',action:'work',startedFantasyTimestamp:tWork,updatedFantasyTimestamp:tDone,status:'terminal-success',simulation:{authoritativeTerminalSuccess:true,delegate:'ActionExecutor'}};workEvidence.set(work.resultId,work);
const settleInput={contractId:derived.contract.id,employerRef:workContext.employerRef,workplaceRef:workContext.workplaceRef,workResultId:work.resultId};
const balanceBeforeWork=Wealth.snapshot(seed).balance,wage=Employment.settle(seed,settleInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'WP10-WAGE-REQUEST',fantasyTimestamp:tPay});
assert(wage.ok&&!wage.duplicate&&wage.currencyChanged);const balanceAfterPay=Wealth.snapshot(seed).balance;assert.equal(balanceAfterPay,balanceBeforeWork+derived.contract.compensationAmount);
assert(/^EMP-/.test(derived.contract.id)&&/^PAY-/.test(wage.paymentId)&&/^TXN-/.test(wage.transactionId));

const marketBefore=LocalMarket.snapshot(seed,tBuy,plan,{composition});assert(marketBefore.ok);
const buyOffer=marketBefore.offers.filter(x=>x.offerKind==='item'&&x.availabilityState==='available'&&Number(x.quantityAvailable)>0&&Number.isInteger(Number(x.unitPriceCopper))&&Number(x.unitPriceCopper)<=balanceAfterPay).sort((a,b)=>a.unitPriceCopper-b.unitPriceCopper||a.offerId.localeCompare(b.offerId))[0];assert(buyOffer,'affordable grounded item offer required');
const stockBefore=buyOffer.quantityAvailable,invBefore=Inventory.get(seed,{itemRef:buyOffer.itemRef})?.quantity||0;
const quote=Tx.quote(seed,tBuy,plan,{kind:'buy',offerId:buyOffer.offerId,providerRef:buyOffer.providerRef,quantity:1},{marketOptions:{composition}});assert(quote.ok);
const z=quote.quote,input={requestId:'REQ-WP10-BUY',quoteId:z.quoteId,marketSnapshotId:z.marketSnapshotId,offerId:z.offerId,providerRef:z.providerRef,subjectRef:z.subjectRef,kind:z.kind,quantity:z.quantity,unitPriceCopper:z.unitPriceCopper,totalPriceCopper:z.totalPriceCopper};
const purchase=Tx.execute(seed,plan,input,{authority:'simulation',authoritative:true,campaignSeed:seed,fantasyTimestamp:tBuy,marketOptions:{composition}});
assert(purchase.ok&&!purchase.duplicate&&purchase.state==='completed'&&purchase.marketConsequence?.applied);
const balanceAfterBuy=Wealth.snapshot(seed).balance;assert.equal(balanceAfterBuy,balanceAfterPay-z.totalPriceCopper);
assert.equal(Inventory.get(seed,{itemRef:buyOffer.itemRef}).quantity,invBefore+1);
const marketAfter=LocalMarket.snapshot(seed,'1201-10-01 09:03:00',plan,{composition}),afterOffer=marketAfter.offers.find(x=>x.offerId===buyOffer.offerId);assert.equal(afterOffer.quantityAvailable,stockBefore-1);assert.equal(afterOffer.campaignStockDelta,-1);
assert(/^QUOTE-/.test(z.quoteId)&&/^EXC-/.test(purchase.transactionId)&&/^TXN-/.test(purchase.wealthTransactionId)&&purchase.inventoryOperationId);

const duplicate=Tx.execute(seed,plan,input,{authority:'simulation',authoritative:true,campaignSeed:seed,fantasyTimestamp:'1201-10-01 09:04:00',marketOptions:{composition}});assert(duplicate.ok&&duplicate.duplicate&&duplicate.transactionId===purchase.transactionId);
assert.equal(Wealth.snapshot(seed).balance,balanceAfterBuy);assert.equal(Inventory.get(seed,{itemRef:buyOffer.itemRef}).quantity,invBefore+1);assert.equal(Consequences.snapshot(seed,plan.id).eventCount,1);

const saved=C(WorldState.serializeState(seed)),persistExpected={balance:balanceAfterBuy,itemQty:invBefore+1,stock:stockBefore-1,payments:Employment.recentPayments(seed,{limit:4}).map(x=>x.id),purchaseId:purchase.transactionId,eventCount:Consequences.snapshot(seed,plan.id).eventCount};
stores.set(seed,fresh(seed));assert.equal(Tx.get(seed,purchase.transactionId),null);
WorldState.restoreSerializedState({seed},saved);
assert.equal(Wealth.snapshot(seed).balance,persistExpected.balance);assert.equal(Inventory.get(seed,{itemRef:buyOffer.itemRef}).quantity,persistExpected.itemQty);assert.equal(Tx.get(seed,purchase.transactionId).state,'completed');assert(Employment.recentPayments(seed,{limit:4}).some(x=>x.id===wage.transactionId));assert.equal(Consequences.snapshot(seed,plan.id).eventCount,persistExpected.eventCount);
LocalMarket.snapshot(seed,'1201-10-02 09:00:00',distantPlan,{composition:distantComposition});
const returned=LocalMarket.snapshot(seed,'1201-10-02 09:01:00',plan,{composition}),returnedOffer=returned.offers.find(x=>x.offerId===buyOffer.offerId);assert.equal(returnedOffer.quantityAvailable,persistExpected.stock);

// Rejected protagonist choice: valid advice is evaluated but low value/urgency/acceptability prevents execution.
const econSnapshotBeforeReject=JSON.stringify({w:Wealth.snapshot(seed),i:Inventory.snapshot(seed),m:Consequences.snapshot(seed,plan.id),t:Tx.snapshot(seed)});
global.CommandSetInterface={validateProposal(s,p){return{ok:true,status:'validated',reason:'proposal-valid',commandId:p.commandId,snapshotId:s.snapshotId,proposalId:p.proposalId,source:p.source||null,validatedParameters:Object.freeze({...p.parameters}),worldMutation:false,executionAttempted:false}}};
global.RoutePlanner={findRoute(){throw new Error('rejected advice must not route')}};global.ObjectInteractions={attempt(){throw new Error('rejected advice must not interact')},context(){return null}};global.SocialState={adviceAcceptability(){return .8}};
delete require.cache[require.resolve(path.join(root,'scripts/world/protagonist-command-evaluator.js'))];const Evaluator=require(path.join(root,'scripts/world/protagonist-command-evaluator.js'));
const commandSnapshot={interfaceVersion:'advisor-command-set-v1',snapshotId:'SNAP-WP10-REJECT',context:{seed,when:'1201-10-02 09:02:00',origin:{x:'0',y:'0'}},targets:{people:[],places:[],routes:[],interactions:[]}};
const rejected=Evaluator.evaluate({seed,when:'1201-10-02 09:02:00',snapshot:commandSnapshot,actorPosition:{x:'0',y:'0'},proposal:{proposalId:'PROP-WP10-REJECT',commandId:'advisor.propose_advice',parameters:{topic:'Buy another ration'},source:'wp-s012-010'},decisionContext:{value:.05,urgency:.05,socialAcceptability:.05}});assert.equal(rejected.decision,'rejected');assert.equal(rejected.execution.attempted,false);
assert.equal(JSON.stringify({w:Wealth.snapshot(seed),i:Inventory.snapshot(seed),m:Consequences.snapshot(seed,plan.id),t:Tx.snapshot(seed)}),econSnapshotBeforeReject);

// Deferred economic priority: obligation reserve causes discretionary spend to defer with no mutation.
const beforeDeferred=JSON.stringify({w:Wealth.snapshot(seed),i:Inventory.snapshot(seed),m:Consequences.snapshot(seed,plan.id),t:Tx.snapshot(seed)});
const deferOffer={offerId:'OFFER-DEFER',category:'luxury',availabilityState:'available',unitPriceCopper:12,quantityAvailable:1,itemRef:{kind:'item',id:'ITEM-RIBBON'}};
const deferred=Economic.evaluate({seed,when:'1201-10-02 09:03:00',needs:{pressureMilli:{hunger:10000}},housing:{obligation:{state:'upcoming',obligationId:'HOB-RENT',amountCopper:8,priority:'low'}},wealth:{balance:12},inventory:{records:[]},goals:{records:[]},authority:{scopes:['self']},market:{offers:[deferOffer]},workOpportunities:[],candidates:[{id:'BUY-DEFER',kind:'discretionary-purchase',offerId:deferOffer.offerId,priority:65,proposal:{proposalId:'PROP-DEFER',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'SHOP-COUNTER'},source:'wp-s012-010'}}]});assert.equal(deferred.status,'deferred');assert.equal(deferred.selectedProposal,null);
assert.equal(JSON.stringify({w:Wealth.snapshot(seed),i:Inventory.snapshot(seed),m:Consequences.snapshot(seed,plan.id),t:Tx.snapshot(seed)}),beforeDeferred);

// Invalid forged purchase terms must not mutate any economic authority.
const invalidSeed='AGENT6-WP-S012-010-INVALID',invalidMarket=LocalMarket.snapshot(invalidSeed,'1201-10-01 10:00:00',plan,{composition}),invalidOffer=invalidMarket.offers.find(x=>x.offerKind==='item'&&x.availabilityState==='available'&&Number(x.quantityAvailable)>0);assert(invalidOffer);
const iq=Tx.quote(invalidSeed,'1201-10-01 10:00:00',plan,{kind:'buy',offerId:invalidOffer.offerId,providerRef:invalidOffer.providerRef,quantity:1},{marketOptions:{composition}});assert(iq.ok);const iz=iq.quote,forged={requestId:'REQ-WP10-FORGED',quoteId:iz.quoteId,marketSnapshotId:iz.marketSnapshotId,offerId:iz.offerId,providerRef:iz.providerRef,subjectRef:iz.subjectRef,kind:iz.kind,quantity:iz.quantity,unitPriceCopper:iz.unitPriceCopper+1,totalPriceCopper:iz.totalPriceCopper+1};
const beforeInvalid=JSON.stringify({w:Wealth.snapshot(invalidSeed),i:Inventory.snapshot(invalidSeed),m:Consequences.snapshot(invalidSeed,plan.id),t:Tx.snapshot(invalidSeed)}),invalid=Tx.execute(invalidSeed,plan,forged,{authority:'simulation',authoritative:true,campaignSeed:invalidSeed,fantasyTimestamp:'1201-10-01 10:00:00',marketOptions:{composition}});assert(!invalid.ok&&invalid.reason==='forged-quote-terms');assert.equal(JSON.stringify({w:Wealth.snapshot(invalidSeed),i:Inventory.snapshot(invalidSeed),m:Consequences.snapshot(invalidSeed,plan.id),t:Tx.snapshot(invalidSeed)}),beforeInvalid);

// Insufficient funds must fail before inventory/market/transaction mutation.
const lowSeed='AGENT6-WP-S012-010-LOW',lowMarket=LocalMarket.snapshot(lowSeed,'1201-10-01 11:00:00',plan,{composition}),lowOffer=lowMarket.offers.filter(x=>x.offerKind==='item'&&x.availabilityState==='available'&&Number(x.quantityAvailable)>0).sort((a,b)=>b.unitPriceCopper-a.unitPriceCopper)[0];assert(lowOffer&&lowOffer.unitPriceCopper>1);
const opening=Wealth.snapshot(lowSeed).balance;assert(Wealth.debit(lowSeed,opening-1,{reasonCode:'acceptance-low-funds-setup',sourceRef:{kind:'acceptance-evidence',id:'WP-S012-010'}},{authority:'simulation',authoritative:true,campaignSeed:lowSeed,operationId:'WP10-LOW-SETUP',fantasyTimestamp:'1201-10-01 10:59:00'}).ok);
const lq=Tx.quote(lowSeed,'1201-10-01 11:00:00',plan,{kind:'buy',offerId:lowOffer.offerId,providerRef:lowOffer.providerRef,quantity:1},{marketOptions:{composition}});assert(lq.ok);const lz=lq.quote,li={requestId:'REQ-WP10-LOW',quoteId:lz.quoteId,marketSnapshotId:lz.marketSnapshotId,offerId:lz.offerId,providerRef:lz.providerRef,subjectRef:lz.subjectRef,kind:lz.kind,quantity:lz.quantity,unitPriceCopper:lz.unitPriceCopper,totalPriceCopper:lz.totalPriceCopper};
const beforeLow=JSON.stringify({w:Wealth.snapshot(lowSeed),i:Inventory.snapshot(lowSeed),m:Consequences.snapshot(lowSeed,plan.id),t:Tx.snapshot(lowSeed)}),low=Tx.execute(lowSeed,plan,li,{authority:'simulation',authoritative:true,campaignSeed:lowSeed,fantasyTimestamp:'1201-10-01 11:00:00',marketOptions:{composition}});assert(!low.ok&&low.reason==='insufficient-funds');assert.equal(JSON.stringify({w:Wealth.snapshot(lowSeed),i:Inventory.snapshot(lowSeed),m:Consequences.snapshot(lowSeed,plan.id),t:Tx.snapshot(lowSeed)}),beforeLow);

// Stale market evidence must be refused with no mutation.
const staleSeed='AGENT6-WP-S012-010-STALE',staleAgg={sourceSystem:'RegionalSettlementSimulation',settlementId:plan.id,validated:true,fantasyTimestamp:'1201-09-20 12:00:00',revision:7,values:{foodSupply:.9,productionOutput:.7,tradeActivity:.7,prosperity:.6,employmentPressure:.2}};
const staleMarket=LocalMarket.snapshot(staleSeed,'1201-10-01 12:00:00',plan,{composition,aggregate:staleAgg}),staleOffer=staleMarket.offers.find(x=>x.offerKind==='item'&&x.freshness==='stale');assert(staleOffer);
const beforeStale=JSON.stringify({w:Wealth.snapshot(staleSeed),i:Inventory.snapshot(staleSeed),m:Consequences.snapshot(staleSeed,plan.id),t:Tx.snapshot(staleSeed)}),stale=Tx.quote(staleSeed,'1201-10-01 12:00:00',plan,{kind:'buy',offerId:staleOffer.offerId,providerRef:staleOffer.providerRef,quantity:1},{marketOptions:{composition,aggregate:staleAgg}});assert(!stale.ok&&stale.reason==='offer-stale-or-unknown');assert.equal(JSON.stringify({w:Wealth.snapshot(staleSeed),i:Inventory.snapshot(staleSeed),m:Consequences.snapshot(staleSeed,plan.id),t:Tx.snapshot(staleSeed)}),beforeStale);

const employmentSnap=Employment.snapshot(seed),txSnap=Tx.snapshot(seed),marketConsequenceSnap=Consequences.snapshot(seed,plan.id),inventorySnap=Inventory.snapshot(seed),wealthSnap=Wealth.snapshot(seed);
for(const [name,snap] of [['employment',employmentSnap],['transaction',txSnap],['consequence',marketConsequenceSnap]]){
 assert.equal(snap.fullWorldScan,false,name+' fullWorldScan');
 assert.equal(snap.wholeHistoryScan,false,name+' wholeHistoryScan');
 assert.equal(snap.perFrameScan,false,name+' perFrameScan');
}
assert.equal(inventorySnap.fullWorldScan,false);assert.equal(wealthSnap.fullWorldScan,false);
const evidenceSource=fs.readFileSync(path.join(root,'tools/wp_s012_010_evidence.py'),'utf8');
for(const marker of ['CommandSetInterface.buildSnapshot','ProtagonistActionRuntime.schedule','ProtagonistActionRuntime.tick','ProtagonistCommandEvaluator','protagonistDecisionRequired:true','actionRuntimeRequired:true'])assert(evidenceSource.includes(marker),'production browser evidence missing protagonist decision boundary '+marker);
assert(!evidenceSource.includes("const started=window.ProtagonistInteractionPipeline.execute(seed,workInput)"),'accepted production chain must not jump directly into interaction pipeline');
const uiSource=fs.readFileSync(path.join(root,'scripts/ui/advisor-economy-ui.js'),'utf8');assert(uiSource.includes('advisor-econ-last-pay'));assert(uiSource.includes('Earned +'));
console.log(JSON.stringify({wp:'WP-S012-010',classification:'MIXED',visual:'Fresh production phone + desktop screenshots are required by dedicated workflow',pass:true,acceptedProductionAuthority:'browser evidence uses real DailyActivity -> ProtagonistInteractionPipeline -> ActionExecutor chain; this Node harness is supplemental',chain:{contractId:derived.contract.id,workResultId:work.resultId,paymentId:wage.paymentId,wageTransactionId:wage.transactionId,purchaseQuoteId:z.quoteId,purchaseTransactionId:purchase.transactionId,purchaseWealthTransactionId:purchase.wealthTransactionId,inventoryOperationId:purchase.inventoryOperationId,marketConsequenceId:purchase.marketConsequence?.consequenceId||null,offerId:buyOffer.offerId,itemId:buyOffer.itemRef.id},balances:{beforeWork:balanceBeforeWork,afterPay:balanceAfterPay,afterPurchase:balanceAfterBuy,purchaseCost:z.totalPriceCopper},inventory:{before:invBefore,after:invBefore+1},marketStock:{before:stockBefore,after:stockBefore-1,leaveReturn:returnedOffer.quantityAvailable},persistence:{saveReload:true,leaveReturn:true,duplicateProtected:true},negativeCases:{rejected:rejected.decision,deferred:deferred.status,invalid:invalid.reason,insufficientFunds:low.reason,staleOffer:stale.reason,zeroUnintendedMutation:true},authority:{terminalWorkRequired:true,eventDriven:true,bounded:true,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directUiMutation:false}},null,2));
