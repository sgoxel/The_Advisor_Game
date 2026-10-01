#!/usr/bin/env python3
"""Shared Selenium screenshot helpers for exact inner-viewport evidence capture."""
import time

def set_exact_viewport(driver,width,height,attempts=6,tolerance=1):
    width=int(width);height=int(height)
    driver.set_window_size(width,height)
    for _ in range(max(1,int(attempts))):
        inner=driver.execute_script("return {width:window.innerWidth,height:window.innerHeight};")
        iw=int(inner.get("width",0));ih=int(inner.get("height",0))
        if abs(iw-width)<=tolerance and abs(ih-height)<=tolerance:
            return {"width":iw,"height":ih}
        outer=driver.get_window_size()
        driver.set_window_size(
            max(240,int(outer.get("width",width))+(width-iw)),
            max(240,int(outer.get("height",height))+(height-ih))
        )
        time.sleep(.08)
    inner=driver.execute_script("return {width:window.innerWidth,height:window.innerHeight};")
    iw=int(inner.get("width",0));ih=int(inner.get("height",0))
    if abs(iw-width)>tolerance or abs(ih-height)>tolerance:
        raise RuntimeError(f"exact viewport calibration failed: requested {width}x{height}, got {iw}x{ih}")
    return {"width":iw,"height":ih}
