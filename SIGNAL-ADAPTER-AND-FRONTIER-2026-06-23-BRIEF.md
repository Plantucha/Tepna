<!--
  SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 · **Created:** 2026-06-23 (Phases 0–10 all executed for the current 8-bundle fleet; Phase 9 per-node migration completed via the `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES` + per-node followup briefs, and stays the standing protocol for any NEW node). **Phase 7 DONE (2026-06-30) — content-addressed provenance:** `verify-provenance.html` is now a PURE-STATIC gate — it fetches each bundle FILE + the two ledgers and hashes them; it no longer boots any bundle in an iframe and reads **no `buildHash`** (no runtime race, host-independent). GATE A is unchanged (`manifestHash` vs `BUILD-MANIFEST.json`). GATE B REPLACED the coarse runtime-`buildHash` fixture check with a content-addressed KNOWN-ANSWER ledger: each `FIXTURE-PROVENANCE.json` record became `{ bundle, manifestHash, inputHashes, outputHash }` = `hash(input) + executed-code manifestHash → hash(output)`, reds the moment the code, an input, OR the output changes (shared core `manifest-gate.js` `gateBEvaluate`/`gateBFiles`/`sha16`, byte-shared with the Node sibling `tests/verify-manifest.mjs`, which now runs GATE A + best-effort GATE B). The 2 historical Integrator fusions came IN as `historical:true` byte-pinned records, RETIRING the old `verify-provenance` `LEGACY_FIXTURES` buildHash-fallback list (the sidecar `fixtures` keys ARE the audited set). `buildHash` is retired fleet-wide as a provenance signal — still stamped into exports by the bundled `ganglior-provenance.js` as inert legacy metadata, NOT re-bundled away (that would churn every fixture for zero gate value); the 400-word "buildHash-is-a-lie" caveat is GONE from `CLAUDE.md`/`CONTRIBUTING.md`. **TEST/LEDGER/DOC pass — ZERO app re-bundle** (manifestHash unchanged on all 8): the brief's "forces re-bundling all apps + regenerating fixtures" cost estimate predated `PROVENANCE-NONDETERMINISM-2026-06-29 §1`, which had already moved the honest executed-code hash (`manifestHash`) to a deterministic STATIC computation — so Phase 7 needed no inliner / `ganglior-provenance.js` surgery, only the gate page + ledgers + shared cores + tests + docs. Gates GREEN: `verify-provenance.html` GATE A 8/8 + GATE B 15/15 (13 code-gated reproducible + 2 historical byte-pinned), teeth verified (synthetic code/input/output drift each reds); `Dex-Test-Suite.html` all-green (1560/99). Residue → `SIGNAL-ADAPTER-FOLLOWUPS-PROVENANCE-2026-06-30-BRIEF.md`. **Phase 10 DONE (2026-06-24):** OverDex capstone shipped — `OverDex.html` (unbundled) walks a dropped folder (`overdex-walk.js`: recursive `webkitGetAsEntry` + `webkitdirectory` folder-pick, junk-filtered, relPath-tagged), routes every file via the SAME public `SignalAdapters.route()` engine, runs raw RR through the shared `signal-orchestrate.js` (the isolated-PulseDex host + `emitRRNodeExport`, **EXTRACTED verbatim** from `data-unifier-app.js` so OverDex reuses it — NOT a second copy; the SIGNAL-ADAPTER-FOLLOWUPS §1 PulseDex-internals reach-in now lives in ONE module), passes already-exported `*_ganglior.json` straight through, and fuses everything via the public `IntegratorDSP` seam (`normalizeFile → dedupeRecs → runFusion → buildFusionExport`). 🔒 Independence invariant held: no node imports OverDex, OverDex imports no node internals, delete it and every node + the Integrator stay byte-identical. Proven end-to-end (synthetic Polar `_RR.txt` → live PulseDex export + real `uploads/ecgdex-2026-06-12.node-export.json` passthrough + an unknown file correctly set aside → one `ganglior.fusion-export`: 9.6 min overlap, HRV-consensus block fired, kernel-audit clean). **Zero gate cost** — new unbundled tool; the `data-unifier-app.js`/`Data Unifier.html` edits are unbundled UI the test suite does not import (grep-confirmed). The spine — CORE adapter layer, the unbundled Data Unifier with Polar + Coospo RR adapters, the property/metamorphic test group, the DSP-purity gate, the fusion-algebra law group, units-as-quantities `quantity.js` with the **Baevsky ms-vs-s unit guard**, AND the differential ECGDex↔PpgDex HRV oracle (which surfaced — and then DROVE THE FIX of — a real cross-node finding: SDNN used inconsistent estimators, PpgDex/HRVDex sample ÷N−1 vs ECGDex/PulseDex population ÷N; **unified fleet-wide to sample SD ÷N−1 (HRV Task Force / Kubios)** — PulseDex+ECGDex `std()` changed, both re-bundled, Dex-Test-Suite green 848/60, verify-provenance GATE A re-passed, BUILD-MANIFEST updated). Phase 4a JSDoc `@typedef`s added to CORE (the tsc `--checkJs` CI step itself is still open). **Phase 3 DONE:** `codegen/dex-registry-gen.js` projects a `<node>-registry.js` from one manifest (Phase-3 manifest additions `evidence`+`goodDirection`), AND `codegen/dex-gen.js` now projects a **cohesion-compliant reference guide** from the SAME manifest (links `dex-badges.css`, renders an `ev-corner ev-<tier>` badge per metric from `evidence` + an evidence legend strip; also fixed a latent misplaced-shebang syntax error that blocked `node dex-gen.js`). Proven end-to-end on `eegdex.manifest.json` → `codegen/generated/eegdex-registry.js` + `codegen/generated/eegdex-reference.html` (10 metrics, all 5 grades, label round-trip 10/10, 10 cards ↔ 10 badges grade-agree), and **EEGDex is now wired through the shared `cohesion-badges` group in BOTH runners** (`tests/run-tests.mjs` + `Dex-Test-Suite.html`: generated registry loaded into `env`, generated guide fetched as `EEGDex Reference.html`) — the gate now proves manifest→registry→guide single-source by construction. Existing 7 hand-written registries untouched (forward-first). `Dex-Test-Suite.html` all-green (848/60 fully settled), **zero gate cost** for everything except the SDNN re-bundle (gated, passed). Phases 7, 9, 10 remain.) · **Created:** 2026-06-23

# Signal-Adapter Layer + Frontier Hardening — build brief

> **Read `CLAUDE.md` first — it wins on every conflict** (the two gates, the Clock Contract,
> the frozen `Ganglior`/`fascia` names, edit-inputs-then-re-bundle). Then `ARCHITECTURE-PRINCIPLES.md`
> (the three-layer model + forward-first migration) and `LEXICON.md` (naming a new node). This brief
> is **forward-first**: new code is born compliant; **no existing node is rewritten in a sweep**. Every
> phase below states its **gate cost** so you can sequence the zero-risk work first.

---

## 0 · Why this brief exists (the thesis)

The suite scales *nodes* beautifully — nodes never import each other, they converge only through the
`ganglior.node-export` contract, and the Integrator fuses exports. That seam is correct and untouched
here.

The suite scales *vendors* badly. **Parsing a vendor's file** and **computing metrics from a signal**
are fused inside each node. The roadmap (EEGDex, SpiroDex, UltrahumanDex, and a cross-vendor "data
unifier" for Coospo / Wahoo / Garmin / Ultrahuman / etc.) is mostly **new vendors for signals we
already analyze**, plus **two genuinely new signal types** — note the split: **EEGDex** (EEG) and
**SpiroDex** (flow-volume) introduce signals nothing in the suite computes yet, so they still need
*real new DSP*; the adapter layer standardizes their **ingest**, it does not remove the per-signal
math. **UltrahumanDex** and Coospo are the pure adapter wins — Ultrahuman exports CGM-/HRV-like data
the suite already analyzes, and Coospo is the same RR/ECG as the Polar H10. Under today's design,
adding the Coospo chest strap can touch **multiple nodes** — a raw-ECG export feeds `ecgdex-dsp.js`, an
RR-interval export feeds `pulsedex-dsp.js` (and, summarized, `hrvdex-dsp.js`) — and vendor-format
knowledge has **no shared home**: each node carries its own `classify*()` + format regexes, and
overlapping-signal nodes duplicate both the ingest *and* the HRV math. So onboarding one vendor can
mean separate edits across several nodes. That growth is **vendors × consuming-nodes** — combinatorial,
and exactly the axis we're about to stress.

**The fix is one new layer below DSP: a registered vendor-adapter layer that emits a canonical
`SignalFrame`.** A signal (RR, ECG, SpO₂, CGM, EEG, flow-volume) can come from *many* vendors; an
adapter normalizes one vendor format → one `SignalFrame`; DSP only ever sees a `SignalFrame` of its
declared signal type. New vendor = one new adapter file. New node = consume an existing `SignalFrame`
type. That converts **vendors × nodes** into **vendors + nodes**.

The "data unifier" is then **not a new product** — it is the adapter registry given a drop-zone UI.

**⚠ Scope of the win (read before promising too much).** The adapter layer is delivered **through the
unifier as a universal ingest front-door** — drop any vendor's file, get a `SignalFrame`, optionally an
emitted `ganglior.node-export` for the Integrator. It does **not** retroactively teach a *sealed* node
bundle a new vendor: adding a Coospo adapter makes Coospo work **in the unifier**, not inside
`PulseDex.html`, until that node is migrated to consume `SignalFrame`s (Phase 9, per-node, gated,
expensive). The realistic near-term picture: the **unifier becomes the one place new vendors land**
(cheap — one file each) and feeds fusion, while the per-node apps keep their own ingest until each is
opportunistically migrated. That is still a large win — it stops every *new* vendor from forcing node
edits — but it is a front-door win, not an instant whole-suite retrofit. Say so to stakeholders.

This brief also folds in the **frontier hardening** that makes the system more durable *and* more
AI-legible: property/metamorphic testing, differential testing across the redundant RR nodes,
manifest-as-single-source, machine-checked contracts (no build-step shipped), content-addressed
provenance, units-as-quantities, and a small proven fusion algebra. Each is optional and independently
shippable; phases 0–2 deliver the adapter spine and pay **zero** gate cost.

---

## 1 · Current state — grounded analysis (what's right, what duplicates)

**Keep verbatim (do not "refactor"):**
- **The cross-node seam.** `integrator-dsp.js` consumes `ganglior.node-export` JSON (+ the `fascia`
  back-compat alias via `BUS_ALIASES`); nodes never import each other. Acyclic, correct.
- **The evidence ladder + per-node registry** (`*-registry.js`) as the truth source; non-hue disc
  badges; the `cohesion-badges` test that asserts registry ≡ `dex-badges.css` ≡ reference guide.
- **The Clock Contract** (floating wall-clock `tMs`, `getUTC*` readout). The *model* is correct for
  zone-less consumer devices; only its *delivery* (copy-pasted into every DSP) is a smell we address
  carefully, never by violating the contract.
- **The test architecture.** One assertion library (`tests/dex-tests.js`), two runners
  (`node tests/run-tests.mjs` CI gate + `Dex-Test-Suite.html` browser render-coverage), real source
  loaded into a `node:vm` with shims (not copies), fixtures cut from real exports in
  `tests/fixtures/`. This is genuinely good; we extend it, never replace it.
- **The content-hash kernel.** `kernel-constants.js` → `DexKernel.HASH` (FNV-1a over VERSION +
  constants), loaded first everywhere, stamped into exports to catch cross-deployment constant drift.
- **100 % local, single-file, no CDN, system fonts, offline reproducible.** The moat. Every change
  here preserves it.

**The duplication we are removing (evidence in-tree):**
- **Parsing is partly pure, partly entangled — know which is which (verified in-tree).**
  *Clean to reuse by reference:* `pulsedex-dsp.js → parseRRInput(raw)` is DOM-free and returns
  `{ vals, t0Ms, offsetMin, tsMs, sourceFormat, intervalCol, nRaw, nUsable, usable, reason }` — a
  `SignalFrame` in all but name; the **namespaced** modules `GLUDSP` (GlucoDex), `ECGDSP`, `PPGDSP`
  expose their parse surface on a single global object; the ECGDex worker parses in isolation.
  *Entangled — do NOT just `<script>`-include:* `oxydex-dsp.js` wires file-input/drag listeners **at
  module top level** (`ua.addEventListener(...)` with **no null-guard** → it *throws* if loaded into a
  page without `#uploadArea`), and `hrvdex-dsp.js` mutates the DOM + `localStorage` inside
  `commitRows()`/`_hrvRefreshChrome()`/`getFilteredRows()`/`persistHRVRows()`. So "the hard extraction
  is done" is true for the RR/CGM/PPG parsers, **not** for OxyDex/HRVDex — those need their pure parser
  factored out (or DOM stubs) before an adapter can call them. See the Phase-1 isolation note.
- **Bare globals collide across nodes.** PulseDex, OxyDex, and HRVDex expose **no namespace object** —
  their parsers (`parseRRInput`, `parseCSV`, `parseTimestamp`, `mean`, `std`, `allRows`, …) are bare
  globals sharing page scope. Loading two such DSP files into one page (e.g. the unifier) **collides**
  — the exact `const`-collision hazard `CLAUDE.md` warns about. Only the namespaced modules
  (`GLUDSP`/`ECGDSP`/`PPGDSP`) are safe to co-load. This constrains how the unifier reuses parsers
  (Phase 1).
- **Vendor sniffing is buried in nodes.** `ecgdex-app.js → classifyECG(name)` is a tiny pure filename
  classifier; `loadFiles()` only orchestrates DOM/worker and delegates parse downward. Each node has
  its own `classify*()` + its own format regexes. There is **no shared vendor registry**.
- **`parseTimestamp` is copy-pasted into every `*-dsp.js` and `integrator-dsp.js`** — sanctioned today
  by the Clock Contract (bundle isolation), but it means a vendor *date format* is restated per node
  instead of being an adapter property.
- **Metric facts live in up to FOUR places (node-dependent) — the registry should be the only one.**
  A metric's `label`/`unit`/`goodDirection`/`evidence` can appear in: (1) `*-registry.js` — canonical,
  test-backed; (2) the node's **`*-cross.js`** metric-def block (`OXY_DEFS`, `CPAP_DEFS`, ECGDex's
  `METRICS[]`, …) that makes the cross-night envelope self-describing — **but only for nodes that HAVE a
  `*-cross.js`** (ECGDex/PpgDex/PulseDex/OxyDex/CPAPDex; HRVDex & GlucoDex may not); (3) the
  reference-guide HTML; and (4) **for the ~6 fusion-surfaced metrics only** (`odi4, minSpo2, rmssd,
  sdnn, glucoseCV, residualAHI`) the Integrator's static `GRADE_MIRROR`/`GRADE_SOURCES` fallback —
  because the Integrator bundle deliberately does **not** load node registries. Tests assert the copies
  agree (`cohesion-badges` across 7 reference guides; `Integrator evidence-grade mirror ≡ node
  registries`); the fix is one source + generated projections (Phase 3).
- **DSP/UI purity is aspirational, not enforced.** `hrvdex-dsp.js` mutates the DOM inside the file
  that is supposed to be headless: `commitRows()` sets `document.getElementById('uploadZone')…` and
  `_hrvRefreshChrome()` writes `innerHTML` + the export bar, and it persists to `localStorage`. The
  principle (`ARCHITECTURE-PRINCIPLES §1`) is right; it just isn't checked (Phase 4b).
- **The codegen is a docs-quarry, not a node generator.** `codegen/dex-gen.js` emits only the
  reference HTML; its README lists the gaps (no Clock Contract, CPAP-shaped `prepare()`, single
  synthetic generator, wrong runtime shape — a single `analysis.js` instead of `dsp/render/app`).
- **Provenance's `buildHash` is a coarse proxy** (per `CLAUDE.md`): it moves only on inline-
  `<script>`/`<style>` edits, not on external-JS, shared-module, or markup changes. The real signal is
  `manifestHash` (static), patched around with `BUILD-MANIFEST.json` GATE A + a `FIXTURE-PROVENANCE.json`
  sidecar GATE B. Phase 7 replaces the proxy with an honest content-addressed result.

---

## 2 · Target architecture

### 2.1 The fourth layer

```
vendor file ─▶ [ INGEST: detect + parse vendor format ] ─▶ SignalFrame ─▶ [ DSP: canonical → metrics ] ─▶ UI / export
                 (adapters, registered, by signal type)      (typed)        (one signal, no vendor logic)
```

Dependency direction stays downhill: **UI → DSP → INGEST → CORE.** INGEST never touches the DOM and
never imports a node's UI. DSP stops importing vendor formats entirely.

### 2.2 `SignalFrame` — the canonical intermediate (new CORE type)

The **only** thing DSP consumes. Clock-Contract-normalized, signal-typed, provenance-stamped.

```jsonc
{
  "signalType": "rr",                 // one of SignalSpec keys: rr | ecg | spo2 | cgm | eeg | flow | hr | acc
  "kind":       "intervals",          // "intervals" | "samples"
  "intervals":  [812, 798, ...],      // ms — present when kind="intervals" (RR/PPI)
  "samples":    null,                  // Float32Array — present when kind="samples" (ECG/SpO2/CGM/EEG)
  "fs":         null,                  // Hz — required for kind="samples", null for intervals
  "t0Ms":       1718...,              // floating wall-clock ms of first valid sample (Clock Contract)
  "offsetMin":  null,                 // minutes east of UTC, or null (no zone in source)
  "tsMs":       [...] | null,          // per-sample/interval absolute floating ms when the vendor stamped them
  "sqi":        null,                 // 0..1 signal-quality, or null (quality-neutral) — NEVER folded into conf
  "usable":     true,
  "reason":     null,                 // human string when usable=false (mirror parseRRInput's honesty)
  "provenance": {                     // self-describing, audit-first
    "adapter":  "polar-rr",
    "vendor":   "Polar (Polar Sensor Logger)",
    "device":   "Verity Sense",
    "files":    ["...RR.txt"],
    "kernelHash": "ab12cd34",         // DexKernel.HASH at parse time
    "warnings": []
  }
}
```

Rules: **a missing value is `null`, never fabricated** (Clock Contract + epistemic principle).
`sqi` and any downstream `conf` stay separate axes. `t0Ms` obeys the floating-clock law; read back only
via `getUTC*`.

### 2.3 `SignalSpec` — the signal-type registry (new CORE module)

Stops every RR-consuming node from restating "an RR frame has these fields in these units." Keyed by
**signal type**, not device:

```js
// dsp resolver returns the node's compute entry point. Namespaced nodes return their object;
// bare-global nodes (PulseDex/OxyDex/HRVDex) return the function(s) they expose on page scope —
// which is exactly why those must be co-loaded in isolation (Phase 1), not all into one page.
SignalSpec.rr  = { kind:'intervals', unit:'ms',    dsp:()=>({ parse: window.parseRRInput }), frameFields:['intervals','tsMs','t0Ms','offsetMin'] }; // PulseDex: bare global
SignalSpec.ecg = { kind:'samples',   unit:'uV',    dsp:()=>window.ECGDSP,                     frameFields:['samples','fs','t0Ms','offsetMin'] };
SignalSpec.cgm = { kind:'samples',   unit:'mmol/L',dsp:()=>window.GLUDSP,                     frameFields:['samples','tsMs','t0Ms'] };          // GlucoDex namespace = GLUDSP
SignalSpec.spo2= { kind:'samples',   unit:'%',     dsp:()=>({ parse: window.parseCSV }),       frameFields:['samples','t0Ms'] };                 // OxyDex: bare global + DOM side-effects
// eeg / flow are NEW signal types: EEGDex / SpiroDex still need real new DSP — the adapter layer
// standardizes their INGEST, it does not eliminate the per-signal math (see §0 note).
```

Adapters emit frames conforming to the spec; nodes and the unifier read field names + units **from the
spec**, not from memory.

### 2.4 The adapter registry (new CORE module)

```js
registerAdapter({
  id:        'polar-rr',
  signalType:'rr',
  vendor:    'Polar (Polar Sensor Logger)',
  // detect: cheap, side-effect-free. filename + header signature. Returns a confidence 0..1.
  detect:    (file, headText) => /_RR\b|_PPI\b/i.test(file.name) ? 0.95 : (/RR-interval|PP-interval/i.test(headText) ? 0.6 : 0),
  // parse: REFERENCE the existing pure parser — never copy it. PulseDex exposes parseRRInput as a
  // BARE GLOBAL (no PulseDSP namespace), so this adapter is registered from a context where
  // pulsedex-dsp.js was loaded in isolation (Phase 1) — `parseRRInput` here is that isolated copy.
  parse:     (text, ctx) => toSignalFrame('rr', parseRRInput(text), ctx)
});
```

- **`detect()` returns a confidence, not a boolean** — the unifier routes a file to the highest-
  confidence adapter and surfaces ties for the user instead of guessing silently.
- **`parse()` calls existing parsers by reference.** The Polar-RR adapter wraps `parseRRInput`; the
  Coospo-RR adapter wraps the *same* `parseRRInput` with a different `detect`. One signal, one math,
  many vendors. If PulseDex fixes a parse bug, every adapter inherits it.
- `toSignalFrame(type, raw, ctx)` is a thin normalizer in the ingest module that maps a node's ad-hoc
  parser output onto the `SignalFrame` shape + stamps `provenance` (incl. `DexKernel.HASH`).
- **The adapter owns the vendor's quirks — including novel timestamp formats.** If a vendor stamps
  dates in a format the node's `parseTimestamp` doesn't recognize (likely for Coospo/Wahoo/Garmin),
  the adapter normalizes them to ISO-8601 — or computes `tMs` itself per the Clock Contract — **before**
  handing text to the existing parser. It does **not** add a regex to the node's `parseTimestamp`: that
  would edit the node (trip the gate) and re-fragment the very format bank we're centralizing. This is
  what makes "new vendor = one new file, never a node edit" actually true. Pair each new adapter with a
  `how-to-collect/` capture note for that device (the capture-provenance discipline in `CLAUDE.md`).

### 2.5 The unifier (new **unbundled** tool)

A drop zone that runs every registered `detect()` over a dropped pile, routes each file to its adapter,
and shows: detected vendor/signal, the normalized `SignalFrame` summary, `usable`/`reason`, and a
one-click **"emit `ganglior.node-export`"** (so a Coospo recording can feed the Integrator without a
dedicated node yet). Built like the `*-analysis.html` research tools: external `*.js` + an **unbundled**
`.html`, so it touches **neither gate** (see §4).

---

## 3 · Phased plan (sequenced by gate cost — zero-risk first)

> Legend: **GATE COST** = what you must run/update after the phase. "none" = no existing
> `*-dsp.js/*-cross.js/*-app.js` edited and no bundle re-built ⇒ both gates are untriggered.

### Phase 0 — CORE scaffold: `SignalFrame` + `SignalSpec` + adapter registry
**New files:** `signal-frame.js` (the `toSignalFrame` normalizer + `validateFrame`), `signal-spec.js`,
`signal-adapters.js` (`registerAdapter`, `detectAdapters(file,headText)`, `runAdapter`).
**Contract:** all three are plain globals, DOM-free, loadable in `node:vm`. `validateFrame(frame)`
returns `{ok, errors[]}` and is the schema authority for §2.2.
**Done when:** the three modules load headless; `validateFrame` rejects a fabricated `t0Ms`-less frame
and accepts a good one; no existing file imports them yet.
**GATE COST:** none (new files, nothing loads them).

### Phase 1 — Unifier tool + first two adapters (by reference)
**New files:** `adapters/polar-rr.js`, `adapters/coospo-rr.js` (both wrap the bare-global
`parseRRInput` from `pulsedex-dsp.js`), `Data Unifier.html` (unbundled), `data-unifier-app.js`.
**Contract:** the unifier loads node parsers read-only and routes dropped files. Coospo differs from
Polar only in `detect` (filename/header signature) — prove the "same signal, new vendor = one file"
claim end-to-end.
**⚠ Isolation requirement (do NOT skip):** PulseDex/OxyDex/HRVDex parsers are **bare globals** that
collide if co-loaded, and `oxydex-dsp.js`/`hrvdex-dsp.js` run DOM/`localStorage` side effects at
load/parse time (`oxydex-dsp.js`'s top-level `ua.addEventListener` throws with no `#uploadArea`).
So the unifier must load each bare-global DSP **in isolation** — an `<iframe sandbox>` or a Worker per
node, or a one-time pre-pass that factors the pure parser into a small namespaced shim — and read back
only its parse output. The namespaced modules (`GLUDSP`/`ECGDSP`/`PPGDSP`) are safe to co-load
directly. Start with PulseDex RR (cleanest: pure bare-global, isolate just for the name collision);
tackle OxyDex/HRVDex parsers only after their pure-parser extraction.
**Done when:** dropping a Polar `*_RR.txt` and a Coospo RR export both produce a valid `rr`
`SignalFrame` with correct `t0Ms` (the **core proof**); an unparseable file shows `usable:false` +
`reason` (never a silent/empty frame). **Stretch / integration:** additionally *running PulseDex's HRV
compute on the frame*, the unifier emits a schema-valid `ganglior.node-export` the Integrator ingests
— note a node-export carries computed HRV/events, so this step runs the node's **DSP**, not just its
parser (for the bare-global RR functions, in the same isolation context as the parser).
**GATE COST:** none (no existing source edited; the unifier is unbundled). *Optional* later: bundle a
shippable `Data Unifier.html` → that is the only point you take on **one** provenance fixture, and a
fresh bundle with no committed fixture is the accepted "no provenance" state.

### Phase 2 — Property / metamorphic test module
**Builds on what exists.** The suite already has **known-answer** tests (WP-C frequency-domain, WP-D
beat-artifact, WP-D2 optical-beat) and synthetic→real-DSP recovery (FULL-lane). Property/metamorphic
testing is the **generative complement**: instead of one hand-picked input→expected pair, state an
*invariant* and let a seeded generator hunt counterexamples across many inputs.
**New file:** add a `property-metamorphic` group set to `tests/dex-tests.js` (both runners pick it up),
driven by a small **seeded** generator (no deps).
**Relations to assert (start here, extend per node):**
- rMSSD / SDNN are **invariant to a constant time-shift** of every `tMs`.
- SDNN, rMSSD scale **linearly** when every RR interval is scaled by *k* (within tolerance).
- Reversing a stationary RR series **preserves** time-domain HRV.
- ODI is **invariant to resampling phase** of a 1 Hz SpO₂ trace.
- Injecting *N* **well-separated, supra-threshold** synthetic ≥4 % desaturations raises the OxyDex ODI
  count by **exactly N** (separation > the detector's refractory/merge window — else the relation is
  monotonic, not exact, which is itself a property worth asserting).
- `SignalFrame` round-trips: `validateFrame(toSignalFrame(type, parser(text))) .ok === true` for every
  registered adapter on its fixture.
- `parseTimestamp` viewer-timezone independence already exists — extend it as a *property* (random
  zones) rather than fixed cases.
**Done when:** the new groups are green in `node tests/run-tests.mjs`; a deliberately seeded
counterexample (e.g. break linearity) is caught.
**GATE COST:** run `node tests/run-tests.mjs` (you edited `tests/dex-tests.js`, which is **not** bundled
— no provenance, no re-bundle). This is the cheap path; keep using it to iterate.

### Phase 3 — Manifest as single source of truth   ✅ EXECUTED 2026-06-24
> **Status:** the registry projection (`dex-registry-gen.js`) and the **reference-guide projection**
> (`dex-gen.js` → links `dex-badges.css` + `ev-corner` badge per metric from `evidence` + legend strip;
> misplaced-shebang syntax bug fixed) are both done and proven on EEGDex
> (`generated/eegdex-registry.js` + `generated/eegdex-reference.html`), now wired through
> `cohesion-badges` in BOTH runners (10/10 cards grade-agree, engine ≡ dex-badges.css ≡ guide).
> **Still open (deferred, not blocking):** the `*-cross.js` metric-def block and the Integrator
> `GRADE_SOURCES`/`GRADE_MIRROR` row projections from the manifest — pick up when a generated node first
> needs a cross-night envelope or fusion surface.
**Goal:** a metric is declared **once** in `codegen/manifests/<node>.manifest.json`; the generator
*projects* the registry (`*-registry.js`), the `*-cross.js` metric-def block (where the node has one),
the reference-guide HTML, and the JSDoc types. The `cohesion-badges` test changes meaning from "did three humans stay in sync" to "is the
generated output current" (automatically true).
**Work:** extend `codegen/dex-gen.js` (today HTML-only) to also emit the registry, the `*-cross.js`
metric-def block (only where the node has a `*-cross.js`), and the Integrator `GRADE_SOURCES`/`GRADE_MIRROR`
row (for the fusion-surfaced subset) from the same manifest; reconcile the manifest schema with the
live cohesion model (5-level evidence ladder, corner-badge placement — `SYSTEM-COHESION-BRIEF.md`),
fixing the README's listed gaps. This collapses the up-to-four hand-synced copies (§1) to one source +
generated projections.
**Forward-first:** **new** nodes (EEGDex/SpiroDex/UltrahumanDex) get generated registries from day one;
**existing** nodes keep their hand-written registry until migrated opportunistically. Do **not**
regenerate all 7 existing node registries (oxydex/hrvdex/pulsedex/ecgdex/glucodex/ppgdex/cpapdex) in
one pass.
**Done when:** a new node's registry + envelope + reference guide are produced from one manifest and
pass `cohesion-badges`; no existing node's registry was touched.
**GATE COST:** none until a generated artifact is wired into a `.src.html` and bundled (then that one
node re-bundles — see Phase 9 protocol).

### Phase 4 — Machine-checked contracts (CI-only, ships nothing)
> **Status:** EXECUTED 2026-06-24. **4a DONE:** contracts declared once as JSDoc `@typedef`s —
> `SignalFrame`/`SignalFrameProvenance` (in `signal-frame.js`, where `validateFrame` enforces them at
> runtime) + `GangliorEvent`/`GangliorNodeExport`/`AdapterSpec`/`DetectMatch`/`RouteResult` (new
> `dex-contracts.js`, a plain global SCRIPT so the typedefs are program-global). Wired into the
> registry (`registerAdapter`/`detectAdapters`/`route` carry `@param`/`@returns`) + `validateFrame`.
> Checked CI-only by `.github/workflows/types.yml` → `tsc --noEmit --checkJs -p tsconfig.json`; the
> tsconfig scope is **forward-first** — only the clean CORE adapter layer, NOT the legacy `*-dsp.js`
> (those carry known DOM/`localStorage` debts, gated separately by 4b). No emit, no shipped build, no
> runtime dep / CDN — the 100%-local invariant is untouched. **4b DONE:** the DSP-purity assertion
> (no `document`/`window.`/`localStorage` in `*-dsp.js`, legacy violators allow-listed) ships in
> `tests/dex-tests.js`. **GATE COST paid:** none new — `dex-contracts.js`/`tsconfig.json`/`types.yml`
> are new files nothing bundled imports; the `signal-*.js` edits are JSDoc-comment-only (no runtime
> change), so the Node suite stays green and no bundle moved.
**4a — Types without a build.** Add JSDoc `@typedef`s for `SignalFrame`, `ganglior.node-export`, and a
registry entry; run `tsc --noEmit --checkJs` in a **CI-only** step. No emit, no shipped build, no CDN,
no runtime dep — the offline/portable invariant is untouched. Gives the next coder (human or AI) a
precise, checkable target.
**4b — DSP-purity gate.** Add one assertion to `tests/dex-tests.js` (static/mirror group): fail if any
`*-dsp.js` source references `document`, `window.`, or `localStorage`. This makes "DSP runs headless"
a checked invariant. **Grandfather the KNOWN legacy violators** — at minimum `hrvdex-dsp.js` (DOM +
`localStorage` in `commitRows`/`_hrvRefreshChrome`/`persistHRVRows`/`getFilteredRows`) and
`oxydex-dsp.js` (top-level file-input/drag listeners + result banners); **audit the rest** the same
way before turning the gate on — with an explicit allow-list + `// TODO migrate` per entry, so new
nodes are held to the rule without forcing a legacy refactor now.
**Done when:** `tsc --checkJs` is green in CI; the purity assertion passes (new nodes clean, legacy
allow-listed).
**GATE COST:** `node tests/run-tests.mjs`. No bundle.

### Phase 5 — Differential testing across the redundant RR nodes
**Goal:** turn the *three* independent RR/HRV paths (PulseDex, ECGDex, HRVDex) from a drift risk into a
cross-check oracle. **Builds on** the existing `SYNTHETIC-CORPUS` + FULL-lane (which already drive
synthetic truth through *one* node's real DSP); the new contribution is **node↔node agreement** — feed
the same cross-node-coherent truth through *two* paths and assert rMSSD/SDNN agree within a stated
tolerance. This generalizes the three-cornered-hat reference-free σ work from *sensors* to *code*.
**Done when:** a differential group is green; deliberately perturbing one node's rMSSD by >tolerance
turns it red.
**GATE COST:** `node tests/run-tests.mjs`. No bundle.

### Phase 6 — Units as quantities (boundary-only)
**Goal:** enforce the metric-canonical law (`CLAUDE.md` §Units) structurally. A boundary-only
`Quantity{value, unit}` (or branded JSDoc types `Milliseconds`, `MmolPerL`, `Bpm`) so imperial↔metric
conversion can happen **only** at the I/O edge and you cannot add mmHg to bpm. Adopt at the adapter
boundary first (frames carry SI), then the profile/display layer.
**⚠ First concrete target — the Baevsky SI/CSI unit guard (independent review, do this even before the
full Quantity rollout).** `hrvdex-dsp.js` `d_si`/`d_csi` read `_mode`/`_mxdmn` straight from the
Welltory summary columns `Mode`/`MxDMn` and **assume seconds** with no bound (`d_csi` comment, L370:
"assumes `_mxdmn` is in SECONDS"). A vendor export in **milliseconds** — or any new importer feeding
the same summary parser — mis-scales them while still looking plausible. **Magnitudes (from the code):**
`d_si = _amo50 / (2 · _mode · _mxdmn)` divides by **both** Mode and MxDMn, so a s↔ms slip is up to
**10⁶×**; `d_csi = _mxdmn / meanRR_s` divides by one (and already converts meanRR to seconds), so it's
the **~10³×** case. Exactly the "plausible but wrong" failure the Clock Contract prevents for *time*,
now on *amplitudes*. **Fix:** bound `_mode`/`_mxdmn` to physiological RR ranges (~`Mode ∈ [0.3, 2.0] s`)
**at the HRVDex summary-CSV ingest boundary** (not "the RR adapter" — HRVDex consumes summary columns,
not intervals); if a value lands in the ms band, treat as ms and divide. The summary-import adapter is
the right home so every future summary vendor inherits the guard. Highest-value single item on the
review punch-list (§12).
**Done when:** the unifier/adapters represent boundary inputs as quantities; a ms-vs-s Baevsky input is
caught (bounded/converted, never silently mis-scaled by 10³–10⁶×); a unit-mismatch test is caught by
`tsc --checkJs` or a runtime guard.
**GATE COST:** none for the adapter layer (new code). Node adoption is per-node, deferred.

### Phase 7 — Content-addressed provenance (replace the `buildHash` proxy)   ✅ EXECUTED 2026-06-30
> **Status:** DONE 2026-06-30. `verify-provenance.html` is now a PURE-STATIC content-addressed gate
> (no iframe boot, reads NO `buildHash`). GATE B replaced the coarse runtime-`buildHash` fixture check
> with a known-answer ledger — each `FIXTURE-PROVENANCE.json` record is `{ bundle, manifestHash,
> inputHashes, outputHash }` (the brief's "fold it + the input/output hashes into one record per
> (fixture × bundle)"). The split-brain + the `LEGACY_FIXTURES` buildHash fallback are retired; the 2
> historical Integrator fusions are `historical:true` byte-pinned records. Shared cores
> `manifest-gate.js gateBEvaluate`/`gateBFiles`/`sha16` are byte-shared by the page + the Node sibling
> `tests/verify-manifest.mjs` (now GATE A + best-effort GATE B). `buildHash` is retired fleet-wide
> (inert legacy export metadata only). **⚠ The "forces re-bundling all apps" cost did NOT
> materialize:** `PROVENANCE-NONDETERMINISM-2026-06-29 §1` had ALREADY made the honest executed-code
> hash (`manifestHash`) a deterministic STATIC computation, so Phase 7 was a TEST/LEDGER/DOC pass with
> ZERO app re-bundle (no inliner / `ganglior-provenance.js` surgery — the GENERATOR-FOLLOWUPS-II §1
> inliner-ownership path stays untaken, now unnecessary). Gates: `verify-provenance` GATE A 8/8 + GATE
> B 15/15 green (teeth verified); `Dex-Test-Suite.html` 1560/99 all-green. Residue →
> `SIGNAL-ADAPTER-FOLLOWUPS-PROVENANCE-2026-06-30-BRIEF.md`.
**Goal:** an honest gate. A known-answer ledger: `hash(inputFixture) + hash(executedCode) → hash(output)`.
Same input + same code ⇒ same output by construction; any drift is red — no 400-word `buildHash`
caveat, no `BUILD-MANIFEST.json`/`FIXTURE-PROVENANCE.json` split-brain. The honest executed-code hash is
already `manifestHash` (static, from the bundle's `__bundler/manifest`); fold it + the input/output
hashes into one record per `(fixture × bundle)`.
**⚠ Scope discipline:** this touches the shared inliner/provenance path and therefore forces re-bundling
**all** apps + regenerating fixtures. It is a **deliberate standalone pass**, never folded into node
work (same caution `CLAUDE.md` applies to `buildSource()` snapshotting). Sequence it **after** the
adapter spine is proven and only when an owner signs off.
**Done when:** `verify-provenance.html` reports drift iff executed code changed, with no `buildHash`
race; the sidecar/manifest split is retired.
**GATE COST:** full re-bundle of all bundles + `BUILD-MANIFEST.json` regen + both gates. High — do last.

### Phase 8 — Fusion algebra with proven laws
**Goal:** state the Integrator's blend (`combineConf` noisy-OR capped 0.97, `effConf = conf × sqi`,
capability-before-consensus) as a small algebra and **property-test the laws**: associativity,
monotonicity, `null` as identity element, "never invents precision" (output conf ≤ 0.97, ≥ each input).
Makes fusion composable + auditable as nodes grow 6 → 10.
**Done when:** law-based property tests are green; a violation (e.g. a blend exceeding 0.97) is caught.
**GATE COST:** if assertions are pure additions to `tests/dex-tests.js` and `integrator-dsp.js` is
unchanged → `node tests/run-tests.mjs` only. If you refactor `integrator-dsp.js` → re-bundle
`Integrator.html` (Phase 9 protocol).

### Phase 9 — Opportunistic node migration (the long tail, per-node, opt-in)
For each existing node, when there's reason to touch it: wrap its existing pure parser as an adapter
emitting a `SignalFrame`, leave its DSP/render math alone, and have the node consume the frame. One node
per pass, gated after each — **never six at once** (`ARCHITECTURE-PRINCIPLES §7`).
**Per-node re-bundle protocol (from `CLAUDE.md`, restated so you don't miss a step):**
1. Edit `*-dsp.js`/`*-app.js`/`*.src.html`; **never** the bundled `*.html`.
2. Re-bundle via the inliner.
3. Run `Dex-Test-Suite.html` → must be **all green**.
4. Run `verify-provenance.html`; read the **`manifestHash`** column (the real code identity — it moves
   on any bundled-module change; `buildHash` may not).
5. **Hand-update that app's entry in `BUILD-MANIFEST.json`** to the new `manifestHash` (GATE A reads
   stale otherwise and now HARD-FAILS).
6. If you changed the node's CODE, **regenerate its fixtures** by re-running the app on its inputs and
   re-exporting (never hand-edit), then record the producing bundle's `manifestHash` in
   `FIXTURE-PROVENANCE.json` (GATE B). Do **not** rely on `buildHash` moving — it often won't.
**Done when:** the migrated node consumes a `SignalFrame`, both gates green, `BUILD-MANIFEST` +
`FIXTURE-PROVENANCE` updated.
**GATE COST:** full per-node (highest). Defer indefinitely; the adapter spine delivers value without it.

### Phase 10 — OverDex: one-drop folder → route → run → fuse (OPTIONAL capstone)   ✅ EXECUTED 2026-06-24
> **Status:** DONE. `OverDex.html` + `overdex-walk.js` + `overdex-app.js` shipped (unbundled), built on
> the extracted shared `signal-orchestrate.js` (folder-walk → `SignalAdapters.route()` → raw-RR live
> compute via the isolated PulseDex host **or** `*_ganglior.json` passthrough → `IntegratorDSP` fusion).
> Independence invariant verified; zero gate cost; end-to-end proof recorded in the brief header + the
> follow-ups brief §9. The two build-it-OverDex-ready prerequisites below were satisfied: the router was
> already reusable (`SignalAdapters.route()`), and the RR orchestration was made reusable by extracting
> it from the unifier into `signal-orchestrate.js` (so it is shared, not copied).
**Goal:** a single tool you point at a **folder (nested allowed) full of mixed raw exports from any
device**; it walks the tree, identifies each file, runs the right node(s) on the right files, and hands
all the results to the Integrator — **one drop, fused result out.** OverDex is the *ultimate consumer*
of everything above: the adapter registry is its routing brain, the Integrator is its finish line.
**It is a consumer that sits ON TOP, exactly like the Integrator — never a coupler (see invariant).**

**What it is, concretely:**
1. **Folder walker** — drag-drop a directory (or folder-pick); recurse every subfolder; collect files.
   Pure browser, fully local (`webkitGetAsEntry` recursion / File System Access API). No server.
2. **Router** — run the adapter registry's `detect()` over every file → group by signal/node. Surface:
   unknown files (set aside, never guessed), and **ambiguous routes** (one RR file legitimately feeds
   *both* PulseDex and HRVDex) for the user to confirm. The router is the **same engine** as the
   unifier (Phase 1) — build the unifier's routing as a reusable module so OverDex imports it, not a
   second copy.
3. **Orchestrator** — for each detected group, produce that node's `ganglior.node-export`. Two paths,
   same fork as Phase 9: **(a) headless-drive** the sealed app bundle in a hidden sandboxed iframe
   (works today, fiddly, depends on the app exposing a programmatic run+export hook); **(b) call the
   node's pure compute directly** once Phase 9 has split reading from computing (clean, reliable).
   Prefer (b) for any node already migrated; fall back to (a) for the rest. **OverDex's reliability is
   a direct function of how many nodes have done Phase 9** — every migrated node upgrades it.
4. **Fuser** — feed the collected exports to the Integrator (the friendly part: it already consumes
   `ganglior.node-export` JSON). Either drive `Integrator.html` in a frame or call the pure
   `integrator-dsp.js` fusion functions on the export array.

**🔒 The independence invariant (non-negotiable — this is the user's hard requirement):** OverDex must
**not** make any Dex depend on any other Dex. Every node stays a standalone instrument that runs alone,
opened directly, with zero knowledge that OverDex exists. OverDex only *orchestrates from above* — it
reads files, invokes nodes, and reads their exports through the **public `ganglior.node-export`
contract**, the exact same seam the Integrator uses. **No node imports OverDex; OverDex imports no
node's internals** (it drives bundles or calls already-public compute entry points). Removing OverDex
must leave every node and the Integrator working **byte-identically**. If a node only works "inside
OverDex," the design is wrong — back it out.

**Build-it-OverDex-ready (do these in earlier phases so the capstone is cheap, not a rewrite):**
- Make the **unifier's router a reusable module** (Phase 1), not UI-bound logic — OverDex reuses it.
- When migrating a node (Phase 9), expose a **headless `compute(frame|files) → ganglior.node-export`**
  entry point as the public surface — that is precisely what OverDex's orchestrator calls.
- Keep adapters emitting fully-formed `SignalFrame`s with provenance — OverDex relies on that to label
  what it ran and where each fused number came from.

**Done when:** dropping a folder of mixed Polar/Coospo/O2Ring/CGM exports yields a single fused
Integrator result; unknown files are reported (not guessed); ambiguous routes are confirmed by the
user; and **every node still opens and runs standalone, unchanged, with OverDex deleted.**
**GATE COST:** OverDex itself is a **new unbundled tool** → zero gate cost to build. It only inherits
gate cost indirectly via the Phase-9 node migrations it prefers to call (which you'd pay anyway). Ship
OverDex unbundled first; bundle it only if/when it earns a single-file release.

---

## 4 · Gate-minimization rules (how to stay outside the gates while building)

Both gates are **action-triggered**, not existence-triggered:

| Gate | Fires when you… | Stays silent when you… |
|---|---|---|
| `Dex-Test-Suite` (and `node run-tests.mjs`) | edit an existing `*-dsp.js`/`*-cross.js`/`*-app.js` | add **new** files no existing module imports |
| `verify-provenance` | **re-bundle** a `Foo.html` | leave bundles untouched / run unbundled |

Therefore:
- **Keep the adapter layer + unifier in new external `*.js` behind an unbundled `.html`** (like the
  `*-analysis.html` tools, which `CLAUDE.md`/README confirm are **not** bundled). During dev you trip
  **neither** gate.
- **Reuse parsers by reference; never fork or edit them.** Because you don't touch `pulsedex-dsp.js`,
  its test group can't regress and no bundle moves.
- **Add tests as new groups** in `tests/dex-tests.js`; iterate with the fast headless
  `node tests/run-tests.mjs` (the full suite runs automatically in seconds — the cost is not *running*
  them, it's not *breaking* them, which additive new files avoid).
- The provenance apparatus is **bundle-only**. You inherit it solely when you choose to ship a bundle
  (Phase 1 optional / Phase 9). A fresh bundle with no fixture = accepted "no provenance".

---

## 5 · Invariants you MUST NOT break

1. **Clock Contract verbatim.** Floating wall-clock `tMs = Date.UTC(...)`; read back only via
   `getUTC*`; missing stamp → `null`, never `now()`. Adapters keep calling their node's **local**
   `parseTimestamp` copy — do **not** introduce a shared timestamp util in this brief (that is a
   separate, deliberate pass). Vendor date-format hints (`preferDMY`, the regex set) belong to the
   adapter, passed into the existing parser.
2. **Frozen names.** `Ganglior` (+ the `fascia` input alias), the `ganglior.node-export` schema, all
   `ganglior.*` identifiers, and the `DexKernel` API are untouchable. The product brand is **Tepna**;
   never conflate it with the bus codename. New node names follow `LEXICON.md §4` (closed compound,
   capital-D, acronym stems all-caps: `SpiroDex`, `EEGDex`, `UltrahumanDex`).
3. **100 % local.** No network, no CDN, no runtime dependency, no `@font-face`/web font, system stacks
   only. `tsc --checkJs` is **CI-only** and emits nothing. Single-file offline reproducibility is the
   moat — every phase preserves it.
4. **Dependency direction downhill.** UI → DSP → INGEST → CORE. INGEST/DSP never touch the DOM. Nodes
   never import each other — cross-node is **only** via the export contract.
5. **Additive contracts.** New params LAST + optional; new data via a NEW field/method. Never edit a
   shared assertion to hide a behavior change — preserve the old shape or update `tests/dex-tests.js`
   deliberately (Node CI uses the same file).
6. **Epistemic honesty.** Every surfaced number keeps its evidence badge (corner or inline per
   `dex-badges.css`); `sqi` and `conf` stay separate axes; a `SignalFrame` with no usable signal is
   `usable:false` + `reason`, never an empty/fabricated frame.
7. **SPDX header on every authored source file** (`licensing/SPDX-HEADERS.txt`); Apache-2.0; author
   Michal Planicka.

---

## 6 · Why this is more AI-legible (and why that matters here)

The system is already unusually AI-friendly — a constitution (`CLAUDE.md`), contracts-as-tests, a
deterministic headless runner (exit 0/1), and explicit "do-not-re-investigate" lists give an agent a
tight, truthful feedback loop. This brief continues that philosophy; it does not invent a new one. It
reduces the specific frictions an agent hits today:
- **Hidden duplication** (a metric in three files, `parseTimestamp` in every node DSP + the Integrator,
  parsers per node) → an
  agent edits N sites and only learns it missed one after the gate fails. **Single-source-of-truth
  (Phase 3) + adapters-by-reference (Phase 1)** collapse "edit 3, hope" into "edit 1, regen / add 1
  file with a clear contract."
- **Working-memory tax of workarounds** — the `buildHash`-is-a-lie caveat an agent must hold to act
  correctly. **Honest content-addressed provenance (Phase 7)** removes it from working memory.
- **Invisible footguns** ("name your `styles` object uniquely", "re-bundle → update BUILD-MANIFEST →
  regen fixtures") — procedural knowledge in prose. **Machine-checked types + the DSP-purity gate
  (Phase 4)** move it into enforced structure.
- **Edge-case enumeration** (an agent's weak spot) → **property/metamorphic + differential testing
  (Phases 2, 5)** let the agent state an *invariant* (its strength) and have the machine hunt
  counterexamples.

Net: the codebase moves from "an AI can work here if it carries the caveats" toward "the structure
carries the caveats, so the AI can't get them wrong."

---

## 7 · Definition of done (this brief) + follow-up

**Minimum shippable (the spine):** Phases 0–2 complete — `SignalFrame`/`SignalSpec`/adapter registry
exist, the unbundled unifier routes Polar + Coospo RR into valid frames and emits a schema-valid
`ganglior.node-export`, and the property/metamorphic + frame-round-trip groups are green in
`node tests/run-tests.mjs`. **Zero gate cost incurred.**

**Per the brief lifecycle (`CLAUDE.md`):** date is in this filename (set once, never rename). When a
phase is *fully* executed (its "Done when" met + the relevant gate green), flip the header in place to
`Status: IN-PROGRESS` (partial) or `DONE — <today>` (all phases). Keep `DOCS-INDEX.md` in sync. After
execution, **spawn a follow-up brief** `SIGNAL-ADAPTER-FOLLOWUPS-<YYYY-MM-DD>-BRIEF.md` capturing what
surfaced (house pattern: `…-FOLLOWUPS` → `-II`); if nothing surfaced, say so in this header rather than
creating an empty follow-up.

**Suggested execution order by value-per-gate-cost:** 0 → 1 → 2 (spine, no gates) → 4 → 5 → 8
(test-only hardening, Node runner only) → 3 (generator, gates only on first generated node) → 6
(units, adapter-first) → **7 last among the hardening** (provenance rework, full re-bundle,
owner-gated) → 9 (node migration, opportunistic, per-node forever) → **10 OverDex (optional capstone,
unbundled, builds on 1 + the Phase-9 migrations).**

---

## 8 · Independent-review punch-list (orthogonal to the phases — pick up alongside)

These came from a whole-codebase second-pass review. They are **not** part of the adapter thesis but
are small, high-trust-per-effort, and several intersect it. Listed by value; a ✦ marks one that the
adapter layer is the right home for.

**Correctness (do first — these can mis-state a number):**
1. **✦ Baevsky SI/CSI unit guard** — folded into **Phase 6** above. **✅ NATIVE PATH DONE 2026-06-25 (via SIGNAL-ADAPTER-FOLLOWUPS-III §1):** the adapter-boundary guard landed with the HRVDex leg; `hrvdex-dsp.js computeDerived` now ALSO runs `DexUnits.guardBaevsky`/`baevskySI` for its own `d_si`/`d_csi` (single-source, threshold not forked), so HRVDex.html's direct-load path is unit-safe too. The single best catch: bound
   `_mode`/`_mxdmn` at the HRVDex summary ingest so a ms-vs-s vendor export can't silently mis-scale
   `d_si` (up to 10⁶×, divides by both) / `d_csi` (~10³×). Put the guard in the summary-import adapter so
   every future summary vendor inherits it.
2. **✦ Zero-default composites emit a fake number, not absence (NEW — found verifying the brief).** **✅ DONE 2026-06-25 (via -III §1 re-bundle):** `d_welfare`/`d_efc`/`d_ans_load` now gate on their subjective inputs being PRESENT (`> 0`), not `!= null`, so a raw recording yields `NaN`/'—' instead of a fabricated `0`. (Residue: the same zero-seed fabrication affects more composites — `d_pti`/`d_coh_energy`/`d_incoherent_stress`/`d_sdi` — captured in `-V`.) When
   HRVDex computes from a **raw** recording (not a Welltory CSV) it seeds `_stress/_energy/_focus/
   _coherence/_sns/_psns = 0` (`hrvdex-dsp.js` L302). The composite guards test `!= null`, but `0` is not
   `null` — so `d_welfare = (energy·coherence)/(stress+1)` evaluates to **`0`**, `d_efc`/`d_ans_load`
   likewise, and they surface a plausible-looking value built on inputs that were never measured. This
   is a guess in the clothes of a measurement — the one thing the project forbids — and it is the
   strongest argument for the quarantine in item 5: a composite whose black-box inputs are absent must
   return `null`/`usable:false`, never `0`. Cheap fix: guard on "inputs present AND non-zero/derived",
   or gate these composites on `provenance.source === 'welltory-summary'`.
3. **Confirm no surfaced number uses the crude `spectral()` path** (`pulsedex-dsp.js`, `hf ≈ rmssd²`)
   instead of the real Lomb–Scargle. If it's dead code, delete it; if it's live anywhere, route it to
   the LS path. Ambiguity on a *surfaced* spectral value is the risk. (Touches a node → gated; do it
   during that node's next migration pass, Phase 9, not as a drive-by.)
   **✅ CLOSED 2026-06-30 (`DEEP-AUDIT-FIXES-2026-06-30-BRIEF` §1):** the deep-audit found `spectral()`
   WAS live + surfaced — the PulseDex "VLF (night)"/"Total Pwr (night)" display rows, badged
   `validated`. The dead-code branch applied: `spectral()` + those two rows + the `'… (night)'` aliases
   were deleted, so Lomb–Scargle is now the only spectral source. PulseDex re-bundled
   (`1a8b99cf8a4c→4ad7ee5b9982`, export-inert); both gates green.
4. **Move the ODI-4 severe-night undercount caveat onto the ODI card** (`oxydex-render.js` / its
   reference guide), not only in `odi4-ahi-bias.html` / `RERUN-RESULTS.md`. A known underestimate on
   severe disease is the one place buried context is genuinely risky. (Node edit → gated.)

**Honesty / scope (aligns with the adapter thesis):**
5. **✦ Quarantine the Welltory black-box composites** — `d_welfare`, `d_crs`, `d_otr`, `d_efc`,
   `d_ans_load` (HRVDex) and `stressEst/energyEst/focusEst/cohEst` (PulseDex) compound Welltory's
   proprietary Stress/Energy/Focus/Coherence scores into graded outputs, contradicting the
   traceability creed (their inputs can't be inspected). **✅ HRVDex DONE 2026-06-25 (via -III §1):** the
   five HRVDex composites were demoted in `hrvdex-registry.js` from `experimental`→`heuristic` (with the
   `HRVDex Reference.html` cards + cohesion-badges synced) so they read visibly second-class on the
   native path, matching the welltory-summary adapter's `provenance.derived:true` + the `'heuristic'`-tier
   `stress_high` event. (PulseDex `*Est` quarantine still owed — per-node, its next migration.) **This is a clean motivating example for the
   adapter boundary:** a vendor's *derived* scores are a different, lower-trust input class than raw RR
   — the adapter should tag them (e.g. `provenance.derived:true` / lower evidence tier) so composites
   built on them are visibly second-class, and the nodes can stand on their raw-RR math (rMSSD, SDNN,
   ln-rMSSD, pNN50, bands, SD1/SD2) when the black-box inputs are absent. Retire the wellness names
   while there (LEXICON). (Node edit → gated; do per-node.)
7. **Demote the VO₂ heuristic out of the top KPI grid** — registry depth is right, render weight isn't;
   a `heuristic`-tier number shouldn't sit in the headline grid. Render-only change. (Node edit →
   gated.)

**Process / credibility (cheap, non-code or near-non-code):**
7. **Tag a real versioned release + mint a Zenodo DOI** — `v1.0.0` as a string literal isn't a release;
   a DOI makes the `papers/` set citable. No code-path risk.
8. **A 5-minute contributor path** ✅ EXECUTED 2026-06-24 — `ADD-AN-ADAPTER.md` shipped (linked from
   `DOCS-INDEX.md` §0): copy `coospo-rr.js` → write `detect`/`parse` (reference, never copy the
   parser) → register the `<script>` in the 5 wiring sites → run `node tests/run-tests.mjs`. Zero
   gate cost (doc only, no node edited, no bundle moved). Was: a short "add a parser format / fix a
   typo" doc that doesn't require absorbing the full brief lifecycle. Directly addresses the
   bus-factor-one risk, and the **adapter layer is the natural first contribution surface**
   ("write one `detect`+`parse`").

**Validation asks (correct but research-effort, not refactors — out of scope for this brief, noted so
they aren't lost):** one paired-PSG cohort for Bland–Altman ODI-4 vs PSG-ODI; a Kubios/NeuroKit2
agreement run on the same RR (turns the HRV core from self-consistent into reference-agreeing). Track
these in a separate validation brief, not here.

**Gate note:** items 1, 7, 8 touch **no** existing node bundle (adapter/ingest, release metadata, a
doc) → zero gate cost. Items 2–6 each edit a node → fold them into that node's **Phase 9** migration
pass so you pay the re-bundle + provenance gate **once per node**, not once per fix.
