import { villages } from "../src/geography.ts";
import { __wp15RepairViaPoliticalTopology } from "../src/village-routes.ts";
const from=villages.find(v=>v.id==="1/2/0/1")!,to=villages.find(v=>v.id==="1/5/1/0")!;
const started=Date.now();
const result=__wp15RepairViaPoliticalTopology(from,to);
console.log('WP15_ACTUAL_POLITICAL='+JSON.stringify({elapsedMs:Date.now()-started,result:result?{found:result.found,reason:result.reason,points:result.points.length,distanceM:result.distanceM,fantasySeconds:result.fantasySeconds,attempts:result.attempts,expansions:result.expansions}:null}));
