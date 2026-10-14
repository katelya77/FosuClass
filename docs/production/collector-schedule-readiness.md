# Collector timetable page readiness

This increment starts at installed PR #100 `ea27e0cbfb8ebd2f3cd11371abf43193add2a0fa`. Oracle remains on PR #92 and receives no runtime change.

The real loopback Chromium reproduction (`node tools/test-collector-schedule-browser.js`) failed with `TimeoutError` before the class POST: completed background fetches kept the page busy while the term and directory controls were available. This establishes a remaining design defect, not the original school's missing exception.

Only Collector navigation to the four existing `/kbcx/kbxx_*` entry pages now uses bounded `domcontentloaded`, validates the protected document's HTTP status, origin/path, authentication and challenge markers, and waits up to ten seconds for the actual native-API controls. Class discovery requires term, college and grade; the other sources require term and the existing source-specific target selector. Missing/changed controls stop with `SCHOOL_PAGE_CHANGED`. Windows/manual navigation and the CAS adapter retain their previous waits.

Page readiness does not establish data success. The existing endpoint response guard, strict parser, target checkpoint, signed upload and Oracle review receipt remain subsequent gates. The serial request ledger still reserves before release and stops on unknown outcomes; this change cannot replay a pending request.

The regression uses actual class/teacher/classroom/course adapters, asynchronous controls and continuous background traffic. Login/challenge/missing-control pages cannot release a data POST, and an authentication page returned by the data endpoint fails. CI repeats this with external networking physically disabled. The existing adapter fixture now supplies the class controls present in its real entry page.

Installation, a fresh single-group class school window, Oracle task creation and human timetable comparison require separate current approval. Both failed Sample IDs remain retired. This PR cannot enable routine/full, a timer, formal publication or a personal Agent reset.
