<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living record) · **Created:** 2026-11-12 · **last-verified:** 2026-11-12

# BUS-CONF-PROVENANCE — the source of each tuned bus `conf` constant

> A `conf:` value on the Ganglior bus states a confidence. The residue row
> `2026-11-12-bus-confidence-constants-carry-no-source` records the defect: no site states where its
> number comes from. The gate `tools/bus-conf-provenance.mjs` holds the class at today's size. This
> record names the source of the eleven sites that already exist.

## Why one record and not one comment per site

A comment above each number moves `manifestHash` on ten pages, because every `*-dsp.js` inlines
byte-for-byte. Five nodes then owe fixture re-verification against the corpus. The churn buys nothing,
because ten of the eleven numbers date to the initial import, where no commit can state a basis. So the
provenance lives here, keyed by identifier, and the bundles stay still.

## Method

Each site took a `git log --pickaxe-regex -S` over its own literal, per file and over the whole repo.
A regex that tolerates whitespace is load-bearing: the Biome reflow `02d335d5b` (2026-07-15) re-wrapped those lines,
so a bare `grep -cF` at the import commit answers zero for five of the sites. The census itself comes
from `node tools/bus-conf-provenance.mjs --json`, which keys a site on its nearest `impulse` identifier
and never on a line number.

## Verdict vocabulary

- **`declared`** — a doc writes the value down as the contract. The basis stays unstated.
- **`examined`** — a brief or an audit measured events at that value, or analysed the clamp around it.
- **`no stated basis`** — no commit, brief, audit or doc states the number.

## The eleven sites

| site | value | earliest visible commit | citation | verdict |
|---|---|---|---|---|
| `ecgdex-dsp.js#stage_` | `0.7` | `176ea8c3e` 2026-07-01 (initial import) | `docs/EVENT-LEXICON.md` declares `conf 0.7` / `sqi null` on the `stage_<stage>` row; `briefs/ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` specifies the same byte shape | `declared` |
| `ecgdex-dsp.js#movement_onset` | `0.6` | `5d6f83143` 2026-07-30 (#651) | the commit explains the arousal fiducial and never the number | `no stated basis` |
| `ecgdex-dsp.js#la` label cut | `snrDb >= 3` | `176ea8c3e` 2026-07-01 (initial import) | none | `no stated basis` |
| `glucodex-dsp.js#nocturnal_hypo` ceiling | `0.97` | `176ea8c3e` 2026-07-01 (initial import) | `briefs/NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md` states the clip-floor rule and that a genuine hypo keeps 0.9; `briefs/GlucoDex-BUILD-BRIEF.md` states conf tracks local data quality; `briefs/DEEP-AUDIT-2026-07-11-BRIEF.md` examined 37 events at 0.97 | `examined` |
| `hrvdex-dsp.js#hrv_low` clamp | `0.4` to `0.9` | `176ea8c3e` 2026-07-01 (initial import) | `briefs/MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md` found the floor load-bearing, because rMSSD 19 drives the ramp to 0.05 | `examined` |
| `hrvdex-dsp.js#stress_high` clamp | `0.4` to `0.9` | `176ea8c3e` 2026-07-01 (initial import) | the same brief found the floor inert: the trigger sits at stress 70 and the ramp reads exactly 0.4 there | `examined` |
| `integrator-dsp.js#glucose_autonomic_correlation` | `0.6` | `176ea8c3e` 2026-07-01 (initial import) | `audits/INTEGRATOR-FUSION-AUDIT.md` names the fusion and the sibling confidences, never this number | `no stated basis` |
| `pulsedex-dsp.js#hrv_drop` clamp | `0.4` to `0.92` | `176ea8c3e` 2026-07-01 (initial import) | none | `no stated basis` |
| `pulsedex-dsp.js#stress_peak` clamp over a window | `0.4` to `0.92` | `176ea8c3e` 2026-07-01 (initial import) | `briefs/DEEP-AUDIT-2026-07-11-BRIEF.md` examined 36 events at 0.92 | `examined` |
| `pulsedex-dsp.js#stress_peak` clamp over a record | `0.4` to `0.92` | `176ea8c3e` 2026-07-01 (initial import) | the same audit covers both emitters | `examined` |
| `pulsedex-dsp.js#hrv_drop` | `0.55` | `176ea8c3e` 2026-07-01 (initial import) | none | `no stated basis` |

Totals over the eleven: `declared` 1 · `examined` 5 · `no stated basis` 5.

## What the archaeology settles, and what it leaves open

Ten of the eleven sites date to `176ea8c3e`, the repo's first commit. One commit touches the PulseDex
block later — `0cef8c9ea` (2026-07-12) — and it explains the time-conservation mechanism, never the
constant. So the history holds no basis for ten numbers, and the eleventh commit message describes a
fiducial.

Five sites carry an `examined` citation. An examination is not a derivation: the brief or the audit
counted events at the value, or proved a clamp inert, and neither states why the value reads as it does.
No citation here claims more than its source says.

**The open question belongs to the owner:** what each confidence SHOULD read. That is a tuning study
against the corpus, and it needs a stated criterion per impulse. This record exists so the study starts
from measured ground rather than from a guess about the past.

## Keeping the record true

- The gate `tools/bus-conf-provenance.mjs` refuses a NEW tuned site without provenance. A new site
  earns a row here.
- A change to one of the eleven values owes a new row, never an edit of its old one.
- `node tools/bus-conf-provenance.mjs --json` regenerates the census. Hold any count here against it.
- **No gate holds these eleven values against the code yet.** The values live in two places now, so a
  record-conformance check is the next unit. It needs its own criterion and its own verdict object,
  because this gate judges one thing: what a branch adds.
