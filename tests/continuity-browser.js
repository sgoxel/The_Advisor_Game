import { test, expect } from "@playwright/test";
import fs from "node:fs";
export function continuityTests(backend) {
  for (const viewport of [{name:"desktop",width:1440,height:900},{name:"tablet",width:1024,height:768},{name:"phone",width:390,height:844}]) {
    test(`${backend} invisible-world continuity ${viewport.name}`,async({page})=>{
      test.setTimeout(600000);
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.setViewportSize(viewport);
      if(backend==="webgl2")await page.addInitScript(()=>Object.defineProperty(navigator,"gpu",{value:undefined,configurable:true}));
      await page.goto("/");
      await page.waitForFunction(()=>window.advisorWorld?.state.settled);
      await expect(page.getByRole("button",{name:"Show map information",exact:true})).toHaveAttribute("aria-expanded","false");
      await expect(page.locator("#home")).toBeHidden();
      const initialFocus=await page.evaluate(()=>window.advisorWorld.state.navigation.focus);
      await page.getByRole("button",{name:"Show map information",exact:true}).click();
      await expect(page.locator("#home")).toBeVisible();
      const panelBox=await page.locator("#region-panel").boundingBox(),barBox=await page.locator(".bottom-bar").boundingBox();
      expect(panelBox.y+panelBox.height).toBeLessThanOrEqual(barBox.y);
      await page.locator("#grid").scrollIntoViewIfNeeded();
      await expect(page.locator("#toggle-region-panel")).toBeInViewport();
      await page.getByRole("button",{name:"Minimize map information",exact:true}).click();
      expect(await page.evaluate(()=>window.advisorWorld.state.navigation.focus)).toEqual(initialFocus);
      expect(await page.evaluate(()=>window.advisorWorld.state.performance.backend)).toBe(backend);
      const remote = await page.evaluate(()=>{
        const w=window.advisorWorld, road=w.geography.roads[0], point={lon:(road.fromPosition.lon+road.toPosition.lon)/2,lat:(road.fromPosition.lat+road.toPosition.lat)/2},
          before=w.state.performance, start=performance.now(), region=w.continuity.inspect(point), query=w.continuity.terrainQuery(point,[point]), complete=query.advance(),
          villages=w.geography.villages, route=window.advisorRoutes.route(villages[3].id,villages[4].id), after=w.state.performance;
        return {before,after,point,port:region.ports[0],digest:JSON.stringify(region),queryStatus:complete.status,route,elapsedMs:performance.now()-start};
      });
      for(const key of ["pendingGeneration","readyUploads","activePatches","cachedPatches"])expect(remote.after[key]).toBe(remote.before[key]);
      expect(remote.queryStatus).toBe("complete");
      expect(remote.port.status).toBe("legal");
      expect(remote.route.fantasySeconds).toBeGreaterThanOrEqual(3600);
      const target=remote.port.position;
      const go=async(point,height=900)=>{await page.evaluate(({point,height})=>{window.advisorWorld.navigation.setFocus(point.lon,point.lat);window.advisorWorld.setHalfHeight(height);},{point,height});await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:120000});};
      const bounded=async()=>{
        const s=await page.evaluate(()=>({p:window.advisorWorld.state.performance,c:window.advisorWorld.continuity.telemetry()})),p=s.p;
        expect(p.withinBudget).toBeTruthy();expect(p.maxUploadsPerFrame).toBeLessThanOrEqual(p.budget?.maxUploadsPerFrame ?? 8);
        expect(p.generationReady).toBeLessThanOrEqual(p.budget.generationReady);
        expect(s.c.recursiveRequests).toBe(0);expect(s.c.cachedPorts).toBeLessThanOrEqual(256);
        return s;
      };
      await go(target);await bounded();
      await page.evaluate(()=>window.advisorWorld.continuity.setOverlay(true));await page.waitForTimeout(200);
      await page.screenshot({path:`test-results/wp49-${backend}-${viewport.name}-ports.png`});
      await page.getByRole("button",{name:"Minimize continuity inspection",exact:true}).click();
      await expect(page.locator("#continuity-overlay pre")).toBeHidden();
      await page.getByRole("button",{name:"Show continuity inspection",exact:true}).click();
      await expect(page.locator("#continuity-overlay pre")).toBeVisible();
      await page.evaluate(()=>window.advisorWorld.continuity.setOverlay(false));
      const churn=[];
      if(viewport.name==="desktop") {
        const start=Date.now();let i=0;
        while(Date.now()-start<60000){await page.evaluate(({lon,lat})=>window.advisorWorld.navigation.setFocus(lon,lat),{lon:target.lon+(i%2===0?.03:-.03),lat:target.lat+(i%3)*.01});await page.waitForTimeout(250);churn.push(await bounded());i++;}
        await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:120000});
      }
      // Separate finite background globe preparation from steady revisit residency.
      await page.waitForFunction(()=>window.advisorWorld.state.globe.complete,null,{timeout:240000});
      const cycles=[];
      for(let i=0;i<10;i++){
        await go({lon:target.lon+.04,lat:target.lat+.02});await bounded();
        await go(target);const s=await bounded();cycles.push(s.p.cpuResourceBytesEstimated);
        const rebuilt=await page.evaluate(point=>{window.advisorWorld.continuity.clearDetail();return JSON.stringify(window.advisorWorld.continuity.inspect(point));},remote.point);
        expect(rebuilt).toBe(remote.digest);
      }
      fs.mkdirSync("test-results",{recursive:true});
      fs.writeFileSync(`test-results/wp49-${backend}-${viewport.name}-cycles.json`,JSON.stringify({remote,churn,cycles,errors},null,2));
      const warm=cycles.slice(5);expect(Math.max(...warm)/Math.min(...warm)).toBeLessThanOrEqual(1.05);
      await go(target,230);await bounded();
      await page.screenshot({path:`test-results/wp49-${backend}-${viewport.name}-revisit.png`});
      fs.mkdirSync("test-results",{recursive:true});fs.writeFileSync(`test-results/wp49-${backend}-${viewport.name}.json`,JSON.stringify({remote,churn,cycles,errors},null,2));
      expect(errors).toEqual([]);
    });
  }
}
