<!--
  README.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

<div align="center">

# Tepna — the Dex Suite

**A fleet of local-only, single-signal physiological analyzers.**
Read one raw biosignal from a consumer device → derive evidence-graded metrics → fuse across signals. Your data never leaves the browser.

[![Live at tepna.net](https://img.shields.io/badge/live-tepna.net-2a6fdb)](https://tepna.net)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-2a6fdb)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-100%25-1f8a5b)](WHY-THIS-EXISTS.md)
![Data stays local](https://img.shields.io/badge/data-stays_local-1f8a5b)
[![Every metric graded](https://img.shields.io/badge/every_metric-evidence_graded-8a5cf6)](#the-evidence-ladder-every-metric-is-graded)
![Nodes](https://img.shields.io/badge/nodes-7_live-555)

**[tepna.net](https://tepna.net)**  ·  [github.com/Plantucha/Tepna](https://github.com/Plantucha/Tepna)

</div>

Each analyzer reads **one** raw biosignal, derives metrics from it, and reports inward over a shared
event bus (**Ganglior**) so a fusion layer (the **Integrator**) can read across them. 100%
client-side — no network, no upload, no accounts.

## Get it running

```bash
git clone https://github.com/Plantucha/Tepna.git
```

Then open **`index.html`** in any modern browser and click your device. No build step, no server, no
install — every node app is a single self-contained HTML file that runs straight from disk.

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

| App | Signal | Device | Reads |
|---|---|---|---|
| **OxyDex** | SpO₂ / oximetry | O2Ring / Wellue / ViATOM | Raw 1 Hz overnight SpO₂·HR·motion |
| **PpgDex** | Wrist PPG | Polar Verity Sense | Raw optical pulse → PPI → HRV + pulse-wave morphology |
| **PulseDex** | HRV from raw RR | Polar Verity Sense | RR-interval streams |
| **ECGDex** | Raw ECG | Polar H10 | ECG (~130 Hz, Polar Sensor Logger) |
| **HRVDex** | HRV summaries | — | Vendor HRV exports + ECGDex exports (additive, multi-day) |
| **GlucoDex** | CGM | — | Continuous glucose traces |
| **CPAPDex** | CPAP therapy | ResMed · EDF | EDF therapy data — pressure · leak · respiratory events |
| **EEGDex** | EEG *(planned)* | Muse | Raw EEG |

Each node emits a `ganglior.node-export` JSON that the **Integrator** fuses across signals. Two
ingest front-doors feed it: the **Data Unifier** takes individual files you drop and routes each to
the right node, and **OverDex** takes a whole *folder* of mixed exports — it walks the tree, runs the
right node on each file, and hands every result to the Integrator automatically.

**HRVDex is the suite's HRV ledger.** Its imports are *additive*: every Welltory CSV or ECGDex export (CSV **or** `ganglior.node-export` JSON, including the multi-recording array) appends to one accumulating multi-day table — drop many files or nights at once, exact-duplicate measurements are skipped, and the table is persisted in the browser between visits (clear it with **Clear saved history**). ECGDex's **⬇ HRVDex** export writes a Welltory-style CSV with *all* loaded nights in one file, so a whole H10 history lands in HRVDex in a single drop.

---

## Repo map — where things live

Most people never need this: open **`index.html`** and click your device. For anyone reading the
source, here's the lay of the land.

| You want… | Look at |
|---|---|
| **A map of every doc** | [`DOCS-INDEX.md`](DOCS-INDEX.md) — the single entry path over all ~60 briefs, audits, and READMEs, grouped by topic. Start here before opening any individual brief. |
| **The app for your device** | the bundled `OxyDex.html`, `PpgDex.html`, `PulseDex.html`, `ECGDex.html`, `HRVDex.html`, `GlucoDex.html`, `CPAPDex.html` — open them directly. `Integrator.html` fuses them all; `Data Unifier.html` routes any file you drop to the right node, and `OverDex.html` runs a whole folder at once. |
| **The front door** | `index.html` (the landing/device picker) — the page normal people start from. |
| **How an app is built** | its source modules — `<node>-dsp.js` (signal math), `-render.js`, `-app.js`, `-registry.js` — plus `<App>.src.html`. Edit these; **never** the bundled `*.html`, then re-bundle. |
| **Shared engine** | `metric-registry.js` (evidence badges), `ganglior-provenance.js`, `ans-design.css`. |
| **Research tools** | `*-analysis.html` — the live tool behind each paper — plus `cohort-*.html`, `synth-gen.html`. Gates: `Dex-Test-Suite.html`, `verify-provenance.html`. |
| **The papers** | `papers/` — working preprints, each regenerated from its tool. |
| **Architecture docs** | `wiring/` — the "How It's Wired" reference set; start at `wiring/How It's Wired - the Dex Suite.html`. |
| **Design system** | `templates/` — visual-language spec, theme + evidence-badge previews. |
| **House rules** | `CLAUDE.md` (constitution) · `CONTRIBUTING.md` (on-ramp) · `ARCHITECTURE-PRINCIPLES.md` · `LEXICON.md`. |

---

## On the "75+ metrics" number

Yes, the suite derives well over 75 metrics across all nodes. That number describes **surface
area, not confidence.** The validated set above is the part we'd stake a decision on; the long tail
is there for exploration and is graded honestly so you can tell the difference at a glance. We lead
with the ladder, not the count, on purpose.

---

## Project voice (narrative, not spec)

For the *why* behind Tepna — the philosophy, the constraints, and the jokes — see
[`WHY-THIS-EXISTS.md`](WHY-THIS-EXISTS.md) (styled mirror: `Why This Exists.html`). It is
**narrative, not spec**: it defines no formats, APIs, or behavior, and nothing in it should be read
as an instruction to implement. Authoritative rules live in `CLAUDE.md`, this README, and the
`*-BRIEF.md` documents.

## Licensing

Apache-2.0. Author: **Michal Planicka**. Product brand: **Tepna**. See `LICENSE`, `NOTICE`,
`CITATION.cff`, and `THIRD-PARTY.md`. User-facing surfaces carry the health intended-use
disclaimer — Tepna is **not a medical device** and does not diagnose, treat, or monitor any
condition.
