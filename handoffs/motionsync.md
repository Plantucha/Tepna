<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
# Handoff — `motionsync` (U4 of DEVICE-TIME-HANDLING)

**Session:** Magpie · **Written:** 2026-10-30 · **State:** DRAFT PR open, gates green

- **Unit:** U4 of `briefs/DEVICE-TIME-HANDLING-2026-10-29-BRIEF.md` — MotionDex rate correction through `DexClock.hostAxis`.
- **Branch:** `claude/motionsync-mg` @ `b739725f2` · **Worktree:** `../wt-motionsync-mg` · **Base:** `6760a24e7` (#4125).
- **PR:** #4127, DRAFT. I never undraft my own PR.
- **Rule 0 query:** `MotionDex hostAxis correctionAt post-resync anchors dropped device counter` → `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF`, `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02`, `RADIO-CLOCK-SIDECAR-2026-09-07`. None wires MotionDex.

## Stopping point

Everything the brief item asks for landed in the branch. `npm run check` passed all 43 steps with
EXIT=0 on `b739725f2`; the suite ran 15629 assertions over 853 groups with no failures. Both U4 boxes
tick and the status line moved in the same diff.

## What the next session should know

- The node consumes `correctionAt()` and never `.ppm`. MotionDex owns no `fs`, so no code path reads
  the rate as a rate, and §7 asks no span gate of an interpolating consumer. An ECGDex-style 2400 s
  gate would refuse 1254 of 1694 corpus ACC files.
- The anchor cadence matches ECGDex **in time**, not in rows. `MOTION_AXIS_EVERY = 100` is ~3.8 s at
  26 Hz, which is what ECGDex's 500 rows reach at 130 Hz. The smoother runs a median of fixed width
  21 ANCHORS, so a shared row stride would smooth over two different spans.
- Three generated trees carry `motiondex-dsp.js` beyond the nine provenance bundles: both
  orchestrators and `resp-acc-analysis.html`. They red steps 28 and 29 of 43, and each red leaves the
  remaining steps unrun.
- `gitleaks` is absent from this box, so `tools/secret-scan.mjs` refuses with `NOT_RUN`. CI's required
  `secret-scan` is the check that reads the branch.

## Open

- Residue `2026-10-30-a-timing-block-that-names-no-timebase-states-no-reason` is OPEN. It edits
  `dex-export.js`, which sits in 9 of 9 bundles, so §👥.3 hands it to a spine session.
- The U4 census lives in the brief's **BUILT 2026-10-30** paragraph and in #4127's body.

## Next step

Read #4127 to a terminal verdict, ask Kestrel to undraft, then retire the worktree with
`node tools/wt-done.mjs ../wt-motionsync-mg` once it merges.
