---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`odi4-ahi-bias.html` listed two items as "Remaining before submission" that are now both ruled, and a
decision nobody wrote down is a decision that gets re-derived.

**Owner decisions, 2026-09-15:**

- **§0 stays.** The paper remains a draft *deliberately*. That matters because the obvious inference
  from the rest of the page is the opposite — the NSRR replication is done, the data-use question is
  ruled, §3.2 carries n = 5136 — so a later reader has every reason to conclude the banner is simply
  stale and delete it. It isn't, and the line now says so.
- **The synthetic cohort is re-cut under `cohort-gen/2.0`**, not left pinned at 1.9. Tables 1–2 will
  carry 2.0 numbers; the work is tracked by `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md`.

The line also now carries the bound on what the re-cut can move — 2.0 differs from 1.9 on **99.3 %**
of severe profiles and on **0 of 37,210** non-severe ones — and states that **§3.2 is unaffected**,
because it is the real-PSG analysis and no generator version touches it. Without that, the re-cut
reads as putting the whole paper in question rather than Tables 1–2.

No numbers changed. This edits the paper's own status text and its served twin.
