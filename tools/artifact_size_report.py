#!/usr/bin/env python3
"""Report artifact input size and byte-identical duplication using stdlib only."""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path


def human_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if size < 1024.0 or unit == "TiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024.0
    return f"{value} B"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expand_input(value: str) -> list[Path]:
    matches = [Path(item) for item in glob.glob(value, recursive=True)]
    if not matches:
        candidate = Path(value)
        if candidate.exists():
            matches = [candidate]
    files: list[Path] = []
    for match in matches:
        if match.is_file():
            files.append(match)
        elif match.is_dir():
            files.extend(path for path in match.rglob("*") if path.is_file())
    return files


def relative_name(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def build_report(inputs: list[str], root: Path, top: int) -> dict:
    unique: dict[Path, dict] = {}
    groups: list[dict] = []

    for value in inputs:
        matched = []
        seen = set()
        for path in expand_input(value):
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            size = path.stat().st_size
            matched.append((resolved, size))
            unique.setdefault(resolved, {"path": path, "size": size})
        groups.append({
            "input": value,
            "files": len(matched),
            "bytes": sum(size for _, size in matched),
        })

    files = [
        {
            "path": relative_name(item["path"], root),
            "bytes": item["size"],
        }
        for item in unique.values()
    ]
    files.sort(key=lambda item: (-item["bytes"], item["path"]))

    extension_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"files": 0, "bytes": 0})
    for item in files:
        suffix = Path(item["path"]).suffix.lower() or "<none>"
        extension_totals[suffix]["files"] += 1
        extension_totals[suffix]["bytes"] += item["bytes"]

    same_size: dict[int, list[Path]] = defaultdict(list)
    for resolved, item in unique.items():
        if item["size"] > 0:
            same_size[item["size"]].append(resolved)

    duplicates = []
    for size, paths in same_size.items():
        if len(paths) < 2:
            continue
        by_hash: dict[str, list[Path]] = defaultdict(list)
        for path in paths:
            by_hash[sha256(path)].append(path)
        for digest, dup_paths in by_hash.items():
            if len(dup_paths) < 2:
                continue
            names = sorted(relative_name(path, root) for path in dup_paths)
            duplicates.append({
                "sha256": digest,
                "bytes_each": size,
                "count": len(names),
                "redundant_bytes": size * (len(names) - 1),
                "files": names,
            })
    duplicates.sort(key=lambda item: (-item["redundant_bytes"], item["sha256"]))

    total_bytes = sum(item["bytes"] for item in files)
    redundant_bytes = sum(item["redundant_bytes"] for item in duplicates)

    return {
        "schema": 1,
        "root": root.resolve().as_posix(),
        "inputs": groups,
        "total_files": len(files),
        "total_bytes": total_bytes,
        "duplicate_groups": len(duplicates),
        "redundant_bytes": redundant_bytes,
        "top_files": files[:top],
        "extension_totals": dict(sorted(extension_totals.items())),
        "duplicates": duplicates[:top],
    }


def render_text(report: dict) -> str:
    lines = [
        "Artifact Size Report",
        f"Files: {report['total_files']}",
        f"Raw input size: {human_bytes(report['total_bytes'])} ({report['total_bytes']} bytes)",
        f"Byte-identical redundant size: {human_bytes(report['redundant_bytes'])} ({report['redundant_bytes']} bytes)",
        "",
        "Input groups:",
    ]
    for group in report["inputs"]:
        lines.append(
            f"- {group['input']}: {group['files']} files, "
            f"{human_bytes(group['bytes'])} ({group['bytes']} bytes)"
        )

    lines.extend(["", "Top files:"])
    for item in report["top_files"]:
        lines.append(f"- {human_bytes(item['bytes']):>10}  {item['path']}")

    lines.extend(["", "Extensions:"])
    for suffix, item in sorted(
        report["extension_totals"].items(),
        key=lambda pair: (-pair[1]["bytes"], pair[0]),
    ):
        lines.append(
            f"- {suffix}: {item['files']} files, "
            f"{human_bytes(item['bytes'])} ({item['bytes']} bytes)"
        )

    lines.extend(["", "Byte-identical duplicate groups:"])
    if not report["duplicates"]:
        lines.append("- none")
    for group in report["duplicates"]:
        lines.append(
            f"- {group['count']} x {human_bytes(group['bytes_each'])}; "
            f"redundant {human_bytes(group['redundant_bytes'])}; sha256 {group['sha256']}"
        )
        for name in group["files"]:
            lines.append(f"  - {name}")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inventory artifact inputs and identify largest/byte-identical contributors."
    )
    parser.add_argument("inputs", nargs="+", help="Files, directories, or glob patterns")
    parser.add_argument("--root", default=".", help="Root used for relative path display")
    parser.add_argument("--top", type=int, default=20, help="Maximum top files/duplicate groups")
    parser.add_argument("--json", dest="json_path", help="Write JSON report")
    parser.add_argument("--text", dest="text_path", help="Write text report")
    parser.add_argument("--require-files", action="store_true", help="Fail when no files match")
    args = parser.parse_args()

    root = Path(args.root)
    report = build_report(args.inputs, root, max(1, args.top))
    if args.require_files and report["total_files"] == 0:
        raise SystemExit("No artifact input files matched.")

    text = render_text(report)
    print(text, end="")

    if args.json_path:
        path = Path(args.json_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.text_path:
        path = Path(args.text_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a", encoding="utf-8") as handle:
            handle.write("## Artifact size report\n\n")
            handle.write(
                f"- Files: **{report['total_files']}**\n"
                f"- Raw input: **{human_bytes(report['total_bytes'])}**\n"
                f"- Byte-identical redundant: **{human_bytes(report['redundant_bytes'])}**\n\n"
            )
            handle.write("| Input | Files | Raw size |\n|---|---:|---:|\n")
            for group in report["inputs"]:
                handle.write(
                    f"| `{group['input']}` | {group['files']} | {human_bytes(group['bytes'])} |\n"
                )
            handle.write("\n### Largest files\n\n")
            for item in report["top_files"][:10]:
                handle.write(f"- {human_bytes(item['bytes'])}: `{item['path']}`\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
