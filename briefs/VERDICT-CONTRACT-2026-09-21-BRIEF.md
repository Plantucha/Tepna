<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS — 2026-09-22 (steps 1 and 2 of §3b landed: `verdict.js` #2797, the adoption gate + manifest with 152 producers binned; 38 adoptions pending across the waves) · **Created:** 2026-09-21 · **Interlocks:** `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` (the sibling contract for a *number*; this one is for a *verdict*) · `CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md` (phase A's `verify-seals` is a first adopter; phase C gives the suite an independent reader) · `PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md` (adoption is counted, not assumed) · CLAUDE.md §🧾

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
| 8 | wave 2 sweep, one PR per lane: `nsrr-*-validate`, `cohort-fit`, `land-pr`/`queue-doctor`, `corpus-tier`, byte audit, `verify-fixtures`, `commit-shape`, `check.sh` token, `canaryVerdict` — **`verify-fixtures` · `commit-shape` · `corpus-tier` adopted #PRNUM (Magpie, 2026-09-22)**: each prints ONE object under `--json`, rows flipped in the same PR, every `emits.cmd` corpus-free (`--check`, full-history scan, `--selftest` = the refusal plant on a scratch pair) | by lane, from the manifest | after 2 |
| 9 | wave 3: test-runner group-level verdicts — design first | Magpie | after 8 has held the shape unchanged |

Rule for every unit: the object is asserted by a test that READS it (never the prose), the manifest row flips
in the same PR, and a unit landing before 2 is re-checked against the manifest when 2 lands.

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
