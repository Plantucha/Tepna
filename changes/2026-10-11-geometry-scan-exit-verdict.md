---
bump: patch
type: fixed
brief: none
---

Make `geometry-scan` exit 2 when a directory cannot be scanned instead of printing `ERROR:` and returning 0, emit one `tepna.verdict/1` whose NOT_RUN says nothing was examined, name the no-ECG-file skip so it is excluded from the population rather than counted as a clean scan, and re-bin its now-false `word-only` adoption row.
