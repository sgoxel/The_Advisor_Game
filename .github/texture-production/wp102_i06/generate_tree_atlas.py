from __future__ import annotations

import base64
import hashlib
import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PAYLOAD_DIR = ROOT / ".github" / "texture-production" / "wp102_i06"
OUT = ROOT / "textures" / "tiles" / "tree"
OUT.mkdir(parents=True, exist_ok=True)

SEMANTICS = [
    ("oak_broadleaf", "Large mature broadleaf oak with dense rounded natural-green canopy and grounded gnarled trunk."),
    ("spruce_evergreen", "Tall evergreen spruce with layered triangular dark-green needle masses and clear trunk contact."),
    ("willow_drooping", "Mature willow with drooping green foliage and a readable twisted trunk/contact point."),
    ("apple_fruit", "Fruit-bearing deciduous tree with restrained red fruit accents and rounded green canopy."),
    ("maple_green", "Dense medium-height deciduous tree with rounded green canopy and compact trunk contact."),
    ("pine_windswept", "Sparse windswept pine with asymmetrical branch silhouette and readable ground contact."),
    ("sapling_light", "Young light-green sapling with slim trunk and open silhouette."),
    ("dead_leafless", "Leafless dead tree with twisted bare branches and clear gnarled root contact."),
]

parts = sorted(PAYLOAD_DIR.glob("tree_source.b85.part*"))
if not parts:
    raise SystemExit("missing tree source payload chunks")
encoded = "".join(p.read_text(encoding="ascii") for p in parts)
packet = base64.b85decode(encoded.encode("ascii"))
if len(packet) < 5:
    raise SystemExit("invalid payload")
jpeg_len = struct.unpack(">I", packet[:4])[0]
jpeg_bytes = packet[4 : 4 + jpeg_len]
alpha_bytes = packet[4 + jpeg_len :]
if not jpeg_bytes or not alpha_bytes:
    raise SystemExit("incomplete payload")

rgb = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
alpha = Image.open(io.BytesIO(alpha_bytes)).convert("L")
if rgb.size != (1024, 1024) or alpha.size != (1024, 1024):
    raise SystemExit(f"unexpected source dimensions: rgb={rgb.size} alpha={alpha.size}")

atlas = rgb.convert("RGBA")
atlas.putalpha(alpha)
# The source payload was prepared from the accepted, already-normalized coherent atlas.
# Enforce canonical transparent cell boundaries and exact unused-cell transparency.
pix = atlas.load()
for boundary in (256, 512, 768):
    for y in range(1024):
        pix[boundary - 1, y] = (0, 0, 0, 0)
        pix[boundary, y] = (0, 0, 0, 0)
    for x in range(1024):
        pix[x, boundary - 1] = (0, 0, 0, 0)
        pix[x, boundary] = (0, 0, 0, 0)
for row in (2, 3):
    for col in range(4):
        for y in range(row * 256, (row + 1) * 256):
            for x in range(col * 256, (col + 1) * 256):
                pix[x, y] = (0, 0, 0, 0)

atlas_path = OUT / "tree_atlas_1024px.png"
atlas.save(atlas_path, "PNG", optimize=True, compress_level=9)

manifest = {
    "version": 1,
    "family": "tree",
    "atlas": {
        "filename": "tree_atlas_1024px.png",
        "width": 1024,
        "height": 1024,
        "columns": 4,
        "rows": 4,
        "cellSize": 256,
    },
    "tiles": [],
}

descriptions = {
    "version": 1,
    "family": "tree",
    "descriptionFilePurpose": "Human-readable semantic descriptions for each occupied tree tile in the canonical 4x4 Starting Village tree atlas.",
    "tiles": [],
}

for index, (semantic_type, description) in enumerate(SEMANTICS):
    row, col = divmod(index, 4)
    box = (col * 256, row * 256, (col + 1) * 256, (row + 1) * 256)
    tile = atlas.crop(box)
    filename = f"tree_{semantic_type}_256px.png"
    tile_path = OUT / filename
    tile.save(tile_path, "PNG", optimize=True, compress_level=9)
    sha256 = hashlib.sha256(tile_path.read_bytes()).hexdigest()
    manifest["tiles"].append(
        {"row": row, "col": col, "type": semantic_type, "filename": filename, "sha256": sha256}
    )
    descriptions["tiles"].append(
        {"row": row, "col": col, "type": semantic_type, "filename": filename, "description": description}
    )

(OUT / "tree_tiles.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
(OUT / "tree_tiles.descriptions.json").write_text(json.dumps(descriptions, indent=2) + "\n", encoding="utf-8")

PNG_SIG = b"\x89PNG\r\n\x1a\n"
checks: dict[str, object] = {
    "atlas_size": list(atlas.size),
    "atlas_mode": atlas.mode,
    "atlas_png_signature": atlas_path.read_bytes()[:8] == PNG_SIG,
    "atlas_sha256": hashlib.sha256(atlas_path.read_bytes()).hexdigest(),
    "occupied_cells": len(SEMANTICS),
    "unused_cells": 16 - len(SEMANTICS),
    "unused_cells_fully_transparent": True,
    "internal_boundaries_transparent": True,
    "all_slice_sizes_exact": True,
    "all_slice_png_signatures": True,
    "all_slice_identity_exact": True,
    "all_manifest_hashes_match": True,
}

for index in range(len(SEMANTICS), 16):
    row, col = divmod(index, 4)
    cell_alpha = atlas.crop((col * 256, row * 256, (col + 1) * 256, (row + 1) * 256)).getchannel("A")
    if cell_alpha.getbbox() is not None:
        checks["unused_cells_fully_transparent"] = False

atlas_alpha = atlas.getchannel("A")
for boundary in (255, 256, 511, 512, 767, 768):
    if any(atlas_alpha.getpixel((boundary, y)) > 0 for y in range(1024)):
        checks["internal_boundaries_transparent"] = False
    if any(atlas_alpha.getpixel((x, boundary)) > 0 for x in range(1024)):
        checks["internal_boundaries_transparent"] = False

for entry in manifest["tiles"]:
    row, col = entry["row"], entry["col"]
    tile_path = OUT / entry["filename"]
    tile = Image.open(tile_path).convert("RGBA")
    source = atlas.crop((col * 256, row * 256, (col + 1) * 256, (row + 1) * 256))
    if tile.size != (256, 256):
        checks["all_slice_sizes_exact"] = False
    if tile_path.read_bytes()[:8] != PNG_SIG:
        checks["all_slice_png_signatures"] = False
    if tile.tobytes() != source.tobytes():
        checks["all_slice_identity_exact"] = False
    if hashlib.sha256(tile_path.read_bytes()).hexdigest() != entry["sha256"]:
        checks["all_manifest_hashes_match"] = False

failed = [key for key, value in checks.items() if isinstance(value, bool) and not value]
print(json.dumps(checks, indent=2))
if failed:
    raise SystemExit("validation failed: " + ", ".join(failed))
