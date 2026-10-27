
## Unit 71 (2026-10-26) — a thin axis segment annotates and the judgeable segments decide

1. **Unit** — the second half of residue
   `2026-10-21-the-night-judge-counts-clock-rows-that-recorded-no-clock-write`: the night judge's
   timebase band annotates a segment too thin to measure, and the judgeable segments decide the band.
2. **Branch + worktree** — `claude/thinhead-hrn` @ `97efbdc47` in `~/wt-thinhead-hrn`,
   cut from `origin/main` at `b77609e57`. Five files, +218 and -18.
3. **Exact stopping point** — DONE and up as **#3965 (DRAFT)**, reported at board #1462. All three
   gates read green on that commit. `capture-host/check.sh` EXIT=0 with a `TOTAL` row at 100 %.
   `mutate_diff --base origin/main` PASS over 559 mutants, 545 killed, 11 survived and 11 excused by
   entries that predate this branch. `npm run check` EXIT=0 over all 41 steps.
4. **Next step** — Kestrel undrafts #3965, asked at board #1462, since I never undraft my own. Then
   the next unit: unit 59's `guard-ruff.sh` tree-and-binary resolution, sized in
   `handoffs/heron-ruffskip.md`, or unit 66's three residue cells on a RESIDUE-only PR.
5. **Open questions** — the row's first half stays OPEN. It needs a box measurement, and whether a
   density refusal annotates or ranks is the owner's call (board #1168).
6. **Blockers** — none left. The one-PR cap cleared when #3959 merged. A red step 39 to 41 would be
   the only remaining cost, and steps 1 to 38 passed.
7. **The doc-search query** — "thin axis segment before the first clock set reduced coverage".

### What the change is

`_decision` takes an optional `coverage`, and the key stays absent when nothing wrote one.
`timebase` tests every segment for the anchor floor before the loop. A thin segment writes a note and
skips the rank when some other segment is judgeable. When every segment is thin the band examined
nothing, so each thin segment ranks again and the device stays UNKNOWN with its old sentence.
`score_devices` lifts the band notes to the device, and `coverage` joins `DEVICE_EXTRAS`.

### Why the note needed a new channel

`device_outcome` collects reasons from failing and undecided bands only — its own docstring says
"empty for a PASS". So a band that narrowed its span and then passed had nowhere to say so, and §∅'s
"reduced COVERAGE annotates" needs a channel a PASS does not close.

### Three existing tests changed, each deliberately

Two timebase tests pinned the old disposition over the same fixture: a recorded step 1 s into a
24-minute axis. Both now read PASS with the head in `coverage`. I kept the thin sentence word for
word from the ranking branch, so the test that asserts "anchor(s) — under 3" reads the same text
through the new channel. The third is `DEVICE_EXTRAS`'s equality pin in `test_solid_night.py`, which
exists so that a new key announces itself.

### The trap this unit avoided

My first plant of the note guard hit `if notes:` twice in the module and the assertion refused it.
Unit 70's lesson held: a plant that does not apply reports the clean arm's own pass, and the proof
inverts. The line-targeted retry failed six legs. My bytecode probe was the wrong instrument here —
CPython compiles `if not notes:` with no `UNARY_NOT` — so the failure set is what distinguishes the
arms, not the disassembly.
