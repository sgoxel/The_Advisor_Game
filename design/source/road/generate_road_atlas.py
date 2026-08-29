#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw
import json, random

ATLAS = 1024
CELL = 256
ROAD_HALF = 40
EDGE = 10
CORE = (137, 105, 70, 255)
CORE_LIGHT = (159, 126, 87, 255)
EDGE_DARK = (76, 58, 43, 230)
RUT = (104, 78, 54, 110)
STONE = (185, 150, 105, 170)

CELLS = [
    (0, 0, 'straight_vertical', 'road_straight_vertical'),
    (0, 1, 'straight_horizontal', 'road_straight_horizontal'),
    (0, 2, 'cross', 'road_cross'),
    (0, 3, 'turn_ne', 'road_turn_ne'),
    (1, 0, 'turn_es', 'road_turn_es'),
    (1, 1, 'turn_sw', 'road_turn_sw'),
    (1, 2, 'turn_wn', 'road_turn_wn'),
    (1, 3, 't_junction', 'road_t_junction'),
]

def centerline(kind):
    c, e = 128, 8
    if kind == 'straight_vertical': return [[(c, -e), (c, 256+e)]]
    if kind == 'straight_horizontal': return [[(-e, c), (256+e, c)]]
    if kind == 'cross': return [[(c, -e), (c, 256+e)], [(-e, c), (256+e, c)]]
    if kind == 't_junction': return [[(-e, c), (256+e, c)], [(c, c), (c, 256+e)]]
    turns = {'turn_ne': ('N','E'), 'turn_es': ('E','S'), 'turn_sw': ('S','W'), 'turn_wn': ('W','N')}
    a, b = turns[kind]
    pts = {'N': (c,-e), 'E': (256+e,c), 'S': (c,256+e), 'W': (-e,c)}
    controls = {
      ('N','E'): ((c,72),(184,c)), ('E','S'): ((184,c),(c,184)),
      ('S','W'): ((c,184),(72,c)), ('W','N'): ((72,c),(c,72)),
    }
    p0,p3=pts[a],pts[b]; p1,p2=controls[(a,b)]
    curve=[]
    for i in range(33):
      t=i/32; u=1-t
      x=u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0]
      y=u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]
      curve.append((round(x),round(y)))
    return [curve]

def draw_tile(kind, seed):
    tile=Image.new('RGBA',(CELL,CELL),(0,0,0,0)); draw=ImageDraw.Draw(tile,'RGBA')
    paths=centerline(kind)
    for pts in paths: draw.line(pts, fill=EDGE_DARK, width=ROAD_HALF*2+EDGE*2, joint='curve')
    for pts in paths: draw.line(pts, fill=CORE, width=ROAD_HALF*2, joint='curve')
    for pts in paths: draw.line(pts, fill=CORE_LIGHT, width=ROAD_HALF, joint='curve')
    rng=random.Random(seed); pix=tile.load()
    for _ in range(16):
      x=rng.randrange(8,248); y=rng.randrange(8,248)
      if pix[x,y][3] < 150: continue
      r=rng.choice([1,2,2]); fill=STONE if rng.random()<0.45 else RUT
      draw.ellipse((x-r,y-r,x+r,y+r), fill=fill)
    if kind=='straight_vertical':
      for off in (-18,18): draw.line([(128+off,0),(128+off,256)], fill=RUT, width=1)
    elif kind=='straight_horizontal':
      for off in (-18,18): draw.line([(0,128+off),(256,128+off)], fill=RUT, width=1)
    return tile

def generate(out_png: Path, out_map: Path):
    atlas=Image.new('RGBA',(ATLAS,ATLAS),(0,0,0,0))
    for index,(row,col,kind,semantic) in enumerate(CELLS):
      atlas.alpha_composite(draw_tile(kind,28100+index),(col*CELL,row*CELL))
    atlas.save(out_png,format='PNG',optimize=True,compress_level=9)
    mapping={
      'version':1,'family':'road',
      'atlas':{'width':1024,'height':1024,'columns':4,'rows':4,'cellSize':256,'format':'RGBA'},
      'cells':[{'row':r,'col':c,'type':k,'semanticId':s} for r,c,k,s in CELLS],
      'unusedCells':[{'row':r,'col':c,'transparent':True} for r in range(4) for c in range(4) if (r,c) not in {(rr,cc) for rr,cc,_,_ in CELLS}],
      'notes':'Terrain-neutral original road art. Unused cells are fully transparent. Edge connections meet at each cell edge midpoint.'
    }
    out_map.write_text(json.dumps(mapping,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    root=Path(__file__).resolve().parent
    generate(root/'road_canonical_1024.png',root/'road_canonical_1024.cells.json')
