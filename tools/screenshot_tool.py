#!/usr/bin/env python3
"""Capture and publish visual-review screenshots for The Advisor Game.

Screenshots are always written under ``tools/screenshots/``. By default, a
successful capture is committed and pushed to the repository's ``main`` branch
so the images can be reviewed directly at:
https://github.com/sgoxel/The_Advisor_Game/tree/main/tools/screenshots

Use ``--no-publish`` for local-only/debug captures.
"""

from __future__ import annotations

import argparse
import random
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse

REPOSITORY_SLUG = "sgoxel/The_Advisor_Game"
DEFAULT_PUBLISH_BRANCH = "main"
GITHUB_BASE_URL = f"https://github.com/{REPOSITORY_SLUG}"

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


def screenshots_directory() -> Path:
    directory = Path(__file__).resolve().parent / "screenshots"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def output_paths(filename: str, shots: int) -> list[Path]:
    directory = screenshots_directory()

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
    actual_screenshots_dir = screenshots_directory().resolve()
    if actual_screenshots_dir != expected_screenshots_dir:
        raise RuntimeError(
            "Refusing to publish: screenshot output is not the repository tools/screenshots directory"
        )

    remote = _run_git(repo_root, "remote", "get-url", "origin").stdout.strip()
    normalized_remote = remote.removesuffix(".git").rstrip("/")
    valid_remote = (
        normalized_remote.endswith(f"github.com/{REPOSITORY_SLUG}")
        or normalized_remote.endswith(f"github.com:{REPOSITORY_SLUG}")
    )
    if not valid_remote:
        raise RuntimeError(
            f"Refusing to publish to unexpected origin remote: {remote or '<empty>'}"
        )

    current_branch = _run_git(repo_root, "branch", "--show-current").stdout.strip()
    if current_branch != branch:
        shown = current_branch or "detached HEAD"
        raise RuntimeError(
            f"Refusing to publish from {shown}; checkout {branch!r} before publishing"
        )


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

        relative_paths: list[Path] = []
        screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
        for path in paths:
            resolved = path.resolve()
            try:
                resolved.relative_to(screenshots_dir)
            except ValueError as exc:
                raise RuntimeError(
                    f"Refusing to publish file outside tools/screenshots: {resolved}"
                ) from exc
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
            # Pathspec keeps unrelated staged/worktree changes out of this commit.
            _run_git(repo_root, "commit", "--only", "-m", commit_message, "--", *git_paths)
            _run_git(repo_root, "push", "origin", f"HEAD:{branch}")
            print(f"Published {len(relative_paths)} screenshot(s) to GitHub.")
        else:
            print("Screenshot content is unchanged; no new commit was needed.")

        folder_url = f"{GITHUB_BASE_URL}/tree/{quote(branch)}/tools/screenshots"
        print(f"GitHub screenshots: {folder_url}")
        for relative_path in relative_paths:
            print(f"GitHub file: {_github_file_url(relative_path, branch)}")
        return True
    except Exception as exc:
        print(f"Error publishing screenshots: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture headless Chrome review screenshots under tools/screenshots/ "
            "and publish them to GitHub by default."
        )
    )
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
    parser.set_defaults(publish=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    width, height = PROFILES.get(args.profile, (args.width, args.height))
    paths = output_paths(args.filename, args.shots)
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
