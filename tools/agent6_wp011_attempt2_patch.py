#!/usr/bin/env python3
from pathlib import Path

path = Path("tools/test_wp_s003_010_003_011.py")
text = path.read_text(encoding="utf-8")
old = '''    options.add_argument("--window-size=1280,800")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=options)
'''
new = '''    options.add_argument("--window-size=1280,800")
    # Do not make Selenium's navigation command synchronously own the full
    # deterministic world rebuild. wait_ready() below is the authoritative
    # readiness gate and has explicit, observable timeouts.
    options.page_load_strategy = "none"
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=options)
'''
if old not in text:
    if 'options.page_load_strategy = "none"' in text:
        print("WP011 attempt-2 harness patch already present")
    else:
        raise SystemExit("driver_for anchor not found")
else:
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("patched WP011 evidence navigation strategy")
