<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED · **Created:** 2026-09-21 · **Interlocks:** `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` (the sibling contract for a *number*; this one is for a *verdict*) · `CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md` (phase A's `verify-seals` is a first adopter; phase C gives the suite an independent reader) · `PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md` (adoption is counted, not assumed) · CLAUDE.md §🧾

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
  "at": "2026-09-21T18:40:12Z"
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

## 3 · Adoption — counted, not assumed

`PARTIAL-ADOPTION-DETECTION` showed six one-of-N adoptions in one day; this contract is exactly the
kind of mechanism that gets wired to one tool and declared done. So adoption is a **named set with a
gate**, not a sweep:

| adopter | how | wave |
|---|---|---|
| `tools/oracle-ecg-firmware-rr.mjs` | `--json` emits the object (its bands already exist; `UNDERPOWERED` maps 1:1) | 1 — Osprey |
| `tools/measurement-walk.mjs` | `--json` emits one object per fixture; a hop ✗ ⇒ `FAIL` naming the hop; `∘` ⇒ `NOT_RUN` per hop | 1 — Magpie, with the envelope-hop unit |
| `tools/verify-seals.mjs` (NIGHT-SEAL phase A) | born emitting it — the first reader of a sealed night must never parse prose | 1 — Heron |
| `n1-cohort-track` (local study) | `stable-within-noise → PASS`, `drifting → FAIL` (direction in `reason`), `variable-no-trend → SHORTFALL`, `inconclusive → UNDERPOWERED`, `inconclusive-for-stratum → NOT_APPLICABLE` with the stratum n | 1 — Osprey |
| `tools/mutation-suite.mjs canaryVerdict` | already refuses to vouch without a machine-readable result — align its object to the schema | 2 |
| `capture-host/check.sh` advisory state token (#2672) | the Python lane's equivalent: a JSON verdict file beside the token | 2 — Heron |
| `corpus-tier.mjs`, the byte audit, `verify-fixtures`, `queue-doctor`, `commit-shape` | each prints a verdict today; each emits the object | 2 |
| every `tests/dex-tests.js` group that decides on a corpus (oracle, equiv, fixture identity) | the runner already has `T.ok/T.eq`; a group-level verdict object is the summary | 3 — design first |

Adoption gate: `tools/verdict-adoption.mjs` lists the named set, runs each adopter's `--json` (or reads
its file) and validates; the set is an equality, and a tool that prints a status word (`grep -lE
'\b(PASS|FAIL|UNDERPOWERED|SHORTFALL)\b' tools/*.mjs`) but is not in the set is a red with the tool's
name — the consumer-call-site check from `PARTIAL-ADOPTION-DETECTION`, applied to producers.

## 4 · What this does NOT do

- It does not replace prose, bands, tables or the `T.ok` assertion style. It adds one object.
- It does not make a verdict *right*. A tool that pre-states the wrong band emits a well-formed wrong
  `PASS`; the contract makes that checkable, not impossible.
- It is not a badge tier. `status` is the outcome of one rule over one population; the evidence ladder
  (§🎫) is per-metric epistemics. Do not map one onto the other.
- It does not touch the node exports' `measurement` blocks — those are numbers with lineage; verdicts
  are decisions about numbers. The two contracts compose (a verdict's `evidence[]` may name blocks).

## 5 · Done when

- [ ] `verdict.js` + `docs/VERDICT-CONTRACT.md` (schema frozen at `tepna.verdict/1`); gate group with the
      ten plants, denominator published, anti-vacuity leg.
- [ ] Wave 1 adopters emit valid objects (oracle · measurement-walk · verify-seals · n1-cohort-track).
- [ ] `tools/verdict-adoption.mjs` names the set as an equality and reds on a producer outside it.
- [ ] CLAUDE.md §🧾 states the rule (landed with this brief); DOCS-INDEX row; header → DONE with the
      adopter count measured, wave 2/3 as residue rows if not done in the same unit.
