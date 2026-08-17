---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`mutation-crawl.mjs --status` reported a **failed sweep as a finished file with nothing left to do**.

Measured 2026-08-16. `integrator-dsp.js` timed out at **717/1845 mutants after 354 minutes**
(`spawnSync node ETIMEDOUT`). The summary rendered:

```
integrator-dsp.js      killed undefined/NaN   survivors 0   KILLABLE 0

  172 killable of 1740 survivors across 6 file(s)
```

Six hours of work lost, presented as a clean file — and counted in the fleet total as though it had
contributed. A reader deciding "is the crawl done?" sees six files and no warning.

**The result file was honest the whole time.** It carries `complete: false` and the error, so resume
correctly re-runs the file; the tool fails closed where it matters. Only the SUMMARY lied — which is
the worse place for it, because resume is read by the tool and the summary is read by a person.

**The renderer already had two sibling guards and simply lacked the third:** `j.voided` prints
`⚠ VOID`, `j.probeFailed` prints `⚠ UNMEASURED`, and both `continue`. A sweep that failed outright
fell through to the normal row, where `(j.findings || [])` is empty and every reduce returns 0. Now:

```
integrator-dsp.js      ⚠ INCOMPLETE — sweep did not finish: spawnSync node ETIMEDOUT  (re-run to resume; NOT counted below)

  172 killable of 1740 survivors across 5 file(s)   (1 excluded above — void, unmeasured or incomplete)
```

**The footer was a second, separate instance of the same bug.** It counted `files.length` — every
result file, including the void and unmeasured ones the loop had deliberately skipped — so it claimed
six while five contributed. It now counts what was actually summed and states how many were excluded,
rather than quietly shrinking the denominator. Fixing only the row would have left the total wrong.

This is the failure shape this repo keeps paying for: **a check that reports cleanly about something
it never examined.** Here it was a report about work that never finished.

Verified against the real failed crawl, not a synthetic one. Selftest green; no behavioural change to
sweeping, probing or resume.
