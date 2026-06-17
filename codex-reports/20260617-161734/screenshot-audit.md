# Screenshot Audit

Date: 2026-06-17

## WeChat DevTools Checks

- Checked PATH for `cli.bat`: not found in PATH.
- Checked known install path: `D:\微信web开发者工具\cli.bat` exists.
- Checked known exe path: `D:\微信web开发者工具\微信开发者工具.exe` exists.
- `cli.bat open` succeeded against the miniprogram project.
- `cli.bat auto --auto-port 9422 --trust-project` succeeded.
- `miniprogram-automator` connected to `ws://127.0.0.1:9422` and could route pages.

## Blocker

WeChat DevTools did not render the simulator in this local session. The visible IDE stayed on the code/resource manager surface.

Observed errors:

- With the original `miniprogram/project.config.json`, preview/debug reported `appid missing`.
- A temporary local-only `appid: "touristappid"` test was rejected by this DevTools build with `更改 AppID 失败 touristappid`.
- `App.captureScreenshot` from automator hung and did not return an image.

The temporary AppID change was removed and is not part of the code changes.

## Generated Files

- `output/ui-fix-campus-ai-school/00-wechat-devtools-appid-missing.png` records the DevTools/AppID blocker.
- `output/ui-fix-campus-ai-school/05-campus-map-editor.png` is a valid local browser screenshot of the map editor.
- The other numbered WeChat window PNGs in `output/ui-fix-campus-ai-school/` are DevTools window captures from the failed simulator session and should not be treated as valid simulator UI screenshots.
