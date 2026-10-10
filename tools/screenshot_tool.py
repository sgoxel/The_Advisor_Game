#!/usr/bin/env python3
"""Screenshot capture for The Advisor Game (PlayCanvas world atlas).

Loads a running build in headless Chromium, drives it with a small step
language, and writes PNG screenshots plus a capture.json describing each image
(renderer backend, view, tile counts, console and page errors). Score visuals
from the images only; the JSON is supporting evidence.

Setup: pip install playwright && python -m playwright install chromium

Examples:
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots \\
        --scenario village,street,realm --profile desktop,phone
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots --name pan \\
        --steps "drag:50%,50%>30%,60%;settle;shot:moved;wheel:400;settle;shot:far"

Steps, separated by ';' (write '\\;' for a semicolon inside eval):
    click:<css>  check:<css>  uncheck:<css>  select:<css>=<value>
    visible:<css>          wait until the element is visible
    zoom-in[:N]  zoom-out[:N]   click the map zoom buttons N times
    wheel:<deltaY>[@x,y]   mouse wheel over the canvas
    drag:x1,y1>x2,y2       mouse drag across the page
    tap[:x,y]              click the canvas; fails if a panel covers that point
    key:<Key>[@ms]         focus the canvas and hold the key (default 250 ms)
    settle                 wait for ready and settled terrain, then two frames
    wait:<ms>  eval:<javascript>
    shot[:<suffix>]        capture now; put 'settle' first for a stable image
Coordinates are viewport pixels or percentages ("50%,40%"). Without x,y, tap and
wheel use the uncovered canvas point nearest the canvas centre. Every scenario
starts with page load + settle and, if it has no shot step, ends with settle +
one capture. The exit code is 1 when any scenario failed.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, Playwright, sync_playwright

PROFILES: dict[str, tuple[int, int]] = {
    "desktop": (1440, 900), "laptop": (1280, 720), "tablet": (1024, 768),
    "phone": (390, 844), "phone-landscape": (844, 390),
    "phone-small": (360, 800), "tablet-portrait": (768, 1024),
}

# Named step presets. Add a line here to give a new scene a name.
SCENARIOS: dict[str, str] = {
    "village": "",
    "street": "zoom-in:2",
    # 97 m half-height x 1.4^3 = 266 m: the 230-900 m "Province" band in src/main.ts.
    "province": "zoom-out:3",
    "realm": "click:#overview",
    "zoom-country": (
        "click:#overview;settle;"
        "eval:window.advisorWorld.navigation.setFocus(-69.7953*Math.PI/180,-10.3192*Math.PI/180);"
        "eval:window.advisorWorld.setHalfHeight(4168);settle;shot:before;"
        "eval:window.advisorWorld.setHalfHeight(4172.15134);settle;shot:middle;"
        "eval:window.advisorWorld.setHalfHeight(4176);settle;shot:after;"
        "eval:window.advisorWorld.setHalfHeight(4700);settle;shot:handoff;"
        "eval:window.advisorWorld.setHalfHeight(11000);settle;shot:globe"
    ),
    "navigation": "select:#map-scale=10;settle;shot:local;select:#map-scale=10000;settle;shot:realm",
    "realm-tiles": "click:#overview;check:#grid",
    "handoff": (
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.18);settle;shot:in-25;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:in-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.88);settle;shot:in-80;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*1.04);settle;shot:globe;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.86);settle;shot:out-80;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:out-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.16);settle;shot:out-25;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat-return"
    ),
    "cell": "tap;visible:#cell-panel",
    "travel-city": "click:#open-travel;select:#continent-select=1;click:#visit-city",
    # WP-S002-004-008 walking routes. Seeded 6 km road pair (the travel-panel click flow is covered by tests/browser/routes.spec.js).
    "route-road": "eval:window.advisorRoutes.select('2/3/1/1','2/3/1/0');settle;shot:road",
    # Real seeded pair whose highland makes the walk far slower than the straight line.
    "route-mountain": "eval:window.advisorRoutes.select('1/8/0/2','1/8/1/2');settle;shot:mountain",
    # Real seeded pair whose straight line crosses water: the route detours around it.
    "route-water": (
        "eval:window.advisorRoutes.select('1/0/0/0','1/7/2/2');settle;"
        # No semicolons inside an eval step: wait until the handoff blend reaches its target.
        "eval:new Promise(done=>{const t=Date.now(),f=()=>(h=>(!window.advisorRoutes.framing&&!h.active&&Math.abs(h.projectionTransition-h.desiredTransition)<0.002)||Date.now()-t>60000?done():setTimeout(f,250))(window.advisorWorld.state.handoff),_=f()});"
        "settle;shot:water"
    ),
}

# Software rendering flags from playwright.fallback.config.js and playwright.webgpu.config.js.
WEBGL2_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
WEBGPU_ARGS = [
    "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu",
    "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader",
    "--enable-dawn-features=allow_unsafe_apis", "--disable-dawn-features=use_dxc",
    "--enable-webgpu-developer-features", "--use-gpu-in-tests",
    "--enable-accelerated-2d-canvas", *WEBGL2_ARGS,
]

# True when settled, 'error' when the page failed, otherwise false (keep waiting).
SETTLED_JS = """() => {
  const box = document.getElementById('error'), world = window.advisorWorld;
  if ((box && !box.hidden) || (world && world.state.error)) return 'error';
  const loading = document.getElementById('loading');
  if (!world || (loading && !loading.hidden && getComputedStyle(loading).opacity !== '0')) return false;
  return world.state.ready && world.state.settled;
}"""
TWO_FRAMES_JS = "() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))"
# The keys below are written to capture.json unchanged.
STATE_JS = """() => {
  const world = window.advisorWorld, state = world ? world.state : {};
  const renderer = (world && world.renderer) || {};
  const box = document.getElementById('error'), detail = document.getElementById('detail-name');
  return {
    backend: renderer.backend || '', phase: renderer.phase || '',
    fallbackReason: renderer.fallbackReason || '', presentation: state.presentation ?? null,
    view: state.view ?? null, active: state.active ?? null,
    cached: state.cached ?? null, pending: state.pending ?? null,
    handoff: state.handoff ?? null, scaleLabel: state.scaleLabel ?? null,
    canonicalFootprintM: state.canonicalFootprintM ?? null,
    navigation: state.navigation ?? null,
    globe: state.globe ?? null, macroGeography: state.macroGeography ?? null,
    detailName: detail ? detail.textContent.trim() : null,
    error: state.error || (box && !box.hidden ? box.textContent.trim() : ''),
  };
}"""
# Uncovered canvas point nearest the canvas centre as [x, y, distance], or null.
FREE_POINT_JS = """() => {
  const canvas = document.getElementById('world'), box = canvas.getBoundingClientRect(), points = [];
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++)
    points.push([box.left + box.width * i / 24, box.top + box.height * j / 24, Math.hypot(i - 12, j - 12)]);
  const free = points.filter(([x, y]) => document.elementFromPoint(x, y) === canvas);
  return free.sort((a, b) => a[2] - b[2])[0] || null;
}"""


class CaptureError(Exception):
    """A step, wait or page check failed."""


def launch(playwright: Playwright, renderer: str, chromium: str | None, channel: str | None = None) -> Browser:
    options: dict[str, Any] = {"headless": True, "args": WEBGL2_ARGS}
    if renderer == "webgpu":
        options.update(args=WEBGPU_ARGS, ignore_default_args=["--disable-dev-shm-usage"])
    if channel:
        # Installed Chromium channels can use their native adapter on Windows;
        # Linux SwiftShader/Vulkan flags are reserved for the bundled CI browser.
        options.update(channel=channel, args=["--ignore-gpu-blocklist"] +
                       (["--enable-unsafe-webgpu"] if renderer == "webgpu" else []))
    try:
        return playwright.chromium.launch(executable_path=chromium, **options)
    except PlaywrightError as error:
        # Playwright wants a browser revision that is not installed: use the newest one that is.
        root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / ".cache/ms-playwright")
        found = glob.glob(os.path.join(root, "chromium-*", "chrome-linux", "chrome"))
        if chromium or not found or "Executable doesn't exist" not in str(error):
            raise
        newest = max(found, key=lambda path: int(re.findall(r"chromium-(\d+)", path)[-1]))
        print(f"WARNING: Playwright's own Chromium is missing; using {newest}", file=sys.stderr)
        return playwright.chromium.launch(executable_path=newest, **options)


def parse_point(text: str, viewport: tuple[int, int]) -> tuple[float, float]:
    """Parse "x,y" in viewport pixels; either value may be a percentage."""
    x, y = (float(part.strip().rstrip("%")) * (size / 100 if "%" in part else 1)
            for part, size in zip(text.split(","), viewport, strict=True))
    return x, y


def write_records(out: str, records: list[dict[str, Any]]) -> None:
    (Path(out) / "capture.json").write_text(json.dumps(records, indent=2) + "\n")


class Session:
    """One page load of one scenario in one profile."""

    def __init__(self, page: Page, args: argparse.Namespace, name: str, profile: str,
                 viewport: tuple[int, int], records: list[dict[str, Any]]) -> None:
        self.page, self.args, self.name = page, args, name
        self.profile, self.viewport, self.records = profile, viewport, records
        self.console_errors: list[str] = []
        self.page_errors: list[str] = []
        self.shots = 0
        page.on("console", lambda m: self.console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    def settle(self) -> None:
        if self.page.wait_for_function(SETTLED_JS, polling=250).json_value() == "error":
            raise CaptureError(f"page reports an error: {self.page.evaluate(STATE_JS)['error']}")
        self.page.evaluate(TWO_FRAMES_JS)

    def locate(self, selector: str) -> Locator:
        locator = self.page.locator(selector).first
        if not locator.count():
            raise CaptureError(f"selector not found: {selector}")
        return locator

    def canvas_point(self, text: str) -> tuple[float, float]:
        """An explicit x,y, or the uncovered canvas point nearest the centre."""
        if text:
            return parse_point(text, self.viewport)
        point = self.page.evaluate(FREE_POINT_JS)
        if not point:
            raise CaptureError("the canvas is completely covered")
        return point[0], point[1]

    def step(self, name: str, arg: str) -> None:
        page = self.page
        if name == "click":
            self.locate(arg).click()
        elif name in ("check", "uncheck"):
            self.locate(arg).set_checked(name == "check")
        elif name == "select":
            selector, value = arg.rsplit("=", 1)
            self.locate(selector.strip()).select_option(value.strip())
        elif name == "visible":
            self.locate(arg).wait_for(state="visible")
        elif name in ("zoom-in", "zoom-out"):
            for _ in range(int(arg or 1)):
                self.locate(f"#{name}").click()
        elif name == "wheel":
            delta, _, at = arg.partition("@")
            page.mouse.move(*self.canvas_point(at.strip()))
            page.mouse.wheel(0, float(delta))
        elif name == "drag":
            start, end = arg.split(">")
            page.mouse.move(*parse_point(start, self.viewport))
            page.mouse.down()
            page.mouse.move(*parse_point(end, self.viewport), steps=12)
            page.mouse.up()
        elif name == "tap":
            x, y = self.canvas_point(arg)
            if page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.id", [x, y]) != "world":
                raise CaptureError(f"tap at {x:g},{y:g} is outside the canvas or covered by a panel")
            page.mouse.click(x, y)
        elif name == "key":
            key, _, hold = arg.partition("@")
            self.locate("#world").focus()
            page.keyboard.press(key.strip(), delay=float(hold or 250))
        elif name == "settle":
            self.settle()
        elif name == "wait":
            page.wait_for_timeout(float(arg))
        elif name == "eval":
            page.evaluate(arg)
        elif name == "shot":
            self.shot(arg)
        else:
            raise ValueError("unknown step name")

    def shot(self, suffix: str = "") -> None:
        file = f"{self.name}-{self.profile}{'-' + suffix if suffix else ''}.png"
        path = Path(self.args.out) / file
        state = self.page.evaluate(STATE_JS)
        self.page.screenshot(path=str(path))
        if not path.is_file() or path.stat().st_size == 0:
            raise CaptureError(f"screenshot was not written: {path}")
        self.shots += 1
        fell_back = self.args.renderer == "webgpu" and state["backend"] != "webgpu"
        record = {
            "file": file, "scenario": self.name, "profile": self.profile,
            "viewport": {"width": self.viewport[0], "height": self.viewport[1]},
            "url": self.page.url,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "requestedRenderer": self.args.renderer, "webgpuFellBack": fell_back, **state,
            "browserChannel": self.args.browser_channel,
            "consoleErrors": list(self.console_errors), "pageErrors": list(self.page_errors),
        }
        if record["presentation"] is None:
            del record["presentation"]
        self.records.append(record)
        write_records(self.args.out, self.records)
        print(f"captured {path}  backend={state['backend'] or '?'} detail={state['detailName']}"
              f" active={state['active']} pending={state['pending']}")
        if fell_back:
            print(f"WARNING: {file}: WebGPU was requested but the page rendered with "
                  f"{state['backend'] or 'no backend'}: {state['fallbackReason']}", file=sys.stderr)
        if state["error"]:
            raise CaptureError(f"page reports an error: {state['error']}")

    def run(self, steps: list[str]) -> None:
        self.page.goto(self.args.url, wait_until="load")
        self.settle()
        for step in steps:
            try:
                self.step(*(part.strip() for part in step.partition(":")[::2]))
            except ValueError as error:
                raise CaptureError(f"bad step '{step}': {error}") from None
        if not any(step.partition(":")[0].strip() == "shot" for step in steps):
            self.settle()
            self.shot()
        if self.page_errors:
            message = f"uncaught page error: {self.page_errors[0]}"
            if not self.args.allow_errors:
                raise CaptureError(message)
            print(f"WARNING: {self.name}-{self.profile}: {message}", file=sys.stderr)


def split_steps(text: str) -> list[str]:
    parts = (part.replace("\\;", ";").strip() for part in re.split(r"(?<!\\);", text))
    return [part for part in parts if part]


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="address of the running build")
    parser.add_argument("--out", required=True, help="output directory (created if missing)")
    parser.add_argument("--scenario", default="", help=f"comma-separated: {', '.join(SCENARIOS)}")
    parser.add_argument("--steps", help="custom steps separated by ';'")
    parser.add_argument("--name", default="custom", help="file name stem for --steps (default: custom)")
    parser.add_argument("--profile", default="desktop", help=f"comma-separated: {', '.join(PROFILES)}")
    parser.add_argument("--width", type=int, help="viewport width override")
    parser.add_argument("--height", type=int, help="viewport height override")
    parser.add_argument("--renderer", choices=("webgl2", "webgpu"), default="webgl2")
    parser.add_argument("--timeout", type=float, default=120, help="seconds per wait (default 120)")
    parser.add_argument("--allow-errors", action="store_true", help="report page errors as warnings")
    parser.add_argument("--chromium", default=os.environ.get("ADVISOR_CHROMIUM"),
                        help="Chromium executable (default: env ADVISOR_CHROMIUM)")
    parser.add_argument("--browser-channel", choices=("chrome", "msedge"), help="installed browser channel with its native adapter")
    args = parser.parse_args(argv)
    args.profiles = [name.strip() for name in args.profile.split(",") if name.strip()]
    names = [name.strip() for name in args.scenario.split(",") if name.strip()]
    for name, known in [(n, PROFILES) for n in args.profiles] + [(n, SCENARIOS) for n in names]:
        if name not in known:
            parser.error(f"unknown name '{name}'; choose from {', '.join(known)}")
    if not names and not args.steps:
        names = ["village"]
    # Each job is (file name stem, steps); --steps runs after any named scenarios.
    args.jobs = [(name, split_steps(SCENARIOS[name])) for name in names]
    if args.steps:
        args.jobs.append((args.name, split_steps(args.steps)))
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    failures = 0
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))  # close the browser when terminated
    write_records(args.out, records)
    with sync_playwright() as playwright:
        browser = launch(playwright, args.renderer, args.chromium, args.browser_channel)
        try:
            for profile in args.profiles:
                viewport = (args.width or PROFILES[profile][0], args.height or PROFILES[profile][1])
                context = browser.new_context(
                    viewport={"width": viewport[0], "height": viewport[1]}, device_scale_factor=1)
                context.set_default_timeout(args.timeout * 1000)
                if args.renderer == "webgl2":
                    context.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined, configurable: true})")
                for name, steps in args.jobs:
                    session = Session(context.new_page(), args, name, profile, viewport, records)
                    try:
                        session.run(steps)
                    except (CaptureError, PlaywrightError) as error:
                        failures += 1
                        reason = str(error).strip().splitlines()[0]
                        print(f"FAILED {name}-{profile} after {session.shots} image(s): {reason}",
                              file=sys.stderr)
                    finally:
                        session.page.close()
                context.close()
        finally:
            browser.close()
    print(f"{len(records)} image(s) written to {args.out}; {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
