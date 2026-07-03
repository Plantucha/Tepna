<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT (findings — report only; each accepted finding spawns its own dated gated brief) · **Created:** 2026-07-01 · **Charter:** `EFFICIENCY-AUDIT-PROMPT.md` · **Sibling-of:** `DEEP-AUDIT-FINDINGS-2026-07-01.md` (the correctness pass)

# Efficiency audit — findings (2026-07-01)

Run of `EFFICIENCY-AUDIT-PROMPT.md`. Two lanes kept strictly separate:
**A** = dev/agent-loop (incl. the class-0 token/context axis), **B** = app runtime.
Every finding carries a measurement at real full-night scale. **Report only** — no code
changed this pass; both gates were green going in and are untouched.

## Baseline (green — established before touching anything)
- **Behavior — `Dex-Test-Suite.html?full`:** `✓ all green · 1647 passed · 108 groups`; all
  **10/10** render-coverage rigs booted (`sameOriginStatus().bootSkips == []`, `__rcState==='done'`,
  `ok:true`). Wall-clock to settle from open: **~75 s** (rigs boot sequentially; count climbs 106→108).
- **Provenance — `verify-provenance.html`:** `__provenanceOK === true`, `__gateA_ok`/`__gateB_ok` both
  true (GATE A 8/8, GATE B code-gated). Settle: **~12 s**.

## Method / scale
Real overnight inputs in `uploads/`: the 10-part Polar H10 ECG (`…20260625_215300_ECG_part01…10of10`)
is **346,530 lines/part → ~3.46M samples ≈ 7.4 h @130 Hz**; the 15-part Verity PPG is ~7 MB; O2Ring
nights are ~28.8k samples @1 Hz. Lane B was traced end-to-end (parse → `analyze()` → export) with a
`performance.now()` probe at every stage on the ECG path (heaviest compute + the file the user was
viewing), driven through the live `ECGDSP` in `ECGDex.html`. Lane A was measured in tokens / files /
tool-round-trips / recurrence-counts over the doc corpus and the gate toolchain.

---

## LANE A — dev / agent-loop

### A1 · class 0 + 4 + 5 · **HIGH** — `DOCS-INDEX.md` is a 31k-token changelog, not an at-a-glance map
**Measurement.** `DOCS-INDEX.md` = **125,587 chars ≈ 31,397 tokens** across 233 lines (avg ~540
chars/line). The italic status parentheticals total **38,644 chars = 31 % of the file** (81 blocks);
the DONE-changelog subset alone is **33,100 chars = 26 %** (50 blocks, avg 662 chars, largest **2,582
chars** — the CPAPDEX-PHASE9 row). The file **exceeds the 25k single-read limit**, so loading the
"single entry path" the suite advertises costs **two paginated reads ≈ 31k tokens** — *more* than
reading `CLAUDE.md` (6.1k) + `ORIENTATION.md` (2.8k) + the 3–4 briefs a task actually needs, combined.
**Corpus context:** 173 root `*.md` ≈ 524k tokens; **81 DONE briefs at root**; `docs-archive/` holds
exactly **1** retired brief (correct per CLAUDE.md — files are NOT moved on status; the index is the
only navigation aid, which is precisely why its bloat hurts).

**Reproduction.** `read_file DOCS-INDEX.md` → "exceeds maximum allowed tokens (25000)"; the inline
parentheticals verifiably duplicate each brief's own header — e.g. `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28`,
`EXPORT-IDENTITY-FOLLOWUPS-IV-2026-06-29`, `PROVENANCE-NONDETERMINISM-2026-06-29` each carry the same
DONE narrative in their first-line `**Status:** DONE …` header (the "one home" CLAUDE.md mandates). The
completion story is therefore stored **twice**, at length, and the "dashboard" has become a second changelog.

**Proposed one gated change (→ its own brief).** Reduce each index row to *role + one-line status +
date + link*, and delete the inline execution narrative (it already lives, canonically, in each brief's
DONE header + body). Keep the at-a-glance status table CLAUDE.md asks for; move the changelog *out of
the view*. Projected: **~31k → ~21k tokens**, single-read restored, ~10k tokens saved on every orient.
**Gate impact:** docs-only — no re-bundle, no fixture, neither gate triggered.

### A2 · class 0 + 2 · **MED–HIGH** — the fast dev-loop toolchain is Node-only, so the agent re-derives "Node-CI debt" every brief
**Measurement.** The purpose-built fast-loop tools are **all Node-CLI-only**: `tests/check-dex.mjs`
(the "did I break one dex?" one-liner), `tests/reconcile-provenance.mjs` (the read-only reconcile
reporter that kills the ledger-dance figuring-out), `tests/verify-manifest.mjs`, `tests/run-tests.mjs`.
This authoring environment has **no Node host**, so none of them run here — and the cost shows up as a
*recurring, non-actionable* line re-litigated brief after brief. The "standing Node-CI debt" phrasing
recurs across the whole `SIGNAL-ADAPTER-FOLLOWUPS -IV §7 → -V §4 → -VI §3 → -VII → -VIII §2 → -IX §4 →
-X §4 → -XI §3 → -XII §3` chain **plus** `ECGDEX-FOLLOWUPS §8`, `PPGDEX-FOLLOWUPS §7`,
`GLUCODEX-FOLLOWUPS §8`, `GENERIC-EMIT-GATE-FOLLOWUPS-II §1`/`-III §4`, `COHESION-ROLLOUT`,
`SIGNAL-ADAPTER-PHASE9-REMAINING-NODES` — **≥15 briefs**, each spending a paragraph (sometimes a whole
`§`) re-explaining the identical "no Node host → discharge-by-equivalence → carry forward → tracked at
`-XII §3`". The resolution is *settled* (the browser suite runs the identical `tests/dex-tests.js`
superset) but never **canonicalized as a closing statement**, so every pass re-derives it.

**Reproduction.** `grep "Node-CI|no Node host|node tests/run-tests"` → hits in the chain above; each
DONE header repeats the discharge ritual. Corollary: the reconcile *dance* CLAUDE.md calls "the biggest
time/token sink in the re-bundle loop" is still hand-reasoned here, because its reporter
(`reconcile-provenance.mjs`) can't run — even though `verify-provenance.html` **already recomputes every
bundle's `manifestHash` statically in-browser and reads both ledgers** (it just doesn't *classify* the
delta or print the edit).

**Proposed one gated change (→ its own brief), two thin parts.**
(a) Write **one** canonical "environment reality + gate-equivalence" note (a short block in
`CONTRIBUTING.md` §4 / cross-linked from CLAUDE.md) that *closes* the item: in a no-Node-host
environment the browser gates ARE authoritative (`Dex-Test-Suite.html?full` + `verify-provenance.html`
run the identical assertions); `node tests/*.mjs` is a CI mirror, not agent-runnable; **do not re-file
per-brief "Node-CI debt."** Then delete the standing tracker's obligation to be re-cited.
(b) Add a **browser reconcile-reporter mode to `verify-provenance.html`** — reuse its existing static
`manifestHash` recompute + the shared `manifest-gate.js` `gateBEvaluate` to print the same
`RECONCILED / EXPORT-INERT / OUTPUT-MOVED` verdict + the exact BUILD-MANIFEST / FIXTURE-PROVENANCE edit
that `reconcile-provenance.mjs` emits, so the browser-only agent finally has the reconcile tool.
**Gate impact:** (a) docs-only; (b) `verify-provenance.html` is unbundled and touches neither gate —
read-only, never writes (honoring PROVENANCE-NONDETERMINISM §2/§4).

### Verified NOT a gap (checked per charter, no finding)
- **Scoped gate runs** are complete, incl. the browser tail: `Dex-Test-Suite.html?full&group=<f>` gates
  **which render-coverage rigs boot** via `rcWanted()`/`dexGroupMatcher` — each rig is behind
  `if(want(...))`, so a scoped run skips the ~30–50 s of booting unrelated app iframes. `check-dex.mjs`
  chains `run-tests --group` + `verify-manifest --bundle`. No un-scoped surface found. (Do-not-refile
  list honored.)
- **Reconcile figuring-out**, **render-coverage laziness**, **`parseTimestamp` duplication** — all as
  the charter's out-of-scope list describes; not re-filed.

---

## LANE B — app runtime (verdict: clean — measured, no new finding)

The compute + render paths are genuinely well-optimized; the many prior DSP perf briefs (SampEn caps,
whole-night entropy decimation, envelope-pyramid rendering) did their job. Measured on the heaviest path:

**End-to-end ECG trace (live `ECGDSP`, deterministic synthetic at real scale + one real file):**
| Stage | Input | Time |
|---|---|---|
| `genSynthetic` | 8 h @130 Hz = **3.74M samples** | 241 ms |
| `bandpass` | 1 h = 468k samples | 9 ms |
| `detectPeaks` (Pan-Tompkins) | 1 h = 468k samples | 22 ms |
| **`analyze()` full pipeline** (HRV · Poincaré · Lomb–Scargle · DFA · SampEn · CVHR · EDR · staging · SQI) | **8 h = 3.74M samples** | **760 ms** |
| `parseECG` (real Polar file) | **19.9 MB / 346,530 lines** (1 of 10 parts) | **73 ms** → ~730 ms/night |

So a full real overnight ECG is **~1.5 s of compute** (parse + analyze). Structural checks that back
this up:
- **All sample-scale passes are O(n)** with rolling accumulators — `ptFeature`'s moving-window
  integrate accumulates (no per-window rescan); `bandpass` is two O(n) IIR passes; `_seedScale` is a
  strided subsample. **No O(n·w).**
- The classic traps are absent: **bSQI two-detector agreement** uses a monotonic two-pointer (bounded
  inner scan), not `indexOf`-per-beat → O(n) not O(n·m); **`buildNN`** uses a fixed 11-beat window;
  the epoch-level `.filter`s (lines 1071–1703) run over ~100–160 five-minute epochs, not samples.
- **No redundant recompute (class 7):** `analyze()` runs **once per load** (`ecgdex-app.js:248` →
  stored in `RESULT`); a profile edit calls `reRenderProfile()` which re-renders only. Recording-switch
  reads the cached result.
- **Render is decimation-safe (class 10):** raw waveform draws a **min/max envelope pyramid** per pixel
  column (`ecgdex-render.js:196`), y-range from a strided scan (`step = N/40000`); GlucoScope decimates
  render-only. Entropy is **capped fleet-wide** — `pulsedex-dsp.js sampEn` `MAXN=20000`, `oxydex-dsp.js`
  `CAP 1000/800`, all whole-night-decimated (distribution-preserving).

**Already-filed, correctly LOW (NOT re-filed):** the ECG **orchestrate** path (`compute()` on
Unifier/OverDex) runs `analyze()` **synchronously** where the app itself streams in a Worker
(`ECGDEX-FOLLOWUPS §7` / `NODE-RESIDUE-FOLLOWUPS §1`, DEFERRED — "can't decimate an ECG waveform without
destroying QRS"). Measured `analyze() = 760 ms` for a full 8 h night confirms this is correctly LOW for
today's bounded orchestrate callers (the ~6-min equiv clip). The one adjacent cost worth naming: the
headless `parseECGText` materializes a full `split(/\r?\n/)` line-array (~17 MB transient/part) — fine
per-part, but if the orchestrate path ever concatenated all 10 parts (~200 MB) before parsing it would
spike; the app's Worker streams instead, so this only rides the same deferred orchestrate item.
(Also observed: fetching one 20 MB part took **~5 s** in this sandbox — I/O, environment-dependent, not
compute; the app's local FileReader path differs.)

---

## Do-first shortlist (ordered by severity × certainty)
1. **A1** — trim `DOCS-INDEX.md`'s inline changelog to role/status/date/link (docs-only, zero gate
   risk, ~10k tokens saved on every orientation, restores single-read). *Highest yield, lowest risk.*
2. **A2(a)** — one canonical "no-Node-host → browser gates are authoritative" statement to stop the
   ≥15-brief re-derivation of Node-CI debt (docs-only).
3. **A2(b)** — browser reconcile-reporter mode in `verify-provenance.html` (unbundled, read-only; gives
   the browser-only agent the reconcile tool that is Node-only today).
4. **Lane B** — no action. The deferred ECG-orchestrate perf cap stays correctly LOW; re-measure only if
   a real overnight `*_ECG.txt` is ever routed through Unifier/OverDex.

## Measured vs hypothesis
All findings above are **measured** (token counts, recurrence counts, `performance.now()` timings at
full-night scale). The only *hypothesis* is the orchestrate-path 200 MB concatenation spike (unproven —
the app streams; folded into the existing deferred item, not a standalone finding).
