#!/usr/bin/env python3
"""
Extract embedded PNG data URLs from JS map bundles in the ./map folder.

Usage:
  python tools/extract_map_png.py
  python tools/extract_map_png.py --file map/map.js
  python tools/extract_map_png.py --file map/seed123/seed123.js

If `--file` is omitted the script prefers `map/map.js` if present,
otherwise it scans `map/` recursively for `.js` bundles.
"""

from __future__ import annotations

import os
import re
import sys
import argparse
import base64
from datetime import datetime


def find_map_js_files(map_dir: str) -> list[str]:
    """Find all .js files under map_dir, recursively."""
    files = []
    for root, _, filenames in os.walk(map_dir):
        for name in filenames:
            if name.lower().endswith('.js'):
                files.append(os.path.join(root, name))
    files.sort()
    return files


def extract_dataurl_from_text(text: str) -> str | None:
    # Prefer a direct regex match that captures base64 even if it contains
    # newlines or whitespace.
    m = re.search(r'(data:image\/png;base64,([A-Za-z0-9+/=\s]+))', text)
    if m:
        head = 'data:image/png;base64,'
        b64 = re.sub(r'\s+', '', m.group(2))
        return head + b64

    # Fallback: find the token and read until the next quote character.
    idx = text.find('data:image/png;base64,')
    if idx == -1:
        return None
    dq = text.find('"', idx)
    sq = text.find("'", idx)
    ends = [p for p in (dq, sq) if p != -1]
    if not ends:
        return None
    end = min(ends)
    dataurl = text[idx:end]
    head = 'data:image/png;base64,'
    if not dataurl.startswith(head):
        return None
    b64 = re.sub(r'\s+', '', dataurl[len(head):])
    return head + b64


def write_png_from_dataurl(dataurl: str, out_path: str) -> None:
    head = 'data:image/png;base64,'
    if not dataurl.startswith(head):
        raise ValueError('Not a PNG data URL')
    b64 = dataurl[len(head):]
    data = base64.b64decode(b64)
    with open(out_path, 'wb') as f:
        f.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Extract embedded PNG data URLs from map JS bundles.'
    )
    parser.add_argument('--file', '-f', help='JS file or directory to extract from (relative to workspace root or absolute). If omitted, defaults to map/map.js if present, otherwise scans map/ recursively.')
    args = parser.parse_args()

    script_dir = os.path.abspath(os.path.dirname(__file__))
    workspace_root = os.path.abspath(os.path.join(script_dir, '..'))
    map_dir = os.path.join(workspace_root, 'map')

    target_files: list[str] = []

    # Determine files to process based on --file or default behavior
    if args.file:
        target = args.file
        if not os.path.isabs(target):
            target = os.path.join(workspace_root, target)

        if os.path.isdir(target):
            target_files = find_map_js_files(target)
            if not target_files:
                print(f'No .js files found under {target}', file=sys.stderr)
                return 1
        else:
            if not target.lower().endswith('.js'):
                print(f'Error: specified file does not appear to be a .js file: {target}', file=sys.stderr)
                return 2
            if not os.path.exists(target):
                print(f'Error: specified file not found: {target}', file=sys.stderr)
                return 2
            target_files = [target]
    else:
        default_map_js = os.path.join(map_dir, 'map.js')
        if os.path.exists(default_map_js):
            target_files = [default_map_js]
        else:
            if not os.path.isdir(map_dir):
                print(f'Error: map directory not found at {map_dir}', file=sys.stderr)
                return 2
            target_files = find_map_js_files(map_dir)
            if not target_files:
                print('No .js files found in map/ folder', file=sys.stderr)
                return 1

    extracted_paths: list[str] = []

    for js in target_files:
        name = os.path.relpath(js, workspace_root)
        print(f'Inspecting {name}...')
        try:
            with open(js, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
        except Exception as e:
            print(f'  Failed to read {name}: {e}', file=sys.stderr)
            continue

        dataurl = extract_dataurl_from_text(content)
        if not dataurl:
            print('  No embedded PNG data URL found.')
            continue

        seed = os.path.splitext(os.path.basename(js))[0]
        out_name = f'{seed}_extracted.png'
        out_path = os.path.join(os.path.dirname(js), out_name)

        if os.path.exists(out_path):
            bak_name = f'{out_name}.{datetime.now().strftime("%Y%m%d%H%M%S")}.bak'
            bak_path = os.path.join(os.path.dirname(js), bak_name)
            try:
                os.rename(out_path, bak_path)
                print(f'  Existing extraction backed up as {bak_name}')
            except Exception:
                # if rename fails, continue and overwrite
                pass

        try:
            write_png_from_dataurl(dataurl, out_path)
            print(f'  Wrote {out_name}')
            extracted_paths.append(out_path)
        except Exception as e:
            print(f'  Failed to write PNG: {e}', file=sys.stderr)

    if extracted_paths:
        print('\nExtraction complete:')
        for p in extracted_paths:
            print('  ' + p)
        return 0

    print('No images extracted.', file=sys.stderr)
    return 3


if __name__ == '__main__':
    raise SystemExit(main())
