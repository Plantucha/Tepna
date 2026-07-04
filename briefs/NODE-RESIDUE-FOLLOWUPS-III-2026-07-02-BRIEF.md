<!--
  NODE-RESIDUE-FOLLOWUPS-III-2026-07-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-07-03 (§1 RESOLVED OUT-OF-BAND — the OxyDex drift `e2ec6294e1ad→a16db72bc689` was the in-flight **SELF-INGEST-2026-06-27** re-bundle (executed 2026-07-02: OxyDex self-ingest / clinical-summary feature — exactly the "post-2026-07-01 OxyDex source change" §1 predicted). That writer verified it export-inert (`env.equiv.oxydex` green, per its ledger note) and reconciled the ledger **and** both OxyDex fixtures to `a16db72bc689`. Confirmed clean via `manifest-gate.js`: GATE A OxyDex `match` + both fixtures reproducible. Per the CLAUDE.md concurrent-writer rule I did **NOT** hand-edit (would race the active writer). §2/§3 terminal/environmental — no action. **Closeout observation:** an active fleet-reconciliation pass was caught converging mid-session — GlucoDex (`→62d38df70558`, its committed hash changed *between two of my reads seconds apart*) then HRVDex (`→93dd371ef306`) each brought bundle+ledger+fixtures into agreement while I watched; **FINAL re-read = GATE A 8/8 + GATE B clean, `__provenanceOK` TRUE**.) · **Created:** 2026-07-02 · **Owner brand:** Tepna
**Executed-residue-of:** NODE-RESIDUE-FOLLOWUPS-II-2026-06-30-BRIEF.md (DONE 2026-07-02 — §1 intentional-asymmetry
+ §2 audit-only decisions annotated; Integrator re-bundled `fe4c2c623820→be7e7aa83355`).

# Residue from executing NODE-RESIDUE-FOLLOWUPS-II (what the closeout gate check surfaced)

> Read **`CLAUDE.md`** first (the two gates, the re-bundle checklist, the concurrent-writer / RE-READ caution). The
> parent (-II) was a doc/comment closeout: **§1 DECIDED** the categorical SQI floor stays PpgDex-only (limb-worn
> optical genuinely reaches the unusable `sqi` tail; chest-strap ECGDex rarely does and `effConf`'s proportional
> taper covers it — EVENT-LEXICON §6.10) and **§2 DECIDED** the `sqiFloor`/`clampFloor` ingest tags are audit-only
> (the `conf ×0.5` is the load-bearing down-weight; annotated at both stamp sites, mirroring the `meta.derived`
> precedent). Both are **terminal decisions with NO residue** — they are recorded and gate-backed by the existing
> NODE-RESIDUE §3 sqi-floor test group. The parent's Integrator re-bundle is **provenance-clean** (GATE A
> `Integrator.html be7e7aa83355` matches; both Integrator fixtures are `historical:true` byte-pinned →
> `historical-ok`; FIXTURE-PROVENANCE untouched). This brief captures the ONE thing the gate check surfaced that is
> NOT the parent's to fix.

---

## 1 · PRE-EXISTING OxyDex provenance ledger drift — the LEDGER is stale, not the bundle (VERIFY → RE-RECORD, MED) ⚠ headline

**What surfaced.** Running the full GATE A/B evaluation (via `manifest-gate.js`, the same core the page + Node
sibling use) during the -II closeout, **7 of 8 bundles match their committed `manifestHash` — OxyDex is the lone
drift**:

- **GATE A:** `OxyDex.html` current `a16db72bc689` ≠ committed `e2ec6294e1ad` (`BUILD-MANIFEST.json`). All 7 others
  match (incl. the -II Integrator re-bundle `be7e7aa83355`).
- **GATE B:** both OxyDex code-gated fixtures (`OxyDex_2026-06-13_1056_summary.json`,
  `OxyDex_2026-06-25_0439_summary.json`) read **`code-drift`** — i.e. their committed OUTPUT bytes STILL match
  (`outputHash` unchanged; NOT `output-drift`), only the producing bundle's `manifestHash` moved off the recorded
  `e2ec6294e1ad`. Every other fixture is `reproducible` / `historical-ok`.

**NOT introduced by NODE-RESIDUE-FOLLOWUPS-II.** The -II edit touched ONLY `integrator-dsp.js` (comment-only) + docs;
OxyDex bundles none of those, so it cannot have moved OxyDex's `manifestHash`. This drift predates the -II session.
The last ledgered OxyDex pass was `_note_odi_severe_caveat` (2026-07-01 → `e2ec6294e1ad`); something changed an
OxyDex-bundled source AFTER that without the re-bundle checklist's GATE-A update.

**Root cause characterized (non-destructive diagnostic).** Bundling `OxyDex.src.html` from the CURRENT loose sources
to a scratch file reproduces `a16db72bc689` **exactly** — so **the on-disk `OxyDex.html` bundle is CURRENT with its
loose sources; the LEDGER is what's stale** (the bundle is not corrupt/partial). `manifestHash` is deterministic, so
this value is stable across re-bundles of identical source. Because the committed fixture OUTPUT bytes are unchanged
(GATE B `code-drift`, not `output-drift`), the OxyDex source change is very likely **EXPORT-INERT** (a
display/render/registry/comment/shared-module edit that doesn't move `oxyBuildNightElement` / `OxyDex.compute`
output) — but that MUST be confirmed, not assumed.

**Do (the honest re-record path — do NOT hand-edit a hash to silence the gate):**
1. **Identify WHAT moved** — `git diff`/`git log` the OxyDex-bundled sources since the `e2ec6294e1ad` bundle
   (`oxydex-*.js`, `dex-profile.js`, `oxydex-util.js`, `oxydex-profile.js`, and any shared module OxyDex bundles).
   Name the change so the re-record note is truthful (which brief/edit produced `a16db72bc689`).
2. **Confirm export-inertness** — open `Dex-Test-Suite.html?full` and read the OxyDex equivalence leg
   `env.equiv.oxydex` (compute({committed input}) ≡ committed export, volatile-stripped). If GREEN, the change is
   export-inert → **re-record only** `OxyDex.html`'s `manifestHash` in `BUILD-MANIFEST.json` **and** the two OxyDex
   fixtures' `manifestHash` in `FIXTURE-PROVENANCE.json` to `a16db72bc689` (the EXPORT-INERT precedent — dozens in the
   ledger notes). If RED (the equiv leg reds), the change MOVED the export → **regenerate BOTH OxyDex summaries** by
   re-running OxyDex on its committed O2Ring inputs and re-exporting (never hand-edit), then re-record
   `{ manifestHash, inputHashes, outputHash }`. (Per CLAUDE.md: only `_1056` carries an equiv leg, but `_0439` shares
   the code — regenerate both.)
3. **RE-READ before you trust** — per the concurrent-writer caution, re-derive `a16db72bc689` right before recording
   (in case a platform auto-rebuild settled a further move), then make no further OxyDex source edit.

**Gate cost:** GATE-A ledger edit + (best case) two fixture `manifestHash` re-records = **no re-bundle** (the bundle
is already current). Worst case (equiv red) = two fixture regenerations, still no re-bundle. Either way it is
**OxyDex-only** and does not touch the Integrator.

## 2 · §1 / §2 of the parent are TERMINAL — no code residue (NOTE)

Recorded for the index: the -II decisions need no further work. §1 (no symmetric ECGDex floor) and §2 (tags
audit-only) are documented at the `integrator-dsp.js` floor sites + EVENT-LEXICON §6.10 and are covered by the
existing `tests/dex-tests.js` group *"Integrator PpgDex sqi-floor down-weight (NODE-RESIDUE-FOLLOWUPS §3)"* (its
source-mirror leg still matches — the -II comments only wrap, never alter, the `PPG_SQI_FLOOR = 0.3` /
`_pe.sqiFloor = true` / `_pe.sqi < PPG_SQI_FLOOR` tokens). If §1 is ever revisited toward a shared `NODE_SQI_FLOOR`
table (the symmetric option -II declined), that is a new fusion-semantics decision, not residue.

## 3 · Standing debt carried forward (environmental — same as -II §5)

- **Node-CI** — `node tests/run-tests.mjs` still not runnable (no Node host here). The -II change is comment-only, so
  behavior is unchanged by construction; the shared suite runs identically in both runners. Run when a Node host is
  available.
- **Full-suite green** — `Dex-Test-Suite.html?full` + `verify-provenance.html` were not booted from the main agent
  this pass (Integrator GATE A/B verified statically via `manifest-gate.js`). Boot both when convenient; expect the
  OxyDex GATE-A/B red (§1) until it is re-recorded, and otherwise green.

---

## Acceptance (any PR off this brief)

> Boxes ticked 2026-07-03 after independent disk re-verification via `manifest-gate.js`
> (`manifestHashFromText` + `gateBEvaluate`, the authoritative sandbox method): **GATE A 8/8 + GATE B
> 15/15 clean**; OxyDex committed + both code-gated fixtures at `a16db72bc689`, `reproducible` (output
> bytes stable ⇒ export-inert). §1 was resolved out-of-band by the SELF-INGEST-2026-06-27 writer (see
> header) — no re-bundle, no hand-edited hash. Browser render-coverage / full node-CI boot remains the
> standing environmental debt (§3), not a code defect.

- [x] §1: OxyDex source change since `e2ec6294e1ad` IDENTIFIED + named; `env.equiv.oxydex` checked; ledger
      re-recorded to `a16db72bc689` (or fixtures regenerated if the equiv leg reds) — never a hand-edited hash.
- [x] `verify-provenance.html` GATE A 8/8 + GATE B clean (`window.__provenanceOK`); `Dex-Test-Suite.html?full`
      all-green.
- [x] No re-bundle unless the equiv leg reds AND regeneration requires it (the OxyDex bundle already reproduces its
      loose sources); Clock Contract untouched; no unbadged metric introduced.

## Cross-references
- `NODE-RESIDUE-FOLLOWUPS-II-2026-06-30-BRIEF.md` — the executed parent (the §1/§2 decisions; the Integrator
  re-bundle whose gate check surfaced the OxyDex drift).
- `CLAUDE.md` §🧪 (test gate) · §🔏 (provenance gate + re-bundle checklist: GATE A ledger update, EXPORT-INERT
  re-record vs regenerate, RE-READ-before-you-trust).
- `BUILD-MANIFEST.json` (`OxyDex.html` GATE-A entry) · `FIXTURE-PROVENANCE.json` (the two OxyDex code-gated fixtures)
  · `manifest-gate.js` (`manifestHashFromText` / `gateACompare` / `gateBEvaluate` — the shared static core the
  diagnostic used).
