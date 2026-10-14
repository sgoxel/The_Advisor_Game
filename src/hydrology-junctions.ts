import type {DrainageRecipe,DrainagePoint} from "./hydrology.ts";
import {wrapSourceX} from "./planet.ts";

type Node={x:number;z:number;bed:number;out:Set<number>};
type Segment={a:number;b:number;path:number;index:number;code:string;width:number;cuts:{t:number;node:number}[]};
/** Compact basin graph only; no meshes, cells, camera or mutable random stream. */
export function reconcileDrainageJunctions(input:readonly DrainageRecipe[]) {
 const raw=[...input].sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:0);
 const parents:number[]=[];
 const nodes:Node[]=[], nodeByPoint=new Map<string,number>(), paths:number[][]=[], segments:Segment[]=[], buckets=new Map<string,number[]>();
 const key=(x:number,z:number)=>`${Math.floor((wrapSourceX(x)+131072)/1024)}/${Math.floor(z/1024)}`;
 const node=(p:DrainagePoint)=>{
  const k=`${wrapSourceX(p.x).toFixed(8)}/${p.z.toFixed(8)}`,existing=nodeByPoint.get(k);
  if(existing!==undefined){nodes[existing].bed=Math.min(nodes[existing].bed,p.bed);return existing;}
  const id=nodes.length;parents.push(id);nodes.push({x:wrapSourceX(p.x),z:p.z,bed:p.bed,out:new Set()});nodeByPoint.set(k,id);return id;
 };
 for(const recipe of raw)for(const [kind,points]of [['MAIN',recipe.points],['TRIBUTARY',recipe.tributary]]as const){
  const path=paths.length,ids=points.map(node);paths.push(ids);
  for(let i=1;i<ids.length;i++){
   const s:Segment={a:ids[i-1],b:ids[i],path,index:i-1,code:`${recipe.code}/${kind}/${i-1}`,width:recipe.width*(kind==='MAIN'?1:.62),cuts:[]},id=segments.length;
   segments.push(s);const a=nodes[s.a],b=nodes[s.b],mx=wrapSourceX(a.x+wrapSourceX(b.x-a.x)*.5),mz=(a.z+b.z)*.5;
   for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++){const k=key(mx+x*1024,mz+z*1024),list=buckets.get(k)||[];list.push(id);buckets.set(k,list);}
  }
 }
 const find=(id:number):number=>{let root=id;while(parents[root]!==root)root=parents[root];while(parents[id]!==id){const next=parents[id];parents[id]=root;id=next;}return root;};
 const unite=(a:number,b:number)=>{a=find(a);b=find(b);if(a===b)return a;const root=Math.min(a,b),other=Math.max(a,b);parents[other]=root;nodes[root].bed=Math.min(nodes[root].bed,nodes[other].bed);return root;};
 const closest=(a:Node,b:Node,c:Node,d:Node)=>{
  const rx=wrapSourceX(b.x-a.x),rz=b.z-a.z,cx=wrapSourceX(c.x-a.x),cz=c.z-a.z,sx=wrapSourceX(d.x-c.x),sz=d.z-c.z,den=rx*sz-rz*sx;
  if(Math.abs(den)>1e-9){const t=(cx*sz-cz*sx)/den,u=(cx*rz-cz*rx)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return{t,u,distance:0};}
  const clamp=(v:number)=>Math.max(0,Math.min(1,v)),rr=rx*rx+rz*rz||1,ss=sx*sx+sz*sz||1;
  const pairs=[{t:0,u:clamp((-cx*sx-cz*sz)/ss)},{t:1,u:clamp(((rx-cx)*sx+(rz-cz)*sz)/ss)},
   {t:clamp((cx*rx+cz*rz)/rr),u:0},{t:clamp(((cx+sx)*rx+(cz+sz)*rz)/rr),u:1}];
  return pairs.map(p=>({...p,distance:Math.hypot(rx*p.t-cx-sx*p.u,rz*p.t-cz-sz*p.u)})).sort((p,q)=>p.distance-q.distance||p.t-q.t||p.u-q.u)[0];
 };
 let pairsChecked=0,junctions=0;
 for(let i=0;i<segments.length;i++){
  const s=segments[i],a=nodes[s.a],b=nodes[s.b],mx=wrapSourceX(a.x+wrapSourceX(b.x-a.x)*.5),mz=(a.z+b.z)*.5;
  for(const j of buckets.get(key(mx,mz))||[]){
   if(j<=i)continue;const other=segments[j];if(s.path===other.path&&Math.abs(s.index-other.index)<=1)continue;
   const c=nodes[other.a],d=nodes[other.b];pairsChecked++;
   const hit=closest(a,b,c,d);if(hit.distance>s.width+other.width)continue;
   const x1=wrapSourceX(a.x+wrapSourceX(b.x-a.x)*hit.t),z1=a.z+(b.z-a.z)*hit.t,x2=wrapSourceX(c.x+wrapSourceX(d.x-c.x)*hit.u),z2=c.z+(d.z-c.z)*hit.u;
   const bed=Math.min(a.bed+(b.bed-a.bed)*hit.t,c.bed+(d.bed-c.bed)*hit.u),id=node({x:x1,z:z1,bed}),otherId=node({x:x2,z:z2,bed});
   unite(id,otherId);
   s.cuts.push({t:hit.t,node:id});other.cuts.push({t:hit.u,node:otherId});junctions++;
  }
 }
 const rebuilt=paths.map(()=>[]as number[]);
 for(const s of segments){
  const chain=[{t:0,node:s.a},...s.cuts,{t:1,node:s.b}].sort((a,b)=>a.t-b.t||a.node-b.node);
  // At a shared end, select the common junction rather than retain two differing
  // positions for the same station. All physical endpoints still share a node.
  const ids:number[]=[];
  for(const item of chain)if(ids.at(-1)!==item.node)ids.push(item.node);
  for(let i=1;i<ids.length;i++){const a=find(ids[i-1]),b=find(ids[i]);if(a!==b)nodes[a].out.add(b);}
  const path=rebuilt[s.path];if(!path.length)path.push(ids[0]);else if(path.at(-1)!==ids[0]){const a=find(path.at(-1)!),b=find(ids[0]);if(a!==b)nodes[a].out.add(b);path.push(ids[0]);}path.push(...ids.slice(1));
 }
 // Multi-source minimum propagation: each directed edge is processed once.
 // The heap avoids an unbounded repeated whole-graph relaxation loop.
 const heap:{id:number;height:number}[]=[];
 const push=(v:{id:number;height:number})=>{let i=heap.length;heap.push(v);while(i){const p=(i-1)>>1;if(heap[p].height<=v.height)break;heap[i]=heap[p];i=p;}heap[i]=v;};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].height<heap[c].height)c++;if(heap[c].height>=last.height)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
 nodes.forEach((n,id)=>push({id,height:n.bed}));const visited=new Set<number>();let edges=0;
 while(heap.length){const entry=pop();if(visited.has(entry.id))continue;visited.add(entry.id);for(const next of nodes[entry.id].out){edges++;if(nodes[next].bed>entry.height){nodes[next].bed=entry.height;push({id:next,height:entry.height});}}}
 // Equal-stage braided reaches drain toward their shortest existing outlet.
 // Positive bed drops take precedence; flat storage links have no forced flow.
 const roots=new Set(nodes.map((_,id)=>find(id))),reverse=nodes.map(()=>new Set<number>()),rank=nodes.map(()=>Infinity);
 for(const id of roots)for(const next of nodes[id].out){reverse[next].add(id);if(Math.abs(nodes[id].bed-nodes[next].bed)<1e-9)reverse[id].add(next);}
 const queue:number[]=[];
 for(let i=0;i<raw.length;i++){const last=rebuilt[i*2].at(-1);if(last!==undefined){const id=find(last);if(rank[id]!==0){rank[id]=0;queue.push(id);}}}
 for(let i=0;i<queue.length;i++)for(const next of reverse[queue[i]])if(!Number.isFinite(rank[next])){rank[next]=rank[queue[i]]+1;queue.push(next);}
 const flowDirection=new Map<string,number>(),flow=nodes.map(()=>new Set<number>());let standingSegments=0;
 for(let path=0;path<rebuilt.length;path++)for(let i=1;i<rebuilt[path].length;i++){
  const a=find(rebuilt[path][i-1]),b=find(rebuilt[path][i]),code=`${raw[Math.floor(path/2)].code}/${path%2?'TRIBUTARY':'MAIN'}/${i-1}`;
  let direction=0;
  if(a!==b){direction=nodes[a].bed>nodes[b].bed+1e-9?1:nodes[b].bed>nodes[a].bed+1e-9?-1:rank[a]>rank[b]?1:rank[a]<rank[b]?-1:a>b?1:-1;flow[direction>0?a:b].add(direction>0?b:a);}
  else standingSegments++;
  flowDirection.set(code,direction);
 }
 const indegree=nodes.map(()=>0);flow.forEach(set=>set.forEach(id=>indegree[id]++));const audit:number[]=[];indegree.forEach((v,id)=>{if(!v)audit.push(id)});
 let consumed=0;for(let i=0;i<audit.length;i++){consumed++;flow[audit[i]].forEach(next=>{if(--indegree[next]===0)audit.push(next)});}
 const point=(id:number)=>Object.freeze({x:nodes[id].x,z:nodes[id].z,bed:nodes[find(id)].bed});
 const recipes=Object.freeze(raw.map((r,i)=>Object.freeze({...r,points:Object.freeze(rebuilt[i*2].map(point)),tributary:Object.freeze(rebuilt[i*2+1].map(point))})));
 const byCode=new Map(recipes.map(r=>[r.code,r]));
 return {recipes:Object.freeze(input.map(r=>byCode.get(r.code)!)),flowDirection,summary:Object.freeze({nodes:nodes.length,heightConstraintEdges:edges,edges:flow.reduce((sum,set)=>sum+set.size,0),junctions,pairsChecked,standingSegments,cyclicNodes:nodes.length-consumed,unreachableOutlets:[...roots].filter(id=>!Number.isFinite(rank[id])).length})};
}
