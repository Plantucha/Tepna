<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Fix three cpapdex families by READING their contracts instead of guessing them — 8 → 26 classifications — and record that the fleet map's sampling failed on glucodex.

All three failures had the same cause and it was mine: I invented input shapes.

  oximetryLane   DEGENERATE (1 distinct/55) → 10/10 controls, 18 survivors → 4 distinguishable,
                 14 recorded. `chan(rec, base)` reads `rec.signals` as an OBJECT KEYED BY NAME,
                 walking Object.keys and stripping a `.2s`/`.40ms` suffix. I passed
                 `{channels:[{label,data,fs}]}`, which has no `signals` at all, so every call took
                 the no-spo2-channel arm.
  computeMetrics 0/4 controls → 4/4, 7 survivors → 3 distinguishable, 4 recorded. The real contract
                 is six fields (usageHours, fs, pressure, pressureMaskOn, leakMaskOn, events); I
                 supplied two, so the mask-on latency scan, the percentile helpers and all four
                 event-rate calls were unreachable.
  _synthEdfSet   STILL DEGENERATE. It reads exactly ONE option — `opts.oxi` — and my first draft
                 passed 19 invented keys (seed/ahi/leak/records/mode/csr), every one ignored. Varying
                 `oxi` did not separate it either, so the remaining cause is elsewhere and it stays
                 UNCLASSIFIED rather than cleared.
  selfGateDesat  still 6/10 even with the pulse crossing PULSE_MIN 30 / PULSE_MAX 220 and straddling
                 the 0.5 validity floor. Not the thresholds; the window semantics need reading next.

The lesson is one I had already written down the same day, in this file's own header, about this very
generator: "its real parameter names have to be READ, not assumed". I wrote that and then assumed
three more. The engine caught all three — a degenerate battery and two control failures — which is
the only reason none of it became a false classification.

⚠️ GLUCODEX: THE FLEET MAP'S SAMPLE IS WRONG, AND THIS IS THE FIRST TIME.
Full sweep: 836 tested, 280 killed, 5 invalid, 551 survivors → 33.7 % (canary NONE). The fleet map's
60-mutant sample reported 55 % (33/60). One standard error on a 60-draw is 6.1 points, so 55 % sits
3.5 SE from the population — not chance. Three files had confirmed the method (ppgdex 33→34.0,
motiondex 37→37.3, cpapdex 40→40.4); this one refutes it for glucodex, and the map's row should carry
the correction rather than the estimate.

Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 · cpapdex 26 = 181.
