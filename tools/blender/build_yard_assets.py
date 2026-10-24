"""Build low-poly yard assets for The Advisor Game with Blender (headless).

Usage (Blender 5.2+):
  blender --background --factory-startup --python tools/blender/build_yard_assets.py -- [out_dir=src/models] [preview_dir]

The game reads the .glb files from src/models (see src/asset-meshes.ts).

Every asset is modelled in real metres (Blender units = metres), +Y up after glTF export, facing +Z
(the game's local "front"), centred on its footprint, flat colours only (no textures), and exported
as one .glb per asset. A Workbench preview PNG per asset is rendered for visual review.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "src/models")
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)

WOOD = (0.545, 0.384, 0.227, 1)
DARK_WOOD = (0.361, 0.251, 0.165, 1)
IRON = (0.204, 0.196, 0.188, 1)
BURLAP = (0.659, 0.565, 0.4, 1)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgba):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.85
    return mat


def add_mesh(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def box(name, size, location, mat, rotation=(0, 0, 0), bevel=0.0):
    """Box in metres; Blender Z is up (exported as glTF +Y)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    obj = add_mesh(name, bm, mat)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), segments=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    obj = add_mesh(name, bm, mat)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def ring(name, radius, thickness, width, location, mat, rotation=(0, 0, 0), segments=16):
    """Closed rim (torus-like ring with a rectangular cross-section)."""
    bm = bmesh.new()
    loops = []
    for r, z in ((radius, width / 2), (radius, -width / 2), (radius - thickness, -width / 2), (radius - thickness, width / 2)):
        loops.append([bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)) for a in (k * 2 * math.pi / segments for k in range(segments))])
    for i in range(4):
        a, b = loops[i], loops[(i + 1) % 4]
        for k in range(segments):
            j = (k + 1) % segments
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = add_mesh(name, bm, mat)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def wheel(name, radius, width, x, y, z, rim_mat, hub_mat, spokes=8):
    """Spoked cart wheel standing upright, axle along X."""
    parts = [ring(name + "_rim", radius, 0.06, width, (x, y, z), rim_mat, rotation=(0, math.pi / 2, 0))]
    parts.append(cylinder(name + "_hub", radius * 0.16, width * 1.6, (x, y, z), hub_mat, rotation=(0, math.pi / 2, 0), segments=8))
    for k in range(spokes // 2):
        angle = k * math.pi / (spokes // 2)
        parts.append(box(f"{name}_spoke{k}", (width * 0.6, 0.035, (radius - 0.03) * 2), (x, y, z), rim_mat, rotation=(angle, 0, 0)))
    return parts


def stick(name, a, b, thickness, mat):
    """Square beam from point a to point b (Blender coordinates)."""
    a, b = Vector(a), Vector(b)
    span = b - a
    obj = box(name, (thickness, span.length, thickness), (a + b) / 2, mat)
    obj.rotation_euler = span.to_track_quat("Y", "Z").to_euler()
    return obj


def log(name, radius, length, location, bark, grain, rotation=(0, 0, 0), segments=6):
    """Round log: bark on the sides, light end grain on both cut faces (two materials, one mesh)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=length)
    bm.normal_update()
    for face in bm.faces:
        face.material_index = 1 if abs(face.normal.z) > 0.9 else 0
    obj = add_mesh(name, bm, bark)
    obj.data.materials.append(grain)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def frustum(name, r0, r1, z0, z1, location, mat, segments=10, cap_top=False):
    """Open tapered band from height z0 (radius r0) to z1 (radius r1); optional top cap."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap_top, cap_tris=False, segments=segments, radius1=r0, radius2=r1, depth=z1 - z0)
    bm.normal_update()
    if cap_top:
        bottom = [f for f in bm.faces if f.normal.z < -0.9]
        bmesh.ops.delete(bm, geom=bottom, context="FACES_ONLY")
    obj = add_mesh(name, bm, mat)
    obj.location = (location[0], location[1], location[2] + (z0 + z1) / 2)
    return obj


def join(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    # Bake every transform into the vertices: the exported node is the identity, so the game can read
    # vertex positions as asset-local metres (origin = footprint centre on the ground).
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return joined


def export(name, obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_materials="EXPORT", export_texcoords=False, export_normals=True)
    mesh = obj.data
    mesh.calc_loop_triangles()
    print(f"ASSET {name}: {len(mesh.loop_triangles)} triangles, {os.path.getsize(path)} bytes -> {path}")
    return path


def preview(name):
    if not PREVIEW:
        return
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 700
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.4
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    # Like the game's oblique Hero camera: from the front-right, ~34 degrees down.
    cam.location = (3.2, -4.6, 3.3)
    cam.rotation_euler = (Vector((0, 0, 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    ground = box("ground", (6, 6, 0.02), (0, 0, -0.01), material("ground", (0.45, 0.55, 0.36, 1)))
    scene.render.filepath = os.path.join(PREVIEW, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)
    bpy.data.objects.remove(cam)


def build_cart():
    """Two-wheeled hand cart, footprint 1.5 m wide x 2.4 m long; shafts point to the game front (Blender -Y)."""
    wood, dark, iron, burlap = material("wood", WOOD), material("dark_wood", DARK_WOOD), material("iron", IRON), material("burlap", BURLAP)
    parts = [box("bed", (1.1, 1.3, 0.07), (0, 0.25, 0.62), wood, bevel=0.01)]
    for side in (-1, 1):
        parts.append(box(f"side{side}", (0.04, 1.3, 0.28), (side * 0.53, 0.25, 0.79), dark, bevel=0.008))
    parts.append(box("back", (1.1, 0.04, 0.28), (0, 0.88, 0.79), dark, bevel=0.008))
    for side in (-1, 1):
        parts += wheel(f"wheel{side}", 0.42, 0.07, side * 0.66, 0.25, 0.42, dark, iron)
    parts.append(cylinder("axle", 0.035, 1.42, (0, 0.25, 0.42), iron, rotation=(0, math.pi / 2, 0), segments=6))
    # Shafts run from under the front of the bed (y -0.35, z 0.6) down to the ground (y -1.1, z 0.04).
    start, end = Vector((0, -0.35, 0.6)), Vector((0, -1.1, 0.04))
    mid, span = (start + end) / 2, end - start
    tilt = math.atan2(span.z, span.y) - math.pi
    for side in (-1, 1):
        parts.append(box(f"shaft{side}", (0.05, span.length + 0.1, 0.05), (side * 0.43, mid.y, mid.z), dark, rotation=(tilt, 0, 0)))
    # A filled sack lying in the cart: a squat tapered bag with a tied neck.
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.24, radius2=0.12, depth=0.5)
    sack = add_mesh("sack", bm, burlap)
    sack.location, sack.rotation_euler = (-0.18, 0.5, 0.86), (0, math.pi / 2, 0.4)
    parts.append(sack)
    return join("cart", parts)


BARK = (0.42, 0.294, 0.18, 1)
END_GRAIN = (0.784, 0.639, 0.427, 1)
BARREL_WOOD = (0.494, 0.345, 0.212, 1)
APPLES = (0.75, 0.24, 0.17, 1)
GRAIN = (0.84, 0.69, 0.3, 1)


def build_woodpile():
    """Stacked split logs under a lean-to roof, a chopping block with an axe; footprint 1.9 m x 1.1 m.

    Game local (x, up, z-front) = Blender (x, z, -y): the stack sits at the back (Blender +y), the block in front-right.
    """
    wood, dark, iron = material("wood", WOOD), material("dark_wood", DARK_WOOD), material("iron", IRON)
    bark, grain = material("bark", BARK), material("end_grain", END_GRAIN)
    parts = []
    # Four rows of logs lying front-to-back, each row one log shorter (a stable pyramid), ends facing the street.
    radius, length = 0.095, 0.55
    for row, count in enumerate((6, 5, 4, 3)):
        for i in range(count):
            x = -0.75 + row * 0.1 + i * 0.2
            parts.append(log(f"log{row}_{i}", radius, length, (x, 0.2, radius + row * 0.165), bark, grain, rotation=(math.pi / 2, 0, 0)))
    # Lean-to: two tall posts at the back, two short at the front, a plank roof sloping to the front.
    for x in (-0.88, 0.32):
        parts.append(box(f"post_back{x}", (0.07, 0.07, 1.16), (x, 0.48, 0.58), dark))
        parts.append(box(f"post_front{x}", (0.07, 0.07, 0.94), (x, -0.12, 0.47), dark))
    parts.append(box("roof", (1.3, 0.74, 0.04), (-0.28, 0.17, 1.07), dark, rotation=(0.32, 0, 0), bevel=0.008))
    for k in range(4):
        parts.append(box(f"roof_plank{k}", (0.012, 0.74, 0.012), (-0.85 + k * 0.38, 0.17, 1.095), wood, rotation=(0.32, 0, 0)))
    # Chopping block (end grain on top) with an axe stuck in it, two split pieces on the ground.
    parts.append(log("block", 0.19, 0.42, (0.62, -0.22, 0.21), bark, grain, segments=8))
    parts.append(box("axe_head", (0.035, 0.17, 0.11), (0.62, -0.25, 0.45), iron))
    parts.append(stick("axe_handle", (0.62, -0.22, 0.44), (0.76, -0.42, 0.8), 0.035, wood))
    parts.append(box("split1", (0.08, 0.3, 0.07), (0.38, -0.42, 0.035), grain, rotation=(0, 0, 0.5)))
    parts.append(box("split2", (0.08, 0.28, 0.07), (0.86, -0.05, 0.035), grain, rotation=(0, 0, -0.3)))
    return join("woodpile", parts)


def barrel(name, x, y, wood, iron, lid):
    """Bulging barrel, 0.8 m tall, max radius 0.26 m, three iron hoops."""
    bands = [(0.22, 0.24, 0.0, 0.05, iron), (0.24, 0.26, 0.05, 0.38, wood), (0.26, 0.26, 0.38, 0.42, iron),
             (0.26, 0.24, 0.42, 0.75, wood), (0.24, 0.22, 0.75, 0.8, iron)]
    parts = [frustum(f"{name}_b{k}", r0, r1, z0, z1, (x, y, 0), mat) for k, (r0, r1, z0, z1, mat) in enumerate(bands)]
    parts.append(cylinder(f"{name}_lid", 0.205, 0.02, (x, y, 0.79), lid, segments=10))
    return parts


def crate(name, x, y, z, wood, produce):
    """Open crate (0.5 x 0.4 x 0.28 m) heaped with produce."""
    return [box(f"{name}_box", (0.5, 0.4, 0.28), (x, y, z + 0.14), wood, bevel=0.01),
            box(f"{name}_heap", (0.44, 0.34, 0.06), (x, y, z + 0.29), produce, bevel=0.02)]


def build_barrels(variant):
    """Barrels by the house wall; footprint 1.3 m x 0.9 m. Variant 1: three barrels and an apple crate;
    variant 2: two barrels, a grain crate and a bucket in front."""
    wood, dark, iron = material("barrel_wood", BARREL_WOOD), material("dark_wood", DARK_WOOD), material("iron", IRON)
    crate_wood = material("wood", WOOD)
    parts = []
    if variant == 1:
        for k, x in enumerate((-0.38, 0.0, 0.38)):
            parts += barrel(f"barrel{k}", x, 0.1 if k % 2 == 0 else -0.08, wood, iron, dark)
        parts += crate("crate", 0.38, 0.1, 0.8, crate_wood, material("apples", APPLES))
    else:
        for k, x in enumerate((-0.3, 0.3)):
            parts += barrel(f"barrel{k}", x, 0.12, wood, iron, dark)
        parts += crate("crate", -0.3, 0.12, 0.8, crate_wood, material("grain", GRAIN))
        parts.append(frustum("bucket", 0.11, 0.14, 0.0, 0.26, (0.02, -0.3, 0), wood, segments=8, cap_top=False))
        parts.append(cylinder("bucket_floor", 0.11, 0.02, (0.02, -0.3, 0.02), dark, segments=8))
        parts.append(frustum("bucket_hoop", 0.135, 0.142, 0.18, 0.21, (0.02, -0.3, 0), iron, segments=8))
    return join("barrels", parts)


LINEN = (0.93, 0.91, 0.85, 1)
CREAM = (0.89, 0.82, 0.66, 1)
RED_CLOTH = (0.66, 0.24, 0.2, 1)
BLUE_CLOTH = (0.29, 0.4, 0.6, 1)
GREEN_CLOTH = (0.42, 0.55, 0.32, 1)
BROWN_CLOTH = (0.45, 0.33, 0.22, 1)
OCHRE_CLOTH = (0.78, 0.66, 0.38, 1)
ROPE = (0.82, 0.8, 0.74, 1)
WALL_PLANK = (0.6, 0.45, 0.28, 1)
ROOF_RED = (0.47, 0.28, 0.2, 1)
HEN_COLOURS = [(0.95, 0.94, 0.9, 1), (0.66, 0.42, 0.22, 1), (0.22, 0.2, 0.19, 1)]
COMB = (0.78, 0.15, 0.12, 1)
BEAK = (0.9, 0.68, 0.2, 1)
TERRACOTTA = (0.71, 0.4, 0.27, 1)
LEAF = (0.3, 0.48, 0.22, 1)
FLOWER_PINK = (0.89, 0.45, 0.6, 1)
FLOWER_YELLOW = (0.96, 0.82, 0.3, 1)
WICKER = (0.74, 0.6, 0.38, 1)


def cloth(name, kind, x, y, top, mat, peg):
    """Laundry hanging from a line at height `top`, facing the front: sheet, towel, shirt or trousers."""
    parts = []
    if kind == "sheet":
        parts.append(box(name, (0.62, 0.02, 0.78), (x, y, top - 0.39), mat))
    elif kind == "towel":
        parts.append(box(name, (0.36, 0.02, 0.5), (x, y, top - 0.25), mat))
    elif kind == "shirt":
        parts.append(box(name + "_body", (0.34, 0.025, 0.5), (x, y, top - 0.25), mat))
        for side in (-1, 1):
            parts.append(box(f"{name}_sleeve{side}", (0.12, 0.025, 0.3), (x + side * 0.22, y, top - 0.13), mat, rotation=(0, side * 0.5, 0)))
    elif kind == "trousers":
        parts.append(box(name + "_waist", (0.34, 0.025, 0.14), (x, y, top - 0.07), mat))
        for side in (-1, 1):
            parts.append(box(f"{name}_leg{side}", (0.15, 0.025, 0.56), (x + side * 0.095, y, top - 0.42), mat))
    for side in (-1, 1):
        parts.append(box(f"{name}_peg{side}", (0.025, 0.035, 0.07), (x + side * 0.12, y, top + 0.01), peg))
    return parts


def build_washline(variant):
    """Washing line between two T-posts with laundry; footprint 3.2 m x 0.5 m."""
    dark, peg, rope = material("dark_wood", DARK_WOOD), material("wood", WOOD), material("rope", ROPE)
    parts = []
    for side in (-1, 1):
        parts.append(box(f"post{side}", (0.08, 0.08, 1.9), (side * 1.5, 0, 0.95), dark))
        parts.append(box(f"cross{side}", (0.06, 0.42, 0.06), (side * 1.5, 0, 1.82), dark))
        parts.append(stick(f"brace{side}", (side * 1.5, 0, 1.55), (side * 1.5, 0.17, 1.8), 0.035, dark))
    lines = (-0.15, 0.15)
    for k, y in enumerate(lines):
        parts.append(box(f"line{k}", (3.0, 0.012, 0.012), (0, y, 1.8), rope))
    if variant == 1:
        laundry = [("sheet", -0.95, lines[0], LINEN), ("shirt", -0.15, lines[0], BLUE_CLOTH), ("trousers", 0.45, lines[0], BROWN_CLOTH),
                   ("towel", 1.05, lines[0], RED_CLOTH), ("towel", -0.5, lines[1], CREAM), ("sheet", 0.6, lines[1], LINEN)]
    else:
        laundry = [("shirt", -1.0, lines[0], LINEN), ("towel", -0.45, lines[0], GREEN_CLOTH), ("sheet", 0.3, lines[0], CREAM),
                   ("shirt", 1.05, lines[0], RED_CLOTH), ("trousers", -0.8, lines[1], BLUE_CLOTH), ("towel", 0.85, lines[1], OCHRE_CLOTH)]
    for k, (kind, x, y, colour) in enumerate(laundry):
        parts += cloth(f"cloth{k}", kind, x, y, 1.79, material(f"cloth{k}_{variant}", colour), peg)
    return join("washline", parts)


def gable_roof(name, w, d, h, location, roof_mat, gable_mat, overhang=0.08):
    """Pitched roof with its ridge along X: two slopes (roof material) and two gable triangles (wall material)."""
    bm = bmesh.new()
    hw, hd = w / 2, d / 2
    ends = []
    for x, o in ((-hw, -overhang), (hw, overhang)):
        ends.append((bm.verts.new((x + o, -hd - overhang, 0)), bm.verts.new((x + o, hd + overhang, 0)), bm.verts.new((x + o, 0, h))))
    gables = []
    for x in (-hw, hw):
        gables.append((bm.verts.new((x, -hd, 0)), bm.verts.new((x, hd, 0)), bm.verts.new((x, 0, h - 0.04))))
    (a0, a1, a2), (b0, b1, b2) = ends
    bm.faces.new((a0, b0, b2, a2))
    bm.faces.new((b1, a1, a2, b2))
    g0, g1 = gables
    f = bm.faces.new((g0[1], g0[0], g0[2]))
    f.material_index = 1
    f = bm.faces.new((g1[0], g1[1], g1[2]))
    f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = add_mesh(name, bm, roof_mat)
    obj.data.materials.append(gable_mat)
    obj.location = location
    return obj


def hen(name, x, y, yaw, colour):
    """Low-poly hen (~80 triangles), 0.3 m long, facing yaw (radians about Z)."""
    body_mat, comb, beak = material(f"hen_{colour}", colour), material("comb", COMB), material("beak", BEAK)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=1)
    bmesh.ops.scale(bm, vec=(0.11, 0.16, 0.11), verts=bm.verts)
    body = add_mesh(name + "_body", bm, body_mat)
    body.location = (0, 0, 0.13)
    parts = [body,
             box(name + "_head", (0.07, 0.08, 0.09), (0, -0.15, 0.25), body_mat),
             box(name + "_comb", (0.02, 0.06, 0.04), (0, -0.15, 0.31), comb),
             box(name + "_beak", (0.03, 0.04, 0.025), (0, -0.21, 0.24), beak),
             box(name + "_tail", (0.06, 0.1, 0.1), (0, 0.15, 0.22), body_mat, rotation=(-0.6, 0, 0))]
    for side in (-1, 1):
        parts.append(box(f"{name}_leg{side}", (0.015, 0.015, 0.06), (side * 0.04, 0, 0.03), beak))
    pivot = bpy.data.objects.new(name + "_pivot", None)
    bpy.context.collection.objects.link(pivot)
    for part in parts:
        part.parent = pivot
    pivot.location, pivot.rotation_euler = (x, y, 0), (0, 0, yaw)
    bpy.context.view_layer.update()
    for part in parts:
        world = part.matrix_world.copy()
        part.parent = None
        part.matrix_world = world
    bpy.data.objects.remove(pivot)
    return parts


def build_coop():
    """Hen house on short legs with a pitched roof, ramp and nest box, a fenced run and three hens;
    footprint 2.6 m x 2.2 m. Game front (+Z) = Blender -Y."""
    planks, dark, roof, wood = material("wall_plank", WALL_PLANK), material("dark_wood", DARK_WOOD), material("roof_red", ROOF_RED), material("wood", WOOD)
    hx, hy = -0.45, 0.45
    parts = [box("house", (1.0, 0.8, 0.6), (hx, hy, 0.65), planks, bevel=0.01)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box(f"leg{sx}{sy}", (0.06, 0.06, 0.36), (hx + sx * 0.44, hy + sy * 0.34, 0.18), dark))
    parts.append(gable_roof("roof", 1.0, 0.8, 0.38, (hx, hy, 0.95), roof, planks))
    parts.append(box("door", (0.22, 0.02, 0.28), (hx + 0.2, hy - 0.41, 0.55), dark))
    parts.append(stick("ramp", (hx + 0.2, hy - 0.42, 0.4), (hx + 0.2, hy - 0.95, 0.02), 0.03, wood))
    parts[-1].scale = (6, 1, 1)
    parts.append(box("nest_box", (0.22, 0.5, 0.3), (hx - 0.6, hy, 0.6), planks))
    parts.append(box("nest_lid", (0.26, 0.54, 0.03), (hx - 0.6, hy, 0.77), roof, rotation=(0, -0.35, 0)))
    # Fenced run: posts around the yard, two rails.
    xs, ys = (-1.25, 0.0, 1.25), (-1.05, 0.0, 1.05)
    corners = [(-1.25, -1.05), (1.25, -1.05), (1.25, 1.05), (-1.25, 1.05)]
    for k, (x, y) in enumerate([(x, y) for x in xs for y in ys if abs(x) == 1.25 or abs(y) == 1.05]):
        parts.append(box(f"fpost{k}", (0.05, 0.05, 0.62), (x, y, 0.31), dark))
    for k in range(4):
        (x0, y0), (x1, y1) = corners[k], corners[(k + 1) % 4]
        for z in (0.28, 0.56):
            parts.append(stick(f"rail{k}_{z}", (x0, y0, z), (x1, y1, z), 0.03, wood))
    parts.append(box("trough", (0.5, 0.14, 0.08), (0.55, 0.6, 0.04), dark))
    parts.append(box("feed", (0.44, 0.1, 0.02), (0.55, 0.6, 0.085), material("grain", GRAIN)))
    for k, (x, y, yaw) in enumerate(((0.35, -0.45, 0.6), (0.85, 0.15, -1.9), (-0.05, -0.75, 2.6))):
        parts += hen(f"hen{k}", x, y, yaw, HEN_COLOURS[k])
    return join("coop", parts)


def build_door_bench(variant):
    """Bench by the front door with a backrest; variant 1 adds a flower pot, variant 2 a basket and a broom.
    Footprint 2.6 m x 0.6 m; the house wall is behind (Blender +Y)."""
    wood, dark = material("wood", WOOD), material("dark_wood", DARK_WOOD)
    bx = -0.4
    parts = [box("seat", (1.4, 0.36, 0.05), (bx, 0.02, 0.45), wood, bevel=0.008)]
    for sx in (-1, 1):
        parts.append(box(f"leg_front{sx}", (0.06, 0.06, 0.43), (bx + sx * 0.6, -0.12, 0.215), dark))
        parts.append(box(f"leg_back{sx}", (0.06, 0.06, 0.9), (bx + sx * 0.6, 0.17, 0.45), dark))
        parts.append(box(f"arm{sx}", (0.06, 0.38, 0.04), (bx + sx * 0.66, 0.02, 0.66), dark))
        parts.append(box(f"arm_post{sx}", (0.04, 0.04, 0.2), (bx + sx * 0.66, -0.14, 0.56), dark))
    for k, z in enumerate((0.62, 0.78)):
        parts.append(box(f"back{k}", (1.3, 0.03, 0.1), (bx, 0.18, z), wood, bevel=0.005))
    if variant == 1:
        pot = material("terracotta", TERRACOTTA)
        parts.append(frustum("pot", 0.17, 0.22, 0.0, 0.36, (0.95, 0.0, 0), pot, segments=8))
        parts.append(cylinder("pot_soil", 0.2, 0.02, (0.95, 0.0, 0.34), material("soil", (0.3, 0.21, 0.14, 1)), segments=8))
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.22)
        bush = add_mesh("bush", bm, material("leaf", LEAF))
        bush.location, bush.scale = (0.95, 0.0, 0.52), (1, 1, 0.8)
        parts.append(bush)
        for k, (dx, dy, dz, col) in enumerate(((0.1, -0.12, 0.66, FLOWER_PINK), (-0.12, -0.08, 0.62, FLOWER_YELLOW), (0.02, -0.18, 0.55, FLOWER_PINK), (-0.05, 0.08, 0.7, FLOWER_YELLOW))):
            parts.append(box(f"flower{k}", (0.07, 0.07, 0.05), (0.95 + dx, dy, dz), material(f"flower{k % 2}", col)))
    else:
        wicker = material("wicker", WICKER)
        parts.append(frustum("basket", 0.16, 0.2, 0.0, 0.24, (0.8, -0.02, 0), wicker, segments=8))
        parts.append(cylinder("basket_floor", 0.16, 0.02, (0.8, -0.02, 0.03), dark, segments=8))
        parts.append(box("basket_apples", (0.24, 0.24, 0.05), (0.8, -0.02, 0.2), material("apples", APPLES), rotation=(0, 0, 0.4)))
        parts.append(stick("broom_handle", (1.12, 0.2, 0.18), (1.2, 0.26, 1.15), 0.03, wood))
        # Straw brush: narrow at the binding, fanning out to the floor.
        straw = material("straw", OCHRE_CLOTH)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.16, radius2=0.04, depth=0.26)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 4, 3, "Z"), verts=bm.verts)
        bmesh.ops.scale(bm, vec=(1, 0.35, 1), verts=bm.verts)
        brush = add_mesh("broom_brush", bm, straw)
        brush.location, brush.rotation_euler = (1.11, 0.19, 0.13), (0, -0.08, 0)
        parts.append(brush)
        parts.append(box("broom_band", (0.07, 0.06, 0.05), (1.12, 0.195, 0.27), dark, rotation=(0, -0.08, 0)))
    return join("door-bench", parts)


ASSETS = {
    "cart": build_cart,
    "woodpile": build_woodpile,
    "barrels": lambda: build_barrels(1),
    "barrels_v2": lambda: build_barrels(2),
    "washline": lambda: build_washline(1),
    "washline_v2": lambda: build_washline(2),
    "coop": build_coop,
    "door-bench": lambda: build_door_bench(1),
    "door-bench_v2": lambda: build_door_bench(2),
}

for asset_name, builder in ASSETS.items():
    reset()
    built = builder()
    export(asset_name, built)
    preview(asset_name)
