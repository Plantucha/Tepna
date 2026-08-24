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

[![Live at tepna.net](https://img.shields.io/badge/live-tepna.net-2a6fdb?style=for-the-badge)](https://tepna.net)
[![Suite v2.7.0](https://img.shields.io/badge/suite-v2.7.0-2a6fdb?style=for-the-badge)](CHANGELOG.md)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-2a6fdb?style=for-the-badge)](LICENSE)
[![DOI](https://zenodo.org/badge/1286425809.svg)](https://doi.org/10.5281/zenodo.22068939)

[![No network · CI-enforced](https://img.shields.io/badge/no_network-CI--enforced-1f8a5b)](no-network.html)
[![Local-first](https://img.shields.io/badge/local--first-100%25-1f8a5b)](docs/WHY-THIS-EXISTS.md)
[![Tests green](https://img.shields.io/badge/tests-7.3k_assertions_green-1f8a5b)](#-the-privacy-claim-is-a-test-not-a-promise)
[![Every metric graded](https://img.shields.io/badge/every_metric-evidence_graded-8a5cf6)](#the-evidence-ladder-every-metric-is-graded)
[![Reproducible](https://img.shields.io/badge/every_paper-regenerates_from_its_tool-8a5cf6)](papers/papers.html)
![Nodes](https://img.shields.io/badge/nodes-8_live_%C2%B7_1_planned-555)
![Releases](https://img.shields.io/badge/releases-33_shipped-555)

**[tepna.net](https://tepna.net)**  ·  [github.com/Plantucha/Tepna](https://github.com/Plantucha/Tepna)

</div>

> **One signal in, honest numbers out.** Each analyzer reads **one** raw biosignal from a consumer
> device, derives metrics from it, and reports inward over a shared event bus (**Ganglior**) so a
> fusion layer (the **Integrator**) can read across them. Every number carries an **evidence grade**,
> so you always know which kind of number you're looking at. And "100% client-side" isn't a promise
> — it's a **test**: a headless privacy gate boots every shipped surface and fails the build if
> anything so much as *reaches* for the network.

---

## 🧭 Why this exists

The story goes that August Strindberg once blew pipe smoke into a bucket of water to see if he could
make gold. Maybe he wasn't the man who thought smoke could make gold — maybe he was the man who
**proved that it couldn't**. Someone has to walk the wrong path all the way to the end and come back
to tell everyone else: *"Not this way, friends."*

Tepna is that, for consumer-wearable physiology. It asks what a chest strap, a ring oximeter, an
armband, a CGM and a CPAP machine — the sensors people actually own — can **honestly** measure, and
publishes the answer in both directions:

- **What holds** ships as a metric with an [evidence grade](#the-evidence-ladder-every-metric-is-graded)
  on every number — nothing reaches your eye unlabelled.
- **What fails** is not deleted; it is published. [*Dead Ends*](papers/dead-ends.html) is a citable
  map of the walls — optical PRV that isn't ECG HRV, a cuffless-BP path withdrawn, a "coupling" that
  collapsed under one confounder — each with the evidence that felled it. Negative results are the
  product, not the waste.

Two constraints shape everything. **Privacy is a gate, not a promise** — your raw physiology never
leaves the browser, and CI fails the build if anything reaches for the network. And **maximum
information, minimum hardware** — the whole suite runs on a handful of consumer devices and one small
bedside box, because a measurement setup you can't live with is a measurement setup you'll stop
wearing.

The long-form colophon — Strindberg, the maze, the Wife Acceptance Factor as a load-bearing
engineering constraint — is [`docs/WHY-THIS-EXISTS.md`](docs/WHY-THIS-EXISTS.md) *(styled:
[Why This Exists.html](https://tepna.net/Why%20This%20Exists.html))*.

---

## 📊 Suite at a glance

**Suite version:** 2.7.0 &nbsp;—&nbsp; **33** ledger-backed releases, each computed from a green tree.

| | |
|---|---|
| 🧠 **Analyzers** | **8 live** single-signal nodes · **1 planned** (EEGDex) |
| 🔀 **Fusion** | **Integrator** (cross-signal) + 2 ingest front doors — **Data Unifier** · **OverDex** — all live |
| 🧪 **Tests** | **7,333 assertions** across **470 groups**, run as **6 partitioned CI shards** — green on every push |
| 🐍 **Capture lane** | the **Health Box** (`capture-host/`) — **3,200+ Python tests** at a **100 % statement *and* branch** coverage floor |
| 🛡️ **CI gates** | `no-network` · `tests` · `types` · `biome` · `CodeQL` · `capture-host` — the privacy claim is **enforced, not asserted** |
| 🎫 **Honesty** | every surfaced number carries an **evidence grade** — nothing ships unlabelled |
| 🔬 **Reproducible** | every preprint **regenerates from its live tool**; every bundle is **content-addressed** |

**Roadmap** &nbsp; `▰▰▰▰▰▰▰▰▱` &nbsp; **8 of 9** planned analyzers live — EEGDex (Muse) is next.

> **Momentum.** `v2.0.0` is the suite's only **MAJOR** release, and the break is a *retirement*:
> ECGDex's `apnea.estimatedAHI` and `apnea.riskCategory` were the CVHR index wearing AHI's units and
> clinical cut-points — measured at **r = −0.151** against device-scored AHI — so they were withdrawn
> rather than relabelled. It also closed a cross-device timing gap nobody had measured: the two
> wearables were never compared to *each other* and turn out to sit **~3.3 s apart on every
> phone-captured night**.
>
> The `2.1 → 2.5` line has been about **finding out which gates were bluffing**. `tools/mutate.mjs`
> breaks the code on purpose and reports which tests fail to notice — its first sweep found that
> **41 % of mutations to `clock.js`, the Clock Contract itself, went unnoticed**, and closing that is
> ongoing work with published numbers rather than a claim. Alongside it, the **host-disciplined time
> axis** (Clock Contract §7) reconciles the device crystal against the capture host's clock, and it
> refuses rather than guesses: an O2Ring axis that turned out to be **drawn** — synthesized from a
> sample index, not a clock — is now detected and declared as such instead of being silently trusted.
> Full history in the **[changelog](CHANGELOG.md)**.

### Node status

| Node | Signal | Device | Status | Flagship metric |
|---|---|---|:---:|---|
| **OxyDex** | SpO₂ / oximetry | O2Ring · Wellue · ViATOM | 🟢 **Live** | ODI-4 · T90 · hypoxic burden |
| **ECGDex** | Raw ECG | Polar H10 | 🟢 **Live** | QTc · rMSSD |
| **PulseDex** | HRV from raw RR | Polar H10 · Coospo · Wahoo | 🟢 **Live** | rMSSD · SDNN |
| **PpgDex** | Wrist PPG | Polar Verity Sense | 🟢 **Live** | PPI → HRV + pulse-wave morphology |
| **HRVDex** | HRV summaries | *(exports)* | 🟢 **Live** | additive multi-day rMSSD / SDNN ledger |
| **GlucoDex** | CGM | *(exports)* | 🟢 **Live** | Time in Range · GMI |
| **CPAPDex** | CPAP therapy | ResMed · EDF | 🟢 **Live** | pressure · leak · respiratory events |
| **MotionDex** | Inertial motion (IMU) | Polar Verity Sense · H10 (`*_ACC/_GYRO/_MAGN`) | 🟢 **Live** | body position · actigraphy · motion SQI |
| **EEGDex** | EEG | Muse | ⚪ **Planned** | — |

---

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
signature. It statically scans every shipped surface (the 9 provenance-gated bundles + the 2
orchestrators + their loose modules), **boots each one in a trapped iframe** where any cross-origin
request throws, and asserts **zero network egress**. A planted-canary negative control ships inside
the gate, so a vacuous "all clear" can never pass. It runs headless in CI on **every push**.

| CI gate | What it guarantees |
|---|---|
| **no-network** | No shipped surface reaches the network — privacy is enforced, not asserted |
| **tests** | 7,333 assertions over the real DSP modules, run as 6 parallel shards that provably *partition* the suite — so the union of the shards is the whole gate, and no group can quietly go unrun |
| **types** | JSDoc type-checking (`tsc --checkJs`) across the signal contracts |
| **biome** | Format + house-invariant lint (frozen names, Clock Contract, SPDX, evidence vocabulary) |
| **CodeQL** | Static security analysis on every push |
| **capture-host** | The Python capture lane on its own runners — `ruff` · `shellcheck` (strictest level, every `.sh`) · `pytest` at a **100 % statement and branch** coverage floor |

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
| **MotionDex** | Inertial motion (IMU) | Polar Verity Sense · H10 | Accelerometer / gyro / magnetometer streams → body position, actigraphy, respiratory effort, motion SQI | *(no reference guide yet)* |
| **EEGDex** | EEG *(planned)* | Muse | Raw EEG | *(planned)* |

Each node emits a `ganglior.node-export` JSON that the **Integrator** fuses across signals. Two
ingest front-doors feed it: the **Data Unifier** takes individual files you drop and routes each to
the right node, and **OverDex** takes a whole *folder* of mixed exports — it walks the tree, runs the
right node on each file, and hands every result to the Integrator automatically.

**HRVDex is the suite's HRV ledger.** Its imports are *additive*: every Welltory CSV or ECGDex export (CSV **or** `ganglior.node-export` JSON, including the multi-recording array) appends to one accumulating multi-day table — drop many files or nights at once, exact-duplicate measurements are skipped, and the table is persisted in the browser between visits (clear it with **Clear saved history**). ECGDex's **⬇ HRVDex** export writes a Welltory-style CSV with *all* loaded nights in one file, so a whole H10 history lands in HRVDex in a single drop.

> **MotionDex is live but not yet fully surfaced.** It has its own bundle, its own DSP/registry
> modules and a provenance ledger fragment, and the Integrator consumes its output to motion-gate
> HRV — but it has **no reference guide yet** and no tile on the landing picker. Both are open work.

---

## 📻 The Health Box — where the raw signals come from

The suite reads files. Something has to *write* them, and for the nightly multi-device recordings
that is **`capture-host/`** — an out-of-suite Python service for a bedside mini-PC (a used Lenovo ThinkCentre M900 Tiny) that holds
the live BLE links (Polar H10 ECG, Verity PPG/ACC) and writes **existing vendor layouts** into
per-night directories the Dex apps already know how to read. It is a *producer*, deliberately
outside the browser suite: no Dex app ever talks to a device.

It is also a **separate lane with a separate gate.** `npm run check` does not cover it —
`capture-host/check.sh` does, and CI runs the same three jobs: `ruff`, `shellcheck` at its strictest
level over every shell script, and `pytest` with a **100 % statement *and* branch** coverage floor
across **3,200+ tests**. That floor is the point: this code runs unattended overnight against
hardware that misbehaves, so the failure modes it must survive are the ones nobody is awake to see.

Per-device capture instructions for everyone else — no Pi required — live in
[`how-to-collect/`](how-to-collect/health-box.md).

---

## Measurement before interpretation

A calculated number is not automatically a valid measurement. The chain runs:

```text
physical signal → acquisition → timestamping → conditioning → event detection
              → metric → cross-signal fusion → physiological interpretation
```

A failure at any earlier stage invalidates everything downstream, and a sophisticated algorithm cannot
recover information the acquisition path never preserved. That matters most with consumer sensors,
where an exported value can hide resampling, proprietary filtering, buffering, transport latency, clock
drift, reconstructed samples, or an undocumented event detector.

This is not hypothetical here. **ECGDex's `apnea.estimatedAHI` was withdrawn in v2.0.0**, not
relabelled: it was a CVHR index wearing AHI's units and clinical cut-points, and it correlated with
device-scored AHI at **r = −0.151**. The algorithm was fine. The construct was not.

---

## Time is a measurement

A timestamp is an observation of time, not automatically the truth — and cross-device work makes that
the whole problem. Two devices can each report milliseconds and still not share a millisecond.

Measured on this corpus:

| | |
|---|---|
| H10 ↔ Verity offset, **phone**-captured nights | **~3.3 s** |
| the same pair, **box**-captured nights | **~0.2 s** |
| the capture host's own clock | 0.008 ppm |
| an O2Ring crystal, worst case | **−3035 ppm, decaying to −1622** — non-linear, so a single ppm figure is the wrong model, not merely an imprecise one |

Hence `DexClock.hostAxis`: a running median over host/device anchor pairs, which **refuses** rather than
guessing when it has fewer than three anchors or the divergence exceeds 5 %. A node may not hand-roll a
rate correction, and a refusal returns no correction at all — a caller must not be able to apply a
silent zero.

---

## Agreement is not confirmation

Two sensors agreeing is evidence of physiological truth only if they are independent. They may instead
share a clock, an artifact, a preprocessing step, or a selection rule.

The suite has a measured instance. Whether a recording contains a **second clock at all** is decided by
the *spread* of host-vs-device residuals, not by the rate — and the corpus is bimodal with nothing in
between:

| capture | residual spread | meaning |
|---|---|---|
| box | 101.89 ms – 5124 ms | two genuinely independent clocks |
| phone | **0.13 – 1.00 ms** | one stamp quantum — the "host" column is the device stamp, rounded |

A phone-captured night therefore has **no second clock**, and a near-zero drift there is the *absence*
of a measurement wearing the shape of one. It also explains the ~3.3 s vs ~0.2 s split in the previous
section: only the box actually puts both devices on one timebase, so only there is the offset a
measurement rather than an artifact of shared derivation. `hostAxis` publishes `independent` so a
consumer cannot mistake the two.

---

## Adversarial testing

The suite is built to attack its own attractive results, and a useful failure is kept as a regression
test rather than deleted.

- The privacy gate ships a **planted-canary negative control**, so a vacuous "all clear" cannot pass.
- A packet-arrival check had two arms; the `smeared` arm was **retired for firing on every stream** on
  its first real night. The premise was wrong, not the threshold. Its surviving arm was only wired in
  after a corpus check across **355 sessions returned zero false positives**.
- Fixtures prefer an adversarial *committed* twin over a real recording, because CI can re-run the twin
  from committed bytes and cannot re-run a gitignored night.

The questions it asks of itself: can correlated artifacts manufacture multimodal agreement? Can a
host-derived clock validate itself? Can quality filtering select only the observations that support the
desired relationship? Can a synthetic test share an assumption with the algorithm it is testing?

---

## 🔬 Scientific Foundation

Every non-trivial number traces to a published method, and each of the **21 working preprints** in
**[`papers/`](papers/papers.html)** is **regenerated from the live tool behind it** — no hand-drawn
figures, no cherry-picked runs. Highlights:

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
| **A map of every doc** | [`DOCS-INDEX.md`](DOCS-INDEX.md) — the single entry path over all ~400 briefs, audits, and READMEs, grouped by topic. Start here before opening any individual brief. |
| **The app for your device** | the bundled `OxyDex.html`, `PpgDex.html`, `PulseDex.html`, `ECGDex.html`, `HRVDex.html`, `GlucoDex.html`, `CPAPDex.html`, `MotionDex.html` — open them directly. `Integrator.html` fuses them all; `Data Unifier.html` routes any file you drop to the right node, and `OverDex.html` runs a whole folder at once. |
| **The front door** | `index.html` (the landing/device picker) — the page normal people start from. |
| **How an app is built** | its source modules — `<node>-dsp.js` (signal math), `-render.js`, `-app.js`, `-registry.js` — plus `<App>.src.html`. Edit these; **never** the bundled `*.html`, then re-bundle. |
| **Shared engine** | `metric-registry.js` (evidence badges), `ganglior-provenance.js`, `ans-design.css`. |
| **Research tools** | `*-analysis.html` — the live tool behind each paper — plus `cohort-*.html`, `synth-gen.html`. Gates: `Dex-Test-Suite.html`, `verify-provenance.html`. |
| **The papers** | `papers/` — 21 working preprints, each regenerated from its tool. |
| **The capture service** | `capture-host/` — the Health Box Python lane (its own gate: `capture-host/check.sh`). Device-by-device capture instructions: `how-to-collect/`. |
| **Testing the tests** | `tools/mutate.mjs` — breaks the code on purpose and reports which gates fail to notice. The honest measure of whether a green suite means anything. |
| **Architecture docs** | `wiring/` — the "How It's Wired" reference set; start at `wiring/How It's Wired - the Dex Suite.html`. |
| **Design system** | `templates/` — visual-language spec, theme + evidence-badge previews. |
| **House rules** | `CLAUDE.md` (constitution) · `CONTRIBUTING.md` (on-ramp) · `ARCHITECTURE-PRINCIPLES.md` · [`docs/LEXICON.md`](docs/LEXICON.md). |

---

## On the metric count

The eight node registries define **404 graded metrics**. That number describes **surface area, not
confidence** — which is exactly why the suite publishes the breakdown rather than the headline:

| Tier | Count | Share |
|---|---:|---:|
| **measured** — read off the device | 118 | 29 % |
| **validated** — anchored to a published standard | 84 | 21 % |
| **emerging** — published, device-dependent | 78 | 19 % |
| **experimental** — internally consistent, not externally confirmed | 96 | 24 % |
| **heuristic** — directional only | 28 | 7 % |

So **roughly half** the surface is `measured` or `validated`, and **just under a third** sits at
`experimental` or `heuristic`. A count of 404 would be a boast; the distribution is the honest
version of the same fact, and it is why the ladder leads and the count follows.

---

## 💰 The hardware — what this actually runs on

Max information, minimum hardware, priced honestly — and **everything is bone-stock**: no firmware
modifications, no rooting, no hardware mods. Every sensor, the CPAP included, runs exactly as it
shipped from the factory and is spoken to over the vendor's own protocol. Where therapy is involved
the code is **read-only by construction** — the CPAP link contains no write commands at all; Tepna
only reads what the machine records. Every signal in the suite comes off this kit
(approximate US street prices, August 2026; the box was bought **used**):

| Hardware | Role | Approx. price |
|---|---|---:|
| **Lenovo ThinkCentre M900 Tiny** (refurbished — any 6th-gen-i5 tiny works) | the Health Box — 24/7 bedside capture daemon · LAN server · clock disciplined µs-level against the GPS+PPS stratum-1 below | ~$80–130 |
| **Wellue O2Ring** (O2Ring-S) | overnight SpO₂ · pulse · raw PPG → OxyDex / PpgDex | ~$170 |
| **Polar H10** chest strap | raw ECG (~130 Hz) · RR · ACC → ECGDex / PulseDex / MotionDex | ~$90 |
| **Polar Verity Sense** armband | raw 4-channel PPG · IMU → PpgDex / MotionDex | ~$105 |
| **TP-Link UB500 Plus** | the box's current BLE radio — works, but drops links under load | **$13** |
| **Sena Parani UD100-G03** *(recommended radio)* | class-1 long-range BLE, exchangeable antenna — the adapter to buy | ~$40–52 |
| **nRF52840 dongle** + Zephyr firmware *(recommended alternative)* | observable, timing-honest BLE controller | ~$12 |
| **ez Share WiFi SD card** | pulls the CPAP's SD card over WiFi, no cable | ~$25 |
| **COOSPO H808S** chest strap | second RR source → PulseDex cross-checks | ~$35 |
| | **Core capture kit** | **≈ $550** |
| **CenterClick NTP250** GPS time server | GPS+PPS-disciplined LAN stratum-1 — holds the box at microsecond offsets (measured ~2.5 µs); the timing-integrity backbone *(optional; NTP pool works at ms-accuracy)* | ~$200–240 *(current models: NTP220/NTP270)* |
| **ResMed AirSense 11** | CPAP therapy (its data feeds CPAPDex) — therapy equipment, typically insurance-covered | ~$1,050 retail |
| **Abbott Lingo** | CGM → GlucoDex — consumable biosensor | $49 / 14-day sensor |
| **Muse S** headband | EEG → EEGDex (planned node) | ~$400 |

**You don't need all of it — and you don't need the box.** Every Dex is a single-signal analyzer:
**one device is a complete starting point** (an O2Ring alone feeds OxyDex; an H10 alone feeds
ECGDex and PulseDex). And instead of the capture box, **an Android phone you already own works**:
the free Polar Sensor Logger app records H10/Verity streams, the Wellue app exports the ring's
nights, and you drop the files into the Dexes in the browser — that was this project's original
setup, and most of its corpus was captured exactly that way. The box adds the always-on, hands-off,
one-clock version; it is the upgrade, not the entry fee.

So the entry cost is **one sensor plus a phone you already have** (~$90–170); the full multi-signal
lab — raw ECG, dual raw PPG, continuous SpO₂, HRV, IMU, plus the always-on capture box — is
**under $600 of hardware**, most of it consumer gear bought retail. The CPAP is therapy equipment
that was already there; Tepna just reads what it records. That is the
[max-info-min-hardware constraint](#-why-this-exists) with a receipt attached.

> **For calibration:** one attended night in a professional sleep lab bills **$1,000–$10,000**, and a
> mail-out home sleep test ($150–$500) records one night of far fewer channels. The kit above costs
> less than one lab night's facility fee and records **every** night, raw, in your own bed. The two
> are not substitutes: the lab answers *"do you have sleep apnea?"* with clinical authority — Tepna
> answers *"what does your physiology actually do, night after night?"* with data you own. If you
> suspect a sleep disorder, see a physician; bring your Tepna exports with you.

---

## Project voice (narrative, not spec)

For the *why* behind Tepna — the philosophy, the constraints, and the jokes — see
[`docs/WHY-THIS-EXISTS.md`](docs/WHY-THIS-EXISTS.md) (styled mirror: `Why This Exists.html`). It is
**narrative, not spec**: it defines no formats, APIs, or behavior, and nothing in it should be read
as an instruction to implement. Authoritative rules live in `CLAUDE.md`, this README, and the
`*-BRIEF.md` documents.

## Acknowledgements

Tepna stands on documented reverse-engineering and capture work by others, credited here as in the briefs:

- **[nglessner/o2ring-s-protocol](https://github.com/nglessner/o2ring-s-protocol)** — the OxyII (O2Ring-S) BLE protocol reference. The lineage runs both ways: Tepna's base protocol (frame envelope, auth, live poll) was written against this reference and hardware-verified the same day, while Tepna's own full 256-opcode sweep then mapped 25 undocumented commands beyond it — later byte-proven equivalent on the shared core. And the debt runs back: Tepna's decode of opcode `0x05` — it is `GET_RT_PPG`, a raw two-channel (red/IR) PPG drain buffer, validated over 49 sessions — was [contributed upstream](https://github.com/nglessner/o2ring-s-protocol/discussions/6), along with the `0x83` buzzer opcode and other protocol clarifications.
- **[m-kozlowski/airbreak-plus](https://github.com/m-kozlowski/airbreak-plus)** (descending from **[osresearch/airbreak](https://github.com/osresearch/airbreak)**) — the AS11 CPAP protocol *documentation* (prose and tables, not code) that Tepna's clean-room, read-only implementation was written against. No firmware modification is used or endorsed here.
- **[Polar Sensor Logger](https://play.google.com/store/apps/details?id=com.j_ware.polarsensorlogger)** by j-ware — the Android app whose faithful raw exports (ECG, PPG, IMU) made the original phone-captured corpus possible and defined the file formats the suite still speaks.
- **Open-source foundations** the capture lane leans on daily: [bleak](https://github.com/hbldh/bleak), [mutmut](https://github.com/boxed/mutmut), chrony, and the Python and Node ecosystems.

**AI-assisted development** [![Built with Claude Code](https://img.shields.io/badge/built_with-Claude_Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code): Tepna is built in close collaboration with Anthropic's Claude — the commit history carries the co-authorship trailers openly. Every behavioral claim is still held to the same standard regardless of who wrote it: gates, planted controls, and provenance, not trust.

## Licensing

Apache-2.0. Author: **Michal Planicka** ([ORCID 0009-0008-3501-3596](https://orcid.org/0009-0008-3501-3596)). Product brand: **Tepna**. See `LICENSE`, `NOTICE`,
`CITATION.cff`, and `THIRD-PARTY.md`. User-facing surfaces carry the health intended-use
disclaimer — Tepna is **not a medical device** and does not diagnose, treat, or monitor any
condition.
