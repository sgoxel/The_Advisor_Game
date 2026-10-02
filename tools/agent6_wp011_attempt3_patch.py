#!/usr/bin/env python3
from pathlib import Path

path = Path("tools/test_wp_s003_010_003_011.py")
text = path.read_text(encoding="utf-8")

old_driver = '''    options.add_argument("--window-size=1280,800")
    # Do not make Selenium's navigation command synchronously own the full
    # deterministic world rebuild. wait_ready() below is the authoritative
    # readiness gate and has explicit, observable timeouts.
    options.page_load_strategy = "none"
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
'''
new_driver = '''    options.add_argument("--window-size=1280,800")
    # A shared runner-local profile lets the independent-seed check restart
    # Chrome without losing the authoritative campaign/planet persistence.
    options.add_argument("--user-data-dir=/tmp/wp011-chrome-profile")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
'''
if old_driver not in text:
    raise SystemExit("attempt-2 driver anchor not found")
text = text.replace(old_driver, new_driver, 1)

old_reload = '''        driver.refresh()
        wait_ready(driver)
'''
new_reload = '''        # A full browser restart avoids coupling a synchronous WebDriver refresh
        # command to the expensive deterministic world rebuild. The persistent
        # profile above carries only the just-written authoritative seed state.
        driver.quit()
        time.sleep(.5)
        driver = driver_for()
        driver.get(TARGET)
        wait_ready(driver)
'''
if old_reload not in text:
    raise SystemExit("second-seed refresh anchor not found")
text = text.replace(old_reload, new_reload, 1)

path.write_text(text, encoding="utf-8")
print("patched WP011 final-attempt independent-seed browser restart")
