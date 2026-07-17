<!--
  README.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

<div align="center">

# Tepna — the Dex Suite

### Read one raw biosignal → grade every number → fuse across signals.
**Your data never leaves the browser — and CI proves it on every commit.**

A fleet of local-only, single-signal physiological analyzers. No upload. No accounts. No network.

**Suite version:** 1.13.0

[![Live at tepna.net](https://img.shields.io/badge/live-tepna.net-2a6fdb?style=for-the-badge)](https://tepna.net)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-2a6fdb?style=for-the-badge)](LICENSE)

[![No network · CI-enforced](https://img.shields.io/badge/no_network-CI--enforced-1f8a5b)](no-network.html)
[![Local-first](https://img.shields.io/badge/local--first-100%25-1f8a5b)](docs/WHY-THIS-EXISTS.md)
[![Every metric graded](https://img.shields.io/badge/every_metric-evidence_graded-8a5cf6)](#the-evidence-ladder-every-metric-is-graded)
[![Reproducible](https://img.shields.io/badge/every_paper-regenerates_from_its_tool-8a5cf6)](papers/papers.html)
![Nodes](https://img.shields.io/badge/nodes-7_live_%C2%B7_1_planned-555)

**[tepna.net](https://tepna.net)**  ·  [github.com/Plantucha/Tepna](https://github.com/Plantucha/Tepna)

</div>

> **One signal in, honest numbers out.** Each analyzer reads **one** raw biosignal from a consumer
> device, derives metrics from it, and reports inward over a shared event bus (**Ganglior**) so a
> fusion layer (the **Integrator**) can read across them. Every number carries an **evidence grade**,
> so you always know which kind of number you're looking at. And "100% client-side" isn't a promise
> — it's a **test**: a headless privacy gate boots every shipped surface and fails the build if
> anything so much as *reaches* for the network.

## Get it running

```bash
git clone https://github.com/Plantucha/Tepna.git
```

Then open **`index.html`** in any modern browser and click your device. No build step, no server, no
install — every node app is a single self-contained HTML file that runs straight from disk.

> 💡 **Why that's remarkable:** an entire overnight sleep-apnea screen, an ECG QT analysis, or a
> CGM report runs from a file on your disk — the raw biosignal is parsed, the math is done, and the
> figures are drawn, all without a single byte leaving the tab.

---

## 🔒 The privacy claim is a *test*, not a promise

Most health apps *say* your data is private. Tepna **proves it, mechanically, on every commit.**

[`no-network.html`](no-network.html) is a self-verifying gate — the privacy analogue of a build
signature. It statically scans every shipped surface (the 8 self-contained bundles + the 2
orchestrators + their loose modules), **boots each one in a trapped iframe** where any cross-origin
request throws, and asserts **zero network egress**. A planted-canary negative control ships inside
the gate, so a vacuous "all clear" can never pass. It runs headless in CI on **every push**.

| CI gate | What it guarantees |
|---|---|
| **no-network** | No shipped surface reaches the network — privacy is enforced, not asserted |
| **tests** | ~2,250 assertions over the real DSP modules, run as 4 parallel shards that provably *partition* the suite — so the union of the shards is the whole gate, and no group can quietly go unrun |
| **types** | JSDoc type-checking across the signal contracts |
| **biome** | Format + house-invariant lint (frozen names, Clock Contract, SPDX, evidence vocabulary) |

Render-coverage (booting each real app bundle in an iframe and asserting computed values reach the
DOM) is a heavier browser gate — it lives in `Dex-Test-Suite.html?full` and the manual
`browser-gates` workflow, not on the per-push path.

Beyond CI, [`verify-provenance.html`](verify-provenance.html) content-addresses every bundle
(GATE A: code identity) and every fixture (GATE B: known-answer reproducibility) — so a shipped app
is provably the code it claims to be.

**Browser-enforced, too.** Every bundle ships a strict Content-Security-Policy. `connect-src 'none'`
blocks egress at the browser layer, and `script-src` lists a per-inline-script `sha256` hash with
**no `'unsafe-inline'`** — so even a `<script>` injected into the DOM (a future untrusted→HTML
regression) cannot execute. CSP is an *injection* backstop, not just an egress control; a headless
negative-control test asserts an injected script stays inert, and the `security · csp-strict` gate
holds the invariant (no inline handler survives, every `script-src` is hash-based).

---

## Start here: what Tepna actually measures well

Tepna derives a large surface of metrics, but they are **not all equally trustworthy** — and we
say so on every number. The honest front door is this short list of **externally validated**
metrics, each anchored to a published standard. If you read nothing else, read these.

| Metric | Signal · App | What it is | Anchor |
|---|---|---|---|
| **ODI-4** | SpO₂ · OxyDex | 4% oxygen-desaturation index — apnea-screening workhorse | AASM |
| **T90** | SpO₂ · OxyDex | % of night below 90% SpO₂ — hypoxia severity | Sleep-apnea literature |
| **Hypoxic burden** | SpO₂ · OxyDex | Area·depth·duration of desaturations | Azarbarzin 2019 |
| **rMSSD** | RR/ECG · PulseDex · ECGDex · HRVDex | Short-term parasympathetic HRV | Task Force 1996 |
| **SDNN** | RR/ECG · PulseDex · ECGDex | Overall HRV over the window | Task Force 1996 |
| **QTc** | ECG · ECGDex | Rate-corrected QT (Bazett / Fridericia) | Repolarisation standard |
| **Time in Range** | CGM · GlucoDex | % time 70–180 mg/dL — primary CGM metric | 2019 consensus |
| **GMI** | CGM · GlucoDex | Glucose Management Indicator from mean glucose | Bergenstal 2018 |

Everything past this list exists, but lives lower on the evidence ladder. Treat it accordingly.

---

## The evidence ladder (every metric is graded)

Each metric carries one of five evidence tiers. The grade is shown as a **disc badge** in every
app — **disc shape encodes trust, never hue** (so the ladder reads the same to colour-blind users
and in greyscale print). The grade is a per-node fact, defined once in each node's registry.

| Rank | Tier | Means | Example |
|---|---|---|---|
| 0 | **measured** | Read directly off the device, not derived | Mean SpO₂, Mean HR |
| 1 | **validated** | Established + externally validated against a published standard | ODI-4, rMSSD, TIR |
| 2 | **emerging** | Published, but device-dependent or less standardized | Nonlinear HRV, coupling |
| 3 | **experimental** | Plausible, internally consistent, not externally confirmed | Composite indices |
| 4 | **heuristic** | Rule-of-thumb estimate — directional signal only | Sleep-derived BP estimate |

A metric's tier is sourced from its node's registry (`*-registry.js`) and mirrored into the
reference guides; the badge visuals come from one canonical stylesheet. **A higher rank is not a
"better" metric — it's a louder one.** A heuristic that points the right direction can still be
useful; the ladder just makes sure you always know which kind of number you're looking at.

---

## The nodes

| App | Signal | Device | Reads | Reference |
|---|---|---|---|---|
| **OxyDex** | SpO₂ / oximetry | O2Ring / Wellue / ViATOM | Raw 1 Hz overnight SpO₂·HR·motion | [Technical guide](OxyDex%20Reference.html) |
| **PpgDex** | Wrist PPG | Polar Verity Sense | Raw optical pulse → PPI → HRV + pulse-wave morphology | [Technical guide](PpgDex%20Reference.html) |
| **PulseDex** | HRV from raw RR | Polar H10 (`*_RR.txt`; Coospo/Wahoo too) | Beat-to-beat RR-interval streams | [Technical guide](PulseDex%20Reference.html) |
| **ECGDex** | Raw ECG | Polar H10 | ECG (~130 Hz, Polar Sensor Logger) | [Technical guide](ECGDex%20Reference.html) |
| **HRVDex** | HRV summaries | — | Vendor HRV exports + ECGDex exports (additive, multi-day) | [Technical guide](HRVDex%20Reference.html) |
| **GlucoDex** | CGM | — | Continuous glucose traces | [Technical guide](GlucoDex%20Reference.html) |
| **CPAPDex** | CPAP therapy | ResMed · EDF | EDF therapy data — pressure · leak · respiratory events | [Technical guide](CPAPDex%20Reference.html) |
| **EEGDex** | EEG *(planned)* | Muse | Raw EEG | *(planned)* |

Each node emits a `ganglior.node-export` JSON that the **Integrator** fuses across signals. Two
ingest front-doors feed it: the **Data Unifier** takes individual files you drop and routes each to
the right node, and **OverDex** takes a whole *folder* of mixed exports — it walks the tree, runs the
right node on each file, and hands every result to the Integrator automatically.

**HRVDex is the suite's HRV ledger.** Its imports are *additive*: every Welltory CSV or ECGDex export (CSV **or** `ganglior.node-export` JSON, including the multi-recording array) appends to one accumulating multi-day table — drop many files or nights at once, exact-duplicate measurements are skipped, and the table is persisted in the browser between visits (clear it with **Clear saved history**). ECGDex's **⬇ HRVDex** export writes a Welltory-style CSV with *all* loaded nights in one file, so a whole H10 history lands in HRVDex in a single drop.

---

## 🔬 Scientific Foundation

Every non-trivial number traces to a published method, and every working preprint is **regenerated
from the live tool behind it** — no hand-drawn figures, no cherry-picked runs. Highlights from
**[`papers/`](papers/papers.html)**:

- **[One phone is not one clock](papers/wearable-clock-drift.html)** — a single-subject methods study
  measuring ~48 ppm inter-device timing drift across 11 nights (145k beats), showing why beat-level
  fusion of two consumer wearables needs a single acquisition clock.
- **[Dead ends](papers/dead-ends.html)** — a synthesis of the walls the suite hit and why: fixed,
  flagged, or fundamental. Negative results, reported honestly.
- **Sensor-trio power &amp; σ analyses, rMSSD equivalence, ODI-4 calibration, timestamp pathology** —
  each with its live regenerating tool.

The methods overview is **[`Science.html`](Science.html)** and the system design is
**[`Architecture.html`](Architecture.html)**.

---

## Repo map — where things live

Most people never need this: open **`index.html`** and click your device. For anyone reading the
source, here's the lay of the land.

| You want… | Look at |
|---|---|
| **A map of every doc** | [`DOCS-INDEX.md`](DOCS-INDEX.md) — the single entry path over all ~180 briefs, audits, and READMEs, grouped by topic. Start here before opening any individual brief. |
| **The app for your device** | the bundled `OxyDex.html`, `PpgDex.html`, `PulseDex.html`, `ECGDex.html`, `HRVDex.html`, `GlucoDex.html`, `CPAPDex.html` — open them directly. `Integrator.html` fuses them all; `Data Unifier.html` routes any file you drop to the right node, and `OverDex.html` runs a whole folder at once. |
| **The front door** | `index.html` (the landing/device picker) — the page normal people start from. |
| **How an app is built** | its source modules — `<node>-dsp.js` (signal math), `-render.js`, `-app.js`, `-registry.js` — plus `<App>.src.html`. Edit these; **never** the bundled `*.html`, then re-bundle. |
| **Shared engine** | `metric-registry.js` (evidence badges), `ganglior-provenance.js`, `ans-design.css`. |
| **Research tools** | `*-analysis.html` — the live tool behind each paper — plus `cohort-*.html`, `synth-gen.html`. Gates: `Dex-Test-Suite.html`, `verify-provenance.html`. |
| **The papers** | `papers/` — working preprints, each regenerated from its tool. |
| **Architecture docs** | `wiring/` — the "How It's Wired" reference set; start at `wiring/How It's Wired - the Dex Suite.html`. |
| **Design system** | `templates/` — visual-language spec, theme + evidence-badge previews. |
| **House rules** | `CLAUDE.md` (constitution) · `CONTRIBUTING.md` (on-ramp) · `ARCHITECTURE-PRINCIPLES.md` · [`docs/LEXICON.md`](docs/LEXICON.md). |

---

## On the "75+ metrics" number

Yes, the suite derives well over 75 metrics across all nodes. That number describes **surface
area, not confidence.** The validated set above is the part we'd stake a decision on; the long tail
is there for exploration and is graded honestly so you can tell the difference at a glance. We lead
with the ladder, not the count, on purpose.

---

## Project voice (narrative, not spec)

For the *why* behind Tepna — the philosophy, the constraints, and the jokes — see
[`docs/WHY-THIS-EXISTS.md`](docs/WHY-THIS-EXISTS.md) (styled mirror: `Why This Exists.html`). It is
**narrative, not spec**: it defines no formats, APIs, or behavior, and nothing in it should be read
as an instruction to implement. Authoritative rules live in `CLAUDE.md`, this README, and the
`*-BRIEF.md` documents.

## Licensing

Apache-2.0. Author: **Michal Planicka**. Product brand: **Tepna**. See `LICENSE`, `NOTICE`,
`CITATION.cff`, and `THIRD-PARTY.md`. User-facing surfaces carry the health intended-use
disclaimer — Tepna is **not a medical device** and does not diagnose, treat, or monitor any
condition.
