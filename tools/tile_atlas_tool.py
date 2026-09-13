#!/usr/bin/env python3
"""10x10 atlas -> 100x100 runtime PNG tiles + GitHub Git-data publisher."""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path
from typing import Any
try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow required: python -m pip install Pillow") from exc

ATLAS_SIZE=1000; GRID=10; CELL_SIZE=100; SCHEMA_VERSION=3; RESAMPLE=Image.Resampling.LANCZOS

def safe_name(v:str)->str:
    return re.sub(r"[^a-zA-Z0-9_-]+","_",v.strip()).strip("_").lower() or "tile"

def sha256(p:Path)->str:
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1<<20),b""): h.update(chunk)
    return h.hexdigest()

def normalize(image:Image.Image,mode:str)->Image.Image:
    src=image.convert("RGBA")
    if src.size==(ATLAS_SIZE,ATLAS_SIZE): return src
    if mode=="stretch": return src.resize((ATLAS_SIZE,ATLAS_SIZE),RESAMPLE)
    scale=(max if mode=="crop" else min)(ATLAS_SIZE/src.width,ATLAS_SIZE/src.height)
    if mode not in ("fit","crop"): raise ValueError("mode must be fit, crop, or stretch")
    resized=src.resize((max(1,round(src.width*scale)),max(1,round(src.height*scale))),RESAMPLE)
    if mode=="crop":
        l=(resized.width-ATLAS_SIZE)//2; t=(resized.height-ATLAS_SIZE)//2
        return resized.crop((l,t,l+ATLAS_SIZE,t+ATLAS_SIZE))
    out=Image.new("RGBA",(ATLAS_SIZE,ATLAS_SIZE),(0,0,0,0))
    out.alpha_composite(resized,((ATLAS_SIZE-resized.width)//2,(ATLAS_SIZE-resized.height)//2)); return out

def default_cells()->list[dict[str,Any]]:
    out=[]
    for i in range(GRID*GRID):
        r,c=divmod(i,GRID); s=f"r{r:02d}_c{c:02d}"
        out.append({"row":r,"col":c,"semantic_type":s,"display_name":s,"description":f"Atlas tile row {r} column {c}.","category":"terrain","runtime_usage":"terrain/base","unused":False})
    return out

def load_metadata(path:Path|None)->list[dict[str,Any]]:
    cells=default_cells()
    if path is None:return cells
    raw=json.loads(path.read_text(encoding="utf-8")); raw=raw.get("tiles",raw.get("cells",[])) if isinstance(raw,dict) else raw
    if not isinstance(raw,list): raise ValueError("Metadata must be a list or contain tiles/cells.")
    for i,item in enumerate(raw[:GRID*GRID]):
        if isinstance(item,str): cells[i]["semantic_type"]=item; continue
        if not isinstance(item,dict): continue
        s=item.get("semantic_type",item.get("type",item.get("name",cells[i]["semantic_type"])))
        cells[i].update({"semantic_type":str(s or cells[i]["semantic_type"]),"display_name":str(item.get("display_name",item.get("displayName",cells[i]["display_name"])) or ""),"description":str(item.get("description",cells[i]["description"]) or ""),"category":str(item.get("category",cells[i]["category"]) or ""),"runtime_usage":str(item.get("runtime_usage",item.get("runtimeUsage",cells[i]["runtime_usage"])) or ""),"unused":bool(item.get("unused",False))})
    return cells

def save_metadata(path:Path,family:str,cells:list[dict[str,Any]])->None:
    payload={"version":SCHEMA_VERSION,"family":safe_name(family),"grid":[GRID,GRID],"tileSize":[CELL_SIZE,CELL_SIZE],"cells":cells[:GRID*GRID]}
    path.write_text(json.dumps(payload,indent=2)+"\n",encoding="utf-8")

def validate_metadata(family:str,cells:list[dict[str,Any]],transparent_cells:list[bool]|None=None,strict_unused_transparency:bool=False)->list[str]:
    errors=[]
    if safe_name(family)!=family.strip().lower(): errors.append("Invalid family name.")
    if len(cells)!=GRID*GRID:return [f"Exactly {GRID*GRID} metadata cells required."]
    seen={}
    for i,cell in enumerate(cells):
        if cell.get("unused"):
            if strict_unused_transparency and transparent_cells is not None and not transparent_cells[i]: errors.append(f"Cell {i:03d} unused but not transparent.")
            continue
        raw=str(cell.get("semantic_type","")).strip(); s=safe_name(raw)
        if not raw: errors.append(f"Cell {i:03d} missing semantic type."); continue
        if s!=raw.lower(): errors.append(f"Cell {i:03d} invalid semantic type.")
        if s in seen: errors.append(f"Duplicate semantic type '{s}'.")
        else: seen[s]=i
    return errors

def inspect_source(input_path:Path,mode:str)->tuple[Image.Image,tuple[int,int],list[bool]]:
    with Image.open(input_path) as im: original=im.size; atlas=normalize(im,mode)
    transparent=[]
    for i in range(GRID*GRID):
        r,c=divmod(i,GRID); tile=atlas.crop((c*CELL_SIZE,r*CELL_SIZE,(c+1)*CELL_SIZE,(r+1)*CELL_SIZE))
        transparent.append(tile.getchannel("A").getbbox() is None)
    return atlas,original,transparent

def _clean(output:Path,family:str)->None:
    if not output.exists():return
    for pattern in (f"{family}_*_100px.png",f"{family}_*_256px.png",f"{family}_atlas_1024px.png",f"{family}_atlas_1000px.png"):
        for p in output.glob(pattern):
            if p.is_file():p.unlink()

def process(input_path:Path,output_dir:Path,family:str,mode:str="fit",metadata_path:Path|None=None,cells:list[dict[str,Any]]|None=None,require_metadata:bool=False,strict_unused_transparency:bool=False)->dict[str,Any]:
    family=safe_name(family); output_dir.mkdir(parents=True,exist_ok=True)
    atlas,original,transparent=inspect_source(input_path,mode); meta=cells if cells is not None else load_metadata(metadata_path)
    errors=validate_metadata(family,meta,transparent,strict_unused_transparency)
    if errors and require_metadata: raise ValueError("Metadata validation failed: "+"; ".join(errors))
    if len(meta)!=GRID*GRID: raise ValueError(f"Expected {GRID*GRID} metadata cells.")
    _clean(output_dir,family); master=output_dir/f"{family}_atlas_1000px.png"; atlas.save(master,"PNG",optimize=False)
    manifest_tiles=[]; desc_tiles=[]; files=[master]
    for i in range(GRID*GRID):
        r,c=divmod(i,GRID); m=meta[i]
        if m.get("unused") or transparent[i]:continue
        tile=atlas.crop((c*CELL_SIZE,r*CELL_SIZE,(c+1)*CELL_SIZE,(r+1)*CELL_SIZE)); s=safe_name(str(m.get("semantic_type") or f"r{r:02d}_c{c:02d}"))
        name=f"{family}_{s}_100px.png"; path=output_dir/name; tile.save(path,"PNG",optimize=False); files.append(path)
        common={"index":i,"row":r,"col":c,"type":s,"semantic_type":s,"displayName":str(m.get("display_name","")).strip(),"category":str(m.get("category","")).strip(),"runtimeUsage":str(m.get("runtime_usage","")).strip(),"filename":name}
        manifest_tiles.append({**common,"sha256":sha256(path),"size":[CELL_SIZE,CELL_SIZE]}); desc_tiles.append({**common,"description":str(m.get("description","")).strip()})
    manifest={"version":SCHEMA_VERSION,"family":family,"atlas":{"filename":master.name,"width":ATLAS_SIZE,"height":ATLAS_SIZE,"mode":"RGBA","columns":GRID,"rows":GRID,"cellSize":CELL_SIZE,"ordering":"row-major","sha256":sha256(master),"sourceWidth":original[0],"sourceHeight":original[1],"normalizationMode":mode,"normalized":original!=(ATLAS_SIZE,ATLAS_SIZE)},"derivedTilePolicy":{"sourceCellSize":[CELL_SIZE,CELL_SIZE],"outputSize":[CELL_SIZE,CELL_SIZE],"borderTrimPx":0,"resamplingDuringSlice":"NONE"},"tiles":manifest_tiles}
    descriptions={"version":SCHEMA_VERSION,"family":family,"descriptionFilePurpose":"Presentation metadata only; not Simulation authority.","tiles":desc_tiles}
    mp=output_dir/f"{family}_tiles.manifest.json"; dp=output_dir/f"{family}_tiles.descriptions.json"
    mp.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8"); dp.write_text(json.dumps(descriptions,indent=2)+"\n",encoding="utf-8"); files += [mp,dp]
    return {"manifest":manifest,"descriptions":descriptions,"output_dir":str(output_dir),"emitted_count":len(manifest_tiles),"files":[str(p) for p in files]}

def validate_project_root(root:Path)->None:
    if not root.is_dir() or not (root/"README.md").is_file() or not (root/".github").exists(): raise ValueError("Project root must contain README.md and .github.")

def publish_to_project(input_path:Path,project_root:Path,family:str,mode:str,cells:list[dict[str,Any]]|None=None)->dict[str,Any]:
    validate_project_root(project_root); family=safe_name(family)
    return process(input_path,project_root/"textures"/"tiles"/family,family,mode,cells=cells or default_cells())

def _github_request(api:str,token:str,method:str,path:str,payload:Any|None=None)->Any:
    data=None if payload is None else json.dumps(payload).encode(); req=urllib.request.Request(api.rstrip("/")+path,data=data,method=method)
    req.add_header("Accept","application/vnd.github+json"); req.add_header("Authorization",f"Bearer {token}"); req.add_header("X-GitHub-Api-Version","2022-11-28")
    if data is not None:req.add_header("Content-Type","application/json")
    try:
        with urllib.request.urlopen(req,timeout=60) as res:
            body=res.read(); return json.loads(body.decode()) if body else None
    except urllib.error.HTTPError as exc:
        detail=exc.read().decode(errors="replace"); raise RuntimeError(f"GitHub API {method} {path}: HTTP {exc.code}: {detail}") from exc

def publish_files_to_github(files:list[Path],repository:str,branch:str,prefix:str,token:str,commit_message:str,api_base:str="https://api.github.com")->dict[str,Any]:
    parts=repository.strip("/").split("/")
    if len(parts)!=2:raise ValueError("repository must be owner/name")
    if not token:raise ValueError("GitHub token is empty.")
    owner,repo=parts; b=urllib.parse.quote(branch,safe="")
    ref=_github_request(api_base,token,"GET",f"/repos/{owner}/{repo}/git/ref/heads/{b}"); parent=ref["object"]["sha"]
    base=_github_request(api_base,token,"GET",f"/repos/{owner}/{repo}/git/commits/{parent}")["tree"]["sha"]
    entries=[]; records=[]; prefix=prefix.strip("/")
    for p in files:
        raw=p.read_bytes(); is_png=p.suffix.lower()==".png"
        payload={"content":base64.b64encode(raw).decode("ascii"),"encoding":"base64"} if is_png else {"content":raw.decode("utf-8"),"encoding":"utf-8"}
        blob=_github_request(api_base,token,"POST",f"/repos/{owner}/{repo}/git/blobs",payload); path=f"{prefix}/{p.name}" if prefix else p.name
        entries.append({"path":path,"mode":"100644","type":"blob","sha":blob["sha"]}); records.append({"path":path,"sha":blob["sha"],"sha256":hashlib.sha256(raw).hexdigest()})
    tree=_github_request(api_base,token,"POST",f"/repos/{owner}/{repo}/git/trees",{"base_tree":base,"tree":entries})
    commit=_github_request(api_base,token,"POST",f"/repos/{owner}/{repo}/git/commits",{"message":commit_message,"tree":tree["sha"],"parents":[parent]})
    _github_request(api_base,token,"PATCH",f"/repos/{owner}/{repo}/git/refs/heads/{b}",{"sha":commit["sha"],"force":False})
    return {"repository":repository,"branch":branch,"parent":parent,"tree":tree["sha"],"commit":commit["sha"],"files":records}

def publish_result_to_github(result:dict[str,Any],repository:str,branch:str,prefix:str|None,token:str,commit_message:str,api_base:str="https://api.github.com")->dict[str,Any]:
    family=safe_name(result["manifest"]["family"]); prefix=prefix.strip("/") if prefix else f"textures/tiles/{family}"
    return publish_files_to_github([Path(p) for p in result["files"]],repository,branch,prefix,token,commit_message,api_base)

def main()->int:
    p=argparse.ArgumentParser(description="10x10 atlas -> 100x100 PNG tiles + optional GitHub blob publish")
    p.add_argument("input",type=Path); p.add_argument("--output","-o",type=Path); p.add_argument("--project-root",type=Path); p.add_argument("--family","-f",default="tile"); p.add_argument("--mode",choices=("fit","crop","stretch"),default="fit"); p.add_argument("--metadata",type=Path)
    p.add_argument("--github-publish",action="store_true"); p.add_argument("--github-repo",default="sgoxel/The_Advisor_Game"); p.add_argument("--github-branch",default="main"); p.add_argument("--github-prefix"); p.add_argument("--github-token-env",default="GITHUB_TOKEN"); p.add_argument("--github-api",default="https://api.github.com"); p.add_argument("--commit-message")
    a=p.parse_args(); cells=load_metadata(a.metadata)
    result=publish_to_project(a.input,a.project_root,a.family,a.mode,cells) if a.project_root else process(a.input,a.output or a.input.parent/f"{safe_name(a.family)}_tiles",a.family,a.mode,cells=cells)
    print(f"Created {result['emitted_count']} tile(s) in {result['output_dir']}")
    if a.github_publish:
        token=os.environ.get(a.github_token_env,"")
        if not token:raise SystemExit(f"Environment variable {a.github_token_env} is empty.")
        gh=publish_result_to_github(result,a.github_repo,a.github_branch,a.github_prefix,token,a.commit_message or f"Publish {safe_name(a.family)} 10x10 tile atlas",a.github_api); print(f"GitHub commit: {gh['commit']}")
    return 0

if __name__=="__main__":sys.exit(main())
