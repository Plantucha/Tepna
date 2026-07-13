<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living findings record) · **last-verified:** 2026-07-13 · **Charter:** `audits/EFFICIENCY-AUDIT-PROMPT.md` · **Siblings:** `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md` · `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md`

# Efficiency audit — findings, 2026-07-13

Fresh run of `audits/EFFICIENCY-AUDIT-PROMPT.md` against `claude/security-audit-briefs-0qx8l3` @ `35a2612`
(one day after the exhaustive 2026-07-12 pass), on a **green baseline** (2260 assertions · 14 skipped · 147
groups · exit 0; docs-ledger 16/16 · release-ledger 10/10). Machine: **Intel Xeon @ 2.10 GHz, node
v22.22.2**. Per M1 (2026-07-12), every DSP timing below is taken in the **main realm** (`vm.runInThisContext`,
not the `vm.createContext` sandbox that distorts profiles up to 12×). Numbers are on **real committed inputs
at real scale**; hypotheses are labelled.

> **Headline: the runtime is healthy, and this pass closes the one blind spot the two prior passes left —
> the Integrator fusion / longitudinal layer, never before measured, is now measured and clean at real
> corpus scale.** No new *accepted* finding surfaced. The actionable efficiency work is the **existing,
> already-filed, still-UNEXECUTED backlog** from 2026-07-12 (see "The real do-first" below) — this pass does
> not re-file it. The honest conclusion of a fresh pass, one day after a thorough one, is that the bottleneck
> is **execution, not discovery.**

---

## 0 · Baseline + what this pass measured that the priors did not

The 2026-07-12 pass deeply covered PpgDex (C1/P1), the runner (D1/D2/D3/M1), CI (G1), and the docs
(X1–X4). It **did not** measure the **Integrator** — the fusion layer (`integrator-dsp.js`) or the
longitudinal store (`integrator-longitudinal.js`) — nor CPAPDex EDF parsing. Those are this pass's target,
using the committed inputs a fresh clone actually has: the **17-night trio corpus** (`uploads/trio/*/`, 51
node-exports, **2,528 total events**), a **real CPAP EDF** (`20260613_231433_BRP.edf`, 450 KB), and the
committed **synthetic longnight** (`synthetic_oxydex_o2ring_longnight.csv`, 25,200 rows ≈ 7 h @ 1 Hz).

| stage | input (real scale) | main-realm median | verdict |
|---|---|---|---|
| `OxyDex.compute` | synthetic longnight, 25,200 rows | **196 ms** | healthy (cf. M1's 146 ms on a 26 k real night; the delta is input-characteristic — the synthetic night is desat-dense — not a regression) |
| `CpapEdf.readEDF` | real `BRP.edf`, 450 KB | **1.14 ms** | trivial |
| `runFusion` (all rules) | D=S=400 events (severe-OSA single night) | **3.8 ms** | linear at real scale |
| `runFusion` (all rules) | D=S=800 | **7.5 ms** | " |
| whole 17-night corpus | 265 desat + 657 surge events fused at once | **≈4–8 ms** | " |

**OxyDex calls each heavy analyzer exactly once** per compute (`computeDFA`/`computeSpO2FFT`/
`computeSpO2Autocorr`/`computeHRFreqBands`/`computeRespRateProxy` — one call-site each; static-verified) — no
redundant recompute. **CPAP EDF parse is trivial.** **Fusion is linear at every realistic scale.**

---

## Measured & DISMISSED — real code shapes that do NOT bite (do NOT "optimize")

- **`fuseApneaEvents`'s O(D×S) desat↔surge match loop** (`integrator-dsp.js:777-785`) is a genuine nested
  loop over sorted, time-bounded events — a textbook candidate for a linear windowed two-pointer sweep. **It
  does not bite.** Measured scaling: D=S=100 → 0.77 ms · 200 → 1.6 ms · 400 → 3.8 ms · 800 → 7.5 ms · 1600 →
  29.7 ms. The quadratic term only dominates past ~1600 events *of a single type in one fusion run*, but the
  **entire real 17-night trio corpus carries 265 desats and 657 surges** — so even fusing the whole corpus at
  once is ~4–8 ms. A linear rewrite would save single-digit ms on an input no user reaches. This is the
  OxyDex-SampEn lesson (2026-07-12) one layer over: an O(n²) that is capped by real n. **Not a finding.**
- **The Integrator re-fuses the whole `RECS` set on every ingest.** `recompute()` (`integrator-app.js:19`)
  runs `runFusion(RECS)` + `renderAll(RECS, FUSION)` over *all* loaded recordings, and it is called on every
  add/remove/clear. But a multi-file drop is **batched** — `readFiles` fires `recompute()` **once**, after all
  files in the drop are read (`integrator-app.js:80`, `if(--pending===0) recompute()`) — so a 39-file bulk load
  is **one** re-fusion, not 39. Only manual one-at-a-time adds re-fuse the accumulating set, and that is
  inherent to cross-night fusion (a new night must be fused against the prior ones) and costs the ~ms above.
  **Not a finding.**
- **CPAP EDF, OxyDex analyzers** — measured above, all healthy. The "bundle bloat" class stays empty (the
  three heaviest bundles are 0.49–1.05 MB, no CDN/fonts — as the 2026-07-12 pass already found).

## Confirmed still-good (no action)
- **Scoped gate runs work and are fast.** `node tests/run-tests.mjs --group=docs-ledger` = **0.27 s** (16
  assertions, `[FILTERED — not the full gate]`). A doc-only change does not need the full ~100 s suite — the
  SECTION-SCOPED-RUNS machinery (2026-07-01) is intact. (Meta-note: this very audit's sibling security pass
  ran the *full* suite for a docs-only change where `--group=docs-ledger,release-ledger` would have sufficed —
  a **usage** habit, not a tooling gap; the scope filter exists.)

---

## The real do-first — EXECUTE the existing backlog (not re-filed here)

A fresh pass one day after a thorough one correctly finds little new *to discover*. What remains is
**unexecuted**, already filed, and gated-ready. In priority order:

1. **`PPGDEX-PI-AND-PARSE-FOLLOWUPS-2026-07-12-BRIEF.md`** — PROPOSED. The residue of the C1/P1 PpgDex fix.
2. **`PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md`** — PROPOSED (its §3 already RETRACTED per M1; the rest
   stands).
3. **D3** (2026-07-12 findings) — the runner still prints a 169 KB red log that names the failure once on line
   1651; no FAILURES-recap / `--quiet` exists in `tests/run-tests.mjs` (verified this pass — 0 hits). This is
   the highest-value *unfiled* dev-loop item; it deserves its own brief.
4. **X1–X4** (2026-07-12 findings) — the doc-cost items. **X1 is still live:** `CLAUDE.md:223` still carries
   the stale *"gunzip each asset"* `manifestHash` definition (the gzip+UUID path was RETIRED 2026-07-03;
   `manifest-gate.js:44` agrees). X2 (index-status ≡ header-status gate), X3 (dead root-doc refs), X4
   (CONTRIBUTING drift) remain open.

**M1 is DONE** — `PROFILED-HOTSPOTS §3` was struck with the vm-realm caveat recorded in place. **C1/P1/G1/D1/D2
are DONE** (via `PPGDEX-PI-AND-PARSE` + `GATE-INTEGRITY-AND-DEVLOOP`).

## Hypotheses (labelled — a browser is needed to size these; not filed)
- **H-render — `renderAll` DOM rebuild on incremental adds.** `recompute()` rebuilds the whole Integrator DOM
  (timeline SVG + per-node cards + overlap report + the confirmed-event `<table>`) on each drop-batch. Fusion
  is cheap (measured); the *DOM* cost is unmeasured here (Node has no layout). For the realistic batched drop
  it is one rebuild, so likely a non-issue — but a user who adds nights one at a time triggers a full rebuild
  each time. **File only if a browser profile shows it bites** at a corpus a real user loads.
- **H1/H2 from 2026-07-12** (ECG parse GC; `Data Unifier`/`OverDex` inline `ppgdex-dsp` but not
  `ppgdex-morph`) remain open and un-re-investigated.

---

## Verdict
Lane B (app runtime) is **clean**, now including the fusion/longitudinal layer measured for the first time.
Lane A (dev-loop) has a real backlog, but it is **already discovered and filed** — running more audit passes
adds report cost without adding actionable value. **Execute the backlog above.** Nothing in this pass trades a
correct number for speed; nothing here needs a re-bundle.
