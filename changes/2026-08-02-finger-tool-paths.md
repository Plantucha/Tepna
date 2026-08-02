<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md
---
Both O2Ring finger validation tools were **unrunnable anywhere**, and had been since the commit that added them.

`tools/o2ring-finger-validate-batch.mjs` and `tools/o2ring-finger-roundtrip.mjs` each hardcoded an absolute path to the author's throwaway worktree:

```js
const ROOT = '/run/media/michal/647A504F7A50205A/wt-fingerval';   // batch
const ROOT = '/run/media/michal/647A504F7A50205A/wt-fingerrt';    // roundtrip
```

Those worktrees were removed the day they were created, so both tools have thrown `ERR_MODULE_NOT_FOUND` on their first import ever since — **including for the author**. Meanwhile two briefs cite them as evidence: `PPGDEX-O2RING-FINGER-SITE` §6 for its hardware round-trip, and `O2RING-FINGER-HRV-VALIDATION` for the ≥10-night tier call it is blocked on.

Nothing caught it. They are operator sweeps over gitignored captures, so no gate runs them — and **a tool no gate runs is a tool nobody notices is dead.** Same family as the repo's recurring finding that a passing gate is not evidence: here, a *committed* tool is not a working one.

`ROOT` is now derived from the file's own location (`dirname(fileURLToPath(import.meta.url))`), which is what every other tool in `tools/` does.

**A second defect, found by running it:** the batch tool assumed every argument is a directory, so the obvious invocation — `tools/o2ring-finger-validate-batch.mjs captures/*` — died on `ENOTDIR` against the `status.json` sitting beside the session folders, before a single row printed. It now filters to directories and exits with a usage message when none are given.

Verified by running, not by reading: on `2026-07-25` the repaired batch tool produces real three-way rows — PPG-HR vs the ring's own 1 Hz HR vs paired H10 ECG, e.g. `45.6 / 46.0 / 45.9` over a 644 s window (Δring 0.4, ΔECG 0.3), 501 feet, single-channel, PASS.

Tools only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
