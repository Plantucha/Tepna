<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
ECGDex's `cvhrIndex` counts events per hour of OBSERVED recording, not per hour of wall span — a
dropout no longer deflates an apnea-screening surrogate on unchanged physiology (DEEP-AUDIT-VI F3).

**The defect:** `detectCVHR` divided by `tt[N-1]/3600`, the gap-folded wall span, so sensor dead time
sat in the denominator of a registered, Integrator-consumed metric (`ecgdex-registry.js` '/h',
emerging; read by `integrator-dsp.js` and the PB-consensus observer). The audit's reproduction: a
1.5 h dropout in a 3 h night halved the shipped index (29.7 → 14) while meanRR/rMSSD/SDNN beside it
correctly ignored the same dead time.

**The fix:** events can only ARISE in covered seconds — the 1 Hz resample holds HR flat through a gap
— so covered time is the coherent basis, and it is the convention already stated in-repo by OxyDex's
ODI ("per hour of analyzable recording"). `detectCVHR(nn, tt, activeSec)` takes the observed seconds
as an OPTIONAL LAST argument (§🧪 back-compat: a legacy two-arg caller still computes, on the span,
because that is all it supplied; `activeSec = 0` falls back to the span rather than dividing by zero),
and `analyze()` passes `nnRes.activeSec` — the same seconds `durSec` is built from.

**The basis travels with the number:** `cvhr.denomSec` through the analyze reshape, and
`apnea.cvhrHours` on BOTH builders — `ecgBuildNodeExport`'s rich block and the app lane's `buildV2`,
per that block's own SHARED-SHAPE no-divergence mandate — attached only when the index was computed.
A refusal (N < 60) carries no denominator: there is no basis for a number it did not compute, and the
no-null-key discipline keeps the refusal path byte-stable. The common (non-rich) Ganglior stream is
unchanged; it never carried an apnea block.

**Measured.** Planted geometry: 119.7 gap-free vs 119.4 with 1.5 h dead, against a wall-span quotient
of 59.7. Through `analyze()` on the 3 h synthetic: a folded 1.5 h gap grows the span 3.0 h → 4.5 h
while the denominator stays at the base's ~2.98 observed hours and the index moves 29.8 → 29.5. 21
assertions pin the class, including the DEFECT direction at both the unit and the analyze level so a
future "simplification" back to the span cannot pass. The analyze-level leg earned its place
immediately: `denomSec` was returned and read and reached nothing, because the analyze result reshape
is an allowlist — the source-scan assertion passed while the wire was dead.

No fixture moved (no committed ECGDex golden is a long non-ambulatory night, so none carries an
`apnea` block). The identical two lines in PpgDex's `cvhrFromNN` stay open under F3 as their own
change, as the brief specifies.
