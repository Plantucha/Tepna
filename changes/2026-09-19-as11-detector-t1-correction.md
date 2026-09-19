<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: AS11-AUTO-SESSION-DETECTION-2026-08-24-BRIEF.md
---
Correction to #2679: the AS11 detector did NOT report last night's therapy as quiet — the claim was a
window error, and the detector is in fact the trigger.

The EDF's 00:41 start is the AS11's device stamp (~+21 min against the host; the journal logs that EDF
start at host 00:20:32). Device-stamped bounds were applied to host-stamped detector rows, so rows from
before and after therapy were counted as "during". Redone in host time over every therapy session the
journal bounds (11 sessions ≥ 10 min, 2026-08-31 → 09-19): the detector sighted `Therapy` 3–17 s
BEFORE the stream started on 11/11 — that sighting is what fires `auto_start` — and wrote 0 rows during
therapy on 11/11, because the shadow runner defers while the controller streams. Two witnesses were one
witness, and it was right. The 09-03 "reads Standby through therapy" clause predates auto-start and was
derived against EDF bounds; it is flagged for the same re-derivation before it is cited again.

A window error is a clock error — §7's "one device clock per axis" applied to the analysis instead of
the data.
