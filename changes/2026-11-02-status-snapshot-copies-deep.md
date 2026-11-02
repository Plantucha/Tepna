---
bump: patch
type: fixed
brief: none
---

The `capture.STATUS` snapshot in the capture-host test suite copies deep. It copied one level and its comment claimed that undid a write into `devices`. That holds for an added or rebound key. It is false for the write `capture._set()` makes, which reaches depth two in place, so the snapshot handed back the mutation it existed to undo. Measured against the fixture's own save and restore steps with the real writer. The suite stayed green because `STATUS` holds no device at import, which is a property of `capture.py` rather than of the fixture.
