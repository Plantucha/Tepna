---
bump: patch
type: added
brief: none
---

Add a `--pooling` arm to `tools/ppi-jitter-vs-ecg.mjs`. The arm measures the pooling paper's Table 1
over produced epochs. It scores three quality gates on the same epochs, pooled and within nights,
and it emits a verdict on the order reversal the paper claims.
