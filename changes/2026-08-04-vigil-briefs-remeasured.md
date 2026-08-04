<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md
---

Reconcile two never-annotated VIGIL briefs against the live box. Both had sat at a bare `PROPOSED`
since 2026-07-20, and the box has since been **replaced**, so their measured numbers describe hardware
that no longer exists.

`VIGIL-OBSERVED-ERRORS` reclassified **PROPOSED → REFERENCE** (living field-observation record). It
proposes no code by its own statement — *"it is the evidence other briefs execute against"* — so it was
never executable and `PROPOSED` was the wrong status. Its E2 heading still read "fix exists, UNMERGED";
verified by commit identity that `f43122b` is an ancestor of `origin/main` via PR #286. Of its next-steps
list, items 1/3/4/6 are closed and two remain: `alerts.webhook_url` (owner config) and E1's real-night
validation, which needs the fault to recur — noting that `VIGIL-OVERNIGHT-FINDINGS`' watchdog is the
*adapter* watchdog, a different mechanism, and is not E1 validation.

`VIGIL-OFFLOAD-AND-RETENTION` stays PROPOSED — correctly, the requirement is unmet — but all three of its
stated blockers moved. Disk pressure is gone (19 G of 98 G, 20 %, against the recorded 17 G of 158 G at
90 %); the unmounted-removable-disk blocker is superseded because `archive` is now deliberately unset
(`config.yaml:14` points at the monitor's Storage card); the owner decisions are unchanged. The core
deliverable is measurably not happening: 0 `.archived` markers across 11 night directories.

Retention is explicitly *not* claimed to work: 11 nights against `keep_nights: 14` means pruning is not
yet due and the snapshot proves nothing. A first pass counted 16 "nights" by including `cpap`,
`device-mirror`, `stored`, `status.json` and `watchdog.log`; corrected to 11 before publishing.
