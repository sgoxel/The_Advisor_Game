#!/usr/bin/env bash
set -euo pipefail
: "${SOURCE_SHA:?SOURCE_SHA must identify the exact tested commit}"

python3 -m venv .venv-wp-s004
. .venv-wp-s004/bin/activate
python -m pip install playwright==1.63.0 pillow
python -m playwright install chromium
npm run dev -- --port 4174 > /tmp/wp-s004-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:4174/ >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:4174/ >/dev/null

INIT='Promise.all([import("/src/geography.ts"),import("/src/settlement-exterior.ts"),import("/src/world.ts"),import("/src/planet.ts")]).then(([g,s,w,p])=>{window.__samples={};for(const a of ["green","roadside","riverside","dispersed-farming"]){const v=g.villages.find(v=>s.settlementExteriorFor(v).archetype===a);if(!v)throw new Error("missing archetype "+a);window.__samples[a]={v,plan:s.settlementExteriorFor(v)}};const cv=g.cities.find(v=>["market-trade","fortified-frontier"].includes(s.settlementExteriorFor(v).archetype))||g.cities[0];window.__samples.city={v:cv,plan:s.settlementExteriorFor(cv)};window.__feature=(sample,predicate,label)=>{for(const plot of sample.plan.plots.filter(predicate)){for(const c of plot.candidates){const t=w.tileForPosition(c.x,c.z,8),f=w.featuresFor(t).find(f=>f.code.includes(sample.v.id)&&f.code.includes(plot.id));if(f)return f}}throw new Error("unresolved "+label)};window.__service=(sample,name)=>window.__feature(sample,q=>q.service===name,name);window.__plot=(sample,kind)=>window.__feature(sample,q=>q.kind===kind,kind);window.__focus=(x,z,h)=>{const ll=p.sourceToLonLat(x,z);window.advisorWorld.navigation.setFocus(ll.lon,ll.lat);window.advisorWorld.setHalfHeight(h)}})'
INIT_ESCAPED=${INIT//;/\;}
DESKTOP="eval:${INIT_ESCAPED};eval:(x=>window.__focus(x.v.x,x.v.z,125))(window.__samples.green);settle;shot:village-green;eval:(x=>window.__focus(x.v.x,x.v.z,78))(window.__samples.green);settle;shot:village-green-detail;eval:(x=>window.__focus(x.v.x,x.v.z,125))(window.__samples.roadside);settle;shot:village-roadside;eval:(x=>window.__focus(x.v.x,x.v.z,130))(window.__samples.riverside);settle;shot:village-riverside;eval:(x=>window.__focus(x.v.x,x.v.z,145))(window.__samples[\"dispersed-farming\"]);settle;shot:village-farming;eval:(x=>window.__focus(x.v.x,x.v.z,430))(window.__samples.city);settle;shot:city-district;eval:(f=>window.__focus(f.x,f.z,46))(window.__service(window.__samples.green,\"market\"));settle;shot:market-close;eval:(f=>window.__focus(f.x,f.z,42))(window.__service(window.__samples.green,\"blacksmith\"));settle;shot:blacksmith-close;eval:(f=>window.__focus(f.x,f.z,52))(window.__service(window.__samples[\"dispersed-farming\"],\"farmstead\"));settle;shot:farmstead-close;eval:(f=>window.__focus(f.x,f.z,44))(window.__service(window.__samples.green,\"merchant\"));settle;shot:merchant-close;eval:(f=>window.__focus(f.x,f.z,48))(window.__service(window.__samples.green,\"headman\"));settle;shot:headman-close;eval:(f=>window.__focus(f.x,f.z,36))(window.__plot(window.__samples.green,\"garden\"));settle;shot:garden-path-close"
PHONE="eval:${INIT_ESCAPED};eval:(x=>window.__focus(x.v.x,x.v.z,130))(window.__samples.green);settle;shot:village-mobile;eval:(x=>window.__focus(x.v.x,x.v.z,135))(window.__samples.riverside);settle;shot:riverside-mobile;eval:(f=>window.__focus(f.x,f.z,45))(window.__service(window.__samples.green,\"market\"));settle;shot:market-mobile;eval:(f=>window.__focus(f.x,f.z,46))(window.__service(window.__samples.green,\"headman\"));settle;shot:headman-mobile"

for R in webgpu webgl2; do
  python tools/screenshot_tool.py http://127.0.0.1:4174/ --out "test-results/wp-s004-${R}-desktop" --name settlement --profile desktop --renderer "$R" --timeout 360 --steps "$DESKTOP"
  python tools/screenshot_tool.py http://127.0.0.1:4174/ --out "test-results/wp-s004-${R}-mobile" --name settlement --profile phone,phone-landscape --renderer "$R" --timeout 360 --steps "$PHONE"
done

python - <<'PY'
import json
from pathlib import Path
captures=list(Path('test-results').glob('wp-s004-webgpu-*/capture.json'))
if not captures: raise SystemExit('no WebGPU capture metadata')
for path in captures:
    records=json.loads(path.read_text())
    assert records and all(r.get('backend')=='webgpu' and not r.get('webgpuFellBack') for r in records), (path, records)
PY
python - <<'PY'
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math, os
files=sorted(Path('test-results').glob('wp-s004-*/*.png'))
if not files: raise SystemExit('no WP-S004 screenshots captured')
source=os.environ['SOURCE_SHA']; W,H=1600,1120; font=ImageFont.load_default(); pages=[]
for page_index in range(math.ceil(len(files)/4)):
    page=Image.new('RGB',(W,H),'white'); draw=ImageDraw.Draw(page)
    draw.text((20,12),f'WP-S004-001-001 fresh evidence · exact head {source} · page {page_index+1}',fill='black',font=font)
    for slot,file in enumerate(files[page_index*4:(page_index+1)*4]):
        image=Image.open(file).convert('RGB'); image.thumbnail((780,480))
        col,row=slot%2,slot//2; x,y=10+col*795,50+row*530
        draw.text((x,y),str(file.relative_to('test-results')),fill='black',font=font); page.paste(image,(x,y+24))
    pages.append(page)
out=Path('test-results/wp-s004-contact-sheet'); out.mkdir(parents=True,exist_ok=True)
pdf=out/f'evidence-{source}.pdf'; pages[0].save(pdf,save_all=True,append_images=pages[1:],resolution=110)
print(pdf)
PY
