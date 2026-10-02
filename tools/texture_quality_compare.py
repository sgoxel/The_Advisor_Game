#!/usr/bin/env python3
"""WP-S003-005-007 live PlayCanvas texture-quality rebuild evidence."""
import json, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

URL=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/"
OUT=Path("tools/screenshots")
OUT.mkdir(parents=True,exist_ok=True)

opts=Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1280,800")
driver=webdriver.Chrome(options=opts)

def identity():
    return driver.execute_script("""
      const s=window.RendererContract?.simulationSnapshot?.()||{};
      const c=window.Camera?.getCenter?.()||null;
      return {
        seed:s.campaignSeed??SeedSystem?.getCampaign?.()?.seed??null,
        protagonist:s.protagonist||null,
        timestamp:Number(GameTime?.getTimestampMs?.()||0),
        camera:c?{x:String(c.x),y:String(c.y)}:null
      };
    """)

def refresh():
    result=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      Promise.resolve(window.AppUI?.refreshTerrain?.())
        .then(value=>done({ok:true,value:value||null}))
        .catch(error=>done({ok:false,error:String(error?.stack||error)}));
    """)
    if not result or result.get("ok") is not True:
        raise RuntimeError(f"PlayCanvas terrain refresh failed: {result}")
    return result

def set_zoom(value):
    driver.execute_script("Camera.setZoom(arguments[0])",value)
    refresh()
    wait.until(lambda d,z=value: abs(float(d.execute_script("return Camera.getZoom()"))-z)<0.001)

def profile_row(profile):
    return driver.execute_script("""
      const r=GameRenderer?.snapshot?.()||{};
      const q=RuntimeTextureQuality?.snapshot?.()||{};
      const mq=r.materialTextureQuality||{};
      const chunks=r.terrainChunks||{};
      const terrain=chunks.textureAtlas||{};
      const building=chunks.buildingSurfaceAtlas||{};
      const tree=chunks.treeSpriteAtlas||{};
      const gen=chunks.generator||{};
      const preload=r.terrainPreload||{};
      const selected=document.querySelector('#textureQualityProfile')?.value||null;
      const treeSigs=Array.isArray(gen.treeSpriteMaterialAtlasSignatures)?gen.treeSpriteMaterialAtlasSignatures:[];
      const treeSignature=String(tree.signature||"");
      return {
        profile:q.qualityProfile,
        selectedUiProfile:selected,
        effectiveRendererProfile:mq.profile||null,
        cacheSignature:q.cacheSignature,
        terrainPresentationSignature:chunks.presentationSignature||null,
        terrainRuntimeResolution:Number(terrain.runtimeResolution||0),
        terrainTextureGeneration:Number(terrain.textureGeneration||0),
        terrainTextureDestructions:Number(terrain.textureDestructions||0),
        terrainRetiredTextureCount:Number(terrain.retiredTextureCount||0),
        buildingRuntimeResolution:Number(building.runtimeResolution||0),
        buildingAtlasWidth:Number(building.atlasWidth||0),
        buildingAtlasHeight:Number(building.atlasHeight||0),
        buildingTextureGeneration:Number(building.textureGeneration||0),
        buildingTextureDestructions:Number(building.textureDestructions||0),
        buildingRetiredTextureCount:Number(building.retiredTextureCount||0),
        treeRuntimeWidth:Number(tree.runtimeWidth||0),
        treeRuntimeHeight:Number(tree.runtimeHeight||0),
        treeTextureGeneration:Number(tree.textureGeneration||0),
        treeTextureDestructions:Number(tree.textureDestructions||0),
        treeRetiredTextureCount:Number(tree.retiredTextureCount||0),
        buildingMaterialRebinds:Number(gen.buildingSurfaceMaterialRebinds||0),
        buildingMaterialRefreshes:Number(gen.buildingSurfaceMaterialRefreshes||0),
        buildingStaleBindingCount:Number(gen.buildingSurfaceStaleBindingCount||0),
        treeMaterialRebinds:Number(gen.treeSpriteMaterialRebinds||0),
        treeMaterialRefreshes:Number(gen.treeSpriteMaterialRefreshes||0),
        treeMaterialAtlasSignatures:treeSigs,
        treeMaterialStaleBindingCount:treeSignature?treeSigs.filter(x=>String(x)!==treeSignature).length:0,
        activeChunks:Number(preload.Active||chunks.visibleChunkCount||0),
        preparedChunks:Number(preload.Prepared||chunks.preparedChunkCount||0),
        cachedChunks:Number(preload.Cached||chunks.cachedChunkCount||0),
        visibleFrameTerrainRebuildCount:Number(chunks.visibleFrameTerrainRebuildCount||0),
        terrainFrameDecodeCount:Number(terrain.frameDecodeCount||0),
        terrainFrameRasterizeCount:Number(terrain.frameRasterizeCount||0),
        terrainFrameAtlasBuildCount:Number(terrain.frameAtlasBuildCount||0),
        buildingFrameDecodeCount:Number(building.frameDecodeCount||0),
        buildingFrameRasterizeCount:Number(building.frameRasterizeCount||0),
        treeFrameDecodeCount:Number(tree.frameDecodeCount||0),
        treeFrameRasterizeCount:Number(tree.frameRasterizeCount||0),
        worldPending:Number(r.worldAssetCache?.pending||0),
        materialCount:Number(mq.materialCount||0),
        materialTextureCount:Number(mq.textureCount||0),
        maxMaterialTextureResolution:Number(mq.maxMaterialTextureResolution||0),
        simulationAuthorityPreserved:r.simulationAuthorityPreserved!==false && mq.simulationAuthorityPreserved!==false,
        cameraZoom:Number(Camera.getZoom())
      };
    """)

try:
    driver.get(URL)
    wait=WebDriverWait(driver,30)
    wait.until(lambda d:d.execute_script("return document.readyState") == "complete")
    wait.until(lambda d:d.execute_script("""
      const r=window.GameRenderer?.snapshot?.();
      return Boolean(r?.ready && r?.engine==='PlayCanvas' && window.RuntimeTextureQuality && window.RuntimeRenderQuality && window.AppUI?.refreshTerrain);
    """))

    driver.execute_script("""
      const b=document.querySelector('#newCampaignButton');
      if(b&&!window.SeedSystem?.getCampaign?.())b.click();
    """)
    wait.until(lambda d:d.execute_script("""
      const s=window.RendererContract?.simulationSnapshot?.()||{};
      return Boolean(s.campaignActive && s.protagonist);
    """))
    refresh()
    wait.until(lambda d:d.execute_script("""
      const r=window.GameRenderer?.snapshot?.()||{};
      return Boolean(r?.worldAssetPreparation?.ready && Number(r?.worldAssetCache?.pending||0)===0);
    """))

    # Stabilize graphics quality without coupling it to texture quality.
    driver.execute_script("RuntimeRenderQuality.setMode('standard')")
    default_texture=driver.execute_script("return RuntimeTextureQuality.snapshot()")
    render_state=driver.execute_script("return RuntimeRenderQuality.snapshot()")
    if default_texture.get("defaultProfile")!="standard" or default_texture.get("qualityProfile")!="standard":
        raise RuntimeError(f"Standard is not the clean-session texture default: {default_texture}")
    if render_state.get("textureQualityCoupled") is not False:
        raise RuntimeError(f"Graphics quality still reports texture coupling: {render_state}")

    baseline=identity()
    expected={
      "standard":{"terrain":32,"building":128,"tree":256},
      "high":{"terrain":64,"building":256,"tree":320},
      "ultra":{"terrain":128,"building":512,"tree":384}
    }
    rows=[]

    for profile in ("standard","high","ultra"):
        driver.execute_script("RuntimeTextureQuality.setProfile(arguments[0])",profile)
        refresh()
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
        set_zoom(1.0)
        time.sleep(0.25)
        row=profile_row(profile)
        want=expected[profile]
        if row["selectedUiProfile"]!=profile:
            raise RuntimeError(f"Settings control did not reflect {profile}: {row}")
        if row["effectiveRendererProfile"]!=profile:
            raise RuntimeError(f"Renderer profile did not follow selected texture profile {profile}: {row}")
        if row["terrainRuntimeResolution"]!=want["terrain"]:
            raise RuntimeError(f"Terrain resolution mismatch for {profile}: {row}")
        if row["buildingRuntimeResolution"]!=want["building"]:
            raise RuntimeError(f"Building atlas resolution mismatch for {profile}: {row}")
        if row["treeRuntimeWidth"]!=want["tree"]:
            raise RuntimeError(f"Tree atlas width mismatch for {profile}: {row}")
        if row["buildingStaleBindingCount"]!=0 or row["treeMaterialStaleBindingCount"]!=0:
            raise RuntimeError(f"Stale material binding after {profile} transition: {row}")
        if row["terrainRetiredTextureCount"]!=0 or row["buildingRetiredTextureCount"]!=0 or row["treeRetiredTextureCount"]!=0:
            raise RuntimeError(f"Retired texture leak after {profile} transition: {row}")
        if any(row[k] != 0 for k in (
            "visibleFrameTerrainRebuildCount","terrainFrameDecodeCount","terrainFrameRasterizeCount",
            "terrainFrameAtlasBuildCount","buildingFrameDecodeCount","buildingFrameRasterizeCount",
            "treeFrameDecodeCount","treeFrameRasterizeCount"
        )):
            raise RuntimeError(f"Visible-frame texture/terrain rebuild work detected for {profile}: {row}")
        if row["simulationAuthorityPreserved"] is not True:
            raise RuntimeError(f"Simulation authority flag failed for {profile}: {row}")
        driver.save_screenshot(str(OUT/f"quality-{profile}-1x.png"))
        set_zoom(2.0)
        time.sleep(0.2)
        driver.save_screenshot(str(OUT/f"quality-{profile}-2x.png"))
        rows.append(row)

    # All quality tiers must remain at the same authoritative camera location/character state.
    after_cycle=identity()
    if any(identity_key not in baseline for identity_key in ("seed","protagonist","camera")):
        raise RuntimeError(f"Baseline identity incomplete: {baseline}")
    if after_cycle["seed"]!=baseline["seed"] or after_cycle["protagonist"]!=baseline["protagonist"] or after_cycle["camera"]!=baseline["camera"]:
        raise RuntimeError(f"Texture quality changed authoritative identity/camera: {baseline} -> {after_cycle}")

    standard,high,ultra=rows
    if not (standard["terrainRuntimeResolution"] < high["terrainRuntimeResolution"] < ultra["terrainRuntimeResolution"]):
        raise RuntimeError(f"Terrain quality resolutions are not increasing: {rows}")
    if not (standard["buildingRuntimeResolution"] < high["buildingRuntimeResolution"] < ultra["buildingRuntimeResolution"]):
        raise RuntimeError(f"Building atlas resolutions are not increasing: {rows}")
    if not (standard["treeRuntimeWidth"] < high["treeRuntimeWidth"] < ultra["treeRuntimeWidth"]):
        raise RuntimeError(f"Tree atlas resolutions are not increasing: {rows}")
    if not (standard["terrainTextureGeneration"] < high["terrainTextureGeneration"] < ultra["terrainTextureGeneration"]):
        raise RuntimeError(f"Terrain texture generation did not advance: {rows}")
    if not (standard["buildingTextureGeneration"] < high["buildingTextureGeneration"] < ultra["buildingTextureGeneration"]):
        raise RuntimeError(f"Building texture generation did not advance: {rows}")
    if not (standard["treeTextureGeneration"] < high["treeTextureGeneration"] < ultra["treeTextureGeneration"]):
        raise RuntimeError(f"Tree texture generation did not advance: {rows}")

    # Explicit Ultra selection must survive later graphics-quality changes.
    driver.execute_script("RuntimeTextureQuality.setProfile('ultra')")
    refresh()
    driver.execute_script("RuntimeRenderQuality.setMode('low')")
    time.sleep(0.15)
    independent_low=driver.execute_script("return {texture:RuntimeTextureQuality.snapshot(),render:RuntimeRenderQuality.snapshot()}")
    if independent_low["texture"].get("qualityProfile")!="ultra" or independent_low["render"].get("textureProfile")!="ultra":
        raise RuntimeError(f"Low graphics mode overwrote explicit Ultra texture selection: {independent_low}")
    driver.execute_script("RuntimeRenderQuality.setMode('high')")
    time.sleep(0.15)
    independent_high=driver.execute_script("return {texture:RuntimeTextureQuality.snapshot(),render:RuntimeRenderQuality.snapshot()}")
    if independent_high["texture"].get("qualityProfile")!="ultra" or independent_high["render"].get("textureProfile")!="ultra":
        raise RuntimeError(f"High graphics mode overwrote explicit Ultra texture selection: {independent_high}")

    # Mobile-sized Ultra evidence.
    driver.set_window_size(390,844)
    time.sleep(0.35)
    set_zoom(1.0)
    driver.save_screenshot(str(OUT/"quality-ultra-phone.png"))
    phone_row=profile_row("ultra")

    # Return to desktop and downshift live without reloading.
    driver.set_window_size(1280,800)
    time.sleep(0.25)
    driver.execute_script("RuntimeTextureQuality.setProfile('standard')")
    refresh()
    set_zoom(1.0)
    downshift=profile_row("standard")
    if downshift["terrainRuntimeResolution"]!=32 or downshift["buildingRuntimeResolution"]!=128 or downshift["treeRuntimeWidth"]!=256:
        raise RuntimeError(f"Live downshift did not restore Standard prepared resources: {downshift}")
    if downshift["buildingStaleBindingCount"]!=0 or downshift["treeMaterialStaleBindingCount"]!=0:
        raise RuntimeError(f"Stale binding after live downshift: {downshift}")

    # Persist Ultra while Graphics Quality is Low; reload must keep Ultra.
    driver.execute_script("RuntimeTextureQuality.setProfile('ultra'); RuntimeRenderQuality.setMode('low')")
    wait.until(lambda d:d.execute_script("return RuntimeTextureQuality.snapshot().qualityProfile==='ultra'"))
    driver.refresh()
    wait.until(lambda d:d.execute_script("return document.readyState") == "complete")
    wait.until(lambda d:d.execute_script("""
      const s=window.RendererContract?.simulationSnapshot?.()||{};
      const r=window.GameRenderer?.snapshot?.()||{};
      const q=window.RuntimeTextureQuality?.snapshot?.()||{};
      return Boolean(
        window.RuntimeRenderQuality &&
        r?.ready &&
        s.campaignActive && s.protagonist &&
        q.qualityProfile==='ultra' &&
        r?.materialTextureQuality?.profile==='ultra' &&
        r?.worldAssetPreparation?.ready &&
        Number(r?.worldAssetCache?.pending||0)===0 &&
        Number(r?.terrainChunks?.textureAtlas?.runtimeResolution||0)===128
      );
    """))
    persisted=driver.execute_script("return {texture:RuntimeTextureQuality.snapshot(),render:RuntimeRenderQuality.snapshot()}")
    after_reload=identity()
    if persisted["texture"].get("qualityProfile")!="ultra":
        raise RuntimeError(f"Ultra texture quality did not persist across reload: {persisted}")
    if persisted["render"].get("mode")!="low" or persisted["render"].get("textureProfile")!="ultra":
        raise RuntimeError(f"Graphics/texture independence did not persist across reload: {persisted}")
    if after_reload["seed"]!=baseline["seed"] or after_reload["protagonist"]!=baseline["protagonist"]:
        raise RuntimeError(f"Reload after texture persistence changed Simulation identity: {baseline} -> {after_reload}")

    report={
      "wp":"WP-S003-005-007",
      "baseline":baseline,
      "afterCycle":after_cycle,
      "afterReload":after_reload,
      "simulationIdentityPreserved":True,
      "standardDefault":True,
      "textureQualityIndependentFromGraphics":True,
      "profilePersistence":{"selected":"ultra","persisted":persisted["texture"].get("qualityProfile")=="ultra"},
      "profiles":rows,
      "phoneUltra":phone_row,
      "downshiftStandard":downshift,
      "graphicsIndependence":{"low":independent_low,"high":independent_high,"afterReload":persisted},
      "screenshots":[
        "quality-standard-1x.png","quality-standard-2x.png",
        "quality-high-1x.png","quality-high-2x.png",
        "quality-ultra-1x.png","quality-ultra-2x.png",
        "quality-ultra-phone.png"
      ],
      "notes":{
        "textureRebuild":"Shared terrain/building/tree resources rebuild only when the quality signature changes.",
        "characterSpriteQuality":"Character sprites stay on the separate native 2D preparation path.",
        "simulation":"Texture quality changes are presentation-only."
      }
    }
    (OUT/"texture-quality-comparison.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
except Exception:
    try:
        diagnostic=driver.execute_script("""
          const r=window.GameRenderer?.snapshot?.()||{};
          return {
            ready:Boolean(r.ready),engine:r.engine||null,regionKey:r.regionKey||null,
            worldAssetPreparation:r.worldAssetPreparation||null,
            worldAssetCache:r.worldAssetCache||null,
            materialTextureQuality:r.materialTextureQuality||null,
            terrainChunks:r.terrainChunks||null,
            textureAssets:window.TextureAssets?.stats?.()||null,
            textureQuality:window.RuntimeTextureQuality?.snapshot?.()||null,
            renderQuality:window.RuntimeRenderQuality?.snapshot?.()||null,
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
