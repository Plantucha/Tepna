<!--
  ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-27 · **Created:** 2026-06-27 · **Follows:** SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md (ECGDex leg, node 3 of 4 — executed/DONE 2026-06-27) · **Sibling-of:** GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md · PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md · **Spawned:** ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md

# ECGDex Phase-9 — follow-ups (what surfaced executing the ECGDex node migration)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-inputs-
> then-re-bundle). Then the parent `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES` brief (§1 recipe, §4 error
> classes) and `PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` (the sibling — §1/§2 here are the ECGDex echo of a
> PpgDex one). This is the residue the ECGDex leg exposed. Nothing here blocks the ECGDex DONE stamp; all
> are follow-ups. The biggest (§1) is ECGDex-specific and worth a real decision.

## ✅ EXECUTION LOG — 2026-06-27 (both gates green)

Executed alongside `ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md` (a separate user-reported `detectPeaks`
bug; ONE shared `ECGDex.html` re-bundle carried both). `Dex-Test-Suite.html` all-green **1100 / 71**
(+3 groups); `verify-provenance.html` GATE A 8/8 + GATE B ECGDex reproducible; `ECGDex.html` re-bundled
external-JS-only `manifestHash 7c625af51078→bfa1aa934fcc` (buildHash `146ac9c8b1bd` UNCHANGED);
`BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated.

- **§1 — DECIDED → option (a), implementation DEFERRED (coordinated).** Direction chosen: carry the
  RICHER fields (`hrv.time`, `timeseries.epochs[].position`, `sleepStages`) on the orchestrate export,
  gated so the app's light Ganglior stream stays byte-identical. Implementation is **deferred to a
  joint ECG+PPG pass** because this brief MANDATES aligning with `PPGDEX-FOLLOWUPS §1`, which is still
  PROPOSED/undecided — landing ECGDex (a) unilaterally would risk diverging from the sibling. The
  device cross-checks (companion-bundle ingest, option (b)) are a larger adapter-boundary change, also
  deferred. **Safe to defer because §2 (below) PROVED the current light path degrades gracefully** (no
  crash, just reduced fusion). → `ECGDEX-FOLLOWUPS-II §1`.
- **§2 — DONE.** New gate `Integrator ingests the LIGHT ECGDex export gracefully` (`tests/dex-tests.js`
  group 12d): the light export (schema+recording+ganglior_events only) ingests via
  `adaptEnvelopeNode('ECGDex')` without throwing, `summary.rmssd/sdnn` are **null** (HRV consensus
  skipped, NOT a fabricated 0), `summary.posture` empty, and the surge/stage events still flow into
  fusion. (The branch already reads every rich field through `_dig`/null-guards — confirmed.)
- **§3 — DONE (confirmed, no consumer).** `_sec` is internal-only: STAMPED in `ecgdex-dsp.js`
  (`gangliorEvents`), consumed solely by the app's pre-export late-ACC re-stamp (`ecgdex-app.js:249`,
  BEFORE export), STRIPPED by both `ecgBuildNodeExport` and `buildV2`. No external Ganglior consumer
  keys on it, and `tests/dex-tests.js:1484` ALREADY asserts no `_sec` leak in the export. Closed.
- **§4 — DONE (structural form).** New gate `ECGDex event byte-shape` (`tests/dex-tests.js` group 12e):
  a deterministic overnight synthetic → `compute()` → asserts `autonomic_surge` carries `t` (HH:MM:SS)
  + `tMs` + a SEPARATE `sqi` axis (R7) + rich `meta`; `stage_*` carries `conf 0.7` / `sqi null` /
  `meta {}`; NO event leaks `_sec`; `tMs` ordering is monotonic; and the stream is byte-reproducible
  (determinism check — so a committed `env.equiv.ecgdex_events` byte-fixture WOULD reproduce). The
  stronger committed-fixture byte-diff form is the optional upgrade in `ECGDEX-FOLLOWUPS-II §4`.
- **§5 — DECIDED → keep the gated-static co-load list.** The conformance gate already makes a missed
  host a RED (the safety goal is met); the generation step touches critical load ORDERING in the host
  pages, so it is a deliberate pass best done before/with CPAPDex. → `ECGDEX-FOLLOWUPS-II §5`.
- **§6 · §7 · §8 — carried (standing debt).** Live-UI drop verification, full-overnight orchestrate
  perf cap, Node-CI (`node tests/run-tests.mjs`, no Node host this environment) → `ECGDEX-FOLLOWUPS-II`.

---

## 0 · What the ECGDex leg shipped (context)

`ecgdex-dsp.js` gained the namespaced surface `ECGDex.compute(SignalFrame(ecg)|rec|{text}) → ganglior.node-export`
+ the shared `ecgBuildNodeExport` (ecgdex-app.js `exportGanglior` now delegates to it → app/Unifier byte-identical).
`compute()` accepts the canonical **ecg SignalFrame whose `samples` is a SINGLE-channel Int16Array** (+ `fs/t0Ms`
on the frame — NOT PpgDex's packed multi-channel object, PPGDEX-FOLLOWUPS §8) that `signal-orchestrate.emitEcgNodeExport`
hands it — closing the §1/§4#2 compute()-shape gap **before** it could bite. R-peak detection runs **without the Web
Worker** (parent §2b): a NEW pure `parseECG(text)` headless parser (mirror of the app's streaming worker for the Polar
Sensor Logger `*_ECG.txt` `Phone timestamp;sensor ns;timestamp [ms];ecg [uV]` ~130 Hz layout, exposed as
`ECGDex.parseECG`) feeds `analyze()`'s in-process Pan-Tompkins detector. New `adapters/polar-h10-ecg.js` (raw
`*_ECG.txt` → `SignalFrame(ecg)`, wraps `ECGDex.parseECG` by reference; its `detect` on the `ecg [uV]` waveform header
/ `_ECG` filename returns 0.9–0.97 so it OUTRANKS `polar-rr`'s 0.6 on the shared Phone-timestamp column; device
`*_RR.txt`/`*_PPI.txt` still → PulseDex). `signal-spec.js` ecg resolver prefers `ECGDex`; `signal-orchestrate.js`
gained `ecgHost`/`emitEcgNodeExport` + the `emitNodeExport` `ecg` dispatch + the `nodeExportSummary` ECGDex case;
co-loaded in Data Unifier + OverDex (Dex-Test-Suite + both runners already had `ecgdex-dsp.js`). `env.ECGDex` +
`env.equiv.ecgdex` wired into BOTH runners + `tsconfig`. `ECGDex.html` re-bundled (external-JS-only: manifestHash
`89954db58d5c`→**`7c625af51078`**, buildHash `146ac9c8b1bd` UNCHANGED). NEW code-gated fixture
`uploads/ECGDex_2026-06-27_equiv.node-export.json` (compute({text}) on a real ~6-min Polar H10 `*_ECG.txt` clip →
0 events). Both gates green; Dex-Test-Suite all-green (1074/68). Floor + P12 round-trip + route-precedence + equivalence
cases added.

**Also closed in this leg (PpgDex-followup hardening items, by request):**
- **PPGDEX-FOLLOWUPS §10** — the GENERIC `adapter → SignalOrchestrate.emitNodeExport(frame) → schema-valid export`
  gate now exists (`Phase-9 generic adapter → emit → schema-valid export` group), covering EVERY registered
  signalType (rr·spo2·hrv·cgm·ppg·ecg). A registered signalType with neither a frame-provider nor an AUX exemption
  is a RED — so when CPAPDex registers its adapter, the next coder is FORCED to wire both a provider and the emit
  case; the compute()-shape trap cannot recur silently. `signal-orchestrate.js` is now co-loaded as a LIVE object
  in both test runners (was source-text-only).
- **PPGDEX-FOLLOWUPS §5** — NEW `dex-coload.js` single ordered source-of-truth manifest + a `Co-load manifest`
  gate asserting (a) it == the actually-registered adapter set (id === basename) and (b) every host realm
  (Data Unifier · OverDex · Dex-Test-Suite · run-tests.mjs) co-loads every module — a future miss is a RED, not a
  silent drop. Hosts keep static `<script>` tags (robust load order); a later pass MAY have them GENERATE the tags
  from the manifest (see §5 below).
- **PPGDEX-FOLLOWUPS §9** — the `polar-h10-ecg` ↔ `polar-rr` route precedence is now LOCKED by a committed
  property-metamorphic case (`*_ECG.txt` → `polar-h10-ecg`; `*_RR.txt` → an rr adapter).
- **PPGDEX-FOLLOWUPS §8** — honored: ECG uses the single-channel `{samples:Int16Array,fs}` frame, not the packed
  PPG object; R-peak detection runs without the Worker.

---

## 1 · ⚠ HIGHEST — the orchestrate ECGDex export is COMPANION-LESS + light: device cross-checks AND the rich payload absent (ECGDex-specific, mirror of PPGDEX-FOLLOWUPS §1)

**What surfaced.** ECGDex is fundamentally a **multi-file** node: the raw `*_ECG.txt` waveform PLUS companion device
`*_RR.txt` / `*_HR.txt` / `*_ACC.txt` (self-RR↔device-RR Malik validation, ECG-HR↔device-HR agreement, ACC
posture/gait + sleep-stage consensus — the app's `loadFiles` pairs them by stamp). But the adapter `parse(text, ctx)`
boundary takes **one text**, so `emitEcgNodeExport` runs `compute()` on the ECG waveform ALONE → `rec.deviceRR/HR/ACC`
are all null → **no device cross-validation, no posture/gait, no ACC sleep-stage consensus.** Compounding it,
`compute()` emits the **light** node-export (`recording` + `ganglior_events`), NOT the app's rich `buildV2`
(`hrv.time.{rmssd,sdnn}`, `frequency`, `morphology`, `sleepStages`, per-epoch `position`, the validation cards). So an
ECG file routed through the **Data Unifier / OverDex**:
- participates in the Integrator's **event-based apnea fusion** (CVHR `autonomic_surge` + `stage_*` ARE in
  `ganglior_events`) ✓,
- but gets **NO HRV consensus** (the Integrator's `adaptEnvelopeNode('ECGDex')` branch reads `summary`/`hrv.time
  .rmssd/sdnn` — absent from the light export),
- **NO posture series** (reads `timeseries.epochs[].position` / `_ecgPostureSeries` — absent),
- **NO device-RR/HR validation or morphology** context.

The app's own downloaded JSON (`buildV2`) still carries ALL of this — so the gap is specifically the *Unifier/OverDex
raw-file* path. This is the exact ECG analogue of PPGDEX-FOLLOWUPS §1 (and GLUCODEX-FOLLOWUPS §3): light export ⇒
reduced fusion. ECGDex is arguably the highest-value case because its posture + HRV-consensus + morphology are exactly
what the light export drops, and the Integrator already has a rich `ECGDex` ingest branch expecting them.

**Do (decision needed).** Pick one, deliberately — and align it with whatever PPGDEX-FOLLOWUPS §1 decides (same shape):
- **(a)** Teach `emitEcgNodeExport`/`ecgBuildNodeExport` to optionally carry the RICHER fields (`hrv.time`,
  `frequency`, `timeseries.epochs[].position`, `morphology`, `sleepStages`) from the `analyze()` result `r`, gated so
  the app's light Ganglior stream is unchanged — then the Integrator gets HRV consensus + posture from a Unifier-routed
  ECG file. Device cross-checks still need companions (next bullet).
- **(b)** A **companion-bundle ingest** mechanism so the adapter can receive the matched `*_RR/_HR/_ACC` files (the
  app's `loadFiles` already does the nearest-by-stamp pairing — lift it into a multi-file adapter entry, or pass
  siblings via `ctx`). Without this, the Unifier ECG path is permanently device-cross-check-blind.
- **(c)** Accept + DOCUMENT that the Unifier/OverDex ECG path is **event-only** (CVHR surges + stage transitions for
  apnea fusion), and that HRV-consensus/posture/morphology/device-validation require the app's JSON export. Cheapest;
  record it in the registry/export doc.

## 2 · Integrator `adaptEnvelopeNode('ECGDex')` ingest of the LIGHT export — UNVERIFIED (verification debt, mirrors PPGDEX-FOLLOWUPS §2)

This leg verified the **emit** side headlessly (adapter → frame → `emitEcgNodeExport` → schema-valid light export; the
generic §10 gate also asserts it). It did **NOT** drive `IntegratorDSP.adaptEnvelopeNode` on that light export. The
`node==='ECGDex'` branch reads `summary`/`hrv.time.rmssd/sdnn` (HRV consensus) + builds a posture series from
`timeseries.epochs[].position` — BOTH **absent** from the light export. **Do:** feed
`uploads/ECGDex_2026-06-27_equiv.node-export.json` to the Integrator and assert it ingests without throwing and
**degrades gracefully** (no rmssd → skips HRV consensus; no epochs → no posture; `ganglior_events` surges still feed
`fuseApneaEvents`). Ties into §1 — whatever §1 decides is what the Integrator consumes. Add to the Integrator fusion
test group if a seam exists.

## 3 · The light `exportGanglior` now STRIPS `_sec` — harmonization, confirm no consumer relied on it (LOW)

The shared `ecgBuildNodeExport` strips the internal `_sec` helper field that `gangliorEvents` stamps on
`autonomic_surge` events (for the app's late-ACC position re-stamp). The OLD `exportGanglior` emitted `r.events` raw,
so the light Ganglior download **leaked `_sec`**; the rich `buildV2` already stripped it. The new builder makes BOTH
exports consistent (no `_sec` leak) — a small correctness improvement, byte-identical otherwise. No committed fixture
or gate consumed the leaked `_sec`, and `_sec` is documented as "internal: stripped on export", so this is safe. **Do
(LOW):** a one-line confirmation that no external Ganglior consumer keyed on `_sec` (it never should have); then close.

## 4 · Equiv-fixture is 0-event → ECG impulse byte-shape (incl. `sqi` + `meta.position`) UNTESTED by the gate (test hardening, MEDIUM — mirrors PPGDEX-FOLLOWUPS §3)

The equiv fixture (real ~6-min clip) is not `longRec` and has no sustained CVHR oscillation train, so it emits **0**
`ganglior_events` — the byte-shape of ECGDex's impulses (`autonomic_surge` with `conf`/**`sqi`**/`meta.{ampBpm,periodSec,
position,osaLabel,...}`, and `stage_*` with `conf`/`sqi:null`) is **untested** by the equivalence gate (it byte-checks
only impulses actually present). NB ECGDex events carry a top-level **`sqi`** axis (separate from `conf`, R7) and a
rich `meta` — neither's round-trip is currently byte-checked. The floor emits surge events but is not byte-diffed
against a committed fixture. **Do:** add a purpose-built ECG input (a longer overnight clip, OR `genSynthetic({durSec:
≥2h})` rendered to `*_ECG.txt` with its built-in apnea/CVHR windows + a posture-bearing ACC companion if §1(a/b) lands)
→ wire `env.equiv.ecgdex_events` in both runners + a CASE that byte-checks the surge/stage event stream (t-string /
tMs / conf / sqi / meta / ordering). MEDIUM (the same coverage -VII §2 added for HRVDex/PulseDex).

## 5 · Co-load manifest is the SOURCE OF TRUTH but hosts still hand-list — the generation step is the real fix (maintainability, LOW — extends the §5 hardening just landed)

This leg built `dex-coload.js` + the conformance gate (PPGDEX-FOLLOWUPS §5), so a missed host add is now a RED instead
of a silent drop — the **safety** goal is met. But the hosts (`Data Unifier.html`, `OverDex.html`,
`Dex-Test-Suite.html`, `tests/run-tests.mjs`, `tsconfig.json`) still carry their adapter/DSP `<script>` tags / load
arrays **by hand** (the gate just checks they agree with the manifest). So adding CPAPDex is still a 5-site hand-edit —
only now a forgotten site fails the gate. The full reduction-to-one-edit needs the hosts to **GENERATE** their tags
from `dex-coload.js` (e.g. a tiny loader that `document.write`s the script tags in manifest order, and the runners
reading the manifest array). That touches load ORDERING in critical host pages, so it's a deliberate pass, not folded
into a node migration. **Do (LOW, before or with CPAPDex):** decide whether to take the generation step or keep the
gated-static-list (the gated list is robust and may be enough). Documented here so the next coder doesn't assume §5 is
fully "one edit" yet.

## 6 · Live UI drop-zone verification owed (standing debt, LOW — mirrors PPGDEX-FOLLOWUPS §6)

Everything proven this leg is **headless** (compute + equivalence + P12 + floor + generic emit). A real Polar H10
`*_ECG.txt` (+ companions) **dropped into the live Data Unifier / OverDex drop-zone** — routes to `polar-h10-ecg` →
`emitEcgNodeExport` → renders an ECGDex summary — was **not** exercised (the render-coverage rig is unrunnable in a
cross-origin preview sandbox, -VI §5; though the in-preview render-coverage ECGDex leg, which boots the bundle, IS
green). Carry forward with the OxyDex/GlucoDex/PpgDex live-drop debt. The headless path genuinely works (the §1 frame
contract + the generic emit gate), so this is confirmation, not discovery.

## 7 · Full-overnight `*_ECG.txt` perf on the orchestrate path (perf, LOW)

A real overnight `*_ECG.txt` is ~3–4 h @ 130 Hz (the committed `*_part01of05`…`05of05` set is ~1.7 M samples). The
equiv fixture is a 6-min clip (fast), but a Unifier/OverDex-dropped overnight ECG runs the FULL `analyze()` —
band-pass + Pan-Tompkins + whole-record Lomb–Scargle + DFA/SampEn (the latter already bounded to a 5-min representative
window, so NOT O(N²) on the full series) — which is O(N) but on millions of samples ≈ seconds, synchronously on the
main thread (the orchestrate path has no Worker — §2b). `rec.deviceACC` is null on the adapter path, so the heavy ACC
pipeline is skipped (lighter than the app). Pre-existing (the app streams in a Worker), but the orchestrate path makes
a multi-second synchronous analyze reachable on an arbitrary dropped overnight file. **Do (LOW):** if overnight ECG via
the Unifier matters, consider a sample cap / decimation guard for the orchestrate `compute()` path (the app keeps the
Worker). Inert for today's bounded callers (the fixture clip).

## 8 · Standing Node-CI debt — `node tests/run-tests.mjs` not run (carry forward, mirrors PPGDEX-FOLLOWUPS §7)

ECGDex was wired into `run-tests.mjs` (`env.ECGDex`, `equiv.ecgdex`, `adapters/polar-h10-ecg.js`, `signal-orchestrate.js`
+ `dex-coload.js` in the namespaced load array, `env.hosts`/`env.SignalOrchestrate`/`env.DexCoload`) but verified only
via the browser `Dex-Test-Suite.html` (no Node host in this environment). The Node path is unverified. Same standing
debt as PPGDEX-FOLLOWUPS §7 / GLUCODEX-FOLLOWUPS §8 / -IV §7. Not a blocker; run when a Node host is available.

---

### Priority summary
- **⚠ ECGDex-specific decision:** §1 (companion-less + light orchestrate export — device cross-checks + HRV-consensus +
  posture + morphology dropped; decide a/b/c, align with PPGDEX-FOLLOWUPS §1), §2 (Integrator `adaptEnvelopeNode('ECGDex')`
  ingest of the light export — verify graceful degradation).
- **⚠ before / with the CPAPDex leg:** §4 (event-byte coverage incl. the `sqi` axis + `meta` — purpose-built ECG input),
  §5 (decide whether to take the manifest-generation step or keep the gated-static list).
- **LOW / debt:** §3 (`_sec` strip confirmation), §6 (live UI drop), §7 (overnight `*_ECG.txt` orchestrate perf),
  §8 (Node-CI).
