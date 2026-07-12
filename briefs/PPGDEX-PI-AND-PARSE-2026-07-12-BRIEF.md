<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 · **Created:** 2026-07-12 · **Executes:** `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md` §C1 + §P1

# PpgDex — the perfusion-index trend was mostly `null`, and `parsePPG` parsed 190k stamps it never read

One PpgDex work-unit (both findings touch the same bundle lock): a **correctness fix** that happens to be
faster, and a **byte-identical** parse fix.

## §C1 — a fractional `Float32Array` index silently nulled the PI trend

`ppgdex-morph.js` stepped its sample loop by `winSamp = winSec * fs`. **`fs` is the median sensor-ns
delta, so on a real Polar capture it is never an integer** (176.26 → `winSamp` 10575.6). From the second
window on, `s0`/`s1` were fractional; indexing a `Float32Array` at a fractional index returns `undefined`,
so `dc`/`ac` went `NaN` and **`pi` silently became `null`**. No error, no warning — the surfaced
per-window perfusion-index trend (`ppgdex-app.js:290`) simply plotted the handful of windows where `w0`
happened to land on an integer.

**Measured, on real captures:**

| capture | fs | windows with a PI — before → after |
|---|---|---|
| `ppg-nights/n0611a.txt` | 176.26 | **1 / 2 → 2 / 2** |
| `ppg-nights/n0612a.txt` | 176.26 | **1 / 8 → 8 / 8** |
| `uploads/Polar_Sense_…_PPG.txt` (the equiv input) | 176.31 | **2 / 7 → 7 / 7** |

**The fix is deliberately surgical** — round **only** the sample bounds:

```js
const s0 = Math.round(w0), s1 = Math.min(raw.length, Math.round(w0 + winSamp));
```

`w0` stays a float for the peak-assignment comparisons above it, so **beat→window assignment is
untouched** and `pi` is the only value that moves. Proved, not assumed: hashing `analyze()` with `pi`
stripped gives an **identical digest before and after** on all three captures (`ai`, `ri`, `notch`,
`beats`, `riseTimeMs`, `tMin` all unchanged). It is also **2.24×** faster (`analyze` 173.8 → 77.5 ms) —
the fractional reads were taking V8's megamorphic slow path.

## §P1 — `parsePPG` parsed a timestamp per row for a value it never read

`ppgdex-dsp.js` called `parseTimestamp(p[0])` on **every one of ~190,000 rows**. Only the **first** stamp
is load-bearing (`t0Ms` + `offsetMin`); `lastTs` is read **only** by the degenerate `deltas.length <= 20`
fs fallback, which a real capture (190k valid ns deltas) never takes. `lastTs` is now resolved **lazily
inside that fallback**, by scanning backward for the last row the main loop would have accepted whose
stamp parses — **byte-identical to the eager version by construction**, and paid for only on the
degenerate path.

**Measured:** `parsePPG` **160.5 → 77.3 ms (2.08×)**; end-to-end `PpgDex.compute` **~1.4×**.
The volatile-stripped node-export hashes **identical** before/after on all three real inputs.

## ⛔ The audit's third finding was REJECTED — it would have broken PAT feasibility

`EFFICIENCY-AUDIT-FINDINGS-2026-07-12` also proposed the same treatment for `parseSensorXYZ`
(skip `parseTimestamp` when `relNs` is finite, ~600k dead calls on the ACC/GYRO companions, measured
2.08×). **Not taken.** `pat-feasibility-worker.js:117` reads `r.tMs` on exactly those rows
(`if (r.tMs == null) continue;`), and `relNs` is finite on every real file — so nulling `tMs` would make
`motionEnv` skip **every** row and silently return an all-zero grid. The audit verified byte-identity of
`PPGDSP.analyze()` but never checked that second consumer. The companion-parse win is real but needs a
back-compat-safe shape (an optional trailing param, per CLAUDE.md's "new params LAST + optional"); it is
**deferred, not dismissed** — see the follow-up brief.

## Gate impact — a `manifestHash` move, and NO fixture output moves

- `ppgdex-morph.js` → **PpgDex** only. `ppgdex-dsp.js` → **PpgDex · OverDex · Data Unifier**.
- Rebuilt with `node tools/build.mjs --all`: **only `PpgDex.html`'s `manifestHash` moved**
  (`0f3ad1433735` → `9fca0fa6de0a`); the other 7 provenance bundles hashed identically, re-confirming the
  build is deterministic.
- **No fixture OUTPUT moved.** `FIXTURE-PROVENANCE.json`'s diff is `manifestHash` lines **only** — zero
  `outputHash`, zero `inputHashes`. `pi` lives in the app's `morph.perWindow`, which the
  `ganglior.node-export` does not carry, so the committed exports are untouched and the equiv (GATE-C)
  leg stays green without regeneration.
- **`biome.json`:** `ppgdex-morph.js` added to the formatter-disabled `overrides`. It is a shipped bundle
  source that predates Biome and was simply never in the list — no PR had touched it since. Reflowing it
  (471 lines) would churn provenance and risk the format-sensitive source-text gates; the override list is
  the sanctioned on-touch escape hatch (CONTRIBUTING §B2). **The lint floor still runs on it.**

## The regression pin

New gate group **`PpgDex per-window PI — non-integer fs (fractional sample index)`**
(`ppgdex-morph · regression`). It drives `perWindowMorph` with a **deliberately non-integral `fs`
(176.26)** and asserts **every** window carries a finite, physiologic PI. Verified to actually pin the
bug: **6/6 against the fix, and 2 failing against the pre-fix code** (`got 1 · want 3`,
`win[1].pi=null`). An integer `fs` — the obvious thing to synthesise — passes even against the bug, which
is exactly why the old suite never caught this.

## Gates
Full suite **2113/2113, 135 groups** · GATE A **8/8** · GATE B **23/23 reproducible** ·
`build --check` **clean (10 owned, no drift)** · shard-union sound · build-core PASS · biome clean.
