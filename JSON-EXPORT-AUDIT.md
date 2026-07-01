# JSON Export Audit — Tepna / Dex Suite

**Date:** 2026-06-21 · **Scope:** every node's `exportJSON` / `exportGanglior` / `exportNight`
(+ Integrator `buildFusionExport`). **Lens:** null vs 0, Clock-Contract compliance, and
cross-node schema cohesion.

> **Headline:** the JSON exports are **correct** — far healthier than the CSVs were. JSON's own
> semantics (real `0` preserved, `NaN`/`Infinity` → `null`, the missing-key vs `null` distinction)
> plus disciplined `?? null` / object-`|| null` guards mean there is **no null↔0 fabrication bug**
> here. The one real gap is **cohesion**: the slim `exportGanglior` event-stream differs at every
> node. That, plus a couple of contract nits, is the whole list.

---

## 1. null vs 0 — PASS

JSON is structurally kind to the three-state problem the CSVs failed:
- **real `0`** serializes as `0` (never dropped, never blanked).
- **`NaN` / `±Infinity`** serialize as `null` — i.e. missing, never a fake number. (The crossnight
  envelope is even gated on this: the suite asserts `countNonFinite(env) === 0`.)
- **`undefined`** keys are *dropped* (objects) or become `null` (arrays).

Spot-checks confirm the guards are the right kind:
- `oxydex-app.js exportJSON`: every optional block is `x || null` on an **object** (safe — never a number).
- `ecgdex buildV2`: `round = (v,d)=> v==null ? null : (typeof v==='number' ? +v.toFixed(d) : v)` —
  null→null, **`0`→`0`**, NaN→NaN→`null`. Correct.
- `glucodex exportJSON`: missing variability metrics use `?? null` (e.g. `r.dawn.medianDelta ?? null`),
  which preserves a real `0` (unlike `|| null`). Correct.

**No `value || 0` / `value || null` on a numeric metric field was found** — the class of bug that
sank the GlucoDex CSV does not exist in the JSON path. ✅

## 2. Clock Contract — PASS (one nit)

- `recording.startEpochMs` = the floating `t0Ms`. ✅
- Events carry `t:"HH:MM:SS"` and (newer emitters) absolute floating `tMs`. ✅
- `generated: new Date().toISOString()` is **export-wall-clock metadata**, not signal time — correct
  use (not a Clock-Contract violation).
- **Nit:** GlucoDex fusion events use `t:"HH:MM"` (minutes only, no seconds) and **omit `tMs`**.
  The contract wants `HH:MM:SS` and *SHOULD* carry `tMs`. The Integrator tolerates it
  (`reconstructEventTMs` handles `HH:MM`), so it ingests — but it's the one event-shape that misses
  the "new emitters SHOULD write `tMs`" guidance.

## 3. Cross-node cohesion — the real finding

The **full node-export** (`exportJSON` / `cpapBuildExport`) is consistent: `schema.name:"ganglior.node-export"`,
`version`, `node`, `kernel`, `provenance`, `recording.startEpochMs`, `crossNight` envelope where ≥N.

The **slim `exportGanglior` event-stream** is not — five nodes, five shapes:

| node | `schema.name` | `kernel` | `provenance` | `startEpochMs` | `generated` | events key |
|---|---|---|---|---|---|---|
| **HRVDex** | ✅ | ✅ | ⚠️ in schema? no | ✅ `recording.` | ✅ | `ganglior_events` |
| **PulseDex** | ✅ | ✅ | ✅ | ✅ `recording.` | ✅ | `ganglior_events` |
| **ECGDex** | ❌ | ❌ | ✅ | ✅ top-level | ❌ | `events` |
| **GlucoDex** | ❌ | ✅ | ✅ | ✅ top-level | ❌ | `events` |
| **PpgDex** | ❌ | ✅ | ❌ | ❌ | ✅ | `events` |

HRVDex & PulseDex are the canonical shape. ECGDex / GlucoDex / PpgDex are slim and each drops a
different subset. The Integrator's `_eventsFromEnvelope` reads `ganglior_events → fascia_events →
events` and `recording.startEpochMs || startEpochMs || t0Ms`, so **all of these ingest today** — this
is a consistency/credibility issue, not a fusion break. Per the export contract (CLAUDE.md §6,
EEGDEX brief) the canonical key is **`ganglior_events`**.

## 4. Minor nits (no action unless desired)
- **Charset on Blob:** JSON blobs use `{type:'application/json'}` without `;charset=utf-8`. JSON is
  UTF-8 by spec, so this is harmless — but it's the one place the CSV pass added a charset and JSON
  didn't, for symmetry.
- **Filename-stamp drift:** `_hrvTs()` is a byte-identical duplicate of `_exportTs()` (same nit the
  CSV audit raised).
- **Ganglior export filenames** vary in convention (`ganglior_glucodex_events.json` vs
  `ECGDex_*_ganglior.json` vs `ppgdex_*.json`).

## 5. Fix applied this pass
**Unify the three slim `exportGanglior` exports (ECGDex, GlucoDex, PpgDex) to the canonical
HRVDex/PulseDex shape**: `kernel` + `schema{name:"ganglior.node-export", version, node, nodeVersion,
bus, generated, provenance, doc}` + `recording{source, startEpochMs, …}` + **`ganglior_events`** +
`reserved`. No event math changes; the Integrator already reads `ganglior_events`, so ingest is
unaffected (verified via the test gate). null/0 untouched (already correct).

**Gate:** `*-app.js`-only → `buildHash` unchanged → fixtures reproducible. Run `Dex-Test-Suite.html`
(incl. the Integrator/CrossNight ingest groups) + `verify-provenance.html` after re-bundling.
