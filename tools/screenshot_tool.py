#!/usr/bin/env python3
"""Capture visual-review screenshots for The Advisor Game."""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

PROFILES = {
    "phone": (720, 1280),
    "tablet": (1280, 800),
}


def normalize_target(target: str) -> str:
    value = target.strip()
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https", "file"}:
        return value
    if parsed.scheme and len(parsed.scheme) > 1:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")
    return path.as_uri()


def create_driver(width: int, height: int):
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise RuntimeError("Selenium is required: pip install selenium") from exc

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--hide-scrollbars")
    options.add_argument(f"--window-size={width},{height}")
    return webdriver.Chrome(options=options)


def output_paths(filename: str, shots: int) -> list[Path]:
    directory = Path(__file__).resolve().parent / "screenshots"
    directory.mkdir(parents=True, exist_ok=True)

    name = Path(filename).name
    if not name:
        raise ValueError("Output filename is empty")
    path = Path(name)
    if path.suffix.lower() != ".png":
        path = path.with_suffix(".png")

    if shots == 1:
        return [directory / path.name]

    return [
        directory / f"{path.stem}_{index:02d}.png"
        for index in range(1, shots + 1)
    ]


def take_screenshots(
    target: str,
    output_file: str,
    *,
    width: int,
    height: int,
    shots: int = 1,
    interval: float = 0.2,
    wait_min: float = 15.0,
    wait_max: float = 60.0,
    ready_timeout: float = 20.0,
) -> bool:
    if width <= 0 or height <= 0:
        print("Error: width and height must be positive.", file=sys.stderr)
        return False
    if shots < 1:
        print("Error: shots must be >= 1.", file=sys.stderr)
        return False
    if interval < 0:
        print("Error: interval must be >= 0.", file=sys.stderr)
        return False
    if wait_min < 0 or wait_max < 0 or wait_min > wait_max:
        print("Error: require 0 <= wait-min <= wait-max.", file=sys.stderr)
        return False

    try:
        browser_url = normalize_target(target)
        paths = output_paths(output_file, shots)
        driver = create_driver(width, height)
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait

            driver.set_window_size(width, height)
            driver.get(browser_url)
            WebDriverWait(driver, ready_timeout).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            WebDriverWait(driver, ready_timeout).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )

            delay = random.uniform(wait_min, wait_max)
            print(f"Opening: {browser_url}")
            print(f"Viewport: {width}x{height}")
            print(f"Waiting {delay:.1f}s before capture")
            time.sleep(delay)

            for index, path in enumerate(paths):
                if index:
                    time.sleep(interval)
                if not driver.save_screenshot(str(path)):
                    raise RuntimeError(f"Screenshot capture failed: {path}")
                print(f"Saved: {path}")
            return True
        finally:
            driver.quit()
    except Exception as exc:
        print(f"Error taking screenshot: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture headless Chrome review screenshots.")
    parser.add_argument("target", help="Local HTML path, file:// URL, or http(s) URL")
    parser.add_argument("filename", help="Base PNG filename saved under tools/screenshots/")
    parser.add_argument("--profile", choices=sorted(PROFILES), help="Viewport profile")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--shots", type=int, default=1)
    parser.add_argument("--interval", type=float, default=0.2)
    parser.add_argument("--wait-min", type=float, default=15.0)
    parser.add_argument("--wait-max", type=float, default=60.0)
    parser.add_argument("--ready-timeout", type=float, default=20.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    width, height = PROFILES.get(args.profile, (args.width, args.height))
    ok = take_screenshots(
        args.target,
        args.filename,
        width=width,
        height=height,
        shots=args.shots,
        interval=args.interval,
        wait_min=args.wait_min,
        wait_max=args.wait_max,
        ready_timeout=args.ready_timeout,
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
