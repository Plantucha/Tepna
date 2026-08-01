<!--
  EXPORT-PATH-UNREACHABLE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Affects:** `glucodex-dsp.js`, `motiondex-app.js`, `HRVDex.src.html`, `hrvdex-dsp.js`, `PulseDex.src.html`, `pulsedex-app.js`, `overdex-app.js`, `motiondex-dsp.js`, `Dex-Test-Suite.html`

# Every gate is green and five of eight nodes cannot hand the Integrator its currency.

The suite was driven end-to-end in real Chrome the way a user drives it — files picked through the
actual `<input type=file>`, results read off the rendered DOM, exports taken by clicking the actual
buttons — on the most complete night in the corpus (**2026-07-26 21:41 → 07-27 05:10**: 208 MB of H10
ECG, its `_RR` and `_ACC`, the O2Ring's `_STORED.dat` and BLE `_SPO2.csv`, its 46 MB finger `_PPG`,
and ten ResMed EDFs).

Every node **computed correctly**. ECGDex parsed 208 MB in 10.6 s at 433.4/433.7 min beat coverage;
OxyDex read 442.9 min off the device's own memory; MotionDex resolved 434 min, 1.3 M samples,
respiratory rate 15.8. The DSP layer is not what this brief is about.

**Five of the eight then could not give the user the file.** Not "produced a poor export" — produced
nothing, or produced something the Integrator cannot read:

| node | ⬇ JSON does | reachable? |
|---|---|---|
| **GlucoDex** | throws `GLUDSP.glucoCells is not a function` | ❌ no download at all |
| **MotionDex** | button enabled inside a `display:none` bar | ❌ bar never shown |
| **HRVDex** | fires — if you can hit it | ❌ pointer-intercepted ≥1200 px |
| **PulseDex** | dumps `lastResult` raw, no `schema`, no events | ⚠️ file, but not currency |
| **HRVDex** | emits a bare array of view rows | ⚠️ file, but not currency |

And `node tests/run-tests.mjs` was **4668/4668 green**, `tools/build.mjs --check` clean, on the exact
tree that produced all five.

> **This is one failure with one shape.** Every gate in this repo verifies the DSP: `compute()`,
> `_build()`, the GATE-C equivalence legs that re-run `GlucoDex.compute` against a committed export.
> **None of them presses a button.** So the app-layer copy of the export path — the `#exportBar`
> wiring, the CSS stacking context it lives in, the app's *own* second export builder — is
> unobserved, and it has rotted in five places independently. `FIXTURE-VERIFICATION-GATE` abolished
> "export-inert" as an *assertion*; this is the same lesson one layer up: **a gate that never runs the
> user's path cannot see the user's path.**

---

## 1 · GlucoDex — the node-export throws

`glucodex-app.js` builds `timeseries.cells` with `GLUDSP.glucoCells(r.series)`. `glucoCells` is
defined in `glucodex-dsp.js` and **is not on the `global.GLUDSP = { … }` object**. It is the only
`GLUDSP.*` member the app references, so the single missing key takes the whole export down.

Shipped **2026-07-27 in `71b89df`** ("emit coverage + the sliceable cell trace, single-sourced") — the
commit that added `glucoCells` precisely to *stop* two copies of the cell builder drifting. It
single-sourced the function and forgot to publish it. `⬇ CSV` and `⬇ Cleaned CSV` are unaffected, which
is why nothing looked wrong.

The DSP's own `glucoBuildNodeExport` calls `glucoCells` **in lexical scope**, so `GlucoDex.compute`
works, so the equivalence gate is green, so five days passed.

## 2 · MotionDex — the bar is never shown

`ans-design.css` gives `#exportBar { display:none }` and reveals it with `#exportBar.show`.
`motiondex-app.js` un-disables `#mxExport` on a successful analysis — **inside the hidden container** —
and never adds `.show`. Measured: the bar's rect is `0×0`, and a real click is rejected *"Element is
not visible"*.

MotionDex is the one node whose export bar is static markup in its `.src.html` rather than written by
JS, which is exactly how the `.show` call went missing: every other node adds the class in the same
statement that writes the buttons.

## 3 · HRVDex — the export bar is under the mobile nav on every desktop width

`HRVDex.src.html` sets `.mobile-nav { display:block; position:fixed; bottom:0; z-index:500 }` at **all**
widths — deliberately, per its own comment ("shown at all widths … stacks above the export bar") —
while `#exportBar` is `z-index:400`. The `@media (max-width:1080px)` block lifts
`#exportBar { bottom:100px }` so the two do not overlap on mobile. **There is no desktop counterpart**,
so above the breakpoint the bar sits at its default `bottom` *underneath* the fixed nav.

Swept across viewport widths, reading `document.elementFromPoint` at each button's centre:

| width | intercepted by `.mobile-nav-items` |
|---|---|
| ≤ 1080 | *(none)* — the media query lifts the bar |
| 1081–1199 | ＋ Add files · ✕ Clear saved history |
| **≥ 1200** | **⬇ JSON · ⬇ CSV · ⬇ PDF · ＋ Add files · ✕ Clear** |

OxyDex and the Integrator carry the same nav with `display:none` at base and `block` only inside the
media query, and are unaffected. HRVDex is the only app that made the nav permanent, and the desktop
`bottom` offset its own design requires was never written.

## 4 · PulseDex and HRVDex — `exportGanglior()` is wired to no button

Both nodes define the real builder — `pulsedex-app.js exportGanglior()`, `hrvdex-app.js
exportGanglior()` — and **neither is reachable from any control in the app.** No `id`, no `data-act`,
no listener. What `⬇ JSON` does instead:

- **PulseDex**: with ≤1 recording loaded it serialises `lastResult` verbatim — the internal analysis
  object (`t0Ms … _series, _key`), no `schema`, no `ganglior_events`. The proper wrapper exists but
  only on the **≥2 recording** branch, so the single-night case — the common one — silently yields a
  file that is not a node-export.
- **HRVDex**: `exportJSONL` emits a bare array of the current view's rows (`{0:…,1:…,2:…}`), no
  envelope. *(The 3-of-30 row count is correct and honestly labelled — the bar reads "JSON / CSV
  export the current view — last 7 days". The scope is fine; the shape is not.)*

The Integrator diagnoses PulseDex exactly right and then gives an impossible instruction:

> ⚠ "…looks like a PulseDex SUMMARY export … Re-export via the node's **"Ganglior" button**
> (→ `*_ganglior.json`) to fuse its events."

**That button does not exist in either node.** HRVDex gets no warning at all — it loads as
`date unknown · 0 events · no kernel stamp` and is silently inert.

## 5 · OverDex routes OxyDex's own export into the SpO₂ parser and loses it

`overdex-app.js classify()` asks the adapter registry **first** and only falls through to node-export
detection when no adapter claims the file. `adapters/oxydex-spo2.js` claims on the **filename**:

```js
if (/o2ring|oxydex|wellue|viatom|checkme/i.test(name)) return 0.95;  // explicit device/app mark
```

`OxyDex_2026-07-26_2141_summary.json` matches `/oxydex/i` at 0.95, wins the route, is handed to the
CSV row parser, and dies as *"unusable frame: oxydex-spo2: no usable SpO₂ rows parsed"*. It is then
**not** retried as a node-export. `adapters/libre-cgm.js` carries the identical `/glucodex/i → 0.9`
rule, so GlucoDex is due to fail the same way the moment §1 is fixed.

Same six files, two consumers:

| | Integrator | OverDex |
|---|---|---|
| nodes fused | 6 | 5 |
| OxyDex | **57 events** | **missing** |
| findings | 1 (`periodic_breathing`, ECGDex + OxyDex) | 0 |
| confirmed apnea idx | computed | — |

The adapter precedence is backwards. A `ganglior.node-export` **declares what it is** in
`schema.name`; a vendor adapter only ever *guesses* from a name and a 2 KB head. The self-describing
artifact must win.

Two further OverDex defects fall out of the same run and are in scope:

- **The routing manifest names the wrong node for 4 of 9 adapters.** `classify()` maps
  `spo2 → OxyDex`, `hrv → HRVDex`, **everything else → PulseDex** — so `ecg`, `ppg`, `cgm` and `cpap`
  all display "→ PulseDex". Cosmetic only: the 208 MB ECG *ran through ECGDex correctly* and produced
  62 events with rMSSD 35.4, identical to the standalone app. The manifest simply lies about it.
- **ResMed EDFs route and then fail** — *"EDF is binary + multi-file — pass `ctx.buffers`… the text
  argument is not used"*. OverDex reads every file as text. Recorded here, **not fixed** in this unit
  (it needs a binary read path through `WALK`, which is its own work-unit).

---

## 6 · What this unit deliberately does NOT take

Several sessions are working this repo today (#618–#627 all merged 2026-08-01). This unit is scoped
to files **none of them touch**, so nothing here contends:

| finding | why not here |
|---|---|
| **The ~42 min CPAP clock skew** (§7) | `integrator-dsp.js` is being actively changed by #624 (`fitClockOffsetPooled` sub-second) and #627 (desat-onset fiducial). Both land in the exact code the finding is about. Recorded below; **owner's call**, not a drive-by threshold edit. |
| **PpgDex `device:'Polar Sense'`** hardcoded in `ppgdex-app.js` for an O2Ring finger file | #626 (`say whether the optical site was observed or assumed`) just landed in `ppgdex-dsp.js`. Adjacent enough to collide; belongs with that work. |
| **OxyDex `.dat` emits no `recording.coverage`** (the CSV path does) | Cold, but a separate concern — the Integrator falls back to "envelope basis" and prints 100 %. Follow-up. |
| **OverDex cannot read binary EDF** | Needs a buffer path through `WALK`; own work-unit. |

## 7 · Recorded, not fixed — the CPAP clock skew the Integrator found and vetoed

On this night the ResMed's clock ran **~42 min behind** the phone/capture-host. Cross-correlating
OxyDex desats against CPAPDex apneas gives a sharp peak at **−2510 s → 23/33 paired** (±120 s) against
**3/33 at zero shift** and a chance expectation of ≈8. The O2Ring is not the offender: its two
independent sources — BLE phone-stamped CSV and device-memory `.dat` — agree with **each other to
−15 s, 13/13**, which incidentally cross-validates the `.dat` parser against the CSV one.

The Integrator's own detector **found it**: `clockSkew.pairs` carries
`CPAPDex↔OxyDex lagSec:2400, peakOverFloor:3.89, hits:16` — and `skewed:false`, for two reasons:

1. `minPeakOverFloor` defaults to **4**. It misses by **0.11**.
2. Even clearing that, the agreement test vetoes it: `CPAPDex↔ECGDex` estimates 3810 s, and the
   1410 s spread blows past `agreeTol = 2 × matchSec = 120 s`.

Reason 2 is the structural one. **ECGDex emits sleep stages and autonomic surges, not respiratory
events** — it cannot observe the coincidence whose lag is being measured, so requiring it to
corroborate a respiratory-event offset is requiring agreement from a witness who was not in the room.
`integrator-dsp.js` documents "the true CPAP skew held 37.5–40.0 min across every partner"; this
night measured **40.0**, and was discarded anyway.

Consequence: the night's headline fusion numbers — **DESAT MATCH RATE 0 %**, **CONFIRMED EVENTS 0**,
**CONFIRMED APNEA INDEX "below chance"** — are artifacts of an uncorrected device clock, not
physiology.

**No fix is proposed here.** The threshold was tuned on a 38-night corpus specifically to stop false
positives that "corrupt good data", and #624/#627 are moving this code right now. Lowering `4` to
clear one night is fitting the estimator to its own corpus — the error `POOLED-CLOCK-FIT` §8.5
explicitly refused to make. The defensible change is to **restrict the agreement requirement to
channels that can observe the same event class**, and that needs a corpus run, not a one-line edit.

---

## 8 · EXECUTED — and the gate that presses the buttons found three more

All of §1–§5 are fixed and verified in real Chrome on the same night. Then the new gate was written —
and it is the part of this brief that will still matter in a year, because **it found three defects
nobody had reported, within minutes of first running.**

`renderCoverageApp` gained an `exportBarProbe`: is `#exportBar` displayed after a committed result,
and does `document.elementFromPoint` at each button's own centre land on that button? The hit-test is
the whole point — a z-index regression is **invisible** to `offsetParent` and `getBoundingClientRect`,
which is exactly how §3 walked past every structural check the suite already had. The `#rig` iframe is
1280 px wide, so it sits squarely in the broken band.

**What it caught immediately:**

1. **MotionDex had no render-coverage leg at all.** Its bundle had never been booted in the rig —
   which is precisely how an export bar that was `display:none` from birth survived to production. It
   now has one (`#demo`, the same pattern as GlucoDex).
2. **MotionDex's ▶ Demo button had never worked.** The first boot threw
   `MOTIONDSP.genSynthetic is not a function`: `window.MotionDex` published the function as
   `genSynthetic`, `MOTIONDSP` published it **only** as `genSyntheticACC`, and `motiondex-app.js`
   calls the former. **This is §1 again, in a different node** — two namespaces over one function
   disagreeing about its name. Aliased, not renamed, so both spellings keep working.
3. **GlucoDex's render-coverage leg was HOLLOW.** Measured on a bare `GlucoDex.html` with no data
   loaded at all: **16 numeric tokens against `minNums:15`**, all four of `CV`/`GMI`/`range`/`glucose`
   matched **in the empty state's own help text**, and **2832 chars against `minChars:1500`**. Every
   assertion in that leg passed with the app showing nothing. The export-bar probe was the first
   assertion in it that required data to exist.

So the settle predicate now **settles on the export bar** when a leg declares one. That fixes the
GlucoDex race (its `#demo` lands through `load → 300 ms → genSynthetic → 30 ms → runPipeline →
setTimeout`) and de-hollows the leg in one move: `.show` on `#exportBar` is the one condition an empty
app cannot fake, because it is set only where a result is committed.

> **Negative control.** The gate was not trusted on the strength of going green. The §3 CSS fix was
> removed, HRVDex re-bundled, and the suite re-run: **exactly one leg reds — HRVDex, 27/28** — on
> "every export button is hit-testable (nothing overlays it)". Restored, re-bundled, green. A gate
> that has never been seen to fail is not evidence.

## 9 · Verified

Same night, same corpus, real Chrome, buttons pressed:

| | before | after |
|---|---|---|
| GlucoDex ⬇ JSON | `GLUDSP.glucoCells is not a function`, no file | **686 737 B node-export**, no page errors |
| MotionDex export | bar `display:none`, rect 0×0, click rejected | bar shown, **328 567 B node-export**, kernel `118ebed5` |
| MotionDex ▶ Demo | `MOTIONDSP.genSynthetic is not a function` | runs |
| HRVDex buttons blocked @1400/1920/1024 | JSON · CSV · PDF · Add files · Clear | **none — `blocked: []` at every width** |
| HRVDex ⬇ Ganglior | button did not exist | `HRVDex_2026-06-10_37d_ganglior.json`, kernel stamped, 30 measurements |
| PulseDex ⬇ Ganglior | button did not exist | `PulseDex_2026-07-26_2155_ganglior_*.json`, kernel stamped, 4 events |
| Integrator | 6 nodes · PulseDex 0 ev · HRVDex "no kernel stamp" | **8 nodes · 449 min overlap · every node kernel-stamped** |
| OverDex | 5 recordings · **OxyDex lost** · 0 findings | **8 recordings · 1 finding** |

`⬇ Ganglior` is deliberately distinct from `⬇ JSON` in both nodes: JSON stays the human VIEW (HRVDex's
is the last-7-days window its own hint already advertises — 3 of 30 measurements, correctly labelled),
Ganglior is the machine BUS export and always carries the FULL recording (37 days).

**One thing did not change and is not a defect:** HRVDex still fuses with **0 events**. The envelope is
now correct — `ganglior.node-export`, kernel `118ebed5`, 30 measurements, a real date — but
`hrvBuildNodeExport` emits no impulses for this Welltory file. That is the DSP's own thresholding on
spot readings, not the export path, and is left alone here.

### Gates

- `tests/run-tests.mjs` — **4723/4723, zero skips**, `DEX_UPLOADS` pointed at the real corpus, so the
  GATE-C real-recording equivalence legs actually ran. No export bytes moved.
- `tools/verify-fixtures.mjs` — 3 fixtures re-verified and re-stamped (GlucoDex, HRVDex ×2) after the
  compute-closure change; 11 already current. `verifiedUnder` written by the only tool allowed to
  write it, after a green corpus run.
- `browser-gates.mjs` — Dex-Test-Suite **all green, 4719 passed, 327 groups** (was 4677 / 326:
  +42 assertions, +1 group for MotionDex) · verify-provenance 9 bundles / 28 fixtures ·
  no-network clean.
- `build.mjs --check` clean, 11 owned bundles.

## 10 · Done when

- [x] `GLUDSP.glucoCells` is published; GlucoDex `⬇ JSON` downloads a `ganglior.node-export`.
- [x] MotionDex reveals `#exportBar` on a committed analysis; `⬇ JSON` downloads — and its export
      carries the `kernel` block it never had (additive `opts` arg, LAST, per the contract rule; the
      committed golden is untouched because `kernel` is a volatile key the equiv gate excludes).
- [x] HRVDex's export bar is hit-testable at 1024–2560 px; no button is intercepted.
- [x] PulseDex and HRVDex each expose `exportGanglior()` on a labelled control, and the file it
      produces loads in the Integrator with a non-zero event count and a kernel stamp. *(HRVDex: kernel
      stamp yes, events 0 — see above.)*
- [x] OverDex classifies a self-describing `ganglior.node-export` as an export **before** consulting
      the adapter registry; the OxyDex export fuses. Guarded by a `/^\s*\{/` head sniff so a 208 MB
      ECG text is never handed to `JSON.parse`.
- [x] OverDex's manifest names the node that will actually run.
- [x] **A gate that presses the buttons** — shipped, negative-controlled, and it found three more.
- [x] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` clean · re-bundled · changeset dropped.

## 11 · Follow-ups this unit did not take

- **The ~42 min CPAP clock skew** (§7) — `integrator-dsp.js` is being actively changed by #624/#627.
  Owner's call, and it needs a corpus run, not a threshold edit.
- **PpgDex `device:'Polar Sense'`** hardcoded for an O2Ring finger file — belongs with #626's site work.
- **OxyDex `.dat` emits no `recording.coverage`** while its CSV path does, so the Integrator falls back
  to "envelope basis" and prints 100 %.
- **OverDex cannot read binary EDF** — needs a buffer path through `WALK`.
- **How many other legs are hollow?** §8.3 found one by accident. Nothing systematically checks that a
  render-coverage predicate is unsatisfiable by the empty app; the `#exportBar` settle now covers the
  six legs that declare one, and no others.
