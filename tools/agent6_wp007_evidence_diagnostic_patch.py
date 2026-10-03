#!/usr/bin/env python3
from pathlib import Path

PATH = Path("tools/screenshot_tool.py")
text = PATH.read_text(encoding="utf-8")
old = '''                frames.append(frame)\n            _validate_settlement_reveal_frames(frames)\n        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:\n'''
new = '''                frames.append(frame)\n            try:\n                _validate_settlement_reveal_frames(frames)\n            except Exception as exc:\n                diagnostic={\n                    "scenario":WP_SETTLEMENT_REVEAL_SCENARIO,\n                    "validationError":repr(exc),\n                    "frames":frames,\n                    "captured_at":datetime.now(timezone.utc).isoformat(),\n                }\n                path=_screenshots_dir()/"wp-s003-010-003-007-validation-failure.json"\n                path.write_text(json.dumps(diagnostic,indent=2,sort_keys=True),encoding="utf-8")\n                print("SETTLEMENT_REVEAL_VALIDATION_DIAGNOSTIC="+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)\n                raise\n        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"WP007 evidence diagnostic anchor mismatch: {count}")
PATH.write_text(text.replace(old,new,1), encoding="utf-8")
print("WP007 validation diagnostics enabled")
