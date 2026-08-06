<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
The monitor's live heart rate said nothing when it stopped being live.

`st.rate` is a persistent EMA, updated only when `detectRs`/`detectPulses` find ≥3 peaks with a plausible
median IBI. `ovValues` resets it when a stream is UNTRUSTED — off-body, on the charger, stalled — so the
uncovered case was a stream that is trusted and whose detector merely loses the beat: a noisy but
genuinely worn sensor. That rate froze and kept rendering pixel-identically to a live one, indefinitely.
VIGIL-DEEP-ANALYSIS Phase 3 named this residue and called it the one to do first, "honesty, not accuracy".

`st.rateAt` is now stamped on the plausibility-gated accept branch (not before it — an implausible IBI
must not refresh the stamp without refreshing the number), cleared alongside `st.rate` when a stream goes
untrusted (or the next rate inherits the age of the one before the gap), and a rate whose evidence has
aged out renders muted with `(stale)`. Labelled, never hidden: the operator is mid-night, and a number
that vanishes reads as a dead sensor.

The threshold is derived rather than tuned. `ovRates` reads a rolling `OV_WIN_S` (5 s) window once a
second, so past that point every sample that produced the displayed number has left the buffer — the
reading is not "slightly old", it is computed from data the page no longer holds, which is exactly the
claim `(stale)` makes. Elapsed time comes from `performance.now()` (`Date.now()` only as fallback): this
is not a Clock-Contract stamp, nothing here is recorded, but a stepping clock would mark a fresh rate
stale or the reverse, and this box's capture clock re-anchored twice in one week.

The tests EXECUTE the shipped functions under node rather than scanning `monitor.html` for a string. The
brief deferred this residue on "no executable test lane… cannot drive a browser", which was half wrong:
that is a property of the code, not the file. A detector needs signal, a canvas and an event loop; the
staleness decision is three pure functions. Confirmed by re-applying three mutants (`>`→`>=`,
`Infinity`→`0`, stamp moved off the accept branch) — each killed by a different test, and a text scan
could not have caught any of them. The IIR-bandpass residue genuinely does need a browser and stays open.
