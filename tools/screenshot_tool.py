#!/usr/bin/env python3
"""
Screenshot tool for The Advisor Game project.

Opens a local HTML file, file:// URL, or http(s) URL in headless Chrome and
saves a PNG into the adjacent screenshots/ directory.

Examples:
  python screenshot_tool.py index.html landscape.png
  python screenshot_tool.py index.html portrait.png --width 720 --height 1280
  python screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ public.png

By default the tool uses the project's landscape review viewport (1280x720)
and waits a random 15-60 seconds before capture, matching the daily visual
review requirement. Use --wait-min/--wait-max for non-review/debug captures.
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path
from urllib.parse import urlparse



def normalize_target(target: str) -> str:
    """Return a browser-ready URL for a local path or supported URL."""
    value = target.strip()
    parsed = urlparse(value)

    if parsed.scheme in {"http", "https", "file"}:
        return value

    # A one-letter scheme is normally a Windows drive letter, e.g. C:\\game\\index.html.
    if parsed.scheme and len(parsed.scheme) > 1:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    local_path = Path(value).expanduser().resolve()
    if not local_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {local_path}")
    return local_path.as_uri()


def create_driver(width: int, height: int):
    """Create Chrome, preferring Selenium Manager with webdriver-manager fallback."""
    try:
        from selenium import webdriver
        from selenium.common.exceptions import WebDriverException
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
    except ImportError as exc:
        raise RuntimeError(
            "Selenium is not installed. Install it with: pip install selenium webdriver-manager"
        ) from exc

    try:
        from webdriver_manager.chrome import ChromeDriverManager
    except ImportError:
        ChromeDriverManager = None

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument(f"--window-size={width},{height}")
    options.add_argument("--hide-scrollbars")

    try:
        return webdriver.Chrome(options=options)
    except WebDriverException as first_error:
        if ChromeDriverManager is None:
            raise first_error
        service = Service(ChromeDriverManager().install())
        return webdriver.Chrome(service=service, options=options)


def take_screenshot(
    target: str,
    output_file: str,
    *,
    width: int = 1280,
    height: int = 720,
    wait_min: float = 15.0,
    wait_max: float = 25.0,
    ready_timeout: float = 20.0,
) -> bool:
    """Open target in Chrome and save a screenshot. Returns True on success."""
    if width <= 0 or height <= 0:
        print("Error: width and height must be positive integers.", file=sys.stderr)
        return False
    if wait_min < 0 or wait_max < 0 or wait_min > wait_max:
        print("Error: wait range must satisfy 0 <= wait-min <= wait-max.", file=sys.stderr)
        return False

    screenshots_dir = Path(__file__).resolve().parent / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    # Keep output inside screenshots/ even if a path-like filename is supplied.
    output_name = Path(output_file).name
    if not output_name:
        print("Error: output filename is empty.", file=sys.stderr)
        return False
    if Path(output_name).suffix.lower() != ".png":
        output_name += ".png"
    screenshot_path = screenshots_dir / output_name

    try:
        browser_url = normalize_target(target)
        print(f"Opening: {browser_url}")

        driver = create_driver(width, height)
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait
            # Explicitly enforce the content viewport after startup. Chrome's startup
            # window sizing can vary slightly by platform/headless implementation.
            driver.set_window_size(width, height)
            driver.get(browser_url)

            WebDriverWait(driver, ready_timeout).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            WebDriverWait(driver, ready_timeout).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )

            delay = random.uniform(wait_min, wait_max)
            print(f"Viewport: {width}x{height}")
            print(f"Waiting {delay:.1f} seconds before taking screenshot...")
            time.sleep(delay)

            print(f"Saving screenshot to: {screenshot_path}")
            if not driver.save_screenshot(str(screenshot_path)):
                raise RuntimeError("Chrome reported that screenshot capture failed")

            print("Screenshot saved successfully!")
            return True
        finally:
            driver.quit()

    except Exception as exc:
        print(f"Error taking screenshot: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture a local HTML file or URL with headless Chrome."
    )
    parser.add_argument("target", help="Local HTML path, file:// URL, or http(s) URL")
    parser.add_argument("filename", help="PNG filename saved under screenshots/")
    parser.add_argument("--width", type=int, default=1280, help="Viewport width (default: 1280)")
    parser.add_argument("--height", type=int, default=720, help="Viewport height (default: 720)")
    parser.add_argument(
        "--wait-min", type=float, default=15.0, help="Minimum pre-capture wait in seconds (default: 15)"
    )
    parser.add_argument(
        "--wait-max", type=float, default=60.0, help="Maximum pre-capture wait in seconds (default: 60)"
    )
    parser.add_argument(
        "--ready-timeout", type=float, default=20.0, help="Page readiness timeout in seconds (default: 20)"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    success = take_screenshot(
        args.target,
        args.filename,
        width=args.width,
        height=args.height,
        wait_min=args.wait_min,
        wait_max=args.wait_max,
        ready_timeout=args.ready_timeout,
    )
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
