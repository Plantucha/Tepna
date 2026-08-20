---
bump: minor
type: added
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

**The instrument that measures the ΔPAT dip index's one open clock gate directly — within-connection
offset stability from a commanded buzz.**

The relative-PAT dip index rests on one assumption (pat-align.js:335): the per-connection BLE offset is
constant within a connection, so a dip cancels it. `pat-connection-stability.mjs` tries to test that from
the arrival sidecar by splitting a connection in half — but the corpus yields only **2 scorable
connections** (fragmentation blocks the rest, and the two disagree 2.7×), so the assumption can be
neither confirmed nor dismissed. That inconclusiveness is a candidate cause of the dip index's
first-night sub-chance result.

`tools/pat-buzz-stability.mjs` settles it a different way: a commanded APERIODIC buzz is one mechanical
event both devices record, immune to the BLE scheduler and to beat pairing. Both streams are host-
stamped from the same host clock, so per buzz the offset = delay_A − delay_B is exactly the inter-device
timing error; the SPREAD of those offsets across a ~20 s within-connection sequence IS the stability the
dip needs. `stable` when the spread sits under the ~15 ms arousal dip it must not swamp (the reframe's own
budget). Pure detect/pair/verdict core, 11 selftest assertions incl. constant-offset→stable,
drift→detected, silent-device→null, and unpaired-onset-dropped controls.

Analysis tool only — no bundle, manifest, or fixture moves. It needs a cross-device buzz capture (ring
touching the H10 pod, aperiodic, within one connection) to run — the apparatus for the PAT resolution.
