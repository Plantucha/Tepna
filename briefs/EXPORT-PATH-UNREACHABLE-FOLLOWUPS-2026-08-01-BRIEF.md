<!--
  EXPORT-PATH-UNREACHABLE-FOLLOWUPS-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `EXPORT-PATH-UNREACHABLE-2026-08-01-BRIEF.md` · **Affects:** `Dex-Test-Suite.html`

# The hollow leg was not one leg — two of six were vacuous and a third missed by a single token.

`EXPORT-PATH-UNREACHABLE` §8.3 found, by accident, that GlucoDex's render-coverage leg passed every
assertion on an app showing nothing, and closed with the open question: **how many others?** This
brief answers it by measurement, and takes the one action that follows.

Each leg's own predicate was replayed against its **bare bundle with no data injected at all** —
`renderCoverageApp`'s settle is `_numTokens(d) >= cfg.minNums && cfg.labels.some(l => …test(text))`,
and its assertions add `txt.length > (cfg.minChars||1500)`:

| generic leg | numeric tokens / `minNums` | labels matched on the EMPTY app | chars / min | verdict |
|---|---|---|---|---|
| **GlucoDex** | **16 / 15** | CV · GMI · range · glucose | 2832 / 1500 | **HOLLOW** |
| **PpgDex** | **17 / 12** | pulse · HRV | 1597 / 1500 | **HOLLOW** |
| HRVDex | 11 / 12 | rMSSD · SDNN · HRV | 2309 / 1500 | sound by **1 token** |
| OxyDex | 13 / 15 | SpO · AHI | 1621 / 1500 | sound by 2 tokens |
| PulseDex | 12 / 15 | HRV | 1610 / 1500 | sound by 3 tokens |
| MotionDex | 3 / 8 | respirat | 526 / 600 | sound by 5 tokens |

**Two of six were outright vacuous, and every remaining one clears by a margin of 1–5 tokens.** The
`minChars` bar is worse: five of six empty apps already exceed 1500 characters, so it separates
nothing. These thresholds were never wrong on purpose — they are *counts of tokens in body text*, and
an analyzer's empty state is full of labels, units, help copy and placeholder numbers. **A metric that
the empty state can satisfy is not measuring the loaded state.**

> **The labels are the sharper half of the problem.** GlucoDex matched **all four** of
> `CV`/`GMI`/`range`/`glucose` with no data loaded — in its own "Load a CGM export … Units (mg/dL or
> mmol/L) and cadence are auto-detected" help text. A label regex over `innerText` cannot tell a
> rendered result from an instruction telling you how to produce one.

## 1 · The fix already shipped — and this brief stops it regressing

The parent made legs that declare an export bar **settle on `#exportBar.show`**. That is the right
condition and not by luck: it is set only where a result is committed, and it measured **`false` on
every one of the six bare bundles above**. All six generic legs now carry an `exportBar` spec, so all
six are guarded today.

The hole that remains is the *next* leg. A cfg added without `exportBar` silently reverts to the
token/label predicate and is hollow again, with nothing to say so. So `renderCoverageApp` now asserts
its own guard:

```
add(g, 'leg declares an export-bar guard (its token/label settle alone is satisfiable by the empty app)',
    !!cfg.exportBar, 'add exportBar:{want:[…]} to this cfg — see …-FOLLOWUPS §1');
```

An unguarded full leg is now a **red**, not a quiet pass. This is the `no silent caps` principle
applied to the gate itself.

## 2 · The bespoke legs were audited too, and they are sound

`ECGDex`, `CPAPDex` and `IntegratorPB` do not run through `renderCoverageApp`, so the parent's settle
change does not reach them. They were checked separately and need no change — each already settles on
something an empty app cannot produce:

| leg | settle condition | why it cannot go hollow |
|---|---|---|
| **ECGDex** | ≥6 of `.m-val/.kpi-val/.q-val/.kpi-num` contain a digit, **and** `bpm` in text | counts POPULATED VALUE CELLS, not body tokens — the distinction the generic legs lack |
| **CPAPDex** | `#resultsView` displayed **and** ≥2 `canvas[data-chart]` | the results view is hidden until a recording is scored |
| **IntegratorPB** | `#findings` contains "periodic breathing" | a named finding, then asserts both observer nodes by name |

An earlier pass of this audit **wrongly flagged ECGDex as hollow** — because it applied the generic
body-token proxy instead of ECGDex's real predicate. The correction is the finding worth keeping:
*counting value cells is a materially stronger test than counting numbers in `innerText`*, and it is
what the generic legs should eventually adopt if the export-bar guard ever proves insufficient.

## 3 · Not taken

- **Rewriting `minNums`/`minChars` into value-cell counts** for the six generic legs. The export-bar
  settle already makes them non-vacuous *in sequence* (they only run once a result is committed), so
  this would be churn for no measured gain. Recorded because it is the principled end state.
## 3.1 · WITHDRAWN — `OxyDex .dat` emits no `recording.coverage`

Parent §11 recorded this as a defect. **It is not one, and no fix should be made.** `oxyCoverage`
returns `null` when a night is contiguous — deliberately, and documented in place: *"Null when the
night is contiguous — the common case, and the one that keeps every clean export byte-identical"*, and
`segs.length < 2` ⇒ *"contiguous ⇒ no claim to make (DexExport contract)"*.

The two paths were compared on the **same night**, and they differ because the **recordings** differ,
not because the code differs:

| ingest | durationMin | `recording.coverage` |
|---|---|---|
| O2Ring `_STORED.dat` (device memory) | 442.9 | `null` — genuinely contiguous, nothing to declare |
| O2Ring BLE `_SPO2.csv` | 149.4 | `{kind:'sparse', segments:[…2…]}` — the BLE stream really did drop |

So the Integrator's *"OVERLAP COVERAGE 100 % · envelope basis — no node declared coverage"* on the
`.dat` night is **correct**: for a contiguous recording the envelope *is* the recorded time. Emitting a
`coverage` block there would be a claim with no content, and would move every clean export's bytes for
nothing.

**The generalisable error:** the parent inferred a defect from a DIFFERENCE BETWEEN TWO OUTPUTS without
checking whether the two INPUTS differed. Two ingest paths producing different provenance is only a bug
if they were given the same recording. Here the `.dat` is 7.4 h of uninterrupted device memory and the
CSV is 2.5 h of a BLE stream that dropped — the exports are each right about their own night.

## 3.2 · Still not taken
- **The ~42 min CPAP clock skew** (parent §7) and **OverDex's binary-EDF path** — unchanged, still
  owner's call / own work-unit.

## 4 · Done when

- [x] Every render-coverage leg audited against its own predicate on the bare bundle, and the result
      recorded as a number rather than an impression.
- [x] An unguarded full leg reds instead of passing quietly.
- [x] `Dex-Test-Suite.html?full` all-green · re-gated · changeset dropped.
- [x] The parent's `OxyDex .dat` coverage item checked before acting on it — and **withdrawn** (§3.1).
- **§4 DEFERRED** — value-cell counting for the generic legs. Not needed while the export-bar guard
  holds; recorded as the principled end state, not as owed work.
