---
bump: minor
type: added
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

**The buzz fiducial's numbers land with their apparatus: `tools/buzz-onset-extract.mjs` + the brief's
measured-results section (§5) covering all three 2026-08-19 runs.**

The tool extracts commanded-buzz onsets from capture-host ACC / ring-motion streams (high-frequency
energy vs a MAD-robust pre-command baseline) and reports per-fire command→onset latency plus pairwise
inter-device onset deltas. Selftested (7): planted VARIED latencies recovered within 2 samples, a
burst-free window REFUSES rather than inventing an onset, a planted +150 ms inter-stream offset is
recovered, truncated baselines refuse. Verified to reproduce the night's ad-hoc analysis on the real
run-C windows (H10 5/5, median +0.147 s, SD 25 ms; Verity−H10 +193.5 ± 64 ms).

The measured verdicts now in the brief:
- **±25 ms per fire on the rigid-coupled leg (H10 SD 22–33 ms), ~±10 ms per 5-fire pattern** — the
  resolution the marker can claim, stated from data (Done-when box 2 checked).
- **2b done beyond spec**: ring→H10 5/5, ring→Verity 4/5, and the 3-way stack detected in both Polar
  ACCs — including the FIRST direct shared-event measurement of the known ~0.2 s H10↔Verity
  systematic: **+193.5 ± 64 ms (SE, n=4)**.
- Honest misses recorded: the cross-device ≤30 ms per-event band is NOT yet met (129 ms, estimator
  noise on the Verity's slow-rising artifact — a matched-filter estimator over the same data is the
  owed fix, not new captures), and the ring hears its own motor worst (three-run pattern).

Analysis tooling + docs only — no bundle, manifest, or fixture moves.
