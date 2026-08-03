<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools]
---
Merging PPG sessions of different sample rates doubled a night's heart rate.

`trio-batch`'s `mergePpg` concatenates every concurrent session and stamps **one** `fs`. It took
`recs[0].fs` and validated only channel count and site — so a night whose sample rate changed part-way
was merged under whichever rate happened to come **first**, which is usually a short pre-sleep fragment
rather than the rate the night was actually recorded at.

Measured 2026-08-03. The Verity moved 55 Hz → 176 Hz at 21:54; the fold merged 18 sessions spanning
both and declared `fs = 55` over data that was overwhelmingly 176 Hz. Beat detection derives its
refractory window in **samples** from `fs`, so the window came out 3.2× too short in real time, a second
peak per cardiac cycle was accepted, and the night exported a mean HR of **108.6 bpm against the chest
ECG's 52.1** — a clean 2.08×.

**Nothing errored.** The three-cornered hat then faithfully reported the Verity as the night's worst
sensor (σ 3.37 bpm) and named it "culprit". A fold bug had become a false finding about hardware, and it
survived every gate because a doubled HR is a perfectly plausible number.

The fix drops the minority-rate sessions rather than throwing (the ECG path refuses outright, but there
the dominant rate carries almost the whole night and refusing would discard a good recording over a few
minutes of fragments), keeps the **longest** session's rate rather than the first, and logs what went.

`deviceACC`'s uniform grid takes the same correction for a different reason: its index **is** a time, so
mixed rates already align — but the grid *resolution* came from `accRecs[0]`, so a later, faster session
would round two samples into one slot. It now takes the finest rate present. A finer grid only costs
holes, which the DSP already treats as missing rather than as stillness.

**After the fix, on the same night:** mean HR 108.6 → **52.2** (ratio 2.08 → 1.00), σ[PpgDex] 3.37 →
1.84, and — unprompted — the H10↔Verity clock leg went from **VOID** (3-source closure −28.2 ppm,
`INCONSISTENT`, weak leg VER-O2R, correlation 57 %) to a real measurement: closure **−0.9 ppm,
consistent, all legs confident**, correlation **100 %**. The mis-timed beats had been corrupting the
drift fit too.

Tools-only — no bundle, no `manifestHash` movement, no fixture re-recorded.
