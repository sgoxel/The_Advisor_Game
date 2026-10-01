#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s013-010"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone":(390,844),"desktop":(1280,720)}

def target_url():
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q["evidence_fast_start"]="1"
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const stage=document.getElementById('planetStageRoot');
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&window.AppUI&&window.ObjectInteractions&&window.ProtagonistRankAccess&&window.ContextualReactions&&window.SpecialLots);
        """)
    except Exception:return False

def initialize_campaign():
    return driver.execute_async_script("""
      const done=arguments[arguments.length-1],candidates=['AGENT6-WP-S013-010-A','AGENT6-WP-S013-010-B','AGENT6-WP-S013-010-C','AGENT6-WP-S013-010-D'];
      try{
        const seed=candidates.find(s=>(window.SpecialLots?.build?.(s)||[]).some(x=>x.kind==='meeting-hall'))||candidates[0];
        Promise.resolve(window.AppUI.startNewCampaignForEvidence(seed)).then(()=>done({ok:true,seed})).catch(e=>done({ok:false,error:String(e)}));
      }catch(e){done({ok:false,error:String(e)})}
    """)

def set_scenario(mode):
    return driver.execute_script("""
      const mode=arguments[0],campaign=window.SeedSystem?.getCampaign?.(),seed=campaign?.seed;
      if(!seed)throw new Error('Campaign unavailable');
      if(!window.__wp13010Originals)window.__wp13010Originals={authority:window.ProtagonistAuthority,memory:window.CharacterMemory,social:window.SocialState};
      const higher=mode!=='ordinary',known=mode==='known';
      const base=window.__wp13010Originals;
      window.ProtagonistAuthority={...base.authority,snapshot(){return{exists:true,currentRole:higher?{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']}:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']}}}};
      window.CharacterMemory={...base.memory,recognition(){return known?{metBefore:true,meaningfulEncounterCount:3,familiarity:'known'}:{metBefore:false,meaningfulEncounterCount:0,familiarity:'stranger'}}};
      window.SocialState={...base.social,dialogueContext(){return{values:{trust:.72,respect:.68,suspicion:.12,fear:.08,loyalty:.4,resentment:.05},reputations:known?[{scope:'settlement',id:'starting-village',score:.6,eventIds:['SOC-EVIDENCE-RANK']}]:[]}}};
      window.ContextualReactions.endProof?.();
      window.AppUI.closeObjectInteractionForEvidence?.();
      if(mode==='ordinary'||mode==='authority'){
        const shown=window.AppUI.showObjectInteractionForEvidence('table',0,'Village Meeting Hall');
        if(!shown)throw new Error('Village Meeting Hall table unavailable');
        const work=shown.context.actions.find(x=>x.id==='work');
        return{mode,seed,kind:'access',context:shown.context,work,panel:window.AppUI.objectInteractionPanelSnapshot(),telemetry:window.ProtagonistRankAccess.telemetry()};
      }
      const proof=window.ContextualReactions.beginProof(seed,'close-follow');
      if(!proof?.reaction)throw new Error('Contextual reaction proof unavailable');
      return{mode,seed,kind:'reaction',proof,rank:window.ProtagonistRankAccess.npcReaction(seed,proof.residentId,'protagonist',proof.when,{label:'the local exchange'}),telemetry:window.ProtagonistRankAccess.telemetry()};
    """,mode)

def frame_state(mode,scenario):
    return driver.execute_script("""
      const mode=arguments[0],scenario=arguments[1],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(!r.width&&!r.height)return null;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const inside=r=>Boolean(r&&r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5);
      const panel=document.getElementById('objectInteractionPanel'),reaction=document.querySelector('.contextual-npc-reaction'),work=[...(document.querySelectorAll('#objectInteractionActions button')||[])].find(b=>b.dataset.action==='work');
      const p=rect(panel),r=rect(reaction),message=document.getElementById('objectInteractionMessage')?.innerText||'',meta=document.getElementById('objectInteractionMeta')?.innerText||'';
      return{mode,scenario,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,panel:p,reaction:r,panelInside:p?inside(p):true,reactionInside:r?inside(r):true,meta,message,workText:work?.innerText||'',workDisabled:Boolean(work?.disabled),reactionText:reaction?.innerText||'',rankTelemetry:window.ProtagonistRankAccess.telemetry(),objectTelemetry:window.ObjectInteractions.snapshot(window.SeedSystem.getCampaign().seed)};
    """,mode,scenario)

def assert_frame(s):
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if not s["panelInside"] or not s["reactionInside"]:raise RuntimeError("rank cue escaped viewport "+json.dumps(s))
    if s["mode"]=="ordinary":
        if "STATUS RESTRICTED" not in s["meta"] or "RESTRICTED" not in s["workText"] or not s["workDisabled"]:raise RuntimeError("ordinary restricted cue missing "+json.dumps(s))
        if "status never bypasses Simulation" not in s["message"]:raise RuntimeError("ordinary Simulation wording missing "+json.dumps(s))
    elif s["mode"]=="authority":
        if "STATUS PERMITTED" not in s["meta"] or "PERMITTED" not in s["workText"] or s["workDisabled"]:raise RuntimeError("authority permitted cue missing "+json.dumps(s))
        if "Village Steward" not in s["message"] or "Simulation still validates" not in s["message"]:raise RuntimeError("authority Simulation wording missing "+json.dumps(s))
    elif s["mode"]=="known":
        if "Village Steward" not in s["reactionText"] or "recognize your standing" not in s["reactionText"]:raise RuntimeError("grounded rank acknowledgement missing "+json.dumps(s))
    elif s["mode"]=="unknown":
        if "Village Steward" in s["reactionText"] or "recognize your standing" in s["reactionText"]:raise RuntimeError("ungrounded resident magically recognized rank "+json.dumps(s))
    t=s["rankTelemetry"]
    for k in ["fullWorldScan","wholeSettlementScan","wholeHistoryScan","perFrameScan","relationshipMutation","worldMutation"]:
        if t.get(k) is not False:raise RuntimeError("rank telemetry authority regression "+k+" "+json.dumps(s))
    if s["objectTelemetry"].get("perFrameScan") is not False or s["objectTelemetry"].get("boundedLocalQuery") is not True:raise RuntimeError("object query bounds regression "+json.dumps(s))

frames=[]
try:
    driver.set_window_size(*VIEWPORTS["phone"]);driver.get(target_url())
    try:wait.until(lambda d:ready())
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    init=initialize_campaign()
    if not init.get("ok"):raise RuntimeError("campaign init failed "+json.dumps(init))
    wait.until(lambda d:ready());time.sleep(.5)
    matrix=[("phone","ordinary"),("phone","known"),("phone","unknown"),("desktop","authority"),("desktop","known"),("desktop","unknown")]
    for profile,mode in matrix:
        driver.set_window_size(*VIEWPORTS[profile]);time.sleep(.35)
        scenario=set_scenario(mode);time.sleep(.2)
        s=frame_state(mode,scenario);path=OUT/f"{profile}-{mode}.png";driver.save_screenshot(str(path));assert_frame(s);frames.append({"profile":profile,"mode":mode,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S013-010","classification":"MIXED","seed":init["seed"],"frames":frames}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"wp":"WP-S013-010","screenshots":len(frames),"matrix":matrix,"seed":init["seed"]},indent=2))
except Exception:
    try:driver.save_screenshot(str(OUT/"failure.png"))
    except Exception:pass
    raise
finally:driver.quit()
