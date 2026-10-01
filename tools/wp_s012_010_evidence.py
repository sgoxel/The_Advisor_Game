#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s012-010"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone":(390,844),"desktop":(1280,720)}

def target_url():
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1"})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:
    opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);wait=WebDriverWait(driver,240)

def page_ready():
    try:
        return driver.execute_script("""
          const stage=document.getElementById('planetStageRoot');
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&window.WorldState&&window.DailyActivity&&window.InteriorObjects&&window.CommandSetInterface&&window.ProtagonistCommandEvaluator&&window.ProtagonistActionRuntime&&window.ProtagonistInteractionPipeline&&window.ProtagonistEmployment&&window.ProtagonistWealth&&window.ProtagonistInventory&&window.LocalMarket&&window.LocalMarketConsequences&&window.EconomicTransaction&&window.AdvisorEconomyUI);
        """)
    except Exception:return False

def load_object_interactions():
    return driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      if(window.ObjectInteractions){done(true);return;}
      const s=document.createElement('script');s.src='scripts/world/object-interactions.js?wp-s012-010=1';
      s.onload=()=>done(Boolean(window.ObjectInteractions));s.onerror=()=>done(false);document.head.appendChild(s);
    """)

def execute_chain():
    return driver.execute_script("""
      let campaign=window.SeedSystem?.getCampaign?.()||null;
      if(!campaign){
        const requestedSeed='AGENT6-WP-S012-010-VISUAL';
        const set=window.SeedSystem?.setSettingsSeed?.(requestedSeed);
        const started=window.SeedSystem?.startNewCampaign?.(requestedSeed);
        campaign=started?.campaign||window.SeedSystem?.getCampaign?.()||null;
        if(!set?.ok||!campaign?.seed)throw new Error('Evidence campaign initialization failed');
      }
      const seed=campaign.seed,initialWhen=window.GameTime?.getTimestampKey?.();
      if(!initialWhen)throw new Error('Fantasy Game Time unavailable');
      const bound=window.WorldState.bindCampaign(campaign,{reset:true});
      if(!bound?.ok||!bound.bound)throw new Error('WorldState reset/bind failed '+JSON.stringify(bound));
      window.ProtagonistInteractionPipeline.clear(seed);

      const day=initialWhen.slice(0,10),stamp=(minute,second=0)=>{
        const m=Math.max(0,Math.min(1439,Math.floor(Number(minute)||0))),p=n=>String(n).padStart(2,'0');
        return day+' '+p(Math.floor(m/60))+':'+p(m%60)+':'+p(second);
      };
      const objects=window.InteriorObjects.build(seed),residents=window.DailyActivity.build(seed);
      const resident=residents.find(r=>{
        const obj=objects.find(o=>o.id===r.workplaceObjectId),interaction=obj?window.ObjectInteractions.get(seed,obj.id):null;
        return r.workplaceEnterable&&interaction?.actions?.includes('work')&&Array.isArray(r.schedule)&&r.schedule.some(b=>b.state==='work'&&b.intendedAction==='work');
      });
      if(!resident)throw new Error('No grounded indoor resident work context');
      const object=objects.find(o=>o.id===resident.workplaceObjectId),workBlocks=resident.schedule.filter(b=>b.state==='work'&&b.intendedAction==='work').slice(0,4);
      if(!object||!workBlocks.length)throw new Error('Grounded work target unavailable');
      const chosenBlock=workBlocks[0],mid=Math.floor((Number(chosenBlock.startMinute)+Number(chosenBlock.endMinute))/2);
      const workWhen=stamp(mid,0),doneWhen=stamp(mid,30),payWhen=stamp(Math.min(1439,mid+1),0),buyWhen=stamp(Math.min(1439,mid+2),0),returnWhen=stamp(Math.min(1439,mid+8),0);
      const contractContext={
        employerRef:{kind:'resident',id:resident.id},
        workplaceRef:{kind:'building',id:resident.workplaceId},
        contextRef:{kind:'daily-activity-work',id:resident.id+'|'+resident.workplaceId},
        professionId:resident.profession,
        workBlocks:workBlocks.map((b,i)=>({id:String(b.id||('work-'+i)),startMinute:Number(b.startMinute),endMinute:Number(b.endMinute)})),
        workTargetIds:[object.id],
        validFrom:day+' 00:00:00',validUntil:day+' 23:59:59'
      };
      const derived=window.ProtagonistEmployment.derive(seed,contractContext);
      if(!derived?.ok)throw new Error('Employment derive failed '+JSON.stringify(derived));
      const activated=window.ProtagonistEmployment.activate(seed,derived.contract,{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'WP-S012-010-CONTRACT',fantasyTimestamp:day+' 00:00:01'});
      if(!activated?.ok)throw new Error('Employment activate failed '+JSON.stringify(activated));
      const interactionDescriptor=window.ObjectInteractions.get(seed,object.id),workPoint=interactionDescriptor?.interactionPositions?.[0]||object.interactionPositions?.[0]||resident.workplaceTarget;
      if(!interactionDescriptor||!workPoint)throw new Error('Authoritative ObjectInteractions work point unavailable');
      const actorPosition={x:String(workPoint.x),y:String(workPoint.y),level:Number(workPoint.level||0)};
      const actionContext=window.ObjectInteractions.context(seed,object.id,actorPosition),workAction=actionContext?.actions?.find(x=>x.id==='work');
      if(!workAction?.enabled||workAction.distanceTiles!==0)throw new Error('Authoritative work interaction is not range-ready '+JSON.stringify({actorPosition,actionContext}));
      const activity=window.DailyActivity.resolveActionTarget(seed,resident,workWhen);
      if(activity?.action!=='work'||activity?.interactionObjectId!==object.id)throw new Error('Grounded DailyActivity work target mismatch '+JSON.stringify(activity));
      const commandSnapshot=window.CommandSetInterface.buildSnapshot({seed,when:workWhen,origin:actorPosition},{
        getResidentRoster(){return[resident];},
        getDailyActivities(){return[activity];},
        queryDestinations(){return{results:[],diagnostics:{bounded:true,fullWorldScan:false}};},
        getCountry(){return null;},getRoadGraph(){return null;},getKnownLeads(){return[];}
      });
      const person=commandSnapshot.targets.people.find(x=>x.id===resident.id),workTarget=commandSnapshot.targets.interactions.find(x=>x.id===object.id);
      if(!person||!workTarget||workTarget.action!=='work'||!workTarget.personIds.includes(resident.id))throw new Error('Bounded command snapshot lost grounded work context');
      window.ProtagonistActionRuntime.reset();
      const proposal={proposalId:'PROP-WP-S012-010-WORK',commandId:'advisor.propose_interaction',parameters:{personId:resident.id,interactionTargetId:object.id,topic:'Complete paid '+resident.profession+' work'},source:'wp-s012-010-production'};
      const scheduled=window.ProtagonistActionRuntime.schedule({seed,when:workWhen,snapshot:commandSnapshot,proposal,actorId:'protagonist',actorPosition,decisionContext:{value:.99,urgency:.95,socialAcceptability:.98}});
      if(!scheduled?.ok)throw new Error('ProtagonistActionRuntime schedule failed '+JSON.stringify(scheduled));
      const firstTick=window.ProtagonistActionRuntime.tick({seed,when:workWhen,maxAttempts:1}),firstRow=firstTick.processed[0];
      let runtimeRow=firstRow;
      if(firstRow?.state==='running')runtimeRow=window.ProtagonistActionRuntime.tick({seed,when:doneWhen,maxAttempts:1}).processed[0];
      const evaluatorResult=runtimeRow?.evaluatorResult,authoritativeAttemptId=evaluatorResult?.execution?.authoritativeResult?.attemptId;
      const pipeline=authoritativeAttemptId?window.ProtagonistInteractionPipeline.get(seed,authoritativeAttemptId):null;
      if(!['accepted','modified'].includes(String(evaluatorResult?.decision||''))||runtimeRow?.state!=='succeeded'||pipeline?.status!=='terminal-success'||pipeline?.action!=='work'||pipeline?.simulation?.authoritativeTerminalSuccess!==true)throw new Error('Protagonist decision → terminal Simulation work failed '+JSON.stringify({runtimeRow,pipeline}));
      const finished={interaction:pipeline};
      const balanceBeforeWork=window.ProtagonistWealth.snapshot(seed).balance;
      const wage=window.ProtagonistEmployment.settle(seed,{contractId:derived.contract.id,employerRef:contractContext.employerRef,workplaceRef:contractContext.workplaceRef,workResultId:finished.interaction.resultId},{authority:'simulation',authoritative:true,campaignSeed:seed,operationId:'WP-S012-010-WAGE',fantasyTimestamp:payWhen});
      if(!wage?.ok||wage.duplicate)throw new Error('Wage settlement failed '+JSON.stringify(wage));
      const balanceAfterPay=window.ProtagonistWealth.snapshot(seed).balance;
      if(balanceAfterPay!==balanceBeforeWork+derived.contract.compensationAmount)throw new Error('Wage balance mismatch');

      const plan=window.AdvisorEconomyUI.deriveSettlementPlan(seed);
      if(!plan)throw new Error('Canonical local settlement unavailable');
      const marketBefore=window.LocalMarket.snapshot(seed,buyWhen,plan,{});
      if(!marketBefore?.ok)throw new Error('LocalMarket snapshot failed '+JSON.stringify(marketBefore));
      const offer=marketBefore.offers.filter(x=>x.offerKind==='item'&&x.availabilityState==='available'&&Number(x.quantityAvailable)>0&&Number.isInteger(Number(x.unitPriceCopper))&&Number(x.unitPriceCopper)<=balanceAfterPay).sort((a,b)=>Number(a.unitPriceCopper)-Number(b.unitPriceCopper)||String(a.offerId).localeCompare(String(b.offerId)))[0];
      if(!offer)throw new Error('No affordable grounded item offer after wage');
      const stockBefore=Number(offer.quantityAvailable),inventoryBefore=Number(window.ProtagonistInventory.get(seed,{itemRef:offer.itemRef})?.quantity||0);
      const quoted=window.EconomicTransaction.quote(seed,buyWhen,plan,{kind:'buy',offerId:offer.offerId,providerRef:offer.providerRef,quantity:1},{});
      if(!quoted?.ok)throw new Error('Purchase quote failed '+JSON.stringify(quoted));
      const q=quoted.quote,input={requestId:'REQ-WP-S012-010-BUY',quoteId:q.quoteId,marketSnapshotId:q.marketSnapshotId,offerId:q.offerId,providerRef:q.providerRef,subjectRef:q.subjectRef,kind:q.kind,quantity:q.quantity,unitPriceCopper:q.unitPriceCopper,totalPriceCopper:q.totalPriceCopper};
      const purchase=window.EconomicTransaction.execute(seed,plan,input,{authority:'simulation',authoritative:true,campaignSeed:seed,fantasyTimestamp:buyWhen});
      if(!purchase?.ok||purchase.state!=='completed'||!purchase.marketConsequence?.applied)throw new Error('Completed purchase missing '+JSON.stringify(purchase));
      const balanceAfterPurchase=window.ProtagonistWealth.snapshot(seed).balance,itemAfter=window.ProtagonistInventory.get(seed,{itemRef:offer.itemRef}),marketAfter=window.LocalMarket.snapshot(seed,stamp(Math.min(1439,mid+3),0),plan,{}),offerAfter=marketAfter.offers.find(x=>x.offerId===offer.offerId);
      if(balanceAfterPurchase!==balanceAfterPay-q.totalPriceCopper||Number(itemAfter?.quantity||0)!==inventoryBefore+1||Number(offerAfter?.quantityAvailable)!==stockBefore-1)throw new Error('Purchase authorities disagree');

      const saved=window.WorldState.serializeState(seed);
      const beforeRestore={balance:balanceAfterPurchase,itemQty:Number(itemAfter.quantity),stock:Number(offerAfter.quantityAvailable),purchaseState:window.EconomicTransaction.get(seed,purchase.transactionId)?.state,wageSeen:window.ProtagonistEmployment.recentPayments(seed,{limit:4}).some(x=>x.id===wage.transactionId),eventCount:window.LocalMarketConsequences.snapshot(seed,plan.id).eventCount};
      window.WorldState.bindCampaign(campaign,{reset:true});
      if(window.EconomicTransaction.get(seed,purchase.transactionId)!=null)throw new Error('Reset did not clear campaign delta before reload evidence');
      const restored=window.WorldState.restoreSerializedState(campaign,saved);
      if(!restored?.ok)throw new Error('WorldState restore failed '+JSON.stringify(restored));
      const restoredItem=window.ProtagonistInventory.get(seed,{itemRef:offer.itemRef}),restoredOffer=window.LocalMarket.snapshot(seed,returnWhen,plan,{}).offers.find(x=>x.offerId===offer.offerId),restoredPurchase=window.EconomicTransaction.get(seed,purchase.transactionId);
      if(window.ProtagonistWealth.snapshot(seed).balance!==beforeRestore.balance||Number(restoredItem?.quantity||0)!==beforeRestore.itemQty||Number(restoredOffer?.quantityAvailable)!==beforeRestore.stock||restoredPurchase?.state!=='completed'||!window.ProtagonistEmployment.recentPayments(seed,{limit:4}).some(x=>x.id===wage.transactionId))throw new Error('Save/reload continuity failed');

      const country=window.PoliticalGeography?.countryAt?.(seed,'0','0'),nearby=country?window.SettlementArchetypes?.settlementsForCountry?.(seed,country,3)||[]:[],distant=nearby.find(x=>x?.id&&x.id!==plan.id)||null;
      if(distant)window.LocalMarket.snapshot(seed,returnWhen,distant,{});
      const returnedOffer=window.LocalMarket.snapshot(seed,returnWhen,plan,{}).offers.find(x=>x.offerId===offer.offerId);
      if(Number(returnedOffer?.quantityAvailable)!==beforeRestore.stock)throw new Error('Leave/return stock continuity failed');

      const duplicate=window.EconomicTransaction.execute(seed,plan,input,{authority:'simulation',authoritative:true,campaignSeed:seed,fantasyTimestamp:returnWhen});
      if(!duplicate?.ok||!duplicate.duplicate||duplicate.transactionId!==purchase.transactionId)throw new Error('Persistent duplicate guard failed '+JSON.stringify(duplicate));
      if(window.ProtagonistWealth.snapshot(seed).balance!==beforeRestore.balance||Number(window.ProtagonistInventory.get(seed,{itemRef:offer.itemRef})?.quantity||0)!==beforeRestore.itemQty||Number(window.LocalMarket.snapshot(seed,returnWhen,plan,{}).offers.find(x=>x.offerId===offer.offerId)?.quantityAvailable)!==beforeRestore.stock)throw new Error('Duplicate changed persistent economic state');

      window.AdvisorEconomyUI.setEvidenceMode(null);
      window.AdvisorEconomyUI.mount({open:true});
      window.AdvisorEconomyUI.setOpen(true);
      window.AdvisorEconomyUI.refresh('wp-s012-010-authoritative-chain');
      const model=window.AdvisorEconomyUI.productionModel();
      if(model.fixture!==false||model.work?.lastPay?.id!==wage.transactionId||!model.outcomes.some(x=>x.id===purchase.transactionId&&x.state==='completed'))throw new Error('Production economy readout does not reflect real chain '+JSON.stringify(model));
      const chain={
        seed,initialWhen,day,residentId:resident.id,profession:resident.profession,workplaceId:resident.workplaceId,workObjectId:object.id,
        workWhen,protagonistRuntimeAttemptId:runtimeRow.attemptId,protagonistDecision:evaluatorResult.decision,protagonistDecisionId:evaluatorResult.decisionId||null,protagonistExecutionId:evaluatorResult.executionId||null,workAttemptId:finished.interaction.attemptId,workResultId:finished.interaction.resultId,terminalSimulation:true,
        contractId:derived.contract.id,paymentId:wage.paymentId,wageTransactionId:wage.transactionId,wageAmount:wage.amount,
        balanceBeforeWork,balanceAfterPay,balanceAfterPurchase,
        settlementId:plan.id,offerId:offer.offerId,itemId:offer.itemRef.id,priceCopper:q.totalPriceCopper,stockBefore,stockAfter:beforeRestore.stock,
        purchaseQuoteId:q.quoteId,purchaseTransactionId:purchase.transactionId,purchaseWealthTransactionId:purchase.wealthTransactionId,inventoryOperationId:purchase.inventoryOperationId,marketConsequenceId:purchase.marketConsequence?.consequenceId||null,
        inventoryBefore,inventoryAfter:beforeRestore.itemQty,saveReload:true,leaveReturn:true,duplicateProtected:true,
        persistence:{...beforeRestore,restoredEventCount:window.LocalMarketConsequences.snapshot(seed,plan.id).eventCount},
        authority:{productionFixture:false,protagonistDecisionRequired:true,actionRuntimeRequired:true,terminalWorkRequired:true,simulationValidationBypass:false}
      };
      window.__wpS012010Chain=chain;
      return chain;
    """)

def frame_state(profile):
    return driver.execute_script("""
      const profile=arguments[0],chain=window.__wpS012010Chain||{},rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},inside=r=>!!r&&r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('advisorEconomyPanel'),p=rect(panel),pay=document.querySelector('.advisor-econ-last-pay'),payRect=rect(pay),footer=rect(document.querySelector('.advisor-econ-foot')),workCard=rect(document.querySelector('.advisor-econ-summary article:nth-child(2)'));
      const rows=[...document.querySelectorAll('.advisor-econ-outcomes article')],purchaseRow=rows.find(n=>n.querySelector('code')?.textContent?.trim()===chain.purchaseTransactionId),purchaseRect=rect(purchaseRow),recent=rect(document.querySelector('.advisor-econ-recent'));
      const chrome={map:rect(document.querySelector('.planet-map-context')),places:rect(document.querySelector('.planet-places-button')),scale:rect(document.querySelector('.planet-scale-ruler')),chat:rect(document.querySelector('.advisor-chat-launcher')),toolbelt:rect(document.querySelector('.advisor-toolbelt-launcher'))};
      const model=window.AdvisorEconomyUI.productionModel(),snap=window.AdvisorEconomyUI.snapshot();
      return{profile,viewport:{width:innerWidth,height:innerHeight},panel:p,panelInside:inside(p),payRect,payInside:inside(payRect),workCard,payText:pay?.innerText?.trim()||'',purchaseRect,purchaseInside:inside(purchaseRect),purchaseText:purchaseRow?.innerText?.trim()||'',recent,footer,documentWidth:document.documentElement.scrollWidth,overlap:Object.fromEntries(Object.entries(chrome).map(([k,v])=>[k,ov(p,v)])),model:{fixture:model.fixture,balance:model.balance,lastPay:model.work?.lastPay||null,outcomes:model.outcomes},snapshot:snap,stageReady:document.getElementById('planetStageRoot')?.dataset?.ready||null};
    """,profile)

def assert_frame(s,chain):
    if not s["panelInside"] or not s["payInside"] or not s["purchaseInside"]:raise RuntimeError("authoritative economy evidence escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if any(v>1 for v in s["overlap"].values()):raise RuntimeError("economy panel overlaps required gameplay chrome "+json.dumps(s))
    if s["model"]["fixture"] is not False:raise RuntimeError("accepted frame uses fixture authority "+json.dumps(s))
    if s["stageReady"]!="true":raise RuntimeError("production stage not ready "+json.dumps(s))
    if chain["wageTransactionId"] not in s["payText"] or "Earned +" not in s["payText"]:raise RuntimeError("earned-pay trace not visibly grounded "+json.dumps(s))
    if chain["purchaseTransactionId"] not in s["purchaseText"] or "completed" not in s["purchaseText"].lower() or "buy" not in s["purchaseText"].lower():raise RuntimeError("completed purchase outcome not visible "+json.dumps(s))
    if s["footer"] and s["purchaseRect"] and s["purchaseRect"]["bottom"]>s["footer"]["top"]+.5:raise RuntimeError("purchase outcome clipped behind footer "+json.dumps(s))
    if s["recent"] and s["purchaseRect"] and (s["purchaseRect"]["top"]<s["recent"]["top"]-.5 or s["purchaseRect"]["bottom"]>s["recent"]["bottom"]+.5):raise RuntimeError("purchase outcome not fully visible in recent trace "+json.dumps(s))
    if s["model"]["lastPay"].get("id")!=chain["wageTransactionId"]:raise RuntimeError("visible wage is not authoritative payment "+json.dumps(s))
    if not any(x.get("id")==chain["purchaseTransactionId"] and x.get("state")=="completed" for x in s["model"]["outcomes"]):raise RuntimeError("production model missing completed purchase "+json.dumps(s))
    a=s["snapshot"].get("authority",{})
    for key in ["perFrameRender","fullWorldScan","wholeMarketScan","wholeHistoryScan","directWorldMutation","directCurrencyMutation","directInventoryMutation","directMarketMutation","directEmploymentMutation","directHousingMutation","directPurchaseExecution","transactionCompletionMutation","fixtureAuthority","protagonistDecisionAuthority","simulationValidationBypass"]:
        if a.get(key) is not False:raise RuntimeError("Advisor economy authority regressed "+key+" "+json.dumps(s))
    for key in ["eventDriven","boundedReads","presentationOnly"]:
        if a.get(key) is not True:raise RuntimeError("Advisor economy authority marker missing "+key+" "+json.dumps(s))

frames=[]
try:
    driver.set_window_size(*VIEWPORTS["phone"]);driver.get(target_url())
    try:wait.until(lambda d:page_ready())
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    if not load_object_interactions():raise RuntimeError("Production ObjectInteractions failed to load")
    chain=execute_chain()
    required=["workResultId","wageTransactionId","purchaseTransactionId","purchaseWealthTransactionId","inventoryOperationId","offerId"]
    if any(not chain.get(k) for k in required) or chain.get("protagonistDecision") not in ["accepted","modified"] or not chain.get("protagonistRuntimeAttemptId") or not chain.get("terminalSimulation") or not chain.get("saveReload") or not chain.get("leaveReturn") or not chain.get("duplicateProtected"):raise RuntimeError("acceptance chain incomplete "+json.dumps(chain))
    if chain["balanceAfterPay"]!=chain["balanceBeforeWork"]+chain["wageAmount"] or chain["balanceAfterPurchase"]!=chain["balanceAfterPay"]-chain["priceCopper"]:raise RuntimeError("balance chain invalid "+json.dumps(chain))
    if chain["inventoryAfter"]!=chain["inventoryBefore"]+1 or chain["stockAfter"]!=chain["stockBefore"]-1:raise RuntimeError("inventory/market chain invalid "+json.dumps(chain))
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size);time.sleep(.5)
        driver.execute_script("window.AdvisorEconomyUI.setOpen(true);window.AdvisorEconomyUI.refresh('wp-s012-010-'+arguments[0]);",profile);time.sleep(.25)
        s=frame_state(profile);path=OUT/f"{profile}-work-pay-purchase-persistent.png";driver.save_screenshot(str(path));assert_frame(s,chain);frames.append({"profile":profile,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S012-010","classification":"MIXED","authority":"real production DailyActivity -> ProtagonistInteractionPipeline -> ActionExecutor -> ProtagonistEmployment -> ProtagonistWealth -> LocalMarket -> EconomicTransaction -> ProtagonistInventory/LocalMarketConsequences -> WorldState persistence","chain":chain,"frames":frames}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":len(frames),"chain":chain},indent=2))
except Exception:
    try:driver.save_screenshot(str(OUT/"failure.png"))
    except Exception:pass
    raise
finally:
    driver.quit()
