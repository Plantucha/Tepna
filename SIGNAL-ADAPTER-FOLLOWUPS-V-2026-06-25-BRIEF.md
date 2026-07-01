<!--
  SIGNAL-ADAPTER-FOLLOWUPS-V-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-06-25 (§1 DONE — zero-seed gate broadened + HRVDex re-bundled, both gates green; §2 DONE — tier-split rationale recorded, option b; §3 deferred-by-design to PulseDex's own pass; §4 carried — needs a Node host / interactive session) · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-III-2026-06-24-BRIEF.md (§1 native Baevsky guard) + SIGNAL-ADAPTER-AND-FRONTIER §8 #1/#2/#5 · **Sibling-of:** -II / -III / -IV
> **Progress 2026-06-25.** **§1 DONE** — `hrvdex-dsp.js computeDerived` now gates EVERY black-box-fed composite on ONE shared `_hasSubj` predicate (all six subjective inputs >0): `d_se_div`, `d_coh_energy`, `d_pti`, `d_sfd`, `d_focus_eff`, `d_hile` → NaN on a raw recording instead of a fabricated 0 (the three §8 #2 KPIs were already gated; `d_sdi` is measured-backed (LF/HF), intentionally left). HRVDex re-bundled (external-JS-only): manifestHash `dd380264fcef→ea74b3639c33`, buildHash `de20db283366` UNCHANGED; `BUILD-MANIFEST.json` GATE A updated; seconds-unit/Welltory files unaffected (subjective cols >0 → value-identical) so NO fixture drift; HRVDex still has no code-gated fixtures (GATE B clean). **§2 DONE** — option (b): the tier-split rationale (the named five at heuristic; siblings `pti`/`abs`/`coherence`/`focusEff`/`stress`/`energy` stay experimental ON PURPOSE — visibility-weighted, not oversight) is now recorded in `hrvdex-registry.js`; rode the same §1 re-bundle. Dex-Test-Suite all-green (+§1 source-mirror group), verify-provenance GATE A/B clean. **§3** (PulseDex `*Est` quarantine) is left to PulseDex's own next touch — NOT a drive-by, per the brief. **§4** (run `node tests/run-tests.mjs`; manual UI drop-through of -IV §1) is carried forward — no Node host / interactive session here.

# Signal-adapter Phase-9 — follow-ups V (what the HRVDex native-correctness pass exposed)

> Round V. The native-correctness pass (2026-06-25) executed **-III §1** + **AND-FRONTIER §8 #1(native)/#2/#5**
> in one HRVDex re-bundle: `computeDerived`'s `d_si`/`d_csi` now consume the SAME `DexUnits.guardBaevsky`
> the adapter uses (`quantity.js` added to `HRVDex.src.html`); `d_welfare`/`d_efc`/`d_ans_load` gate on
> subjective inputs PRESENT (>0) so a raw recording never surfaces a fabricated `0`; the five Welltory
> black-box composites (`welfare/efc/ansLoad/otr/crs`) were demoted `experimental→heuristic` in
> `hrvdex-registry.js` (guide + cohesion synced). HRVDex `manifestHash b06db90abaa7→dd380264fcef`
> (buildHash `de20db283366` unchanged); Dex-Test-Suite 950/64 all-green; verify-provenance GATE A/B clean.
> This file captures the residue that pass surfaced. Read `CLAUDE.md` first; both gates + the Clock
> Contract rule. Do NOT edit -II/-III/-IV.

---

## 1 · ✅ DONE (2026-06-25) — the zero-seed fabrication gate is now BROAD (every black-box-fed composite, via one shared predicate)

**What surfaced.** §8 #2 named `d_welfare`/`d_efc`/`d_ans_load` as the composites that surface a fake `0`
on a raw recording (subjective inputs seeded `0`). Gating those three closed the *named* gap, but the same
seed-`0` mechanism reaches **other** `computeDerived` outputs that read the black-box subjective columns:
`d_coh_energy` (`coherence·energy/100`→0), `d_pti` (`psns·rmssd/100`→0), `d_incoherent_stress`,
`d_sdi`, `d_se_div`, `d_hile`, and the `d_abs`/`d_focus_eff` family (some already collapse to `NaN` via a
`>0`/`+1` denominator, some don't — audit each). None is as load-bearing as the three KPI-grid composites
(most are research-tier table cells), which is why §8 #2 scoped to the three, but for full epistemic
consistency a raw recording should render **every** black-box-fed composite as `—`, not a seeded `0`.

**Do.** Audit each `computeDerived` output that reads `_stress/_energy/_focus/_coherence/_sns/_psns`; for
any that can yield a finite value when those inputs are absent (`0`), apply the same "inputs present (>0)"
gate used for the three. Prefer a small shared helper (e.g. `_hasSubjective(r)` = the six are all `>0`) over
repeating the predicate. **Gate cost:** node DSP edit → HRVDex re-bundle + GATE A manifestHash + both
gates (fold with item 2 — same file, one re-bundle). Seconds-unit/Welltory files are unaffected (their
subjective columns are `>0`), so no fixture drift.

## 2 · ✅ DONE (2026-06-25, option b) — black-box tier consistency: rationale recorded, named five stay heuristic

**What surfaced.** §8 #5 named exactly five composites (`welfare/efc/ansLoad/otr/crs`) to lower-tier, and the
pass demoted precisely those to `heuristic`. But other registry composites that ALSO cannot be computed
without a Welltory black-box input remain `experimental` — `pti` (PSNS×rMSSD), `abs` (PSNS/SNS balance),
`coherence`, `focusEff` (focus/(SNS+1)), and the `stress`/`energy` scores themselves. The five-vs-rest split
is the brief's explicit instruction (followed deliberately, not an oversight), but it leaves two composites
built on the same input class at different tiers, which a future reader may read as inconsistent.

**Do (decision).** Either (a) extend the `heuristic` demotion to every composite whose inputs include a
Welltory subjective score (consistent, but re-tiers ~6 more cards + their guide entries + cohesion sync), or
(b) record the rationale that the named five are the high-visibility KPI-grid/research composites and the
rest stay `experimental` by design. Pairs with item 1 (same registry/guide + re-bundle if (a)). **Gate
cost:** registry edit → HRVDex re-bundle + cohesion-badges (guide synced) if taken.

## 3 · ▸ DEFERRED-by-design (do during PulseDex's own pass) — PulseDex `*Est` quarantine still owed (the OTHER half of §8 #5)

**What surfaced.** §8 #5 lists PulseDex's `stressEst/energyEst/focusEst/cohEst` alongside the HRVDex five.
Only the HRVDex side was in scope this pass. PulseDex's Welltory-style composite estimates still carry their
current tier and are not yet quarantined to match.

**Do.** During PulseDex's next migration/touch (Phase-9, per-node), demote `stressEst/energyEst/focusEst/cohEst`
the same way + retire any wellness naming (LEXICON), syncing the PulseDex reference guide + cohesion. **Gate
cost:** PulseDex node edit → re-bundle + both gates; do per-node, not as a drive-by.

## 4 · ◷ Verification debt carried forward from -IV (NOT discharged this pass)

This pass was a **node-DSP correctness** leg; it did **not** clear the -IV verification items, which remain
owed:
- **-IV §7** — `node tests/run-tests.mjs` was **not** run (no Node in the execution environment, the same
  constraint that blocked it in §3). The browser `Dex-Test-Suite.html` is all-green (950/64) and shares
  `tests/dex-tests.js` by construction, but the `vm` LOAD of the namespaced DSPs (a Node-only setup path)
  is still unconfirmed. **Run `node tests/run-tests.mjs` once, confirm exit 0** the moment a Node host is
  available. The new HRVDex assertions added this pass (Baevsky parity + zero-seed source-mirror + registry
  demotion) run identically in both runners, so they ride along.
- **-IV §1** — drive the live `Data Unifier.html` / `OverDex.html` drop-zone UI end-to-end for a raw O2Ring
  CSV (OxyDex), a raw RR file (PulseDex), and a Welltory summary CSV (HRVDex). The HRVDex/Welltory path is
  the one this pass touched (computeDerived is the APP path, not the adapter `HRVDex.compute` path the
  Unifier uses — so the Unifier route is unaffected, but a UI smoke-confirm is still owed).

**Do.** Discharge -IV §7 + §1 when a Node host + an interactive session are available; they are **verification**,
not new code (zero gate cost). Until then they stay owed in -IV's header and here.

---

### Gate posture for this brief
- **Items 1, 2, 3** are node/registry edits → per-node re-bundle + both gates (items 1+2 fold into ONE HRVDex
  re-bundle; item 3 is a separate PulseDex bundle — do not fold).
- **Item 4** is carried-forward verification (zero gate cost; run when a Node host / interactive session exists).
- Stamp `Status: DONE` here only once the items you execute meet their "Do" AND `Dex-Test-Suite.html` is
  all-green + `verify-provenance.html` GATE A/B clean. Index in `DOCS-INDEX.md`; spawn `-VI` only if new
  residue surfaces.
