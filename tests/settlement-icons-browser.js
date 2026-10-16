import {test,expect} from '@playwright/test';
export function settlementIconTests(backend) {
  for (const [profile,width,height] of [['desktop',1440,1000],['phone',390,844]]) {
    test(`settlement icons replace details at 1/50 and restore close-up buildings (${profile})`,async({page})=>{
      test.setTimeout(600000);
      await page.setViewportSize({width,height});
      if(backend==='webgl2') await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/');
      await page.waitForFunction(()=>window.advisorWorld?.state.ready);
      expect(await page.evaluate(()=>window.advisorRenderer.backend)).toBe(backend);
      await page.evaluate(()=>{ const w=window.advisorWorld,v=w.geography.villages[0]; w.navigation.setFocus(v.canonicalPosition.lon,v.canonicalPosition.lat); });
      const focus=await page.evaluate(()=>window.advisorWorld.state.navigation.focus);
      const setScale=async scale=>{
        await page.locator('#map-scale').selectOption(String(scale));
        await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:240000});
      };
      await setScale(20);
      const nearTriangles=await page.evaluate(()=>window.advisorWorld.state.visibleGeometryTriangles.structures);
      expect(nearTriangles).toBeGreaterThan(0);
      for (const scale of [20,50,100,250,1000,20]) {
        await setScale(scale);
        const s=await page.evaluate(()=>window.advisorWorld.state);
        expect(s.scaleLabel).toBe(`1/${scale}`);
        expect(s.navigation.focus).toEqual(focus);
        expect(s.roadPresentation).toBe(scale<=100?"visible":"hidden");
        expect(s.roadRepresentation).toBe(scale<50?'ground':scale<=100?'cartographic':'hidden');
        if(scale>=50&&scale<=100)await expect(page.locator('#cartographic-roads path').first()).toBeVisible();else await expect(page.locator('#cartographic-roads')).toBeHidden();
        expect(s.settlementPresentation).toBe(scale>=50?'icons':'buildings');
        if(scale>=50){
          expect(s.visibleGeometryTriangles.structures).toBe(0);
          expect(s.visibleGeometryTriangles.detail).toBe(0);
          expect(s.visibleResidents).toBe(0);
          await expect(page.locator('.political-label.village .place-symbol').first()).toBeVisible();
          const layout=await page.locator('.political-label.village').first().evaluate(node=>{
            const icon=node.querySelector('.place-symbol').getBoundingClientRect(),name=node.querySelector('.place-name').getBoundingClientRect();
            return {above:icon.bottom<=name.top,widthRatio:icon.width/name.width};
          });
          expect(layout.above).toBeTruthy();
          expect(layout.widthRatio).toBeGreaterThan(.9);
          expect(layout.widthRatio).toBeLessThan(1.1);
        }else{
          expect(s.visibleGeometryTriangles.structures).toBe(nearTriangles);
          await expect(page.locator('.political-label.village .place-symbol').first()).toBeHidden();
        }
        expect(s.performance.withinBudget).toBeTruthy();
        await expect(page.locator('#toggle-region-panel')).toHaveAttribute('aria-expanded','false');
      }
      // A newly uploaded distant city's geometry follows the same gate.
      await page.evaluate(()=>{const w=window.advisorWorld,c=w.geography.cities[0];w.navigation.setFocus(c.canonicalPosition.lon,c.canonicalPosition.lat);});
      await setScale(50);
      await expect(page.locator('.political-label.city .place-symbol').first()).toBeVisible();
      expect(await page.evaluate(()=>window.advisorWorld.state.visibleGeometryTriangles.structures)).toBe(0);
      expect(errors).toEqual([]);
    });
  }
}
