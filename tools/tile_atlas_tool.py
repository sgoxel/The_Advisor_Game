#!/usr/bin/env python3
"""The Advisor Game - deterministic 4x4 tile atlas publisher.

Canonical master: 1024x1024 RGBA PNG, 4x4 grid, 256x256 cells.
Derived tiles: crop canonical cell, trim 1px from every edge, resize 254x254 back to 256x256.
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
TRIMMED_SIZE = CELL_SIZE - BORDER_TRIM * 2
SCHEMA_VERSION = 2
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


def default_cells() -> list[dict[str, Any]]:
    return [
        {
            "row": i // GRID,
            "col": i % GRID,
            "semantic_type": "",
            "display_name": "",
            "description": "",
            "category": "",
            "runtime_usage": "",
            "unused": False,
        }
        for i in range(GRID * GRID)
    ]


def load_metadata(path: Path | None) -> list[dict[str, Any]]:
    cells = default_cells()
    if path is None:
        return cells
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("tiles", raw.get("cells", []))
    if not isinstance(raw, list):
        raise ValueError("Metadata JSON must be a list or contain a tiles/cells list.")
    for i, item in enumerate(raw[: GRID * GRID]):
        if isinstance(item, str):
            cells[i]["semantic_type"] = item
            continue
        if not isinstance(item, dict):
            continue
        semantic = item.get("semantic_type", item.get("type", item.get("name", "")))
        cells[i].update(
            {
                "semantic_type": str(semantic or ""),
                "display_name": str(item.get("display_name", item.get("displayName", "")) or ""),
                "description": str(item.get("description", "") or ""),
                "category": str(item.get("category", "") or ""),
                "runtime_usage": str(item.get("runtime_usage", item.get("runtimeUsage", "")) or ""),
                "unused": bool(item.get("unused", False)),
            }
        )
    return cells


def save_metadata(path: Path, family: str, cells: list[dict[str, Any]]) -> None:
    payload = {
        "version": SCHEMA_VERSION,
        "family": safe_name(family),
        "cells": [
            {
                "row": i // GRID,
                "col": i % GRID,
                "semantic_type": str(cell.get("semantic_type", "")).strip(),
                "display_name": str(cell.get("display_name", "")).strip(),
                "description": str(cell.get("description", "")).strip(),
                "category": str(cell.get("category", "")).strip(),
                "runtime_usage": str(cell.get("runtime_usage", "")).strip(),
                "unused": bool(cell.get("unused", False)),
            }
            for i, cell in enumerate(cells[: GRID * GRID])
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def is_fully_transparent(tile: Image.Image) -> bool:
    return tile.getchannel("A").getbbox() is None


def trim_cell_border(tile: Image.Image) -> Image.Image:
    if tile.size != (CELL_SIZE, CELL_SIZE):
        raise ValueError(f"Expected {CELL_SIZE}x{CELL_SIZE} cell, got {tile.size}.")
    inner = tile.crop(
        (BORDER_TRIM, BORDER_TRIM, CELL_SIZE - BORDER_TRIM, CELL_SIZE - BORDER_TRIM)
    )
    return inner.resize((CELL_SIZE, CELL_SIZE), RESAMPLE)


def inspect_source(input_path: Path, mode: str) -> tuple[Image.Image, tuple[int, int], list[bool]]:
    with Image.open(input_path) as image:
        original_size = image.size
        atlas = normalize(image, mode)
    transparent = []
    for index in range(GRID * GRID):
        row, col = divmod(index, GRID)
        box = (
            col * CELL_SIZE,
            row * CELL_SIZE,
            (col + 1) * CELL_SIZE,
            (row + 1) * CELL_SIZE,
        )
        transparent.append(is_fully_transparent(atlas.crop(box)))
    return atlas, original_size, transparent


def validate_metadata(
    family: str,
    cells: list[dict[str, Any]],
    transparent_cells: list[bool] | None = None,
    strict_unused_transparency: bool = False,
) -> list[str]:
    errors: list[str] = []
    normalized_family = safe_name(family)
    if not family.strip() or normalized_family != family.strip().lower():
        errors.append("Family must be a stable lowercase semantic name using letters, numbers, '_' or '-'.")
    if len(cells) != GRID * GRID:
        errors.append("Exactly 16 metadata cells are required.")
        return errors

    seen: dict[str, int] = {}
    for index, cell in enumerate(cells):
        row, col = divmod(index, GRID)
        unused = bool(cell.get("unused", False))
        semantic_raw = str(cell.get("semantic_type", "")).strip()
        description = str(cell.get("description", "")).strip()
        if unused:
            if strict_unused_transparency and transparent_cells is not None and not transparent_cells[index]:
                errors.append(f"Cell {index:02d} (r{row}c{col}) is marked unused but is not fully transparent.")
            continue
        if not semantic_raw:
            errors.append(f"Cell {index:02d} (r{row}c{col}) requires a semantic type.")
            continue
        semantic = safe_name(semantic_raw)
        if semantic != semantic_raw.lower():
            errors.append(
                f"Cell {index:02d} (r{row}c{col}) semantic type must use only lowercase letters, numbers, '_' or '-'."
            )
        if semantic in seen:
            errors.append(
                f"Duplicate semantic type '{semantic}' in cells {seen[semantic]:02d} and {index:02d}."
            )
        else:
            seen[semantic] = index
        if not description:
            errors.append(f"Cell {index:02d} (r{row}c{col}) requires a description.")
    return errors


def _clean_previous_family_tiles(output_dir: Path, family: str) -> None:
    if not output_dir.exists():
        return
    for path in output_dir.glob(f"{family}_*_256px.png"):
        if path.is_file():
            path.unlink()


def process(
    input_path: Path,
    output_dir: Path,
    family: str,
    mode: str = "fit",
    metadata_path: Path | None = None,
    cells: list[dict[str, Any]] | None = None,
    require_metadata: bool = False,
    strict_unused_transparency: bool = False,
) -> dict[str, Any]:
    family = safe_name(family)
    output_dir.mkdir(parents=True, exist_ok=True)
    atlas, original_size, transparent_cells = inspect_source(input_path, mode)
    cell_meta = cells if cells is not None else load_metadata(metadata_path)

    if require_metadata:
        errors = validate_metadata(
            family,
            cell_meta,
            transparent_cells=transparent_cells,
            strict_unused_transparency=strict_unused_transparency,
        )
        if errors:
            raise ValueError("Metadata validation failed:\n- " + "\n- ".join(errors))

    master = output_dir / f"{family}_atlas_1024px.png"
    atlas.save(master, "PNG", optimize=False)
    _clean_previous_family_tiles(output_dir, family)

    manifest_tiles: list[dict[str, Any]] = []
    description_tiles: list[dict[str, Any]] = []

    for index in range(GRID * GRID):
        row, col = divmod(index, GRID)
        box = (
            col * CELL_SIZE,
            row * CELL_SIZE,
            (col + 1) * CELL_SIZE,
            (row + 1) * CELL_SIZE,
        )
        raw_tile = atlas.crop(box)
        transparent = transparent_cells[index]
        meta = cell_meta[index]
        unused = bool(meta.get("unused", False)) or transparent
        semantic = safe_name(str(meta.get("semantic_type", "") or f"tile_{index:02d}"))
        display_name = str(meta.get("display_name", "")).strip()
        description = str(meta.get("description", "")).strip()
        category = str(meta.get("category", "")).strip()
        runtime_usage = str(meta.get("runtime_usage", "")).strip()

        if unused:
            continue

        tile = trim_cell_border(raw_tile)
        filename = f"{family}_{semantic}_256px.png"
        tile_path = output_dir / filename
        tile.save(tile_path, "PNG", optimize=False)

        common = {
            "row": row,
            "col": col,
            "type": semantic,
            "semantic_type": semantic,
            "displayName": display_name,
            "category": category,
            "runtimeUsage": runtime_usage,
            "filename": filename,
        }
        manifest_tiles.append(
            {
                **common,
                "sha256": sha256(tile_path),
                "borderProcessing": {
                    "trimPxEachEdge": BORDER_TRIM,
                    "sourceCellSize": [CELL_SIZE, CELL_SIZE],
                    "trimmedSize": [TRIMMED_SIZE, TRIMMED_SIZE],
                    "outputSize": [CELL_SIZE, CELL_SIZE],
                    "resampling": "LANCZOS",
                },
            }
        )
        description_tiles.append({**common, "description": description})

    manifest = {
        "version": SCHEMA_VERSION,
        "family": family,
        "atlas": {
            "filename": master.name,
            "width": ATLAS_SIZE,
            "height": ATLAS_SIZE,
            "mode": "RGBA",
            "columns": GRID,
            "rows": GRID,
            "cellSize": CELL_SIZE,
            "ordering": "row-major",
            "sha256": sha256(master),
            "sourceWidth": original_size[0],
            "sourceHeight": original_size[1],
            "normalizationMode": mode,
            "normalized": original_size != (ATLAS_SIZE, ATLAS_SIZE),
        },
        "derivedTilePolicy": {
            "adminOverride": True,
            "trimPxEachEdge": BORDER_TRIM,
            "sourceCellSize": [CELL_SIZE, CELL_SIZE],
            "trimmedSize": [TRIMMED_SIZE, TRIMMED_SIZE],
            "resizedOutputSize": [CELL_SIZE, CELL_SIZE],
            "resampling": "LANCZOS",
        },
        "tiles": manifest_tiles,
    }
    descriptions = {
        "version": SCHEMA_VERSION,
        "family": family,
        "descriptionFilePurpose": (
            f"Human-readable presentation metadata for the '{family}' canonical 4x4 atlas. "
            "This metadata is not Simulation authority."
        ),
        "tiles": description_tiles,
    }

    manifest_path = output_dir / f"{family}_tiles.manifest.json"
    descriptions_path = output_dir / f"{family}_tiles.descriptions.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    descriptions_path.write_text(json.dumps(descriptions, indent=2) + "\n", encoding="utf-8")

    return {
        "manifest": manifest,
        "descriptions": descriptions,
        "output_dir": str(output_dir),
        "emitted_count": len(manifest_tiles),
    }


def validate_project_root(project_root: Path) -> None:
    if not project_root.exists() or not project_root.is_dir():
        raise ValueError("Project root does not exist or is not a directory.")
    if not (project_root / "README.md").is_file():
        raise ValueError("Project root must contain README.md.")
    if not (project_root / ".github").exists():
        raise ValueError("Project root must contain the .github directory.")


def publish_to_project(
    input_path: Path,
    project_root: Path,
    family: str,
    mode: str,
    cells: list[dict[str, Any]],
) -> dict[str, Any]:
    validate_project_root(project_root)
    family = safe_name(family)
    target = project_root / "textures" / "tiles" / family
    return process(
        input_path=input_path,
        output_dir=target,
        family=family,
        mode=mode,
        cells=cells,
        require_metadata=True,
        strict_unused_transparency=True,
    )


def launch_gui() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    from PIL import ImageTk

    root = tk.Tk()
    root.title("The Advisor Game - 4x4 Tile Atlas Publisher")
    root.geometry("1120x760")
    root.minsize(980, 680)

    input_var = tk.StringVar()
    output_var = tk.StringVar()
    project_var = tk.StringVar()
    family_var = tk.StringVar(value="tile")
    mode_var = tk.StringVar(value="fit")
    status_var = tk.StringVar(value="Load an atlas to begin.")
    selected_var = tk.IntVar(value=0)
    cells = default_cells()
    transparent_cells = [False] * (GRID * GRID)
    atlas_holder: dict[str, Any] = {"image": None, "photo": None}

    outer = ttk.Frame(root, padding=10)
    outer.pack(fill="both", expand=True)

    top = ttk.Frame(outer)
    top.pack(fill="x")

    def add_path_row(parent, row, label, variable, command):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=variable, width=82).grid(row=row, column=1, sticky="ew", padx=6)
        ttk.Button(parent, text="Browse", command=command).grid(row=row, column=2)
        parent.columnconfigure(1, weight=1)

    def choose_input():
        p = filedialog.askopenfilename(
            filetypes=[("Images", "*.png *.jpg *.jpeg *.webp"), ("All files", "*.*")]
        )
        if not p:
            return
        input_var.set(p)
        if family_var.get() == "tile":
            family_var.set(safe_name(Path(p).stem.replace("_atlas_1024px", "")))
        if not output_var.get():
            output_var.set(str(Path(p).parent / f"{family_var.get()}_tiles"))
        load_preview()

    def choose_output():
        p = filedialog.askdirectory()
        if p:
            output_var.set(p)

    def choose_project():
        p = filedialog.askdirectory()
        if p:
            project_var.set(p)

    add_path_row(top, 0, "Input atlas/image", input_var, choose_input)
    add_path_row(top, 1, "Export folder", output_var, choose_output)
    add_path_row(top, 2, "Project root", project_var, choose_project)

    ttk.Label(top, text="Family").grid(row=3, column=0, sticky="w", pady=3)
    ttk.Entry(top, textvariable=family_var, width=28).grid(row=3, column=1, sticky="w", padx=6)
    ttk.Label(top, text="Normalize").grid(row=3, column=1, sticky="e", padx=(0, 130))
    ttk.Combobox(
        top, textvariable=mode_var, values=("fit", "crop", "stretch"), state="readonly", width=12
    ).grid(row=3, column=2, sticky="w")

    body = ttk.Panedwindow(outer, orient="horizontal")
    body.pack(fill="both", expand=True, pady=(10, 6))

    left = ttk.Frame(body, padding=4)
    right = ttk.Frame(body, padding=8)
    body.add(left, weight=3)
    body.add(right, weight=2)

    canvas_size = 520
    preview = tk.Canvas(left, width=canvas_size, height=canvas_size, bg="#1d1d1d", highlightthickness=0)
    preview.pack(anchor="n")

    def draw_selection():
        preview.delete("selection")
        cell_px = canvas_size / GRID
        idx = selected_var.get()
        row, col = divmod(idx, GRID)
        preview.create_rectangle(
            col * cell_px + 2,
            row * cell_px + 2,
            (col + 1) * cell_px - 2,
            (row + 1) * cell_px - 2,
            outline="#ffffff",
            width=3,
            tags="selection",
        )

    def select_cell(event):
        cell_px = canvas_size / GRID
        col = max(0, min(GRID - 1, int(event.x // cell_px)))
        row = max(0, min(GRID - 1, int(event.y // cell_px)))
        save_editor()
        selected_var.set(row * GRID + col)
        load_editor()
        draw_selection()

    preview.bind("<Button-1>", select_cell)

    cell_label = ttk.Label(right, text="Cell 00 (row 0, col 0)", font=("", 12, "bold"))
    cell_label.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
    unused_var = tk.BooleanVar()
    semantic_var = tk.StringVar()
    display_var = tk.StringVar()
    category_var = tk.StringVar()
    usage_var = tk.StringVar()

    ttk.Checkbutton(right, text="Unused cell", variable=unused_var).grid(row=1, column=0, columnspan=2, sticky="w")
    fields = [
        ("Semantic type *", semantic_var),
        ("Display name", display_var),
        ("Category", category_var),
        ("Runtime usage", usage_var),
    ]
    for row, (label, variable) in enumerate(fields, start=2):
        ttk.Label(right, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(right, textvariable=variable, width=38).grid(row=row, column=1, sticky="ew", pady=3)

    ttk.Label(right, text="Description *").grid(row=6, column=0, sticky="nw", pady=3)
    description_text = tk.Text(right, width=40, height=8, wrap="word")
    description_text.grid(row=6, column=1, sticky="nsew", pady=3)
    right.columnconfigure(1, weight=1)
    right.rowconfigure(6, weight=1)

    nav = ttk.Frame(right)
    nav.grid(row=7, column=0, columnspan=2, sticky="ew", pady=8)

    def save_editor():
        idx = selected_var.get()
        cells[idx] = {
            "row": idx // GRID,
            "col": idx % GRID,
            "semantic_type": semantic_var.get().strip(),
            "display_name": display_var.get().strip(),
            "description": description_text.get("1.0", "end").strip(),
            "category": category_var.get().strip(),
            "runtime_usage": usage_var.get().strip(),
            "unused": bool(unused_var.get()),
        }

    def load_editor():
        idx = selected_var.get()
        cell = cells[idx]
        row, col = divmod(idx, GRID)
        cell_label.configure(
            text=f"Cell {idx:02d} (row {row}, col {col})"
            + (" - transparent" if transparent_cells[idx] else "")
        )
        unused_var.set(bool(cell.get("unused", False)))
        semantic_var.set(str(cell.get("semantic_type", "")))
        display_var.set(str(cell.get("display_name", "")))
        category_var.set(str(cell.get("category", "")))
        usage_var.set(str(cell.get("runtime_usage", "")))
        description_text.delete("1.0", "end")
        description_text.insert("1.0", str(cell.get("description", "")))

    def move(delta):
        save_editor()
        selected_var.set((selected_var.get() + delta) % (GRID * GRID))
        load_editor()
        draw_selection()

    ttk.Button(nav, text="Previous", command=lambda: move(-1)).pack(side="left")
    ttk.Button(nav, text="Next", command=lambda: move(1)).pack(side="left", padx=6)

    def load_preview():
        if not input_var.get():
            return
        try:
            atlas, original_size, transparent = inspect_source(Path(input_var.get()), mode_var.get())
            atlas_holder["image"] = atlas
            transparent_cells[:] = transparent
            preview_img = atlas.resize((canvas_size, canvas_size), RESAMPLE)
            atlas_holder["photo"] = ImageTk.PhotoImage(preview_img)
            preview.delete("all")
            preview.create_image(0, 0, anchor="nw", image=atlas_holder["photo"])
            cell_px = canvas_size / GRID
            for i in range(1, GRID):
                p = i * cell_px
                preview.create_line(p, 0, p, canvas_size, fill="#ffffff", dash=(3, 4))
                preview.create_line(0, p, canvas_size, p, fill="#ffffff", dash=(3, 4))
            for i, is_transparent in enumerate(transparent_cells):
                if is_transparent and not cells[i].get("semantic_type"):
                    cells[i]["unused"] = True
            status_var.set(
                f"Loaded {original_size[0]}x{original_size[1]} -> canonical {ATLAS_SIZE}x{ATLAS_SIZE}."
            )
            load_editor()
            draw_selection()
        except Exception as exc:
            messagebox.showerror("Load error", str(exc))

    def validate_current(strict=False):
        save_editor()
        errors = validate_metadata(
            family_var.get().strip(),
            cells,
            transparent_cells=transparent_cells,
            strict_unused_transparency=strict,
        )
        if errors:
            messagebox.showerror("Metadata validation", "\n".join(f"• {e}" for e in errors))
            return False
        messagebox.showinfo("Metadata validation", "All 16 cells passed validation.")
        return True

    def save_metadata_dialog():
        save_editor()
        p = filedialog.asksaveasfilename(
            defaultextension=".json",
            initialfile=f"{safe_name(family_var.get())}_atlas_metadata.json",
            filetypes=[("JSON", "*.json")],
        )
        if p:
            save_metadata(Path(p), family_var.get(), cells)
            status_var.set(f"Metadata saved: {p}")

    def load_metadata_dialog():
        p = filedialog.askopenfilename(filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if not p:
            return
        loaded = load_metadata(Path(p))
        cells[:] = loaded
        load_editor()
        status_var.set(f"Metadata loaded: {p}")

    actions = ttk.Frame(outer)
    actions.pack(fill="x", pady=(2, 4))
    ttk.Button(actions, text="Load Metadata", command=load_metadata_dialog).pack(side="left")
    ttk.Button(actions, text="Save Metadata", command=save_metadata_dialog).pack(side="left", padx=6)
    ttk.Button(actions, text="Validate Metadata", command=lambda: validate_current(False)).pack(side="left")

    def export_folder():
        try:
            if not input_var.get() or not output_var.get():
                raise ValueError("Select an input image and export folder.")
            save_editor()
            errors = validate_metadata(family_var.get().strip(), cells, transparent_cells)
            if errors:
                raise ValueError("Metadata validation failed:\n- " + "\n- ".join(errors))
            result = process(
                Path(input_var.get()),
                Path(output_var.get()),
                family_var.get(),
                mode_var.get(),
                cells=cells,
                require_metadata=True,
            )
            status_var.set(f"Exported {result['emitted_count']} tile(s) to {result['output_dir']}.")
            messagebox.showinfo("Export complete", status_var.get())
        except Exception as exc:
            messagebox.showerror("Export error", str(exc))

    def publish_project():
        try:
            if not input_var.get() or not project_var.get():
                raise ValueError("Select an input image and project root.")
            save_editor()
            result = publish_to_project(
                Path(input_var.get()),
                Path(project_var.get()),
                family_var.get(),
                mode_var.get(),
                cells,
            )
            status_var.set(
                f"Published {result['emitted_count']} tile(s) to {result['output_dir']}."
            )
            messagebox.showinfo("Project publish complete", status_var.get())
        except Exception as exc:
            messagebox.showerror("Publish error", str(exc))

    ttk.Button(actions, text="Export Folder", command=export_folder).pack(side="right")
    ttk.Button(actions, text="Publish to Project", command=publish_project).pack(side="right", padx=6)
    ttk.Label(outer, textvariable=status_var).pack(fill="x", pady=(2, 0))

    load_editor()
    root.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize, document and publish a 4x4 tile atlas.")
    parser.add_argument("input", nargs="?", type=Path, help="Generated atlas/image")
    parser.add_argument("--output", "-o", type=Path, help="Output directory")
    parser.add_argument("--project-root", type=Path, help="Checked-out project root; publishes to textures/tiles/<family>/")
    parser.add_argument("--family", "-f", default="tile", help="Semantic family prefix")
    parser.add_argument("--mode", choices=("fit", "crop", "stretch"), default="fit")
    parser.add_argument("--metadata", "--semantics", dest="metadata", type=Path, help="Metadata JSON")
    parser.add_argument("--gui", action="store_true", help="Launch GUI")
    args = parser.parse_args()

    if args.gui or args.input is None:
        launch_gui()
        return 0

    cells = load_metadata(args.metadata)
    if args.project_root:
        if args.metadata is None:
            raise SystemExit("--project-root requires --metadata so occupied cells have fixed metadata.")
        result = publish_to_project(args.input, args.project_root, args.family, args.mode, cells)
    else:
        if args.metadata is None:
            raise SystemExit("CLI export requires --metadata. Use --gui for interactive metadata entry.")
        output = args.output or args.input.parent / f"{safe_name(args.family)}_tiles"
        result = process(
            args.input,
            output,
            args.family,
            args.mode,
            cells=cells,
            require_metadata=True,
        )
    print(f"Created {result['emitted_count']} tile(s) in {result['output_dir']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
