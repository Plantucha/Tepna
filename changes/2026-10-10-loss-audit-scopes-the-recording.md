---
bump: minor
type: fixed
brief: NIGHT-IS-THE-RECORDING-2026-10-05-BRIEF.md
---

The loss audit examined ONE folder's files while the judge grouped by the RECORDING, so a night whose
Polar streams began after midnight was audited in halves. Both audits now enumerate the recording's
folder set — the same `recording_scope`/`in_band` grouping the judge and the Nights page use, never a
second definition — at all five previously per-folder globs.

That moved the cross-folder boundary INSIDE one audit, where `loss_audit.boundary_gap` already judges
between-files gaps, so the delay-versus-loss discrimination is unchanged and the boundary is counted
once. The stitcher it replaces then published a false reason: handed one real audit and one empty side
it answered "one side audited no file for this device", which the judge stored as `seam_unassessed` —
"not assessed" about a seam that HAD been assessed, on every cross-folder night. An absent seam row now
carries `seam_source`: `single-audit`, `stitched` or `unassessed`, so continuity reads a reason instead
of a silence (§∅). The two-audit stitching is superseded, not deleted — audits already on disk still
carry the old shape and `seam_gap` still judges it.
