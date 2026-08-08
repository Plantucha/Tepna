<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `GENERATOR-FOLLOWUPS-II-BRIEF.md` (§3 executed 2026-08-08)

# Generator follow-ups, Round III — what §3's execution surfaced

Three items, none blocking. Round II is DONE; these are what turned up while building it.

## 1. A whole class of "intentional" decisions may be file-placement accidents

§3 was parked for months as a product-value question — *is raw-µV multi-night coherence a real need?* —
and §0 recorded it as **"DECIDED: deliberately single-recording."** Executing it showed the cause was
that `renderECGInt16` sat in **`cohort-full.js`, a FULL-lane-worker file `ECGDex.src.html` cannot
load**. The capability existed; the app could not reach it. Nobody decided anything.

Two of the brief's own statements about its subject were also wrong (the renderer was "not factored
out" — it was; the decision comment "on `ecgdex-app.js genSynthetic`" — never existed, over all
branches). **Worth a sweep:** grep the briefs for parked items justified by capability claims, and
check the claim before re-affirming the park. `AUDIT-PROMPT.md`'s bug-classes could carry this one —
*a limitation asserted in prose that no code enforces and no measurement supports.*

## 2. The other nodes' renderers may have the same reachability problem in reverse

The lift put `SYNTH.renderECGInt16` beside `renderPPG` / `renderOxy` / `renderXYZ`. Worth checking
whether any OTHER renderer is still only reachable from a worker file, and whether any node is
single-recording for the same accidental reason ECGDex was. `MotionDex` and `CPAPDex` are the
candidates — neither carries a shared-axis `.synth-line` today.

## 3. The 3-night cap is a guess, not a measurement

Capped at 3 because raw µV at 130 Hz is ~3.4 M Int16 samples/night against an O2Ring night's ~1 k
rows — a size *argument*, not a measured browser limit. Nobody has profiled 3 nights of real ingest in
the app. Either measure it and set the cap from the number, or say in the control's `title` that it is
a conservative guess. Do **not** raise it on intuition; §3's own note that "ECG at ~130 Hz over many
nights is large" is the only evidence behind it.

## Done when

- [ ] §1 sweep run: parked briefs whose justification is a capability claim, claim re-checked.
- [ ] §2 answered for MotionDex + CPAPDex — accidental or deliberate, recorded either way.
- [ ] §3 cap either measured or labelled as a guess in the UI.
