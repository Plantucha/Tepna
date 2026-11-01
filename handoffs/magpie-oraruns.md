# Magpie — unit `oraruns`

**Row:** `2026-10-17-sample-parsers-called-without-their-sidecar` (stays OPEN — the 64 `tools/` calls
are untouched)
**Branch:** `claude/oraruns-mg` · **Worktree:** `wt-oraruns-mg` (sibling of the primary checkout)
**Rule 0:** `sample parsers called without their validity sidecar runsText call sites` →
`tests/dex-tests.js:44425`, `briefs/SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md:230`,
`briefs/RESIDUE.md:658`, board `7/1984`, `memory/half-wired-mechanism-hides.md`.

## The order asked for a call site and the population held none

Kestrel ordered "the next node-code call site that drops `runsText`". I measured that population
first and found it empty. Five non-tools files carry a bare call and the suite's `done-when 4` ratchet
pins every one with a reason: `adapters/polar-sense-ppg.js` and `ppgdex-app.js` hold GYRO and MAGN
calls on streams the box writes no sidecar for, and three workers parse synthetic text. My own scan
reproduced the ratchet exactly. The remainder of the row is the `tools/` population, 64 calls over 40
files, pinned as one group.

## Why a new call site would have changed no number anyway

`ecgdex-dsp.js parseEcgRuns` compared the sidecar's column 1 against the literal `'ecg'`. That column
holds the CHANNEL despite the header naming it `stream`, and the box writes `ecg [uV]` for the H10's
single lead. Measured over the canonical corpus: **335 of 335 recorded ECG blanking rows carry
`ecg [uV]`**, across the 36 nights that hold one. The parser placed 0 of 60188 samples, 463.0 s of
recorded non-measurement, over 37 files.

So `rec.blankingSpans` read `[]` on every real night, which no consumer can tell from a clean stream.
All four prior slices of this row consume that empty list: #3772's trio worker, #4069's PAT leg,
#4104's fold and ECGDex's own epoch path. The test's plant wrote `;ecg;`, so the fixture and the
parser agreed while both disagreed with the device.

## What this PR changes

`parseEcgRuns` reads the file's own `# stream=<s> channel=<c> class=…` declaration and keys the accept
rule on it. The literal is gone. The wrong-companion guard stays, so a `_PPGRUNS.txt` fed to the ECG
reader rejects its rows and names them. `parseECGLines` turns an unplaced sidecar into `null` plus a
`blankingSpansReason`, because an empty array must keep meaning "the writer looked and emitted
nothing".

The `spans` element shape stays `{ first, n, value }`, so no consumer sees a new field. A one-argument
call stays byte-identical. The suite's §3.2 group now plants the box's own bytes and keeps the old
shape as `SC_LEGACY`.

## Honest size

On three probed nights the corrected rule refuses 1, 0 and 2 NN intervals. No headline number moves
today. The value is that the mechanism four PRs built currently measures nothing, and the next long
stuck span would pass through in silence.

## What I left, and where it is written

`tools/oracle-ecg-firmware-rr.mjs:456` still calls `ECGDSP.parseECG(ecgText)` bare. It sits inside the
64-call `tools/` population, so the parent row already holds it. #4073 recorded why a name scan is not
enough: wiring an unexecuted research tool would be a green over something never examined.

The fold cannot tell an unreadable sidecar from an absent one, which is this unit's own §∅ remainder.
`tools/trio-fold-validity.mjs:46` tests `Array.isArray(r.blankingSpans)` and `tools/trio-batch.mjs:3972`
writes `blank ? blank.spans : undefined`, so both read a refusal as an absence of input. New row
`2026-11-01-the-ecg-fold-cannot-tell-an-absent-sidecar-from-an-unreadable-one`, source
`tools/trio-fold-validity.mjs`, state open.

## Next step

Watch CI to terminal. After the merge, verify the squash at the ref, retire the worktree with
`node tools/wt-done.mjs`, append the lessons to `memory/magpie-state-2026-10-18.md` and post the merge
note.
