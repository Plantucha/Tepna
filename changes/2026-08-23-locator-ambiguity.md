---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`functionRange` returned the FIRST match for an ambiguous name and said nothing — the exact failure
§10.5 records as already costing a run ("mutated `computeRMSSDarc` and reported the result under the
name of a function it had never touched"), and which §10.5's own remedy names: fail loudly when the
pattern is absent or ambiguous.

Not hypothetical. `oxydex-dsp.js` declares `_median` twice, at lines 1900 and 7168, in different
scopes and with different bodies — one returns null on an empty array, the other does not. Measured
across the fleet: 20 of 940 function names are ambiguous under this locator, including `A` matching 5
declarations in `integrator-dsp.js`.

Both copies of the primitive now refuse, naming every line. Absent still returns null — "no such
function" is actionable; "one of five" is not. The CLI turns the refusal into a message with exit 2
rather than a stack trace, because a traceback reads as "the tool is broken" and gets retried.

Analysis tooling only; no shipped bundle changes.

⚠️ **The guard shipped without a control, and re-application is what found it.** Disabling the
`hits.length > 1` refusal left every existing selftest passing in BOTH tools — which is exactly how a
loud-failure guard rots back into a silent first-match, and the failure §10.5 was written to prevent.
Three assertions added per tool: a duplicated name refuses, the refusal states how many definitions it
found (so the caller can see the collision), and an unambiguous name is unaffected. Verified by
re-application in both files: with the refusal disabled, two assertions fail in each.
