<!--
  README.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

<div align="center">

# Tepna — the Dex Suite

### Read one raw biosignal → grade every number → fuse across signals.
**Your data never leaves the browser — and CI proves it on every commit.**

[![Live at tepna.net](https://img.shields.io/badge/live-tepna.net-2a6fdb?style=for-the-badge)](https://tepna.net)
[![Suite v2.16.0](https://img.shields.io/badge/suite-v2.16.0-2a6fdb?style=for-the-badge)](CHANGELOG.md)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-2a6fdb?style=for-the-badge)](LICENSE)
[![DOI](https://zenodo.org/badge/1286425809.svg)](https://doi.org/10.5281/zenodo.22068939)

[![No network · CI-enforced](https://img.shields.io/badge/no_network-CI--enforced-1f8a5b)](no-network.html)
[![Every metric graded](https://img.shields.io/badge/every_metric-evidence_graded-8a5cf6)](#every-number-is-graded)
[![Reproducible](https://img.shields.io/badge/every_paper-regenerates_from_its_tool-8a5cf6)](papers/papers.html)
![Nodes](https://img.shields.io/badge/nodes-8_live_%C2%B7_1_planned-555)
![Releases](https://img.shields.io/badge/releases-42_shipped-555)

**[tepna.net](https://tepna.net)**  ·  [github.com/Plantucha/Tepna](https://github.com/Plantucha/Tepna)

<!-- readme-synced: 779f348d 2026-10-04 -->
<sub>README last synced to commit `779f348d` (2026-10-04). Next refresh: `git log --oneline 779f348d..origin/main`
lists what this page has not seen yet — fold that in, then move this stamp.</sub>

</div>

Tepna is a set of single-signal analyzers for the physiology sensors people actually own — a ring
oximeter, a chest strap, an armband, a CGM, a CPAP machine — plus one capture box that records them
all night on one clock. Each analyzer reads **one** raw signal, derives its metrics, and reports over a
shared bus (**Ganglior**) so a fusion layer (the **Integrator**) can read across signals. Every number
carries an **evidence grade**. Nothing is uploaded, ever: a headless gate boots every shipped surface
and fails the build if anything reaches for the network.

What it finds that **holds** ships as a graded metric. What **fails** is published too — [*Dead
Ends*](papers/dead-ends.html) is the citable map of the walls. The long-form *why* is
[`docs/WHY-THIS-EXISTS.md`](docs/WHY-THIS-EXISTS.md).

---

## Get it running

```bash
git clone https://github.com/Plantucha/Tepna.git
```

Open **`index.html`** in a browser and click your device. No build, no server, no install: every app
is one self-contained HTML file that runs from disk. One sensor is a complete starting point — an
O2Ring alone feeds OxyDex, an H10 alone feeds ECGDex and PulseDex — and an Android phone running the
free Polar Sensor Logger or the Wellue app produces files the apps read directly. The capture box is
the always-on, one-clock upgrade, not the entry fee.

---

## The apps

| App | Signal | Device | What it reports | Guide |
|---|---|---|---|---|
| **OxyDex** | SpO₂ | Wellue O2Ring | ODI-4 · T90 · hypoxic burden | [reference](OxyDex%20Reference.html) |
| **ECGDex** | raw ECG | Polar H10 | QTc · rMSSD · beat-level RR | [reference](ECGDex%20Reference.html) |
| **PulseDex** | RR intervals | Polar H10 · Coospo · Wahoo | rMSSD · SDNN · nonlinear HRV | [reference](PulseDex%20Reference.html) |
| **PpgDex** | raw PPG | Polar Verity Sense · O2Ring | PPI → HRV · pulse-wave morphology | [reference](PpgDex%20Reference.html) |
| **HRVDex** | HRV summaries | exports | an additive multi-day HRV ledger | [reference](HRVDex%20Reference.html) |
| **GlucoDex** | CGM | exports | Time in Range · GMI | [reference](GlucoDex%20Reference.html) |
| **CPAPDex** | CPAP therapy | ResMed EDF | pressure · leak · respiratory events · breath rate | [reference](CPAPDex%20Reference.html) |
| **MotionDex** | IMU | Polar Verity Sense · H10 | body position · actigraphy · motion quality | *(no guide yet)* |
| **EEGDex** | EEG | Muse | *planned* | — |

Each app writes a `ganglior.node-export` JSON. The **Integrator** fuses them; the **Data Unifier**
routes single dropped files to the right app; **OverDex** does the same for a whole folder.

---

## Every number is graded

Each metric carries one of five evidence tiers, shown as a disc badge whose **shape** encodes trust
(so it reads the same in greyscale and to colour-blind users). A higher tier is not a better metric,
only a louder one.

| Tier | Means | Example |
|---|---|---|
| **measured** | read off the device | mean SpO₂, mean HR |
| **validated** | anchored to a published standard | ODI-4 · rMSSD · SDNN · QTc · Time in Range · GMI · hypoxic burden |
| **emerging** | published, device-dependent | nonlinear HRV, cardiopulmonary coupling |
| **experimental** | internally consistent, not externally confirmed | composite indices |
| **heuristic** | directional only | sleep-derived BP estimate |

The eight registries define **520 graded metrics**; just under half are measured or validated and
nearly two-fifths sit at experimental or heuristic. The distribution is the honest version of the
count, which is why the ladder leads. If you read nothing else, read the validated row.

---

## The privacy claim is a test

[`no-network.html`](no-network.html) statically scans every shipped surface, boots each one in a
trapped iframe where any cross-origin request throws, and asserts zero egress; a planted canary inside
the gate means a vacuous "all clear" cannot pass. Every bundle also ships a strict Content-Security-
Policy with `connect-src 'none'` and hash-only `script-src`. [`verify-provenance.html`](verify-provenance.html)
content-addresses every bundle and every known-answer fixture, so a shipped app is provably the code
it claims to be.

**Nine checks are required on every pull request:** `tests` (**11,095 assertions** across **695 groups**,
six partitioned shards) · `no-network` · `types` · `biome` · `browser-gates` (every bundle booted
headless, computed values asserted in the DOM) · `stale-file` (a brief cannot be overwritten by an
edit that never read the upstream version) · `capture-host` on py3.12 and py3.13 —
**9,300+ Python tests** at a 100 % statement *and* branch floor — and a diff-scoped **mutation** gate
that breaks the lines a PR touched and refuses to merge what the suite would not notice. `CodeQL` runs beside them,
and a `static` job re-derives every ledger the tree claims so a stale artefact reds the PR.

---

## The Health Box

The apps read files; something has to write them. **`capture-host/`** is a Python service for a small
bedside PC that holds the live Bluetooth links — H10 ECG, Verity PPG and IMU, the O2Ring's SpO₂ and
raw PPG, the CPAP's live flow — and writes the vendors' own file layouts into per-night folders. It
is a producer outside the browser suite: no app ever talks to a device. It has its own gate,
`capture-host/check.sh`, because this code runs unattended against hardware that misbehaves while
nobody is awake.

Every morning the box judges the night it recorded. **Night QC** checks coverage and gaps, the
**loss audit** attributes every minute worn but not recorded to its cause and holds it to the owner's
bar (≤ 1 % of worn time), and **SOLID-NIGHT** composes one verdict per night across devices and
bands. Every judgement is one `tepna.verdict/1` object with a pre-stated criterion, written beside its
prose — and an absent measurement is `null` with a reason, never a zero.

Per-device capture instructions without the box live in [`how-to-collect/`](how-to-collect/health-box.md).

---

## Method, in four rules

- **Measurement before interpretation.** A number is not a measurement until the acquisition path
  that produced it has been checked. ECGDex's `estimatedAHI` was withdrawn in v2.0.0, not relabelled:
  it correlated with device-scored AHI at r = −0.151.
- **Time is a measurement.** Two devices reporting milliseconds need not share one. The Clock Contract
  puts every stream on a floating wall-clock axis, reconciles device crystals against the capture
  host with a running median that refuses rather than guesses, and names a drawn axis as drawn.
- **Agreement is not confirmation.** Two sensors agreeing is evidence only if they are independent;
  whether a recording holds a second clock at all is decided by the spread of residuals, not by a rate.
- **The gates are tested too.** `tools/mutate.mjs` and the Python mutation gate break the code on
  purpose and report what the suite fails to notice; surviving mutants are ledgered with the probe
  that excused them, never waved through.

**Since `2.16.0` (2026-09-27 → 2026-10-04, 101 commits, 82 changesets).** The capture lane learned to
judge a night on its own: the loss audit got its bar, SOLID-NIGHT its tripwire for unrecorded clock
shifts, the ring its honest completeness model and a declared clock stream, and the box judges a
night twenty minutes after its data goes quiet instead of the next evening. The mutation gate stopped
hiding survivors behind timeouts, declared the one module it cannot measure, and started reading
Codex as a second opinion under mechanical verification. Full history in the **[changelog](CHANGELOG.md)**.

---

## Suite at a glance

**Suite version:** 2.16.0 &nbsp;—&nbsp; **42** ledger-backed releases, each computed from a green tree, with **82 changesets** pending since (v2.16.0, 2026-09-27).

Every one of the **23 working preprints** in [`papers/`](papers/papers.html) regenerates from the live
tool behind it. The methods overview is [`Science.html`](Science.html); the system design is
[`Architecture.html`](Architecture.html).

---

## The hardware

Every sensor is bone-stock and spoken to over the vendor's own protocol; the CPAP link is read-only by
construction. Approximate US street prices, 2026:

| Hardware | Role | Price |
|---|---|---:|
| Lenovo ThinkCentre M900 Tiny (used) | the Health Box | ~$120 |
| Wellue O2Ring-S | overnight SpO₂ · pulse · raw PPG | ~$170 |
| Polar H10 | raw ECG · RR · IMU | ~$90 |
| Polar Verity Sense | raw PPG · IMU | ~$105 |
| nRF52840 dongles ×3 (open-source Zephyr HCI image) | the box's Bluetooth radios | ~$30 |
| ez Share WiFi SD card | pulls the CPAP's card | ~$25 |
| | **core capture kit** | **≈ $550** |

Optional: a GPS stratum-1 time server (the box holds microsecond offsets against it), a ResMed
AirSense 11 (therapy equipment that was already there), an Abbott Lingo CGM, a Muse S for the planned
EEG node. One attended lab night costs more than the whole kit and records one night; this records every
night, raw, in your own bed. The two are not substitutes: if you suspect a sleep disorder, see a
physician, and bring your exports.

---

## Repo map

| You want… | Look at |
|---|---|
| a map of every document | [`DOCS-INDEX.md`](DOCS-INDEX.md) — start here before opening any brief |
| the 60-second orientation for contributors | [`ORIENTATION.md`](ORIENTATION.md) |
| the house rules | [`CLAUDE.md`](CLAUDE.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`ARCHITECTURE-PRINCIPLES.md`](ARCHITECTURE-PRINCIPLES.md) |
| how an app is built | `<node>-dsp.js` · `-render.js` · `-app.js` · `-registry.js` + `<App>.src.html`; edit these, never the bundled `*.html` |
| the research tools and papers | `*-analysis.html` and [`papers/`](papers/papers.html) |
| every script, indexed | [`docs/TOOLS-INDEX.md`](docs/TOOLS-INDEX.md) |
| open verified defects | [`briefs/RESIDUE.md`](briefs/RESIDUE.md) |

## Acknowledgements

Tepna stands on others' documented work: [nglessner/o2ring-s-protocol](https://github.com/nglessner/o2ring-s-protocol)
(the O2Ring-S protocol reference), [m-kozlowski/airbreak-plus](https://github.com/m-kozlowski/airbreak-plus)
descending from [osresearch/airbreak](https://github.com/osresearch/airbreak) (the CPAP protocol),
[Polar Sensor Logger](https://play.google.com/store/apps/details?id=com.j_ware.polarsensorlogger) by j-ware,
and the open-source foundations the capture lane leans on: [bleak](https://github.com/hbldh/bleak),
[mutmut](https://github.com/boxed/mutmut), chrony. Built in the open with
[![Built with Claude Code](https://img.shields.io/badge/built_with-Claude_Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code).

## Licensing

Apache-2.0. Author: **Michal Planicka** ([ORCID 0009-0008-3501-3596](https://orcid.org/0009-0008-3501-3596)).
Brand: **Tepna**. See `LICENSE`, `NOTICE`, `CITATION.cff` and `THIRD-PARTY.md`. Tepna is **not a medical
device** and does not diagnose, treat or monitor any condition.
