<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — the schema is FROZEN at `tepna.verdict/1`; a field change is `tepna.verdict/2` with both readable, never an edit here) · **last-verified:** 2026-09-21 · **Authority:** `verdict.js` (`Verdict.validate(obj) → { ok, errors[], checked[] }`) · **Executes:** `VERDICT-CONTRACT-2026-09-21-BRIEF.md` §1–§2 · **Relates:** CLAUDE.md §🧾, `docs/EXPORT-SHAPES.md` (the sibling contract for a *number* — `measurement-block.js`)

# `tepna.verdict/1` — a gate answers in a fixed shape; prose is explanation, not the API

Every gate, oracle, audit, harness or study that **decides** something emits **one JSON object** of
this shape beside its prose. A reader — a CI job, a downstream tool, a clinician reader, a future
machine — reads the object; a human reads the prose to understand it. Never the reverse. The
failure this closes: three of the seven states a gate can be in — `NOT_RUN`, `NOT_APPLICABLE`,
`UNDERPOWERED` — read as green to a regex looking for "FAIL". That is §4b's *"reported success about
something it never examined"* one layer up: the gate examined the right thing and reported it in a
form the next consumer could not examine.

```json
{
  "schema": "tepna.verdict/1",
  "gate": "oracle-ecg-firmware-rr",
  "status": "SHORTFALL",
  "scope": "internal",
  "population": { "checked": 52, "eligible": 55, "excluded": 3 },
  "criterion": { "name": "rr_delta_median_time_paired", "threshold": 8, "unit": "ms", "direction": "lte" },
  "result": { "rrMedianAbsMs": 0.45, "rrMedianAbsMsFull": 0.4512, "rrLoaMs": 35.3, "rrEmpirical95Ms": 1.9 },
  "evidence": ["tools/oracle-ecg-firmware-rr.mjs", "/corpus/**/{*_ECG.txt,*_RR.txt}"],
  "reason": "rrLoa SHORTFALL (LoA 35.3 ms vs ≤ 30; empirical 95 % 1.9 ms — tail-driven); 4 night(s) < 90 % matched: …",
  "producedBy": { "tool": "tools/oracle-ecg-firmware-rr.mjs", "commit": "3c0dbdec" },
  "at": "2026-09-21T18:40:12Z"
}
```

## The seven statuses — a closed enum, case-exact, no synonyms

| status | meaning | `result` | `reason` |
|---|---|---|---|
| `PASS` | the criterion was evaluated over the stated population and met | required | must be `null` — a PASS that needs explaining is not a PASS |
| `FAIL` | evaluated and not met | required | required — what missed, by how much |
| `SHORTFALL` | met on the headline; a stated sub-population or tail did not (the LoA case) | required | required — names the sub-population |
| `UNDERPOWERED` | evaluated, but `population.checked` is below the pre-stated minimum | present if computable | required — **the minimum and the count, as numbers** |
| `NOT_RUN` | the gate did not execute (input absent, tool refused, lane cannot run it) | `null` | required — why it did not run |
| `NOT_APPLICABLE` | the gate ran and determined the criterion does not bind to this input | `null` | required — the property that makes it inapplicable |
| `UNKNOWN` | the gate ran and could not decide (instrument failure, contradictory inputs) | may be partial | required |

`NOT_RUN` and `NOT_APPLICABLE` are different states and are never collapsed: one says nothing was
examined, the other says something was and the rule does not bind. The validator rejects `"PASSED"`
(an eighth value) and `"pass"` (a capitalisation variant) by name.

## Field rules the validator enforces (each a leg in `checked[]`)

- **`scope`** — `internal | publishable`, a closed two-value enum, **required**. P5 rides in the
  object: only a `publishable` verdict may have its numbers quoted outside the repo, and the absence of
  the field is invalid rather than defaulting to either — a verdict that does not say whether it may be
  quoted has not decided. `Verdict.make()` fills `internal` when the producer gives none, because the
  safe default is the restrictive one; a producer must WRITE `publishable` to lift it.

- **`population`** — three non-negative integers with `checked + excluded = eligible`, an **equality**,
  not a floor (memory `gate-must-publish-its-denominator`). `PASS` over `checked: 0` is invalid: the
  examined-nothing shape, refused at the type level.
- **`criterion`** — `name`, `threshold` (a finite number, or `[lo, hi]` for `within`), `unit` (a
  string; `""` for a dimensionless count, never omitted), `direction` ∈ `lte | gte | eq | within`. It
  must have been written **before** the measurement (memory `pre-state-the-threshold`); a tool that
  derives the threshold from the data it judges emits `UNKNOWN` with that as the reason.
- **`result`** — the measured quantities the criterion was applied to, at the precision the criterion
  uses, beside full precision where rounding matters (`rrMedianAbsMs: 0.45, rrMedianAbsMsFull: 0.4512`
  — `PUBLISHED-NUMBER-PROVENANCE` §8). `null` when it could not be computed, with `reason` saying why.
- **`evidence`** — what a reader would open to re-derive the verdict: tool path, committed records,
  fixture globs. `PASS`, `FAIL` and `SHORTFALL` with an empty list are invalid — a claim with nothing
  to open.
- **`producedBy`** — `{ tool, commit }`; `commit` is the short sha of the tree the tool ran in, or
  `null` **with `commitReason`** (∅: absence says why). **`at`** is a real UTC instant with `Z` —
  provenance of the *run*, not a floating recording time, so the Clock Contract's floating rule does
  not apply here and the validator rejects a stamp without `Z`.
- **`checked[]`** on the validator's return publishes which legs ran; a leg that could not run is an
  error, never a silent skip.

## What it does NOT do

It does not replace prose, bands, tables or the `T.ok` style — it adds one object. It does not make a
verdict *right*: a tool that pre-states the wrong band emits a well-formed wrong `PASS`; the contract
makes that checkable, not impossible. It is not a badge tier: `status` is the outcome of one rule over
one population; the evidence ladder (§🎫) is per-metric epistemics — never map one onto the other. It
does not touch the exports' `measurement` blocks: those are numbers with lineage, verdicts are
decisions about numbers; the two compose (a verdict's `evidence[]` may name blocks).

## Producers (the named set, counted — `VERDICT-CONTRACT` §3)

The set is not this table — it is **`tools/verdict-adoption.json`**, held equal to the enumerated
population by `tools/verdict-adoption.mjs --check` (`npm run check` · CI `static`): every file in
`tools/*.mjs`, `capture-host/*.py` and `tests/*.mjs` (non-recursive; `tests/` joined 2026-09-22 when the test runner adopted §3d from outside the population) that prints a verdict word is binned as `decides` (adopt) ·
`already-json` (converge) · `word-only` (exempt, with the reason) · `test` (a reader). An adoption is
READ by the gate — `emits: { cmd: […] }` printing the object, or `emits: { file }` — and validated here;
a row is never believed. Because CI runs `emits.cmd`, it must be cheap and corpus-free (a
`--vectors --json` or selftest emission, a committed record), not the tool's real run. Below, the
adopters landed so far; the manifest carries the pending ones by name.

| adopter | shape | since |
|---|---|---|
| `n1-cohort-track` (local study, not committed) | `stable-within-noise → PASS` · `drifting → FAIL` (direction in `reason`) · `variable-no-trend → SHORTFALL` · no ICC → `UNKNOWN` · `inconclusive → UNDERPOWERED` · `inconclusive-for-stratum → NOT_APPLICABLE` with the stratum n; every object `scope: internal` (P5) | 2026-09-21 |
| `tools/oracle-ecg-firmware-rr.mjs` · `tools/measurement-walk.mjs` · `tools/verify-seals.mjs` · the box-side nightly verdicts · wave 2/3 | per the brief's §3 as enumerated (103 `tools/*.mjs` + ~40 box modules print a verdict word; 53 already `--json`) — binned by `tools/verdict-adoption.mjs` and its committed manifest | pending — the validator lands first, the adopters against it |

`Verdict.make(fields)` fills `schema` and `at` and null defaults so a producer writes the shape once;
it does **not** validate — call `validate()` on what it returns.
