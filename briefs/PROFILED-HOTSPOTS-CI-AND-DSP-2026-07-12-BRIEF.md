<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-21 (§2 + §1a EXECUTED via `CI-SHARDING-2026-07-12-BRIEF.md` — `group()` skips execution for out-of-shard groups (`dex-tests.js:146`, `dexShardSelector`), union proven by `tests/verify-shard-union.mjs`, `tests` job ~4m→~1m; §3 RETRACTED (vm-realm profile artifact, `EFFICIENCY-AUDIT-FINDINGS-2026-07-12 §M1`); §4 measured + DISMISSED; **§1b decided: LEAVE `lombScargle` as-is** — recorded in Done-when below. Nothing new surfaced beyond what §4's dismissals + the retraction already record → no follow-up brief.) · **Created:** 2026-07-12 · **Feeds:** `audits/EFFICIENCY-AUDIT-PROMPT.md` (run this brief's §0 rule FIRST) · **Relates:** `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md`

# Profiled hot spots — the CI gate and the DSP, from CPU profiles rather than guesses

> **Progress audit (2026-07-15):** most of this brief has landed — kept `PROPOSED` only because ONE
> Done-when item is genuinely open. **§2 (`DEX_SHARD` skips *execution* inside `group()`) + §1a (sharded
> matrix CI) EXECUTED** via `CI-SHARDING-2026-07-12-BRIEF.md` (DONE; `group()` skips out-of-shard, partition
> proven by `verify-shard-union.mjs`, 4m05s→~1m10s). **§3 (the `mean(tmpl)` hoist) RETRACTED** —
> `EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md §M1`: the profile that produced "28% in `mean`" was taken in the
> Node `vm` realm, which inflates tight numeric loops up to 12.3×; the hoist A/B's at **1.015×**. The real,
> byte-identical PpgDex win (`parsePPG` parsing 190k timestamps it never reads → 2.01×) landed separately.
> **§4 measured + DISMISSED** (recorded so no re-derivation). **STILL OPEN: §1b** — a recorded decision on
> `lombScargle` (35% of the ECGDex-bound gate): *optimise (and regenerate fixtures) or leave.* §4's GPU note
> leans "leave" (a WGSL f32 port would change the f64 gated output = a metric decision, not a perf one), but
> a CPU optimise-or-leave call is not yet crisply recorded — plus the closing "follow-up brief or nothing-
> surfaced note." Owner/next-session call; flip to DONE once §1b is recorded.

Four findings, all from **CPU profiles of the real pipeline on real inputs**. Nothing here is estimated
from an op-count. The point of writing them down is that the next session should not re-derive them —
and, more importantly, should not repeat the mistake in §0.

---

## §0 — The rule this brief exists to enforce: PROFILE, don't microbenchmark

**A synthetic microbenchmark of a DSP kernel will lie to you about the sizing.** This is not
hypothetical; it happened during the session that produced this brief, and it cost a full
implementation cycle.

Two `ppgdex-dsp.js` optimisations were identified by *reading the code* and validated with *synthetic
benchmarks*:

| optimisation | synthetic benchmark | **real `compute()`** |
|---|---|---|
| `beatSQI` per-column median → quickselect (`:405`) | 518 ms → 29 ms (**17.9×**) | `median` is **1.6%** of runtime |
| mag/posture window scans → binary-search bounds (`:682–720`) | 144 ms → 3.5 ms (**42×**) | ~0 |
| **end-to-end** | — | **1.01×** (946 → 940 ms) |

Both changes were *correct* — byte-identical exports verified against `origin/main` on three real
captures (including one with ACC+MAGN companions, so the mag path was genuinely exercised), and the
full suite incl. the PpgDex equiv leg stayed green. They were simply **worthless**: the benchmark
assumed ~30k beats/night; a real capture yields a fraction of that. They were **abandoned, not
shipped** — a 1.01× is not worth re-bundling three bundles (`PpgDex`, `OverDex`, `Data Unifier`) and
re-stamping fixtures.

**Do this instead**, before touching any kernel:

```sh
node --cpu-prof --cpu-prof-dir=/tmp/prof <driver-that-runs-the-real-pipeline>.mjs
# then sum self-time by functionName and by callFrame.url
```

The CPU profile was the only honest witness in the whole exercise. **`audits/EFFICIENCY-AUDIT-PROMPT.md`
should be run with this as its opening constraint.**

---

## §1 — The CI `test` gate is ECGDex-bound and SINGLE-THREADED

`node tests/run-tests.mjs`, the dominant step of the `tests` workflow (job wall time ~3m57s in CI):

```
98.6 s wall · 104% CPU        ← one core, on a multi-core runner
--- self-time by function ---
35.0%  lombScargle            ← ecgdex-dsp.js:579
13.8%  genSynthetic           ← test scaffolding, not product code
 8.9%  gauss
 7.2%  detectPeaksB
 3.1%  phi                    ← SampEn
--- self-time by file ---
74.7%  ecgdex-dsp.js
 8.7%  ppgdex-dsp.js
 6.3%  synth-gen.js
```

**`lombScargle` alone is 35% of the entire gate.** It is called at `ecgdex-dsp.js:675` (per 5-min
epoch, `nf=160`), `:1148` (whole-record, `nf=220`) and `:1150` (`nf=300`). It is an O(nf × N) direct
periodogram with `sin`/`cos` in the inner loop — two full passes over every beat per frequency bin.

Two independent levers, in value-per-risk order:

- **(a) Shard the gate across CI runners** — see §2, which is a prerequisite. Highest value, lowest risk:
  it changes no test semantics and no product code.
- **(b) Optimise `lombScargle` itself** — 35% of the gate, and also product-path cost. ⚠️ It lives in a
  **gated DSP**: `ECGDex` has an equiv leg pinning `compute()` ≡ its committed export, so ANY change to
  float ordering moves published metric values and reds the gate. A bit-identical speedup is hard here
  (the obvious trig-recurrence / double-angle tricks all re-associate floats). Treat as its own
  work-unit with an explicit fixture-regeneration decision, not a drive-by.

---

## §2 — ⚠️ `DEX_GROUP` filters the REPORT, not the RUN (blocks §1a)

`tests/run-tests.mjs:34` documents `--group` / `-g` / `--only` / `DEX_GROUP` as *"runs ONLY the groups
whose title/tag match"*. **It does not.** `group(title, tag, fn)` in `tests/dex-tests.js:79` calls
`fn(T)` **immediately** and pushes the finished result; the filter is applied afterwards, at
`:11793–11801`, to the already-populated `GROUPS` array.

Measured:

```
full suite        : 101.07 s
DEX_GROUP=oxydex  : 100.68 s     ← everything still ran
```

So the filter is a **display** filter. Two consequences:

1. The doc comment at `run-tests.mjs:34` is wrong and should be fixed either way.
2. **CI sharding cannot be a workflow-only change.** `group()` must skip *execution* of out-of-shard
   groups, not run-then-filter.

**Proposed fix.** Add index-based sharding (`DEX_SHARD="i/N"`) evaluated **inside `group()` before
`fn(T)` runs**. Index-based, not name-based, deliberately: a name/pattern shard silently drops any
group nobody remembered to assign, which is exactly the "silent cap" failure this repo forbids.

**Done when** (non-negotiable, because skipping execution can hide cross-group state coupling):
run all N shards, union their per-test results, and assert the union is **identical** (same test names,
same pass/fail) to the unsharded run. If a group depends on state a skipped group created, this is the
only thing that will catch it. Only then wire the GitHub Actions matrix.

Expected: `tests` job ~4 min → ~1 min on 4 shards (each matrix job gets its own runner, so this is not
bounded by a single runner's cores).

---

## §3 — ~~`PpgDex.compute()`: the real cost is `mean`, and it is a one-line fix~~ **RETRACTED 2026-07-12**

> ### ⛔ §3 IS WRONG — DO NOT IMPLEMENT IT. Retracted by `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md` §M1.
>
> The hoist was implemented exactly as specified below and A/B'd end-to-end on real captures:
> **1.015×** (`n0612b`, 1157 beats: 347.4 → 342.3 ms) and **1.00×** (the committed equiv clip).
> True self-time in a browser-representative realm: **`mean` = 0.84%**, `pearson` = **0.00%** — not 28%.
> Arithmetically it never could be: 1157 beats × a 114-sample template ≈ 132k float adds ≈ 0.15 ms.
>
> **Root cause of the wrong number — and the lesson that generalises:** the profile below was taken
> inside `run-tests.mjs`'s contextified **Node `vm` sandbox**, where global lookups (`Math`, `Date`) go
> through the context's interceptors, so **tight numeric loops inflate wildly and non-uniformly — which
> re-ranks the profile.** Measured distortion vs the main realm: `PulseDex.compute` **12.3×**,
> `OxyDex.compute` 3.3×, `PpgDex.compute` 2.6×. (OxyDex's SampEn `countMatches` reads as 15.9% of
> `compute()` in the vm realm and **~0%** in the main realm — do **not** "fix" it either.)
>
> This is **§0 happening one rung up**: §0 said *don't trust a synthetic benchmark — profile the real
> pipeline.* The correction is *don't trust a profile taken in the test harness's vm realm either.*
> **Profile via `vm.runInThisContext` or a browser.**
>
> The *real* PpgDex win is elsewhere and is byte-identical: `parsePPG` runs `parseTimestamp` on all
> ~190k rows but only ever reads the first → **`compute()` 2.01×** end-to-end. Plus a genuine
> **correctness bug** in `ppgdex-morph.js` (a fractional `Float32Array` index silently nulls most of the
> surfaced perfusion-index trend). Both are in the findings doc above.

### The retracted claim, kept verbatim for the record:

CPU profile, real 24.5-min Verity capture (258,737 samples, 3 LEDs), `compute()` = 919 ms:

```
28.2%  mean            ← ppgdex-dsp.js:42
24.7%  parsePPG
12.7%  parseTimestamp
 6.9%  lombScargle
 4.9%  phi             ← SampEn
 1.6%  median          ← what §0's abandoned work targeted
```

**`mean` at 28% is `pearson()` recomputing `mean(tmpl)` once per beat.** `pearson(a,b)`
(`ppgdex-dsp.js:468`) does `const ma=mean(a), mb=mean(b)`, and `beatSQI` calls it as
`pearson(b, tmpl)` inside the per-beat loop — so the mean of the **same, unchanging template** is
recomputed for every beat in the record.

Hoisting it is **bit-identical by construction** (identical input → identical value; the summation
inside `mean` is untouched). Needs a `pearson` variant that accepts a precomputed mean, or an inlined
correlation loop in `beatSQI`.

⚠️ `ppgdex-dsp.js` is inlined by **three** bundles — `PpgDex`, `OverDex`, `Data Unifier`. Per CLAUDE.md
§👥 rule 3, take the bundle lock, rebuild all three with `node tools/build.mjs --app <App>` (it
auto-writes `manifestHash` and re-stamps code-gated fixtures), and re-run the gates. Because the output
is byte-identical, `outputHash` does not move and the equiv legs stay green — only `manifestHash`
re-stamps.

**Also in §3's blast radius, unprofiled but adjacent:** `parsePPG` + `parseTimestamp` together are
**37%** of `compute()`. Parsing 258k timestamped lines dominates everything the DSP actually computes.
Worth a look before any further kernel micro-optimisation — but *profile it first* (§0).

---

## §4 — Measured and DISMISSED (do not re-open these)

Recorded so the next audit does not spend its budget re-deriving them:

| candidate | measured | verdict |
|---|---|---|
| CPAPDex `detectDesats` sliding-window max (`cpapdex-dsp.js:341`) | 3.5 ms → 1.3 ms with a monotonic deque (bit-identical) | Real O(n·W), but **3.5 ms**. Not worth touching. |
| ECG/PPG envelope pyramid (`ecgdex-render.js:30,60`) | **21.8 ms** on a real 3.74M-sample night, once per load | Not hot. A GPU upload would cost more than the work. |
| `sigma-no-reference` bootstraps (`B_ACROSS=2000`, `B_WITHIN=600`) | ~850 ms in a `vm` realm, which runs **~40× slower** than a browser | Tens of ms in Chrome. Not hot. |
| The five `*-cross.js` `bootstrapDeltaCI` + `mannKendall` | ~350k ops | Textbook GPU shape, but `n` = **nights** (10–100). Data-starved by 2–3 orders of magnitude. |
| Poincaré 2,600-dot cap (`ecgdex-render.js:312`, `ppgdex-render.js:208`) | — | **Not a bug.** SD1/SD2 come from the DSP over the *full* beat series; the cap thins only the dot cloud, and it thins *consecutive pairs*, so every plotted dot is still a genuine `(nn[i-1], nn[i])` pair. |

**And the GPU question, settled:** beyond the WebGPU Monte-Carlo lane already shipped
(`sensor-trio-gpu.js`, PR #34), there is no GPU work worth doing here. The big-FLOP kernels
(`lombScargle`, SampEn, the cadence ACF, per-beat SQI) all live **inside gated DSPs**, and WGSL is f32
against the DSP's f64 — so any GPU port there is a decision to **change published metric values**, not
a performance decision. The cohort harnesses cannot be GPU'd even in principle: they run the *real
shipped DSP* per synthetic patient, which is the entire point of them.

---

## §1b — DECISION (recorded 2026-07-21): LEAVE `lombScargle` as-is

Optimise-or-leave on `lombScargle` (35 % of the pre-shard gate): **LEAVE.** The decision follows from
this brief's own analysis + what §2/§1a already delivered:

1. **The CI-cost motive is already gone.** §1a's sharding cut the `tests` job ~4 m → ~1 m by parallelising
   across runners — the highest-value, zero-product-risk lever. Optimising `lombScargle`'s CPU further buys
   little on a gate that already runs in ~1 min.
2. **A bit-identical CPU speedup is not available cheaply.** `lombScargle` is inside a *gated* DSP
   (`ecgdex-dsp.js`) with an equiv leg pinning `compute()` ≡ its committed export; the obvious speedups
   (trig-recurrence / double-angle) all **re-associate floats**, moving published `f64` metric values and
   reddening the gate.
3. **A non-identical speedup is a METRIC decision, not a perf one** (same logic as §4's dismissed GPU/WGSL
   note): it would change shipped `validated`-adjacent HRV-frequency values, which needs a deliberate
   fixture-regeneration + owner sign-off, not a drive-by optimisation.

**Revisit only** if a *browser/`vm.runInThisContext`* profile of the real product pipeline (not the vm-realm
harness — §0/§3's lesson) shows `lombScargle` is a genuine product-path hotspot worth a metric-moving change.

## Done when

- [x] §2 — `group()` skips execution for out-of-shard groups (`dex-tests.js:80` `dexShardSelector`, `:146`);
      shard-union ≡ unsharded run, gated by `tests/verify-shard-union.mjs`; `--group`/`--shard` now filter the
      **run**, not just the report. (via `CI-SHARDING-2026-07-12-BRIEF.md`, DONE)
- [x] §1a — `tests` workflow sharded across a matrix; ~4 m05 s → ~1 m10 s recorded. (via CI-SHARDING)
- [~] §3 — **RETRACTED, deliberately NOT implemented** — the `mean(tmpl)` hoist A/B'd at 1.015× (a vm-realm
      profile artifact; `EFFICIENCY-AUDIT-FINDINGS-2026-07-12 §M1`). Not worth re-bundling three bundles.
- [x] §1b — decision recorded above: **LEAVE** `lombScargle` as-is.
- [x] Nothing new surfaced beyond §3's retraction + §4's dismissals → **no follow-up brief** (per CLAUDE.md
      §📌, recorded here rather than spawning an empty one).
