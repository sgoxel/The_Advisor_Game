import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {comparePanImages} from './pan-images.js';
import homeFixture from './fixtures/macro-home.json' with {type:'json'};

export function alderwickTests(backend) {
  test('starting village keeps properties and ground through a wide-screen pan and Street zoom',async({page})=>{
    test.setTimeout(600000);
    await page.setViewportSize({width:3840,height:2041});
    if(backend==='webgl2')await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(()=>window.advisorWorld?.state.ready);
    expect(await page.evaluate(()=>window.advisorRenderer.backend)).toBe(backend);
    await expect(page.locator('#toggle-region-panel')).toHaveAttribute('aria-expanded','false');
    await page.evaluate(()=>{
      const v=window.advisorWorld.geography.villages[0];
      window.advisorWorld.navigation.setFocus(v.canonicalPosition.lon,v.canonicalPosition.lat);
      window.advisorWorld.setHalfHeight(97);
    });
    const settled=()=>page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:180000});
    await settled();
    const out=`test-results/alderwick-${backend}`;
    fs.mkdirSync(out,{recursive:true});
    const records=[];
    const capture=async suffix=>{
      const state=await page.evaluate(()=>window.advisorWorld.state);
      const file=`alderwick-${suffix}.png`;
      await page.screenshot({path:`${out}/${file}`});
      records.push({file,view:state.view,performance:state.performance,visibleMeshes:state.visibleMeshes,visibleGeometryTriangles:state.visibleGeometryTriangles});
      fs.writeFileSync(`${out}/capture.json`,JSON.stringify(records,null,2));
      expect(state.error).toBe('');
    };
    // Verify actual properties at the relocated canonical home before the wide
    // drag changes which footprints intersect the viewport.
    // Snapshot is tied to the legal canonical inventory, independently checked
    // by world.test.ts and the retained CPU mesh audit; any omitted geometry fails.
    expect(await page.evaluate(()=>window.advisorWorld.geography.roadNetwork.version)).toBe(homeFixture.roadVersion);
    await expect.poll(()=>page.evaluate(()=>window.advisorWorld.state.visibleGeometryTriangles.structures),{timeout:10000}).toBe(homeFixture.expectedStructureTriangles);
    await capture('central-properties');
    await page.evaluate(()=>window.advisorWorld.setHalfHeight(160));
    await settled();
    // The owner requests an icon at this overview scale; Street must restore
    // actual submitted property triangles below (mesh groups only count tiles).
    expect(await page.evaluate(()=>window.advisorWorld.state.visibleGeometryTriangles.structures)).toBe(0);
    await expect(page.locator('.political-label.village .place-symbol').first()).toBeVisible();
    await capture('village');
    await page.mouse.move(1728,1020);
    await page.mouse.down();
    await page.mouse.move(2304,1122,{steps:12});
    await page.mouse.up();
    await page.waitForTimeout(250);
    await capture('pan-transient');
    await settled();
    await capture('pan-settled');
    await page.mouse.wheel(0,-900);
    await page.waitForTimeout(250);
    await capture('zoom-transient');
    await settled();
    await expect(page.locator('#detail-name')).toHaveText('Street');
    expect(await page.evaluate(()=>window.advisorWorld.state.visibleGeometryTriangles.structures)).toBeGreaterThan(0);
    await capture('street');
    await page.mouse.wheel(0,900);
    await page.waitForTimeout(250);
    await capture('return-transient');
    await settled();
    await capture('return-settled');
    expect(await page.evaluate(()=>window.advisorWorld.state.performance.withinBudget)).toBeTruthy();
    const metrics=[];
    for(const [transient,final] of [['pan-transient','pan-settled'],['zoom-transient','street'],['return-transient','return-settled']]){
      const before=records.find(r=>r.file.endsWith(`-${transient}.png`));
      const after=records.find(r=>r.file.endsWith(`-${final}.png`));
      expect(before.view).toEqual(after.view);
      metrics.push({fixture:transient,...comparePanImages(`${out}/${before.file}`,`${out}/${after.file}`)});
    }
    fs.writeFileSync(`${out}/pan-metrics.json`,JSON.stringify(metrics,null,2));
    expect(metrics.filter(m=>!m.passed)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
