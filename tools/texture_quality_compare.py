#!/usr/bin/env python3
"""Compare Low/Standard/High/Ultra presentation quality without changing Simulation truth."""
import json, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

URL=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/"
OUT=Path("tools/screenshots"); OUT.mkdir(parents=True,exist_ok=True)
opts=Options(); opts.add_argument("--headless=new"); opts.add_argument("--no-sandbox"); opts.add_argument("--disable-dev-shm-usage"); opts.add_argument("--window-size=1920,1080")
driver=webdriver.Chrome(options=opts)
try:
    driver.get(URL)
    WebDriverWait(driver,20).until(lambda d:d.execute_script("return document.readyState") == "complete")
    driver.execute_script("const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim(); if(b&&s!=='ACTIVE')b.click();")
    WebDriverWait(driver,20).until(lambda d:d.execute_script("return Boolean(window.GameRenderer?.snapshot?.()?.ready && window.TextureAssets?.stats?.()?.ready && window.RuntimeTextureQuality)") )
    baseline=driver.execute_script("return {seed:SeedSystem?.getCampaign?.()?.seed||null, protagonist:document.querySelector('#protagonistLocation')?.textContent?.trim()||null, timestamp:Number(GameTime?.getTimestampMs?.()||0)}")
    rows=[]
    for profile in ("low","standard","high","ultra"):
        state=driver.execute_script("return RuntimeTextureQuality.setProfile(arguments[0])",profile)
        time.sleep(1.0)
        row=driver.execute_script("""
          const r=GameRenderer?.snapshot?.()||{}, a=TextureAssets?.stats?.()||{}, q=RuntimeTextureQuality?.snapshot?.()||{};
          return {profile:q.qualityProfile,resolution:q.runtimeResolution,budgetMB:q.textureBudgetMB,activeTextureCount:Number(a.totalResolutionCacheEntryCount||a.loadedKeyCount||0),estimatedLoadedTextureMB:q.estimatedLoadedTextureMB,budgetUtilization:q.budgetUtilization,effectiveCacheLimit:q.effectiveCacheLimit,materialCount:r.scene?.materialCount??null,shaderVariants:r.performance?.shaderVariants??r.scene?.shaderVariants??null,drawCalls:r.performance?.drawCalls??null,frameMs:r.performance?.frameMs??null,seed:SeedSystem?.getCampaign?.()?.seed||null,protagonist:document.querySelector('#protagonistLocation')?.textContent?.trim()||null,cacheSignature:q.cacheSignature,preparedRegionKey:a.preparedRegionKey||null};
        """)
        driver.save_screenshot(str(OUT/f"quality-{profile}.png")); rows.append(row)
    after=driver.execute_script("return {seed:SeedSystem?.getCampaign?.()?.seed||null, protagonist:document.querySelector('#protagonistLocation')?.textContent?.trim()||null, timestamp:Number(GameTime?.getTimestampMs?.()||0)}")
    if [r['profile'] for r in rows] != ['low','standard','high','ultra']: raise RuntimeError(f"profile cycle failed: {rows}")
    if any(r['seed']!=baseline['seed'] or r['protagonist']!=baseline['protagonist'] for r in rows): raise RuntimeError(f"presentation profile changed Simulation identity: baseline={baseline} rows={rows}")
    if after['seed']!=baseline['seed'] or after['protagonist']!=baseline['protagonist']: raise RuntimeError(f"Simulation identity changed: {baseline} -> {after}")
    if [r['resolution'] for r in rows] != [16,32,64,128]: raise RuntimeError(f"unexpected profile resolutions: {rows}")
    report={'baseline':baseline,'after':after,'simulationIdentityPreserved':True,'profiles':rows,'notes':{'materialCount':'null when renderer does not expose this metric','shaderVariants':'null when renderer does not expose this metric'}}
    (OUT/'texture-quality-comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
finally:
    driver.quit()
