# Screenshot Tool

`tools/screenshot_tool.py` captures visual evidence for the current GitHub Pages build with Selenium/headless Chrome.

## GitHub Actions

Run **Actions → Visual Evidence → Run workflow**, or comment on a GitHub Issue:

```text
/visual-evidence static
/visual-evidence responsive-cycle
/visual-evidence panel-cycle
```

Issue-comment runs capture the public build and upload `tools/screenshots/` as a workflow artifact.

Manual workflow runs may enable **publish_to_main**. When enabled, the tool uses its guarded Git publisher and keeps at most 20 screenshots and 20 metadata/evidence files.

## Current-build compatibility

The tool automatically starts a campaign when the current DOM exposes `#newCampaignButton`. Evidence includes campaign state, game date/time, protagonist location/sprite load state, visible terrain tile counts/types, and the current geographic hierarchy.

Legacy scenario names from the previous project tool are retained. Camera/NPC scenarios safely report skipped/placeholder actions until those runtime APIs exist again.
