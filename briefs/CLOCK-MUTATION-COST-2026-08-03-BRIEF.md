<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-03 (**executed to a measured NO on the narrowing, and the cost premise is corrected: the ~16 h is a SEQUENTIAL figure; the tool already parallelises and the real wall-clock is ~40 min. The enabling instrumentation shipped.**) · **Created:** 2026-08-03

# The clock.js mutation run costs ~16 hours, and the Python fix does not transfer

## The measurement

`tools/mutate.mjs` runs `node tests/run-tests.mjs --group=<tag>` once **per mutant**. For `clock.js`:

| | |
|---|---|
| one `--group=clock` run | **7 m 49 s** (measured 2026-08-03) |
| groups it selects | 41 (609 assertions) |
| clock.js mutants | 123 (exhaustive baseline, 86 killed = 70 %) |
| **implied full run** | **~16 h** |

`CLOCK-MUTATION-AUDIT-2026-08-02` already named the mechanism — *"clock.js is also the most expensive
module to test … expensive-to-test correlates with under-tested, which is backwards for a spine"* — and
recorded the exhaustive run as taking 40 min at 81 mutants. The cost has grown with the suite.

## Why the Python fixes do not apply

`capture.py`'s 36-day figure came from mutmut generating one 100 MB module and recompiling it per
mutant; that was fixed by letting the bytecode cache persist and reusing the scratch
(`MUTATION-AUDIT-FINDINGS-2026-08-02` § Sixth pass). **Neither applies here.** `mutate.mjs` patches the
file in place and re-runs the suite; there is no giant generated file, and Node's compile cost is not
the bottleneck. **The cost IS the test selection.**

## Why the in-process trick is unsound here — do not try it

The obvious analogue (load the suite once, swap `DexClock.parseTimestamp` per mutant, re-run only the
covering assertions) is **not sound for this module**, and would fail silently:

```
hrvdex-dsp.js:66     parseTimestamp = DexClock.parseTimestamp;
motiondex-dsp.js:27  var parseTimestamp = DexClock.parseTimestamp;
integrator-dsp.js:29 parseTimestamp = DexClock.parseTimestamp;
pulsedex-dsp.js:41   parseTimestamp = DexClock.parseTimestamp;
oxydex-dsp.js:208    parseTimestamp = DexClock.parseTimestamp;
```

Five adopters bind the function at **load time** — the delegation pattern `CLAUDE.md` §✅ describes and
`clock.js`'s own header documents. A post-load swap is invisible to all of them, so every mutant those
DSPs would have killed reports as **survived**. That is a false negative in a measurement tool: it would
claim "nothing tests this" about code that is thoroughly tested, which is worse than not measuring.

## The proposal: find the groups that can actually see a clock mutation

The `clock` tag selects 41 groups. The question nobody has asked is how many of them can **observe** a
mutation of `clock.js` at all — a group that never parses a timestamp cannot.

**Done when:**

1. For a sample of known-killed clock mutants, record WHICH group killed each (`mutate.mjs` already
   knows the failing group). The union over all 123 is the minimal sufficient selection.
2. If that union is materially smaller than 41, add a narrower tag (say `clock-core`) and have
   `mutate.mjs` prefer it for `clock.js`, keeping `--full` as the certainty escape hatch.
3. **Verify by re-running the exhaustive 123 under the narrow selection and requiring the SAME
   86 killed.** A faster measurement that changes the answer is not a faster measurement. This is the
   acceptance criterion; without it the change is unsafe.
4. Record the new per-mutant cost in `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`.

**Explicitly NOT in scope:** in-process function swapping (unsound, see above), and lowering the
existing exhaustive baseline. The 70 % figure stands until re-measured.

## Why it is worth doing

`clock.js` is the Clock Contract — *"non-negotiable — every app + every future node must obey"* — and it
is the least-tested module in the suite at 70 %, with the §2.7 component-range guard and the §3 DMY/MDY
boundary among its documented-invariant survivors. A 16-hour measurement is one nobody will run, so the
gap will not close on its own. The cost is the reason, and the cost is fixable.


---

## RESULT — executed 2026-08-03

### The premise needed correcting first: ~16 h is the SEQUENTIAL cost

`mutate.mjs` has shipped a measured worker pool since before this brief: `defaultJobs(cores) =
round(cores × ⅔)`, i.e. **16 workers on this 24-core box**, with the tuning curve in its own header
(4 → 23 s, 8 → 17 s, 16 → 14 s, 24 → 20 s — it degrades past ⅔ of the cores). Measured three times
today on `clock.js`, exhaustive: **~40 min wall-clock**, and the tool's own estimator agrees (2251 s).

So the headline is off by ~16×. `7 m 49 s × 123` is what the run would cost *serially*, and nothing
runs it serially. The cost problem is real but an order of magnitude smaller than stated, which changes
what is worth doing about it.

### Done-when 1 — the measurement, and the tool could not do it

The brief assumed *"`mutate.mjs` already knows the failing group"*. **It did not.** It spawned the suite
with `stdio: 'ignore'`, so a mutant's entire result was an exit code. Capturing the killing group was
therefore the enabling change, and it shipped: `runSuiteAsync` now pipes stdout, extracts the failing
group titles, and every result carries a `killers` list (group → mutants killed). A surviving mutant
exits 0 and is never scanned, so the common case costs nothing.

Exhaustive on `clock.js` (127 mutants, 93 killed):

| | |
|---|---|
| groups `--group=clock` actually runs | **42** |
| groups `mutate.mjs` *reported* | 20 |
| groups that ever killed a mutant | **21** |

### A reporting bug, found on the way: the tool understated its own workload 2.1×

`groupsForFile` counted only groups whose **tag** carries the exact stem, but `--group=` selects by a
case-insensitive **regex over title OR tag**. For `clock` that is 20 vs 42 — the stem is a common
English word, so it matches titles like *"ECGDex worker clock"* and *"a real arousal near a clock
hour"*. `pat-align` and `ppgdex-dsp` show no divergence (2 = 2, 42 = 42); `clock` is the pathological
case, and it is why this brief's cost model would not reconcile. Both numbers are reported now
(`groups: clock (20 tagged, 42 RUN)`).

### Done-when 2/3 — the narrowing is measured and REFUSED, with the reason

**The obvious cheap version is unsafe.** Selecting by tag alone would take 42 → 20 groups for free, no
tagging work. It also **loses 7 of the 21 killer groups — including the single biggest, `Clock Contract
— parseTimestamp` at 54 kills** — because their tags do not carry the `clock` stem even though their
titles do. That is 159 kill-attributions dropped; the score would fall and it would read as the code
having got worse. **The loose title-or-tag match is load-bearing, not sloppy.**

**The sound version is not worth it.** The honest ceiling is the 21-group union out of 42 — about **2×**,
on a run that is already ~40 min. Reaching it needs a per-module allow-list of group titles, which goes
stale silently as tests are renamed and moved, and re-verifying it costs a full exhaustive run each time.
That is precisely the committed-list merge tax `CPAP-REAL-CORPUS-FOLLOWUPS-II` §4 retired twice
(`docs-ledger-list.txt`, `changes-list.txt`). Paying it again for 2× on a 40-minute audit tool is a bad
trade, and the acceptance criterion in Done-when 3 — *"requiring the SAME 86 killed"* — is what makes the
cost recur rather than be paid once.

**So: no `clock-core` tag.** The measurement that would justify one now exists, so if the run ever grows
past tolerable the decision can be revisited against data rather than re-derived.

### What shipped

- `killers` capture — the measurement this brief needed, now a permanent tool capability.
- Honest group-count reporting (`N tagged, M RUN`).
- **Two observability fixes.** Under `--json` the tool printed *nothing* for the entire run — no progress,
  no job count — and suppressed the worker-pool warning. Both now go to stderr in every mode (stdout
  stays pure NDJSON). This is not cosmetic: while executing this brief I twice sampled a run during its
  ~5 min calibration phase, saw 0 worktrees and load 1.1, and concluded the pool had collapsed to
  serial. It had not. A harness whose progress is invisible invites exactly that misreading.

### Not done, and deliberately

Done-when 4 asked for the new per-mutant cost in `MUTATION-AUDIT-FINDINGS`. There is no new per-mutant
cost — the narrowing was refused — so the figure to record is the corrected one: **~40 min exhaustive at
16 jobs, not ~16 h**, and it is recorded here rather than as a change to an audit that measured
something else.
