<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF.md
---
Fix the PpgDex perfusion-index trend, which was silently `null` in most windows — and stop parsing 190k timestamps that were never read.

**The correctness fix (§C1).** `ppgdex-morph.js` stepped its sample loop by `winSamp = winSec * fs`, and
`fs` is the median sensor-ns delta — so on a real Polar capture it is **never** an integer (176.26 →
`winSamp` 10575.6). From the second window on, indexing a `Float32Array` at a fractional index returned
`undefined`, `dc`/`ac` went `NaN`, and **`pi` silently became `null`**. The surfaced per-window
perfusion-index trend was plotting only the windows where `w0` happened to land on an integer — measured
on real captures: **1/2, 1/8, and 2/7 windows** had a value. Now 2/2, 8/8, 7/7.

The fix rounds **only the sample bounds**; `w0` stays a float for the peak-assignment comparisons, so
beat→window assignment is untouched and `pi` is the only value that moves — **proved** by hashing
`analyze()` with `pi` stripped: identical digest before and after on all three real captures. It is also
**2.24×** faster (`analyze` 173.8 → 77.5 ms), because the fractional reads were taking V8's megamorphic
slow path.

**The parse fix (§P1, byte-identical).** `parsePPG` called `parseTimestamp` on **every one of ~190,000
rows**, but only the *first* stamp is load-bearing; `lastTs` is read only by the degenerate
`deltas.length <= 20` fs fallback that a real capture never takes. It is now resolved lazily inside that
fallback (scanning backward for the last accepted row whose stamp parses — identical by construction).
`parsePPG` **160.5 → 77.3 ms (2.08×)**; the volatile-stripped node-export hashes identical before/after.

**Rejected during execution:** the audit's third finding (the same treatment for `parseSensorXYZ`, a
measured 2.08× on the ACC/GYRO companions) **would have broken PAT feasibility** —
`pat-feasibility-worker.js:117` reads `r.tMs` on exactly those rows and `relNs` is finite on every real
file, so nulling `tMs` would make `motionEnv` skip every row and silently return an all-zero grid. The
audit had checked byte-identity of `PPGDSP.analyze()` but not that second consumer. Deferred to
`PPGDEX-PI-AND-PARSE-FOLLOWUPS-2026-07-12-BRIEF.md` §1 with a back-compat-safe shape.

**Regression pin:** a new gate group drives `perWindowMorph` with a deliberately **non-integral `fs`** and
asserts every window carries a finite PI — verified to fail against the pre-fix code (`got 1 · want 3`).
An integer `fs`, the obvious thing to synthesise, passes even against the bug; that is why the old suite
never caught it.

**Gate impact:** only `PpgDex.html`'s `manifestHash` moved (`0f3ad1433735` → `9fca0fa6de0a`); the other 7
provenance bundles hashed identically. **No fixture OUTPUT moved** — `FIXTURE-PROVENANCE.json`'s diff is
`manifestHash` lines only (`pi` lives in the app summary, which `ganglior.node-export` does not carry).
`biome.json` gains `ppgdex-morph.js` in the formatter-disabled overrides (a pre-Biome shipped source; the
lint floor still runs on it).
