<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: none
---
Run the efficiency-audit charter — and retract `PROFILED-HOTSPOTS §3`, which was measured in a lying realm.

`audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md`, on a green baseline, real inputs at real scale. **The two
headline results are not speedups:**

- **C1 (HIGH, correctness).** `ppgdex-morph.js:140` steps a sample loop by a **non-integer stride**
  (`winSamp = winSec × fs`; `fs` comes from the median sensor-ns delta, so on a real Polar file it is
  *never* an integer). From the second window on, `raw[fractional]` → `undefined` → `NaN` → **`pi` is
  silently `null`**. The surfaced per-window **perfusion-index trend is plotting 2 of 18 points** on a real
  capture (independently reproduced on a second capture: 1 of 2). `Math.round`-ing the window bounds also
  removes V8's megamorphic slow path — `PPGDSP.analyze` **173.8 → 77.5 ms (2.24×)** — and leaves both
  code-gated PpgDex fixtures **byte-identical**. A wrong number on a user's screen, found by an efficiency
  audit; per `AUDIT-PROMPT.md` correctness outranks everything else here.
- **G1 (HIGH, gate integrity).** **CI runs a weaker gate than local.** The real recordings are gitignored,
  so on a fresh clone the real-input legs degrade to `⊘ SKIP` — neither pass nor fail. Local: 2107
  assertions / 2 skipped, GATE B **23/23**. Real CI: **2087 / 11 skipped, GATE B 10 reproducible + 13
  skipped**. And nothing pins the skip count (`grep skipBudget tests/` → 0 hits), so a *new* skip is
  invisible. This also hits the worktree that `CLAUDE.md` §👥 mandates — it checks out tracked files only.
- **M1 (HIGH, method) — `PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12` §3 is RETRACTED.** Its "`mean` = 28% of
  `PpgDex.compute()`, one-line fix" does **not** reproduce: implemented as specified, it measures **1.015×**
  end-to-end (347.4 → 342.3 ms on 1157 real beats); true self-time is **0.84%**. The number came from a
  profile taken inside `run-tests.mjs`'s contextified **Node `vm` sandbox**, where global lookups go through
  the context's interceptors and tight numeric loops inflate **non-uniformly** — measured distortion vs the
  main realm: `PulseDex.compute` **12.3×**, OxyDex 3.3×, PpgDex 2.6×. This is **§0 happening one rung up**:
  §0 said don't trust a synthetic benchmark, profile the real pipeline; the correction is *don't trust a
  profile taken in the test harness's vm realm either.* OxyDex's SampEn hot spot is the same artifact — do
  not "fix" it.

Also filed, measured: **P1** PpgDex runs `parseTimestamp` on all ~190k rows but only ever reads the first
(**`compute()` 2.01×**, byte-identical — land with C1 as one PpgDex work-unit) · **D1** the local gate is
still single-threaded (102 s; the same 4 shards forked = 28 s) · **D2** the two generated list files are
touched by 45% of commits with 10 merge-resolutions in 48 h, and a conflicted PR gets **no CI at all** (this
cost a real session a debug cycle) · **D3** a red gate prints 169 KB and names the failure once, on line
1651 of 2369 · **X1–X4** `CLAUDE.md`'s `manifestHash` definition is stale and self-contradicting, 4
DOCS-INDEX rows contradict their brief's header, 19 doc refs don't resolve (6 in `CLAUDE.md`).

**Measured and dismissed** (so nobody re-opens them): don't cache tsc / `npm ci` / Playwright — all
latency-neutral, `tests` is the only critical path and the repo is public; don't shard past 4 (≤16 s); the
bundle-bloat class is empty.

Docs only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded.
