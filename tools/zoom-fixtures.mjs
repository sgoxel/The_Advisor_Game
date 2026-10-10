import { climateSampleAt } from '../src/climate.ts';
import { lonLatToFlat } from '../src/planet.ts';
import { heightAt } from '../src/world.ts';
const targets = { grassland: ['grassland', 'meadow'], desert: ['desert'], forest: ['temperate-forest', 'conifer-forest'], snow: ['snowy-mountain'], coast: ['beach'] };
const found = {};
for (let latDeg = -65; latDeg <= 65; latDeg += 2)
  for (let lonDeg = -178; lonDeg < 180; lonDeg += 2) {
    const lon = lonDeg * Math.PI / 180, lat = latDeg * Math.PI / 180;
    const p = lonLatToFlat(lon, lat), sample = climateSampleAt({lon,lat}, heightAt(p.x,p.z));
    for (const [name, classes] of Object.entries(targets))
      if (!found[name] && classes.includes(sample.terrainClass)) found[name] = {lon,lat,materialId:sample.materialId};
  }
if (Object.keys(found).length !== 5) throw Error(`Missing fixtures: ${JSON.stringify(found)}`);
console.log(JSON.stringify(found, null, 2));
