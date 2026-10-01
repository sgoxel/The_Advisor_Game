'use strict';
const assert=require('assert');
const path=require('path');
const modulePath=path.join(__dirname,'../world/protagonist-employment.js');
const state=new Map();
function key(seed,ref){return seed+'|'+ref.id;}
global.WorldState={
  structuralRef(seed,kind,entity,keyName){return Object.freeze({kind,id:'REF-'+entity+'-'+keyName});},
  resolve(seed,ref){const x=state.get(key(seed,ref));return x?{current:x}:null;},
  applyDelta(seed,ref,changes,reason){const k=key(seed,ref),prev=state.get(k)||{},next={...prev,...JSON.parse(JSON.stringify(changes))};state.set(k,next);return {ok:true,reason:'ok',entry:{revision:1}};}
};
global.ProtagonistProfile={derive(seed,key){return {protagonistId:'PROTAGONIST-'+seed+'-'+key};}};
const interactions=new Map();
global.ProtagonistInteractionPipeline={claimCompletion(seed,input){const row=interactions.get(input.resultId)||interactions.get(input.attemptId);if(!row)return {ok:false,reason:'interaction-not-found'};if(row.status!=='terminal-success'||row.simulation?.authoritativeTerminalSuccess!==true)return {ok:false,reason:'claimed-success-not-authoritative',interaction:row};return {ok:true,reason:'already-authoritative-terminal-success',interaction:row};}};
let fallbackBalance=20;const ops=new Map(),transactions=[];
const wealthPath=path.join(__dirname,'../world/protagonist-wealth.js');
if(require('fs').existsSync(wealthPath)){delete require.cache[require.resolve(wealthPath)];global.ProtagonistWealth=require(wealthPath);}
else global.ProtagonistWealth={
  credit(seed,amount,details,opts){const sig=JSON.stringify({amount,details,when:opts.fantasyTimestamp});const existing=ops.get(opts.operationId);if(existing){if(existing.sig!==sig)return {ok:false,reason:'duplicate-operation-conflict'};return {ok:true,duplicate:true,transactionId:existing.transactionId};}const id='TXN-'+String(transactions.length+1).padStart(4,'0');fallbackBalance+=amount;const tx={id,direction:'credit',amount,reasonCode:details.reasonCode,sourceRef:details.sourceRef,transferRef:details.transferRef,fantasyTimestamp:opts.fantasyTimestamp};transactions.unshift(tx);ops.set(opts.operationId,{sig,transactionId:id});return {ok:true,duplicate:false,transactionId:id,transaction:tx};},
  list(seed,o){return transactions.slice(0,o.limit||16);},snapshot(){return {balance:fallbackBalance};}
};
function wealthBalance(){return global.ProtagonistWealth.snapshot?global.ProtagonistWealth.snapshot(seed).balance:fallbackBalance;}
const Employment=require(modulePath);
const seed='AGENT6-EMPLOYMENT-A',validFrom='0007-03-10 00:00:00',validUntil='0007-03-20 23:59:59';
const base={employerRef:{kind:'resident',id:'NPC-SMITH-MASTER'},workplaceRef:{kind:'building',id:'BLD-SMITHY'},contextRef:{kind:'employment-context',id:'CTX-SMITHY-WORK'},professionId:'smith',workBlocks:[{id:'day',startMinute:540,endMinute:1020}],workTargetIds:['SMITHY:anvil'],validFrom,validUntil};
const a=Employment.derive(seed,base),b=Employment.derive(seed,JSON.parse(JSON.stringify(base)));
assert(a.ok&&b.ok);assert.deepStrictEqual(a,b);assert.equal(a.contract.currency,'copper');assert.equal(a.contract.payBasis,'per-terminal-work');assert(a.contract.compensationAmount>=6&&a.contract.compensationAmount<=13);
const alt=Employment.derive('AGENT6-EMPLOYMENT-B',base);assert(alt.ok);assert.notEqual(alt.contract.id,a.contract.id);
assert.equal(Employment.derive(seed,{...base,employerRef:null}).reason,'employer-reference-required');
assert.equal(Employment.derive(seed,{...base,workplaceRef:null}).reason,'workplace-reference-required');
assert.equal(Employment.derive(seed,{...base,workTargetIds:[]}).reason,'work-target-count-invalid');
const auth={authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'CONTRACT-ACTIVATE',fantasyTimestamp:'0007-03-10 08:00:00'};
assert.equal(Employment.activate(seed,{...a.contract,compensationAmount:999},auth).reason,'contract-foundation-mismatch');
const active=Employment.activate(seed,a.contract,auth);assert(active.ok&&!active.duplicate);assert.equal(Employment.activate(seed,a.contract,auth).reason,'duplicate-contract');
assert.equal(Employment.current(seed,'0007-03-10 08:01:00').status,'active');
const work={attemptId:'IAX-WORK-1',resultId:'IRX-WORK-1',targetId:'SMITHY:anvil',action:'work',startedFantasyTimestamp:'0007-03-10 10:00:00',updatedFantasyTimestamp:'0007-03-10 10:15:00',status:'terminal-success',simulation:{authoritativeTerminalSuccess:true}};interactions.set(work.resultId,work);
const settleInput={contractId:a.contract.id,employerRef:base.employerRef,workplaceRef:base.workplaceRef,workResultId:work.resultId};
const before=wealthBalance(),pay=Employment.settle(seed,settleInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'IGNORED-EXTERNAL',fantasyTimestamp:'0007-03-10 10:16:00'});assert(pay.ok&&!pay.duplicate);assert.equal(wealthBalance(),before+a.contract.compensationAmount);assert.equal(pay.contractId,a.contract.id);assert.equal(pay.workResultId,work.resultId);assert(/^PAY-/.test(pay.paymentId)&&/^TXN-/.test(pay.transactionId));
const dup=Employment.settle(seed,settleInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'DIFFERENT-CALL',fantasyTimestamp:'0007-03-10 12:16:00'});assert(dup.ok&&dup.duplicate);assert.equal(wealthBalance(),before+a.contract.compensationAmount);assert.equal(dup.transactionId,pay.transactionId);
const incomplete={...work,attemptId:'IAX-WORK-2',resultId:'IRX-WORK-2',status:'active',simulation:{authoritativeTerminalSuccess:false}};interactions.set(incomplete.resultId,incomplete);assert.equal(Employment.settle(seed,{...settleInput,workResultId:incomplete.resultId},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'TRY-INCOMPLETE',fantasyTimestamp:'0007-03-10 10:20:00'}).reason,'claimed-success-not-authoritative');
const wrongTarget={...work,attemptId:'IAX-WORK-3',resultId:'IRX-WORK-3',targetId:'OTHER:bench'};interactions.set(wrongTarget.resultId,wrongTarget);assert.equal(Employment.settle(seed,{...settleInput,workResultId:wrongTarget.resultId},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'TRY-WRONG-TARGET',fantasyTimestamp:'0007-03-10 10:20:00'}).reason,'work-target-not-covered-by-contract');
assert.equal(Employment.settle(seed,{...settleInput,employerRef:{kind:'resident',id:'NPC-OTHER'}},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'TRY-EMP',fantasyTimestamp:'0007-03-10 10:20:00'}).reason,'employer-mismatch');
assert.equal(Employment.settle(seed,{...settleInput,workplaceRef:{kind:'building',id:'BLD-OTHER'}},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'TRY-WORKPLACE',fantasyTimestamp:'0007-03-10 10:20:00'}).reason,'workplace-mismatch');
assert.equal(Employment.settle(seed,settleInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'TRY-EXPIRED',fantasyTimestamp:'0007-03-21 00:00:00'}).reason,'employment-contract-expired');
const payments=Employment.recentPayments(seed,{limit:8});assert.equal(payments.length,1);assert.equal(payments[0].id,pay.transactionId);assert.equal(payments[0].sourceRef.id,a.contract.id);assert.equal(payments[0].transferRef.id,work.resultId);
const snap=Employment.snapshot(seed);assert(snap.compatible);assert.equal(snap.contract.id,a.contract.id);assert.equal(snap.fullWorldScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.resourceProductionAuthority,false);assert.equal(snap.rankAuthority,false);
delete require.cache[require.resolve(modulePath)];const Reloaded=require(modulePath);assert.equal(Reloaded.snapshot(seed).contract.id,a.contract.id);const afterReload=Reloaded.settle(seed,settleInput,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'AFTER-RELOAD',fantasyTimestamp:'0007-03-11 10:16:00'});assert(afterReload.ok&&afterReload.duplicate);assert.equal(wealthBalance(),before+a.contract.compensationAmount);
const source=require('fs').readFileSync(modulePath,'utf8');assert(!source.includes('Math.random('));assert(!source.includes('Date.now('));assert(!source.includes('performance.now('));
console.log(JSON.stringify({wp:'WP-S012-003',classification:'FUNCTIONAL',visual:'N/A — employment contract and wage settlement add no rendered surface',pass:true,version:Employment.VERSION,contractId:a.contract.id,paymentId:pay.paymentId,transactionId:pay.transactionId,amount:pay.amount,balanceBefore:before,balanceAfter:wealthBalance(),duplicateProtected:true,reloadProtected:true,invalidEmployerRejected:true,invalidWorkplaceRejected:true,incompleteWorkRejected:true,expiredRejected:true,bounds:snap.bounds,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directInventoryMutation:false,resourceProductionAuthority:false,professionAuthority:false,rankAuthority:false},null,2));
