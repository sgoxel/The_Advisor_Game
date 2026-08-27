#!/usr/bin/env python3
"""
Embed a PNG into a JS map bundle by replacing the embedded data URL.

Usage:
  python tools/embed_map_png.py
  python tools/embed_map_png.py --file map/map.js
  python tools/embed_map_png.py --file map/seed123/seed123.js

Behavior:
  - If `--file` is omitted the script will look for `map/map.js` and
    `map/map.png` (prefers `map/map.png`, falls back to `map/map_extracted.png`).
  - If `--file` is provided and points to a `.js` file, the script will
    look for a PNG with the same basename in the same directory and embed it.
  - If `--file` points to a `.png` file, the script will look for a same-named
    `.js` file in the same directory and embed the PNG into it.
  - If `--file` points to a directory, the script will process all `.js` files
    in that directory and attempt to embed matching PNGs beside them.

This tool makes a timestamped backup of any `.js` it modifies.
"""

from __future__ import annotations

import os
import re
import sys
import argparse
import base64
from datetime import datetime


def find_map_js_files(map_dir: str) -> list[str]:
    files = []
    for root, _, filenames in os.walk(map_dir):
        for name in filenames:
            if name.lower().endswith('.js'):
                files.append(os.path.join(root, name))
    files.sort()
    return files


def find_png_for_js(js_path: str) -> str | None:
    d = os.path.dirname(js_path)
    base = os.path.splitext(os.path.basename(js_path))[0]
    candidates = [
        os.path.join(d, base + '.png'),
        os.path.join(d, base + '_extracted.png'),
        os.path.join(d, base + '_modified.png'),
        os.path.join(d, 'map.png'),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def find_matching_brace(text: str, open_pos: int) -> int:
    # Find matching closing brace for the object starting at open_pos ('{')
    i = open_pos
    if i >= len(text) or text[i] != '{':
        i = text.find('{', open_pos)
        if i == -1:
            return -1
    depth = 0
    in_string = None
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == '\\':
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch == '"' or ch == "'":
            in_string = ch
            i += 1
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def embed_png_into_js(js_path: str, png_path: str) -> bool:
    print(f'Processing JS: {js_path}  PNG: {png_path}')
    try:
        with open(png_path, 'rb') as pf:
            png_bytes = pf.read()
    except Exception as e:
        print(f'  Failed to read PNG {png_path}: {e}', file=sys.stderr)
        return False

    try:
        with open(js_path, 'r', encoding='utf-8', errors='ignore') as jf:
            content = jf.read()
    except Exception as e:
        print(f'  Failed to read JS {js_path}: {e}', file=sys.stderr)
        return False

    start = content.find('data:image/png;base64,')
    new_b64 = base64.b64encode(png_bytes).decode('ascii')
    new_dataurl = 'data:image/png;base64,' + new_b64

    if start != -1:
        # Replace up to the next quote character
        dq = content.find('"', start)
        sq = content.find("'", start)
        ends = [p for p in (dq, sq) if p != -1]
        if not ends:
            print('  Could not determine end of existing data URL; aborting.', file=sys.stderr)
            return False
        end = min(ends)
        new_content = content[:start] + new_dataurl + content[end:]
    else:
        # No existing data URL — try to find mapImage object and insert dataUrl
        m = re.search(r'("mapImage"\s*:\s*\{)|\bmapImage\s*:\s*\{', content)
        if not m:
            # try to find top-level map object and add a mapImage property
            m2 = re.search(r'("map"\s*:\s*\{)|\bmap\s*:\s*\{', content)
            if not m2:
                print('  No existing data URL and no map/mapImage object found; aborting.', file=sys.stderr)
                return False
            obj_start = content.find('{', m2.end() - 1)
            obj_end = find_matching_brace(content, obj_start)
            if obj_end == -1:
                print('  Failed to locate end of map object; aborting.', file=sys.stderr)
                return False
            # insert mapImage before the closing brace
            insert = f'\n    mapImage: {{ "shape": "diamond", "dataUrl": "{new_dataurl}" }},'
            new_content = content[:obj_end] + insert + content[obj_end:]
        else:
            obj_start = content.find('{', m.end() - 1)
            obj_end = find_matching_brace(content, obj_start)
            if obj_end == -1:
                print('  Failed to locate end of mapImage object; aborting.', file=sys.stderr)
                return False
            # check if dataUrl already present inside mapImage (unlikely since start==-1)
            segment = content[obj_start:obj_end]
            if 'data:image/png;base64,' in segment or re.search(r'"dataUrl"\s*:', segment):
                print('  Unexpected: mapImage object already contains dataUrl but not found earlier; aborting.', file=sys.stderr)
                return False
            # insert dataUrl property before closing brace
            insert = f'\n      "dataUrl": "{new_dataurl}",'
            new_content = content[:obj_end] + insert + content[obj_end:]

    # backup original
    bak = js_path + '.' + datetime.now().strftime('%Y%m%d%H%M%S') + '.bak'
    try:
        os.rename(js_path, bak)
        print(f'  Backed up original JS to {bak}')
    except Exception as e:
        print(f'  Warning: failed to create backup {bak}: {e}', file=sys.stderr)

    try:
        with open(js_path, 'w', encoding='utf-8') as jf:
            jf.write(new_content)
        print(f'  Wrote updated JS: {js_path}')
        return True
    except Exception as e:
        print(f'  Failed to write updated JS: {e}', file=sys.stderr)
        # try to restore backup
        try:
            if os.path.exists(bak):
                os.rename(bak, js_path)
                print('  Restored original from backup.')
        except Exception:
            pass
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description='Embed PNG into map .js bundles')
    parser.add_argument('--file', '-f', help='JS or PNG file, or directory to process (workspace-relative or absolute)')
    args = parser.parse_args()

    script_dir = os.path.abspath(os.path.dirname(__file__))
    workspace_root = os.path.abspath(os.path.join(script_dir, '..'))
    map_dir = os.path.join(workspace_root, 'map')

    targets: list[tuple[str, str]] = []  # list of (js_path, png_path)

    if args.file:
        target = args.file
        if not os.path.isabs(target):
            target = os.path.join(workspace_root, target)

        if os.path.isdir(target):
            js_files = find_map_js_files(target)
            if not js_files:
                print(f'No .js files found under {target}', file=sys.stderr)
                return 1
            for js in js_files:
                png = find_png_for_js(js)
                if png:
                    targets.append((js, png))
                else:
                    print(f'  No PNG found for {js}; skipping.', file=sys.stderr)
        else:
            if target.lower().endswith('.png'):
                png = target
                js_candidate = os.path.splitext(png)[0] + '.js'
                if os.path.exists(js_candidate):
                    targets.append((js_candidate, png))
                else:
                    print(f'JS file not found for PNG {png}', file=sys.stderr)
                    return 2
            elif target.lower().endswith('.js'):
                js = target
                png = find_png_for_js(js)
                if not png:
                    print(f'No PNG found for {js}', file=sys.stderr)
                    return 2
                targets.append((js, png))
            else:
                print('Specified --file must be a .js, .png, or directory', file=sys.stderr)
                return 2
    else:
        default_js = os.path.join(map_dir, 'map.js')
        default_png = os.path.join(map_dir, 'map.png')
        alt_png = os.path.join(map_dir, 'map_extracted.png')
        if os.path.exists(default_js):
            png = default_png if os.path.exists(default_png) else (alt_png if os.path.exists(alt_png) else None)
            if not png:
                print('No map.png found; expected map/map.png or map/map_extracted.png', file=sys.stderr)
                return 1
            targets.append((default_js, png))
        else:
            print('No map/map.js found; specify --file to target a specific bundle', file=sys.stderr)
            return 1

    any_ok = False
    for js, png in targets:
        ok = embed_png_into_js(js, png)
        any_ok = any_ok or ok

    return 0 if any_ok else 2


if __name__ == '__main__':
    raise SystemExit(main())
