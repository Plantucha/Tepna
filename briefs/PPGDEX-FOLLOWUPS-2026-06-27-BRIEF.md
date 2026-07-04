<!--
  PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (node-residue closeout — PPGDEX §2 Integrator LIGHT-PPG graceful-degradation gate EXECUTED (tests/dex-tests.js, 10/10) + §11 buildHash-doc trap RESOLVED (Phase-7 retirement + HANDOFF/INTEGRATOR-FUSION-ISSUES corrected); §6 live-drop + §7 Node-CI = fleet standing debt; residue → NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md; prior progress: §1(a) rich-export + §1(b) companion-ingest DONE 2026-06-27 — both gates green; §5/§8/§9/§10 done in the ECGDex leg; **§3 (sqi round-trip — FINDING: ppgBuildNodeExport DROPPED the sqi axis vs ECGDex; FIXED + byte-coverage group) + §4 (sampEn O(N²) cap) DONE 2026-06-30 — both gates green, PpgDex re-bundled 625a19d43e7e→13801a1ced0a**; §2, §6, §7, §11 open) · **Created:** 2026-06-27 · **Follows:** SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md (PpgDex leg, node 2 of 4 — executed/DONE 2026-06-27) · **Sibling-of:** GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md · **⚠ Coordinate-with:** ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md — execute §1 here JOINTLY with ECGDEX-FOLLOWUPS-II §2 (one shared rich-export shape; do NOT land one node's option (a) without the other). Read the handoff first.

# PpgDex Phase-9 — follow-ups (what surfaced executing the PpgDex node migration)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-inputs-
> then-re-bundle). Then the parent `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES` brief (§1 recipe, §4 error
> classes) and `GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md` (the sibling — several items here are the PpgDex
> echo of a GlucoDex one). This is the residue the PpgDex leg exposed. Nothing here blocks the PpgDex
> DONE stamp; all are follow-ups. The biggest (§1) is PpgDex-specific and worth a real decision.

## ✅ EXECUTION LOG — 2026-06-27 (§1 option (a), via ECG-PPG-FOLLOWUPS-HANDOFF §1; both gates green)

- **§1 (a) — DONE.** `ppgBuildNodeExport` gained an `opts.rich`-GATED block carrying the slice the
  Integrator's `adaptEnvelopeNode('PpgDex')` reads: `hrv.time.{rmssd,sdnn}` (single-site PPG → these ARE
  whole-record, the consensus axis directly), `hrv.frequency.lfhf`, `quality.analyzablePct`, and the
  limb-acc `timeseries.epochs[].position` grid (field math MIRRORS `ppgdex-app.js buildV2`). Only
  `signal-orchestrate.emitPpgNodeExport` passes `rich:true`; the app's `exportGanglior()` does NOT, so the
  LIGHT stream stays **BYTE-IDENTICAL**. Landed JOINTLY with `ECGDEX-FOLLOWUPS-II §2` under ONE shared
  rich-export shape (do-NOT-diverge mandate honoured — neither node's (a) landed without the other). New
  Dex-Test-Suite group *"Integrator ingests the RICH PpgDex export"* (the twin of the ECG group): default
  no-flag builder omits hrv/timeseries/quality; the rich export carries hrv.time + lfhf + quality +
  epochs[].position; `adaptEnvelopeNode('PpgDex')` now picks up `summary.rmssd/sdnn` non-null with
  `hrvWindow:wholeRecord`; an injected real posture wires to a `postureSource:limb-acc` series. PpgDex
  re-bundled external-JS-only `manifestHash c7c808bbb6a1→b6155e9b3cdb` (buildHash `fff8fe8b1b68` UNCHANGED);
  `BUILD-MANIFEST.json` GATE A + the `PpgDex_2026-06-27_equiv` `FIXTURE-PROVENANCE.json` manifestHash updated
  (LIGHT fixture export-inert → NOT regenerated). Dex-Test-Suite all-green **1119/71**; verify-provenance
  GATE A 8/8 + GATE B reproducible.
- **§1 (b) — DONE 2026-06-27 (companion-bundle ingest; both gates green).** The polar-sense-ppg adapter parses
  the host-paired `*_ACC/_GYRO/_MAGN/_PPI` sidecars from `ctx.companions` (via the existing PPGDSP
  `parseSensorXYZ`/`parseDevicePPI` — NO `ppgdex-dsp.js` change → NO PpgDex re-bundle) and attaches
  `frame.acc/gyro/magn/devicePPI`, so `compute()` runs the motion gate + limb posture (`epochs[].position`) +
  the device-PPI lane — filling the §1(a) scaffold. Pairing is ONE shared helper
  (`signal-orchestrate.pairCompanions`, both hosts call it); landed JOINTLY with ECGDEX-II §2(b) (same
  mechanism). New Dex-Test-Suite group 'Companion-bundle ingest'; all-green **1158/75**; verify-provenance
  clean. Discovered residue: the hosts still gate LIVE emit to rr/spo2/hrv (ppg/cgm/ecg not live-emitted) —
  pre-existing, broader than (b); see the handoff.
- **§1 (b)-prior note — superseded.** (The `epochs[].position` scaffold (a) added is now actually filled by (b).)
- **§2 · §3 · §4 · §6 · §7 · §11 — OPEN.** Integrator light-export graceful-degradation verify (the PPG twin
  of ECGDEX-I §2), `sqi`+impulse event-byte coverage, `sampEn` O(N²) cap, live-UI drop, Node-CI, `buildHash`
  doc fix — untouched this pass. (§5 · §8 · §9 · §10 were already executed in the ECGDex leg.)

## 0 · What the PpgDex leg shipped (context)

`ppgdex-dsp.js` gained the namespaced surface `PpgDex.compute(SignalFrame(ppg)|rec|{text}) → ganglior.node-export`
+ the shared `ppgBuildNodeExport` (ppgdex-app.js `exportGanglior` now delegates to it for the single-session
case → app/Unifier export byte-identical). `compute()` accepts the canonical **ppg SignalFrame whose `samples`
PACKS the multi-channel optical waveform** (`{ch:[F32×3],amb,relSec,n,durSec,length:n}`, typed arrays — PPG is
176 Hz so NOT per-sample objects; ECG-like `fs/t0Ms/offsetMin` on the frame) that `signal-orchestrate.emitPpgNodeExport`
hands it — closing the §1/§4#2 compute()-shape gap **before** it could bite (the `{text}` floor would have hidden it).
New `adapters/polar-sense-ppg.js` (raw `*_PPG.txt` → `SignalFrame(ppg)`, wraps `PpgDex.parsePPG` by reference;
its `detect` beats polar-rr's 0.6 "Phone timestamp" header match on a `*_PPG.txt` so `route()` never mis-sends
optical to PulseDex; device `*_PPI.txt` still routes to PulseDex as rr-family). `signal-spec.js` gained `ppg`
(samples, unit `au`); `signal-orchestrate.js` gained `ppgHost`/`emitPpgNodeExport` + the `emitNodeExport` `ppg`
dispatch + the `nodeExportSummary` PpgDex case; co-loaded in Data Unifier + OverDex (Dex-Test-Suite + both
runners already had `ppgdex-dsp.js`). `PpgDex.html` re-bundled (manifestHash `1fb306ea693f`→**`c7c808bbb6a1`**,
buildHash `fff8fe8b1b68` UNCHANGED). NEW code-gated fixture `uploads/PpgDex_2026-06-27_equiv.node-export.json`
(real 6.5-min Polar Verity Sense `*_PPG.txt` → 2 epochs, 0 events). Both gates green. Floor + P11 + equivalence
cases added.

---

## 1 · ⚠ HIGHEST — the orchestrate PpgDex export is COMPANION-LESS + light: motion gate, posture & device-PPI all absent (PpgDex-specific)

**What surfaced.** PpgDex is fundamentally a **multi-file** node: the raw `*_PPG.txt` waveform PLUS companion
`*_ACC.txt` / `*_GYRO.txt` / `*_MAGN.txt` (the motion gate + limb posture — *the signature feature*) and
`*_PPI.txt` (the device-PPI validation lane). But the adapter `parse(text, ctx)` boundary takes **one text**, so
`emitPpgNodeExport` runs `compute()` on the PPG waveform ALONE → `analyzeMotion` returns `hasData:false` →
**no motion rejection, no limb posture, no device-PPI agreement.** Compounding it, `compute()` emits the **light**
node-export (`recording` + `ganglior_events`), NOT the app's rich `buildV2` (`hrv.time.{rmssd,sdnn}`,
`timeseries.epochs[].position`, `morphology`, `validation`). So a PPG file routed through the **Data Unifier /
OverDex**:
- participates in the Integrator's **event-based apnea fusion** (autonomic surges ARE in `ganglior_events`) ✓,
- but gets **NO posture** (the `_ecgPostureSeries`/limb-acc fallback reads `summary.posture` / `timeseries.epochs[].position`, absent here),
- **NO HRV consensus** (`fuseHRVConsensus` needs `summary.rmssd/sdnn`, absent here),
- **NO motion-rejection / device-PPI quality** context.

The app's own downloaded JSON (`buildV2`) still carries ALL of this — so the gap is specifically the
*Unifier/OverDex raw-file* path. This is the PpgDex-sharpened version of GLUCODEX-FOLLOWUPS §3 (light export ⇒
reduced fusion), but worse because PpgDex's posture + HRV-consensus value is exactly what the light export drops.

**Do (decision needed).** Pick one, deliberately:
- **(a)** Teach `emitPpgNodeExport` to emit the RICHER export (have `ppgBuildNodeExport` optionally carry
  `hrv.time` + `timeseries.epochs[].position` from `r`, gated so the app's light Ganglior stream is unchanged) —
  then the Integrator gets HRV consensus from a Unifier-routed PPG file. Posture still needs companions (next bullet).
- **(b)** A **companion-bundle ingest** mechanism so the adapter can receive the matched `*_ACC/_GYRO/_MAGN/_PPI`
  files (the app's `loadFiles` already does the nearest-by-stamp pairing — lift that into a multi-file adapter
  entry, or pass siblings via `ctx`). Without this, the Unifier PPG path is permanently motion-blind.
- **(c)** Accept + DOCUMENT that the Unifier/OverDex PPG path is **event-only** (surges for apnea fusion), and
  that posture/HRV-consensus/morphology require the app's JSON export. Cheapest; record it in the registry/export doc.

## 2 · Integrator `adaptPpgDex` ingest of the LIGHT export — UNVERIFIED (verification debt, mirrors GlucoDex §3)

This leg verified the **emit** side headlessly (adapter → frame → `emitPpgNodeExport` → schema-valid light export).
It did **NOT** drive `IntegratorDSP.adaptEnvelopeNode` on that light export. `adaptEnvelopeNode` has a
`node==='PpgDex'` branch that reads `summary.rmssd/sdnn` + builds a posture series from `timeseries.epochs[].position`
— BOTH **absent** from the light export. **Do:** feed `uploads/PpgDex_2026-06-27_equiv.node-export.json` to the
Integrator and assert it ingests without throwing and **degrades gracefully** (no rmssd → skips HRV consensus; no
epochs → no posture; `ganglior_events` surges still feed `fuseApneaEvents`). Ties into §1 — whatever §1 decides is
what the Integrator consumes. Add to the Integrator fusion test group if a seam exists.

## 3 · Event-byte coverage misses every PPG impulse (test hardening, LOW — mirrors GlucoDex §6)

The equiv fixture (6.5-min real clip) emits **0** `ganglior_events`, so the byte-shape (`t`/`tMs`/`conf`/**`sqi`**/`meta`)
of PpgDex's three impulses — `hrv_drop`, `autonomic_surge`, `motion_artifact_segment` — is **untested** by the
equivalence gate (it byte-checks only impulses actually present; the SYNTH floor emits 1 event but is not byte-diffed
against a committed fixture). NB PpgDex events carry an extra **`sqi`** field the other nodes' events don't — that
field's round-trip is currently unchecked. If full per-impulse coverage is wanted (as -VII §2 did for HRVDex/PulseDex),
add a purpose-built PPG input (or a longer window with a planted ≥35% rMSSD drop + an ACC companion for a
`motion_artifact_segment`) → wire `env.equiv.ppgdex_events` in both runners + a CASE. LOW.

## 4 · `sampEn` is O(N²) and UN-capped on the headless/orchestrate path (perf, LOW)

`ppgdex-dsp.js sampEn(nn)` is O(beats²) with **no length cap** (unlike `pulsedex-dsp.js` which caps at `MAXN=20000`
with deterministic decimation, SYNTH-TEXTURE-FOLLOWUPS §2). `analyze()` calls it on the WHOLE corrected interval
series. For a short clip (the 6.5-min fixture = 430 beats) it's trivial (~185k ops, 214 ms total compute), but an
**overnight** `*_PPG.txt` (30k+ beats) routed through the Unifier/OverDex is ~10⁹ ops → it can hang the ingest.
Pre-existing (the app's `analyze` already does this), but the orchestrate path makes it reachable on an arbitrary
dropped file. Cap `sampEn` (mirror PulseDex's `MAXN` decimation — inert for today's bounded callers) before
overnight PPG ingest matters. LOW.

## 5 · Co-load list is now a 6-wide hand-sync — CENTRALIZE before the ECGDex/CPAPDex legs (maintainability, MEDIUM — escalation of GLUCODEX-FOLLOWUPS §7)

The PpgDex leg again hand-added `adapters/polar-sense-ppg.js` to **five** sites (`Data Unifier.html`, `OverDex.html`,
`Dex-Test-Suite.html`, `tests/run-tests.mjs`, `tsconfig.json`) and `ppgdex-dsp.js` to the two host realms. We are now
**2 of 4 nodes** deep with the same hand-sync GLUCODEX-FOLLOWUPS §7 already flagged. **Strongly recommend** extracting
a single ordered `dex-coload` manifest (one array of adapter + DSP module paths) that all hosts + both runners +
tsconfig read/generate from, **BEFORE the ECGDex leg** — otherwise ECGDex makes it a 7th hand-sync and CPAPDex an 8th,
and one miss silently drops a node from a surface (-IV §5). This is the same recommendation, now one node more urgent.

## 6 · Live UI drop-zone verification owed (standing debt, LOW — mirrors GlucoDex §4)

Everything proven this leg is **headless** (compute + equivalence + P11 + floor). A real Polar Verity Sense
`*_PPG.txt` (+ companions) **dropped into the live Data Unifier / OverDex drop-zone** — routes to `polar-sense-ppg`
→ `emitPpgNodeExport` → renders a PpgDex summary — was **not** exercised (the render-coverage rig is unrunnable in a
cross-origin preview sandbox, -VI §5). Carry forward with the OxyDex/GlucoDex live-drop debt. The headless path now
genuinely works (the §1 frame contract), so this is confirmation, not discovery.

## 7 · Standing Node-CI debt — `node tests/run-tests.mjs` not run (carry forward, mirrors GlucoDex §8)

PpgDex was wired into `run-tests.mjs` (`env.PpgDex`, the `equiv.ppgdex` pair, `adapters/polar-sense-ppg.js` in the
load array) but verified only via the browser `Dex-Test-Suite.html` + a headless `runDexTests(env)` spot-run (no Node
host in this environment). The Node path is unverified. Same standing debt as GlucoDex §8 / -IV §7 … -VIII §2. Not a
blocker; run when a Node host is available.

## 8 · Forward note for the ECGDex leg — do NOT copy PpgDex's packed-`samples` frame shape

PpgDex's `ppg` frame `samples` is a **structured object** packing 3 optical channels + ambient + `relSec` (multi-channel
@176 Hz — per-sample objects would be millions). **ECGDex is single-channel**: use the STANDARD `{samples:Float32Array,
fs, t0Ms}` shape that `signal-spec.ecg` already declares (`frameFields:['samples','fs','t0Ms','offsetMin']`) — do not
copy PpgDex's packed-object form. The §1/§4#2 compute()-shape contract still applies verbatim: `ECGDex.compute()` must
read `samples`+`fs` straight off the frame (not a node-private parser struct), AND must run R-peak detection **without
the Web Worker** (the co-load realm can't drive a Worker — call the pure detector directly), per parent §2b.

## 9 · No committed test guards the `polar-sense-ppg` ↔ `polar-rr` route precedence (test gap, MEDIUM)

The PpgDex `detect` is deliberately tuned to **outrank** `polar-rr` on a `*_PPG.txt`: ppg returns 0.97 (filename `_PPG`
+ vendor word) / 0.85 (filename `_PPG`) / 0.8 (the 6-column `channel 0;channel 1` header), vs `polar-rr`'s **0.6** for
ANY `Phone timestamp` / `sensor timestamp` header (a `*_PPG.txt` header carries that column too). So `route()` sends
optical to PpgDex while device `*_PPI.txt` / `*_RR.txt` still go to PulseDex. This was verified **by hand** this leg
(route precedence + `_RR`/`_PPI` non-hijack), but **no committed assertion locks it** — a future bump to `polar-rr`'s
header confidence, or a new rr-family vendor adapter, could silently hijack `*_PPG.txt` (the silent-misroute class
-IV §5 / the Integrator R2 "node silently becomes Unknown" warn about). **Do:** add a route-precedence CASE to the
property-metamorphic adapter group (where `SA.route` is already exercised for coospo/unknown): assert
`SA.route({name:'…_PPG.txt'}, ppgHeader).best.id === 'polar-sense-ppg'` AND `SA.route({name:'…_PPI.txt'}, …).best.id
=== 'polar-rr'`. Cheap, permanent, closes the regression window.

## 10 · The GENERIC adapter→emit→export gate (GLUCODEX-FOLLOWUPS §1b) is STILL unbuilt after 2 nodes — build it before CPAPDex (MEDIUM)

Both migrated nodes (GlucoDex P10, PpgDex P11) closed the compute()-shape trap with a **per-node** canonical-frame
round-trip (option **a**). That works, but it is N hand-written gates and the next coder must remember to write one for
ECGDex and again for CPAPDex. Option **(b)** — ONE generic group that, for **every registered adapter**, runs
`adapter.parse(syntheticInput) → frame → SignalOrchestrate.emitNodeExport(frame)` and asserts a schema-valid
`ganglior.node-export` — makes "the orchestrate emit path actually works for this signal type" a CHECKED, fleet-wide,
**by-construction** invariant: the gap then cannot recur silently for node 3 or 4. Each node's host shim
(`pulseHost`/`oxyHost`/`glucoHost`/`ppgHost`/…) is already resolvable in the test realm (co-loaded). **Strongly
recommended before the CPAPDex leg** — CPAPDex's EDF/flow frame is the most distinct (likely a new `SignalSpec` entry
+ `validateFrame` relaxation), i.e. the highest shape-mismatch risk, the one a generic gate protects best. Same
priority as §5 (co-load centralization); ideally do both in one pre-CPAPDex hardening pass.

## 11 · `buildHash` is documented as the `__bundler/template` hash but is actually the runtime inline-script/style fallback (doc inaccuracy, LOW)

Hit during this leg's re-bundle: the **static** `__bundler/template` hash of the new `PpgDex.html` (`9a13055ff4a4`)
does **NOT** equal the committed PpgDex `buildHash` (`fff8fe8b1b68`). The committed value is the **runtime**
`GangliorProvenance.buildHash()` — which, per CLAUDE.md, hashes the inline `<script>`/`<style>` bodies left in the
unpacked DOM (the `__bundler/template` script is `document.documentElement.replaceWith()`-stripped before
`ganglior-provenance.js` runs). So `BUILD-MANIFEST.json`'s `_doc` ("buildHash = SHA-256[0:12] of the immutable
`__bundler/template`") and `verify-provenance.html`'s **"buildHash (template)"** column label both describe a static
template hash that **nothing actually computes or commits** — a trap for the next coder, who could compute the static
template hash and "correct" BUILD-MANIFEST to a wrong value. No gate impact (GATE A checks only `manifestHash`;
`buildHash` is informational, read from the live helper), and CLAUDE.md documents the true behavior — but **fix the
`_doc` string + the column label** to "runtime inline-`<script>`/`<style>` fallback hash (NOT the template — stripped
at unpack)". Doc-only, LOW.

---

### Priority summary
- **⚠ PpgDex-specific decision:** §1 (companion-less + light orchestrate export — motion/posture/HRV-consensus dropped;
  decide a/b/c), §2 (Integrator ingest of the light export — verify graceful degradation).
- **⚠ before the ECGDex/CPAPDex legs:** §5 (centralize the now-6-wide co-load), §8 (ECGDex frame-shape forward note),
  §9 (lock the PPG↔RR route precedence with a test), §10 (build the GENERIC adapter→emit gate — still unbuilt after 2 nodes).
- **LOW / debt:** §3 (`sqi`+impulse byte coverage), §4 (`sampEn` O(N²) cap), §6 (live UI drop), §7 (Node-CI),
  §11 (`buildHash` doc inaccuracy).
