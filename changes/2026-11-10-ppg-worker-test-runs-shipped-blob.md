---
bump: patch
type: fixed
brief: none
---

A new PpgDex test runs the worker blob that `_buildWorkerURL` builds, not a rebuild of it. The test requires the blob's peaks, feet and sign to match the serial path. A mutation that empties the shipped blob now fails the test.
