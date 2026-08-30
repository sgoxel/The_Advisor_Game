#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw
import json

ATLAS = 1024
CELL = 256
CORE = (126, 92, 58, 255)
CORE_LIGHT = (151, 116, 76, 255)
EDGE = (69, 49, 34, 230)
COBBLE = (188, 148, 101, 150)

CELLS = [
    (0,0,'main_straight_vertical_left','main_road_straight_vertical_left'),
    (0,1,'main_straight_vertical_right','main_road_straight_vertical_right'),
    (0,2,'main_straight_horizontal_top','main_road_straight_horizontal_top'),
    (0,3,'main_straight_horizontal_bottom','main_road_straight_horizontal_bottom'),
    (1,0,'main_turn_ne_inner','main_road_turn_ne_inner'),
    (1,1,'main_turn_ne_outer','main_road_turn_ne_outer'),
    (1,2,'main_turn_es_inner','main_road_turn_es_inner'),
    (1,3,'main_turn_es_outer','main_road_turn_es_outer'),
    (2,0,'main_turn_sw_inner','main_road_turn_sw_inner'),
    (2,1,'main_turn_sw_outer','main_road_turn_sw_outer'),
    (2,2,'main_turn_wn_inner','main_road_turn_wn_inner'),
    (2,3,'main_turn_wn_outer','main_road_turn_wn_outer'),
    (3,0,'main_transition_vertical_left','main_road_transition_vertical_left'),
    (3,1,'main_transition_vertical_right','main_road_transition_vertical_right'),
    (3,2,'main_transition_horizontal_top','main_road_transition_horizontal_top'),
    (3,3,'main_transition_horizontal_bottom','main_road_transition_horizontal_bottom'),
]

def draw_tile(kind):
    tile = Image.new('RGBA', (CELL, CELL), (0,0,0,0))
    draw = ImageDraw.Draw(tile, 'RGBA')
    if 'straight_vertical' in kind:
        draw.rectangle((20,0,235,255), fill=EDGE)
        draw.rectangle((30,0,225,255), fill=CORE)
        draw.rectangle((96,0,159,255), fill=CORE_LIGHT)
    elif 'straight_horizontal' in kind:
        draw.rectangle((0,20,255,235), fill=EDGE)
        draw.rectangle((0,30,255,225), fill=CORE)
        draw.rectangle((0,96,255,159), fill=CORE_LIGHT)
    elif 'turn_' in kind:
        quadrant = kind.split('_')[2]
        starts = {'ne':270, 'es':0, 'sw':90, 'wn':180}
        width = 128 if 'inner' in kind else 112
        bbox = (-128,-128,384,384)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=EDGE, width=width+20)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=CORE, width=width)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=CORE_LIGHT, width=max(28,width//2))
    elif 'transition_vertical' in kind:
        draw.polygon([(20,0),(235,0),(188,255),(68,255)], fill=EDGE)
        draw.polygon([(30,0),(225,0),(178,255),(78,255)], fill=CORE)
        draw.polygon([(96,0),(159,0),(148,255),(108,255)], fill=CORE_LIGHT)
    else:
        draw.polygon([(0,20),(255,68),(255,188),(0,235)], fill=EDGE)
        draw.polygon([(0,30),(255,78),(255,178),(0,225)], fill=CORE)
        draw.polygon([(0,96),(255,108),(255,148),(0,159)], fill=CORE_LIGHT)
    for x,y in ((48,48),(208,208),(48,208),(208,48)):
        draw.ellipse((x-2,y-2,x+2,y+2), fill=COBBLE)
    return tile

def generate(root):
    atlas = Image.new('RGBA', (ATLAS,ATLAS), (0,0,0,0))
    for row,col,kind,_semantic in CELLS:
        atlas.alpha_composite(draw_tile(kind), (col*CELL,row*CELL))
    atlas.save(root/'main_road_canonical_1024.png', format='PNG', optimize=True, compress_level=9)
    mapping = {
      'version':1, 'family':'main_road',
      'atlas':{'width':1024,'height':1024,'columns':4,'rows':4,'cellSize':256,'format':'RGBA'},
      'cells':[{'row':r,'col':c,'type':k,'semanticId':s} for r,c,k,s in CELLS],
      'unusedCells':[],
      'pairingNotes':{
        'vertical':'left/right semantic halves align across the shared logical-tile boundary and read as one broad north-south road',
        'horizontal':'top/bottom semantic halves align across the shared logical-tile boundary and read as one broad east-west road',
        'turns':'inner/outer quarter-turn pieces remain presentation-only and require authoritative topology classification from #337',
        'transitions':'transition halves narrow toward ordinary-road connection without adding or deleting route connectivity'
      },
      'notes':'Original terrain-neutral main-road art for #338. Transparent RGBA background. All 16 cells are occupied; no biome pixels are baked into reusable cells.'
    }
    (root/'main_road_canonical_1024.cells.json').write_text(json.dumps(mapping, indent=2)+'\n', encoding='utf-8')

if __name__ == '__main__':
    generate(Path(__file__).resolve().parent)
