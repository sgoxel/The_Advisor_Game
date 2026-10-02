#!/usr/bin/env python3
"""Durable WP-S003-010-003-011 evidence runner.

The underlying acceptance test intentionally performs an expensive deterministic
world rebuild for an independent second Campaign SEED. Chrome can keep its main
thread busy long enough that Selenium's default HTTP command transport times out
before the authoritative readiness probe can return. This wrapper changes only
WebDriver command timeouts; it does not weaken or bypass any gameplay assertion.
"""

import test_wp_s003_010_003_011 as wp


_BASE_DRIVER_FOR = wp.driver_for
_COMMAND_TIMEOUT_SECONDS = 480


def hardened_driver_for():
    driver = _BASE_DRIVER_FOR()
    # Selenium 4.50 reads this value for every HTTP command. The second-SEED
    # rebuild is synchronous and can legitimately keep execute_script waiting
    # longer than the default 120 seconds on hosted runners.
    client_config = getattr(driver.command_executor, "_client_config", None)
    if client_config is not None:
        client_config.timeout = _COMMAND_TIMEOUT_SECONDS
    driver.set_script_timeout(_COMMAND_TIMEOUT_SECONDS)
    driver.set_page_load_timeout(_COMMAND_TIMEOUT_SECONDS)
    return driver


wp.driver_for = hardened_driver_for
wp.main()
