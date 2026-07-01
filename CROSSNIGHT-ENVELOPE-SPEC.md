<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Ganglior Cross-Night Envelope — `ganglior.crossnight` v1.0

> **Status:** DRAFT v1.0 (June 2026). The standardized, versioned shape every Dex node emits
> for night-to-night / session-to-session / recording-to-recording longitudinal statistics.
> Sits under the `crossNight` key of a multi-item `ganglior.node-export` wrapper, and is the
> single shape the **Integrator** reads to build its cross-node longitudinal panel. Reference
> implementation: `crossnight-envelope.js` (`window.CrossNightEnvelope.build / .validate`).

---

## 0. Why this exists

Today each node hand-rolls a `crossNightBlock()` that returns a slightly different shape
(`{doc, metrics, nights}` for PpgDex/ECGDex, a richer one for OxyDex). The math is shared by
convention (each `*-cross.js` duplicates the same `crossNight()` engine), but the **container
shape is not contractual** — so the Integrator would have to special-case every node.

This envelope fixes the *shape* (one contract, versioned) while leaving the *math* duplicated
locally per app (suite convention — see CLAUDE.md). The builder is dependency-injected with
each node's local `crossNight` function, so adopting the envelope does **not** centralize or
change any node's statistics — it only standardizes how they're packaged.

**Separation of concerns (the key idea):**

```
crossNight(series, opts)         → the MATH    → duplicated locally per node (unchanged)
CrossNightEnvelope.build(...)    → the SHAPE   → ONE shared file (this contract)
```

---

## 1. Where it lives

A node's per-item export is unchanged (`ganglior.node-export` v2.0). When ≥2 items are loaded,
the multi-item wrapper carries one envelope:

```jsonc
{
  "schema": { "name": "ganglior.node-export", "version": "2.0", "node": "PpgDex", "multiSession": true, ... },
  "sessionCount": 6,
  "crossNight": { /* ← THIS envelope (ganglior.crossnight v1.0) */ },
  "sessions": [ /* unmodified per-item v2.0 envelopes */ ]
}
```

The Integrator may also receive a bare envelope on its own (e.g. from the longitudinal store).
It is self-describing and never depends on its surrounding wrapper.

---

## 2. The shape (annotated)

```jsonc
{
  "schema": {
    "name": "ganglior.crossnight",     // discriminator — always this
    "version": "1.0",                  // ENVELOPE SHAPE version (bump on breaking shape change)
    "engine": "crossNight",            // algorithm family
    "engineVersion": "1.0.0",          // ALGORITHM version — trends from different engines
                                       //   must NOT be silently compared; consumers branch on this
    "node": "PpgDex",                  // emitting node
    "nodeVersion": "1.0",
    "generated": "2026-06-10T08:14:00.000Z"  // real-UTC export instant (NOT a floating tMs)
  },

  "window": {
    "unit": "session",                 // "session" | "recording" | "night" — node-agnostic
    "count": 6,                        // items included
    "firstT0Ms": 1781724240000,        // floating tMs of earliest item (Clock Contract)
    "lastT0Ms": 1782156240000,         // floating tMs of latest item
    "spanDays": 5.0,                   // (last − first) / 86_400_000, or null if t0 unknown
    "coverageWeighted": true,          // were aggregates weighted by per-item quality?
    "qualityFloorPct": 50,             // items below this are flagged lowQuality (still shown)
    "lowQualityCount": 1               // # items flagged
  },

  // ── per-metric robust statistics ───────────────────────────────────────────
  // Keyed by stable metric id. Each metric is SELF-DESCRIBING (label/unit/goodDirection)
  // so a consumer never needs a hardcoded dictionary.
  "metrics": {
    "rmssd": {
      "label": "rMSSD",
      "unit": "ms",
      "goodDirection": "up",           // "up" | "down" — which way is healthy
      "n": 6,                          // items with a finite value for this metric

      "central": {
        "mean": 41.2, "sd": 6.8, "median": 40.5,
        "iqr": 9.1, "min": 31.0, "max": 52.0,
        "cv": 16.5                     // coefficient of variation % — night-to-night consistency
      },

      "trend": {
        "slopePerIndex": 1.83,         // OLS slope vs item index (coverage-weighted)
        "slopePerDay": 2.10,           // OLS slope vs real date — honours uneven gaps; null if no t0
        "r2": 0.71, "r2date": 0.68,
        "mannKendall": { "tau": 0.73, "p": 0.04 },  // non-parametric trend (robust on short series)
        "label": "improving"           // "improving" | "stable" | "declining" | "insufficient"
                                       //   (resolved against goodDirection + MK significance)
      },

      "change": {                      // null unless n ≥ 7
        "deltaFirstHalfToSecond": 4.2, // mean(2nd half) − mean(1st half)
        "ci95": [0.8, 7.9],            // bootstrap 95% CI on that delta
        "significant": true            // CI excludes 0
      },

      "baseline": {
        "window": "prior-5",           // which items formed the personal baseline
        "mean": 40.1, "sd": 5.9,
        "zLatest": -1.8,               // newest item vs personal baseline, in σ
        "flag": "below-1sigma"         // null | "below-1sigma" | "above-1sigma" | "below-2sigma" | "above-2sigma"
      }
    }
    // … one entry per tracked metric
  },

  // ── raw per-item values + provenance (lets the Integrator re-derive / cross-align) ──
  "series": [
    {
      "i": 0,
      "t0Ms": 1781724240000,           // floating tMs — cross-node alignment key
      "date": "2026-05-15",            // getUTC* render of t0Ms (Clock Contract §5)
      "weight": 0.92,                  // coverage weight used (0..1)
      "lowQuality": false,
      "values": { "rmssd": 38.0, "sdnn": 52.0, "hr": 58, "pi": 3.1 }
    }
    // … one per item, ascending by t0Ms
  ],

  // ── pre-computed user-facing callouts, ranked (|z| × significance) ──
  "headline": [
    "rMSSD +1.8σ vs your 6-night baseline",
    "ODI-4 shifted −3.4/hr (95% CI excludes 0)"
  ]
}
```

---

## 3. Field semantics & rules

- **`schema.generated`** is a real-UTC ISO instant (export wall-clock) — the *only* non-floating
  timestamp in the envelope. Everything time-physiological (`t0Ms`, `firstT0Ms`, `lastT0Ms`) is
  **floating wall-clock `tMs`** per the Clock Contract; render with `getUTC*`.
- **`metrics[*].goodDirection`** is mandatory and drives `trend.label`. `"up"` = higher is
  healthier (rMSSD, SpO₂, sleep-eff); `"down"` = lower is healthier (ODI-4, HR, NSI, AI, T90).
- **`trend.label`** = `improving`/`declining` only when Mann–Kendall is significant
  (`p < 0.10` and `|tau| > 0.15`) **and** resolved against `goodDirection`; else `stable`;
  `insufficient` when `n < 3`.
- **`change`** is `null` for `n < 7` (bootstrap CI not meaningful on tiny samples).
- **`baseline.zLatest`** uses prior-items mean±SD (excludes the newest), so the newest item reads
  as "_N_σ vs your baseline". `flag` set when `|z| ≥ 1`.
- **Quality:** low-quality items are **shown** in `series` (with `lowQuality:true`) but
  down-weighted in every fit/aggregate via `weight`. Never silently dropped.
- **Missing metric on an item** → omit from that metric's `n`/series-value; never coerce to 0.

---

## 4. Versioning policy

| Bump | When |
|---|---|
| `schema.version` (shape) | A field is removed/renamed/retyped, or a required field added. Additive *optional* fields do **not** bump it. |
| `schema.engineVersion` (math) | Any change to `crossNight()` numerics (slope, MK, bootstrap, z). Consumers must not compare trends across differing `engineVersion`. |

Consumers branch on `schema.version`'s **major**. A v1.x envelope is forward-readable by a v1.y
consumer (additive-only within a major). The longitudinal store records the `engineVersion` that
produced each stored aggregate so historical trends aren't silently re-mixed.

---

## 5. Consumer guidance (Integrator)

1. Validate with `CrossNightEnvelope.validate(env)` (or check `schema.name === "ganglior.crossnight"`
   and major version).
2. Align across nodes by **`series[].t0Ms` / `date`** — two nodes recording the same civil night
   produce the same floating `t0Ms` by construction (Clock Contract), so a date join is exact
   without anyone sharing a timezone.
3. Read `metrics[id].goodDirection`/`unit`/`label` directly — do not hardcode per-node metric
   dictionaries.
4. For cross-node correlation, prefer the raw `series[].values` (re-derive jointly) over the
   per-node `trend` (which is single-signal).

---

## 6. Conformance checklist (every node that emits a `crossNight` block)

- [ ] Block validates against `CrossNightEnvelope.validate`.
- [ ] `schema.name === "ganglior.crossnight"`, `version` + `engineVersion` present.
- [ ] All `t0Ms`/`firstT0Ms`/`lastT0Ms` are floating wall-clock; `date` is a `getUTC*` render.
- [ ] Every metric carries `label`, `unit`, `goodDirection`.
- [ ] `change` is `null` when `n < 7`; `trend.label === "insufficient"` when `n < 3`.
- [ ] Low-quality items appear in `series` flagged, not dropped.
- [ ] `engineVersion` matches the local `crossNight` implementation's version.

---

## 7. Adoption status

| Node | Per-item export | `crossNight` envelope |
|---|---|---|
| **PpgDex** | v2.0 ✓ | **emits `ganglior.crossnight` v1.0 ✓** (reference adopter) |
| **ECGDex** | v2.0 ✓ (arrayed at ≥2) | **emits `ganglior.crossnight` v1.0 ✓** (migrated — shape only, math unchanged; in-app card untouched) |
| **OxyDex** | v2.0 array (≤2 nights byte-identical) | **emits `ganglior.crossnight` v1.0 ✓** (migrated; export wraps to `{nights, crossNight}` only at ≥3 nights) |
| **PulseDex** | bare object (single) / arrayed at ≥2 | **emits `ganglior.crossnight` v1.0 ✓** (multi-day model added; single-recording byte-identical) |
| **Integrator** | — | consumer; reads this shape only |

Migration is shape-only and additive — no node's `crossNight()` math changes.
