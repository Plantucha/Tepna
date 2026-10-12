<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — the schema is FROZEN at `tepna.verdict/1`: a changed field, or a new REQUIRED one, is `tepna.verdict/2`, both readable, never an edit here. A new OPTIONAL block stays on `/1`, since every object valid before it stays valid. `contributions` is the first, by the owner's 2026-10-04 ruling) · **last-verified:** 2026-10-12 · **Authority:** `verdict.js` (`Verdict.validate(obj) → { ok, errors[], checked[] }`) · **Executes:** `VERDICT-CONTRACT-2026-09-21-BRIEF.md` §1–§2, `VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md` §1 · **Relates:** CLAUDE.md §🧾, `docs/EXPORT-SHAPES.md` (the sibling contract for a *number* — `measurement-block.js`)

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
- **`contributions`** — OPTIONAL, and the only optional block: what a **fused** figure is made of. The
  validator runs its leg, and so grows the `checked[]` denominator, **only for an object that carries
  it**, so a producer that attributes nothing emits the bytes it emitted before. The rules are below.
- **`checked[]`** on the validator's return publishes which legs ran; a leg that could not run is an
  error, never a silent skip.

## The optional `contributions` block — a fused figure says which input moved it

`VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md` §1. A **fused** figure is one computed from more than one
node's export, or from more than one device's leg; two streams of one device whose axes are independent
count as fused. A figure with one input carries no block, because it has nothing to attribute.

```json
"contributions": {
  "of": "sigma.ankle",
  "unit": "ms^2",
  "method": "leave-one-out",
  "inputs": [
    { "key": "leg.chest-finger", "share": 0.7124754033844943, "delta": -1810.4 },
    { "key": "leg.chest-ankle",  "share": 0.0869736324281779, "delta":   221.0 },
    { "key": "leg.finger-ankle", "share": 0.2005509641873278, "delta":  -509.6 }
  ],
  "dominant": "leg.chest-finger"
}
```

| field | rule |
|---|---|
| `of` | names the figure being attributed; non-empty |
| `unit` | the figure's own unit, `""` for a dimensionless count, never omitted |
| `method` | exactly one of `leave-one-out` · `analytic` · `decomposition`, pre-stated per figure |
| `inputs[].key` | names the input; unique within the block; at least two inputs |
| `inputs[].delta` | the figure with the input minus the figure without it, signed, in the figure's unit — or `null` **with a `reason`** |
| `inputs[].share` | `\|delta\| / Σ\|delta\|`, computed, to within `1e-9` |
| `dominant` | the key with the largest `\|delta\|` — what a render names first and a reader quotes |

**`share` carries the computed number, not a display rounding.** Its invariant is that the listed
shares sum to 1 ± 1e-9, and two-decimal shares satisfy that only by luck, so the brief's §1 example is
rounded for its reader and a real block is not. A renderer rounds; the object does not.

**The ∅ rule, and why it reaches further than the brief states it.** An input that was absent or refused
is LISTED with `delta: null` and the refusal's reason — never omitted, never `0`. A leg that could not
run is a contribution of *unknown*, not a contribution of nothing.

A share, though, is a fraction of a total. One unknown term makes `Σ|delta|` unknown, so **every** share
and `dominant` go `null` with it. The validator refuses a block that normalises over the legs that did
run, which would manufacture a denominator (CLAUDE.md §∅).

A `null` here is present, never omitted: an absent key reads as a field nobody wrote, and the point is
that somebody wrote `unknown`. The validator refuses an omitted `share` and an omitted `dominant` under
an unknown denominator for that reason.

What the validator cannot see is the other half: a `delta` of `0` with re-normalised shares is
well-formed, because `0` is a legal delta for an input that moved the figure by nothing. A consumer
cannot null what it cannot distinguish, so the distinction lives in `delta: null` plus a `reason`, never
in the number.

The same holds when every `delta` is `0`: `0/0` is not `0`. The shares are `null` and no input is known
to be the largest. This is the UNDERPOWERED hat corner the brief names, and the half a reader is most
likely to get wrong.

A share says how much of the figure an input **is** under the stated method. It is not causation, and it
does not replace `reason`: `reason` says why a verdict is not `PASS`; `contributions` says what a figure
is made of, `PASS` or not.

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
`already-json` (converge) · `word-only` (exempt, with the reason) · `test` (a reader). **Every `decides` producer is GATED** — it declares `--selftest` in call position or a file under `tests/` / `capture-host/tests/` names it — a static equality over the enumerated set of checks, ratcheted (`UNGATED_RATCHET`, may only shrink), so a check with no test reds by name the day it is binned rather than by a diff rule that would flag half of all tool fixes (residue `2026-09-12-ungated-tool-fix-rule-not-viable`). An adoption is
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
