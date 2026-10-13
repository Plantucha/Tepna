---
bump: patch
type: fixed
brief: none
---

**The journal template count in `loss_audit.py` carries a tally reason, so `verify:astgrep` passes on main again.**

#3476 added `counts[t] = counts.get(t, 0) + 1` in `capture-host/loss_audit.py`. The line counts journal lines per template. The key is absent only when the count is zero, so the default is the measurement. `tools/astgrep-allow.json` now lists the site under the `tally` reason. Before this entry, `npm run check` stopped at `verify:astgrep` and did not run the steps after it.
