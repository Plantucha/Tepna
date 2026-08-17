<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF.md
---

Corrects two false claims this session published earlier today, and records three literature-diagnosis
items as measured rather than open.

THE CORRECTION COMES FIRST BECAUSE IT IS MINE. `CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17` (#1419) §3
reported `HOSTAXIS-STABILITY-2026-08-13` as a stale PROPOSED header, and §6 reported
`tools/doc-search.mjs` as absent from main. Both are false. The brief reads DONE on main and the tool
is on main; I read both from the shared root checkout, which is 248 COMMITS BEHIND origin/main.

Why the checkout is stale matters more than either claim. `tepna-sync-main.timer` runs every 15 min and
is healthy; its service logs `SKIP - 175 uncommitted/untracked path(s) - never sync over someone's
work`. The guard is behaving CORRECTLY - it must not fast-forward over another session's uncommitted
files - but the consequence is that the shared tree froze 248 commits ago, so every session reading a
brief, a DSP or a gate from the root gets a stale copy and cannot tell. The file opens, parses and looks
current. That is a worse failure than the one being reported, and it produced two opposite errors from
one cause: a header read as un-flipped, and a present tool read as absent.

The rule, which is that brief's own thesis turned on itself: a status read from a checkout is a
statement about THAT CHECKOUT, not about main. Read from a fresh worktree or `git show origin/main:`.
Confirm currency with `git status --porcelain` AND the ref count - CLAUDE.md §👥.2b already records that
the ref count alone reads 0 while the tree is hundreds of files stale.

What survives: `WEARABLE-DRIFT-DIRECT-2026-08-02` is genuinely still PROPOSED with 7 of 8 §6 items `[x]`
(the eighth is a `[~]` retraction record, not an open item). The §1 units finding (`atShortestMs` /
`atLongestMs` are ms/s, not ms) and the §2 `dual-clock-rate` raw-spread finding were both re-verified
against origin/main and stand unchanged.

THREE LITERATURE ITEMS, MEASURED:

§2.1's remaining half - "a documented check that the input really is a phase/time-error series" - is
owed, but for ONE device and only confirmatorily. ADEV also requires UNIFORM sampling, and `hostAxis`
takes `tau0 = span/(n-1)`, the mean, so ragged sampling mislabels the whole tau axis silently. Measured
as mean-tau0 / median-spacing across 439 ECG/PPG streams on the 17-night box corpus: H10 0.9999-1.0000
(worst gap 1.0x the median), Verity 0.9999-1.0066 (1.4x), O2Ring 0.9990-1.0510 with a single gap 208x
the median. The Polars satisfy the precondition outright, so a guard there gates a non-problem. The ring
carries up to a 5.1 % tau-axis inflation - a second, independent reason its stability figures mean
nothing, reached without reference to the drawn-axis argument. Publishing `tau0Uniformity` beside
`stability` is the right shape and is a shared-spine change (8 bundles, 8 provenance fragments, and an
ECGDex export move); re-bundling the fleet for a diagnostic that can only confirm an existing refusal is
the wrong trade today, so it rides the next behavioural spine re-bundle.

§3.2's action is NOT triggered. It is conditional on a spectral peak becoming a published significance
claim. Lomb-Scargle appears in four DSPs and feeds `respRate` and the `vlf`/`tp` band powers; there is no
false-alarm-probability, no p-value and no peak-significance machinery in the tree. Band power over a
fixed band is not peak detection, so the precondition for Baluev/VanderPlas null calibration does not
exist. Recorded so the next reader spends the search once.

§7.8's mechanical correction-chain check was ATTEMPTED and the obvious form is HOLLOW. The natural gate -
a paper carrying a correction marker must carry one outside the abstract - was tested against its own
motivating instance and WOULD HAVE PASSED IT: before today's fix `dead-ends.html` held two markers, one
in the abstract (2026-08-13, the ~96 ms artifact) and one in §2.7 itself (2026-07-29, the earlier drift
mis-attribution). The section was corrected, for a different claim. Distinguishing "carries a correction"
from "carries the correction for the claim it still asserts" ties a retracted QUANTITY to the sections
asserting it, which is semantic and not structural. Recorded as a negative so nobody ships it.
