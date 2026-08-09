---
bump: patch
type: fixed
brief: DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md
---

Six weeks after `ANS Age` and the HRV/oximetry→BP projections were removed suite-wide, the reference
guides still described them to readers: 10 stale caveats warning about a metric that cannot be
computed, 3 dead quick-nav chips pointing at a section that no longer contains them, and 3 date-stamped
removal notes rendered inside reader-facing validation tables.

The citation gate reported "no correction history in a reader-facing registry string" throughout —
truthfully, and about a surface that did not contain the problem. It reads only registry
`cite`/`label`/`unit`. A sibling gate now applies the same regex to the guides' rendered prose; it was
shown to RED on the pre-fix tree before it was shown to pass, and asserts the maintainer-facing
tombstone comments survive, so it cannot be greened by deleting the removal record.

Three dead code paths for the removed metrics (PpgDex's `ansAge()`, OxyDex's hard-null `bpProj` render
branch, a PulseDex comment claiming a deleted function is still used) are verified dead and routed to
their next re-bundle rather than forced into one.
