import { nearbyWilderness, type WildernessSite } from "./wilderness.ts";
import { placeSymbol } from "./place-symbol.ts";
import "./wilderness.css";

export function createWildernessOverlay(inspect:(site:WildernessSite)=>void) {
  const root=document.createElement("div");root.id="wilderness-labels";document.body.append(root);
  const nodes=new Map<string,HTMLButtonElement>();let last=0;
  return (x:number,z:number,halfHeight:number,scale:number,transition:number,project:(x:number,z:number)=>{x:number;y:number})=>{
    if(transition>.01||scale>250||scale<1){root.hidden=true;return;}root.hidden=false;
    const now=performance.now();if(now-last<180)return;last=now;
    // During an S005 site-route preview, preserve the destination's actual
    // canonical callout over optional wilderness names. This is read-only
    // presentation: it never changes a site's ID, ownership or walkability.
    const transport=document.getElementById("transport-panel"),
      routeAnswer=document.getElementById("transport-site-answer"),
      siteLabels=transport&&!transport.hidden&&routeAnswer?.textContent?.trim()
        ? Array.from(document.querySelectorAll<HTMLElement>("#critical-site-layer .critical-site-marker:not([hidden]) .site-label"))
          .map(node=>node.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0)
        : [];
    const visible=new Set<string>(),positions:{x:number;y:number}[]=[],limit=innerWidth<600?8:16;
    for(const site of nearbyWilderness(x,z,Math.min(600,Math.max(24,halfHeight*2)),40)) {
      const p=project(site.x,site.z);
      const existing=nodes.get(site.code),
        labelWidth=existing?.offsetWidth||Math.min(155,43+site.name.length*7),
        labelHeight=existing?.offsetHeight||40,
        left=p.x-labelWidth/2,top=p.y-labelHeight;
      if(p.x<65||p.x>innerWidth-65||p.y<145||p.y>innerHeight-130||
        positions.some(q=>Math.abs(q.x-p.x)<135&&Math.abs(q.y-p.y)<58)||
        siteLabels.some(rect=>left<rect.right+5&&left+labelWidth>rect.left-5&&top<rect.bottom+5&&top+labelHeight>rect.top-5))continue;
      if(visible.size>=limit)break;
      positions.push(p);visible.add(site.code);let node=nodes.get(site.code);
      if(!node){node=document.createElement("button");node.type="button";node.className="wilderness-label";
        node.innerHTML=placeSymbol(site.kind==="wild-meadow"?"landmark":site.kind);
        const label=document.createElement("span");label.textContent=site.name;node.append(label);node.title=`${site.kind.replaceAll("-"," ")}: ${site.description}`;
        node.setAttribute("aria-label",`Inspect ${site.name}`);node.addEventListener("click",()=>inspect(site));root.append(node);nodes.set(site.code,node);}
      node.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
    }
    for(const [id,node]of nodes)if(!visible.has(id)){node.remove();nodes.delete(id);}
  };
}
