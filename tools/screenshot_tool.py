#!/usr/bin/env python3
"""Capture and publish visual-review screenshots for The Advisor Game.

This is the shared screenshot utility for all project AI agents.

Defaults:
- landscape: 1920x1080
- portrait: 1080x1920
- maximum camera zoom-out before capture when the game exposes
  window.Game.State.camera.minZoom
- screenshots saved under tools/screenshots/
- successful local/manual captures publish to GitHub main unless --no-publish

Multi-shot timestamp naming:
  phone-1-20260918T145912123Z.png
  phone-2-20260918T145912123Z.png

Examples:
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ landscape --profile landscape --shots 2 --interval 0.2 --timestamp-names
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ phone --profile portrait --shots 2 --interval 0.2 --timestamp-names
  python tools/screenshot_tool.py index.html local-check.png --no-publish
"""

from __future__ import annotations

import argparse
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

REPOSITORY_SLUG = "sgoxel/The_Advisor_Game"
DEFAULT_PUBLISH_BRANCH = "main"
GITHUB_BASE_URL = f"https://github.com/{REPOSITORY_SLUG}"

PROFILES = {
    "landscape": (1920, 1080),
    "portrait": (1080, 1920),
    # Backward-compatible aliases used by existing project automation/agents.
    "tablet": (1920, 1080),
    "phone": (1080, 1920),
}

DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080

MAX_ZOOM_OUT_SCRIPT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const game = window.Game;
    const state = game?.State;
    const camera = state?.camera;
    const renderer = game?.Renderer;

    if (!camera) {
      done({ok: false, reason: 'camera-not-found'});
      return;
    }
    if (typeof camera.minZoom !== 'number') {
      done({ok: false, reason: 'minZoom-not-found'});
      return;
    }

    camera.zoom = camera.minZoom;
    if (typeof renderer?.centerCamera === 'function') {
      try { renderer.centerCamera(); } catch (_) {}
    }
    if (typeof renderer?.markDirty === 'function') {
      try { renderer.markDirty(true, true); } catch (_) {}
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    done({ok: true, zoom: camera.zoom, minZoom: camera.minZoom});
  } catch (error) {
    done({ok: false, reason: String(error)});
  }
})();
"""


def normalize_target(target: str) -> str:
    """Return a browser-ready URL for a local path or supported URL."""
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
    """Create headless Chrome."""
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


def screenshots_directory() -> Path:
    directory = Path(__file__).resolve().parent / "screenshots"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def utc_timestamp_ms() -> str:
    """Return a UTC timestamp including milliseconds, filename-safe."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")[:-3] + "Z"


def output_paths(filename: str, shots: int, timestamp_names: bool = False) -> list[Path]:
    """Build output paths under tools/screenshots/."""
    directory = screenshots_directory()
    name = Path(filename).name
    if not name:
        raise ValueError("Output filename is empty")

    path = Path(name)
    stem = path.stem if path.suffix else path.name
    if not stem:
        raise ValueError("Output filename stem is empty")

    if timestamp_names:
        stamp = utc_timestamp_ms()
        return [directory / f"{stem}-{index}-{stamp}.png" for index in range(1, shots + 1)]

    if shots == 1:
        if path.suffix.lower() != ".png":
            path = path.with_suffix(".png")
        return [directory / path.name]

    return [directory / f"{stem}_{index:02d}.png" for index in range(1, shots + 1)]


def force_max_zoom_out(driver, settle_seconds: float = 0.15) -> None:
    """Force the game camera to its minimum zoom value, if supported."""
    result = driver.execute_async_script(MAX_ZOOM_OUT_SCRIPT)
    if isinstance(result, dict) and result.get("ok"):
        print(
            "Forced maximum zoom-out before capture "
            f"(zoom={result.get('zoom')}, minZoom={result.get('minZoom')})."
        )
        time.sleep(max(0.0, settle_seconds))
        return
    reason = result.get("reason", "unknown-reason") if isinstance(result, dict) else "unexpected-result"
    print(f"Zoom-out step skipped: {reason}")


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
    timestamp_names: bool = False,
    force_max_zoom: bool = True,
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
        paths = output_paths(output_file, shots, timestamp_names)
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

            if force_max_zoom:
                force_max_zoom_out(driver)

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


def _run_git(repo_root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"exit code {result.returncode}"
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return result


def _repository_root() -> Path:
    script_dir = Path(__file__).resolve().parent
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=script_dir,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(
            "Cannot publish screenshots because this tool is not running inside a Git checkout"
            + (f": {detail}" if detail else "")
        )
    return Path(result.stdout.strip()).resolve()


def _validate_publish_checkout(repo_root: Path, branch: str) -> None:
    expected_screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
    if screenshots_directory().resolve() != expected_screenshots_dir:
        raise RuntimeError(
            "Refusing to publish: screenshot output is not repository tools/screenshots"
        )

    remote = _run_git(repo_root, "remote", "get-url", "origin").stdout.strip()
    normalized_remote = remote.removesuffix(".git").rstrip("/")
    valid_remote = (
        normalized_remote.endswith(f"github.com/{REPOSITORY_SLUG}")
        or normalized_remote.endswith(f"github.com:{REPOSITORY_SLUG}")
    )
    if not valid_remote:
        raise RuntimeError(f"Refusing to publish to unexpected origin remote: {remote or '<empty>'}")

    current_branch = _run_git(repo_root, "branch", "--show-current").stdout.strip()
    if current_branch != branch:
        shown = current_branch or "detached HEAD"
        raise RuntimeError(f"Refusing to publish from {shown}; checkout {branch!r} first")


def _github_file_url(relative_path: Path, branch: str) -> str:
    encoded = "/".join(quote(part) for part in relative_path.parts)
    return f"{GITHUB_BASE_URL}/blob/{quote(branch)}/{encoded}"


def publish_screenshots(
    paths: list[Path],
    *,
    branch: str = DEFAULT_PUBLISH_BRANCH,
    commit_message: str = "chore: publish visual review screenshots",
) -> bool:
    """Commit only the generated screenshots and push them to GitHub."""
    if not paths:
        print("Error publishing screenshots: no screenshot paths were provided.", file=sys.stderr)
        return False

    try:
        repo_root = _repository_root()
        _validate_publish_checkout(repo_root, branch)
        screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
        relative_paths: list[Path] = []

        for path in paths:
            resolved = path.resolve()
            try:
                resolved.relative_to(screenshots_dir)
            except ValueError as exc:
                raise RuntimeError(f"Refusing to publish outside tools/screenshots: {resolved}") from exc
            if not resolved.is_file():
                raise FileNotFoundError(f"Screenshot does not exist: {resolved}")
            relative_paths.append(resolved.relative_to(repo_root))

        git_paths = [path.as_posix() for path in relative_paths]
        _run_git(repo_root, "add", "--", *git_paths)
        staged = _run_git(
            repo_root,
            "diff",
            "--cached",
            "--quiet",
            "--",
            *git_paths,
            check=False,
        )
        if staged.returncode not in {0, 1}:
            detail = (staged.stderr or staged.stdout).strip() or f"exit code {staged.returncode}"
            raise RuntimeError(f"git diff --cached failed: {detail}")

        if staged.returncode == 1:
            _run_git(repo_root, "commit", "--only", "-m", commit_message, "--", *git_paths)
            _run_git(repo_root, "push", "origin", f"HEAD:{branch}")
            print(f"Published {len(relative_paths)} screenshot(s) to GitHub.")
        else:
            print("Screenshot content is unchanged; no new commit was needed.")

        print(f"GitHub screenshots: {GITHUB_BASE_URL}/tree/{quote(branch)}/tools/screenshots")
        for relative_path in relative_paths:
            print(f"GitHub file: {_github_file_url(relative_path, branch)}")
        return True
    except Exception as exc:
        print(f"Error publishing screenshots: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Shared AI-agent screenshot tool. Capture under tools/screenshots/ "
            "and publish to GitHub by default."
        )
    )
    parser.add_argument("target", help="Local HTML path, file:// URL, or http(s) URL")
    parser.add_argument("filename", help="PNG filename or base stem saved under tools/screenshots/")
    parser.add_argument("--profile", choices=sorted(PROFILES), help="Viewport profile")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--shots", type=int, default=1)
    parser.add_argument("--interval", type=float, default=0.2)
    parser.add_argument("--timestamp-names", action="store_true")
    parser.add_argument("--wait-min", type=float, default=15.0)
    parser.add_argument("--wait-max", type=float, default=60.0)
    parser.add_argument("--ready-timeout", type=float, default=20.0)
    parser.add_argument(
        "--no-force-max-zoom",
        action="store_false",
        dest="force_max_zoom",
        help="Do not force game camera to maximum zoom-out before capture",
    )
    parser.add_argument(
        "--publish-branch",
        default=DEFAULT_PUBLISH_BRANCH,
        help=f"GitHub branch to publish to (default: {DEFAULT_PUBLISH_BRANCH})",
    )
    parser.add_argument(
        "--commit-message",
        default="chore: publish visual review screenshots",
        help="Commit message used when publishing screenshots",
    )
    parser.add_argument(
        "--no-publish",
        action="store_false",
        dest="publish",
        help="Capture locally without committing/pushing screenshots",
    )
    parser.set_defaults(publish=True, force_max_zoom=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    width, height = PROFILES.get(args.profile, (args.width, args.height))
    paths = output_paths(args.filename, args.shots, args.timestamp_names)
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
        timestamp_names=args.timestamp_names,
        force_max_zoom=args.force_max_zoom,
    )
    if not ok:
        return 1

    if args.publish and not publish_screenshots(
        paths,
        branch=args.publish_branch,
        commit_message=args.commit_message,
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
