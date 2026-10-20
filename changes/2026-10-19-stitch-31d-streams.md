---
bump: patch
type: fixed
brief: none
---

The 31-night stitch in capture-host now streams each night to a temporary file and renames the file into place. Before the fix, `stitch_31d.py` held every row of six tools in memory. It also rewrote all 19 GB of output after every PASS verdict, even when no input had changed. On vigil on 2026-10-19 that rewrite pushed the capture daemon into swap and stalled its loop for 15.7 s, 25.1 s and 25.4 s.

A key file now records the size and mtime of each source, so an unchanged stitch writes nothing. The QC child now runs at niceness 19 in the idle disk class. The daemon's memory line now reports `VmSwap`, so the next swap-out is visible in the log.
