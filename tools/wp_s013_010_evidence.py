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
VIEWPORTS={"phone":(390,844),"phone-landscape":(844,390),"desktop":(1280,720)}
CASES=[
    ("phone","ordinary-access"),
    ("phone","authority-access"),
    ("phone-landscape","known-reaction"),
    ("desktop","authority-access"),
    ("desktop","known-reaction"),
    ("desktop","unknown-reaction"),
]

def url():
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1"})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,300)

def ready():
    try:
        return driver.execute_script("""
          const s=window.PlanetStage?.snapshot?.();
          return Boolean(s?.ready&&s?.activeSeed&&window.StartingVillage&&window.DailyActivity&&window.ContextualReactions&&window.ProtagonistRankAccess);
        """)
    except Exception:return False

def patch_context(case):
    return driver.execute_script("""
      const mode=arguments[0];
      if(!window.__wp010OriginalAuthority)window.__wp010OriginalAuthority=window.ProtagonistAuthority;
      if(!window.__wp010OriginalMemory)window.__wp010OriginalMemory=window.CharacterMemory;
      const steward=mode!=='ordinary-access';
      window.ProtagonistAuthority=Object.freeze({
        ...window.__wp010OriginalAuthority,
        snapshot(){
          return steward
            ?{exists:true,currentRole:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'local-authority',scopes:['self','settlement:administration','settlement:request-assistance']}}
            :{exists:true,currentRole:{roleId:'local-resident',title:'Local Resident',rankTier:0,rankLabel:'ordinary',scopes:['self']}};
        }
      });
      const known=mode==='known-reaction';
      window.CharacterMemory=Object.freeze({
        ...window.__wp010OriginalMemory,
        recognition(_seed,residentId){return {metBefore:true,scannedEntryCount:2,residentId,bounded:true};},
        recognitionReference(_seed,residentId){return known?{id:'MEM-WP010-'+residentId,topic:'Village Steward office',summary:'Observed the protagonist serving as Village Steward.'}:null;}
      });
      window.ContextualReactions.endProof?.();
      window.PlanetStage.dismissInspection?.();
      return {ok:true,mode,seed:window.PlanetStage.snapshot().activeSeed};
    """,case)

def prime_access():
    return driver.execute_script("""
      const s=window.PlanetStage.snapshot(),seed=s.activeSeed,p=window.StartingVillage?.plan?.(seed);
      if(!seed||!p?.center)return {ok:false,reason:'starting-village-unavailable',seed,plan:p||null};
      window.PlanetStage.setWorldTileFocus(String(p.center.x),String(p.center.y));
      window.PlanetStage.setScaleIndex(8);
      return {ok:true,seed,center:{x:String(p.center.x),y:String(p.center.y)},name:String(p.name||'Starting Village')};
    """)

def access_ready():
    try:
        return driver.execute_script("""
          const s=window.PlanetStage.snapshot(),ls=s.projection?.localStatic||{},targets=window.PlanetStage.inspectionTargets?.()||[];
          return Boolean(s.ready&&['refined','full'].includes(String(ls.revealTier||''))&&ls.active&&targets.some(t=>t.type==='building'&&t.authority?.kind==='storehouse'));
        """)
    except Exception:return False

def select_access():
    return driver.execute_script("""
      const targets=window.PlanetStage.inspectionTargets?.()||[],target=targets.find(t=>t.type==='building'&&t.authority?.kind==='storehouse')||null;
      if(!target)return {ok:false,reason:'storehouse-inspection-unavailable'};
      window.PlanetStage.selectBuildingForEvidence?.(target.id);
      const tip=document.querySelector('.world-inspection-tooltip');
      return {ok:Boolean(tip),target,access:tip?.dataset?.rankAccess||null,text:tip?.innerText||''};
    """)

def setup(case):
    base=patch_context(case)
    if not base.get("ok"):return base
    if case.endswith("access"):
        primed=prime_access()
        if not primed.get("ok"):return primed
        try:WebDriverWait(driver,120).until(lambda d:access_ready())
        except TimeoutException:return {"ok":False,"reason":"local-storehouse-not-materialized","prime":primed}
        selected=select_access()
        return {"ok":bool(selected.get("ok")),"mode":case,"selected":selected}
    return driver.execute_script("""
      const mode=arguments[0],seed=window.PlanetStage.snapshot().activeSeed;
      const proof=window.ContextualReactions.beginProof(seed,'close-follow');
      return {ok:Boolean(proof?.reaction),mode,proof};
    """,case)

def state(case,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1];
      const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const inside=r=>Boolean(!r||(r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5));
      const ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const tip=document.querySelector('.world-inspection-tooltip'),reaction=document.querySelector('.contextual-npc-reaction');
      const t=rect(tip),r=rect(reaction);
      const chrome={
        map:rect(document.querySelector('.planet-map-context')),
        places:rect(document.querySelector('.planet-places-button')),
        scale:rect(document.querySelector('.planet-scale-ruler')),
        advisor:rect(document.querySelector('.advisor-chat-launcher')),
        toolbelt:rect(document.querySelector('.advisor-toolbelt-launcher')),
        economy:rect(document.querySelector('.advisor-economy-launcher'))
      };
      const s=window.PlanetStage?.snapshot?.()||null,rank=window.ProtagonistRankAccess?.snapshot?.(s?.activeSeed,'protagonist')||null,ctx=window.ContextualReactions?.snapshot?.()||null;
      return {
        mode,profile,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,
        tooltip:t,reaction:r,tooltipInside:inside(t),reactionInside:inside(r),
        tooltipText:tip?tip.innerText.replace(/\s+/g,' ').trim():'',
        tooltipAccess:tip?.dataset?.rankAccess||null,tooltipReason:tip?.dataset?.rankReason||null,
        reactionText:reaction?reaction.innerText.replace(/\s+/g,' ').trim():'',
        reactionRecognized:reaction?.dataset?.rankRecognized||null,
        overlap:Object.fromEntries(Object.entries(chrome).flatMap(([k,v])=>[['tooltip-'+k,ov(t,v)],['reaction-'+k,ov(r,v)]])),
        planet:s,rankSnapshot:rank,reactionSnapshot:ctx
      };
    """,case,profile)

def assert_state(s):
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if not s["tooltipInside"] or not s["reactionInside"]:raise RuntimeError("rank presentation escaped viewport "+json.dumps(s))
    for k,v in s["overlap"].items():
        if v>1 and (("tooltip-" in k and s["tooltip"] is not None) or ("reaction-" in k and s["reaction"] is not None)):
            raise RuntimeError("rank presentation overlaps required world chrome "+k+" "+json.dumps(s))
    rank=s.get("rankSnapshot") or {}
    for key in ["fullWorldScan","wholeSettlementScan","wholeHistoryScan","perFrameScan"]:
        if rank.get(key) is not False:raise RuntimeError("rank scan regression "+key+" "+json.dumps(s))
    if rank.get("readOnly") is not True or rank.get("eventDriven") is not True:raise RuntimeError("rank authority regression "+json.dumps(s))
    mode=s["mode"]
    if mode=="ordinary-access":
        if s.get("tooltipAccess")!="restricted":raise RuntimeError("ordinary storehouse not restricted "+json.dumps(s))
        if "ACCESS · RESTRICTED" not in s["tooltipText"].upper() or "SETTLEMENT:ADMINISTRATION" not in s["tooltipText"].upper():raise RuntimeError("restricted access cue missing "+json.dumps(s))
    elif mode=="authority-access":
        if s.get("tooltipAccess")!="permitted":raise RuntimeError("steward storehouse not permitted "+json.dumps(s))
        if "ACCESS · PERMITTED" not in s["tooltipText"].upper() or "VILLAGE STEWARD" not in s["tooltipText"].upper():raise RuntimeError("permitted access cue wrong "+json.dumps(s))
    elif mode=="known-reaction":
        if s.get("reactionRecognized")!="true" or "VILLAGE STEWARD" not in s["reactionText"].upper():raise RuntimeError("known NPC did not acknowledge title "+json.dumps(s))
    elif mode=="unknown-reaction":
        if s.get("reactionRecognized")!="false" or "VILLAGE STEWARD" in s["reactionText"].upper():raise RuntimeError("unknown NPC gained omniscient title knowledge "+json.dumps(s))

records=[]
try:
    driver.set_window_size(*VIEWPORTS["phone"]);driver.get(url())
    try:wait.until(lambda d:ready())
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    for profile,case in CASES:
        driver.set_window_size(*VIEWPORTS[profile]);time.sleep(.3)
        result=setup(case)
        if not result.get("ok"):
            driver.save_screenshot(str(OUT/f"{profile}-{case}-setup-failure.png"))
            raise RuntimeError("evidence setup failed "+json.dumps(result))
        time.sleep(.25)
        s=state(case,profile);assert_state(s)
        path=OUT/f"{profile}-{case}.png";driver.save_screenshot(str(path))
        records.append({"profile":profile,"case":case,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S013-010","classification":"MIXED","screenshots":len(records),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"wp":"WP-S013-010","screenshots":len(records),"cases":[c for _,c in CASES]},indent=2))
finally:
    driver.quit()
