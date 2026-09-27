---
bump: patch
type: fixed
brief: none
---

A module-global `asyncio.Event` no longer carries a loop binding out of a test. `Event.wait()` binds to the running loop when reached with the flag unset, `asyncio.run` then closes that loop, and `clear()` leaves the binding — so one test poisoned the next with `RuntimeError: bound to a different event loop`. The suite-wide fixture now recreates `capture`'s module-global events per test rather than clearing them, which `test_capture_runners.py` already did file-locally for its own callers only, and `_main_with_cfg` stops `main()` deterministically instead of racing it. Closes residue `2026-09-27-a-module-global-asyncio-event-keeps-its-loop-binding-between-tests`.
