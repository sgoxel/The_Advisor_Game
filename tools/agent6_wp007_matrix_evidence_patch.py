#!/usr/bin/env python3
from pathlib import Path

path=Path("tools/screenshot_tool.py")
text=path.read_text(encoding="utf-8")
old='def _settlement_reveal_frame(driver,index,timeout):\n'
new='def _settlement_reveal_frame(driver,index,timeout,viewport=(1280,800)):\n'
if text.count(old)!=1:
    raise SystemExit(f"WP007 frame signature anchor mismatch: {text.count(old)}")
text=text.replace(old,new,1)

anchor='''    set_exact_viewport(driver,1280,800)\n    driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))\n'''
replacement='''    set_exact_viewport(driver,*viewport)\n    driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))\n'''
if text.count(anchor)!=1:
    raise SystemExit(f"WP007 viewport anchor mismatch: {text.count(anchor)}")
text=text.replace(anchor,replacement,1)

anchor='''                print("SETTLEMENT_REVEAL_VALIDATION_DIAGNOSTIC="+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)\n                raise\n        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:\n'''
replacement='''                print("SETTLEMENT_REVEAL_VALIDATION_DIAGNOSTIC="+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)\n                raise\n            # WP007 requires one acceptance matrix: desktop landscape plus true\n            # phone portrait and phone landscape. Keep the existing issue-comment\n            # trigger stable and capture the mobile variants inside the same run.\n            if args.profile=="landscape":\n                matrix={"desktop-landscape":frames}\n                for profile,viewport in (("phone-portrait",(390,844)),("phone-landscape",(844,390))):\n                    profile_frames=[]\n                    for index in range(WP_SETTLEMENT_REVEAL_SHOTS):\n                        frame=_settlement_reveal_frame(driver,index,args.ready_timeout,viewport)\n                        frame["focusPreparation"]=focus\n                        frame["profile"]=profile\n                        path=_file_name(f"{args.filename}-{profile}",index+1,WP_SETTLEMENT_REVEAL_SHOTS,args.timestamp_names)\n                        _capture(driver,path)\n                        frame["index"]=index+1;frame["file"]=path.name\n                        frame["captured_at"]=datetime.now(timezone.utc).isoformat()\n                        profile_frames.append(frame)\n                    matrix[profile]=profile_frames\n                    matrix_path=_screenshots_dir()/f"wp-s003-010-003-007-{profile}-frames.json"\n                    matrix_path.write_text(json.dumps(profile_frames,indent=2,sort_keys=True),encoding="utf-8")\n                    _validate_settlement_reveal_frames(profile_frames)\n                (_screenshots_dir()/"wp-s003-010-003-007-required-profile-matrix.json").write_text(\n                    json.dumps(matrix,indent=2,sort_keys=True),encoding="utf-8"\n                )\n        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:\n'''
if text.count(anchor)!=1:
    raise SystemExit(f"WP007 matrix insertion anchor mismatch: {text.count(anchor)}")
text=text.replace(anchor,replacement,1)
path.write_text(text,encoding="utf-8")
print("WP007 required-profile matrix capture enabled")
