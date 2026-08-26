<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (**NOT data-blocked, and never was — `uploads/trio/` already commits 25 post-host-axis nights against this brief's target of 15.** The 2026-08-04 fold turned out to REPRODUCE that committed set, not extend it. The 15 further nights on disk are CONFOUNDED — code version and date are the same variable — so they must be regenerated, not subset. What remains is a judgement: which estimator seeds the sim) · **Created:** 2026-07-12

> ## 🔴 READ FIRST, 2026-08-26 — you have arrived wanting the tables to AGREE. That is the wrong instinct.
>
> Box 2 was executed (PR #1821). The harness is fine; **the paper's four simulation tables were produced
> by three different runs and no single run reproduces them together.** The resting-bias table still
> belongs to the superseded planted σ **1.7 / 2.2 / 3.0** — reverting both copies lands H10 on the
> published value to **0.002**. The ρ table reproduces under **neither** σ set.
>
> **This STRENGTHENS the gate on the 15-night re-fit; it does not lift it.** Regenerating Tables 1–3 now
> would make three generations agree for the first time and destroy the only evidence the desync ever
> happened — a green bought by deleting the finding. Regenerate from **ONE** run, as its own work-unit,
> **stamping each table with the run that produced it**, before any re-fit. (Same defect in table form as
> `PPGDEX-ALGORITHM-DEEP-DIVE` §5: an apparatus never committed, so nobody could re-derive the bound.)
>
> Full measurement: §"Box 2 EXECUTED 2026-08-26" below.

> ## ⚠️⚠️ CORRECTION, 2026-08-08 — BOTH claims below are wrong, in opposite directions
>
> The header says **"NOT data-blocked, and never was."** True of `tools/tch-multinight.mjs`; **false of
> the estimator the papers publish.** The fused-weight hat needs per-second HR from all three corners
> plus per-corner `c`. Measured on the committed corpus: **0 of 40 OxyDex exports carried ANY HR
> timeseries** (5-min epoch medians + 1 Hz SpO₂ only), and neither beat series carried `c` (only a 0/1
> Malik `corrected` flag). The O2Ring corner was **not in the file**, so the fused hat was un-runnable
> **at any N** — a structural blocker, strictly worse than the sample-size one this brief tracked, and
> invisible precisely because the *other* estimator runs fine on the same exports. Fixed 2026-08-08 by
> the additive `ms;hr;c` contract; consumer `tools/tch-fused-corpus.mjs`.
>
> And the correction below says the `Ecg nightly` fold **"REPRODUCED the committed corpus."** It
> reproduced the dates and the σ magnitudes — **not the timing provenance.** Committed `uploads/trio`
> carries `timingSource: device+host` ×25 (box: a real second clock); re-deriving the same dates from
> `Ecg nightly` gives `device` ×25, because that tree's host column is the device stamp *rounded* —
> `DexClock.hostAxis(…).spreadMs = 1.000`, `independent = false`, the exact top of `CLAUDE.md` §7's
> phone band (0.13–1.00 ms) against the box's 101.89–5124 ms. Commit order rules out a code
> explanation (#773 at 19:26 vs the `independent` check in #746 at 10:01, same day). **They are
> different capture trees**, and folding one as if it were the other silently downgrades the tier —
> which matters here because §7 is explicit that only the box actually puts the two devices on one
> timebase.
>
> **The re-fit has now been RUN**, on the box tree, at N=17 — past this brief's target of 15:
> O2Ring **2.99** / H10 **1.78** / Verity **3.51** bpm (fused, median [IQR] over nights). It does
> **not** reproduce the paper's 2.41 / 1.28 / 1.42, and it inverts the ordering. See
> `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`'s 2026-08-08 banner for the full table and what it owes.

> ## ⚠️ CORRECTION, 2026-08-04 — the fold below was a REPRODUCTION, not new data
>
> The note below closed by saying the overlap with the existing corpus was "not established". It is now,
> and the answer is the unflattering one: **`uploads/trio/` is TRACKED and holds those exact 25 nights**
> (75 committed exports, 2026-06-10 … 2026-07-13 — the identical set). The fold re-derived the committed
> corpus. It is a useful reproduction check, and it is **not** an increase in N.
>
> **But the conclusion survives, for a better reason.** This brief blocks the paper on N = 10 → 15. The
> committed corpus is **25 post-host-axis nights**, and `tch-multinight` confirms it as a single
> producing-code version — *"all 25 night(s) from one producing code version — medians are corpus
> figures."* **The re-fit was never data-blocked. It can run today, on committed data, at N = 25 against a
> target of 15.**
>
> ### The 15 extra nights on disk are a trap, and the tool says so
>
> The working tree also carries `uploads/trio/2026-07-16 … 2026-07-30` (15 nights, uncommitted). Adding
> them looks like N = 40. Running the hat over all 40 returns:
>
> ```
> ⚠ CONFOUNDED — corpus mixes producing-code versions (post-host-axis 25, pre-host-axis 15)
>   AND each cohort occupies its own date range, so code version and date are the same
>   variable — regenerate, do not subset
> ```
>
> Code version and date are **perfectly confounded**, so no subsetting recovers a clean comparison: any
> date-based split is also a code split. The instruction is explicit — **regenerate, do not subset**.
>
> **Regenerating them is possible but not cheap.** The raw capture for 2026-07-25 … 08-04 (11 nights, 5 of
> them entirely new) lives on the vigil box; `node` is absent there, and the link measures ~2 MB/s, so
> pulling the ~5.5 GB of trio-relevant streams is ≈ 40 min. Worth doing to push N past 25 — but it is an
> enhancement, not a blocker, and it should not be confused with one.
>
> ## 📊 25-night trio fold, 2026-08-04 — the data half of this brief
>
> This brief blocks `SENSOR-TRIO-NIGHTS-PAPER` on an N = 10 → 15 re-fit whose CI is *"that paper's entire
> deliverable"*. **N is now 25**, from a corpus that was simply not known to be reachable: 19 GB of Polar
> Sensor Logger output at `Ecg nightly/` on the working volume (see [[psl-corpus-ecg-nightly]] in the
> session memory, and `CAPTURE-HOST-FOLLOWUPS-II`'s V1/V2 note).
>
> Run with the sanctioned tools, not a hand-rolled harness:
> `tools/trio-batch.mjs --src "…/Ecg nightly" --out <dir>` → 25 nights (2026-06-10 … 07-13), 75
> node-exports, 190 s — then `tools/tch-multinight.mjs --dir <dir>`.
>
> ```
> corpus: all 25 night(s) from one producing code version — medians are corpus figures
> distribution (23 estimated / 25 nights)
>   median σ[ECGDex]  classic=0.56  ρ-on=0.81 bpm
>   median σ[PpgDex]  classic=2.71  ρ-on=2.99 bpm
>   median σ[OxyDex]  classic=1.11  ρ-on=1.14 bpm
>   median culprit σ (ρ-on) = 3.28 bpm
> ```
>
> **⚠️ These are NOT comparable to the paper's published 2.41 / 1.28 / 1.42 (O2Ring / H10 / Verity), and
> must not be swapped in.** Different estimator: `tch-multinight`'s classic / ρ-on fit versus the paper's
> **fused-weight artifact-robust** hat. The ordering differs too — this fold puts PpgDex (Verity) noisiest
> at 2.71 and OxyDex (O2Ring) at 1.11, where the paper has O2Ring noisiest. That difference is a question
> to answer, not a correction to apply, and answering it is what the re-fit actually is.
>
> **Honest limits of this run, all from the tool's own output:**
> - **2 of 25 nights EXCLUDED** — negative classic variance puts the correlated fit on the non-negativity
>   boundary, where the boundary member's σ is ~0 *by construction, not by measurement* (2026-06-24,
>   2026-07-07). The tool excludes them; they are not quietly averaged in.
> - **7 nights carry `⚠ρ-REJECTED`** — the ρ fit was refused on those, so they fall back to classic.
> - Per-night drift lines print `UNCLOSED (no third source): not a measurement` — consistent with the
>   standing rule that a ppm figure needs a 3-source closure before it can be quoted.
> - **Not established here:** whether these 25 nights overlap the σ-paper's existing 26-night corpus. If
>   they are largely the same nights, this is a second estimator over the same data rather than new N —
>   check before claiming the sample grew.
>
> ⚠️ **A trap worth recording.** The first run was pointed at a `/tmp` output dir that already held **16
> nights from earlier runs**, giving a 41-night hat. `tch-multinight` caught it itself — *"⚠ MIXED — corpus
> mixes producing-code versions (post-host-axis 30, pre-host-axis 11) … a median over this corpus is a
> statement about the MIX, not about the sensors"* — and the medians shifted once the set was cleaned
> (ECGDex 0.65 → 0.56, PpgDex 3.07 → 2.71). **Fold into a fresh directory, and read that corpus line
> before reading the numbers.** · **Blocks:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · **Follows:** `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md` §181

# The N=10→15 power re-run: what it changes, and why it is NOT landed yet

Attempted §181 (*"with 5 more nights now surviving, re-run the power analysis: N = 10 → 15 changes the CI,
which is that paper's entire deliverable"*). **The re-fit is NOT landed.** What follows is the measured
result, the two blockers, and one bug the attempt exposed.

## The rule that governs this work

**The planted σ and the paper's Tables 1–3 are ONE ATOMIC UNIT.** Those tables *are* the Monte-Carlo
evaluated at that σ. Re-fitting the σ without regenerating the tables leaves the paper reporting a
simulation of a truth nobody chose — silently. **Change both, or neither.** That is why nothing shipped.

## What the re-fit WOULD be

| | O2Ring | H10 | Verity |
|---|---|---|---|
| published (10-night hat) | 2.72 | 1.86 | 1.94 |
| **15-night hat** (post detector-fix) | **2.60** | **1.58** | **1.85** |

Source: `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE` §2's like-for-like run of the real
`sensor-trio-worker.js` per-second path — **15/17 nights solved** (was 10/17), because the detector fix
recovered 5 nights the Verity gate had misdiagnosed as *"poor PPG contact"*.

## The measured effect on the deliverable (500 trials — INDICATIVE ONLY, see blocker 1)

Driving the real tool (GPU lane, fresh cache origin, only the planted σ varying):

| min N to reach CI half-width ≤ target | 10-night hat | 15-night hat |
|---|---|---|
| **H10 ±0.25** (dynamic *and* resting) | 1 | **2** |
| **Verity ±0.15** (dynamic) | 3 | **2** |
| O2Ring ±0.15 · H10 ±0.15 · Verity ±0.15 (resting) | 3 / 5 / 2 | unchanged |

H10's half-width at N=1 moves **0.2284 → 0.2590** against a 0.25 target — a genuine crossing, but a close
one. The direction is counter-intuitive and worth stating in the paper if it survives: **H10 gets quieter
(1.86 → 1.58) yet needs MORE windows**, because the TCH couples the corners and a quieter corner is
relatively harder to pin.

## ⛔ Blocker 1 — the numbers above are at the WRONG trial count, and the paper is self-inconsistent

The paper's **Table 1 caption says 50,000 MC trials/cell**; its **abstract says 720**. Those disagree, and
the tool's default is **500**. My deltas are at 500 — **not publication-grade**, and not comparable to
whatever produced the shipped tables.

**A 50k/100k re-run does not complete on this machine.** The WebGPU lane accelerates only the **N-sweep**;
the **ρ-sweep and duration-sweep that follow are CPU-bound**, and `stats.json` only exports once *all*
phases finish. At 100k the run reached 95% (the N-sweep) in ~10 min and then **stalled** — ETA advanced
**1 minute in 25 minutes** of wall clock. The heavy run also appears to have taken the GPU adapter down
(`requestAdapter()` subsequently returned null).

**Done when:** the tool's own stated trial count reproduces the *published* tables at the 10-night hat
(proving the harness), and then the 15-night hat is run at the same count, in one change with the σ re-fit.
Worth fixing the GPU lane to cover the ρ/duration sweeps first — otherwise every regeneration is an
overnight job.

## ⛔ Blocker 2 — the planted σ is TRIPLICATED, and a desync is silent

The planted truth lives in **three** files — `sensor-trio-power-analysis.js` (page),
`sensor-trio-worker.js` (CPU), `sensor-trio-gpu.js` (WebGPU) — the worker's own comment saying *"MUST match
sensor-trio-power-analysis.js DEV"*, with **nothing enforcing it**.

**This is not hypothetical: it bit during this very attempt.** A stale cached copy left the page on the old
hat and the worker on the new one, and the tool cheerfully **REPORTED planted σ = 2.72/1.86/1.94 while
SIMULATING at 2.60/1.58/1.85**, producing a plausible-looking, wrong min-N table. It also briefly convinced
me the GPU lane disagreed with the CPU lane — **it does not**: on a clean origin the two are **bit-for-bit
identical** on every half-width and the same min-N table. That false alarm was entirely the desync.

**SHIPPED in this change:** a `Trio planted σ is single-valued` gate — page ≡ CPU ≡ GPU, and pinned to the
value the published tables were computed at. Verified to red on a one-file drift.

## 🐞 Bug the attempt exposed (also shipped)

Wiring the analysis sources into the gate tripped `Storage hygiene`: *"striopwr_lock,
striopwr_secPer500 … no un-erasable data"*. **False positive** — those keys ARE erasable, they live in
`DexForget.ANALYSIS_KEYS` (the standalone-research-page tier), and `eraseAll()` wipes both tiers. The
assertion only tested `LOCAL_KEYS`, which was correct **only while `env.sources` held Dex apps
exclusively**. It now tests the **union** — which is what `eraseAll()` actually removes, and therefore what
"no un-erasable data" actually means.

## 🔬 Box 2 EXECUTED 2026-08-26 — the harness RUNS and is deterministic; the published tables do **NOT** reproduce as a set

The box above says this is *"the right thing to do FIRST … if the harness cannot reproduce what is
already published, re-fitting to 15 nights is measuring with an uncalibrated instrument."* It was run.
**The harness is fine. The paper's four simulation tables are not one measurement — they span at least
three generations of the simulation, and no single run of the tool produces them together.**

Method: `node tools/trio-power-headless.mjs --cpu --trials 720`, the paper's stated trial count, at the
committed 10-night hat. A repeat run is **byte-identical**, so every disagreement below is a property of
the code, not of a draw.

### The instrument is EXACT — which is what makes the failures below unarguable

Before reading a disagreement as a defect, the harness had to be shown not to have drifted. It has not.
At **50,000** trials on the GPU lane it reproduces the paper's own convergence table **to every published
digit**:

| trials/cell | σ O2 half @N=3 | σ H10 | σ Ver | minN(±0.15) |
|---|---|---|---|---|
| published, 50,000 | 0.1433 | 0.1539 | 0.1448 | 3 / 5 / 3 |
| **re-run 2026-08-26** | **0.1433** | **0.1539** | **0.1448** | **3 / 5 / 3** |

So the N-sweep code path is byte-faithful to what produced the published numbers. **"The harness drifted"
is eliminated as an explanation** for the bias and ρ disagreements below: the same run, the same seeds and
the same build reproduce one published table exactly and fail to reproduce the other two at all. The
defect is in those tables, not in the instrument.

### What reproduces

| published | run @720 | verdict |
|---|---|---|
| σ̂ bias, **dynamic** (−0.009 / −0.031 / −0.035) | −0.012 / −0.037 / −0.039 | ✅ within 0.006 |
| minN(±0.15) for O2 and H10 (5, 5) | 5, 5 | ✅ |

### What does not

| published | run @720 (current σ) | Δ |
|---|---|---|
| minN(±0.15) **Verity** = 5 | **3** (half@N=3 = 0.1364) | one grid step |
| σ̂ bias, **resting** (+0.071 / −0.473 / −0.169) | +0.035 / **−0.589** / **−0.552** | H10 0.116 · Verity **3.3×** |
| neg-variance rate, ρ=0.30 (0.55 → 1.00) | **0.00 at every N** | total |
| neg-variance rate, ρ=0.50 (1.00 everywhere) | **0.00 at every N** | total |

Current code needs **ρ ≈ 0.7** to produce the rates the paper prints against **ρ = 0.3**.

### The cause, measured — the bias table belongs to the SUPERSEDED planted σ

Blocker 2 above warns the planted σ is triplicated and a desync is silent. This is that failure, one
level up: the σ were re-planted from the interim device-HR triple (**1.7 / 2.2 / 3.0**) to the raw-ECG
10-night hat (**2.72 / 1.86 / 1.94**) — and the derived tables were never re-run. Reverting both copies
to the interim triple and rebuilding recovers the published bias column almost exactly:

| resting bias | published | interim σ (1.7/2.2/3.0) | current σ (2.72/1.86/1.94) |
|---|---|---|---|
| O2Ring | +0.071 | **+0.061** | +0.035 |
| H10 | −0.473 | **−0.475** ← 0.002 | −0.589 |
| Verity | −0.169 | −0.337 | −0.552 |

H10 lands on the published value to **0.002** under the old σ and is off by 0.116 under the shipped one.
That is not a coincidence and it settles the provenance of that table.

**Two things the σ swap does NOT explain, and they are the load-bearing residue:**

1. **The ρ table reproduces under NEITHER σ set.** At the interim σ, ρ=0.5 gives 0.02 → 0.26 and ρ=0.7
   gives 0.82 → 1.00; the published ρ=0.3 row (0.55 → 1.00) sits between them. So a *second* change —
   how the ρ-correlated pair error is scaled — is also in the history. Do not attribute the ρ table to
   the σ swap.
2. **Verity's resting bias is wrong under both** (−0.337 and −0.552 against a published −0.169). This is
   the **same corner** whose real-arm σ has never reproduced (published **1.42**, re-derived **3.51**,
   re-run **0.94–1.03** — the gated box below). Three independent estimates, one corner, no agreement.

### And Table 1 is itself already a composite

Its **planted-σ** column is current-generation; its **±0.15** column and **N=3 half-widths** are the
2026-08-15 5,000,000-trial WebGPU re-run (0.1421 / 0.1549 / 0.1441, which is why they read 3/5/3); its
**±0.50 / ±0.25** columns are the original 720 run. The convergence table records the original as
minN = 5/5/5. One table, three runs, no marking — which is why *"reproduce the published tables"* had no
single answer until it was actually attempted.

### The harness change that made this findable (shipped here)

`tools/trio-power-headless.mjs` exported **one** of the paper's four simulation tables — the ±0.15
column, i.e. a **threshold crossing on a coarse grid**, which the tool's own printed warning already
calls the least trustworthy statistic it produces. `bias` (both regimes) and the ρ negative-variance grid
were computed by the page on every run and **discarded at the extraction boundary**. They are continuous,
so they are what a reproduction can actually be checked against — and they are what caught this. Both are
now exported and printed, and an all-null ρ grid **refuses (exit 2)** rather than printing a well-formed
row of dashes indistinguishable from a genuine all-zero result.

### What this closes and what it opens

Box 2 is **executed**: the instrument is calibrated — it runs, it is deterministic, and it now reports
enough to be checked. The answer it returns is negative, and it **strengthens** the gate on the box
below rather than lifting it: re-fitting Tables 1–3 to 15 nights would now overwrite three tables that
belong to three different generations, silently making them consistent for the first time and erasing
the evidence of the desync. **Regenerate the tables from ONE run, as their own work-unit, before any
re-fit** — and mark each table with the run that produced it.

## Done when (§181 closure)

- [x] GPU lane covers the ρ/duration sweeps (or the tool can export the N-sweep alone), so a 50k run finishes.
      **ALREADY TRUE — verified by execution 2026-08-26, not by reading.** The GPU lane dispatches all
      three sweeps: `TrioGPU.runCell` for the N-grid, **`TrioGPU.runRho`** for the ρ grid, and
      `TrioGPU.runCell(…, DUR_GRID[di])` for the duration grid. A 50,000-trial run on
      `webgpu (amd/rdna-3)` finishes in **4.1 s** with the ρ table populated. The box's premise — that a
      50k run does *not* finish — was stale; no alternative export was needed.
- [x] Reproduce the **published** tables at the 10-night hat at the paper's stated trial count — proves the harness.
      **EXECUTED 2026-08-26 — the harness is proven; the tables do NOT reproduce as a set.** See §"Box 2
      EXECUTED" above: dynamic bias reproduces, the resting-bias table belongs to the superseded planted
      σ, and the ρ negative-variance table reproduces under neither σ set.
- [⛔] **GATED 2026-08-20 — do not do this yet, and the reason is new.** Re-fit all three σ copies to
      the 15-night hat **and** regenerate Tables 1–3 **in the same change** (the gate's expected triple
      moves with them).

      > 🔴 **`SENSOR-TRIO-NIGHTS-PAPER` carries a STANDING INSTRUCTION not to swap re-derived σ into the
      > paper**, and this box would do exactly that. The published Verity σ (**1.42**) has never been
      > reproduced: a 2026-08-08 re-derivation gave **3.51**, and a 2026-08-20 re-run of one estimator
      > over one corpus gives **0.94–1.03** — with three candidate explanations now *measured and
      > eliminated* (censoring #1600 · corpus re-fold #1601 · capture tree #1601). Neither corpus state
      > reproduces the 3.51 either, so the figures were never over the same population.
      >
      > **Regenerating Tables 1–3 against a σ triple nobody can reproduce would bake an unexplained
      > discrepancy into the published tables**, and the gate's expected triple would move with it —
      > making the gate agree with whichever number was last written rather than catching the problem.
      >
      > **Unblocks when** the SENSOR-TRIO discrepancy is explained — the named next step there is the
      > **pooled-seconds hat**, not another median over nights (`tch-fused-corpus` prints that caveat
      > itself). Box 2 above — *reproduce the published tables at the 10-night hat, proves the harness* —
      > is the right thing to do FIRST and is not gated: if the harness cannot reproduce what is already
      > published, re-fitting to 15 nights is measuring with an uncalibrated instrument.
- [~] **The "720 vs 50,000" half is STALE — already reconciled (verified 2026-08-04).** §44 records
      *"Table 1 caption says 50,000 MC trials/cell; abstract says 720"*. The paper has **no "50,000"
      anywhere**; it says **720 trials/cell in all 8 places**. `6001983` (2026-07-14, *"sigma papers to
      the 26-night folder hat"*) normalised it — **two days after this brief was written**. The
      10 → 15-night half is untouched and still open.

- [x] **The atomicity the σ gate CLAIMS is now enforced (2026-08-04).** The gate's own comment says the
      planted σ and the paper's tables are *"ONE ATOMIC UNIT … change both, or neither"* — but it only
      compared three CODE copies to each other and to a literal in the test file. **Nothing read the
      paper.** So item 3's own plan — re-fit the paper's tables to a new hat — would have left every
      assertion green while the simulation stayed at the old hat, which is the precise failure the
      comment warns about. Added a leg that scrapes the paper's `Planted σ` column and compares it to
      the simulation's. Mutation-verified **from both sides**: re-fitting the paper alone reds
      (`got ["2.41","1.86","1.94"] · want ["2.72",…]`), and re-planting the simulation alone reds the
      three pre-existing legs.

      ⚠ **Read the LABEL, not the digits.** The paper carries **three** different σ triples on purpose
      and they are not interchangeable: `Planted σ` (the simulation — **2.72 / 1.86 / 1.94**), the
      `classic raw-ECG broad-hat` overlay band (2.60 / 1.50 / 1.56), and the companion σ-paper's
      `fused-weight` headline (2.41 / 1.28 / …). I first read the 26-night 2.60/1.50/1.56 as evidence
      the atomic unit had already broken; it had not. The new leg scrapes the **column**, not the
      values, so it cannot repeat that mistake — and this note exists so the next reader does not make
      it either.
