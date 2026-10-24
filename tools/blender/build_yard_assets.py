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
from mathutils import Vector

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


ASSETS = {"cart": build_cart}

for asset_name, builder in ASSETS.items():
    reset()
    built = builder()
    export(asset_name, built)
    preview(asset_name)
