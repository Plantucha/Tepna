<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS — 2026-09-22 (§3b steps 1–7 landed and wave 2 mostly drained in one day — 24 rows adopted, 23 pending (12 of them UNKNOWN-by-design awaiting the owner's held-out decision, 2 runners awaiting the wave-3 design, 2 decide-nothing tools with residue rows); §3c records the rules the adopters found. Earlier: steps 1 and 2 of §3b landed: `verdict.js` #2797, the adoption gate + manifest with 152 producers binned; 38 adoptions pending across the waves) · **Created:** 2026-09-21 · **Interlocks:** `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` (the sibling contract for a *number*; this one is for a *verdict*) · `CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md` (phase A's `verify-seals` is a first adopter; phase C gives the suite an independent reader) · `PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md` (adoption is counted, not assumed) · CLAUDE.md §🧾

# VERDICT-CONTRACT — a gate answers in a fixed shape; prose is explanation, not the API

> **Owner, 2026-09-21, promoting this from "nice improvement" to a standing architectural
> requirement:** *"A human can determine the truth from the evidence, but a downstream machine cannot
> reliably distinguish PASS / FAIL / NOT RUN / NOT APPLICABLE / UNDERPOWERED / SHORTFALL / UNKNOWN
> without parsing prose. That is dangerous. … Then prose becomes explanation, not the API. This is
> especially important because #2793 eventually gives you an independent reader. You don't want the
> clinician reader — or a future machine reader — to regex a paragraph to decide whether evidence is
> trustworthy."*

## 0 · The failure class this closes

The suite's tools are honest in prose and unreadable by machine. `oracle-ecg-firmware-rr` prints
*"POOLED VERDICT … CONSISTENT"* or *"UNDERPOWERED and no verdict"*; `measurement-walk` prints a
✓/∘/✗ table; the byte audit printed *"13,831/14,091 match"*; the N-of-1 study will say
*stable-within-noise*. Every one of those verdicts is a string a reader must know how to interpret,
and three of the seven states a gate can be in — NOT RUN, NOT APPLICABLE, UNDERPOWERED — are the
ones that read as green to a regex looking for "FAIL". This is §4b's *"reported success about
something it never examined"* one layer up: the gate examined the right thing and reported it in a
form the next consumer cannot examine. `tools/mutation-suite.mjs:1288` already encodes the rule for
one case (*"no machine-readable result ⇒ nothing may be vouched for"*); this brief makes it the rule
for every case.

## 1 · The contract — `tepna.verdict/1`

Every gate, oracle, audit, harness or study that decides something emits **one JSON object** beside
its prose (to stdout under `--json`, to a file beside its report, or as the return value of its pure
core — whichever the tool already has), of exactly this shape:

```json
{
  "schema": "tepna.verdict/1",
  "gate": "oracle-ecg-firmware-rr",
  "status": "PASS",
  "population": { "checked": 52, "eligible": 52, "excluded": 0 },
  "criterion": { "name": "rr_delta_median", "threshold": 8, "unit": "ms", "direction": "lte" },
  "result": { "median": 0.45 },
  "evidence": ["tools/oracle-ecg-firmware-rr.mjs", "uploads/trio/**/ECGDex_*.node-export.json"],
  "reason": null,
  "producedBy": { "tool": "tools/oracle-ecg-firmware-rr.mjs", "commit": "3c0dbdec" },
  "at": "2026-09-21T18:40:12Z",
  "scope": "internal"
}
```

- **`status`** is one of EXACTLY seven values, a closed enum — no eighth, no synonyms, no
  capitalisation variants:

  | status | meaning | `result` | `reason` |
  |---|---|---|---|
  | `PASS` | the criterion was evaluated over the stated population and met | required | must be `null` |
  | `FAIL` | evaluated and not met | required | required — what missed, by how much |
  | `SHORTFALL` | evaluated; met on the headline but a stated sub-population or tail did not (the LoA case) | required | required — names the sub-population |
  | `UNDERPOWERED` | evaluated, but `population.checked` is below the pre-stated minimum for a verdict | present if computable | required — the minimum and the count |
  | `NOT_RUN` | the gate did not execute (input absent, tool refused, lane cannot run it) | `null` | required — why it did not run |
  | `NOT_APPLICABLE` | the gate ran and determined the criterion does not apply to this input | `null` | required — the property that makes it inapplicable |
  | `UNKNOWN` | the gate ran and could not decide (instrument failure, contradictory inputs) | may be partial | required |

  `NOT_RUN` and `NOT_APPLICABLE` are different states and MUST NOT be collapsed: one says nothing was
  examined, the other says something was and the rule does not bind. Both read as green to a naive
  reader, which is exactly why they are named.
- **`population`** is three integers with `checked + excluded = eligible` (an equality, not a floor —
  memory `gate-must-publish-its-denominator`). A `PASS` with `checked: 0` is invalid by schema: that is
  the examined-nothing shape, refused at the type level.
- **`criterion`** names the rule, its threshold, unit and direction (`lte | gte | eq | within`), and it
  must have been written BEFORE the measurement (memory `pre-state-the-threshold`); a tool that computes
  the threshold from the data it judges emits `status: UNKNOWN` with that as the reason.
- **`result`** carries the measured quantities the criterion was applied to, at the precision the
  criterion uses, beside full precision where rounding matters (`{ "median": 0.45, "medianFull": 0.4512 }`
  — the published-precision rule from `PUBLISHED-NUMBER-PROVENANCE` §8).
- **`evidence`** lists what a reader would open to re-derive the verdict: tool path, committed records,
  fixture globs. A `PASS` with an empty `evidence` list is invalid.
- **`producedBy.commit`** is the short sha of the tree the tool ran in; `at` is a real UTC instant (this
  is provenance of the *run*, not a floating recording time, so the Clock Contract's floating rule does
  not apply — and the field says so in the schema doc).
- **`scope`** is `internal` unless the owner's P5 ruling for that tool says `publishable` (§3); a reader must never
  take a green internal verdict as quotable.
- **Absence is `null` with a reason, never a default.** A `result` that could not be computed is `null`
  and `reason` says why (§∅ applies to verdicts too).

Prose stays. A tool keeps printing its explanation, its table, its bands. The object is the thing a
consumer reads; the prose is what a human reads to understand it. **Never the reverse.**

## 2 · The validator — `verdict.js`, one module, both lanes, no dependencies

Mirror of `measurement-block.js`: a single classic-script module exposing
`Verdict.validate(obj) → { ok, errors[], checked[] }`, loaded by both test runners and usable from
Node tools (`tools/` import it the way `measurement-walk` imports `manifest-gate`). It is the ONLY
definition of the enum and the field rules; a tool that hand-writes `"status": "PASSED"` reds here, not
in a reader's regex. `checked[]` publishes which legs ran (denominator), like the measurement validator.

Gate group `verdict-contract · schema` with plants that must red by name: an eighth status · a lowercase
status · `PASS` with `reason` set · `FAIL` with `reason: null` · `population` not summing · `checked: 0`
under `PASS` · `PASS` with empty `evidence` · `NOT_RUN` carrying a `result` · a prose-only verdict (a
string where the object should be) · `UNDERPOWERED` without the minimum named in `reason`. Anti-vacuity:
the plant runner asserts every plant was seen; the enum is asserted as an equality of seven.

## 3 · Adoption — enumerated FIRST, then counted (rewritten 2026-09-22 after the owner asked "is it generally a good list?")

The first version of this section listed eleven adopters. **It was a recency sample, not the population** —
the tools one session had touched that week — and the owner's question exposed it. Enumerated on
`origin/main` 2026-09-22 (`git grep -lE '\b(PASS|FAIL|VERDICT|UNDERPOWERED|SHORTFALL|CONSISTENT|INCONCLUSIVE)\b'`):
**103 of the `tools/*.mjs` print a verdict word, ~40 `capture-host/*.py` modules do, and 53 tools already
carry a `--json`** — so the job is mostly *converging* shapes that exist, not adding new ones, and it is an
order of magnitude larger than the list said. A list written from memory in a brief about machine-readable
verdicts was the one-of-N trap (`PARTIAL-ADOPTION-DETECTION`) committed in its own §3.

**Step 0 of the unit is therefore the triage, and its output replaces any hand list.** `tools/verdict-adoption.mjs`
enumerates every producer (the grep above, both lanes) and bins each one, with the bin recorded in a committed
manifest so the population is an equality the gate can hold:

| bin | meaning | action |
|---|---|---|
| **decides** | the tool's output is a decision someone acts on (a gate, an oracle, a night-quality verdict, a queue action) | adopt `tepna.verdict/1` |
| **already-json** | has `--json` or writes a record | converge the record to the schema (add the missing fields; keep the rest) |
| **word-only** | the status word occurs in a comment, a label, a log line that decides nothing | exempt, WITH the reason in the manifest — an exemption without a reason is a silent adoption gap |

**Wave 1 — the verdicts an outside reader meets first (BGE 2026-09-22 surfaced the first two, which the
sample had missed):**

| adopter | why first | lane |
|---|---|---|
| **`capture-host/nightqc.py` (`summarize`) + `night_report.py` + the end-of-night back-check (#2315)** | the box-side nightly verdict — the first thing a clinician or the sealed-night reader ever sees (`QC-SCOPE-RESOLUTION-2026-07-28`) | Wren / Heron (box, owner-authorized deploy) |
| `tools/verify-seals.mjs` + `unseal.py` | the seal's own reader; born emitting it (phase A, built) | Heron |
| `tools/oracle-ecg-firmware-rr.mjs` | bands already pre-stated; `UNDERPOWERED` maps 1:1 | Osprey |
| `tools/measurement-walk.mjs` | one object per fixture; a hop ✗ ⇒ `FAIL` naming the hop, ∘ ⇒ `NOT_RUN` | Magpie |
| `mutate.mjs` / `mutation_diff.py` (killed · survived · timeout) | residue `2026-09-05-mutate-diff-timeout-reads-as-kill` IS this defect: a timeout read as a pass because the verdict was a word | Osprey |
| `trio-batch.mjs` per-night gates ("NOT NOCTURNAL", "overlap 0 < 12") | verdicts that decide what enters the corpus | Kestrel |
| `n1-cohort-track` (local) | the study's verdict vocabulary maps onto the enum (§1); done — 9/9 valid. **Mapping correction:** a criterion that could not be evaluated at all (no ICC ⇒ no noise band) is `UNKNOWN`, not `SHORTFALL`; SHORTFALL is a headline MET with a tail missed | Osprey |

Wave 2: `nsrr-*-validate`, `cohort-fit`, `land-pr` / `queue-doctor` (decisions about PRs), `corpus-tier`,
the byte audit, `verify-fixtures`, `commit-shape`, `check.sh`'s advisory token (#2672), `canaryVerdict`.
Wave 3: `tests/dex-tests.js` corpus-deciding groups (design first — the runner's `T.ok` is per assertion,
a group-level verdict is the summary).

**Two boundaries the first draft did not state, and reviewers will ask:**

- **DSP-level refusals are a DIFFERENT contract.** `hostAxis → { ok:false, reason, n }`, PpgDex's `clock-seam`,
  `REFUSED-artifact` in the PAT oracle (`PAT-FORENSICS-WINDOW-ORACLE-2026-08-28` — the same argument a month
  earlier: an artifact surfaces as a *state*, never a number) are per-computation states inside an export,
  already machine-readable, already null-with-reason. They are NOT gate verdicts and do not adopt this shape;
  a gate that *judges* them emits one. Naming this keeps the two from being merged into a fourth thing.
- **Publishability rides IN the object.** `docs/ECG-PHYSIONET-DIFFERENTIAL-README.md` rules that nothing a
  tool prints may be published as external validation until the owner opens that gate (P5, owner
  2026-09-12: measure now, quote later). So `tepna.verdict/1` carries **`scope: "internal" | "publishable"`**,
  default `internal`, flipped only by the owner's ruling recorded in the producing tool — a machine reader then
  cannot mistake a green internal verdict for a quotable one.

Adoption gate: the manifest's three bins partition the enumerated set (an equality — a producer in no bin is
a red with its name); every `decides` and `already-json` entry validates under `verdict.js`; every `word-only`
entry carries a reason.

## 3b · Sequence — DECIDED (Kestrel, team lead, 2026-09-22; owner: "adoption sequence is in your hands")

Ordered by the one dependency that binds (the schema) and then by *who reads the verdict first × cost of a
wrong green*. Not a proposal; change it by editing this section with a reason.

| # | unit | owner | gate to start |
|---|---|---|---|
| 1 | `verdict.js` + `docs/VERDICT-CONTRACT.md` + ten plants + `scope` and its two plants — **landed #2797** | Osprey | — |
| 2 | `tools/verdict-adoption.mjs` + committed manifest: every producer binned (decides / already-json / word-only-with-reason), equality gate — **landed #2799** (153 binned; adoptions READ, never believed) | Osprey | after 1 — **the fleet's critical path**; nothing in wave 1 is "done" until its row reads `adopted` |
| 3 | box nightly verdicts: `night-qc` + `night-backcheck` objects beside each night's summary; `night_report` decides nothing and becomes the first CONSUMER — **#2803 (relayed)**; the unit's finding: `class_b_quality` skipped files silently and "ok" over an empty list is now `UNKNOWN` with eligible/checked/excluded visible | Wren (box), Heron reviews | after 1; deploy owner-authorized |
| 4 | `verify-seals.mjs` + `unseal.py` — validator call, `scope`, crash → UNKNOWN, consent-agreement plant — **landed #2800**, the manifest's first `adopted` row | Heron | after 1 |
| 5 | `mutation_diff.py`: killed · survived · **timeout/suspicious as `UNKNOWN`, never a kill** — **landed #2802**; `mutate.mjs` — **landed #2806**: "✓ all 0 mutant(s) killed" over changed lines with no mutable operator is now `NOT_APPLICABLE`, and the count is measured — **9 of the 36 commits the gate ran on in the last 300 took that path, and 273 of 300 read PASS in the CI summary** (264 never-ran + 9 zero-mutant), because the summary mapped exit 0 → PASS; the summary CONSUMER reads the verdict object instead (#2807, residue `2026-09-22-mutation-summary-parsed-exit-code`) | Osprey | after 2 |
| 6 | `oracle-ecg-firmware-rr --json` (landed with 1) · `measurement-walk --json` (Magpie, in the envelope-hop unit) · `n1-cohort-track` (local, done) | Osprey · Magpie | converge to 1 |
| 7 | `trio-batch` per-night gates (NOT NOCTURNAL · overlap · no anchor) — decides what enters the corpus — **landed (this PR)**: one object per night decided + one run-level object, `<out>/trio-batch-verdicts.json`, `--verdict-sample`; measured on the 67-night box tree: 67 PASS under `--allow-partial` | Kestrel | after the ECGDex emitter PR |
| 8 | wave 2 sweep, one PR per lane: `nsrr-*-validate`, `cohort-fit`, `land-pr`/`queue-doctor`, `corpus-tier`, byte audit, `verify-fixtures`, `commit-shape`, `check.sh` token, `canaryVerdict` — **`verify-fixtures` · `commit-shape` · `corpus-tier` adopted #2818 (Magpie, 2026-09-22); `extreme-mutate` · `mutation-suite` adopted #2820, `stmt-delete` band-less (residue); `ecg-physionet-differential` · `ecg-rate-transfer` · `nsrr-effort-typing` · `pletha-marker-oracle` adopted #2822, `deep-desat-falsifier` band-less (residue — states no alpha); `o2ring-finger-roundtrip` · `validate-exports` · `guide-directive-audit` adopted #2824, `beat-correspondence` · `o2ring-finger-validate-batch` band-less (residue — no indel-rate threshold; no aggregate bar over pairs) — **the 13 "trivially adoptable" JS tools are DRAINED: 9 adopted, 4 band-less with residue rows****: each prints ONE object under `--json`, rows flipped in the same PR, every `emits.cmd` corpus-free (`--check`, full-history scan, `--selftest` = the refusal plant on a scratch pair) | by lane, from the manifest | after 2 |
| 9 | wave 3: test-runner group-level verdicts — design first — **design written, §3d (Magpie, 2026-09-22, Kestrel reviewed)**: population = child gates, status by precedence, a filtered PASS is not the gate, evidence = the children's objects, an exit-code child is UNKNOWN by provenance | Magpie | after 8 has held the shape unchanged; the two runner rows adopt against §3d |

Rule for every unit: the object is asserted by a test that READS it (never the prose), the manifest row flips
in the same PR, and a unit landing before 2 is re-checked against the manifest when 2 lands.

## 3c · Rules the adopters found (2026-09-22, the first day of adoption — 24 rows adopted, 8 PRs in one lane)

Each of these was discovered by a lane owner reading a tool before flipping its row; none was in the
contract as written. They are rules now.

- **A Python adopter guards every wheel import at module level.** The static CI runner that executes
  `emits.cmd` has neither `bleak` nor `cryptography`; a tool that imports one at the top reds the static
  job on `origin/main` the moment its row flips (Heron, #2815 — `ble_sniff.py`, `probe_*.py` guard the
  import and a real run refuses by name; `unseal.py` uses `emits.file`, a committed sample pinned equal
  to the live reader on every field but `at`/`producedBy`).
- **PASS means DECIDED, never GOOD.** A two-hypothesis measurement with a pre-stated band (the 0x03
  probe's 112.9 vs 125.0 Hz at 2 %) is a criterion, and its PASS says which hypothesis held — a reader
  must not take it as a health gate. Written into the tool's own comment (#2815).
- **A tool that reports a statistic "separately", with no ratchet and no alpha, decides nothing** and
  is NOT wrapped — wrapping it would manufacture a verdict. Two found on day one: `stmt-delete.mjs`
  (Level B is a measurement; the ratchet `extreme-mutate` has is a design change, residue
  `2026-09-22-stmt-delete-has-no-ratchet`) and `deep-desat-falsifier.mjs` (a sign-test p-value with no
  stated alpha; the alpha belongs in the parent brief first, residue
  `2026-09-22-deep-desat-falsifier-states-no-alpha`). Both rows stay `pending` with the reason.
- **A tool's own SHORTFALL band maps to FAIL** when it is a headline miss; the contract's `SHORTFALL`
  is a met headline with a failed sub-population (`ecg-physionet-differential`). A graded miss (PARTIAL)
  is FAIL with the grade in the reason — the enum is closed (`nsrr-effort-typing`).
- **A band written after the numbers are on record is post-hoc ⇒ `UNKNOWN` by design**, with the §1
  sentence as the reason and ONE residue row per family naming the only route to a band (a held-out run
  on unseen records, or a brief that pre-states one before the next run). Twelve tools sit here — the
  four NSRR pool scorers (#2811) and eight analysis tools (#2817, `tools/verdict-undeclared.mjs`); the
  campaign is the owner's call.
- **A consumer never picks a side.** `mutation-summary.mjs` (#2807): status and exit code disagree ⇒
  `UNKNOWN`; no object ⇒ `UNKNOWN`, never PASS. Measured before it existed: **273 of the last 300
  commits read PASS on the JS mutation gate's CI summary** — 264 where no mutable source changed and 9
  where the gate ran on zero mutants and printed "✓ all 0 mutant(s) killed" — because the summary mapped
  exit 0 → PASS.
- **A runner's verdict aggregates its children's; it never restates them.** `run-check.mjs` and
  `selftest-all.mjs` decide (every step/suite green) and stay `decides`/`pending` until the wave-3
  design (§3b #9) says what a run-level object over a population of gates looks like. Not wrapped now — **the design is §3d**.
- **Queue actions and fail-closed classifications are not verdicts.** `land-pr` (update · wait · merge ·
  stop — a queue decision in its own vocabulary, consuming CI's verdicts), `mutation-reach` and
  `mutation-worklist` (which files/functions are in scope) are `word-only` with those reasons.
- **One shared builder per lane, not per tool.** JS: `tools/verdict-emit.mjs` (make + validate +
  commit, throws on an invalid object) for declared tools and `tools/verdict-undeclared.mjs` for
  band-less ones; Python: `capture-host/verdict.py`. A tool that builds its own object by hand reds the
  validator the day the schema moves.
- **The validator catches its authors.** Building `trio-batch`'s emitter (#2810) it refused a PASS with
  empty evidence and a NOT_APPLICABLE carrying a result; building the oracle's, five stale plants failed
  on `scope`; building PpgDex's, an asymmetric +27 % on one leg of one input was caught by the pre-stated
  band and re-measured interleaved. That is what the contract is for.
- **The object says what the prose's parenthesis means.** `selftest-all` prints `✓ 121 tools, 1666+
  assertions — all green (26 green but unparseable)`; its `tepna.verdict/1` object over the same run is
  **`UNKNOWN` over `{checked 121, eligible 121, excluded 0}`** — 26 children whose selftest printed no
  count the runner can read are UNKNOWN, and one UNKNOWN among 95 PASSes is UNKNOWN by precedence, not
  a vote (#2828, §3d). Same run, same numbers; the word said green and the object says undecided. The
  day's cleanest example of the whole contract: prose is explanation, the object is the API.

## 3d · Wave 3 — the RUNNER-LEVEL object (design, Magpie 2026-09-22, reviewed Kestrel; §3b #9 — a note, not code)

**The sentence that makes wave 3 pull wave 2:** a runner's evidence is its children's OWN objects, and a
child that is still a word-and-exit-code counts as **UNKNOWN by provenance** in the tally — so the runner's
PASS is unreachable until every child beneath it adopts. A runner-level object can never read greener than
its least-adopted child; that is the lever, and everything below is the bookkeeping that makes it hold.

A runner (`tools/run-check.mjs` · `tools/selftest-all.mjs` · `tests/run-tests.mjs`) decides nothing of its
own: every verdict it prints is an AGGREGATION of children, and the two pending runner rows in the manifest
are pending because the shape of that aggregation was never written down. This section writes it down so
the rows have something to adopt against. Nothing here changes `tepna.verdict/1` (§1) — a runner emits the
same object, with the same seven statuses; what is fixed is how the fields are FILLED from children.

**Population = the child gates, and the three counts are the runner's own plan.**
`eligible` = every child the runner would run on this invocation (`STEPS.length` for run-check; the
`--selftest` tools discovery finds for selftest-all; the groups the shard plan selects for the test runner).
`checked` = children that RAN TO A VERDICT (any status but NOT_RUN). `excluded` = children never asked —
run-check's `notRun` after an abort, a selftest skipped for a missing runtime, a group the filter dropped.
The equality `checked + excluded = eligible` is then the runner's "one step failed and ten were never
asked" made structural (residue `2026-09-05-check-chain-aborts-on-load-timeout`): a runner that aborts at
step 6 of 18 reports `checked 6 · excluded 12`, and a reader cannot mistake it for a run of 18.

**Status = an aggregation rule, fixed here and asserted by a plant per row:**

| children | runner status | why |
|---|---|---|
| any FAIL | **FAIL** | one red child reds the run; the reason names the first failing child and the count |
| any SHORTFALL, no FAIL | **SHORTFALL** | the headline (every child that ran, ran green) is met and a named sub-population missed — the same meaning §1 gives the word |
| any UNKNOWN or UNDERPOWERED, no FAIL/SHORTFALL | **UNKNOWN** | a child that could not decide leaves the run undecided — a crash, a timeout (`2026-09-05-mutate-diff-timeout-reads-as-kill`), a vacuous pass, are never green one level up |
| any NOT_RUN child | never PASS — the run is **UNKNOWN** if the NOT_RUN was not planned (an abort), **PASS over a smaller `checked`** only when the exclusion was DECLARED by the invocation (`--group=`, `--list`) and the object says so in `result.excludedBy` | a runner that aborts and reports green about the steps it skipped is exactly §0's failure |
| every child PASS or NOT_APPLICABLE, `checked ≥ 1` | **PASS** | NOT_APPLICABLE children (a gate whose criterion does not bind on this tree, e.g. `mutate.mjs` over a diff with no mutable operator) count as checked-and-not-binding, never as green evidence; `result.notApplicable` carries their names |
| `checked = 0` | **NOT_RUN** | the type-level rule (§1: PASS over checked = 0 is refused) — a runner with no children examined ran nothing |

Precedence is the table's order (FAIL > SHORTFALL > UNKNOWN > PASS), and it is deliberately NOT a vote:
one UNKNOWN among fifty PASSes is UNKNOWN, because the fifty cannot say what the one would have said.

**A FILTERED run must be unmistakable to a consumer** (Kestrel, on review). Whenever `excluded > 0` by
declaration, the object carries **`result.filtered: true`** beside `result.excludedBy`, and the consumer
rule is stated here so it is not re-derived: **the CI summary and any merge decision treat a filtered PASS
as NOT the gate.** A `--group=` pass prints exactly like the full gate (memory `test-suite-group-filter`;
§4b's family — a check reporting on what it never examined), and the flag is the only thing that separates
the two on the wire.

**The exit code STAYS.** The shell and CI keep reading `process.exit` until the consumer switches to the
object — the same sequencing #2806/#2807 used for `mutate.mjs` (the object first, then the summary reads
it). Stated here so nobody "fixes" a runner to exit on the object and breaks every caller the day it lands.

**Criterion** is the rule itself, pre-stated: `{ name: 'children_failing (any FAIL ⇒ FAIL; UNKNOWN never
green; NOT_RUN counted excluded)', threshold: 0, unit: 'failing children', direction: 'eq' }`. **Result**
carries the tally — `{ children, pass, fail, shortfall, unknown, notApplicable, notRun, firstFailure }` —
and, for the test runner, the assertion counts per group beside the group statuses (the runner's `T.ok` is
per assertion; the group's verdict is the summary, never a substitute for the per-assertion output).

**Evidence = the children's OWN objects**, not the runner's log. A runner whose children already emit
`tepna.verdict/1` lists the path of each child object (or embeds it under `result.children[]` when a child
prints to stdout and nothing persists it); a runner whose child is still a word-and-exit-code (most of
`STEPS` today) lists the step name and exit code and marks that child `UNKNOWN`-by-provenance in the tally —
so the runner-level object cannot read greener than the least-adopted child beneath it. That is the lever
that makes wave 3 pull wave 2 along: the runner's PASS is only reachable once every child it aggregates
emits an object.

**An external tool with a published exit-code contract is read BY that contract** (ruled 2026-09-22, on
`check.sh`'s object, #2830): the exit code is a machine-readable API the tool already publishes, so keying on
it is not prose-parsing — the mapping is written in the adopter beside the tool's version (`checkverdict.py`:
ruff · shellcheck · pytest). **A tool of OURS never gets this exemption — it adopts or counts UNKNOWN by
provenance** (`find_unwired.py` exits 1 for a finding AND for a crash, which is exactly why it owes its own
object; until then `check.sh`'s object reads UNKNOWN on a green run — the lever above, working). **A code the
contract does not name is UNKNOWN.**

**Where each runner sits today, so the two rows can be costed:**
- `run-check.mjs` already computes `ran` / `notRun` / `failedIdx` (`planAfterFailure`); the object is a
  projection of that plus the child exit codes — the smallest of the three. Children are exit codes for now,
  so the first adopted object is honestly `UNKNOWN` on every run until the steps adopt; that is the point. **Adopted #2827 (2026-09-22)** — `aggregateChildren` in `tools/verdict-emit.mjs` is the shared rule, fifteen plants, `--steps=` is the declared exclusion; measured `UNKNOWN` over 2/18 filtered on a real subset run.
- `selftest-all.mjs` reads a parseable `all N selftests passed` line per tool and already refuses an
  unparseable one (`nearMiss → exit 1`); its children are per-tool verdicts, so `checked` = tools with a
  parsed summary, `excluded` = tools discovery found and did not run, and an unparseable summary is UNKNOWN,
  never a failure of the tool under test. **Adopted #2828 (2026-09-22)** — children read from the summary line (provenance `summary`); measured on the real sweep `UNKNOWN` over 121/121, 26 ratcheted-unparseable children, where the prose says "all green".
- `tests/run-tests.mjs` is the largest and is the one §3 named for "design first": the corpus-deciding
  groups (`docs-ledger`, `release-ledger`, `verdict-adoption`, the equiv legs) become children; a group is a
  child, an assertion is not. A shard emits its own object over the groups it ran; the union runner
  aggregates the shard objects by the table above, so a shard that died (§4c) is a NOT_RUN child and the
  union is UNKNOWN, never a pass over the shards that finished.

**Done when** (for a runner row to flip): the object is printed under `--json`; a plant per table row
(a planted FAIL child, a planted UNKNOWN child, a planted abort) is asserted by a test that READS the
object; the manifest row's `emits.cmd` is the runner over a scratch step list, corpus-free.

## 4 · What this does NOT do

- It does not replace prose, bands, tables or the `T.ok` assertion style. It adds one object.
- It does not make a verdict *right*. A tool that pre-states the wrong band emits a well-formed wrong
  `PASS`; the contract makes that checkable, not impossible.
- It is not a badge tier. `status` is the outcome of one rule over one population; the evidence ladder
  (§🎫) is per-metric epistemics. Do not map one onto the other.
- It does not touch the node exports' `measurement` blocks — those are numbers with lineage; verdicts
  are decisions about numbers. The two contracts compose (a verdict's `evidence[]` may name blocks).

## 5 · Done when

- [x] `verdict.js` + `docs/VERDICT-CONTRACT.md` (schema frozen at `tepna.verdict/1`); gate group with the
      ten plants, denominator published, anti-vacuity leg.
      ✅ **DONE 2026-09-22 (Osprey, #2797)** — plus `scope: internal|publishable` (required on read, no
      default; `make()` fills the restrictive `internal`) and its two plants; 24 assertions, eight legs,
      enum equalities of seven and two; registered in both lanes + the mutation fleet.
- [ ] Wave 1 adopters emit valid objects (oracle · measurement-walk · verify-seals · n1-cohort-track).
- [x] `tools/verdict-adoption.mjs` names the set as an equality and reds on a producer outside it.
      ✅ **DONE 2026-09-22 (Osprey).** The population is COMPUTED (`git grep` for the verdict words over
      `tools/*.mjs` + `capture-host/*.py`, on the tree) and every member is binned in the committed
      `tools/verdict-adoption.json`: **152 producers — decides 25 · already-json 13 · word-only 75 (each
      with its reason; 60 are selftest assertion printers whose machine-readable result is the exit code +
      the `all N selftests passed` line) · test 39 (readers, not producers); 38 pending adoptions, 0
      adopted.** The gate holds the partition as an EQUALITY both ways (an unbinned producer, or a stale
      row, is a red with its name), demands a reason on every exemption, and READS an adoption — runs
      `emits.cmd` or reads `emits.file` and validates under `verdict.js` — never believes the row.
      Measured on its first run against main: it caught #2796's three new files (`verify-seals.mjs`,
      `unseal.py`, `test_seal.py`) by name. `verify:verdict-adoption` in `npm run check` and the CI
      `static` job. 13 selftests. `emits.cmd` must be cheap and corpus-free (CI runs it): a
      `--vectors --json` / selftest emission or a committed record, not the tool's real run.
- [ ] CLAUDE.md §🧾 states the rule (landed with this brief); DOCS-INDEX row; header → DONE with the
      adopter count measured, wave 2/3 as residue rows if not done in the same unit.
