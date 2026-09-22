---
bump: patch
type: fixed
brief: none
---

`capture-host/mutation_diff.py`'s `root_reads` stages the files a test reads from above `capture-host/`, and missed three ways at once: the candidate set was repo-root regular FILES (so a subdirectory fixture could never match), the scan was `tests/*.py` non-recursively (so a helper naming the path was invisible), and the real reader builds its path from PARTS (so no path-matching rule could see it at all). It now indexes unique BASENAMES of tracked files in subdirectories — which is the only thing actually written down — publishes ambiguous basenames rather than dropping them silently, and refuses absolute paths, `..` and dot segments. Population pinned as an equality at 20, 5.3 MB.
