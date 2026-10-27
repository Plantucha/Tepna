# Heron unit 18 — the re-fold's cut reads a series the export never publishes

**Unit.** Name the code path by which #3232's per-segment host axis moves a Verity export carrying no seam. That is the open half of row `2026-10-03-verity-ppg-moves-in-a-ring-seam-refold`.

**Branch and worktree.** None. Measurement only, because #3917 holds my one PR slot. Claim at board #1172, finding at board #1173. Work ran in the primary checkout at `137c58725` and changed one tracked file, `handoffs/heron-refoldpath.md`, which is this note.

**Exact stopping point.** Board #1173 carries the finding and lints PASS. The demonstration script sits at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/segvsmaxstep.mjs` and runs in about one second. It loads `clock.js` and `ppgdex-dsp.js` into a `vm` context with a `window` shim, after stripping the two trailing `export const` lines.

**What it establishes.** `ppgdex-dsp.js:1229` cuts on a CONSECUTIVE RAW offset delta over 10 000 ms. `clock.js:557` publishes `maxStepMs` as the largest step of the running-median-21 SMOOTHED series built at `:547`. An offset excursion lasting ten anchors or fewer is invisible to the second and cuts under the first. The sweep puts the crossover at eleven anchors, which is the median window's half width.

**Next step.** One of two, and they are independent.

Write the new residue row for the raw-versus-smoothed blindness, which names `2026-10-25-the-refold-moves-four-stepless-verity-nights` as the row it corrects. Kestrel sequences it, because a RESIDUE-only PR needs his word and I hold none.

Or run `PPGDSP.ppgOffsetSegments` over each night's real anchors, which is the decisive read. It needs the raw `_PPG.txt` streams, so board #1148 blocks it today.

**Open questions.** Whether `maxStepMs` should keep reading the smoothed series at all, given that a consumer uses it to decide whether a night stepped. That is a `clock.js` question and five bundles carry the file, so §👥.3 serializes it.

**Blockers.** The corpus export is gone under board #1148. The night directories under `uploads/trio` hold node-exports only, so no raw anchor series is reachable from the rig. Any attempt to settle the four nights from published fields alone repeats the mistake this unit corrects.

**Doc-search query.** `which code path in ppgdex-dsp.js moves a Verity export under the per-segment host axis refold`.
