#!/usr/bin/env python3
"""The Advisor Game - deterministic 4x4 tile atlas normalizer and slicer.

Canonical master: 1024x1024 RGBA PNG, 4x4 grid, 256x256 cells.
Derived tiles: crop each canonical cell, trim 1px from every edge, then resize 254x254 back to 256x256.
Requires Pillow: python -m pip install Pillow
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required. Install it with: python -m pip install Pillow") from exc

ATLAS_SIZE = 1024
GRID = 4
CELL_SIZE = 256
BORDER_TRIM = 1
TRIMMED_SIZE = CELL_SIZE - (BORDER_TRIM * 2)
RESAMPLE = Image.Resampling.LANCZOS


def safe_name(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip()).strip("_").lower()
    return value or "tile"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize(image: Image.Image, mode: str) -> Image.Image:
    src = image.convert("RGBA")
    if src.size == (ATLAS_SIZE, ATLAS_SIZE):
        return src
    if mode == "stretch":
        return src.resize((ATLAS_SIZE, ATLAS_SIZE), RESAMPLE)
    if mode == "crop":
        scale = max(ATLAS_SIZE / src.width, ATLAS_SIZE / src.height)
        size = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
        resized = src.resize(size, RESAMPLE)
        left = (resized.width - ATLAS_SIZE) // 2
        top = (resized.height - ATLAS_SIZE) // 2
        return resized.crop((left, top, left + ATLAS_SIZE, top + ATLAS_SIZE))
    scale = min(ATLAS_SIZE / src.width, ATLAS_SIZE / src.height)
    size = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
    resized = src.resize(size, RESAMPLE)
    canvas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((ATLAS_SIZE - resized.width) // 2, (ATLAS_SIZE - resized.height) // 2))
    return canvas


def load_semantics(path: Path | None) -> list[dict[str, str]]:
    defaults = [{"semantic_type": f"tile_{i:02d}", "description": ""} for i in range(16)]
    if path is None:
        return defaults
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("tiles", raw.get("cells", []))
    if not isinstance(raw, list):
        raise ValueError("Semantic JSON must be a list or contain a tiles/cells list.")
    for i, item in enumerate(raw[:16]):
        if isinstance(item, str):
            defaults[i] = {"semantic_type": item, "description": ""}
        elif isinstance(item, dict):
            defaults[i] = {
                "semantic_type": str(item.get("semantic_type", item.get("name", defaults[i]["semantic_type"]))),
                "description": str(item.get("description", "")),
            }
    return defaults


def is_fully_transparent(tile: Image.Image) -> bool:
    return tile.getchannel("A").getbbox() is None


def trim_cell_border(tile: Image.Image) -> Image.Image:
    """Discard 1px on all four cell edges and restore exact 256x256 output size."""
    if tile.size != (CELL_SIZE, CELL_SIZE):
        raise ValueError(f"Expected {CELL_SIZE}x{CELL_SIZE} cell, got {tile.size}.")
    inner = tile.crop((BORDER_TRIM, BORDER_TRIM, CELL_SIZE - BORDER_TRIM, CELL_SIZE - BORDER_TRIM))
    return inner.resize((CELL_SIZE, CELL_SIZE), RESAMPLE)


def process(input_path: Path, output_dir: Path, family: str, mode: str = "fit",
            semantics_path: Path | None = None, skip_transparent: bool = True) -> dict[str, Any]:
    family = safe_name(family)
    output_dir.mkdir(parents=True, exist_ok=True)
    semantics = load_semantics(semantics_path)
    with Image.open(input_path) as image:
        atlas = normalize(image, mode)
    master = output_dir / f"{family}_atlas_1024px.png"
    atlas.save(master, "PNG", optimize=False)

    tiles = []
    descriptions = []
    for index in range(16):
        row, col = divmod(index, GRID)
        box = (col * CELL_SIZE, row * CELL_SIZE, (col + 1) * CELL_SIZE, (row + 1) * CELL_SIZE)
        raw_tile = atlas.crop(box)
        transparent = is_fully_transparent(raw_tile)
        tile = trim_cell_border(raw_tile)
        semantic = safe_name(semantics[index]["semantic_type"])
        filename = f"{family}_{semantic}_256px.png"
        emitted = not (skip_transparent and transparent)
        digest = None
        if emitted:
            path = output_dir / filename
            tile.save(path, "PNG", optimize=False)
            digest = sha256(path)
        record = {
            "index": index, "row": row, "col": col, "semantic_type": semantic,
            "filename": filename if emitted else None, "sha256": digest,
            "fully_transparent": transparent, "emitted": emitted,
            "border_processing": {"trim_px_each_edge": BORDER_TRIM, "intermediate_size": [TRIMMED_SIZE, TRIMMED_SIZE], "output_size": [CELL_SIZE, CELL_SIZE]},
        }
        tiles.append(record)
        descriptions.append({
            "row": row, "col": col, "semantic_type": semantic,
            "filename": filename if emitted else None,
            "description": semantics[index]["description"],
        })

    manifest = {
        "family": family,
        "atlas": {"filename": master.name, "width": 1024, "height": 1024, "mode": "RGBA",
                  "grid_rows": 4, "grid_cols": 4, "cell_width": 256, "cell_height": 256,
                  "ordering": "row-major", "sha256": sha256(master)},
        "normalization_mode": mode,
        "derived_tile_border_policy": {"trim_px_each_edge": BORDER_TRIM, "source_cell_size": [256, 256], "trimmed_size": [254, 254], "resized_output_size": [256, 256], "resampling": "LANCZOS"},
        "tiles": tiles,
    }
    (output_dir / f"{family}_tiles.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output_dir / f"{family}_tiles.descriptions.json").write_text(json.dumps({"family": family, "tiles": descriptions}, indent=2) + "\n", encoding="utf-8")
    return manifest


def launch_gui() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    root = tk.Tk()
    root.title("The Advisor Game - 4x4 Tile Atlas Tool")
    root.resizable(False, False)
    input_var, output_var, family_var = tk.StringVar(), tk.StringVar(), tk.StringVar(value="tile")
    mode_var, semantics_var = tk.StringVar(value="fit"), tk.StringVar()
    skip_var = tk.BooleanVar(value=True)
    frame = ttk.Frame(root, padding=14); frame.grid()

    def choose_input():
        p = filedialog.askopenfilename(filetypes=[("Images", "*.png *.jpg *.jpeg *.webp"), ("All files", "*.*")])
        if p:
            input_var.set(p)
            if family_var.get() == "tile": family_var.set(safe_name(Path(p).stem.replace("_atlas_1024px", "")))
            if not output_var.get(): output_var.set(str(Path(p).parent / f"{family_var.get()}_tiles"))
    def choose_output():
        p = filedialog.askdirectory()
        if p: output_var.set(p)
    def choose_semantics():
        p = filedialog.askopenfilename(filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if p: semantics_var.set(p)

    rows = [("Input atlas/image", input_var, choose_input), ("Output folder", output_var, choose_output), ("Semantic JSON (optional)", semantics_var, choose_semantics)]
    for r, (label, var, command) in enumerate(rows):
        ttk.Label(frame, text=label).grid(row=r, column=0, sticky="w", pady=4)
        ttk.Entry(frame, textvariable=var, width=58).grid(row=r, column=1, padx=8)
        ttk.Button(frame, text="Browse", command=command).grid(row=r, column=2)
    ttk.Label(frame, text="Family name").grid(row=3, column=0, sticky="w", pady=4)
    ttk.Entry(frame, textvariable=family_var, width=30).grid(row=3, column=1, sticky="w", padx=8)
    ttk.Label(frame, text="Resize mode").grid(row=4, column=0, sticky="w", pady=4)
    ttk.Combobox(frame, textvariable=mode_var, values=("fit", "crop", "stretch"), state="readonly", width=12).grid(row=4, column=1, sticky="w", padx=8)
    ttk.Checkbutton(frame, text="Skip fully transparent cells", variable=skip_var).grid(row=5, column=1, sticky="w", padx=8, pady=4)
    ttk.Label(frame, text="Tile border policy: trim 1px on every edge, then resize 254x254 → 256x256").grid(row=6, column=0, columnspan=3, sticky="w", pady=(8, 2))

    def run():
        try:
            if not input_var.get() or not output_var.get(): raise ValueError("Select an input image and output folder.")
            result = process(Path(input_var.get()), Path(output_var.get()), family_var.get(), mode_var.get(), Path(semantics_var.get()) if semantics_var.get() else None, skip_var.get())
            count = sum(1 for t in result["tiles"] if t["emitted"])
            messagebox.showinfo("Complete", f"Canonical atlas created and {count} border-safe tile PNG(s) emitted.")
        except Exception as exc:
            messagebox.showerror("Error", str(exc))
    ttk.Button(frame, text="Normalize & Slice", command=run).grid(row=7, column=1, sticky="w", padx=8, pady=(12, 2))
    root.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize and slice a 4x4 tile atlas.")
    parser.add_argument("input", nargs="?", type=Path, help="Generated atlas/image")
    parser.add_argument("--output", "-o", type=Path, help="Output directory")
    parser.add_argument("--family", "-f", default="tile", help="Semantic family prefix")
    parser.add_argument("--mode", choices=("fit", "crop", "stretch"), default="fit")
    parser.add_argument("--semantics", type=Path, help="Optional semantic JSON")
    parser.add_argument("--include-transparent", action="store_true", help="Emit fully transparent cells too")
    parser.add_argument("--gui", action="store_true", help="Launch GUI")
    args = parser.parse_args()
    if args.gui or args.input is None:
        launch_gui(); return 0
    output = args.output or args.input.parent / f"{safe_name(args.family)}_tiles"
    result = process(args.input, output, args.family, args.mode, args.semantics, not args.include_transparent)
    print(f"Created {result['atlas']['filename']} and {sum(t['emitted'] for t in result['tiles'])} border-safe tile(s) in {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
