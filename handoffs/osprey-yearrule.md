# Osprey — unit `yearrule`: the hard-coded year rule names its refusals

**Status:** DONE pending the gate verdict · PR **#3931 DRAFT** · 2026-10-25

## Unit
Six corpus runs filtered their night listing on the literal `/^2026-/` and reported over whatever
survived. Each now passes that rule to `snapshotNights` as the walk's `re`, so each run names every
night-shaped name its rule refuses. Row
`2026-10-25-a-hard-coded-year-rule-refuses-a-night-and-the-verdict-reads-eligible-one`, claim #1285.

## Branch + worktree
`claude/yearrule-osp` @ `32f3a799b` in `wt-yearrule-osp`, cut from `origin/main` and rebased onto
`67b3f3b1b`. Four commits: the wiring, the changeset, the two rows, the stdout fix.

## Exact stopping point
Everything pushed. `pr-compliance` run locally over the live body reads `✓ PASS — 5 check(s)`.
`node tests/run-tests.mjs` → all 14253 assertions passed (826 groups). The full `npm run check`
is running detached with an `EXIT=` sentinel; its verdict belongs in a PR comment and in the board
report.

## Next step
Read the sentinel, post the gate numbers as a PR comment plus a board unit report, then pick the
next unit from the 45-key backlog in weight order. Kestrel undrafts #3931. I never undraft my own.

## What the six tools now do
`pat-literature-spec` · `pat-mode-posture` · `pat-per-led` · `pat-three-corner` ·
`pat-window-oracle` · `ppg-foot-residual-sweep`. Each prints the prose population line, the rule
line and `POPULATION <object>`, and each answers `--verdict-sample` corpus-free.

## The gate caught one thing the suite could not

`npm run check` reded at step 37/40 (`verify:verdict-adoption`): the new `POPULATION <object>` line
sat on `pat-three-corner`'s STDOUT, which the adoption gate parses as JSON. That tool routes prose
to stderr under `--verdict` and `--verdict-sample` precisely so stdout stays machine-readable. The
line now travels through its own `say`, which is stderr under either flag and stdout on a plain run.
Commit `32f3a799b`. The node suite cannot see this class, because it reads the file's text and never
runs the tool's sample.

## Findings beyond the row
1. **A refused night-shaped directory reads as a flat root.** `pat-window-oracle`'s MIXED-layout
   refusal keys on `nights.length`, which the year rule already drove to zero. The planted twin
   proves it: `2027-01-02/` plus a loose `_ECG.txt` scores as SESSIONS and drops the directory,
   while `2026-06-11/` plus the same file refuses as MIXED. Logged OPEN as
   `2026-10-25-a-refused-night-shaped-directory-reads-as-a-flat-root`; the decided flat-root policy
   is why this PR changes no behaviour there.
2. **The invisible-publisher set moved again.** 41 tools build the object and 11 carry no literal
   decision word, against 30 and 8 three days ago. Only `pat-literature-spec` is new from this unit,
   because the other five already carried a word for their own gate.
3. **Two pre-existing conditions, each controlled against `origin/main`.**
   `pat-literature-spec` has no `--selftest` flag at all, and `pat-three-corner --verdict-sample`
   prints its banner before the object. Both reproduce at the base, so neither is mine.

## Open questions
`stage-lab.mjs` (weight 12) and the three `nsrr-*` keys still owe an owner-facing record-population
decision (#1254). Nothing in this unit touches it.

## Blockers
None. The backlog's 18 night-ruled keys are the measured next set (board #1274).

## Doc-search query that finds this
`hard-coded 2026 year prefix in a corpus night filter` — best 0.663, hits board #937 (PR #3864),
`memory/coordinator-specs-carry-unread-premises.md`, `briefs/SOLID-NIGHT-RTC-2026-10-04-BRIEF.md`.
The prior work covers ADMISSION; this unit covers REFUSAL.

---

## Second unit, 2026-10-25 late: the disguise row's population (claim #1294, report #1295, no PR)

- **Eligible population today: ZERO.** 327 night-shaped directories over six night-holding
  directories across the two corpus roots, every one of them 2026. No `/^2026-/` tool has anything
  to refuse in this tree, so only the planted control inside #3931 demonstrates the row.
- **The hazard has a date: 68 days.** On 2027-01-01 the literal refuses every new night. Twelve
  files carry `/^2026-/`; five passed it as a rule at `origin/main`, #3931 converts the other six.
  Each then accounts for its refusals, and each then prints that line over zero scored nights.
- **One root is already shaped to carry the disguise.** `Ecg nightly` holds 104 loose recordings
  and no night-shaped child, so a 2027 directory landing there hands `pat-window-oracle` a refused
  night beside loose files — the SESSIONS-mode path that drops it.
- **The default rule is the other half:** 192 `YYYYMMDD` CPAP nights, which `NIGHT_RE` refuses in
  full. A caller's own `re` is what keeps that root scorable.
- ⚠️ **A one-line shell test mis-binned ten of eleven tools** as hiding the rule in a bare filter.
  I spot-read five, all five pass the rule, and a corrected test agreed with the code. Third time a text-keyed
  classifier of mine has disagreed with the code.

**Owed:** a row for the 2027 boundary. The one-PR cap blocks it while #3931 is open, so the next
session with a free slot writes it.
