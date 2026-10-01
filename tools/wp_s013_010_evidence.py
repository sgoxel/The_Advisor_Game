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
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1","advisorEvidence":"ordinary"})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const stage=document.getElementById('planetStageRoot');
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&window.ObjectInteractions&&window.ProtagonistRankAccess&&window.AppUI&&window.ContextualReactions);
        """)
    except Exception:return False

def setup(case):
    return driver.execute_script("""
      const mode=arguments[0],seed=window.SeedSystem?.getCampaign?.()?.seed;
      if(!seed)return {ok:false,reason:'campaign-unavailable'};
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
      window.AppUI.closeObjectInteractionForEvidence?.();
      if(mode.endsWith('access')){
        const shown=window.AppUI.showObjectInteractionForEvidence('door',0,{buildingKind:'storehouse'});
        return {ok:Boolean(shown),mode,shown};
      }
      const proof=window.ContextualReactions.beginProof(seed,'close-follow');
      return {ok:Boolean(proof?.reaction),mode,proof};
    """,case)

def state(case,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1];
      const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const inside=r=>Boolean(!r||(r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5));
      const ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('objectInteractionPanel'),reaction=document.querySelector('.contextual-npc-reaction');
      const p=panel&&!panel.hidden?rect(panel):null,r=rect(reaction);
      const map=rect(document.querySelector('.planet-map-context')),places=rect(document.querySelector('.planet-places-button')),scale=rect(document.querySelector('.planet-scale-ruler'));
      const snap=window.AppUI?.objectInteractionPanelSnapshot?.()||null,rank=window.ProtagonistRankAccess?.snapshot?.(window.SeedSystem?.getCampaign?.()?.seed,'protagonist')||null,ctx=window.ContextualReactions?.snapshot?.()||null;
      return {
        mode,profile,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,
        panel:p,reaction:r,panelInside:inside(p),reactionInside:inside(r),
        panelText:panel&&!panel.hidden?panel.innerText.replace(/\s+/g,' ').trim():'',
        reactionText:reaction?reaction.innerText.replace(/\s+/g,' ').trim():'',
        reactionRecognized:reaction?.dataset?.rankRecognized||null,
        overlap:{panelMap:ov(p,map),panelPlaces:ov(p,places),panelScale:ov(p,scale),reactionMap:ov(r,map),reactionPlaces:ov(r,places),reactionScale:ov(r,scale)},
        interaction:snap,rankSnapshot:rank,reactionSnapshot:ctx
      };
    """,case,profile)

def assert_state(s):
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if not s["panelInside"] or not s["reactionInside"]:raise RuntimeError("presentation escaped viewport "+json.dumps(s))
    for k,v in s["overlap"].items():
        if v>1:raise RuntimeError("rank cue overlaps required world chrome "+k+" "+json.dumps(s))
    rank=s.get("rankSnapshot") or {}
    for key in ["fullWorldScan","wholeSettlementScan","wholeHistoryScan","perFrameScan"]:
        if rank.get(key) is not False:raise RuntimeError("rank scan regression "+key+" "+json.dumps(s))
    if rank.get("readOnly") is not True or rank.get("eventDriven") is not True:raise RuntimeError("rank authority regression "+json.dumps(s))
    mode=s["mode"]
    if mode=="ordinary-access":
        if (s.get("interaction") or {}).get("accessStatus")!="restricted":raise RuntimeError("ordinary storehouse not restricted "+json.dumps(s))
        if "RESTRICTED" not in s["panelText"].upper() or "ENTER · RESTRICTED" not in s["panelText"].upper():raise RuntimeError("restricted access cue missing "+json.dumps(s))
    elif mode=="authority-access":
        if (s.get("interaction") or {}).get("accessStatus")!="permitted":raise RuntimeError("steward storehouse not permitted "+json.dumps(s))
        if "PERMITTED" not in s["panelText"].upper() or "ENTER · RESTRICTED" in s["panelText"].upper():raise RuntimeError("permitted access cue wrong "+json.dumps(s))
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
        if not result.get("ok"):raise RuntimeError("evidence setup failed "+json.dumps(result))
        time.sleep(.2)
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
