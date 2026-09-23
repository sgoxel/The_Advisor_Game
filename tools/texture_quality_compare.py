#!/usr/bin/env python3
"""Compare PlayCanvas Low/Standard/High/Ultra material quality without changing Simulation truth."""
import json, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

URL=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/"
OUT=Path("tools/screenshots"); OUT.mkdir(parents=True,exist_ok=True)
opts=Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1280,800")
driver=webdriver.Chrome(options=opts)

def identity():
    return driver.execute_script("""
      const s=window.RendererContract?.simulationSnapshot?.()||{};
      return {
        seed:s.campaignSeed??SeedSystem?.getCampaign?.()?.seed??null,
        protagonist:s.protagonist||null,
        timestamp:Number(GameTime?.getTimestampMs?.()||0)
      };
    """)

try:
    driver.get(URL)
    wait=WebDriverWait(driver,30)
    wait.until(lambda d:d.execute_script("return document.readyState") == "complete")
    driver.execute_script("const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim(); if(b&&s!=='ACTIVE')b.click();")
    wait.until(lambda d:d.execute_script("""
      const r=window.GameRenderer?.snapshot?.();
      return Boolean(
        r?.ready &&
        r?.engine==='PlayCanvas' &&
        window.RuntimeTextureQuality &&
        window.AppUI?.refreshTerrain
      );
    """))
    refresh=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      Promise.resolve(window.AppUI?.refreshTerrain?.())
        .then(value=>done({ok:true,value:value||null}))
        .catch(error=>done({ok:false,error:String(error)}));
    """)
    if not refresh or refresh.get("ok") is not True:
        raise RuntimeError(f"Initial PlayCanvas terrain preparation failed: {refresh}")
    wait.until(lambda d:d.execute_script("""
      const r=window.GameRenderer?.snapshot?.();
      return Boolean(r?.worldAssetPreparation?.ready && Number(r?.worldAssetCache?.pending||0)===0);
    """))

    default_state=driver.execute_script("return RuntimeTextureQuality.snapshot()")
    if default_state.get("defaultProfile")!="standard" or default_state.get("qualityProfile")!="standard":
        raise RuntimeError(f"Standard is not the clean-session default: {default_state}")

    proof=driver.execute_script("return GameRenderer.setAssetPreparationProofState(true)?.assetPreparationProof||null")
    if not proof or proof.get("active") is not True:
        raise RuntimeError(f"PlayCanvas representative asset proof unavailable: {proof}")

    baseline=identity()
    rows=[]
    expected_limits={"low":24,"standard":48,"high":72,"ultra":96}
    expected_material_max={"low":512,"standard":1024,"high":2048,"ultra":4096}

    for profile in ("low","standard","high","ultra"):
        driver.execute_script("return RuntimeTextureQuality.setProfile(arguments[0])",profile)
        refresh=driver.execute_async_script("""
          const done=arguments[arguments.length-1];
          Promise.resolve(window.AppUI?.refreshTerrain?.())
            .then(value=>done({ok:true,value:value||null}))
            .catch(error=>done({ok:false,error:String(error?.stack||error)}));
        """)
        if not refresh or refresh.get("ok") is not True:
            raise RuntimeError(f"PlayCanvas terrain refresh failed for {profile}: {refresh}")
        wait.until(lambda d,p=profile:d.execute_script("""
          const q=RuntimeTextureQuality?.snapshot?.()||{};
          const r=GameRenderer?.snapshot?.()||{};
          return Boolean(
            q.qualityProfile===arguments[0] &&
            r?.materialTextureQuality?.profile===arguments[0] &&
            r?.worldAssetPreparation?.ready &&
            Number(r?.worldAssetCache?.pending||0)===0
          );
        """,p))
        time.sleep(0.35)
        row=driver.execute_script("""
          const r=GameRenderer?.snapshot?.()||{};
          const a=TextureAssets?.stats?.()||{};
          const q=RuntimeTextureQuality?.snapshot?.()||{};
          const mq=r.materialTextureQuality||{};
          const world=r.worldAssetCache||{};
          return {
            profile:q.qualityProfile,
            terrainResolution:q.runtimeResolution,
            maxMaterialTextureResolution:q.maxMaterialTextureResolution,
            budgetMB:q.textureBudgetMB,
            worldAssetCacheLimit:q.worldAssetCacheLimit,
            activeTextureCount:Number(a.totalResolutionCacheEntryCount||a.loadedKeyCount||0)+Number(mq.textureCount||0),
            estimatedLoadedTextureMB:q.estimatedLoadedTextureMB,
            budgetUtilization:q.budgetUtilization,
            effectiveLegacyCacheLimit:q.effectiveCacheLimit,
            playCanvasWorldCacheLimit:Number(world.cacheLimit||0),
            materialCount:Number(mq.materialCount||r.scene?.materialCount||0),
            materialVariants:Number(mq.materialVariantCount||r.scene?.materialVariantCount||0),
            anisotropy:Number(mq.anisotropy||0),
            auxiliaryMaps:Boolean(mq.auxiliaryMaps),
            detailMaps:Boolean(mq.detailMaps),
            filtering:mq.filtering||null,
            compressionPolicy:mq.compressionPolicy||null,
            characterSpritePolicy:mq.characterSpritePolicy||null,
            perFrameResizeOrTranscode:mq.perFrameResizeOrTranscode,
            drawCalls:Number(r.performance?.drawCalls||0),
            frameMs:Number(r.performance?.frameMs||0),
            seed:SeedSystem?.getCampaign?.()?.seed||null,
            protagonist:r.simulationSnapshot?.protagonist||window.RendererContract?.simulationSnapshot?.()?.protagonist||null,
            cacheSignature:q.cacheSignature,
            terrainSignature:r.terrainChunks?.signature||null,
            worldPending:Number(world.pending||0),
            worldCached:Number(world.cached||0)
          };
        """)
        if row["playCanvasWorldCacheLimit"] != expected_limits[profile]:
            raise RuntimeError(f"PlayCanvas world cache limit mismatch for {profile}: {row}")
        if row["maxMaterialTextureResolution"] != expected_material_max[profile]:
            raise RuntimeError(f"PlayCanvas material max resolution mismatch for {profile}: {row}")
        if row["materialCount"] < 1 or row["materialVariants"] < 1:
            raise RuntimeError(f"PlayCanvas material metrics missing for {profile}: {row}")
        if row["perFrameResizeOrTranscode"] is not False:
            raise RuntimeError(f"Per-frame texture resize/transcode policy failed for {profile}: {row}")
        if profile not in str(row["cacheSignature"]) or profile not in str(row["terrainSignature"]):
            raise RuntimeError(f"Quality profile missing from presentation signatures for {profile}: {row}")
        driver.save_screenshot(str(OUT/f"quality-{profile}.png"))
        rows.append(row)

    after_cycle=identity()
    if [row["profile"] for row in rows] != ["low","standard","high","ultra"]:
        raise RuntimeError(f"Profile cycle failed: {rows}")
    if any(row["seed"]!=baseline["seed"] or row["protagonist"]!=baseline["protagonist"] for row in rows):
        raise RuntimeError(f"Presentation profile changed Simulation identity: baseline={baseline} rows={rows}")
    if after_cycle["seed"]!=baseline["seed"] or after_cycle["protagonist"]!=baseline["protagonist"]:
        raise RuntimeError(f"Simulation identity changed during profile cycle: {baseline} -> {after_cycle}")

    driver.execute_script("RuntimeTextureQuality.setProfile('high')")
    wait.until(lambda d:d.execute_script("return RuntimeTextureQuality?.snapshot?.()?.qualityProfile==='high'"))
    driver.refresh()
    wait.until(lambda d:d.execute_script("return document.readyState") == "complete")
    wait.until(lambda d:d.execute_script("""
      const s=window.RendererContract?.simulationSnapshot?.()||{};
      return Boolean(window.RuntimeTextureQuality && window.GameRenderer?.snapshot?.()?.ready && s.campaignActive && s.protagonist);
    """))
    persisted=driver.execute_script("return RuntimeTextureQuality.snapshot()")
    after_reload=identity()
    if persisted.get("qualityProfile")!="high":
        raise RuntimeError(f"Texture quality profile did not persist across reload: {persisted}")
    if after_reload["seed"]!=baseline["seed"] or after_reload["protagonist"]!=baseline["protagonist"]:
        raise RuntimeError(f"Reload after profile persistence changed Simulation identity: {baseline} -> {after_reload}")

    report={
      "baseline":baseline,
      "afterCycle":after_cycle,
      "afterReload":after_reload,
      "simulationIdentityPreserved":True,
      "standardDefault":True,
      "profilePersistence":{"selected":"high","persisted":persisted.get("qualityProfile")=="high"},
      "profiles":rows,
      "notes":{
        "materialVariants":"Unique active PlayCanvas material feature combinations, not an invented compiled-shader count.",
        "characterSpriteQuality":"Character sprites stay on the separate native 2D preparation path."
      }
    }
    (OUT/"texture-quality-comparison.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
except Exception:
    try:
        diagnostic=driver.execute_script("""
          const r=window.GameRenderer?.snapshot?.()||{};
          return {
            ready:Boolean(r.ready),
            engine:r.engine||null,
            regionKey:r.regionKey||null,
            worldAssetPreparation:r.worldAssetPreparation||null,
            worldAssetCache:r.worldAssetCache||null,
            materialTextureQuality:r.materialTextureQuality||null,
            terrainPreload:r.terrainPreload||null,
            textureAssets:window.TextureAssets?.stats?.()||null,
            textureQuality:window.RuntimeTextureQuality?.snapshot?.()||null,
            campaignState:document.querySelector('#campaignState')?.textContent?.trim()||null,
            status:document.querySelector('#statusMessage')?.textContent?.trim()||null
          };
        """)
        (OUT/"texture-quality-failure.json").write_text(json.dumps(diagnostic,indent=2),encoding="utf-8")
        driver.save_screenshot(str(OUT/"texture-quality-failure.png"))
        print(json.dumps({"failureDiagnostic":diagnostic},indent=2),file=sys.stderr)
    except Exception as diagnostic_error:
        print(f"Could not collect failure diagnostic: {diagnostic_error}",file=sys.stderr)
    raise
finally:
    driver.quit()
