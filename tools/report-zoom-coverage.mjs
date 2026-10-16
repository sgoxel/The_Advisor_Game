import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {comparePanImages} from '../tests/pan-images.js';

// Never count the old view's final frame as the new view becoming ready. A
// cached preview also does not count unless its independent render layer draws.
export function coverageMeasurements(record) {
  return record.phases.map(phase => {
    const target = JSON.stringify(phase.state.performance.wantedCanonicalKeys);
    const trace = phase.trace.filter(s => JSON.stringify(s.performance.wantedCanonicalKeys) === target);
    const coherent = trace.find(s => {
      const p = s.performance, active = new Set(p.activeCanonicalKeys);
      if (p.wantedCanonicalKeys.length && p.wantedCanonicalKeys.every(k => active.has(k))) return true;
      const c = s.coverage, visible = new Set(c?.visibleCanonicalKeys);
      return c?.complete && c.layerDebug?.valid && c.layerDebug.culled > 0 &&
        c.canonicalKeys.length > 0 && c.canonicalKeys.every(k => visible.has(k));
    });
    return {backend:record.backend,profile:record.profile,phase:phase.name,coldMs:record.coldMs,
      firstCoherentMs:coherent?.ms ?? null,settledMs:trace.find(s=>s.settled)?.ms ?? null,
      samples:trace.length,errors:record.errors,
      budgetsPass:phase.trace.every(s=>s.performance.withinBudget),
      maxJobs:Math.max(...phase.trace.map(s=>s.performance.generationReady)),
      maxCpuBytes:Math.max(...phase.trace.map(s=>s.performance.cpuResourceBytesEstimated)),
      maxGpuBytes:Math.max(...phase.trace.map(s=>s.performance.gpuResourceBytesEstimated))};
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root=process.argv[2];
  const rows=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory())
    .flatMap(d=>{
      const dir=path.join(root,d.name),file=path.join(dir,'measurement.json');
      return fs.existsSync(file)?coverageMeasurements(JSON.parse(fs.readFileSync(file,'utf8'))).map(row=>({...row,
        transientComparisons:['250ms','1000ms'].map(time=>({time,...comparePanImages(path.join(dir,`${row.phase}-${time}.png`),path.join(dir,`${row.phase}-final.png`))}))})):[];
    });
  console.log(JSON.stringify(rows,null,2));
  if(!rows.length || rows.some(r=>r.firstCoherentMs===null || r.settledMs===null || !r.budgetsPass || r.errors.length || r.transientComparisons.some(c=>!c.passed)))process.exitCode=1;
}
