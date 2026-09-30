#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s011-010"));OUT.mkdir(parents=True,exist_ok=True)
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
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&
            window.CommandSetInterface&&window.LocalConversationRouter&&window.ProtagonistCommandEvaluator&&
            window.ProtagonistInteractionPipeline&&window.ProtagonistActionRuntime&&window.ConversationTransactions&&
            window.ProtagonistActivityUI&&window.AdvisorConversationUI&&window.AdvisorToolbeltUI&&
            window.AdvisorInsight&&window.AdvisorToolResolutionBoundary&&window.AdvisorProgression&&
            window.AdvisorChannel&&window.CharacterMemory&&window.InteriorObjects&&window.ActionExecutor);
        """)
    except Exception:return False

def load_object_interactions():
    return driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      if(window.ObjectInteractions){done(true);return;}
      const s=document.createElement('script');s.src='scripts/world/object-interactions.js?wp-s011-010=1';
      s.onload=()=>done(Boolean(window.ObjectInteractions));s.onerror=()=>done(false);document.head.appendChild(s);
    """)

def execute_chain():
    return driver.execute_script("""
      let campaign=window.SeedSystem?.getCampaign?.()||null;
      if(!campaign){
        const requestedSeed='AGENT6-WP-S011-010-VISUAL';
        const set=window.SeedSystem?.setSettingsSeed?.(requestedSeed);
        const started=window.SeedSystem?.startNewCampaign?.(requestedSeed);
        campaign=started?.campaign||window.SeedSystem?.getCampaign?.()||null;
        if(!set?.ok||!campaign)throw new Error('Evidence campaign initialization failed');
      }
      const seed=campaign.seed;
      const worldBinding=window.WorldState?.bindCampaign?.(campaign,{reset:true});
      if(!worldBinding?.ok||!worldBinding?.bound)throw new Error('Evidence campaign failed to bind production WorldState '+JSON.stringify(worldBinding));
      const when=window.GameTime?.getTimestampKey?.();
      if(!seed||!when)throw new Error('Campaign SEED/Fantasy Game Time unavailable');
      const object=window.InteriorObjects.build(seed).find(o=>Array.isArray(o.actions)&&o.actions.length&&o.interactionPositions?.length);
      if(!object)throw new Error('No authoritative actionable interior object');
      const action=String(object.actions[0]),actorPosition={x:String(object.interactionPositions[0].x),y:String(object.interactionPositions[0].y),level:0};
      const advanceWhen=(value,seconds)=>{
        const m=String(value).match(/^(\\d{4,})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})$/);if(!m)throw new Error('Invalid Fantasy Game Time '+value);
        const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]+seconds)),p=n=>String(n).padStart(2,'0');
        return String(d.getUTCFullYear()).padStart(4,'0')+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds());
      };
      window.ProtagonistActionRuntime.reset();window.ProtagonistInteractionPipeline.clear(seed);window.ConversationTransactions.clear(seed);window.CharacterMemory.clear(seed);
      const insight=window.AdvisorInsight.analyze(seed,{subject:{id:object.id,type:'object'},fantasyTimestamp:when,evidence:[
        {refId:'SIM:'+object.id,subjectId:object.id,sourceType:'simulation',reliability:'verified',claimKey:'actionable-object',stance:'support',fantasyTimestamp:when},
        {refId:'OBS:'+object.id,subjectId:object.id,sourceType:'direct-observation',reliability:'verified',claimKey:'actionable-object',stance:'support',fantasyTimestamp:when}
      ]});
      if(!insight?.ok||insight.result?.status!=='supported')throw new Error('Grounded Insight failed '+JSON.stringify(insight));
      const resolution=window.AdvisorToolResolutionBoundary.autoResolve(seed,{requestId:'REQ-WP-S011-010-VISUAL',toolId:'advisor.insight',fantasyTimestamp:when,context:{refId:insight.result.id,sourceSystem:'AdvisorInsight',validated:true},accessibility:{inputModality:'keyboard'}});
      if(!resolution?.ok||resolution.result?.authority?.executesAction!==false)throw new Error('Advisor tool resolution failed '+JSON.stringify(resolution));
      const progression=window.AdvisorProgression.award(seed,'insight',{campaignSeed:seed,kind:'advisor-tool-result',authority:'AdvisorToolResolution',validated:true,rewardBand:'success',fantasyTimestamp:when,toolId:'advisor.insight',outcomeId:resolution.result.id,sourceSystem:'AdvisorToolResolution'});
      if(!progression?.ok)throw new Error('Validated progression award failed '+JSON.stringify(progression));
      const advice=window.AdvisorChannel.recordAdvice(seed,{topic:'Insight '+insight.result.id+': use the grounded workshop object.',target:{type:'interaction',id:object.id,label:object.type},timestamp:when,details:'Evidence '+insight.result.evidenceRefIds.join(', ')},'protagonist');
      const memory=window.CharacterMemory.recordAdviceReference(seed,{kind:'protagonist',id:'protagonist'},advice.id,{timestamp:when,summary:'Grounded Advisor finding '+insight.result.id+' supports using '+object.type+'.'});
      if(!advice?.id||!memory?.id)throw new Error('Advice/memory linkage failed');

      const personId='WP011010-R01';
      const snapshot=window.CommandSetInterface.buildSnapshot({seed,when,origin:actorPosition},{
        getResidentRoster(){return [{id:personId,name:'Rowan'}];},
        getDailyActivities(){return [{residentId:personId,target:actorPosition,state:'working',action,intendedAction:action,label:'Using '+object.type,buildingId:object.buildingId,interactionObjectId:object.id,interactionObjectType:object.type,targetSource:'interior-interaction'}];},
        queryDestinations(){return {results:[],diagnostics:{bounded:true,fullWorldScan:false}};},
        getCountry(){return null;},getRoadGraph(){return null;},getKnownLeads(){return [];}
      });
      const route=window.LocalConversationRouter.route('Speak with Rowan and use the workshop object.',{seed,when,character:{id:'protagonist',name:'Protagonist'},externalAiEnabled:false},{matchSentence(){return null;},getMemory(){return [];},getAdvice(){return [];},getSocialContext(){return null;}});
      if(route.selectedIntentId!=='advisor.interaction.request')throw new Error('Unexpected advice intent '+route.selectedIntentId);
      const interaction=snapshot.targets.interactions.find(x=>x.id===object.id),person=snapshot.targets.people.find(x=>x.id===personId);
      if(!interaction||!person||!interaction.personIds.includes(personId))throw new Error('Bounded command snapshot missing authoritative target association');
      const proposal={proposalId:'PROP-WP-S011-010-VISUAL',commandId:'advisor.propose_interaction',parameters:{personId,interactionTargetId:object.id,topic:'Use the grounded workshop object'},source:'advisor-insight:'+insight.result.id};
      const scheduled=window.ProtagonistActionRuntime.schedule({seed,when,snapshot,proposal,actorId:'protagonist',actorPosition,decisionContext:{value:.98,urgency:.92,socialAcceptability:.95}});
      if(!scheduled?.ok)throw new Error('Runtime schedule failed '+JSON.stringify(scheduled));
      const firstTick=window.ProtagonistActionRuntime.tick({seed,when,maxAttempts:1}),firstRow=firstTick?.processed?.[0];
      if(firstRow?.state!=='running')throw new Error('Production action did not enter active Simulation state '+JSON.stringify(firstRow));
      const completionWhen=advanceWhen(when,30),tick=window.ProtagonistActionRuntime.tick({seed,when:completionWhen,maxAttempts:1}),row=tick?.processed?.[0],evaluation=row?.evaluatorResult;
      if(row?.state!=='succeeded'||evaluation?.execution?.state!=='completed'||evaluation?.execution?.authoritativeResult?.terminal!==true)throw new Error('Authoritative terminal execution missing '+JSON.stringify(row));
      const stored=window.ConversationTransactions.fromEvaluation(seed,{messageId:'MSG-WP-S011-010-VISUAL',referenceId:insight.result.id,role:'player',text:'Speak with Rowan and use the workshop object.'},route,evaluation,{advisorChannelIds:[advice.id],characterMemoryIds:[memory.id],replyText:'I used the grounded workshop object. Simulation confirmed the result.'});
      if(!stored?.ok||stored.record?.outcome?.state!=='completed')throw new Error('Conversation history missing terminal Simulation result '+JSON.stringify(stored));
      window.ProtagonistStatusUI?.setEvidenceMode?.(null);window.ProtagonistActivityUI.setEvidenceMode(null);window.AdvisorConversationUI.setEvidenceMode(null);window.AdvisorToolbeltUI.setEvidenceMode(null);
      const pipeline=window.ProtagonistInteractionPipeline.get(seed,evaluation.execution.authoritativeResult.attemptId);
      return {
        seed,when,completionWhen,objectId:object.id,objectType:object.type,action,
        insightId:insight.result.id,insightStatus:insight.result.status,evidenceRefs:insight.result.evidenceRefIds,
        resolutionId:resolution.result.id,progressionEventId:progression.event.id,insightXp:progression.track.totalXp,
        adviceId:advice.id,memoryId:memory.id,proposalId:evaluation.proposal.proposalId,runtimeAttemptId:row.attemptId,
        decision:evaluation.decision,decisionId:evaluation.decisionId,executionId:evaluation.executionId,
        interactionAttemptId:pipeline?.attemptId||null,interactionResultId:pipeline?.resultId||null,interactionStatus:pipeline?.status||null,
        terminalSimulation:Boolean(pipeline?.simulation?.authoritativeTerminalSuccess),conversationId:stored.record.id,historyOutcome:stored.record.outcome.state,
        conversationReferenceId:stored.record.message.referenceId,commandBounds:snapshot.diagnostics
      };
    """)

def tool_state(profile,chain):
    return driver.execute_script("""
      const profile=arguments[0],chain=arguments[1],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('advisorToolbeltPanel'),map=document.querySelector('.planet-map-context'),places=document.querySelector('.planet-places-button'),scale=document.querySelector('.planet-scale-ruler'),result=document.querySelector('.advisor-tool-result');
      const p=rect(panel),inside=x=>Boolean(x&&x.left>=-.5&&x.top>=-.5&&x.right<=innerWidth+.5&&x.bottom<=innerHeight+.5),model=window.AdvisorToolbeltUI.currentModel(),snap=window.AdvisorToolbeltUI.snapshot();
      return {profile,viewport:{width:innerWidth,height:innerHeight},panel:p,panelInside:inside(p),documentWidth:document.documentElement.scrollWidth,
        overlap:{map:ov(p,rect(map)),places:ov(p,rect(places)),scale:ov(p,rect(scale))},selected:model.selected,fixture:model.fixture,result:model.result,skill:model.skills.find(x=>x.id==='insight')||null,recent:model.recent,
        visibleText:result?.innerText||'',snapshot:snap,chainInsightId:chain.insightId};
    """,profile,chain)

def chat_state(profile):
    return driver.execute_script("""
      const profile=arguments[0],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('advisorChatPanel'),activity=document.querySelector('.advisor-activity-strip'),status=document.querySelector('.advisor-chat-status'),trace=document.querySelector('.advisor-chat-trace'),map=document.querySelector('.planet-map-context'),places=document.querySelector('.planet-places-button'),scale=document.querySelector('.planet-scale-ruler');
      const p=rect(panel),a=rect(activity),inside=x=>Boolean(x&&x.left>=-.5&&x.top>=-.5&&x.right<=innerWidth+.5&&x.bottom<=innerHeight+.5);
      const act=window.ProtagonistActivityUI.snapshot(),chat=window.AdvisorConversationUI.snapshot();
      return {profile,viewport:{width:innerWidth,height:innerHeight},panel:p,activity:a,panelInside:inside(p),activityInside:inside(a),documentWidth:document.documentElement.scrollWidth,
        overlap:{map:ov(p,rect(map)),places:ov(p,rect(places)),scale:ov(p,rect(scale))},activityPhase:activity?.dataset?.activityPhase||null,activityText:activity?.innerText||'',conversationStatus:status?.innerText?.trim()||'',traceText:trace?.innerText||'',activitySnapshot:act,chatSnapshot:chat};
    """,profile)

def assert_common(s,label):
    if not s["panelInside"]:raise RuntimeError(label+" panel escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError(label+" horizontal overflow "+json.dumps(s))
    if s["overlap"]["map"]>1 or s["overlap"]["places"]>1 or s["overlap"]["scale"]>1:raise RuntimeError(label+" overlaps required map chrome "+json.dumps(s))

def assert_tool(s,chain):
    assert_common(s,"toolbelt")
    if s["fixture"] is not False:raise RuntimeError("toolbelt visual must use production model "+json.dumps(s))
    if s["selected"]!="insight" or s["result"].get("id")!=chain["insightId"]:raise RuntimeError("production Insight result missing "+json.dumps(s))
    if s["result"].get("authority")!="Advisory" or s["result"].get("status")!="supported":raise RuntimeError("Insight authority/status incorrect "+json.dumps(s))
    if float(s["result"].get("confidence") or 0)<=0:raise RuntimeError("Insight confidence not visible "+json.dumps(s))
    if not s.get("skill") or int(s["skill"].get("totalXp") or 0)<40:raise RuntimeError("validated progression not reflected "+json.dumps(s))
    if not any(r.get("id")==chain["resolutionId"] for r in s.get("recent",[])):raise RuntimeError("tool resolution history missing "+json.dumps(s))
    auth=s["snapshot"].get("authority",{})
    for key in ["perFrameRender","fullWorldScan","directWorldMutation","directActionExecution","fixtureAuthority","protagonistDecisionAuthority","simulationValidationBypass"]:
        if auth.get(key) is not False:raise RuntimeError("toolbelt authority regression "+key+" "+json.dumps(s))

def assert_chat(s):
    assert_common(s,"chat")
    if not s["activityInside"]:raise RuntimeError("activity escaped viewport "+json.dumps(s))
    if s["activityPhase"]!="completed" or not s["activitySnapshot"].get("completionBacked"):raise RuntimeError("activity lacks terminal Simulation completion "+json.dumps(s))
    if str(s["conversationStatus"]).strip().upper()!="COMPLETED":raise RuntimeError("conversation does not visibly reflect completion "+json.dumps(s))
    if "Simulation" not in s["activityText"] or "Result" not in s["activityText"]:raise RuntimeError("visible completion lacks Simulation/result evidence "+json.dumps(s))
    auth=s["chatSnapshot"].get("authority",{})
    if auth.get("directWorldMutation") is not False or auth.get("directExecution") is not False or auth.get("protagonistDecisionBypass") is not False:raise RuntimeError("Advisor chat crossed authority boundary "+json.dumps(s))

frames=[]
try:
    driver.set_window_size(*VIEWPORTS["phone"]);driver.get(target_url())
    try:wait.until(lambda d:page_ready())
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    if not load_object_interactions():raise RuntimeError("Production ObjectInteractions failed to load")
    chain=execute_chain()
    if chain["interactionStatus"]!="terminal-success" or not chain["terminalSimulation"] or chain["historyOutcome"]!="completed" or chain["conversationReferenceId"]!=chain["insightId"]:raise RuntimeError("acceptance chain not authoritative "+json.dumps(chain))
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size);time.sleep(.45)
        driver.execute_script("window.AdvisorConversationUI.setOpen(false);window.AdvisorToolbeltUI.setOpen(true);window.AdvisorToolbeltUI.render('wp-s011-010-tool-'+arguments[0]);",profile);time.sleep(.25)
        ts=tool_state(profile,chain);tp=OUT/f"{profile}-grounded-insight.png";driver.save_screenshot(str(tp));assert_tool(ts,chain);frames.append({"profile":profile,"surface":"toolbelt","file":str(tp),"state":ts})
        driver.execute_script("window.AdvisorToolbeltUI.setOpen(false);window.AdvisorConversationUI.setOpen(true);window.AdvisorConversationUI.render('wp-s011-010-outcome-'+arguments[0]);",profile);time.sleep(.25)
        cs=chat_state(profile);cp=OUT/f"{profile}-authoritative-outcome.png";driver.save_screenshot(str(cp));assert_chat(cs);frames.append({"profile":profile,"surface":"outcome","file":str(cp),"state":cs})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S011-010","classification":"MIXED","chain":chain,"frames":frames}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":len(frames),"chain":{k:chain[k] for k in ["insightId","resolutionId","progressionEventId","adviceId","memoryId","proposalId","decision","decisionId","executionId","interactionAttemptId","interactionResultId","conversationId","historyOutcome"]}},indent=2))
except Exception:
    try:driver.save_screenshot(str(OUT/"failure.png"))
    except Exception:pass
    raise
finally:
    driver.quit()
