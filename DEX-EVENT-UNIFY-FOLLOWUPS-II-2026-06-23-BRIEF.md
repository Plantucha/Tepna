<!-- SPDX-FileCopyrightText: 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Dex Event-Unification — Follow-ups, Round II

**Status:** DONE — 2026-06-30 · **Created:** 2026-06-23 · **Owner brand:** Tepna
**Parent:** DEX-EVENT-UNIFY-FOLLOWUPS-2026-06-23-BRIEF.md (§1 + §2 executed 2026-06-23)
**Supersedes:** — · **Follow-up:** PPGDEX-DAWN-SQI-FOLLOWUPS-2026-06-30-BRIEF.md (residue from the paired LOW-remainder sweep — the PpgDex sqi-drop finding+fix + deferred committed byte-fixtures + the co-load keep-gated decision)
<!-- Executed 2026-06-30 (all gate-green — Dex-Test-Suite all-green 1530/97, verify-provenance GATE A 8/8 + GATE B reproducible, 0 drift):
  §1 DONE (PERF MEMOIZE) — processNight computes the trailing-p90 CEILING baseline (computeCeilingBaselineArr,
     WIN=300/pct=90) ONCE and threads it as opts.blArr through ALL 11 desat consumers (detectODI ×2,
     computeDesaturationProfile, computeSBII, computePRED3p, computeDesSev, computeODI1, computeDesatSlopes,
     computeRollingMetrics post-dip, computeBreathingIrregularity, computeSpO2Advanced/WtDSI, computeHypoxicLoad).
     blArr is a pure function of (spo2,WIN,pct) and every consumer used those defaults → ~11 redundant O(n·101)
     histogram walks collapse to 1 with BIT-IDENTICAL numbers; detectDesatEvents still falls back to computing
     blArr when absent (every direct/test caller unaffected). LOCKED behind the equiv gate: OxyDex.compute() ≡
     committed export BYTE-IDENTICAL (the must-not-change-numbers proof).
  §2 DONE — dropped the vestigial desat.nadir.count pre-gates in computeRollingMetrics post-dip (>0) +
     computeBreathingIrregularity (<3); they gated on the simple-close self-gated nadir.count, a DIFFERENT set
     than the hysteresis-close set those fns score — the real gate is each fn's own event-count check
     (postDipDeltas.length / nadirTimes.length). Metric-inert on the committed CSV (nadir.count=14).
  §3 DONE (decided: keep BOTH close modes, document) — the shared primitive runs TWO close modes BY DESIGN:
     SIMPLE re-rise for the ODI-COUNT family (must be event-for-event with the headline ODI) and anti-chatter
     HYSTERESIS for the SATELLITE stats (slopes/post-dip/breathingIrreg/WtDSI). They agree on the committed CSV,
     can diverge on edge data; NOT unified. Documented at detectDesatEvents + each call site.
  §4 DECLINED (optional, no value) — the OxyDex test fixtures are byte-identical after §1/§2 (equiv gate green),
     so refreshing them is a no-op; not value-gated. NOT regenerated; only manifestHash re-recorded.
  GATES: external-JS-only → OxyDex re-bundled manifestHash 68614f5ed267→990cb3ee4737 (buildHash 04d85b8b647d
     UNCHANGED); BUILD-MANIFEST.json + FIXTURE-PROVENANCE.json (both OxyDex fixtures) re-recorded. tests/dex-tests.js:
     relaxed the P8 detectODI source-mirror regex to tolerate the threaded opts.blArr (contract unchanged). -->

Captures what surfaced while executing the §1 OxyDex desat-family unification (the 3 mean-baseline
families + the dip3 loop are now on the canonical `detectDesatEvents` primitive; `computeBaselineArr`
is grep-clean for desat detection in `oxydex-dsp.js`). All items here are **non-blocking polish** —
the correctness pass is done and gate-green. Read **CLAUDE.md** first; every gate it names applies
(Dex-Test-Suite green, verify-provenance clean, BUILD-MANIFEST + FIXTURE-PROVENANCE updated on
re-bundle, fixtures regenerated where math moves). One focused PR per item.

---

## 1. (was §3, deferred) Memoize the ceiling event set across OxyDex consumers — PURE PERF
Each consumer now calls `detectDesatEvents` independently, so a single `processNight` walks the
trailing-p90-ceiling histogram several times (ODI-4 set: detectODI + computeDesaturationProfile +
computeSBII + dip3Rate + slopes + hypLoad + post-dip + nadirBins; plus the ODI-3 set in PRED3p/dip3
and the ≥1% set in DesSev). Compute the ceiling-baseline array + the ODI-4 event set **once** in
`processNight` and thread them in as `opts.blArr` / a shared events handle (the primitive already
accepts `opts.blArr`). **Hard constraint:** must NOT change any number — lock it behind an
event-for-event equality check on the committed CSV before landing. Pure speedup, not a different lane.

## 2. Drop the now-vestigial `desat.nadir.count` guards
Several Task-A consumers still gate on `desat.nadir.count` (e.g. `computeBreathingIrregularity`
requires `>= 3`) — a coarse "are there any events" check from when the profile family ran a *separate*
loop. Now that `nadir.count == ODI-4` by construction, those guards are redundant (harmless today —
they pass — but they encode an assumption that no longer needs stating). Remove them or replace with a
direct check on the shared event set. Metric-inert if done carefully; still re-bundle + regen the
OxyDex fixture and re-gate because it touches `oxydex-dsp.js`.

## 3. Close-mode consistency note (decide, then document or unify)
`computeDesaturationProfile` / `computeSBII` / `dip3Rate` use the **simple re-rise close**
(`exitPct === ODI_DROP`) to match `detectODI`/ODI-4 event-for-event, while the earlier Task-A
satellites (slopes, hypLoad, post-dip HR, nadirBins) use the **default anti-chatter hysteresis**
close. On the committed CSV both yield the same 14-event ODI-4 set, but they can diverge on edge data
(a dip that re-rises into the hysteresis band but not past the entry threshold). Decide whether the
"one shared event set" should be ONE close mode fleet-wide, then either unify the calls or add a
one-line comment at each site stating the chosen close mode and why. No correctness bug today — this
is about making the shared-set invariant explicit so a future edit can't quietly assume both modes agree.

## 4. (Optional) Refresh `tests/fixtures/oxydex.summary.json` for currency
The committed test fixture is validated **structurally** by `validateExport` (finite numbers, present
fields, `summary.impression`/`ranked`) and is NOT value-gated, so it stayed green through §1 — but its
desat-profile/SBII/desSev numbers are now stale relative to current code. Regenerate it from a current
OxyDex run if you want the committed test input to reflect shipped output. Low value (no gate depends
on its values; the live render-coverage group already exercises current code).

---

## Acceptance (every PR here)
- [ ] Edited `*-dsp.js` / docs — never a bundled `*.html` by hand; re-bundled affected node(s).
- [ ] `Dex-Test-Suite.html` all green; `verify-provenance.html` no reds; `BUILD-MANIFEST.json` +
      `FIXTURE-PROVENANCE.json` updated; fixtures regenerated where math moved.
- [ ] ODI-4 / ODI-3 unchanged; `desat.nadir.count == ODI-4` invariant preserved; no new unbadged
      metric; Clock Contract untouched; no cross-node runtime dependency added.
