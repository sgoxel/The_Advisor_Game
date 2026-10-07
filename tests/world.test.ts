import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cellAt,cellSeed,regionSeed,districtSeed,featuresFor,heightAt,selectTiles,tileAt,WORLD_SEED,WORLD_MIN,MAX_LEVEL} from '../src/world.ts';
import {buildTile} from '../src/geometry.ts';
import {continents,countries,cities,villages,roads} from '../src/geography.ts';
import {LazySimulation,summaryAt,residentAt} from '../src/simulation.ts';
import {FantasyClock,TIME_SCALE} from '../src/clock.ts';

test('reloading cells in reverse order preserves all canonical content',()=>{
  const coords=[[-203,-201],[-1,-1],[0,0],[199,199],[200,200],[819,1337]];
  const baseline=coords.map(([x,z])=>cellAt(x,z));
  for(let i=coords.length-1;i>=0;i--)assert.deepEqual(cellAt(...coords[i] as [number,number]),baseline[i]);
  assert.equal(new Set(baseline.map(c=>c.code)).size,coords.length);
  assert.equal(cellAt(-.1,-.1).x,-1);
  assert.match(cellAt(1,1).code,/L1\/0\/0\/L2\/0\/0\/L3\/0\/0\/L4\/0\/0\/L5\/0\/0$/);
});
test('all five seed levels compose correctly across negative boundaries',()=>{
  for(const cx of [-101,-100,-11,-10,-1,0,9,10,99,100])for(const cz of [-101,-1,0,100]){
    const c=cellSeed(cx,cz),p=c.parent,d=p.parent,r=d.parent;
    assert.ok(c.x>=0&&c.x<2&&c.z>=0&&c.z<2);
    assert.ok(p.x>=0&&p.x<5&&p.z>=0&&p.z<5);
    assert.ok(d.x>=0&&d.x<10&&d.z>=0&&d.z<10);
    assert.equal(r.x*100+d.x*10+p.x*2+c.x,cx);assert.equal(r.z*100+d.z*10+p.z*2+c.z,cz);
    assert.ok(c.code.startsWith(p.code));assert.ok(p.code.startsWith(d.code));assert.ok(d.code.startsWith(r.code));assert.ok(r.code.startsWith(r.parent.code));
    assert.equal(d.code,districtSeed(cx,cz).code);assert.equal(r.code,regionSeed(cx,cz).code);
  }
});
test('child detail cannot violate island or ocean parent constraints',()=>{
  let islandCount=0,beaches=0;
  for(let mz=0;mz<=20;mz++)for(let mx=140;mx<=170;mx++){
    const r=regionSeed(mx*100,mz*100);
    if(r.landform==='Ocean'){assert.equal(heightAt(mx*200+100,mz*200+100),-2.8);continue;}
    if(r.landform!=='Island')continue;islandCount++;
    for(let z=0;z<100;z+=3)for(let x=0;x<100;x+=3){
      const c=cellAt(mx*200+x*2+1,mz*200+z*2+1);
      assert.ok(c.elevation<=r.elevationLimit);assert.ok(['Ocean','Sandy beach','Island meadow'].includes(c.biome));
      if(Math.hypot(x*2+1-100,z*2+1-100)>r.radius+6)assert.equal(c.biome,'Ocean');
      if(c.biome==='Sandy beach')beaches++;
    }
  }
  assert.ok(islandCount>0);assert.ok(beaches>0);
});
test('render tiles cover the view without overlapping parent and child areas',()=>{
  for(const halfHeight of [28,97,500,3000]){
    const view={x:0,z:0,halfHeight,aspect:1.7,yaw:0,pixels:768};const tiles=selectTiles(view);
    assert.ok(tiles.length>0&&tiles.length<230);
    for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
      const a=tiles[i],b=tiles[j];
      assert.ok(a.minX+a.size<=b.minX||b.minX+b.size<=a.minX||a.minZ+a.size<=b.minZ||b.minZ+b.size<=a.minZ);
    }
    for(let z=-halfHeight;z<=halfHeight;z+=halfHeight/5)for(let x=-halfHeight*1.7;x<=halfHeight*1.7;x+=halfHeight/5){
      if(x>=WORLD_MIN&&x<-WORLD_MIN&&z>=WORLD_MIN&&z<-WORLD_MIN)assert.ok(tiles.some(t=>x>=t.minX&&x<t.minX+t.size&&z>=t.minZ&&z<t.minZ+t.size));
    }
  }
});
test('feature identity survives LOD changes and adjacent tile ownership is unique',()=>{
  const parent=tileAt(12,2048,2048),a=tileAt(13,4096,4096),b=tileAt(13,4097,4096),c=tileAt(13,4096,4097),d=tileAt(13,4097,4097);
  const coarse=featuresFor(parent);const fine=[a,b,c,d].flatMap(featuresFor);
  assert.equal(new Set(fine.map(f=>f.code)).size,fine.length);
  assert.deepEqual([...coarse].sort((a,b)=>a.code.localeCompare(b.code)),fine.sort((a,b)=>a.code.localeCompare(b.code)));
  const mesh=buildTile(a),again=buildTile(a);assert.deepEqual(mesh,again);
  assert.ok(mesh.terrain.positions.every(Number.isFinite));assert.ok(mesh.terrain.positions.length>0);
});
test('application source contains no random-number API or clock-driven world generation',()=>{
  for(const file of ['world.ts','geometry.ts','geography.ts','simulation.ts','tile-worker.ts','main.ts']){
    const source=readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/Math\.random\s*\(|getRandomValues\s*\(|randomUUID\s*\(/);
    if(file!=='main.ts')assert.doesNotMatch(source,/Date\.now\s*\(|new Date\s*\(/);
  }
  assert.equal(WORLD_SEED,'ADVISOR-0126-ALDERWICK');
});
test('three continents each have ten countries, three cities per country and three villages per city',()=>{
  assert.equal(continents.length,3);assert.equal(countries.length,30);assert.equal(cities.length,90);assert.equal(villages.length,270);
  for(const continent of continents)assert.equal(countries.filter(c=>c.continent===continent.id).length,10);
  for(const country of countries)assert.equal(cities.filter(c=>c.continent===country.continent&&c.country===country.id).length,3);
  for(const city of cities)assert.equal(villages.filter(v=>v.id.startsWith(city.id+'/')).length,3);
  for(const place of [...cities,...villages])assert.ok(heightAt(place.x,place.z)>.1,`${place.name} must be on land`);
  assert.equal(262144/2**MAX_LEVEL,2);
});
test('all village links take five minutes and are traversable including river bridges',()=>{
  for(const road of roads){
    assert.equal(road.length,420);assert.equal(road.walkSeconds,300);assert.equal(road.fantasyWalkSeconds,7200);
    for(let x=road.minX;x<road.maxX;x+=14)assert.ok(cellAt(x,road.z).walkable,`${road.code} blocked at ${x}`);
  }
});
test('fantasy epoch maps 2026 to 0126 and advances one day per real hour, including offline',()=>{
  const epoch=Date.parse('2026-10-07T08:48:29Z'),clock=new FantasyClock(epoch);
  assert.equal(clock.labelAt(epoch),'07.10.0126 · 11:48');
  assert.equal(clock.tickAt(epoch+3600000),86400);assert.equal(clock.labelAt(epoch+3600000),'08.10.0126 · 11:48');
  assert.equal(clock.tickAt(epoch+86400000),24*86400);
  assert.equal(new FantasyClock(epoch).tickAt(epoch+86400000),clock.tickAt(epoch+86400000));
  assert.equal(clock.tickAt(epoch-1000),0);assert.equal(TIME_SCALE,24);
});
test('lazy country simulation catches up identically regardless of interest or elapsed steps',()=>{
  const a=new LazySimulation(),b=new LazySimulation();a.setFocus(villages[0]);b.setFocus(villages[0]);
  for(let i=0;i<=10;i++)a.advance(i);b.advance(10);
  assert.deepEqual(a.residents,b.residents);assert.deepEqual(a.summaries.get(a.activeCountry),summaryWithLive(a.activeCountry,10));
  assert.equal(a.stats.residents,7920);assert.equal(a.stats.liveCountries,1);
  const far=countries.find(c=>c.continent===1)!;a.setInterest(far.code);a.advance(3600);
  assert.equal(a.summaries.get(far.code)!.grain,summaryAt(far.code,3600).grain);
  a.setFocus(villages.find(v=>v.continent===1)!);a.advance(3601);assert.equal(a.stats.liveCountries,1);assert.equal(a.stats.residents,7920);
  const home=a.residents.get(a.activeCountry)![0],place=[...cities,...villages].find(p=>p.id===home.home)!;
  assert.deepEqual(home,residentAt(place,home.index,3601));
  function summaryWithLive(code:string,tick:number){return{...summaryAt(code,tick),tier:'live'};}
});
