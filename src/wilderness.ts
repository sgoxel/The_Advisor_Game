import { macroLakes } from "./macro-geography.ts";
import { climateSampleAt } from "./climate.ts";
import { nearestPlace } from "./geography.ts";
import { naturalSurfaceAt, drainageSegmentsInBounds } from "./hydrology.ts";
import { sourceToLonLat, lonLatToSource, wrapSourceX, SOURCE_PRESENTATION_WIDTH, CANONICAL_METRES_PER_SOURCE_UNIT, type CanonicalPosition } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { digest, finalSurfaceAt, WORLD_SEED } from "./world.ts";

export type WildernessKind = "ruin" | "dungeon" | "cave" | "mine" | "forest" | "lake" | "waterfall" | "cliff" | "hill" | "wild-meadow";
export type WildernessSite = { code: string; name: string; kind: WildernessKind; x: number; z: number; canonicalPosition: CanonicalPosition; radiusM: number; variant: number; yaw: number; description: string };
const CELL = 256, COLUMNS = SOURCE_PRESENTATION_WIDTH / CELL, CACHE_LIMIT = 96;
const cache = new Map<string, readonly WildernessSite[]>();
const names: Record<WildernessKind, readonly string[]> = {
  ruin: ["Broken Keep", "Lost Watch", "Fallen Hall"], dungeon: ["Sunken Stair", "Forgotten Vault", "Buried Gate"],
  cave: ["Hollow", "Cavern", "Rockmouth"], mine: ["Old Mine", "Abandoned Dig", "Silver Cut"],
  forest: ["Deepwood", "Wild Forest", "Old Grove"], lake: ["Lake", "Stillwater", "Hidden Mere"],
  waterfall: ["Falls", "Cascade", "Whitewater"], cliff: ["Crags", "Stone Face", "Cliffs"],
  hill: ["High Knoll", "Wild Ridge", "Hill"], "wild-meadow": ["Wild Heath", "Flower Meadow", "Open Glade"],
};
const descriptions: Record<WildernessKind,string> = {
  ruin: "Weathered walls and scattered foundations mark an abandoned outpost.",
  dungeon: "An old stone stair and broken gateway mark an underground entrance.",
  cave: "A dark opening shelters beneath the exposed hillside rock.",
  mine: "Timber supports and old spoil mark a hillside mine entrance.",
  forest: "Thick woodland, shaded undergrowth and irregular clearings stretch between the settlements.",
  lake: "A natural freshwater lake lies among the surrounding wild land.",
  waterfall: "Flowing river water descends through a steep natural cascade.",
  cliff: "Exposed rock and steep ground form a natural landmark.",
  hill: "The land rises into a wild ridge with views over the surrounding countryside.",
  "wild-meadow": "An uncultivated glade of grasses, flowers and scattered natural stone.",
};
export function wildernessCell(gx: number, gz: number): readonly WildernessSite[] {
  const address = ((gx % COLUMNS) + COLUMNS) % COLUMNS, key = `${address}/${gz}`, existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key,existing); return existing; }
  const sites: WildernessSite[] = [], unit = (salt:string) => digest(`${WORLD_SEED}/WILDERNESS/${key}/${salt}`) / 4294967296;
  for (let attempt=0; attempt<32 && sites.length<3; attempt++) {
    const x=wrapSourceX((address+unit(`${attempt}/X`))*CELL), z=(gz+unit(`${attempt}/Z`))*CELL;
    if (Math.abs(sourceToLonLat(x,z).lat) > Math.PI*.46) continue;
    const natural=naturalSurfaceAt(x,z);if(natural.water.kind==="ocean")continue;
    const surface=finalSurfaceAt(x,z), ll=sourceToLonLat(x,z), place=nearestPlace(x,z), metric=sourceUnitsPerMetreAt(z);
    if(surface.reservedUse)continue;
    if (place && Math.hypot(wrapSourceX(x-place.x)/metric.x,(z-place.z)/metric.z) < (place.kind==="city"?1650:650)) continue;
    if ([0,1,2,3,4,5,6,7].some(i=>{const a=i*Math.PI/4,p=finalSurfaceAt(x+Math.cos(a)*35*metric.x,z+Math.sin(a)*35*metric.z);return p.material==="Road"||p.material==="Bridge";})) continue;
    if (sites.some(s=>Math.hypot(wrapSourceX(x-s.x)/metric.x,(z-s.z)/metric.z)<220)) continue;
    const variant=digest(`${WORLD_SEED}/${key}/${attempt}/FORM`), climate=climateSampleAt(ll,surface.groundHeight);
    let kind: WildernessKind;
    if (natural.water.kind==="lake") kind="lake";
    else if (natural.water.kind==="river") {
      const length=Math.hypot(natural.water.flowX,natural.water.flowZ)||1, dx=natural.water.flowX/length*metric.x*16,dz=natural.water.flowZ/length*metric.z*16,
        up=naturalSurfaceAt(x-dx,z-dz),down=naturalSurfaceAt(x+dx,z+dz);
      if (up.water.kind!=="river" || down.water.kind!=="river" || Math.abs(up.water.level-down.water.level)<1.5) continue;
      kind="waterfall";
    } else {
      if (!surface.walkable || surface.reservedUse || surface.groundHeight<.5) continue;
      const candidates: WildernessKind[] = ["ruin","dungeon","wild-meadow"];
      if (climate.forestFamily) candidates.push("forest","forest","forest");
      if (natural.slope>.035) candidates.push("hill","cave","mine");
      if (natural.slope>.18 || natural.cliff) candidates.push("cliff","cliff");
      kind=candidates[variant%candidates.length];
    }
    const prefix=["Raven","Moss","Briar","Grey","Amber","Elder","Thorn","Ash"][variant%8], suffix=names[kind][(variant>>>4)%names[kind].length];
    sites.push({code:`${WORLD_SEED}/WILDERNESS/${key}/${attempt}`,name:`${prefix} ${suffix}`,kind,x,z,
      canonicalPosition:{...ll,elevation:surface.groundHeight},radiusM:kind==="forest"?110:kind==="lake"?80:24,
      variant,yaw:(variant%360)*Math.PI/180,description:descriptions[kind]});
  }
  // Water landmarks are sampled on the actual river network, rather than hoping a random land probe hits a stream.
  for(const segment of drainageSegmentsInBounds(address*CELL,gz*CELL,CELL)) {
    if(sites.filter(s=>s.kind==="waterfall").length>=1)break;
    const x=wrapSourceX(segment.ax+wrapSourceX(segment.bx-segment.ax)*.5),z=(segment.az+segment.bz)*.5;
    if(Math.floor(((x%SOURCE_PRESENTATION_WIDTH)+SOURCE_PRESENTATION_WIDTH)%SOURCE_PRESENTATION_WIDTH/CELL)!==address||Math.floor(z/CELL)!==gz)continue;
    const water=naturalSurfaceAt(x,z),metric=sourceUnitsPerMetreAt(z),len=Math.hypot(water.water.flowX,water.water.flowZ)||1,
      dx=water.water.flowX/len*metric.x*16,dz=water.water.flowZ/len*metric.z*16,
      up=naturalSurfaceAt(x-dx,z-dz),down=naturalSurfaceAt(x+dx,z+dz);
    if(water.water.kind!=="river"||up.water.kind!=="river"||down.water.kind!=="river"||Math.abs(up.water.level-down.water.level)<1.5||finalSurfaceAt(x,z).reservedUse)continue;
    const variant=digest(`${WORLD_SEED}/${segment.code}/CASCADE`);
    sites.push({code:`${segment.code}/CASCADE`,name:`${["Raven","Silver","White","Moss"][variant%4]} Cascade`,kind:"waterfall",x,z,canonicalPosition:{...sourceToLonLat(x,z),elevation:water.water.level},radiusM:30,variant,yaw:Math.atan2(water.water.flowZ,water.water.flowX),description:descriptions.waterfall});
  }
  cache.set(key,sites); while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value!);
  return sites;
}
/** Focus-bounded, lazy countryside registry. No global all-world generation. */
export function nearbyWilderness(x:number,z:number,radius:number,limit=18) {
  const centreX=Math.floor(x/CELL),centreZ=Math.floor(z/CELL),reach=Math.min(2,Math.ceil(radius/CELL)),found:WildernessSite[]=[];
  for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++)
    for(const site of wildernessCell(centreX+dx,centreZ+dz))if(Math.hypot(wrapSourceX(site.x-x),site.z-z)<=radius)found.push(site);
  for(const lake of macroLakes) {
    const p=lonLatToSource(lake.center.lon,lake.center.lat);
    if(Math.hypot(wrapSourceX(p.x-x),p.z-z)>radius)continue;
    const water=naturalSurfaceAt(p.x,p.z);if(water.water.kind!=="lake")continue;
    const variant=digest(lake.code);found.push({code:lake.code,name:`${["Silver","Reed","Still","Moon"][variant%4]} Lake`,kind:"lake",x:p.x,z:p.z,canonicalPosition:{...lake.center,elevation:water.water.level},radiusM:100,variant,yaw:0,description:descriptions.lake});
  }
  return found.sort((a,b)=>Math.hypot(wrapSourceX(a.x-x),a.z-z)-Math.hypot(wrapSourceX(b.x-x),b.z-z)).slice(0,limit);
}
