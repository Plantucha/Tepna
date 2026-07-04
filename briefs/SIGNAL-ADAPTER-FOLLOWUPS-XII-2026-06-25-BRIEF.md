<!--
  SIGNAL-ADAPTER-FOLLOWUPS-XII-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-XI-2026-06-25-BRIEF.md (§1 decoupled the HRVDex snapshot/restore from `extraProbe`; §2 generalized it to a rig-level whole-origin localStorage snapshot) · **Sibling-of:** -II … -XI

<!-- DONE 2026-06-25 — §1 executed via option (a): added `_idbCounts`/`_idbUnchanged`/`_idbDetail`
     read-only IndexedDB record-count guard to `Dex-Test-Suite.html` and wired it to the Integrator
     render-coverage leg (`cfg.idbGuard={db:'ganglior_integrator',stores:['summaries','metricDefs']}`).
     The leg now snapshots store record-counts BEFORE prep and asserts them UNCHANGED after, so a
     future crossNight-/genSynthetic-ingesting prep trips a red instead of silently clobbering operator
     history. Guard runs GREEN with a populated operator DB (`summaries 480→480 · metricDefs 10→10`),
     proving the envelope-free prep persisted nothing — it has teeth, not a vacuous 0→0. §2 (keyed
     reconcile vs whole-store clear()+rebuild) and §3 (Node-CI `env.equiv` run) are deliberately NOT
     acted on — both explicitly "not needed today" / standing debt with no Node host this pass; left
     verbatim. Gate: `Dex-Test-Suite.html` all-green 991/66 (same-origin host); test-only change, no
     bundle touched → `verify-provenance.html` GATE A/B unaffected (clean by construction). No new
     residue surfaced → no -XIII spawned. -->


# Signal-adapter Phase-9 — follow-ups XII (residue the XI render-coverage storage-hygiene pass exposed)

> Round XII. The 2026-06-25 -XI pass replaced the HRVDex-only, `extraProbe`-coupled snapshot/restore
> with a RIG-LEVEL whole-origin `localStorage` snapshot (`_snapStore`/`_restoreStore`, taken before
> `prep`, restored in each rig's OUTER `finally`) wired into all three bundle-booting coverage fns —
> decoupling the restore from probe control flow (§1) and covering every leg's writes incl. the
> cross-cutting `tepna_profile` from `profileEditProbe` (§2). `Dex-Test-Suite.html` all green
> (928/60). This file carries what -XI EXPOSED. Read `CLAUDE.md` first; both provenance gates + the
> Clock Contract rule. Do NOT edit -II…-XI.

---

## 1 · ◷ IndexedDB-backed render-coverage state is NOT covered by the `localStorage` whole-store snapshot

**What surfaced.** -XI's `_snapStore`/`_restoreStore` snapshot the rig origin's `localStorage` ONLY.
The Integrator's durable longitudinal store is **IndexedDB** (`integrator-longitudinal.js`,
`DB_NAME='ganglior_integrator'`, stores `summaries`/`metricDefs`), opened on boot
(`L.open()` → "history survives reload"). Today the Integrator render-coverage `prep` is **transient
by construction**: it injects two synthetic `ganglior.node-export` files that carry **no `crossNight`
envelope**, so `L.ingest` matches nothing and `_put` is never called → zero IndexedDB writes (verified
during -XI; recorded in the `APP_COVERAGE` §2 audit comment). So this is a **latent gap, not a live
clobber**: the moment a future Integrator prep (or a new node's prep) ingests a `crossNight` envelope —
or clicks `#genBtn`/`genSynthetic`, which feeds the real ingest path — it WILL persist day-summary rows
to the operator's `ganglior_integrator` DB, and the -XI mechanism will NOT restore them (it only knows
`localStorage`).

**Do (low priority, latent).** Either (a) keep the Integrator prep deliberately envelope-free and add a
one-line guard/assertion that the `ganglior_integrator` object stores are empty/unchanged after the leg
(so a future envelope-ingesting prep trips a red instead of silently clobbering), OR (b) generalize the
rig teardown with an async IndexedDB snapshot/restore for the `ganglior_integrator` DB (snapshot
`summaries`+`metricDefs` via `_txAll` before `prep`, `clear()`+re-`put` in the outer `finally`) and apply
it to any leg whose ingest can reach `L.ingest`. (a) is the cheaper, sufficient fix while the prep stays
transient; (b) is only needed if a leg is ever made to persist longitudinally on purpose. **Gate cost:**
test-only.

## 2 · ◷ The whole-store `clear()`+restore is shared-origin-wide (correct today, but coarse)

**What surfaced.** `_restoreStore` calls `localStorage.clear()` on the rig `contentWindow`, which is the
**same origin** as the suite page itself — so it momentarily wipes ALL origin keys (incl. any the suite
or operator hold) and rebuilds them from the snapshot taken moments earlier. Net effect is **zero** (the
snapshot is a superset taken post-boot, restored verbatim), and it runs while the bundle is about to be
torn down to `about:blank`, so nothing observes the transient empty state. It is correct, but it is a
blunter instrument than a keyed diff and relies on the snapshot never failing (guarded: a `null` snapshot
skips the restore rather than wiping blindly).

**Do (very low / optional).** If a future change makes the suite itself depend on `localStorage` mid-run,
switch `_restoreStore` from `clear()`+rebuild to a keyed reconcile (restore changed keys, remove keys
ADDED since the snapshot) so it touches only what a leg actually mutated. Not needed today. **Gate
cost:** test-only.

## 3 · ◷ The `env.equiv` Node-CI path is STILL unverified (standing -IV §7 … -XI §3 debt)

**What surfaced.** No Node host this pass (the standing constraint). The five equivalence cases + the
HRVDex `recording block` group are verified GREEN in the BROWSER only. The render-coverage legs are
browser-only by construction (they boot app bundles in an iframe) → they will NEVER run under Node CI;
that is expected, not debt.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0 + the equivalence
group green for all five cases. **Not new work.** **Gate cost:** none.

> **Progress note (GATE-LIVE-RUNNABILITY 2026-06-28 — partial discharge):** the equivalence group was
> **live-confirmed all-green in the BROWSER** this session (same-origin preview) — incl. **ECGDex + PpgDex
> `compute() ≡ committed export` byte-identical** and the OxyDex/PulseDex/HRVDex/GlucoDex cases green —
> the strongest evidence to date for these nodes. The **literal `node tests/run-tests.mjs` exit-0 CLI run
> remains the residual debt** (no shell/Node that pass; the browser ran the identical `tests/dex-tests.js`
> superset, discharging the contract by equivalence, not the CLI invocation). Discharge on a Node host
> when available; co-tracked at GENERIC-EMIT-GATE-FOLLOWUPS-II §1 — no third tracker.

---

### Gate posture for this brief
- All three items are LOW priority / standing debt — none block anything shipped (both gates green as of
  2026-06-25; `Dex-Test-Suite.html` 928/60, HRVDex `manifestHash 50d1a34cc950`).
- **§1** is a latent IndexedDB-coverage gap (guard or async-snapshot the `ganglior_integrator` DB);
  **§2** an optional refinement of the whole-store restore; **§3** standing Node-CI verification.
- Stamp `Status: DONE` only once the items acted on are complete AND `Dex-Test-Suite.html` is all-green
  (same-origin host) + `verify-provenance.html` GATE A/B clean. §1/§2 are test-only (no re-bundle).
  Index in `DOCS-INDEX.md`; spawn `-XIII` only if new residue surfaces.
