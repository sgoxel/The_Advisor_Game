import {test,expect} from '@playwright/test';
import {expandInformation} from './information-panel.js';
export function macroPopulationTests(backend){
 for(const [profile,width,height] of [['desktop',1440,900],['phone',390,844]])test(`macro registry, canonical overview markers and bounded country travel (${profile})`,async({page})=>{
  test.setTimeout(600000);await page.setViewportSize({width,height});
  if(backend==='webgl2')await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const started=Date.now();await page.goto('/');
  await page.waitForFunction(()=>window.advisorWorld?.state.settled,null,{timeout:240000});
  expect(await page.evaluate(()=>window.advisorRenderer.backend)).toBe(backend);console.log('macro cold navigation to settled',backend,profile,Date.now()-started,'ms (native desktop host, emulated viewport)');
  const home=await page.evaluate(()=>{const w=window.advisorWorld,v=w.geography.villages[0];return {dx:w.state.view.x-v.x,dz:w.state.view.z-v.z};});
  expect(Math.abs(home.dx)).toBeLessThan(.01);expect(Math.abs(home.dz)).toBeLessThan(.01);
  const registry=await page.evaluate(()=>{const g=window.advisorWorld.geography;return {countries:g.countries.length,cities:g.cities.length,villages:g.villages.length,counts:g.population.countries.map(c=>c.cities)};});
  expect(registry.countries).toBeGreaterThanOrEqual(30);expect(registry.cities).toBeGreaterThan(108);expect(registry.villages).toBeGreaterThan(324);expect(new Set(registry.counts).size).toBeGreaterThan(1);
  const graph=await page.evaluate(()=>{const w=window.advisorWorld,g=w.geography,j=g.roadJunctions[0],edges=g.roads.filter(r=>r.from===j.id||r.to===j.id);return {telemetry:g.roadNetwork,junction:j,degree:edges.length,edgeIds:edges.map(r=>r.networkId),trunkUses:g.roadConnections.filter(c=>c.legs.some(l=>l.edgeId===edges.find(r=>r.networkKind==='trunk').networkId)).length,surfaces:edges.map(r=>{const p=r.centerline,index=r.from===j.id?0:p.length-1,next=index===0?p[1]:p[index-1],dx=next.x-p[index].x,dz=next.z-p[index].z,length=Math.hypot(dx,dz);return w.surface.finalAtSource(p[index].x+dx/length*8,p[index].z+dz/length*8);})};});
  expect(graph.telemetry.fallbacks).toBe(0);expect(graph.telemetry.bentEdges).toBeGreaterThan(0);expect(graph.telemetry.maxStates).toBeLessThanOrEqual(49);expect(graph.degree).toBe(3);expect(graph.trunkUses).toBe(2);
  expect(graph.telemetry.minimumForkAngleDegrees).toBeGreaterThanOrEqual(32);expect(graph.telemetry.minimumJunctionSeparationM).toBeGreaterThanOrEqual(300);expect(graph.telemetry.maximumForkAttempts).toBeLessThanOrEqual(12);
  for(const surface of graph.surfaces){expect(surface.material).toBe('Road');expect(surface.walkable).toBeTruthy();}
  await page.evaluate(j=>window.advisorWorld.navigation.setFocus(j.canonicalPosition.lon,j.canonicalPosition.lat),graph.junction);
  await page.locator('#map-scale').selectOption('100');await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:240000});
  await expect.poll(()=>page.evaluate(ids=>ids.map(id=>{const n=[...document.querySelectorAll('#cartographic-roads path')].find(n=>n.dataset.roadId===id);if(!n)return Infinity;const a=n.getPointAtLength(0),b=n.getPointAtLength(n.getTotalLength());return Math.min(Math.hypot(a.x-innerWidth/2,a.y-innerHeight/2),Math.hypot(b.x-innerWidth/2,b.y-innerHeight/2));}),graph.edgeIds).then(d=>Math.max(...d)),{timeout:10000}).toBeLessThan(3);
  await page.screenshot({path:`test-results/macro-y-${backend}-${profile}.png`});
  await expandInformation(page);await page.locator('#overview').click();
  await page.getByRole('button',{name:'Minimize map information',exact:true}).click();
  for(const continent of [0,1,2]){
   await page.evaluate(index=>{const w=window.advisorWorld,c=w.geography.continents[index];w.navigation.setFocus(c.canonicalPosition.lon,c.canonicalPosition.lat);},continent);
   await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:240000});
   await expect(page.locator('#settlement-overview circle').first()).toBeVisible();
   const readPositions=()=>page.evaluate(()=>{const w=window.advisorWorld;return [...document.querySelectorAll('#settlement-overview circle')].map(n=>{
    const c=w.geography.cities.find(c=>c.name===n.querySelector('title').textContent),p=w.navigation.surfaceAtScreen(+n.getAttribute('cx'),+n.getAttribute('cy'));
    return p?Math.hypot(Math.atan2(Math.sin(p.lon-c.canonicalPosition.lon),Math.cos(p.lon-c.canonicalPosition.lon))*Math.cos(p.lat),p.lat-c.canonicalPosition.lat):Infinity;
   });});
   await expect.poll(async()=>{const values=await readPositions();return values.length>10?Math.max(...values):Infinity;},{timeout:10000}).toBeLessThan(.01);
   const result=await readPositions();
   await page.screenshot({path:`test-results/macro-continent-${continent}-${backend}-${profile}.png`});
   expect(result.length).toBeGreaterThan(10);expect(result.length).toBeLessThanOrEqual(profile==='phone'?60:160);
   expect(Math.max(...result)).toBeLessThan(.01);
   const s=await page.evaluate(()=>window.advisorWorld.state);expect(s.performance.withinBudget).toBeTruthy();expect(s.simulation.materializedResidents).toBeLessThanOrEqual(96);expect(s.visibleResidents).toBe(0);expect(s.error).toBe('');
  }
  await page.locator('#map-scale').selectOption('1000');await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:240000});
  await expect(page.locator('#settlement-overview')).toBeHidden();
  await page.screenshot({path:`test-results/macro-country-${backend}-${profile}.png`});
  await expandInformation(page);await page.locator('#home').click();await page.waitForFunction(()=>window.advisorWorld.state.settled,null,{timeout:240000});
  const returned=await page.evaluate(()=>{const w=window.advisorWorld,v=w.geography.villages[0];return Math.hypot(w.state.view.x-v.x,w.state.view.z-v.z);});expect(returned).toBeLessThan(.01);expect(errors).toEqual([]);
 });
}
