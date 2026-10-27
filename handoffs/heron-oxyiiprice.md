# Heron handoff — unit 23, the row that priced a retired gate

**Row:** `2026-09-27-run-oxyii-is-too-big-to-type-safely`, OPEN at `origin/main`.
Board claim #1184, board finding #1185. Measurement only.

## 1 · Unit

I priced the row's claim that a one-line type fix inside `capture.run_oxyii` drags the whole
function's mutant set.

## 2 · Branch and worktree

None. #3918 holds my one open PR, so this unit opened none and changed no file.
I read every source at `origin/main` through `git show`.

## 3 · Exact stopping point

Board #1185 carries the finding. Five facts stand.

- #3262 removed the named error on 2026-10-04, hunk `@@ -6188,7 +6188,18 @@ async def run_oxyii`.
  It widened the helper to `async def _rtc_sync(why: str | None)`.
- `MYPY_BASELINE=0` since 2026-10-09, and §P3 flipped 2026-10-20, so `mypy-ratchet` now fails a
  run on a risen count.
- #3260 declared `capture.py` at module level on 2026-10-03, one day before the fix. The ledger
  states the gate consults the declaration at SELECTION.
- The exclusion only restates UNKNOWN or NOT_RUN as NOT_APPLICABLE. Measured on #3915: `EXIT=0`
  in seconds with `population {checked: 0, eligible: 5, excluded: 5}` over 404 functions.
- `run_oxyii` was 1,145 lines on 2026-09-28 and is 1,488 at the ref. The module was 13,673 lines
  and 290 functions at declaration, and `count_functions` answers 328 over 15,511 lines today.

## 4 · Next step

Kestrel closes the row as `fixed #3262`, because its defect names one error and one line.
Then a NEW row carries the live residue, which is a different defect. That row states a
1,488-line function inside a module declared unmeasurable, growing 30 % in 27 days.

I hold no slot for either, so both are Kestrel's sequencing.

## 5 · Open questions

- Kestrel: close as `fixed #3262`, or prefer a new row stating the retirement.
- Owner: board #1153 triaged this row as a refactor decision. The decision no longer costs a
  two-hour gate run, so it is cheaper than it looked.
- Nobody has taken `briefs/MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md`, still PROPOSED.
  It buys mutation coverage back for all 328 functions at once.

## 6 · Blockers

None for the measurement. The remedy needs a PR slot and an owner decision about decomposing a
function on the live O2Ring capture path.

Any session touching `capture.py` must read the gate's verdict as "examined nothing". A green
mutation leg there is not evidence about the diff.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "does the capture.py module-level mutation exclusion change the
cost of a one-line type fix inside run_oxyii"` → `briefs/RESIDUE.md:465` ·
`memory/capture-py-mutation-cannot-finish-dont-re-run-it.md` · `capture-host/mutation_diff.py:2275` ·
`briefs/MUTATION-DECLARED-EXCLUSION-2026-10-03-BRIEF.md`.

## What a resumer should know

**A row prices the gate it met.** This one was right on 2026-09-27 and obsolete by 2026-10-04.
Read a row's premise before costing its remedy, and name the ruling or PR that moved it.

**A fix inside the named function closes the row without the refactor.** Widening a log label's
annotation cost two lines, and the row read as a refactor decision for three more weeks.

**Measure the blind spot at both dates.** The declared module grew 1,838 lines and 38 functions in
22 days, and the gate recounts it per run rather than quoting the ledger.

**A gate that charges nothing may also measure nothing.** The exclusion converts UNKNOWN into
NOT_APPLICABLE, never into PASS, so the cheap verdict and the empty verdict are the same verdict.
