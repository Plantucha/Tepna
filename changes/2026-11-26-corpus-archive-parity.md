---
bump: patch
type: added
brief: none
---

Add tools/corpus-archive-parity.mjs. It compares the live corpus with the vigil archive by path and size. It reads file sizes only and writes nothing. It emits a tepna.verdict/1 object. The status is FAIL when a stamped stream file in the corpus is shorter than its archive copy.
