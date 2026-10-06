---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

The Verity survey probe's tests no longer wait out its real 6-second reply timeout, cutting that test file from about 42 seconds to under one; they also pin how the probe writes to the sensor's control point.
