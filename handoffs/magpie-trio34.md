# Magpie — unit `trio34`

**Source:** `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md` §4, the 🔴 note inside the
`sensor-trio-night.js` item: *"Re-running that section is its own unit, because it decides what a
reader who quoted the old figure should be told."* Ordered by Kestrel on thread 8 after #3981 merged.
**Branch:** `claude/trio34-mg` · **Worktree:** `wt-trio34-mg` (sibling of the primary checkout) ·
**Base:** `b73e9f199`
**Rule 0:** `sensor-trio-nights paper 3.4 real-data corpus night keying re-run` → 0.877;
`briefs/SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md:247-264`, `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md:82`,
`papers/sensor-trio-nights.html` §3.4. My first query keyed on the cause I suspected and scored
**0.180**; re-keyed on the artifact and the section it scored **0.877** and surfaced the paper brief's
standing instruction at hit 3.

## The answer the unit owed

**Nothing moves, and that is the finding.** The §3.4 figures do not change under the row-stamp
keying, so a reader who quoted them needs no correction on this axis. They remain withdrawn for the
separate 2026-10-12 reason, which this unit does not touch.

## Measured, at two levels, each against a real control

| instrument | row-keyed | name-keyed |
|---|---|---|
| `trio-batch --dry-run` fold, content vs a neutered-`startOf` worktree | 25 trio nights | 25 trio nights |
| `sensor-trio-night.js` own ingest, 774 raw files | 58 nights · 31 eligible | 58 nights · 31 eligible |
| the same ingest inside the paper's 2026-06-10→07-05 window | 26 nights · 23 eligible | 26 nights · 23 eligible |

No night is present under one keying alone. The fold diff is five 0.1 h merged-duration changes on
auxiliary streams. **Exactly one file changes night in the whole corpus**, and it is the one the brief
named: 2026-06-19's Verity `_HR.txt`, `…_221400_HR.txt` by row against `…_221551_HR.txt` by name.

🔴 **A CHANGED INPUT IS NOT A CHANGED FIGURE UNTIL YOU READ ITS CONSUMER.** The brief recorded this
as a published figure that moves. `sensor-trio-worker.js:1085` reads the field as
`if (!V && f.verityHR)`, a fallback taken only when the PPG and PPI corners both yielded nothing.
That night resolves `verSrc = PPG` under both keyings from a `verityPPG` file the keying does not
move. The changed file is never opened. Reading the consumer cost one `sed -n`, and without it this
unit would have published a correction to a figure that never moved.

## The page-level A/B needed no page edit

The control is the absence of a method. The harness slices the page's pure ingest region, evals it
with stubs and feeds pseudo-File objects; the name-keyed arm hands each file an object with **no
`.text`**, so the page's own `firstRowTMs` returns `null` and falls back to the filename stamp. That
is the pre-#3791 keying executed by the shipped code, not a re-implementation of it. Harness in the
scratchpad, throwaway; the reproducible instrument is the page itself.

## What I could NOT reproduce, and it is stated rather than hidden

The published pair is *"Of 31 trio-eligible nights, 26 solved cleanly"* over 2026-06-10→07-05. Over
the folder held here both numbers appear, but as **two different populations**: 31 eligible over the
whole span, 26 nights inside the stated window. The ingest arm does not solve, so this re-run cannot
check a solve rate at all. The file set behind the published counts is not recorded — the same gap
§3.4's own ⚠️ note already states about the window length and the DSP generation.

## What landed

- `papers/sensor-trio-nights.html` Table 4 caption — the night keying recorded as a third
  unrecorded-provenance axis, with the re-run result, the one changed file and its unconsumed leg.
  `docs/papers/sensor-trio-nights.html` rebuilt by `build-docs.mjs`.
- The brief's §4 note stamped with the outcome.
- This PR publishes, adds and restores no σ number. The brief `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` forbids
  re-writing this paper, so the edit stays inside the provenance the section already confesses.

⚠️ `build-docs.mjs`'s printed `git add` line omitted `docs/papers/sensor-trio-nights.html`. Stage
from `git status`. Third fleet sighting of that omission.

## Not in this PR

Acceptance item 5 stays open and should: it closes on residue
`2026-09-22-filename-stamp-still-wrong-for-other-consumers`, whose part (a) is the capture-host writer
still putting the session start into the filename. That needs a box change and an owner-authorized
deploy.
Two other pieces wait on their own gates: the σ re-derivation under the unweighted hat, and the
15-night re-fit.
