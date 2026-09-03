<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
`pat-window-oracle.mjs pick()` selected the LARGEST `_ECG.txt` and the LARGEST Verity `_PPG.txt` in
two INDEPENDENT size-sorts, so on a fragmented night the two winners came from different hours, the
trains did not overlap, and the oracle refused — a TOOL artifact reported as a data verdict.

**This refutes my own §5 lead.** From #2052's un-blinding I filed "15 of 48 box nights have NO
ECG/PPG overlap — a capture-session fact". It was this function. Heron's probe inverted it; I
verified independently before building (my largest-pair / best-pair / night-level numbers match
theirs exactly on 4 spot-checked nights).

- **Pair by temporal OVERLAP**, spans read from 8 KB at each end of a fragment (never a parse).
  Largest-of-each stays the default, so single-fragment nights and unreadable-span nights are
  byte-identical; only a strictly positive overlap displaces it, ties broken on combined size for
  determinism.
- **`statSync(p).size` instead of `readFileSync(p).length` inside the sort comparator** — the old
  form fully read every candidate O(n log n) times to learn a size (237 PPG fragments on 2026-08-16).
- **The `no overlap` refusal now carries its own evidence** — both trains' extents and the gap — so
  a genuine disjoint night is distinguishable at a glance from a pairing artifact, which is the
  confusion that produced the false lead. Selftest tightened to REQUIRE the extents and gap.

Measured on the 48-night box tree, paired diff keyed by night against a baseline captured from
untouched `main`: bare "no overlap" refusals **15 → 0**; **14 nights newly score**; **27 of 29**
previously-scoring nights unchanged; the 2 that changed did so on strictly greater overlap —
2026-07-31 (0.65→0.87 h, n 1029→1245, narrowSD 38.1→29.0) and 2026-08-18 (0.86→1.54 h, n 315→1982,
mode 355→815 ms ⇒ artifact refusal; ECG side unchanged, PPG fragment swap, and NOT a clock-step
artifact — 3,461,952 samples scanned, zero counter steps >2000 ms).

NOT done, deliberately: concatenating fragments per stream (a concatenated train spans
inter-fragment gaps, so lags across a gap are meaningless). 2026-08-20 still refuses and should:
its trains are genuinely disjoint by 2 min.

Also stamps FOLLOWUPS §2.4 (dormant sweep executed: 23 real flags, ZERO false) in the same PR.
