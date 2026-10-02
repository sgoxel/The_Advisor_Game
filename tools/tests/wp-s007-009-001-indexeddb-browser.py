#!/usr/bin/env python3
import json, os, tempfile, shutil, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE=os.environ.get("TARGET","http://127.0.0.1:8000/tools/tests/wp-s007-009-001-browser-harness.html")
profile=tempfile.mkdtemp(prefix="advisor-generated-world-")

def browser():
    o=Options()
    o.add_argument("--headless=new")
    o.add_argument("--no-sandbox")
    o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--disable-gpu")
    o.add_argument("--window-size=900,700")
    o.add_argument(f"--user-data-dir={profile}")
    return webdriver.Chrome(options=o)

def async_js(driver, source):
    result=driver.execute_async_script(source)
    if isinstance(result,dict) and result.get("error"):
        raise AssertionError(result["error"])
    return result

try:
    d=browser()
    d.get(BASE)
    WebDriverWait(d,30).until(lambda x:x.execute_script("return Boolean(window.GeneratedWorldStore)"))
    first=async_js(d,r"""
      const done=arguments[0];
      (async()=>{
        const G=window.GeneratedWorldStore,c=window.__campaign;
        const bound=await G.bindCampaign(c,{prime:false});
        let generators=0;
        const base=(family,id)=>({seed:c.seed,family,recordId:id,familyVersion:1,dependencySignature:"browser-v1",generatorVersion:"advisor-world-foundation-v1",regenCost:5,importance:4});
        const rows=[];
        for(const [family,id] of [["settlement-plan","SET-BROWSER"],["road-graph","COUNTRY-BROWSER|r4|country-partition"],["poi-cell","2,3"],["logical-chunk","5,8"]]){
          const r=await G.resolve(base(family,id),async()=>{generators++;return {family,id,signature:"BROWSER-"+family+"-"+id}});
          rows.push({family,id,generated:r.generated,source:r.source,value:r.value});
        }
        let flush=await G.flush({maxRecords:32});
        while(G.telemetry().dirtyQueueDepth)flush=await G.flush({maxRecords:32});
        localStorage.setItem("wp-s007-009-001-authoritative",JSON.stringify({seed:c.seed,settlementRevision:11,npcRevision:6}));
        done({bound,rows,generators,flush,telemetry:G.telemetry()});
      })().catch(e=>done({error:String(e&&e.stack||e)}));
    """)
    assert first["bound"]["backend"]=="indexeddb", first
    assert first["bound"]["durable"] is True, first
    assert first["generators"]==4 and all(x["generated"] for x in first["rows"]), first
    assert first["flush"]["ok"] is True, first
    assert first["telemetry"]["persistentCacheRecords"]==4, first
    assert first["telemetry"]["writeRecords"]==4, first
    assert first["telemetry"]["dirtyQueueDepth"]==0, first
    first_values={x["family"]:x["value"] for x in first["rows"]}
    d.quit()
    time.sleep(1.0)

    d=browser()
    d.get(BASE)
    WebDriverWait(d,30).until(lambda x:x.execute_script("return Boolean(window.GeneratedWorldStore)"))
    second=async_js(d,r"""
      const done=arguments[0];
      (async()=>{
        const G=window.GeneratedWorldStore,c=window.__campaign;
        const bound=await G.bindCampaign(c,{primeLimit:16});
        let generators=0;
        const base=(family,id)=>({seed:c.seed,family,recordId:id,familyVersion:1,dependencySignature:"browser-v1",generatorVersion:"advisor-world-foundation-v1",regenCost:5,importance:4});
        const rows=[];
        for(const [family,id] of [["settlement-plan","SET-BROWSER"],["road-graph","COUNTRY-BROWSER|r4|country-partition"],["poi-cell","2,3"],["logical-chunk","5,8"]]){
          const r=await G.resolve(base(family,id),async()=>{generators++;return {unexpected:true,family,id}});
          rows.push({family,id,generated:r.generated,source:r.source,value:r.value});
        }
        const newRecord=await G.resolve(base("poi-cell","3,3"),async()=>{generators++;return {family:"poi-cell",id:"3,3",signature:"NEW-BROWSER-POI"}});
        await G.flush({maxRecords:32});
        const beforeClear=G.telemetry();
        const clear=await G.clearDerived();
        const authoritative=JSON.parse(localStorage.getItem("wp-s007-009-001-authoritative")||"null");
        done({bound,rows,generators,newRecord,beforeClear,clear,authoritative,afterClear:G.telemetry()});
      })().catch(e=>done({error:String(e&&e.stack||e)}));
    """)
    assert second["bound"]["backend"]=="indexeddb" and second["bound"]["durable"] is True, second
    assert second["bound"]["prime"]["loaded"]==4, second
    assert second["generators"]==1, second
    assert all(not x["generated"] for x in second["rows"]), second
    for row in second["rows"]:
        assert row["value"]==first_values[row["family"]], (row,first_values)
    assert second["newRecord"]["generated"] is True, second
    assert second["beforeClear"]["persistentCacheRecords"]==5, second
    assert second["beforeClear"]["wholeCacheLoadedAtStartup"] is False, second
    assert second["clear"]["authoritativeCampaignUntouched"] is True, second
    assert second["authoritative"]=={"seed":"WP_S007_009_001_BROWSER","settlementRevision":11,"npcRevision":6}, second
    assert second["afterClear"]["persistentCacheRecords"]==0, second
    print(json.dumps({
      "pass":True,
      "backend":second["bound"]["backend"],
      "browserRestartPersistent":True,
      "firstSessionGenerated":first["generators"],
      "secondSessionRegeneratedExisting":0,
      "secondSessionGeneratedMissing":1,
      "primedRecords":second["bound"]["prime"]["loaded"],
      "recordsBeforeDerivedClear":second["beforeClear"]["persistentCacheRecords"],
      "authoritativeCampaignUntouched":second["clear"]["authoritativeCampaignUntouched"],
      "firstWriteBatchMs":first["telemetry"]["lastWriteBatchMs"],
      "secondReadBatchMs":second["beforeClear"]["lastReadBatchMs"],
      "wholeCacheLoadedAtStartup":False
    },indent=2))
    d.quit()
finally:
    try:
        d.quit()
    except Exception:
        pass
    shutil.rmtree(profile,ignore_errors=True)
