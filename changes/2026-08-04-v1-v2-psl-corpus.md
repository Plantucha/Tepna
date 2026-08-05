<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md
---

Measure V1–V3 against the Polar Sensor Logger corpus. The blocker on V1/V2 was "we have no vendor export
to diff against"; there is one, 19 GB of it, at `Ecg nightly/` on the working volume.

The box writes the same physical devices (Verity `0C301E3F`, H10 `02849638`) with identical headers and
declared units, decoded by the reverse-engineered `polar_pmd.py`, so the two compare directly. Different
sessions, so the comparison is over physical invariants rather than rows.

H10 ACC: median |a| is 996.2 mg from the box against 992.5 mg from PSL — both ≈ 1 g, agreeing to 0.4 %.
Because |a| = 1 g at rest is a hard invariant, a wrong scale factor could not hide, so V2's units question
is answered. MAG confirms units (G) and order. Resting gyro magnitude is explicitly NOT treated as a scale
proof: it is bias and noise, not a physical constant.

What this does not close, stated in the brief: V1's first claim is that the UNCOMPRESSED GYRO/MAG branches
are untested, and this corpus cannot fix that — the Verity streams delta frames, so both sides exercised
the delta path.

V3 is confirmed dead with numbers rather than left as an assertion: 107 PPI files totalling 102 rows,
header-only, none with more than 100 rows. That is positive evidence for the claim that the unit accepts
PMD START and streams nothing. Counting files would have read as "107 PPI recordings, V3 unblocked".
