<!--
  WELLTORY-COMPOSITES-ENDGAME-2026-07-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-01 · **Created:** 2026-07-01 · **Decision:** option **A (RATIFY QUARANTINE — terminal)** · **Follows:** `SIGNAL-ADAPTER-FOLLOWUPS-V-2026-06-25-BRIEF.md` §2 (the tier-split, option b) + `SIGNAL-ADAPTER-FOLLOWUPS-III-2026-06-24-BRIEF.md` §2 (the `meta.derived` audit-only note)

> **EXECUTED 2026-07-01 — a pure DECISION pass. No code, no re-bundle, no fixture change**, so no gate
> could move (both were green going in and remain so). This brief exists to convert a standing "which way
> does the Welltory-composite dependency end?" question from an *inheritance* into a *recorded, closed
> decision*, per the CLAUDE.md brief-lifecycle convention (ADR-style: the decision lives in a dated,
> immutable-filename doc; the machinery it ratifies already ships and is test-backed).

# The Welltory closed-input composites — endgame decision

## The question
HRVDex (and the `welltory-summary` adapter) consume Welltory's **BLACK-BOX subjective scores**
(`Stress(HRV)` / `Energy` / `Coherence` / `Focus` / `SNS` / `PSNS`) — a proprietary, undocumented,
closed-input dependency. Two defensible terminal states were on the table:

- **A — RATIFY QUARANTINE (terminal).** Keep consuming the black-box columns, but leave every metric that
  depends on them *visibly second-class* through the existing multi-layer quarantine. The dependency stays;
  its epistemic status is honestly marked and can never pose as measured.
- **B — CUT THE CLOSED-INPUT DEPENDENCY.** Stop ingesting the six subjective columns entirely and drop every
  composite that needs them (`ansLoad`/`efc`/`welfare`/`otr`/`crs`/`pti`/`abs`/`coherence`/`focusEff` +
  the passed-through `stress`/`energy`), keeping only the transparent, self-computed standard HRV
  (`rMSSD`/`SDNN`/`Mean RR`/`MxDMn`/`pNN50`/`AMo50`/`Mode` and everything derived purely from them —
  which ANY HRV app exports, not a Welltory secret).

## The decision — **A**
Ratify quarantine as the **terminal** state. The closed-input composites stay, governed by the quarantine
that is already built, layered, and gated. B is **explicitly declined** (not deferred — see "revisit trigger").

### Why A over B
1. **The honesty gain of B is marginal.** The quarantine already makes it *impossible* for a black-box score
   to reach a user (or the Integrator) dressed as a measured fact — the whole risk B removes is already
   removed by tagging, not by deletion. B trades a small additional purity increment for permanent removal of
   ~10 user-facing metrics people may rely on.
2. **B is a one-way door with real cost.** It is a compute change in `hrvdex-dsp.js` + the adapter → HRVDex
   re-bundle → the `hrvdex` equivalence fixture's OUTPUT bytes move (regen + GATE A/B + equiv re-record) →
   cohesion re-sync for every removed card + its reference-guide entry. High churn, irreversible feature loss.
3. **The Integrator doesn't even weight the tag yet.** `effConf`/fusion ignore `meta.derived` today (it is
   AUDIT-ONLY — SIGNAL-ADAPTER-FOLLOWUPS-III §2 / the adapter's own NOTE), so a black-box composite currently
   fuses at the same weight as a measured surge. The *first* honesty win available here is wiring that
   down-weight — a far higher-value, lower-cost move than deleting the inputs. A leaves that door open; B
   closes it by removing the subject entirely.
4. **The transparent metrics are unaffected either way.** `rMSSD`/`SDNN`/`Mean RR`/… are self-computed from
   the RR/summary numbers, not from Welltory's secret sauce; A keeps the black-box composites *alongside*
   them, honestly tiered, rather than throwing the transparent baby out with the black-box bathwater.

### What "quarantine" concretely IS (the machinery this decision ratifies — all already shipped + gated)
- **Adapter (`adapters/welltory-summary.js`).** The built frame is stamped `provenance.derived = true` +
  a `derivedNote` naming the six black-box columns; the emitted `stress_high` event is tagged
  `meta.derived` / `'heuristic'` in the shared builder.
- **Registry (`hrvdex-registry.js`).** The five high-visibility, KPI-grid / headline composites that CANNOT
  exist without a black-box input (`ansLoad`/`efc`/`welfare`/`otr`/`crs`) are demoted `experimental→heuristic`
  (SIGNAL-ADAPTER-FOLLOWUPS-V §2, option b — the visibility-weighted tier split). Their lower-visibility,
  research-depth siblings (`pti`/`abs`/`coherence`/`focusEff`/`stress`/`energy`) stay `experimental` ON
  PURPOSE — the recorded, deliberate split, not an oversight.
- **Zero-seed gate (`hrvdex-dsp.js` `computeDerived`).** On a raw (non-Welltory) recording every black-box-fed
  composite renders `—` (NaN) via the shared `_hasSubj` predicate, never a fabricated `0`
  (SIGNAL-ADAPTER-FOLLOWUPS-V §1).
- **Evidence badges.** Every surfaced composite carries its (now-honest) tier badge by the COVERAGE MANDATE,
  so the second-class status is visible at the point of reading, not buried in a doc.

### Revisit trigger (what would reopen B)
This decision is terminal **unless** one of these changes the cost/benefit:
- The σ paper's reviewers require a *provenance-pure* pipeline with **zero** closed-input dependency for the
  HRV claims (then B becomes a paper-gated necessity, not a nicety).
- Welltory changes terms such that ingesting the columns is no longer permissible.
- The `meta.derived` fusion down-weight (the higher-value move, above) lands and a black-box composite is
  *still* found to mislead in practice.

Absent a trigger, do NOT re-open — cite this brief.

---

### Gate posture
Decision-only. No `*.js` / `*.src.html` edit, no re-bundle, no `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json`
change → `Dex-Test-Suite.html` and `verify-provenance.html` are untouched by this pass (both green going in).
No follow-up brief: the decision closes the question and spawns no new residue. Indexed in `DOCS-INDEX.md`.
