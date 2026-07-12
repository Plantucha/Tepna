<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools, tests]
brief: PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md
---
The Verity gate now says WHOSE fault it is — it used to blame the strap for our own detector bug, and that cost 41% of the corpus.

Executes `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE` §2's open item: *"fix the Verity gate's misdiagnosis,
not just its threshold."*

`sensor-trio-worker.js`'s quality gate rejected **every** failing night as *"Verity unreliable — poor PPG
contact"*. That verdict was wrong, and expensively so: it discarded **7 of the 17 trio nights**, and **five
of them had perfectly good optical signal**. The fault was in *our* detector — TERMA was counting the
dicrotic notch as a second beat, so the optical HR read a clean **2× the truth**. The gate saw a wild σ,
shrugged, and wrote off **41% of the corpus** as a hardware problem. Nobody looked at the detector for weeks.

The two failures are cleanly distinguishable, and the gate now classifies rather than assumes. A pure
`verityFailureClass(hrRatio)` splits on the median HR ratio against the paired ECG corner:

- **`harmonic-double`** (1.5–3.0) → *"OUR DETECTOR is counting the dicrotic notch; the sensor is fine"*
- **`harmonic-half`** (0.33–0.67) → missed beats — also ours, also not the strap
- **`poor-contact`** (near no multiple) → genuinely the sensor

The skip result now carries `failure` + `hrRatio` as machine-readable fields.

**The skip DECISION is byte-identical** — same `σ>12 && r<0.4` condition, only a `{` moved — so the published
Verity σ, the nights-solved count and every aggregate are **unchanged**. What changed is the *verdict*: a
recurrence now says "look at the detector", not "blame the strap".

**The separation is measured, not assumed.** Across all 17 committed trio nights (`ECGDex` vs `PpgDex`
`hrv.time.hr`) the clean band is **0.974–1.012, median 1.000** — reproducing the cited 0.99–1.01 from
committed data and leaving a **0.49 margin** below the doubling threshold, so no healthy night can be
reachable by a "detector" verdict. (The node-local `ppiCorr*` rates would *not* do this: 2026-06-25 is
**correct** at 28.8% while 2026-06-29 is **wrong** at 30.5% — they overlap. The cross-node ratio doesn't.)

Gate-backed: `Verity gate classifies the FAILURE` (15 assertions), verified to red against the pre-fix
worker. **No re-bundle** — `sensor-trio-worker.js` is not inlined into any bundle, so no `manifestHash`
moved and no fixture was re-recorded.

⚠️ **Owed, corpus-machine only:** the *doubling* band (1.5–3.0) rests on the 1.6–2.9 range recorded in the
brief, not on a re-measurement — the raw trio corpus is gitignored and **only 1 of the 17 nights has all
three raw files in the repo**, so the old-DSP re-run that would confirm the 5 doubled nights now label as
`harmonic-double` cannot be done here. Same gitignored-corpus limit `EFFICIENCY-AUDIT-FINDINGS-2026-07-12`
§G1 documents.
