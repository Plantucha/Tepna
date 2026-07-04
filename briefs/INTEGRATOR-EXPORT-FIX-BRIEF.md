<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Integrator fusion-export completeness + ordering (and session follow-ups)

> **For the next AI coder.** Read `CLAUDE.md` first (the two gates + the build/bundle rule + the
> Clock Contract), then this. Everything below came out of an audit of two real exports the user
> generated from the Integrator (`uploads/integrator_fusion_2026-08-08.json` +
> `uploads/integrator_findings_2026-08-08.csv`). The files are **valid and well-formed** — JSON
> parses, the CSV is RFC-4180 + Excel-formula-safe, the Clock Contract holds (floating `tMs`,
> UTC-rendered strings, clean midnight rollover, no 24-h jump). The fixes below are about
> **completeness + ordering of the export**, not malformed data.

**Edit the external `*.js` + `.src.html`, never the bundled `Foo.html`; re-bundle after.** Both P1/P2
fixes are JS-only (`integrator-dsp.js`), so `buildHash` does NOT move and the committed
`uploads/integrator_fusion_*.json` provenance fixtures stay `reproducible ✓` (they're additive-only
changes). Still: **run `Dex-Test-Suite.html` (it gates `buildFusionExport` shape) and re-bundle
`Integrator.html`, then re-open `verify-provenance.html`** before calling done.

---

## P1 — The fusion export drops 3 of the 5 finding types it computes  ⬅ primary

**Where:** `integrator-dsp.js` → `buildFusionExport(recs, fusion)` (~line 1079).

**What's wrong:** the export's `findings[]` is just `fusion.findings.map(...)`, which only contains
`confirmed_apnea_event`s + the single `glucose_autonomic_correlation`. Three computed-and-displayed
results are **never serialized**:

| UI surface (shown) | Lives on | In export today? |
|---|---|---|
| Positional apnea (supine rate, positional flag) | `fusion.positional` | ❌ (only per-event `meta.position` survives) |
| HRV consensus (divergence %, source nodes) | `fusion.hrv` | ❌ |
| Device-scored AHI (reference) — CPAP runs | `fusion.apnea.apneaAuthority` | ❌ |

The smoking gun: the export's own `schema.method.hrvConsensus` **documents** the HRV-consensus method
— so the file *describes an output it doesn't carry*. A downstream consumer (or a node ingesting the
fusion write-back) sees apnea + the glucose handshake and nothing else.

**Fix:** add three NEW top-level blocks to the returned object (do NOT change the existing `findings[]`
shape — additive, back-compat per CLAUDE.md "expose new return data via a NEW field"):

```js
// in buildFusionExport's returned object, alongside confirmedApneaIndex / apneaNullModel:
positional: fusion.positional || null,                 // { available, supine, nonsupine, unknown,
                                                        //   supineRate, positional, postureSource, note }
hrvConsensus: fusion.hrv || null,                       // { blocks:[{ window, divergencePct, qc,
                                                        //   nodes, rmssd, sdnn, lfhf, note }] }
deviceScoredAHI: (fusion.apnea && fusion.apnea.apneaAuthority) || null,  // { node, ahi, components,
                                                        //   therapyHours, confirmedIndex, residualGap, agreement }
```

- Keep them `null` when not computed (no overlap / no CPAPDex), exactly like the other reserved keys
  — consumers must tolerate `null`.
- **Bump `schema.version` `"1.1"` → `"1.2"`** (fields added). Leave the `method` doc strings; they now
  match the data.
- Time fields inside any new block that carries a `tMs` MUST render strings via `fmtDateTime` (UTC
  getters) per the Clock Contract — but `fusion.positional/hrv/apneaAuthority` are aggregates with no
  raw `tMs`, so there's nothing to format here; just pass them through.

**Gate:** this changes `buildFusionExport`'s return shape → the shared suite asserts that contract.
Update the relevant assertion in `tests/dex-tests.js` **deliberately** (Node CI `run-tests.mjs` uses the
same file) to expect the three new keys (present, `null`-tolerant). Re-bundle `Integrator.html`.
Provenance: JS-only ⇒ `buildHash` unchanged ⇒ existing fixtures stay reproducible (the new keys are
simply absent from old fixtures — fine, additive). Optionally regenerate one fresh fixture so a
golden file exercises the new blocks.

---

## P2 — `findings[]` is not sorted by time

**Where:** `integrator-dsp.js` — the flattened list is built in `runFusion` (~line 1038, where
`glucose_autonomic_correlation` is `push`ed after the apnea findings) and consumed verbatim by
`buildFusionExport` (JSON), `exportCSV` (CSV, in `integrator-app.js`), and `renderTable` (UI table).

**What's wrong:** the `glucose_autonomic_correlation` finding is pinned to the session start
(`tMs = startMs`, 23:22) but appended **last**, so it is the final row in both the JSON array and the
CSV — chronologically out of order (after 00:56). Any consumer relying on row order misplaces it.

**Fix (one place, everyone inherits):** sort `findings` by `tMs` ascending (nulls last) where the list
is finalized in `runFusion`, so the UI table, JSON, and CSV all share one order:

```js
findings.sort(function(a,b){ return (a.tMs==null?Infinity:a.tMs) - (b.tMs==null?Infinity:b.tMs); });
```

Do it after the `glucose_autonomic_correlation` is pushed and before `findings` is returned on the
fusion object. (Don't sort only in `buildFusionExport` — that would leave the UI table and CSV in the
old order.)

**Gate:** behavior change → run `Dex-Test-Suite.html`; if any assertion checks finding order/index,
update it. Re-bundle.

---

## Confirmed NON-issues (do not "fix")

- **CSV escaping** — `csvCell` (`integrator-app.js`) already does RFC-4180 quoting (`/[",\r\n]/` →
  doubled-quote wrap) + Excel-formula-injection guard (`=+-@` → leading tab) + blanks for
  null/NaN/±Inf with real `0` preserved. Correct.
- **`kernelAudit.ok:false` / all nodes `status:"missing"`** — the synthetic generator doesn't stamp a
  physiology-kernel hash on its node exports (same thing the chips show as "no kernel stamp"). REAL
  node exports stamp it. Not an export bug.
- **`schema.provenance.inputs:[]`** — empty because this was **generated**, not file-loaded; there are
  no input-file fingerprints. (If you want generated runs to record their synthetic provenance, that's
  a feature, not a fix.)
- **Fractional `tMs`** (e.g. `…595.7935`) — floating ms from generated event times; harmless, the
  string times render correctly.

---

## Secondary — other findings from this session (each needs an owner decision)

These are larger than the export fixes; list them with the user before starting.

1. **🔴 Suite-wide blank-on-print/PDF/export bug.** Shared `ans-design.css` animates `.main-content`
   (`fadeIn`) and `.chart-card`/`.kpi` (`cardEntrance`, `fill:both`) **from `opacity:0`** — so when the
   document timeline is frozen (print, PDF export, background/throttled tab, capture) the content stays
   invisible. Only the **Integrator** was patched (scoped injected CSS in `integrator-render.js`); the
   **other six apps still blank out**. Root fix = make the visible end-state the base in
   `ans-design.css` (animate from hidden only while playing). ⚠️ `ans-design.css` is inlined into each
   bundle's `__bundler/template`, so editing it **moves every app's `buildHash`** → re-bundle all 7 +
   **regenerate all provenance fixtures** + full suite. Big, deliberate pass.

2. **Badge coverage audit of the other six apps.** This session added a 🔴 *coverage mandate* to
   `CLAUDE.md` / `dex-badges.css` / `CONTRIBUTING.md` (every surfaced measurement — KPI, card,
   hero/headline number, chart series, table/chip — carries an evidence badge, **bottom-right corner**
   or **inline-before-label**). Only the Integrator was made compliant. Audit OxyDex / HRVDex /
   PulseDex / GlucoDex / ECGDex / CPAPDex for unbadged surfaces and fix to the mandate.

3. **`Integrator.src.html` still has 3 duplicate `<nav class="mobile-nav">` blocks.** They're deduped
   at runtime (`integrator-render.js` `bindNav` removes all but the last). Cleaning the markup is the
   real fix but **moves `buildHash`** → the 3 committed `uploads/integrator_fusion_*.json` fixtures
   would flip to mismatch and **cannot be regenerated** (their source node-export inputs aren't in the
   repo). Decision: (a) clean markup + regenerate fixtures from freshly-built inputs, or (b) keep the
   runtime workaround and leave the markup. Currently (b).

4. **Fusion-finding evidence tiers are author-assigned, not test-backed.** `FINDING_EVIDENCE` in
   `integrator-render.js` (apnea→emerging, device-AHI→validated, glucose⟷autonomic→heuristic,
   positional→experimental, HRV-consensus→emerging, desat-match→measured) is a science-governance call,
   unlike node registries which the `cohesion-badges` gate backs. The author should **ratify** these
   grades; consider moving them into a small node-style registry so they're test-anchored.

5. **Provenance still fingerprints the template, not executed JS** (external review item #7).
   `buildHash` = SHA-256 of the `__bundler/template` skeleton, so external-`*.js` drift is invisible to
   the committed fixtures. `verify-provenance.html` now shows a *second* code-hash column (looks
   half-started). Every JS-only change this session is, by the fixture measure, "reproducible" against
   an unchanged hash. Closing this is its own work package (hash the executed JS/CSS manifest, announce
   the one-time fixture-regen break) — **do not fold it into any other hash-moving change.**

---

### Recommended order
P2 (tiny, safe) → P1 (additive export blocks + assertion update) → then surface the Secondary list to
the user and pick. P1+P2 are one coherent Integrator pass behind one gate run; the Secondary items are
each their own package.
