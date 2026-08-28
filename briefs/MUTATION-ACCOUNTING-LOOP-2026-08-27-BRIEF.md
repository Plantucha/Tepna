<!--
  MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-27 · **Owner-issued charter** ("what should we do next" recon, executed same-day: "write it as brief and implement right after") · **Interlocks:** `QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md`, `MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md`, `MUTATION-PROGRAM-2026-08-09-BRIEF.md`

# The mutation accounting loop — design review + the next evolution

> **Method note.** Every claim below is source-level: all nine pipeline tools were read completely
> (three parallel reading passes, file:line-cited), not summarized from headers or memory. The
> operational evidence is this week's measured record (159 adopted assertions, the diff-menu yield
> jump, the realm-divergence batches, the 0/60 lens retirements, the model A/B, the gate's
> five-PR calibration night). The review's charter forbade rebuilding what exists and demanded
> "do nothing" be an admissible answer per area — several areas below conclude exactly that.

---

## 1 · EXISTING STRENGTHS (verbatim-verified, keep untouched)

- **The honest-state vocabulary.** No lane fabricates equivalence: the probe's strongest negative
  is `NONE` ("not distinguished by the inputs tried") — there is *no* `EQUIVALENT` verdict in the
  search path at all; `BATTERY-UNUSABLE` self-describes as "NOT evidence of equivalence"; a failed
  probe records `killable: null`, never `0`; a voided sweep is "NO result".
- **Canary quotability semantics** (mutate.mjs): FAILED voids (`killed: null` — unquotable by
  construction); STALE is unguarded-but-quotable only at high rates, with the reasoning shipped in
  the warning itself ("a high kill rate is its own positive control; a low one is not", ruled
  2026-08-26).
- **Measurement conservatism**: timeouts leave the denominator (stricter than Stryker/PIT/mutmut);
  non-zero exit with no assertion output is INVALID, not KILLED (fixed after measuring every
  historical kill rate as inflated); identity fails closed; results write atomically; the jam
  detector needs two unfinished starts (16 workers ⇒ ~16 legitimately stranded per SIGTERM).
- **The safety model**: JSON-parsed model output (a planted `[process.exit(1)]` parses to `[]`);
  expected values only from recorded real outputs through the suite's own serializer; suite-realm
  verification authoritative by construction; `TIERS_PER_RUN` encoding a measured 30× lesson.
- **The self-confessing code**: nearly every limitation carries its measurement inline (the async
  false-negative, the pool's 0/54, first-to-fail attribution, the fixture-generator ranking trap).

## 2 · ALREADY SOLVED (charter items the system provides — do not re-add)

| charter ask | existing mechanism |
|---|---|
| closed-loop first half (survivor→input→kill→test→verify→adopt) | operational end to end; 159 assertions adopted this week, planted controls both directions per batch |
| "test passes" vs "test detects" | mutation IS the discriminator; CI form = `mutate_diff.py` kill-or-prove with a cannot-flatter equivalence ledger (REFUTED entries *fail* the gate); night record 3 catches / 0 false positives |
| survivor taxonomy | `UNREACHABLE · UNRESOLVABLE · BATTERY-UNUSABLE · REALM-ARTEFACT · ANCHOR-MISS · WONT-LOAD · no-distinguishing-input` + probe `NONE/NOPROPOSAL/STALE/NOLOAD` with tier stamps; UNKNOWN systematically preferred over equivalence claims |
| model benchmark on measured distinctions | `model-bench.mjs`: paired per-mutant KEPT (machine-verified discrimination), McNemar-ready; chose 3.8 correctly; leave alone |
| history invalidation | sweep identity includes `tests/dex-tests.js`; kill-reuse requires the killing group's body-hash unchanged |
| pool honesty | pool inputs re-measured identically to model inputs; cross-function value measured 0/54 and recorded in-source with "do not quote it as a win" |
| ops-anomaly lane | designed as program job 8 (pending), not missing |

**Treating the pool measurement honestly, as the charter demands:** cross-function reuse is
confirmed near-worthless (argument shapes differ per function); it survives only because it costs
microseconds. Same-call-shape and mutation-family reuse: **do not build** — same shape-mismatch
premise, no prior. The same-function pool is the in-source-named "version with a real prior":
worth exactly a two-line preference (`p.call === t.call` first in rank order), measured before
being believed, and no more investment than that.

## 3 · REAL GAPS (each with its evidence)

- **G1 — the probe's realm-artifact filter was INERT since birth** (`mutation-ai-probe.mjs:1029`):
  `isRealmArtefact(a, b, () => true) === true` against a function returning string-or-null, with
  a predicate forcing null regardless — mutant-side `X is not defined` counted as KILLs. The
  crawl's own filter works but examines only the *first* differing row.
- **G2 — the draft lane had no journal.** Every run re-attempted every killable (rejections
  in-memory only); the drafts file was a FULL OVERWRITE (measured: 16 of 17 drafts files had lost
  their verification blocks; one certified 0-of-0 over an emptied file); no model/ctx/attempt
  recorded — the 3.8-era and coder-era drafts on disk became indistinguishable the day the model
  switched. The idle driver's comment claimed "journaled; skips answered work"; it did not.
- **G3 — `complete:true` is forever.** The crawl-level skip never consults identity hashes; VOID
  files are also `complete:true`; five whole survivor classes are never revisited when the suite
  improves. The taxonomy exists; the re-examination policy does not.
- **G4 — the closed loop's second half is absent.** Nothing re-runs mutation after adoption to
  confirm the adopted assertions kill their mutants; the only post-adoption re-sweep ever done was
  an untracked 13-line shell loop with a hand-copied journal backup and no delta computation.
- **G5 — the dirty-base-realm asymmetry.** Crawl: ONE base realm per FILE (orig rows for function
  N recorded on a realm polluted by functions 1…N−1's batteries) vs virgin per-mutant realms;
  probe: one pristine realm per RUN. This is the demonstrated source of the realm-divergent
  drafts (`computeMOS(null)→3`, `getFilteredRows(null)→58`) — batch 2's dominant real-divergence
  mode.
- **G6 — crash-pinning drafts.** The probe refuses orig-side THREW ("a crash is not a contract");
  `usableKillables` filtered only both-THREW, so one-sided crashes were drafted (the
  `detectPeriodicity` TypeError draft; a live `_tMs` THREW assertion in hrvdex's drafts file).
- **G7 — silent accounting holes.** `ANCHOR-MISS`/`WONT-LOAD`/`PROBE-THREW` have no aggregate
  counters (invisible in `--status`); the TIMEOUT skip's "counted" comment counted nothing; probe
  survivors lacking `before`/`after`/`callPath` are dropped with no journal line at all.
- **G8 — history signals derivable, none derived, two being destroyed**: elapsed time
  (sweep-state's `startedAt` overwritten at completion) and draft attribution (G2). Per-operator
  kill rates, per-function survivor density, tier effectiveness all sit in journals no tool reads.

## 3a · §E4-EXECUTED 2026-08-27 — the lane ships, and its specced mechanism was refuted

### 🔴 A moved `testsHash` needs a re-TEST. This brief said re-PROBE, and that was wrong.

`probeFile` **never loads `tests/dex-tests.js`**, never runs the suite, and contains zero references
to it — checked in the function body (`dex-tests` 0 · `testsHash` 0 · `runTests` 0). It builds a realm
from the **source** and runs batteries, so a probe finding is a property of the CODE. A better suite
cannot move it.

This was established by **building the specced lane and running it**, not by reading:

| stranded file | generation 1 | after re-probe |
|---|---|---|
| `clock.js` | probed 13 · killable 1 · unreachable 28 · 12 findings | **byte-identical** |
| `hrvdex-dsp.js` | probed 86 · killable 11 · unreachable 85 · 31 findings | **byte-identical** |

`hrvdex-dsp.js` is the decisive case: **§E3 independently measured that its adoption KILLED 3 of its
recorded survivors.** The re-probe saw none of it. What a moved suite changes is *which mutants still
survive* — only re-running them against the suite answers that.

**Shipped as a re-SWEEP: correct and expensive.** G3 closes either way — a file with a moved
`testsHash` is no longer skipped forever — and the previous generation is archived before the new one
is written, so the re-examination cannot destroy its own baseline. Routing to a probe would have
shipped a lane that runs, reports, and *structurally cannot detect the thing it exists to detect.*

### The gap, measured

**29 of 29** complete crawls in `.mutation-crawl/` carry a `testsHash` that no longer matches the
suite. Every one was being skipped permanently, including through this week's 159 draft adoptions —
whose entire purpose is converting survivors into kills.

### Two more spec-vs-reality gaps, found by wiring it

- **The `.crawl.json` records no identity at all.** file/complete/killed/survivors/… and no hashes;
  those live in the `<file>.sweep-state.json` sibling. So *"compare the crawl's recorded identity"* had
  nothing to compare. The lane reads the sibling, and now also **stamps identity onto the result** — a
  crawl result separated from its sibling was previously unauditable.
- **`survivors` is a COUNT, not a list.** The list (line/op/before/after) is in the cached
  `<file>.sweep.json`. The first wiring passed the crawl record to `probeFile`, which iterates
  `rec.survivors`; iterating a number throws.

### The convergence bug, caught by running it twice

The first version re-examined the same file **forever**. A re-examination stamps the new `testsHash`
onto the RESULT and must **not** restamp the sweep sibling — no sweep happened, and claiming one would
be a false record. But the plan read the sibling for *both* hashes, so the fresh value was unreachable.

> **Source validity belongs to the sweep; suite validity to whatever last judged.**

Null control on real data: the second run prints `skip clock.js (complete and current)`. Both
directions are planted in the selftest (unchanged identity must still SKIP; moved `testsHash` must
not).

`VOID` files stay excluded and the skip line says **why** — a VOID file measured nothing, so
re-examining it would produce findings from a harness never shown to detect kills. That is a human's
canary question first.

### §E4b — the cheap form, and why it is a separate unit

The expensive half is re-testing every mutant when only the recorded survivors need re-testing.
`mutate.mjs` cannot currently be targeted at a recorded mutant list; giving it that turns a moved
`testsHash` from a full sweep into a survivors-only re-test, and composes with `§E3`'s delta tool as
the fast path of the same loop. Scoped here rather than assumed away.

## 4 · RANKED IMPROVEMENTS

1. **Draft-lane journal + attribution + append semantics** (G2, half of G8) — info gain high,
   complexity low (the probe's journal pattern exists one seam over), verification easy.
2. **Fix the inert filter; count every skip class** (G1, G7) — trivial; killable counts become
   trustworthy.
3. **Post-adoption survivor-delta report** (G4) — converts adoption's value from by-construction
   inference to measured killed-delta per adopted group; medium complexity (identity invalidation
   already forces the cold re-sweep; add correlation + report).
4. **Identity-aware re-examination** (G3) — a `complete:true` crawl whose `testsHash` moved
   enters a survivors-only re-probe lane instead of being skipped forever.
5. **Fresh base realm per function** (G5) — kills the dominant divergence mode at source; measure
   realm-load cost first.
6. **Draft-lane crash guard** (G6) — the probe's own rule, three lines.
7. **History mini-report** (G8) — transparent stats (op kill rates, function density, tier
   effectiveness) over existing journals; one timestamp field added going forward. No ML.

## 5 · DO NOT BUILD

Another findings database (the ledger exists) · new mutation operators/engines (the 10-op set
carries its measured rationale) · an ML prioritizer (§4.7's stats suffice) · any broad AI review
lane (0/60 measured; retirement stands) · auto-adoption (the "mutant killed ≠ contract known"
wall at `mutation-suite.mjs` is the system's most important sentence) · awaited async in
`resultString` (documented tradeoff correct) · cross-function/call-shape/family pool investment
(0/54; keep the free microseconds) · a blocking whole-tree mutation gate (`mutate.py`'s own header
has the argument; diff-scoped is the CI form) · a second verification realm.

## 6 · EXECUTION (this brief's own work)

- **§E1 — hygiene (G1 + G6 + G7 counters): DONE 2026-08-27, this PR.** The probe's filter now
  calls `isRealmArtefact(a, b, (id) => id in realm)` and counts `artefactSkips` into the summary;
  `usableKillables` refuses one-sided orig-THREW (`skippedCrash`) and honestly counts
  `skippedTimeout`. Selftests 79 + 161 green.
- **§E2 — the draft journal: DONE 2026-08-27, this PR.** `<file>.draft-journal.jsonl` beside the
  drafts: per-mutant terminal outcomes (`KEPT`/`REFUSED`/`NO-DRAFT`) keyed by mutant identity AND
  model, with model/ctx/timestamp on every record. Skip rule: a KEPT under ANY model retires the
  mutant; a negative outcome skips only the SAME model (a new model legitimately re-attempts);
  `--redraft` overrides. The drafts file is now APPEND-ONLY: existing content (verification
  blocks included) preserved byte-for-byte, only genuinely new assertions appended under a
  model/ctx/date attribution stamp, nothing-new leaves the file untouched. Selftested
  (`draftKey`, `textAid`, `existingDraftAids`).
- **§E3 — adoption-delta report: NEXT UNIT, spec here.** `tools/mutation-adoption-delta.mjs`:
  given a merged adoption batch (the `mutation-drafts*` groups), re-sweep the affected files
  under current identity and report per adopted group: previously-surviving mutants now KILLED,
  attributed via the journal's `ks`; write the delta beside the drafts file and a row into the
  program metrics. Acceptance: the batch-3 files show a positive measured delta, and a planted
  no-op adoption shows zero (the delta's own null control).
- **§E4 — identity-aware re-examination lane: ⚠️ DONE 2026-08-27, but NOT as specced — the word
  "re-probe" in this line was WRONG and the correction is the unit's main finding.** See §E4-EXECUTED
  below. Spawns **§E4b**, the cheap form, which is genuinely queued.
  `complete:true` + moved `testsHash` ⇒ survivors-only re-probe, never a silent skip; VOID files
  excluded (their canary question must be answered first, by a human).
- **§E5 — fresh-realm-per-function: QUEUED, measure-first** (realm-load cost × ~50 functions/file
  vs batch-4's divergence rate as the payoff metric).
- **§E6 — same-function pool preference: QUEUED, two lines + measurement**, reported against the
  in-source 0/54 baseline.

## 7 · 🔴 OWNER DECISIONS, pending (both are gate-jurisdiction questions)

1. **`mutation (diff-scoped)` required vs advisory.** Night record: 3 catches, 2 merges-while-red
   (one left 59 survivors on main), 2 passes-after-fix, 0 false positives. But #1891 measured the
   flip's hidden cost: a move-into-the-floor refactor presents EVERY moved line as changed, so
   required-mode makes any pure relocation carry "kill every mutant in the moved body, in the
   same PR". Options: flat required / **required with a recorded-waiver for pure relocations
   (recommended)** / stay advisory.
2. **Checker selftests under the gate.** 29 of #1891's 59 survivors are mutants of `selftest`
   itself; the existing failure-injection tests are the correct guard shape and already kill
   ~404 of ~433. Options: deeper injection coverage, or a `checker-guarded-by-failure-injection`
   exclusion class in the equivalence ledger (excusing only while the injection tests exist and
   pass — the same cannot-flatter mechanics as the existing classes).

## 8 · Done when

- [x] §E1 + §E2 implemented, selftested, live-runner synced (2026-08-27).
- [ ] §E3 built; batch-3 delta measured positive; planted no-op delta measures zero.
- [x] **§E4 lane exists** (2026-08-27) — one previously-stranded file re-examined under a moved
      `testsHash`, generation-archived. ⚠️ Re-**swept**, not re-probed: see §E4-EXECUTED for why the
      probe cannot answer this question.
- [ ] **§E4b** — `mutate.mjs` accepts a recorded mutant list, so a moved `testsHash` costs a
      survivors-only re-TEST instead of a full sweep.
- [ ] §7's two owner decisions recorded (either answer closes them).
- [ ] Follow-up brief captures what §E3's first month of deltas says about §4.5–4.7's priorities.
