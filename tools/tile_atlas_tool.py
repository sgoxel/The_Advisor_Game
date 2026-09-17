#!/usr/bin/env python3
"""The Advisor Game canonical tile atlas tool.

This tool has one production processing path only.

It always:
- reads one source atlas image;
- interprets it as a logical 10x10 grid;
- reconstructs a canonical exact 1000x1000 RGBA atlas;
- repacks every logical source cell into one exact 100x100 target cell;
- emits 100x100 row-major slices with trim 0;
- emits manifest, descriptions, and a machine-readable QA report;
- optionally stages exact outputs into a Drive/repository mirror path.

It never uses legacy alternative processing modes, whole-atlas crop/stretch variants,
or direct GitHub binary publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import re
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageStat
except ImportError as exc:
    raise SystemExit("Pillow required: python -m pip install Pillow") from exc

ATLAS_SIZE = 1000
GRID = 10
CELL_SIZE = 100
SCHEMA_VERSION = 3
QA_SCHEMA_VERSION = 1
TOOL_VERSION = "5.1.0"
RESAMPLE = Image.Resampling.LANCZOS
EDGES = ("left", "top", "right", "bottom")
MANUAL_REVIEW_ITEMS = [
    "top_down_or_orthographic_view",
    "issue_semantic_correctness",
    "visual_style_consistency",
    "gameplay_scale_readability",
]


def safe_name(v: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", v.strip()).strip("_").lower() or "tile"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def default_cells() -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []
    for i in range(GRID * GRID):
        r, c = divmod(i, GRID)
        semantic = f"r{r:02d}_c{c:02d}"
        cells.append(
            {
                "row": r,
                "col": c,
                "semantic_type": semantic,
                "display_name": semantic,
                "description": f"Atlas tile row {r} column {c}.",
                "category": "terrain",
                "runtime_usage": "terrain/base",
                "unused": False,
            }
        )
    return cells


def _normalize_edge_policy(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"all", "*"}:
            return list(EDGES)
        if raw in {"none", "", "no"}:
            return []
        parts = [p.strip().lower() for p in re.split(r"[,|+ ]+", raw) if p.strip()]
    elif isinstance(value, (list, tuple, set)):
        parts = [str(p).strip().lower() for p in value]
    else:
        raise ValueError("edge_policy must be a list/string/all/none")
    invalid = [p for p in parts if p not in EDGES]
    if invalid:
        raise ValueError(f"Invalid edge_policy values: {', '.join(invalid)}")
    return [e for e in EDGES if e in set(parts)]


def load_metadata(path: Path | None) -> list[dict[str, Any]]:
    cells = default_cells()
    if path is None:
        return cells
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw = raw.get("tiles", raw.get("cells", [])) if isinstance(raw, dict) else raw
    if not isinstance(raw, list):
        raise ValueError("Metadata must be a list or contain tiles/cells.")
    for i, item in enumerate(raw[: GRID * GRID]):
        if isinstance(item, str):
            cells[i]["semantic_type"] = item
            continue
        if not isinstance(item, dict):
            continue
        semantic = item.get("semantic_type", item.get("type", item.get("name", cells[i]["semantic_type"])))
        cells[i].update(
            {
                "semantic_type": str(semantic or cells[i]["semantic_type"]),
                "display_name": str(item.get("display_name", item.get("displayName", cells[i]["display_name"])) or ""),
                "description": str(item.get("description", cells[i]["description"]) or ""),
                "category": str(item.get("category", cells[i]["category"]) or ""),
                "runtime_usage": str(item.get("runtime_usage", item.get("runtimeUsage", cells[i]["runtime_usage"])) or ""),
                "unused": bool(item.get("unused", False)),
            }
        )
        if "edge_policy" in item or "edgePolicy" in item:
            cells[i]["edge_policy"] = _normalize_edge_policy(item.get("edge_policy", item.get("edgePolicy")))
        if "fit_policy" in item or "fitPolicy" in item:
            cells[i]["fit_policy"] = str(item.get("fit_policy", item.get("fitPolicy"))).strip().lower()
        if "margin_px" in item or "marginPx" in item:
            cells[i]["margin_px"] = int(item.get("margin_px", item.get("marginPx")))
        if "require_transparency" in item or "requireTransparency" in item:
            cells[i]["require_transparency"] = bool(item.get("require_transparency", item.get("requireTransparency")))
        if "allow_checkerboard" in item or "allowCheckerboard" in item:
            cells[i]["allow_checkerboard"] = bool(item.get("allow_checkerboard", item.get("allowCheckerboard")))
    return cells


def _public_cell(cell: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in cell.items() if not str(k).startswith("_")}


def save_metadata_template(path: Path) -> None:
    payload = {
        "version": SCHEMA_VERSION,
        "grid": [GRID, GRID],
        "tileSize": [CELL_SIZE, CELL_SIZE],
        "notes": [
            "category examples: terrain, floor, structure, wall, threshold, cutaway, prop, furniture, overlay",
            "fit_policy: auto | fill | preserve | contain",
            "edge_policy: all | none | [left, top, right, bottom]",
            "margin_px applies to contain/preserve policies",
            "unused=true forces true transparency in canonical reconstruction",
        ],
        "cells": default_cells(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def validate_metadata(
    family: str,
    cells: list[dict[str, Any]],
    transparent_cells: list[bool] | None = None,
    strict_unused_transparency: bool = False,
) -> list[str]:
    errors: list[str] = []
    if safe_name(family) != family.strip().lower():
        errors.append("Invalid family name.")
    if len(cells) != GRID * GRID:
        return [f"Exactly {GRID * GRID} metadata cells required."]
    seen: dict[str, int] = {}
    for i, cell in enumerate(cells):
        if cell.get("unused"):
            if strict_unused_transparency and transparent_cells is not None and not transparent_cells[i]:
                errors.append(f"Cell {i:03d} unused but not transparent.")
            continue
        raw = str(cell.get("semantic_type", "")).strip()
        semantic = safe_name(raw)
        if not raw:
            errors.append(f"Cell {i:03d} missing semantic type.")
            continue
        if semantic != raw.lower():
            errors.append(f"Cell {i:03d} invalid semantic type.")
        if semantic in seen:
            errors.append(f"Duplicate semantic type '{semantic}'.")
        else:
            seen[semantic] = i
        if "fit_policy" in cell and cell["fit_policy"] not in {"auto", "fill", "contain", "preserve"}:
            errors.append(f"Cell {i:03d} invalid fit_policy '{cell['fit_policy']}'.")
        if "margin_px" in cell:
            margin = int(cell["margin_px"])
            if margin < 0 or margin >= CELL_SIZE // 2:
                errors.append(f"Cell {i:03d} invalid margin_px {margin}.")
        if "edge_policy" in cell:
            try:
                _normalize_edge_policy(cell["edge_policy"])
            except ValueError as exc:
                errors.append(f"Cell {i:03d} {exc}")
    return errors


def _grid_bounds(length: int) -> list[int]:
    bounds = [round(i * length / GRID) for i in range(GRID + 1)]
    bounds[0] = 0
    bounds[-1] = length
    for i in range(1, len(bounds)):
        if bounds[i] <= bounds[i - 1]:
            bounds[i] = min(length, bounds[i - 1] + 1)
    return bounds


def _extract_source_cells(source: Image.Image) -> list[Image.Image]:
    xs = _grid_bounds(source.width)
    ys = _grid_bounds(source.height)
    return [source.crop((xs[c], ys[r], xs[c + 1], ys[r + 1])) for r in range(GRID) for c in range(GRID)]


def _alpha_mask(tile: Image.Image, threshold: int = 1) -> Image.Image:
    alpha = tile.getchannel("A")
    return alpha.point(lambda p: 255 if p >= threshold else 0, mode="L")


def _coverage(tile: Image.Image) -> float:
    stat = ImageStat.Stat(tile.getchannel("A"))
    return float(stat.mean[0] / 255.0)


def _alpha_bbox(tile: Image.Image) -> tuple[int, int, int, int] | None:
    return tile.getchannel("A").getbbox()


def _edge_contact(tile: Image.Image, threshold: int = 8) -> dict[str, float]:
    mask = _alpha_mask(tile, threshold)
    width, height = mask.size
    pixels = mask.load()
    if width <= 0 or height <= 0:
        return {edge: 0.0 for edge in EDGES}
    return {
        "left": sum(1 for y in range(height) if pixels[0, y]) / height,
        "right": sum(1 for y in range(height) if pixels[width - 1, y]) / height,
        "top": sum(1 for x in range(width) if pixels[x, 0]) / width,
        "bottom": sum(1 for x in range(width) if pixels[x, height - 1]) / width,
    }


def _touches_opposite_edges(contact: dict[str, float], threshold: float = 0.08) -> bool:
    return (contact["left"] >= threshold and contact["right"] >= threshold) or (
        contact["top"] >= threshold and contact["bottom"] >= threshold
    )


def _infer_fit_policy(cell: dict[str, Any], tile: Image.Image, metadata_explicit: bool, profile: str) -> str:
    explicit = str(cell.get("fit_policy", "")).strip().lower()
    if explicit:
        return explicit
    category = str(cell.get("category", "")).strip().lower()
    if metadata_explicit:
        if category in {"prop", "furniture", "object", "overlay", "decoration", "decor", "vegetation", "tree", "resource"}:
            return "contain"
        if category in {"terrain", "base", "floor", "ground"}:
            return "fill"
        if category in {"structure", "wall", "threshold", "doorway", "roof", "cutaway", "boundary", "building"}:
            return "preserve"
    else:
        if profile == "terrain":
            return "fill"
        if profile == "overlay":
            return "contain"
        if profile in {"structure", "interior_cutaway"}:
            return "preserve"
    bbox = _alpha_bbox(tile)
    if bbox is None:
        return "contain"
    contact = _edge_contact(tile)
    touched = sum(1 for value in contact.values() if value >= 0.08)
    if _coverage(tile) >= 0.985 or _touches_opposite_edges(contact) or touched >= 3:
        return "preserve"
    return "contain"


def _infer_allowed_edges(cell: dict[str, Any], source_tile: Image.Image, metadata_explicit: bool, profile: str) -> set[str]:
    if "edge_policy" in cell:
        return set(_normalize_edge_policy(cell.get("edge_policy")) or [])
    if metadata_explicit:
        category = str(cell.get("category", "")).strip().lower()
        if category in {"terrain", "base", "floor", "ground"}:
            return set(EDGES)
        if category in {"prop", "furniture", "object", "overlay", "decoration", "decor", "vegetation", "tree", "resource"}:
            return set()
    else:
        if profile == "terrain":
            return set(EDGES)
        if profile == "overlay":
            return set()
    contact = _edge_contact(source_tile)
    return {edge for edge, ratio in contact.items() if ratio >= 0.08}


def _resize_fill(tile: Image.Image) -> tuple[Image.Image, list[str]]:
    source = tile.convert("RGBA")
    bbox = _alpha_bbox(source)
    actions: list[str] = []
    if bbox is None:
        return Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0)), ["empty_cell_preserved"]
    if bbox != (0, 0, source.width, source.height):
        source = source.crop(bbox)
        actions.append("alpha_bbox_crop")
    if source.size != (CELL_SIZE, CELL_SIZE):
        source = source.resize((CELL_SIZE, CELL_SIZE), RESAMPLE)
        actions.append("alpha_crop_filled_to_cell")
    return source, actions


def _contain_rgba(tile: Image.Image, margin_px: int, allowed_edges: set[str], source_contact: dict[str, float]) -> tuple[Image.Image, list[str]]:
    source = tile.convert("RGBA")
    bbox = _alpha_bbox(source)
    actions: list[str] = []
    if bbox is None:
        return Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0)), ["empty_cell_preserved"]
    if bbox != (0, 0, source.width, source.height):
        source = source.crop(bbox)
        actions.append("alpha_bbox_crop")

    left_margin = 0 if "left" in allowed_edges and source_contact["left"] >= 0.08 else margin_px
    right_margin = 0 if "right" in allowed_edges and source_contact["right"] >= 0.08 else margin_px
    top_margin = 0 if "top" in allowed_edges and source_contact["top"] >= 0.08 else margin_px
    bottom_margin = 0 if "bottom" in allowed_edges and source_contact["bottom"] >= 0.08 else margin_px
    max_w = max(1, CELL_SIZE - left_margin - right_margin)
    max_h = max(1, CELL_SIZE - top_margin - bottom_margin)
    scale = min(max_w / source.width, max_h / source.height)
    new_w = max(1, min(max_w, round(source.width * scale)))
    new_h = max(1, min(max_h, round(source.height * scale)))
    resized = source.resize((new_w, new_h), RESAMPLE) if (new_w, new_h) != source.size else source
    if resized.size != tile.size:
        actions.append("contained_to_cell")

    if "left" in allowed_edges and source_contact["left"] >= 0.08:
        x = 0
    elif "right" in allowed_edges and source_contact["right"] >= 0.08:
        x = CELL_SIZE - new_w
    else:
        x = left_margin + max(0, (max_w - new_w) // 2)

    if "top" in allowed_edges and source_contact["top"] >= 0.08:
        y = 0
    elif "bottom" in allowed_edges and source_contact["bottom"] >= 0.08:
        y = CELL_SIZE - new_h
    else:
        y = top_margin + max(0, (max_h - new_h) // 2)

    out = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    out.alpha_composite(resized, (x, y))
    return out, actions


def _render_cell(source_tile: Image.Image, cell: dict[str, Any], metadata_explicit: bool, default_margin_px: int, profile: str) -> tuple[Image.Image, dict[str, Any]]:
    source = source_tile.convert("RGBA")
    source_bbox = _alpha_bbox(source)
    source_contact = _edge_contact(source)
    fit_policy = _infer_fit_policy(cell, source, metadata_explicit, profile)
    allowed_edges = _infer_allowed_edges(cell, source, metadata_explicit, profile)
    margin = int(cell.get("margin_px", default_margin_px))
    margin = max(0, min(CELL_SIZE // 2 - 1, margin))
    actions: list[str] = []

    if cell.get("unused"):
        output = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
        if source_bbox is not None:
            actions.append("unused_cell_forced_transparent")
    elif fit_policy == "fill":
        output, actions = _resize_fill(source)
    elif fit_policy in {"contain", "preserve"}:
        output, actions = _contain_rgba(source, margin, allowed_edges, source_contact)
        if fit_policy == "preserve" and output.getchannel("A").getbbox() is not None:
            actions.append("semantic_edges_anchored")
    else:
        output, actions = _contain_rgba(source, margin, allowed_edges, source_contact)

    if output.size != (CELL_SIZE, CELL_SIZE):
        output = output.crop((0, 0, CELL_SIZE, CELL_SIZE))
        actions.append("hard_clipped_to_cell")

    output_contact = _edge_contact(output)
    output_bbox = _alpha_bbox(output)
    forbidden = {edge: ratio for edge, ratio in output_contact.items() if edge not in allowed_edges and ratio >= 0.01}
    info = {
        "fitPolicy": fit_policy,
        "marginPx": margin,
        "allowedEdges": [edge for edge in EDGES if edge in allowed_edges],
        "sourceSize": [source.width, source.height],
        "sourceAlphaCoverage": round(_coverage(source), 6),
        "sourceAlphaBBox": list(source_bbox) if source_bbox else None,
        "sourceEdgeContact": {k: round(v, 6) for k, v in source_contact.items()},
        "outputAlphaCoverage": round(_coverage(output), 6),
        "outputAlphaBBox": list(output_bbox) if output_bbox else None,
        "outputEdgeContact": {k: round(v, 6) for k, v in output_contact.items()},
        "forbiddenEdgeContact": {k: round(v, 6) for k, v in forbidden.items()},
        "actions": actions,
    }
    return output, info


def _rgb_variance(img: Image.Image) -> float:
    rgb = img.convert("RGB")
    stat = ImageStat.Stat(rgb)
    return float(sum(stat.var) / 3.0)


def _detect_separator_candidates(source: Image.Image) -> list[dict[str, Any]]:
    rgba = source.convert("RGBA")
    xs = _grid_bounds(rgba.width)
    ys = _grid_bounds(rgba.height)
    candidates: list[dict[str, Any]] = []

    def inspect_vertical(x: int, index: int) -> None:
        if x <= 1 or x >= rgba.width - 2:
            return
        line = rgba.crop((x, 0, x + 1, rgba.height))
        left = rgba.crop((x - 2, 0, x - 1, rgba.height))
        right = rgba.crop((x + 1, 0, x + 2, rgba.height))
        alpha_mean = ImageStat.Stat(line.getchannel("A")).mean[0]
        if alpha_mean < 180:
            return
        variance = _rgb_variance(line)
        contrast = sum(abs(a - b) for a, b in zip(ImageStat.Stat(left.convert("RGB")).mean, ImageStat.Stat(right.convert("RGB")).mean)) / 3.0
        if variance < 120 and contrast > 18:
            candidates.append({"orientation": "vertical", "gridBoundary": index, "sourcePixel": x, "variance": round(variance, 3), "contrast": round(contrast, 3)})

    def inspect_horizontal(y: int, index: int) -> None:
        if y <= 1 or y >= rgba.height - 2:
            return
        line = rgba.crop((0, y, rgba.width, y + 1))
        top = rgba.crop((0, y - 2, rgba.width, y - 1))
        bottom = rgba.crop((0, y + 1, rgba.width, y + 2))
        alpha_mean = ImageStat.Stat(line.getchannel("A")).mean[0]
        if alpha_mean < 180:
            return
        variance = _rgb_variance(line)
        contrast = sum(abs(a - b) for a, b in zip(ImageStat.Stat(top.convert("RGB")).mean, ImageStat.Stat(bottom.convert("RGB")).mean)) / 3.0
        if variance < 120 and contrast > 18:
            candidates.append({"orientation": "horizontal", "gridBoundary": index, "sourcePixel": y, "variance": round(variance, 3), "contrast": round(contrast, 3)})

    for i, x in enumerate(xs[1:-1], 1):
        inspect_vertical(x, i)
    for i, y in enumerate(ys[1:-1], 1):
        inspect_horizontal(y, i)
    return candidates


def _checkerboard_score(tile: Image.Image) -> float:
    rgba = tile.convert("RGBA")
    if ImageStat.Stat(rgba.getchannel("A")).mean[0] < 245:
        return 0.0
    rgb = rgba.convert("RGB")
    best = 0.0
    for block in (4, 5, 8, 10, 12, 16):
        if rgb.width < block * 4 or rgb.height < block * 4:
            continue
        groups = [[], []]
        for y in range(0, rgb.height - block + 1, block):
            for x in range(0, rgb.width - block + 1, block):
                mean = ImageStat.Stat(rgb.crop((x, y, x + block, y + block))).mean
                groups[((x // block) + (y // block)) & 1].append(sum(mean) / 3.0)
        if not groups[0] or not groups[1]:
            continue
        m0 = sum(groups[0]) / len(groups[0])
        m1 = sum(groups[1]) / len(groups[1])
        v0 = sum((v - m0) ** 2 for v in groups[0]) / len(groups[0])
        v1 = sum((v - m1) ** 2 for v in groups[1]) / len(groups[1])
        contrast = min(1.0, abs(m0 - m1) / 55.0)
        consistency = 1.0 / (1.0 + (v0 + v1) / 500.0)
        best = max(best, contrast * consistency)
    return round(best, 6)


def _shared_boundary_overlap(a: Image.Image, b: Image.Image, edge_a: str, edge_b: str, threshold: int = 8) -> float:
    ma = _alpha_mask(a, threshold)
    mb = _alpha_mask(b, threshold)
    if edge_a in {"left", "right"}:
        n = min(ma.height, mb.height)
        xa = 0 if edge_a == "left" else ma.width - 1
        xb = 0 if edge_b == "left" else mb.width - 1
        pa, pb = ma.load(), mb.load()
        return sum(1 for y in range(n) if pa[xa, y] and pb[xb, y]) / max(1, n)
    n = min(ma.width, mb.width)
    ya = 0 if edge_a == "top" else ma.height - 1
    yb = 0 if edge_b == "top" else mb.height - 1
    pa, pb = ma.load(), mb.load()
    return sum(1 for x in range(n) if pa[x, ya] and pb[x, yb]) / max(1, n)


def _detect_cross_boundary_candidates(source_cells: list[Image.Image], meta: list[dict[str, Any]], metadata_explicit: bool, profile: str, threshold: float = 0.12) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for r in range(GRID):
        for c in range(GRID - 1):
            a = r * GRID + c
            b = a + 1
            overlap = _shared_boundary_overlap(source_cells[a], source_cells[b], "right", "left")
            if overlap >= threshold:
                edges_a = _infer_allowed_edges(meta[a], source_cells[a], metadata_explicit, profile)
                edges_b = _infer_allowed_edges(meta[b], source_cells[b], metadata_explicit, profile)
                findings.append({"orientation": "vertical", "a": a, "b": b, "overlap": round(overlap, 6), "declaredOrInferredSeam": "right" in edges_a and "left" in edges_b})
    for r in range(GRID - 1):
        for c in range(GRID):
            a = r * GRID + c
            b = (r + 1) * GRID + c
            overlap = _shared_boundary_overlap(source_cells[a], source_cells[b], "bottom", "top")
            if overlap >= threshold:
                edges_a = _infer_allowed_edges(meta[a], source_cells[a], metadata_explicit, profile)
                edges_b = _infer_allowed_edges(meta[b], source_cells[b], metadata_explicit, profile)
                findings.append({"orientation": "horizontal", "a": a, "b": b, "overlap": round(overlap, 6), "declaredOrInferredSeam": "bottom" in edges_a and "top" in edges_b})
    return findings


def _build_canonical_atlas(source: Image.Image, meta: list[dict[str, Any]], metadata_explicit: bool, default_margin_px: int, profile: str) -> tuple[Image.Image, list[Image.Image], list[dict[str, Any]], list[Image.Image]]:
    source_rgba = source.convert("RGBA")
    source_cells = _extract_source_cells(source_rgba)
    rendered_tiles: list[Image.Image] = []
    cell_infos: list[dict[str, Any]] = []
    atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    for i, source_tile in enumerate(source_cells):
        rendered, info = _render_cell(source_tile, meta[i], metadata_explicit, default_margin_px, profile)
        r, c = divmod(i, GRID)
        info.update({"index": i, "row": r, "col": c, "semantic_type": safe_name(str(meta[i].get("semantic_type") or f"r{r:02d}_c{c:02d}"))})
        atlas.alpha_composite(rendered, (c * CELL_SIZE, r * CELL_SIZE))
        rendered_tiles.append(rendered)
        cell_infos.append(info)
    return atlas, rendered_tiles, cell_infos, source_cells


def _qa_report(input_path: Path, original_size: tuple[int, int], original_mode: str, family: str, profile: str, meta: list[dict[str, Any]], metadata_explicit: bool, source_cells: list[Image.Image], rendered_tiles: list[Image.Image], cell_infos: list[dict[str, Any]], strict_unused_transparency: bool) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    repairs: list[str] = []

    transparent_cells = [tile.getchannel("A").getbbox() is None for tile in source_cells]
    errors.extend(validate_metadata(family, meta, transparent_cells, strict_unused_transparency))

    if original_size != (ATLAS_SIZE, ATLAS_SIZE):
        repairs.append(f"Source geometry {original_size[0]}x{original_size[1]} repacked into canonical 1000x1000 atlas.")
    if original_mode != "RGBA":
        repairs.append(f"Source mode {original_mode} converted to RGBA.")

    for i, info in enumerate(cell_infos):
        cell = meta[i]
        if cell.get("unused") and info["sourceAlphaBBox"] is not None:
            if strict_unused_transparency:
                errors.append(f"Cell {i:03d} is marked unused but source contains visible pixels.")
            else:
                repairs.append(f"Cell {i:03d} marked unused; source pixels replaced by true transparency.")
        if cell.get("require_transparency") and info["sourceAlphaCoverage"] >= 0.999:
            errors.append(f"Cell {i:03d} requires real transparency but source is effectively opaque.")
        forbidden = info.get("forbiddenEdgeContact", {})
        if forbidden:
            errors.append(f"Cell {i:03d} touches forbidden canonical edge(s): {', '.join(sorted(forbidden))}.")
        if info.get("actions"):
            repairs.extend(f"Cell {i:03d}: {action}." for action in info["actions"] if action not in {"source_cell_resized_to_100x100"})
        score = 0.0
        if not cell.get("allow_checkerboard", False):
            score = _checkerboard_score(source_cells[i])
            if score >= 0.82:
                warnings.append(f"Cell {i:03d} has a strong fake-checkerboard candidate (score {score:.2f}).")
        info["fakeCheckerboardScore"] = score

    separators = _detect_separator_candidates(Image.new("RGBA", (1, 1), (0, 0, 0, 0)))
    source_canvas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    for i, tile in enumerate(source_cells):
        r, c = divmod(i, GRID)
        source_canvas.alpha_composite(tile.resize((CELL_SIZE, CELL_SIZE), RESAMPLE), (c * CELL_SIZE, r * CELL_SIZE))
    separators = _detect_separator_candidates(source_canvas)
    if separators:
        warnings.append(f"Detected {len(separators)} possible visible source grid/separator line(s); review required.")

    source_boundary = _detect_cross_boundary_candidates(source_cells, meta, metadata_explicit, profile)
    boundary = _detect_cross_boundary_candidates(rendered_tiles, meta, metadata_explicit, profile)
    unexplained = [f for f in boundary if not f["declaredOrInferredSeam"]]
    if unexplained:
        warnings.append(f"Detected {len(unexplained)} suspicious canonical cross-cell continuation(s) after per-cell normalization; review for split/bleeding assets.")

    status = "FAIL" if errors else ("REPAIRED" if repairs or warnings else "PASS")
    return {
        "version": QA_SCHEMA_VERSION,
        "family": family,
        "profile": profile,
        "status": status,
        "source": {
            "path": str(input_path),
            "width": original_size[0],
            "height": original_size[1],
            "mode": original_mode,
            "metadataExplicit": metadata_explicit,
        },
        "canonicalTarget": {
            "width": ATLAS_SIZE,
            "height": ATLAS_SIZE,
            "mode": "RGBA",
            "grid": [GRID, GRID],
            "cellSize": [CELL_SIZE, CELL_SIZE],
            "ordering": "row-major",
            "borderTrimPx": 0,
            "cellIsolation": "hard 100x100 reconstruction",
        },
        "guarantees": [
            "exact_1000x1000_rgba_master",
            "exact_10x10_grid",
            "exact_100x100_row_major_cells",
            "trim_0_slicing",
            "hard_cell_isolation_after_repack",
            "unused_cells_forced_transparent_when_marked",
        ],
        "notAutomaticallyProvable": MANUAL_REVIEW_ITEMS,
        "errors": errors,
        "warnings": warnings,
        "repairs": sorted(set(repairs)),
        "separatorCandidates": separators,
        "sourceCrossBoundaryCandidates": source_boundary,
        "crossBoundaryCandidates": boundary,
        "cells": cell_infos,
    }


def _clean_output(output_dir: Path, family: str) -> None:
    if not output_dir.exists():
        return
    for pattern in (f"{family}_*_100px.png", f"{family}_atlas_1000px.png", f"{family}_tiles.manifest.json", f"{family}_tiles.descriptions.json", f"{family}_atlas.qa.json"):
        for path in output_dir.glob(pattern):
            if path.is_file():
                path.unlink()


def process_atlas(
    input_path: Path,
    output_dir: Path,
    family: str,
    *,
    metadata_path: Path | None = None,
    cells: list[dict[str, Any]] | None = None,
    require_metadata: bool = False,
    strict_unused_transparency: bool = False,
    profile: str = "generic",
    default_margin_px: int = 4,
    fail_on_qa: bool = False,
    qa_report_path: Path | None = None,
) -> dict[str, Any]:
    family = safe_name(family)
    if require_metadata and metadata_path is None and cells is None:
        raise ValueError("Metadata is required but no metadata source was provided.")
    if default_margin_px < 0 or default_margin_px >= CELL_SIZE // 2:
        raise ValueError("default_margin_px must be between 0 and 49.")

    output_dir.mkdir(parents=True, exist_ok=True)
    meta = cells if cells is not None else load_metadata(metadata_path)
    metadata_explicit = metadata_path is not None or cells is not None
    if len(meta) != GRID * GRID:
        raise ValueError(f"Expected {GRID * GRID} metadata cells.")

    with Image.open(input_path) as image:
        original_size = image.size
        original_mode = image.mode
        source = image.convert("RGBA")

    canonical_atlas, rendered_tiles, cell_infos, source_cells = _build_canonical_atlas(source, meta, metadata_explicit, default_margin_px, profile)
    qa = _qa_report(input_path, original_size, original_mode, family, profile, meta, metadata_explicit, source_cells, rendered_tiles, cell_infos, strict_unused_transparency)

    _clean_output(output_dir, family)

    master_path = output_dir / f"{family}_atlas_1000px.png"
    canonical_atlas.save(master_path, "PNG", optimize=False)
    files: list[Path] = [master_path]

    manifest_tiles: list[dict[str, Any]] = []
    desc_tiles: list[dict[str, Any]] = []
    emitted_count = 0

    for i, tile in enumerate(rendered_tiles):
        row, col = divmod(i, GRID)
        cell = meta[i]
        if cell.get("unused"):
            continue
        if tile.getchannel("A").getbbox() is None:
            continue
        semantic = safe_name(str(cell.get("semantic_type") or f"r{row:02d}_c{col:02d}"))
        name = f"{family}_{semantic}_100px.png"
        path = output_dir / name
        tile.save(path, "PNG", optimize=False)
        files.append(path)
        emitted_count += 1
        common = {
            "index": i,
            "row": row,
            "col": col,
            "type": semantic,
            "semantic_type": semantic,
            "displayName": str(cell.get("display_name", "")).strip(),
            "category": str(cell.get("category", "")).strip(),
            "runtimeUsage": str(cell.get("runtime_usage", "")).strip(),
            "filename": name,
        }
        manifest_tiles.append({**common, "sha256": sha256(path), "size": [CELL_SIZE, CELL_SIZE]})
        desc_tiles.append({**common, "description": str(cell.get("description", "")).strip()})

    manifest = {
        "version": SCHEMA_VERSION,
        "family": family,
        "atlas": {
            "filename": master_path.name,
            "width": ATLAS_SIZE,
            "height": ATLAS_SIZE,
            "mode": "RGBA",
            "columns": GRID,
            "rows": GRID,
            "cellSize": CELL_SIZE,
            "ordering": "row-major",
            "sha256": sha256(master_path),
            "sourceWidth": original_size[0],
            "sourceHeight": original_size[1],
            "sourceMode": original_mode,
            "processingMode": "canonical_production",
            "normalized": original_size != (ATLAS_SIZE, ATLAS_SIZE) or original_mode != "RGBA",
        },
        "derivedTilePolicy": {
            "sourceCellSize": "variable logical source grid cell",
            "outputSize": [CELL_SIZE, CELL_SIZE],
            "borderTrimPx": 0,
            "reconstruction": "alpha_crop_normalize_then_canonical_cell_repack",
        },
        "tiles": manifest_tiles,
    }
    descriptions = {
        "version": SCHEMA_VERSION,
        "family": family,
        "descriptionFilePurpose": "Presentation metadata only; not Simulation authority.",
        "tiles": desc_tiles,
    }

    manifest_path = output_dir / f"{family}_tiles.manifest.json"
    descriptions_path = output_dir / f"{family}_tiles.descriptions.json"
    qa_path = qa_report_path or output_dir / f"{family}_atlas.qa.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    descriptions_path.write_text(json.dumps(descriptions, indent=2) + "\n", encoding="utf-8")
    qa_path.parent.mkdir(parents=True, exist_ok=True)
    qa_path.write_text(json.dumps(qa, indent=2) + "\n", encoding="utf-8")
    files.extend([manifest_path, descriptions_path, qa_path])

    if fail_on_qa and qa["status"] == "FAIL":
        raise ValueError(f"Production QA failed. See: {qa_path}")

    return {
        "manifest": manifest,
        "descriptions": descriptions,
        "qa": qa,
        "output_dir": str(output_dir),
        "emitted_count": emitted_count,
        "files": [str(p) for p in files],
        "qa_report": str(qa_path),
    }


def stage_result_to_mirror(result: dict[str, Any], mirror_root: Path, repository_prefix: str | None = None) -> dict[str, Any]:
    family = safe_name(result["manifest"]["family"])
    prefix = Path(repository_prefix) if repository_prefix else Path("textures") / "tiles" / family
    target_dir = mirror_root / prefix
    target_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for raw in result["files"]:
        src = Path(raw)
        dst = target_dir / src.name
        shutil.copy2(src, dst)
        records.append({"path": str(prefix / src.name).replace("\\", "/"), "sha256": sha256(dst)})
    return {"mirrorRoot": str(mirror_root), "repositoryPrefix": str(prefix).replace("\\", "/"), "files": records}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Canonical tile atlas processor: one fixed production path that reconstructs an exact 1000x1000 RGBA 10x10 atlas and 100x100 slices."
    )
    parser.add_argument("input", type=Path, nargs="?", help="Source atlas image.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {TOOL_VERSION}")
    parser.add_argument("--family", "-f", required=False, default="tile", help="Atlas family name.")
    parser.add_argument("--output", "-o", type=Path, help="Output folder. Default: <input dir>/<family>_tiles")
    parser.add_argument("--metadata", type=Path, help="Optional metadata JSON with 100 logical cells.")
    parser.add_argument("--require-metadata", action="store_true", help="Fail unless metadata is provided.")
    parser.add_argument("--strict-unused-transparency", action="store_true", help="Treat visible pixels inside metadata-marked unused cells as QA failures.")
    parser.add_argument("--profile", choices=("generic", "terrain", "overlay", "structure", "interior_cutaway"), default="generic", help="Policy inference profile when metadata does not explicitly define a rule.")
    parser.add_argument("--cell-margin", type=int, default=4, help="Default safe margin for contained prop/overlay cells.")
    parser.add_argument("--fail-on-qa", action="store_true", help="Exit non-zero when QA status is FAIL after outputs are written.")
    parser.add_argument("--qa-report", type=Path, help="Optional explicit QA report path.")
    parser.add_argument("--write-metadata-template", type=Path, help="Write a 100-cell metadata template and exit.")
    parser.add_argument("--stage-drive-root", type=Path, help="Copy exact outputs into a local or mounted Drive repository mirror root.")
    parser.add_argument("--stage-prefix", help="Repository-relative staging prefix. Default: textures/tiles/<family>.")

    args = parser.parse_args()
    if args.write_metadata_template:
        save_metadata_template(args.write_metadata_template)
        print(json.dumps({"status": "OK", "metadataTemplate": str(args.write_metadata_template)}, indent=2))
        return 0
    if args.input is None:
        parser.error("input is required unless --write-metadata-template is used")

    cells = load_metadata(args.metadata) if args.metadata else None
    result = process_atlas(
        args.input,
        args.output or args.input.parent / f"{safe_name(args.family)}_tiles",
        args.family,
        metadata_path=args.metadata if cells is None else None,
        cells=cells,
        require_metadata=args.require_metadata,
        strict_unused_transparency=args.strict_unused_transparency,
        profile=args.profile,
        default_margin_px=args.cell_margin,
        fail_on_qa=args.fail_on_qa,
        qa_report_path=args.qa_report,
    )

    staged = None
    if args.stage_drive_root:
        staged = stage_result_to_mirror(result, args.stage_drive_root, args.stage_prefix)

    payload = {
        "status": result["qa"]["status"],
        "family": result["manifest"]["family"],
        "output_dir": result["output_dir"],
        "emitted_count": result["emitted_count"],
        "qa_report": result["qa_report"],
        "errors": len(result["qa"]["errors"]),
        "warnings": len(result["qa"]["warnings"]),
        "repairs": len(result["qa"]["repairs"]),
        "files": result["files"],
    }
    if staged is not None:
        payload["staged"] = staged
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
