#!/usr/bin/env python3
"""Shared Selenium screenshot helpers for exact inner-viewport evidence capture."""
import time

def _inner_viewport(driver):
    inner=driver.execute_script("return {width:window.innerWidth,height:window.innerHeight};")
    return {"width":int(inner.get("width",0)),"height":int(inner.get("height",0))}

def _matches(inner,width,height,tolerance):
    return abs(inner["width"]-width)<=tolerance and abs(inner["height"]-height)<=tolerance

def set_exact_viewport(driver,width,height,attempts=6,tolerance=1):
    width=int(width);height=int(height);tolerance=max(0,int(tolerance))

    # Headless Chrome reserves browser chrome from set_window_size(), so prefer
    # the browser's viewport-level device metrics override. This changes only
    # presentation dimensions; it does not mock DOM geometry or relax evidence.
    try:
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{
            "width":width,
            "height":height,
            "deviceScaleFactor":1,
            "mobile":False
        })
        time.sleep(.08)
        inner=_inner_viewport(driver)
        if _matches(inner,width,height,tolerance):
            return inner
    except Exception:
        pass

    # Portable fallback for non-Chromium/WebDriver variants.
    driver.set_window_size(width,height)
    for _ in range(max(1,int(attempts))):
        inner=_inner_viewport(driver)
        if _matches(inner,width,height,tolerance):
            return inner
        outer=driver.get_window_size()
        driver.set_window_size(
            max(240,int(outer.get("width",width))+(width-inner["width"])),
            max(240,int(outer.get("height",height))+(height-inner["height"]))
        )
        time.sleep(.08)

    inner=_inner_viewport(driver)
    if not _matches(inner,width,height,tolerance):
        raise RuntimeError(
            f"exact viewport calibration failed: requested {width}x{height}, "
            f"got {inner['width']}x{inner['height']}"
        )
    return inner
