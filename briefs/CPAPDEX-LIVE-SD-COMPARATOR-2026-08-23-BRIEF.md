<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-23

# CPAPDex live-vs-SD comparator — a permanent agreement surface

> Owner-ordered (2026-08-23, via the acquisition-hardening lead). **Design now; implement AFTER the
> CPAP P1/P3 ingestion wiring lands** so the two arms do not collide in `capture.py`/`cpap_stream.py`
> or in the CPAPDex bundle. This is a **Dex-side JS unit** — the full bundle chain applies (registry,
> badges, reference-guide row, equivalence fixture, `build.mjs`, provenance).

## 1 · The house pattern, applied to CPAP

Every Dex node that has two independent views of the same signal ships a permanent surface that
**compares them honestly**:

| node | view A | view B | surface |
|---|---|---|---|
| OxyDex | pleth-derived SpO₂ | device `.dat` oximetry | reference-free agreement |
| ECGDex | Pan–Tompkins RR (raw ECG) | firmware HR summary | `ecgdex-cross.js` |
| **CPAPDex (this brief)** | **BLE-live-captured EDF** | **device SD-card EDF** | **`cpapdex-cross.js` (extend)** |

The value is the same each time: a user (and the suite) can see whether the *cheap, live, restart-safe*
capture actually reproduces the *authoritative, logged* one — and exactly where it diverges.

## 2 · Why this is cheap — it is an ALIGNMENT + DIFF surface, not a new ingest

Two facts already hold on `main`, verified 2026-08-23:

- **The BLE writer deliberately emits the VENDOR `BRP.edf` format** (`capture-host/cpap_edf.py`
  `build_brp` → `_BRP_SPECS`: `Flow.40ms` in **L/s**, mask pressure in **cmH₂O**, 25 Hz). So the
  live file and the SD file are the *same format*.
- **CPAPDex's existing parser already opens both** — `cpapdex-edf.js`/`cpapdex-dsp.js` `readEDF()`
  feeds `buildSessionFromEdf` a set `{ BRP, PLD, SA2, EVE, CSL }`. No new parser.
- **`cpapdex-cross.js` and `cpapdex-coimport.js` already exist** — the cross-comparison home and the
  "find the pair by date" path are already there to extend.

So the whole unit is: *load two `readEDF()` results → align → diff → badge*. No ingest, no new format,
no new clock code.

## 3 · Surface shape

1. **Load.** User loads both EDFs, OR the **coimport path** (`cpapdex-coimport.js`) finds the pair by
   recording date (live + SD for the same night).
2. **Align on overlapping DEVICE-CLOCK minutes.** Both files carry the device's own EDF-header clock
   (`cpapdex-edf.parseEdfClock`, Clock-Contract-governed). Align on the overlapping wall-clock span;
   the device clock is the shared axis, not the host.
3. **Per-sample agreement** over the overlap, per channel (`Flow.40ms` L/s, mask pressure cmH₂O):
   - **Scale + offset regression** (the flow-unit pin generalized): fit `B ≈ a·A + b`; `a` near 1 and
     `b` near 0 is agreement, a drift in `a` is a scaling fault. Report `a`, `b`, residual SD.
   - **Bland–Altman residuals** — bias + limits of agreement — **NOT Pearson r.** Per
     `CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF.md` §(Pearson): *"Pearson r is the wrong statistic…
     the right instruments are Bland–Altman (bias + limits of agreement)"* — a flat, autocorrelated
     overnight signal makes r meaninglessly high. Same discipline `OXYDEX-PB-OVERCALL` applies to κ.
   - **Streamed-vs-logged divergence called out EXPLICITLY** — where the live capture dropped, stalled,
     or diverged from the logged truth is a first-class output (consumes the P3 gap-accounting:
     `cpap_ingest.GapCounters` on the live side), not smoothed away.

## 4 · Refusal-first (non-negotiable)

- **No overlap → a REASON STRING, never a fabricated comparison.** Two nights that do not share a
  device-clock span produce `{ ok:false, reason }`, not a zero-bias "agreement." Same honesty as the
  Clock Contract §2.6 (a missing value is visible, never invented) and `DexClock.hostAxis`'s refusal.
- **Only one file present → not a comparison.** Surface says so; it does not compare a file to itself.
- **Channels absent in one file** → per-channel refusal, not a global one.

## 5 · Evidence badges + registry (coverage mandate)

- Every surfaced number carries an evidence badge — the diff statistics (bias, LoA, scale `a`,
  residual SD, overlap minutes) enter **`CPAP_REGISTRY`** (`cpapdex-registry.js`) with **honest
  tiers: `measured`** for the direct diff stats (they are arithmetic over two measured files).
- Badge placement per `dex-badges.css` — corner for cards/KPIs, inline before the label in dense
  rows. The crossnight `*_DEFS` projection in `cpapdex-cross.js` mirrors the registry (gated by
  `registry-defs-parity`); the registry wins.
- A chart caption spanning two channels stays unbadged; **each series is badged** (the ratified
  caption rule).

## 6 · Fixtures + reference implementation

- **Today's manual pin is the reference implementation.** The Vigil box is running the live-vs-SD
  comparison now on the owner's order. Its script + the two EDF files become **the first committed
  fixture pair** (a BLE-live `BRP.edf` + the device SD `BRP.edf` for one night) and the reference the
  JS reproduces. **ACTION: request the script + files from the Vigil box session when its run lands.**
- The equivalence fixture pins `cpapCompare({BLE_edf}, {SD_edf}) ≡ committed export` (volatile-
  stripped), regenerated by **`tools/regen-cpap-goldens.mjs`** — CPAPDex already has its regen tool.
- Because the pair is a **committed** synthetic-or-real twin, CI re-runs it every push (the committed-
  input exemption in §🔏) — it cannot go stale unseen.

## 7 · Bundle chain (full Dex unit)

Implementation touches, in order: `cpapdex-cross.js` (the comparator core) + `cpapdex-coimport.js`
(pair-finding) + `cpapdex-registry.js` (new metrics) + `cpapdex-app.js`/`.src.html` (the surface) →
`CPAPDex Reference.html` row → `node tools/build.mjs --app CPAPDex` → equivalence fixture via
`regen-cpap-goldens.mjs` → `verify-fixtures` → `npm run check`. Standard gates (`Dex-Test-Suite.html`
all-green incl. the CPAPDex equiv leg, `verify-provenance.html` clean).

## 8 · Sequencing & dependencies

- **Implement AFTER the CPAP P1/P3 ingestion wiring** (the single announced `capture.py`/
  `cpap_stream.py` touch, itself after the Vigil box controller-race fix). The comparator consumes
  P3's `GapCounters` for the streamed-vs-logged divergence, so P3 landing first is a real dependency,
  not only a collision-avoidance.
- **Needs the fixture pair** from the Vigil box manual pin (§6).
- No contract change: `ganglior.node-export` untouched; this is an additive CPAPDex surface + metrics
  (MINOR at most under §📦, likely folded into the CPAP hardening line).

## Done when

- [ ] `cpapdex-cross.js` exposes `cpapCompare(setA, setB)` → per-channel `{ scale:{a,b,residSD},
      blandAltman:{bias,loLoA,hiLoA}, overlapMin, divergence, ok }` | `{ ok:false, reason }`.
- [ ] Coimport finds the BLE/SD pair by device-clock date; manual two-file load also works.
- [ ] Alignment is on device-clock minutes; viewer-timezone-independent (Clock Contract §5).
- [ ] Bland–Altman + scale regression only; **no Pearson r anywhere** in the surface.
- [ ] Streamed-vs-logged divergence surfaced explicitly from `cpap_ingest.GapCounters`.
- [ ] No-overlap / single-file / missing-channel each refuse with a reason string; a decoy asserts it.
- [ ] Every surfaced number badged; new metrics in `CPAP_REGISTRY` at `measured`; `registry-defs-parity`
      + `cohesion-badges` green.
- [ ] Committed fixture pair (from the Vigil box pin) + equiv leg via `regen-cpap-goldens.mjs`;
      `verify-provenance` clean; `npm run check` green.
- [ ] Reference-guide row added; `docs-ledger` green.

## Open questions (to the lead)

1. **Where does the surface live** — a new tab in CPAPDex, or a panel under the existing cross view?
   (Defaulting to a panel in the cross surface, mirroring `ecgdex-cross`.)
2. **PLD/SA2 channels too, or BRP-only for v1?** BRP (flow+pressure) is the load-bearing pair; SA2
   (oximetry) would tie into the SA2 brief's own agenda. Proposing **BRP-only v1**, SA2 as a follow-up.
3. **Divergence granularity** — per-minute divergence series, or a single session-level gap summary?
   Proposing both: a session KPI + a per-minute series, each badged.
