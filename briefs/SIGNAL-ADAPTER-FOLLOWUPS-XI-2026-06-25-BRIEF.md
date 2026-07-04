<!--
  SIGNAL-ADAPTER-FOLLOWUPS-XI-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-X-2026-06-25-BRIEF.md (§1 the HRVDex end-to-end isolation test + §2 the human-export scope hint) · **Sibling-of:** -II … -X · **Followed-by:** SIGNAL-ADAPTER-FOLLOWUPS-XII-2026-06-25-BRIEF.md

> **Executed 2026-06-25.** **§1 + §2 done as ONE mechanism.** Replaced the HRVDex-only,
> extraProbe-coupled `prep`-snapshot / inner-`finally`-restore (the restore-leak vector) with a
> RIG-LEVEL whole-origin localStorage snapshot taken right after boot / BEFORE `prep`, restored
> WHOLESALE (`clear()`+re-`setItem`) in each rig's OUTER `finally` (`_snapStore`/`_restoreStore`),
> wired into all three bundle-booting coverage fns (`renderCoverageApp`, `renderCoverageECGDex`,
> `renderCoverageCPAPDex`) — so the restore is decoupled from how `prep`/`extraProbe`/`profileProbe`
> exit. Whole-store (not per-key) because the audit it prompted found the clobber is broader than the
> brief named: **every** leg's `profileEditProbe` bumps the unified `tepna_profile` (not just
> OxyDex's `oxydex_last_*` / HRVDex's `hrvdex_rows_v1`). §2 audit recorded inline above `APP_COVERAGE`:
> OxyDex + HRVDex PERSIST; PulseDex/GlucoDex/PpgDex/Integrator transient ("no persist — no snapshot
> needed") — the Integrator's durable longitudinal store is **IndexedDB** (`ganglior_integrator`), and
> its synthetic node-exports carry no `crossNight` envelope so `L.ingest` writes nothing. **§3**
> standing Node-CI debt carried (no Node host this pass). `Dex-Test-Suite.html` **all green — 928
> passed / 60 groups** (same-origin host). Test-only: **no re-bundle**, provenance gates unaffected by
> construction. Residue → **-XII** (IndexedDB-backed render-coverage state is NOT covered by the
> localStorage snapshot — latent if a future Integrator prep ingests a `crossNight` envelope).

# Signal-adapter Phase-9 — follow-ups XI (residue the X end-to-end-test / export-hint pass exposed)

> Round XI. The 2026-06-25 -X pass closed all four -X items: §1 made the HRVDex render-coverage leg
> end-to-end (isolate one recording via `commitRows(parseRows,{replace}}` + operator-`localStorage`
> snapshot/restore; `exportGanglior()` ≡ `compute({text})` byte-identical, group 17/17 ✓); §2 recorded the
> human-export DECISION (filtered-view scope kept, option (a)) and shipped a VISIBLE export-bar scope hint
> (HRVDex re-bundled `94450ff5b53c`→`50d1a34cc950`, buildHash unchanged, both gates green); §3 the
> concurrent-run CONTRIBUTING note; §4 carried the Node-CI debt. This file carries what -X EXPOSED. Read
> `CLAUDE.md` first; both provenance gates + the Clock Contract rule. Do NOT edit -II…-X.

---

## 1 · ◷ The X §1 snapshot/restore only fires if `extraProbe` REACHES its `finally` (restore-leak on an early return)

**What surfaced.** -X §1 snapshots the operator's HRVDex running log in the HRVDex render-coverage `prep`
(BEFORE `loadPasted` persists synthetic rows) and RESTORES it in a `finally` inside `extraProbe`. But
`extraProbe` has an EARLY guard above the isolation block — `if(!(HD && typeof HD.compute==='function'))
return;` — and the seam-parity block before it. If `extraProbe` returns (or throws) before reaching the
`try/finally` that holds the restore, the `prep` snapshot is taken but **never restored** → the operator's
stored history stays clobbered with synthetic rows (the exact CLAUDE.md "never leave storage clobbered"
hazard the snapshot was meant to close). In practice `HD.compute` is always present once the bundle boots,
so the restore runs today — but the restore's correctness is COUPLED to `extraProbe` not short-circuiting,
which is fragile.

**Do (low priority).** Decouple the restore from `extraProbe`'s control flow: either (a) move the
snapshot+restore to wrap the WHOLE HRVDex leg in `renderCoverageApp` (snapshot right after the iframe
boots / before `prep`, restore in an outer `finally` after `extraProbe` returns), or (b) register the
restore as a teardown the rig always runs for the HRVDex config regardless of how `extraProbe` exits.
Note the pre-X behaviour was STRICTLY WORSE (prep persisted synthetic rows and nothing ever restored), so
this is a hardening of a now-mostly-correct path, not a regression. **Gate cost:** test-only.

## 2 · ◷ Other render-coverage `prep`s that drive a localStorage-backed app still clobber without restore

**What surfaced.** -X §1 added snapshot/restore for the HRVDex leg specifically (its `commitRows` persists
to `localStorage`). The audit it prompted shows HRVDex is not unique: any render-coverage `prep` that drives
a real bundle whose load/ingest path writes `localStorage` leaves operator state mutated for that origin.
OxyDex (`oxydex_*` night store) and the Integrator (durable longitudinal store, `init()` "history survives
reload") are the candidates to check; PulseDex/ECGDex/PpgDex/GlucoDex ingest is more transient but should be
audited the same way. This is the same class as the HRVDex finding, fleet-wide.

**Do (low priority, audit-then-fix).** For each render-coverage leg, determine whether its `prep`/boot writes
`localStorage`; where it does, apply the same snapshot-before-prep / restore-after pattern (ideally via the
§1 generalized teardown so it is ONE mechanism, not per-leg copies). Where ingest is transient (no persist),
record "no persist — no snapshot needed" next to the config so the audit is visible. **Gate cost:** test-only.

## 3 · ◷ The `env.equiv` Node-CI path is STILL unverified (standing -IV §7 / -V §4 / -VI §3 / -VII / -VIII §2 / -IX §4 / -X §4 debt)

**What surfaced.** No Node host this pass (the standing constraint). The five equivalence cases + the HRVDex
`recording block` group + the new X §1 end-to-end isolated diff are verified GREEN in the BROWSER only. The
render-coverage §1 spot checks are browser-only by construction (they boot app bundles in an iframe) → they
will NEVER run under Node CI; that is expected, not debt.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0 + the equivalence group
green for all five cases. **Not new work.** **Gate cost:** none.

---

### Gate posture for this brief
- All three items are LOW priority / standing debt — none block anything shipped (both gates green as of
  2026-06-25, HRVDex `manifestHash 50d1a34cc950`).
- **§1** decouple the HRVDex snapshot/restore from `extraProbe`'s control flow; **§2** fleet-wide
  render-coverage storage-hygiene audit (apply the same pattern where a leg persists); **§3** standing
  Node-CI verification.
- Stamp `Status: DONE` only once the items acted on are complete AND `Dex-Test-Suite.html` is all-green
  (same-origin host) + `verify-provenance.html` GATE A/B clean. §1/§2 are test-only (no re-bundle).
  Index in `DOCS-INDEX.md`; spawn `-XII` only if new residue surfaces.
