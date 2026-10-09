import fs from 'node:fs';
import fixtures from './zoom-fixtures.json' with { type: 'json' };
import { selectTiles } from '../src/world.ts';

export function zoomTests(test, expect, webgl2) {
  test('same-focus mobile Country palette, every local LOD, handoff and seam/poles', async ({ page }) => {
    test.setTimeout(1800000);
    await page.setViewportSize({width:390,height:844});
    if(webgl2) await page.addInitScript(() => Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('/');
    await page.waitForFunction(()=>window.advisorWorld?.state.settled);
    expect(await page.evaluate(()=>window.advisorRenderer.backend)).toBe(webgl2?'webgl2':'webgpu');
    await page.locator('#overview').click();
    await page.waitForFunction(()=>window.advisorWorld.state.globe.complete,null,{timeout:240000});
    // Stable ground gate excludes genuinely new trees/buildings and DOM labels.
    await page.locator('#structures').uncheck();
    await page.locator('#nature').uncheck();
    await page.addStyleTag({content: '.place-label, #place-labels, #route-overlay { visibility:hidden !important; }'});
    const backend=webgl2?'webgl2':'webgpu', out=`test-results/zoom-${backend}`;
    fs.mkdirSync(out,{recursive:true});
    const records=[];
    const capture=async(name,height)=>{
      await page.evaluate(h=>window.advisorWorld.setHalfHeight(h),height);
      await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:180000});
      const state=await page.evaluate(()=>{
        const w=window.advisorWorld,s=w.state,f=s.navigation.focus;
        return {focus:f, sample:w.surface.sample(f.lon,f.lat), surface:s.surface, levels:s.levels, footprint:s.canonicalFootprintM, handoff:s.handoff, performance:s.performance};
      });
      expect(state.performance.withinBudget).toBeTruthy();
      expect(state.performance.canonicalKeysUnique).toBeTruthy();
      const file=`${out}/${name}.png`;
      await page.screenshot({path:file});
      return {file,height,...state};
    };
    for(const [name,fixture] of Object.entries(fixtures)) {
      await page.evaluate(f=>window.advisorWorld.navigation.setFocus(f.lon,f.lat),fixture);
      const identity=await page.evaluate(()=>{const w=window.advisorWorld,f=w.state.navigation.focus;return w.surface.sample(f.lon,f.lat);});
      expect(identity.materialId).toBe(fixture.materialId);
      // Every possible local mesh-size boundary (2..4096 source units), plus
      // the named Country regression, material filter endpoints and both handoff endpoints.
      const heights=[70,230,900,4172.151340188181];
      for(let size=2;size<=4096;size*=2) heights.push(size*844/(2*190));
      const anchors=await page.evaluate(()=>window.advisorWorld.handoff);
      // Capacity and latitude can adjust the selector's effective threshold.
      // Locate actual focus-tile replacements as well as nominal mesh boundaries.
      const view=await page.evaluate(()=>window.advisorWorld.state.view);
      const sizeAt=h=>{
        const tiles=selectTiles({...view,halfHeight:h},190,44);
        const tile=tiles.find(t=>view.x>=t.minX&&view.x<t.minX+t.size&&view.z>=t.minZ&&view.z<t.minZ+t.size);
        if(!tile) throw Error('Focus coverage absent in threshold fixture');
        return tile.size;
      };
      let priorHeight=2, priorSize=sizeAt(2);
      for(let h=2.06;h<anchors.localHalfHeight*1.03;h*=1.03){
        const size=sizeAt(h);
        if(size!==priorSize){
          let low=priorHeight,high=h;
          for(let i=0;i<16;i++){const middle=(low+high)/2;if(sizeAt(middle)===priorSize)low=middle;else high=middle;}
          heights.push((low+high)/2);
        }
        priorHeight=h; priorSize=size;
      }
      heights.push(anchors.localHalfHeight,anchors.globeHalfHeight);
      for(const [index,height] of [...new Set(heights)].sort((a,b)=>a-b).entries()) {
        const before=await capture(`${name}-${index}-before`,height*0.999);
        const after=await capture(`${name}-${index}-after`,height*1.001);
        expect(after.focus).toEqual(before.focus);
        expect(after.sample).toEqual(identity);
        expect(before.sample).toEqual(identity);
        for(const state of [before,after]){
          expect(state.surface.vertexColorGamma).toBe(true);
          expect(state.surface.exposure).toBe(1);
          expect(state.surface.fog).toBe(false);
          expect(state.surface.tonemap).toBe(false);
        }
        records.push({fixture:name,before,after});
        fs.writeFileSync(`${out}/pairs.json`,JSON.stringify(records,null,2));
      }
    }
    for(const [name,lon,lat] of [['wrap-west',-Math.PI+0.00001,0.4],['wrap-east',Math.PI+0.00001,0.4],['north',0.4,Math.PI/2],['south',0.4,-Math.PI/2]]) {
      await page.evaluate(({lon,lat})=>window.advisorWorld.navigation.setFocus(lon,lat),{lon,lat});
      await capture(name,4172.151340188181);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.advisorWorld.navigation.setFocus(-69.7953*Math.PI/180,-10.3192*Math.PI/180));
    for(const [name,h] of [['country-before',4168],['country-after',4176],['handoff',4700],['globe',11000]]) await capture(`desktop-${name}`,h);
    expect(errors).toEqual([]);
  });
}
