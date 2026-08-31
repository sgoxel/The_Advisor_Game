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

# 15 occupied cells + one intentionally transparent reserve cell.
# Transition assets are symmetric and may be reused across the paired logical lanes.
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
    (3,0,'main_transition_vertical','main_road_transition_vertical'),
    (3,1,'main_transition_horizontal','main_road_transition_horizontal'),
    (3,2,'main_intersection_cross','main_road_intersection_cross'),
]
UNUSED = [{'row':3,'col':3,'reason':'transparent reserve'}]


def texture(draw, points=((48,48),(208,208),(48,208),(208,48))):
    for x,y in points:
        draw.ellipse((x-2,y-2,x+2,y+2), fill=COBBLE)


def draw_tile(kind):
    tile = Image.new('RGBA', (CELL, CELL), (0,0,0,0))
    draw = ImageDraw.Draw(tile, 'RGBA')

    # Paired straight halves deliberately carry no outer-road edge on the shared
    # logical-tile seam, so two adjacent lanes read as one broad surface.
    if kind == 'main_straight_vertical_left':
        draw.rectangle((20,0,255,255), fill=EDGE)
        draw.rectangle((30,0,255,255), fill=CORE)
        draw.rectangle((184,0,255,255), fill=CORE_LIGHT)
    elif kind == 'main_straight_vertical_right':
        draw.rectangle((0,0,235,255), fill=EDGE)
        draw.rectangle((0,0,225,255), fill=CORE)
        draw.rectangle((0,0,71,255), fill=CORE_LIGHT)
    elif kind == 'main_straight_horizontal_top':
        draw.rectangle((0,20,255,255), fill=EDGE)
        draw.rectangle((0,30,255,255), fill=CORE)
        draw.rectangle((0,184,255,255), fill=CORE_LIGHT)
    elif kind == 'main_straight_horizontal_bottom':
        draw.rectangle((0,0,255,235), fill=EDGE)
        draw.rectangle((0,0,255,225), fill=CORE)
        draw.rectangle((0,0,255,71), fill=CORE_LIGHT)
    elif 'turn_' in kind:
        quadrant = kind.split('_')[2]
        starts = {'ne':270, 'es':0, 'sw':90, 'wn':180}
        width = 128 if 'inner' in kind else 112
        bbox = (-128,-128,384,384)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=EDGE, width=width+20)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=CORE, width=width)
        draw.arc(bbox, start=starts[quadrant], end=starts[quadrant]+90, fill=CORE_LIGHT, width=max(28,width//2))
    elif kind == 'main_transition_vertical':
        # Symmetric taper: downstream integration may reuse this same asset for
        # each paired lane while authoritative topology supplies orientation.
        draw.polygon([(20,0),(235,0),(188,255),(68,255)], fill=EDGE)
        draw.polygon([(30,0),(225,0),(178,255),(78,255)], fill=CORE)
        draw.polygon([(96,0),(159,0),(148,255),(108,255)], fill=CORE_LIGHT)
    elif kind == 'main_transition_horizontal':
        draw.polygon([(0,20),(255,68),(255,188),(0,235)], fill=EDGE)
        draw.polygon([(0,30),(255,78),(255,178),(0,225)], fill=CORE)
        draw.polygon([(0,96),(255,108),(255,148),(0,159)], fill=CORE_LIGHT)
    elif kind == 'main_intersection_cross':
        # Symmetric reusable crossing cell for #337's `main-road-intersection` /
        # `cross` semantic. The surface reaches all four cell boundaries, so it
        # can be repeated across the supported 2x2 crossing without square holes.
        draw.rectangle((0,0,255,255), fill=CORE)
        draw.rectangle((0,0,255,17), fill=EDGE)
        draw.rectangle((0,238,255,255), fill=EDGE)
        draw.rectangle((0,0,17,255), fill=EDGE)
        draw.rectangle((238,0,255,255), fill=EDGE)
        draw.rectangle((92,0,163,255), fill=CORE_LIGHT)
        draw.rectangle((0,92,255,163), fill=CORE_LIGHT)
    else:
        raise ValueError(f'unsupported tile kind: {kind}')

    texture(draw)
    return tile


def generate(root):
    atlas = Image.new('RGBA', (ATLAS,ATLAS), (0,0,0,0))
    for row,col,kind,_semantic in CELLS:
        atlas.alpha_composite(draw_tile(kind), (col*CELL,row*CELL))
    atlas.save(root/'main_road_canonical_1024.png', format='PNG', optimize=True, compress_level=9)

    mapping = {
      'version':2,
      'family':'main_road',
      'atlas':{'width':1024,'height':1024,'columns':4,'rows':4,'cellSize':256,'format':'RGBA'},
      'cells':[{'row':r,'col':c,'type':k,'semanticId':s} for r,c,k,s in CELLS],
      'unusedCells':UNUSED,
      'pairingNotes':{
        'vertical':'left/right straight halves deliberately carry road surface to the shared cell seam so the two logical lanes read as one broad north-south road',
        'horizontal':'top/bottom straight halves deliberately carry road surface to the shared cell seam so the two logical lanes read as one broad east-west road',
        'turns':'inner/outer quarter-turn pieces remain presentation-only and consume authoritative topology classification from #337',
        'transitions':'symmetric vertical/horizontal transition assets may be reused across paired lanes to narrow toward ordinary-road connection without adding or deleting route connectivity',
        'intersection':'main_road_intersection_cross is a symmetric reusable crossing treatment for #337 main-road-intersection/cross semantics; topology remains authoritative and #339 chooses placement'
      },
      'readabilityEvidence':{
        'viewports':[
          {'name':'desktop','width':1440,'height':900},
          {'name':'tablet','width':1024,'height':768},
          {'name':'phonePortrait','width':390,'height':844},
          {'name':'phoneLandscape','width':844,'height':390}
        ],
        'representativeCameraZooms':[1.0,2.0,2.6,3.0],
        'designAssessment':'The source remains a fixed 256px semantic cell family with high-contrast outer edge/core separation and no baked biome rectangle. Paired straight seams are core-to-core, the crossing reaches all four edges, and the broad road remains legible when runtime scales the semantic cells across representative desktop/tablet/phone viewports. Runtime projection and 2.6x-neighbor stability remain #339/#329 integration verification, not Designer authority.'
      },
      'notes':'Original terrain-neutral main-road art for #338 T-REV resolution. Transparent RGBA background; 15 occupied cells and one fully transparent reserve cell. Presentation only; no topology/pathfinding authority.'
    }
    (root/'main_road_canonical_1024.cells.json').write_text(json.dumps(mapping, indent=2)+'\n', encoding='utf-8')

if __name__ == '__main__':
    generate(Path(__file__).resolve().parent)
