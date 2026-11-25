---
bump: patch
type: fixed
brief: none
---

`tools/ai-probe-overnight.sh` stops at `AI_PROBE_DEADLINE` and exits 4, so a supervisor no longer kills it without a verdict.
