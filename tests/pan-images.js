import fs from 'node:fs';
import utils from 'playwright-core/lib/utilsBundle';
const {PNG}=utils;

// Use the pinned Playwright PNG decoder, with no extra CI/runtime dependency.
// Match verify-pan-images.py: one fixed UI-free crop, no property/edge masks.
export function comparePanImages(before,after) {
  const a=PNG.sync.read(fs.readFileSync(before)),b=PNG.sync.read(fs.readFileSync(after));
  if(a.width!==b.width||a.height!==b.height)throw new Error('Pan viewports differ');
  let total=0,broad=0,count=0;
  for(let y=Math.trunc(a.height*.25);y<Math.trunc(a.height*.75);y++)
    for(let x=Math.trunc(a.width*.2);x<Math.trunc(a.width*.85);x++){
      const i=(y*a.width+x)*4;
      const delta=(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]))/3;
      total+=delta;
      if(delta>12)broad++;
      count++;
    }
  const meanRgbDifference=total/count,broadChangedFraction=broad/count;
  return {meanRgbDifference,broadChangedFraction,passed:meanRgbDifference<=2&&broadChangedFraction<=.05};
}
