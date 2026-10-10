import { villages } from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { lonLatToSource, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { neighbouringVillages } from "../src/village-routes.ts";

const seen = new Set<string>();
const rows: Array<{key:string; geodesicM:number; r20:number; r35:number; r50:number; r65:number; i02:number; i04:number; i06:number}> = [];
for (const village of villages) {
  for (const { place, geodesicM } of neighbouringVillages(village.id)) {
    const key = [village.id, place.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = lonLatToSource(village.canonicalPosition.lon, village.canonicalPosition.lat),
      b = lonLatToSource(place.canonicalPosition.lon, place.canonicalPosition.lat),
      dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      steps = 96, seg = geodesicM / steps;
    let r20=0,r35=0,r50=0,r65=0,i02=0,i04=0,i06=0;
    for (let s=0;s<steps;s++) {
      const t=(s+0.5)/steps,
        m=macroSampleAt(sourceToLonLat(wrapSourceX(a.x+dx*t), a.z+dz*t));
      if (m.reliefM >= 20) r20 += seg;
      if (m.reliefM >= 35) r35 += seg;
      if (m.reliefM >= 50) r50 += seg;
      if (m.reliefM >= 65) r65 += seg;
      if (m.mountainIntensity >= 0.02) i02 += seg;
      if (m.mountainIntensity >= 0.04) i04 += seg;
      if (m.mountainIntensity >= 0.06) i06 += seg;
    }
    rows.push({key,geodesicM,r20,r35,r50,r65,i02,i04,i06});
  }
}
const top = (field: keyof (typeof rows)[number]) => [...rows].sort((a,b)=>(b[field] as number)-(a[field] as number)).slice(0,8);
for (const field of ["r20","r35","r50","r65","i02","i04","i06"] as const) {
  console.log(field, JSON.stringify(top(field)));
}
console.log("pairs", rows.length);
