(function(){
"use strict";

const ROOT="assets/tiles/vector/";
const BASE=Object.freeze({
  grass:"grass.svg",
  forest:"forest.svg",
  dirt:"dirt.svg",
  mud:"mud.svg",
  road:"road.svg",
  bridge:"bridge.svg",
  square:"square.svg",
  path:"path.svg",
  plot:"plot.svg",
  water:"water.svg",
  rock:"rock.svg",
  sand:"sand.svg",
  farmland:"farmland.svg",
  floor:"floor_wood.svg",
  wall:"wall_n.svg",
  door:"door_s.svg"
});

const VARIANTS=Object.freeze({
  "floor-wood":"floor_wood.svg",
  "wall-n":"wall_n.svg",
  "wall-e":"wall_e.svg",
  "wall-s":"wall_s.svg",
  "wall-w":"wall_w.svg",
  "wall-corner-ne":"wall_corner_ne.svg",
  "wall-corner-se":"wall_corner_se.svg",
  "wall-corner-sw":"wall_corner_sw.svg",
  "wall-corner-nw":"wall_corner_nw.svg",
  "door-n":"door_n.svg",
  "door-e":"door_e.svg",
  "door-s":"door_s.svg",
  "door-w":"door_w.svg"
});

const NATURAL=new Set(["grass","forest","dirt","mud","water","rock","sand","farmland"]);

const BLENDABLE=new Set([
  "grass","forest","dirt","mud","water","rock","sand","farmland","road","path"
]);

const BLEND_PRIORITY=Object.freeze({
  grass:10,
  farmland:20,
  forest:30,
  rock:40,
  sand:50,
  dirt:60,
  mud:70,
  path:80,
  road:90,
  water:100
});

const BLEND_MASKS=Object.freeze({
  edge:Object.freeze({
    n:Object.freeze(["blend_edge_n.svg","blend_edge_n_b.svg"]),
    e:Object.freeze(["blend_edge_e.svg","blend_edge_e_b.svg"]),
    s:Object.freeze(["blend_edge_s.svg","blend_edge_s_b.svg"]),
    w:Object.freeze(["blend_edge_w.svg","blend_edge_w_b.svg"])
  }),
  corner:Object.freeze({
    ne:Object.freeze(["blend_corner_ne.svg","blend_corner_ne_b.svg"]),
    se:Object.freeze(["blend_corner_se.svg","blend_corner_se_b.svg"]),
    sw:Object.freeze(["blend_corner_sw.svg","blend_corner_sw_b.svg"]),
    nw:Object.freeze(["blend_corner_nw.svg","blend_corner_nw_b.svg"])
  }),
  peninsula:Object.freeze({
    n:Object.freeze(["blend_peninsula_n.svg","blend_peninsula_n_b.svg"]),
    e:Object.freeze(["blend_peninsula_e.svg","blend_peninsula_e_b.svg"]),
    s:Object.freeze(["blend_peninsula_s.svg","blend_peninsula_s_b.svg"]),
    w:Object.freeze(["blend_peninsula_w.svg","blend_peninsula_w_b.svg"])
  }),
  island:Object.freeze(["blend_island.svg","blend_island_b.svg"])
});

const INFRA_BLEND_TYPES=new Set(["road","path"]);

function canBlend(base,target){
  if(!BLENDABLE.has(base)||!BLENDABLE.has(target)||base===target)return false;
  if((base==="water"&&INFRA_BLEND_TYPES.has(target))||(target==="water"&&INFRA_BLEND_TYPES.has(base))){
    return false;
  }
  return (BLEND_PRIORITY[target]||0)>(BLEND_PRIORITY[base]||0);
}

function blendVariantIndex(context,target,shape,key,count){
  if(count<=1||!context||!context.seed)return 0;
  const stableKey=[
    "terrain-blend",
    String(context.x),
    String(context.y),
    String(context.base||""),
    String(target),
    String(shape),
    String(key||"all")
  ].join(":");
  return PRNG.foundationUint32(context.seed,stableKey)%count;
}

function blendMaskSpec(target,shape,key,context){
  let files=null;
  if(shape==="island")files=BLEND_MASKS.island;
  else files=BLEND_MASKS[shape]&&BLEND_MASKS[shape][key];
  if(!files||!files.length)return null;
  const variantIndex=blendVariantIndex(context,target,shape,key,files.length);
  return Object.freeze({
    terrain:target,
    shape,
    orientation:key||"all",
    variant:variantIndex===0?"a":"b",
    variantIndex,
    mask:ROOT+files[variantIndex]
  });
}

function specsForSides(target,sides,context){
  if(sides.length===4)return [blendMaskSpec(target,"island","all",context)];
  if(sides.length===3){
    const missing=["n","e","s","w"].find(side=>!sides.includes(side));
    return [blendMaskSpec(target,"peninsula",missing,context)];
  }
  if(sides.length===2){
    const key=sides.slice().sort().join("");
    const corners={
      en:"ne",
      es:"se",
      sw:"sw",
      nw:"nw"
    };
    if(corners[key])return [blendMaskSpec(target,"corner",corners[key],context)];
    return sides.map(side=>blendMaskSpec(target,"edge",side,context));
  }
  return sides.map(side=>blendMaskSpec(target,"edge",side,context));
}

function blendSpecs(type,neighbors,context){
  if(!BLENDABLE.has(type)||!neighbors)return [];
  const groups=new Map();
  for(const side of ["n","e","s","w"]){
    const target=neighbors[side];
    if(!canBlend(type,target))continue;
    if(!groups.has(target))groups.set(target,[]);
    groups.get(target).push(side);
  }

  const ordered=[...groups.entries()].sort(
    (a,b)=>(BLEND_PRIORITY[a[0]]||0)-(BLEND_PRIORITY[b[0]]||0)
  );
  const specs=[];
  const resolvedContext=context?Object.freeze({...context,base:type}):null;
  for(const [target,sides] of ordered){
    for(const spec of specsForSides(target,sides,resolvedContext)){
      if(spec)specs.push(spec);
    }
  }
  return specs;
}


function asset(type,variant){
  const file=(variant&&VARIANTS[variant])||BASE[type];
  return file?ROOT+file:null;
}

function transition(type,north,east,south,west){
  if(!NATURAL.has(type))return null;
  const diff={
    n:NATURAL.has(north)&&north!==type,
    e:NATURAL.has(east)&&east!==type,
    s:NATURAL.has(south)&&south!==type,
    w:NATURAL.has(west)&&west!==type
  };
  const count=Object.values(diff).filter(Boolean).length;
  if(count===0)return null;

  if(count===3){
    const missing=!diff.n?"n":!diff.e?"e":!diff.s?"s":"w";
    const rotation={w:0,n:90,e:180,s:270}[missing];
    return Object.freeze({shape:"u",rotation,asset:ROOT+"transition_u.svg"});
  }

  if(count===2){
    if(diff.n&&diff.e)return Object.freeze({shape:"l",rotation:0,asset:ROOT+"transition_l.svg"});
    if(diff.e&&diff.s)return Object.freeze({shape:"l",rotation:90,asset:ROOT+"transition_l.svg"});
    if(diff.s&&diff.w)return Object.freeze({shape:"l",rotation:180,asset:ROOT+"transition_l.svg"});
    if(diff.w&&diff.n)return Object.freeze({shape:"l",rotation:270,asset:ROOT+"transition_l.svg"});
    return Object.freeze({
      shape:"c",
      rotation:(diff.n&&diff.s)?90:0,
      asset:ROOT+"transition_c.svg"
    });
  }

  if(count===1){
    const side=diff.n?"n":diff.e?"e":diff.s?"s":"w";
    const rotation={e:0,s:90,w:180,n:270}[side];
    return Object.freeze({shape:"c",rotation,asset:ROOT+"transition_c.svg"});
  }

  return Object.freeze({shape:"u",rotation:0,asset:ROOT+"transition_u.svg"});
}

window.TileTextures=Object.freeze({
  ROOT,BASE,VARIANTS,
  BLEND_MASKS,BLEND_PRIORITY,
  asset,transition,blendSpecs
});
})();