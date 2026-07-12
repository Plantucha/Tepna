<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md
---
Retire the dead 1.7 / 2.2 / 6.2 σ caption — the tool's prose contradicted the code beneath it, which has planted the raw-ECG 10-night hat (O2Ring 2.72 / H10 1.86 / Verity 1.94) all along.

`sensor-trio-power-analysis.html` advertised *"planted at the real estimates 1.7 / 2.2 / 6.2 bpm"* and
`Science.html` carried the same triple as a headline stat. **Neither matched the code.**
`sensor-trio-power-analysis.js:72-74` plants **O2Ring 2.72 / H10 1.86 / Verity 1.94** — the raw-ECG
10-night broad hat — and `6.2` occurs **zero** times in `sensor-trio-power-analysis.js`,
`sensor-trio-worker.js` or `sigma-no-reference-analysis.js`. The simulation has been running on 1.94; only
the captions describing it were stale.

Provenance of the dead number, now traced: it was an **N=1, single ~2-hour window** estimate — specifically
the 06-16/17 window, which `papers/sigma-no-reference.html` §125 already documents as *"the worst window,
not the typical one"*. `SIGMA-PAPER-REWRITE-2026-07-06` §Do 2 had recorded the supersession chain
(**6.2 → 3.0** device-HR re-fit → **1.94** raw-ECG) and instructed *"re-run
`sensor-trio-power-analysis.html` after"*; Do 1–3 updated the papers, but that trailing step was never
done, so the tool's prose kept the dead value.

Also corrected: the tool still called Verity **"the noisy corner"**. On the raw-ECG hat the noisiest corner
is the **O2Ring** (2.72) and Verity is the **quietest** (1.94) — the "noisy-corner reorder (Verity→O2Ring)"
that `SIGMA-PAPER-REWRITE` applied to the papers but not to this tool. The coupling argument itself is
unchanged (the hat couples the trio, so the noisiest corner sets a shared precision floor) — only the
identity of that corner was wrong.

The 6.2 that REMAINS in `papers/sigma-no-reference.html` is **correct and deliberate** — it documents the
single-window artefact and the lesson drawn from it, and is left untouched.

**No result, figure or estimate changes.** This is prose catching up with code.
