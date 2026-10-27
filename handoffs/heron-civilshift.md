# Heron — unit 58 · the absorbed civil shift reaches no night artifact

**Status:** SIZED 2026-10-26 · board claim #1375, released · finding #1376 · no PR, no file changed.

## 1 · Unit

Row `2026-10-26-the-absorbed-civil-shift-reaches-no-night-artifact`, source `capture-host/capture.py`. Measurement and sizing only.

## 2 · Branch and worktree

None. I changed no file in any checkout. I read the ref through `git show origin/main:<path>` and read `/srv/tepna/captures` plus the journal on vigil over ssh, read-only.

## 3 · Exact stopping point

Finding #1376 stands on thread `work` and lints PASS. The scratchpad holds `ref-capture.py`, `ref-writers.py`, `q58.txt` and `rep58.md` at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/`.

## 4 · Next step

Two lines in `capture-host/writers.py`, once a PR slot frees. Append `capture_absorbed_sec` to the header at `writers.py:2359`, last, and append `_f(st.get("capture_absorbed_sec"))` to the row tuple at `:2394`. The producer needs no change, since `capture.py:8888` already sets the key on the dict that `capture.py:8916` hands the writer.

Then one test that reads the COLUMN out of a written CSV, never the accessor. The 2026-08-05 brief measured that trap: deleting the line that published the value survived every test of the accessor. `capture-host/writers.py` sits inside mutation scope, so a header literal and a column position both need pinning.

Also update the back-compat header test, which asserts the first line starts `Phone timestamp;` and now covers 14 columns.

## 5 · Open questions

The EXPORT half stays open and belongs to the owner. The 2026-08-05 brief frames `ganglior.node-export` carrying the absorbed offset as a contract question. The night CSV is not that contract, so the remedy above needs no ruling.

No fold reads `_CLOCK.csv`, so `QC-SUMMARY.json` and `LOSS-AUDIT.json` still would not carry the shift. That is unit 29's fold-identity gap and it needs its own row.

## 6 · Blockers

The one-PR cap. #3920 holds my slot and `claude/guardfix-hrn` already waits behind it at `328dfb50a`.

🔴 **The deadline is 2026-11-01 at 02:00 local.** The box runs America/New_York and steps back an hour then. Six of the last six nights hold a sample file open across 02:00. A capture open at that instant absorbs 3600 s, and today no artifact records it.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "a daemon absorbs a civil clock shift and no night file records it"` scores 0.362 over a flat field. Hit 3 is the one that matters: `briefs/CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05-BRIEF.md:90-112`, whose §3 closes the absorption work and names this remainder.

Memory: `an-artifact-the-row-asks-for-may-already-receive-the-value`.

## Unit 65 — the night sidecar records the absorbed civil shift (2026-10-26)

1. **Unit.** Row `2026-10-26-the-absorbed-civil-shift-reaches-no-night-artifact`: append
   `capture_absorbed_sec` to the per-night host-clock CSV.
2. **Branch + worktree.** `claude/civilshift-hrn` @ `23bf40655` in `~/wt-civilshift-hrn`,
   base `origin/main` @ `54468dd50`. Up as **#3959 (DRAFT)**. The row closes inside it.
3. **Exact stopping point.** Both commits pushed. `capture-host/check.sh` reads all gates green with
   pytest at 88 passed and 100.00% coverage. The log sits at `chk68.log` in the scratchpad.
   I launched `npm run check` detached; its log is `npmchk68.log`.
4. **Next step.** Read the `npm run check` sentinel. On EXIT=0 the unit holds nothing further and waits for an
   undraft. On a red, read the failing step's own section, never the summary line.
5. **Open questions.** None for this unit. The undraft ask sits at board #1433.
6. **Blockers.** None. The WIP cap allows one open PR per bird and #3959 is mine.
7. **Doc-search query.** `the absorbed civil shift reaches no night artifact` scores 0.987 and
   surfaces `an-artifact-the-row-asks-for-may-already-receive-the-value`.

**The lesson.** The row asked for a new artifact field. The value already reached a per-night writer
every poll, and only the column list dropped it. Read the writer's caller before sizing a new field.

**The second lesson.** A test of the accessor cannot see a publication defect. Both new legs read the
column back out of a written file, and the anti-fix control proves five legs bite.

---

## Unit 70 — the mutation red on #3959, closed (2026-10-26)

**1 · Unit.** Clear `mutation (diff-scoped)` on #3959: six survivors in `HostClockLogWriter.__init__`,
all on lines this branch never touched, because the gate's unit is the FUNCTION.

**2 · Branch and worktree.** `claude/civilshift-hrn` at `161a7be1d` in `~/wt-civilshift-hrn`.
PR #3959, DRAFT, merge BEHIND. Base `origin/main`.

**3 · Exact stopping point.** The push carries the fix. Gates at `161a7be1d`: `mutate_diff --base origin/main`
reads PASS over 142 decided, 136 killed, 6 excused, 0 survived. `capture-host/check.sh` reads EXIT=0
with a TOTAL row at 100 %. `npm run check` reads all 41 steps passed. CI shows 20 pass, 6 pending,
1 skipping.

**4 · Next step.** Read `gh pr checks 3959` once the six pending contexts settle. Kestrel holds the
undraft ask and undrafts oldest-first when green (board #1454). I never undraft my own PR.

**5 · Open questions.** None on this unit. The three unit-66 cells still wait for a RESIDUE-only PR
once #3959 merges, and they sit in `handoffs/heron-asymprobe.md`.

**6 · Blockers.** None. The one-PR cap binds until #3959 merges.

**7 · The doc-search query.** `a planted mutant keeps running after I restore the source file` finds
`memory/stale-pyc-fakes-a-mutant-kill.md`, which is the whole lesson of this unit.

### What the fix is

One of the six survivors is killable, and a new leg kills it:
`test_host_clock_keeps_its_own_path_and_binds_health_to_it` in
`capture-host/tests/test_writers_sidecars.py`. `_FlushHealth(path)` was unobserved, and the path is
what a flush failure NAMES, so losing it turns a named failure into an anonymous one. The sibling
`PmdArrivalLogWriter` already carries the same leg.

The other five mutate `open()`'s keywords: `newline=None`, `newline` dropped, `buffering` dropped,
`buffering=2 << 16` and `buffering=1 << 17`. A probe wrote the same payload through all six variants
and read back byte-identical files, 75 bytes at sha256[0:16] `6c75e7bf782502b2`. Two of the five are
literally the same number, since `2 << 16 == 1 << 17 == 131072`. All five now sit in
`capture-host/tools/mutate-equivalence.json` as `no-distinguishing-input`, beside the probe that ran.

**Each entry carries `function`, and here it is mandatory.** That exact `open()` line has TWO carriers
in the module, `HostClockLogWriter.__init__` at `:2340` and `LinkLogWriter.__init__` at `:2980`. An
unqualified entry speaks for the whole module, so a kill in the sibling would report my excuse as
refuted. `entry_matches_function` in `capture-host/mutation_diff.py` honours the field, and its
docstring records that an unreadable function does not match a qualified entry.

### The trap that cost six turns

A stale `__pycache__/writers.cpython-313.pyc` kept the planted mutant alive after I restored the
source. `path` and `None` are both four bytes, and both writes landed in the same second, so Python's
(mtime, size) invalidation held the mutant's bytecode valid.

Two halves were new to the fleet's four recorded instances:

- `inspect.getsource` reads the FILE, so it printed the clean line while the mutant ran. Only
  `dis.get_instructions` shows which body runs — `LOAD_CONST None` against `LOAD_FAST path`.
- The gate's refusal named the wrong culprit. It read its own clean baseline as red and printed
  "Fix or quarantine THAT test — the failure is the covering set's, not this diff's". I bisected five
  test files and ran the whole suite of 11,445 tests for 303 s to confirm a failure that one
  `rm -rf __pycache__` erased.

The plant verdict inverted: both arms ran the mutant, so the first proof measured nothing. The
re-proof purges the cache and reads the bytecode on EACH arm. Appended to
`memory/stale-pyc-fakes-a-mutant-kill.md`; board finding #1445.
