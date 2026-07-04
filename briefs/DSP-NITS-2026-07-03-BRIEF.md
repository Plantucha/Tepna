<!--
  DSP-NITS-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-03

# DSP/render nits — three low-severity fixes found in the 2026-07-03 code sweep

> **What this is.** A small punch-list from a read-through of the -Dex DSP/fusion/profile layers
> (2026-07-03). Nothing here is a crash or a wrong headline number; the sweep confirmed the codebase
> is clean and the big error classes (Clock Contract, fabricated absence) stay gated. These are the
> residue: one real-but-edge ordering bug, one dead/always-false block, one stale comment.
>
> **Sequencing (read before starting).** All three files ship inside a bundle, so each edit moves
> that app's `manifestHash` → the `CLAUDE.md` re-bundle checklist applies (GATE-A update + fixture
> handling). **Do NOT open a dedicated re-bundle just for these.** Land them on the **next re-bundle
> of each app for any reason**, or fold them into the `OWN-THE-BUILD` fleet re-bundle (Phase 3) —
> whichever comes first. After `OWN-THE-BUILD` Part A the whole ledger step collapses to
> `node tools/build.mjs --all`. Finding #1 is a genuine (low) correctness bug, so don't let it wait
> *indefinitely* on an unscheduled refactor — but it does not warrant its own re-bundle.

---

## Finding 1 · (LOW, correctness) longitudinal series sort mixes clock domains + misreads t0Ms===0

**Where:** `integrator-longitudinal.js` — `seriesFor()`, the `.sort()` comparator:
```js
.sort(function(a,b){ return (a.t0Ms||Date.parse(a.date))-(b.t0Ms||Date.parse(b.date)); });
```
**Two defects:**
1. **`a.t0Ms || Date.parse(a.date)`** treats `t0Ms === 0` as falsy and falls through to `Date.parse`.
   `0` is the suite's **sanctioned "undated → anchor at 0" value** (ECGDex/RR exporters use it; see
   `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01`), so a legitimately-zero anchor is silently rerouted.
2. **Domain mix.** `t0Ms` is a **floating wall-clock** ms (Clock Contract §1); `Date.parse('YYYY-MM-DD')`
   is a **real-UTC** midnight instant. `it.date` is always `fmtDate(t0Ms)` (date-only, getUTC*-rendered),
   so the two keys differ by the viewer's tz offset. When a series has **some rows with `t0Ms` and some
   without**, the comparator mixes the two scales and can misorder adjacent/same-day rows.

**Why it's only LOW:** in the common path every row has a finite `t0Ms`, so the fallback never fires
and the sort is correct. The bug needs a mixed dated/undated series (or a `t0Ms===0` row).

**Fix (behavior-preserving for the common path):**
```js
function _sortKey(r){ return r.t0Ms != null ? r.t0Ms : (r.date ? Date.parse(r.date) : 0); }
… .sort(function(a,b){ return _sortKey(a) - _sortKey(b); });
```
Prefer `t0Ms` explicitly (`!= null`, not truthiness). The residual float-vs-UTC-midnight skew for
undated rows is bounded to one tz offset and only affects rows that lack `t0Ms` entirely — acceptable,
and documented in a one-line comment. Do **not** try to "fix" it by converting `t0Ms` to real-UTC:
that would break the floating-clock invariant. **Gate:** `integrator-longitudinal.js` is behavior-
gated by the Integrator's tests — re-run `Dex-Test-Suite.html?full`; add a tiny assertion that a
mixed `[{t0Ms:X},{t0Ms:null,date}]` series sorts by the dated rows' `t0Ms` and places `t0Ms===0`
first, not last.

## Finding 2 · (LOW, dead/always-false) OxyDex "morning %" reads a time component its date never has

**Where:** `oxydex-profile.js` — the per-night loop + its aggregate:
```js
if (n.date && n.date.split('T')[1] && parseInt(n.date.split('T')[1], 10) < 8) morningCount++;
…
var morningPct = n > 0 ? Math.round(morningCount/n*100) : 0;
```
**What's wrong.** An OxyDex night's `date` is **date-only** (`'YYYY-MM-DD'`, from `fmtDateUTC` — no
`T`, no time). So `n.date.split('T')[1]` is **always `undefined`**, the guard is permanently false,
and `morningCount`/`morningPct` are always `0`. Unlike HRVDex — whose working twin
(`hrvdex-profile.js`) computes `morningPct` from real `_date` objects and **surfaces** "X% morning" —
OxyDex never pushes `morningPct` into its auto-detect pills, so today it is **harmless dead code**.

**Fix (choose one, deliberately):**
- **(a) Delete** `morningCount`, the line-369 guard, and `morningPct` — OxyDex doesn't surface a
  morning-% pill and its nights are whole-night oximetry where "% morning measurements" is not
  meaningful anyway. *Preferred* — removes a broken computation, zero behavior change (EXPORT-INERT).
- **(b) Wire it correctly** only if a morning-% pill is actually wanted: derive the hour from the
  night's **`t0Ms`** via `getUTCHours()` (Clock Contract §5), not by string-splitting a date-only
  field, and push it into `parts`. More work; only do it if the feature is desired.

**Gate:** `oxydex-profile.js` ships in OxyDex → re-bundle checklist. Option (a) is EXPORT-INERT (no
fixture output moves; `manifestHash` moves on bytes only). Re-run the suite regardless.

## Finding 3 · (docs) stale comment on OxyDex clock-hour spike filter

**Where:** `oxydex-dsp.js` — `filterArtifactSpikes()` header comment says the filter removes spikes
"during overnight hours (00–05h)". The **v14 code filters ±2 min of ANY clock hour** (the `:58–:02`
window, no hour gate) — matching `cleanArtifactHR`'s soft-artifact rule. **Fix the comment** to match
the code (any clock hour, ±2 min); the code is correct, the prose drifted. Comment-only → EXPORT-INERT.

## Done when
- ☐ #1 fixed (explicit `!= null`, single-domain key, comment); mixed-series sort assertion added;
  `Dex-Test-Suite.html?full` green.
- ☐ #2 resolved by (a) deletion [preferred] or (b) `t0Ms`-`getUTCHours` rewrite; suite green.
- ☐ #3 comment corrected.
- ☐ Each touched app re-bundled **on its next re-bundle for any reason** (or the `OWN-THE-BUILD`
  fleet pass): `BUILD-MANIFEST.json` GATE-A updated; fixtures untouched unless #1 actually moves a
  longitudinal export's content (check — likely inert; if a fixture output moves, regenerate, never
  hand-edit).
- ☐ `verify-provenance.html` GATE A/B green after any re-bundle.
- ☐ `DOCS-INDEX.md` row added; flip this header to DONE only once the above land; follow-up brief or
  a "nothing surfaced" note.

## Cross-references
- `CLAUDE.md` §🔒 (Clock Contract — floating `t0Ms`, `getUTC*`, `0` is a valid anchor) · §🔏 (re-bundle
  checklist) · §🧪 (behavior gate).
- `briefs/OWN-THE-BUILD-2026-06-30-BRIEF.md` — the pass that makes the re-bundle step one command;
  the natural carrier for landing these.
- `briefs/DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md` — the "undated → anchor at 0" convention #1 must respect.
- `hrvdex-profile.js` — the correct morning-% twin referenced by #2.
