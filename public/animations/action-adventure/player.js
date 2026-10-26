// Shared Mixamo playback. Source files stay in Studio; reusable clips load once.
const manifests=new Map(),clipCache=new Map(),trackCache=new Map();
const legacy={Hips:'Hips',Spine:'Spine1',Head:'Head','Arm.L':'LeftArm','Forearm.L':'LeftForeArm','Arm.R':'RightArm','Forearm.R':'RightForeArm','Thigh.L':'LeftUpLeg','Shin.L':'LeftLeg','Thigh.R':'RightUpLeg','Shin.R':'RightLeg'};
export async function loadPack(base=document.baseURI){
 const url=new URL('animations/action-adventure/manifest.json',base).href;
 if(!manifests.has(url))manifests.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Animation pack unavailable');return r.json();}).catch(e=>{manifests.delete(url);throw e;}));
 return manifests.get(url);
}
async function loadClip(entry,base){
 const url=new URL(entry.url,base).href;
 if(!clipCache.has(url))clipCache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Could not load '+entry.name);return r.json();}).catch(e=>{clipCache.delete(url);throw e;}));
 return clipCache.get(url);
}
export function inspectRig(pc,model){
 const result=[],rootInverse=model.getWorldTransform().clone().invert(),rootRotation=model.getRotation().clone().invert();
 for(const node of model.find(n=>n.name.startsWith('mixamorig:')||n.name in legacy)){
  const source=node.name.startsWith('mixamorig:')?node.name.slice(10):legacy[node.name];
  const rotation=rootRotation.clone().mul(node.getRotation()),reference=rotation.clone();
  // Older Studio meshes bind their arms down. Use a horizontal reference frame
  // so a source T-pose does not rotate an already lowered arm down a second time.
  if(!node.name.startsWith('mixamorig:')&&/^(Left|Right)(Arm|ForeArm)$/.test(source)){
   const axis=rotation.transformVector(new pc.Vec3(0,1,0)).normalize();
   const desired=new pc.Vec3(source.startsWith('Left')?1:-1,0,0);
   reference.copy(new pc.Quat().setFromDirections(axis,desired).mul(rotation));
  }
  const path=[];let current=node;while(current&&current!==model){path.unshift(current.name);current=current.parent;}
  result.push({node,source,rotation:node.getLocalRotation().clone(),reference,parentRotation:rootRotation.clone().mul(node.parent.getRotation()),position:node.getLocalPosition().clone(),path,
   height:rootInverse.transformPoint(node.getPosition()).y,parentInverse:new pc.Mat4().mul2(rootInverse,node.parent.getWorldTransform()).invert()});
 }
 return result;
}
function compile(pc,model,joints,clip,inPlace){
 const byNode=new Map(joints.map(j=>[j.node,j]));
 const signature=JSON.stringify([clip.sourceSha256,inPlace,joints.map(j=>[j.path,j.reference.toString(),j.parentRotation.toString(),j.position.toString()]),model.getWorldTransform().getScale().toString()]);
 if(trackCache.has(signature))return trackCache.get(signature);
 const sourceIndex=new Map(clip.bones.map((name,i)=>[name,i]));
 const times=Array.from({length:clip.frameCount},(_,i)=>i/(clip.frameCount-1)*clip.duration);
 const inputs=[new pc.AnimData(1,times)],outputs=[],curves=[];
 const delta=(source,frame)=>{const i=sourceIndex.get(source);return i===undefined?new pc.Quat():new pc.Quat(...clip.rotations.slice((frame*clip.bones.length+i)*4,(frame*clip.bones.length+i)*4+4));};
 const curve=(joint,property,components,data)=>{const out=outputs.length;outputs.push(new pc.AnimData(components,data));curves.push(new pc.AnimCurve([{entityPath:joint.path,component:'graph',propertyPath:[property]}],0,out,pc.INTERPOLATION_LINEAR));};
 for(const joint of joints){
  if(!sourceIndex.has(joint.source))continue;
  const parent=byNode.get(joint.node.parent),data=[];let previous;
  for(let frame=0;frame<clip.frameCount;frame++){
   const world=delta(joint.source,frame).mul(joint.reference);
   const parentWorld=parent?delta(parent.source,frame).mul(parent.reference):joint.parentRotation.clone();
   const local=parentWorld.invert().mul(world).normalize();
   if(previous&&previous.dot(local)<0)local.set(-local.x,-local.y,-local.z,-local.w);
   data.push(local.x,local.y,local.z,local.w);previous=local;
  }
  curve(joint,'localRotation',4,data);
 }
 const hips=joints.find(j=>j.source==='Hips');
 if(hips){
  const sourceHeight=clip.sourceHipHeight;if(!(sourceHeight>0))throw Error('Invalid source skeleton height');
  const ratio=hips.height/sourceHeight,positions=[];
  for(let frame=0;frame<clip.frameCount;frame++){
   const raw=new pc.Vec3(inPlace?0:clip.hip[frame*3]-clip.hip[0],clip.hip[frame*3+1],inPlace?0:clip.hip[frame*3+2]-clip.hip[2]).mulScalar(ratio);
   const local=hips.parentInverse.transformVector(raw).add(hips.position);positions.push(local.x,local.y,local.z);
  }
  curve(hips,'localPosition',3,positions);
 }
 const track=new pc.AnimTrack(clip.id,clip.duration,inputs,outputs,curves);trackCache.set(signature,track);return track;
}
export async function attachPack(pc,app,model,{base=document.baseURI,inPlace=true,onStatus=()=>{}}={}){
 const joints=inspectRig(pc,model),hip=joints.find(j=>j.source==='Hips');
 if(!hip||!joints.some(j=>j.source==='LeftArm'))return null;
 const rest=joints.map(j=>({node:j.node,position:j.position,rotation:j.rotation}));
 const pack=await loadPack(base);if(model._destroying||model._destroyed)return null;
 const entries=new Map(pack.clips.map(entry=>[entry.id,entry]));
 let alive=true,requested='',paused=false,rate=1,manual=false,mode='tpose',generation=0;
 const resetBones=()=>{for(const j of rest){j.node.setLocalPosition(j.position);j.node.setLocalRotation(j.rotation);}};
 if(model.anim)model.removeComponent('anim');
 model.addComponent('anim',{activate:true});
 model.anim.loadStateGraph(new pc.AnimStateGraph({layers:[{name:'Base',states:[{name:'START'},...pack.clips.map(e=>({name:e.id,speed:1,loop:e.loop}))],transitions:[]}],parameters:{}}));
 const assigned=new Map(),travelSpeed=new Map();
 async function prepare(id){
  const entry=entries.get(id);if(!entry)throw Error('Animation absent from this pack: '+id);
  if(!assigned.has(id))assigned.set(id,loadClip(entry,base).then(clip=>{
   if(!alive)return;const track=compile(pc,model,joints,clip,inPlace);model.anim.assignAnimation(id,track);
   const length=clip.hip.length;
   travelSpeed.set(id,Math.hypot(clip.hip[length-3]-clip.hip[0],clip.hip[length-1]-clip.hip[2])/clip.duration*hip.height*model.getLocalScale().y/clip.sourceHipHeight);
   return track;
  }).catch(e=>{assigned.delete(id);throw e;}));
  return assigned.get(id);
 }
 async function play(id,blend=.15){
  if(!alive)return;const ticket=++generation;requested=id;
  if(id==='tpose'){model.anim.enabled=false;resetBones();mode=id;return;}
  onStatus('Loading '+(entries.get(id)?.name||id)+'…');
  try{await prepare(id);if(!alive||ticket!==generation)return;
   model.anim.enabled=true;model.anim.playing=true;model.anim.speed=paused?0:rate;
   model.anim.baseLayer.transition(id,blend);mode=id;onStatus('Mixamo · '+entries.get(id).name);
  }catch(e){if(alive&&ticket===generation)onStatus(e.message);throw e;}
 }
 const controller={pack,supported:true,
  async select(id){manual=true;return play(id);},
  async locomotion(speed){if(manual||!alive)return;const id=speed>.035?(speed>2.2?pack.defaults.run:pack.defaults.walk):pack.defaults.idle;
   const nominal=travelSpeed.get(id);rate=speed>.035&&nominal>.05?Math.max(.15,Math.min(2,speed/nominal)):1;
   model.anim.speed=paused?0:rate;if(requested!==id)return play(id);},
  automatic(){manual=false;requested='';},
  pause(value){paused=value;model.anim.speed=paused?0:rate;},
  speed(value){rate=Math.max(.25,Math.min(2,Number(value)||1));model.anim.speed=paused?0:rate;},
  async inPlace(value){if(inPlace===value)return;inPlace=value;assigned.clear();return play(requested||'tpose',0);},
  reset(){paused=false;return play('tpose',0);},
  snapshot(){return {supported:true,motion:mode,playing:!paused,bones:joints.length,time:model.anim?.baseLayer?.activeStateCurrentTime||0,
    hips:hip.node.getLocalPosition().toString(),root:model.getLocalPosition().toString(),
    transforms:Object.fromEntries(joints.map(j=>[j.source,j.node.getLocalRotation().toString()]))};},
  destroy(){alive=false;generation++;model.removeComponent('anim');resetBones();},
 };
 return controller;
}
