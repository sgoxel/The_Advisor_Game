#!/usr/bin/env python3
import json, os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument("--window-size=960,640")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)

try:
    driver.get(TARGET)
    WebDriverWait(driver,120).until(lambda d: d.execute_script(
        "return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.WorkCycles&&window.DailyActivity&&window.ResidentMovement&&window.ActionExecutor)"
    ))
    result=driver.execute_script("""
      const seed=PlanetStage.snapshot().activeSeed;
      const roster=DailyActivity.build(seed)||[];
      const supported=[...new Set(roster.map(r=>r.profession).filter(p=>WorkCycles.DEFINITIONS[p]))].sort();
      const representatives=supported.map(profession=>{
        const resident=roster.find(r=>r.profession===profession);
        const plan=WorkCycles.plan(seed,resident);
        const samples=WorkCycles.evidenceSamples(seed,profession);
        const visible=samples.find(s=>s.targetSource==="work-choreography")||
          samples.find(s=>s.targetSource==="outdoor-worksite")||null;
        let movement=null,action=null;
        if(visible){
          PlanetStage.applyAuthoritativeFantasyTime(visible.when,"WP-S004-007 live smoke");
          ResidentMovement.reset(seed);
          for(let i=0;i<220;i++){
            ResidentMovement.advance(seed,visible.when,1);
            movement=ResidentMovement.get(visible.residentId);
            if(movement?.status==="arrived"&&movement?.workCycle?.stepId===visible.stepId)break;
          }
          action=ActionExecutor.get("resident",visible.residentId);
        }
        return {
          profession,residentId:resident.id,plan,sampleCount:samples.length,visibleSample:visible,
          movement,action
        };
      });
      return {
        seed,rosterCount:roster.length,supported,
        representatives,
        verify:WorkCycles.verify(seed),
        telemetry:WorkCycles.snapshot(seed)
      };
    """)
    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))

    reps=result["representatives"]
    if result["rosterCount"] != 12:
        raise RuntimeError(f"unexpected live roster count: {result['rosterCount']}")
    if len(reps) < 4:
        raise RuntimeError(f"insufficient supported live professions: {result['supported']}")
    if not result["verify"].get("pass"):
        raise RuntimeError("WorkCycles.verify failed on live default seed: "+json.dumps(result["verify"]))
    for row in reps:
        plan=row.get("plan") or {}
        if not plan.get("valid"):
            raise RuntimeError(f"invalid live plan for {row['profession']}: {json.dumps(plan)}")
        if len(plan.get("steps") or []) < 3:
            raise RuntimeError(f"live plan lacks multi-step choreography for {row['profession']}")
        if not all(x.get("found") for x in plan.get("routeChecks") or []):
            raise RuntimeError(f"route continuity failed for {row['profession']}")
        if row.get("sampleCount",0) < 3:
            raise RuntimeError(f"insufficient fantasy-time step samples for {row['profession']}")
        visible=row.get("visibleSample")
        if visible:
            move=row.get("movement") or {}
            if move.get("status")!="arrived" or (move.get("workCycle") or {}).get("stepId")!=visible.get("stepId"):
                raise RuntimeError(f"resident did not reach live visible step for {row['profession']}: {json.dumps(move)}")
            action=row.get("action") or {}
            if action.get("status")!="active":
                raise RuntimeError(f"generic ActionExecutor did not activate for {row['profession']}: {json.dumps(action)}")
    telemetry=result.get("telemetry") or {}
    if telemetry.get("routePlanningPerFrame") is not False or telemetry.get("fullSettlementPerFrameScan") is not False:
        raise RuntimeError("performance authority flags regressed")
    if telemetry.get("economyAuthority") is not False or telemetry.get("resourceMutation") is not False:
        raise RuntimeError("work choreography gained forbidden economy/resource authority")
    print(json.dumps({"pass":True,**result},indent=2))
finally:
    driver.quit()
