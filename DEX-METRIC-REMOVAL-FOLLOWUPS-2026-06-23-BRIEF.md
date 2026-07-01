<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# DEX-METRIC-REMOVAL — Follow-ups

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-23 · **Owner brand:** Tepna
**Parent:** DEX-METRIC-REMOVAL-AUDIT-BRIEF.md (FULL-REMOVAL pass executed + gated 2026-06-23)

Captures what surfaced while executing the suite-wide removal of ANS Age + HRV/oximetry→BP +
Metabolic Age (all six nodes done, both gates green). Everything here is **non-blocking cleanup** —
no surfaced metric remains; these are stale data artifacts, dead code/CSS, and build-time scaffolds
that still *mention* the retired metrics. Read **CLAUDE.md** first; honor its gates. One focused PR each.

---

## 1. Regenerate the stale committed export fixtures (data currency)
Three committed `uploads/*.json` / `tests/fixtures/*.json` exports predate the removal and still carry
retired fields. They are **not gate-blocking** (the live exports already null these; no test value-checks
them — `validateExport` is structural, GATE B is manifestHash-gated and these are buildHash-legacy /
not in the sidecar), but regenerate them so the committed data matches shipped output:
- `uploads/HRVDex_2026-06-17_2055_summary.json` — still has `d_auto_age` + pre-WP-A `d_sbp_est`/
  `d_dbp_est`/`d_bp_risk`/`d_delta_sbp`. Re-run HRVDex.html (manifestHash 126c984b75a5) on its input,
  re-export, record the producing manifestHash in `FIXTURE-PROVENANCE.json` (or leave legacy).
- `uploads/ppgdex_20260616.json` — still emits `ansAge:36` (pre-WP-A). Re-run PpgDex + re-export.
- `tests/fixtures/oxydex.summary.json` — still has `ansAge:{proxy:…}` + `bpProj:{…}` blocks across all
  nights. This is the suite's STRUCTURAL test input (not value-gated), so it stays green, but it's stale.
  Regenerate from a current OxyDex run, OR strip the `ansAge`/`bpProj` objects (keep `ansAge:null`/
  `bpProj:null` to honor the P3 back-compat "Null personalization tolerated" test schema).

## 2. Scrub the codegen manifests (build-time scaffolds — not live, but stale)
`codegen/` is build-time scaffolding only (codegen/README.md: "nothing here is referenced by a
`*.src.html`"; the shipped reference guides are hand-finished, NOT auto-regenerated). So these are
**not urgent** and touch no gate, but scrub the retired metrics so a future `node dex-gen.js` /
`dex-analysis-gen.js` can't reintroduce them:
- `codegen/manifests/oxydex.manifest.json` — remove the `ansAge` metric def + the `bp-proj` section.
- Audit `pulsedex/ecgdex/ppgdex/hrvdex.manifest.json` for any `ansAge`, and `glucodex.manifest.json`
  for `metAge` / Metabolic Age; remove.

## 3. Dead `.readiness-ansage` CSS in OxyDex.src.html (cosmetic)
The OxyDex purge removed the "Projected ANS Age" hero-footer JS, but the `.readiness-ansage` style
rules (OxyDex.src.html shell `<style>`) are now orphaned dead CSS. Harmless (nothing emits the markup),
but remove for tidiness. NOTE: this is an inline `<style>` edit in the shell → it WILL move OxyDex's
`buildHash` and requires a re-bundle + BUILD-MANIFEST update + provenance run, so only batch it into a
re-bundle that's happening anyway (don't spend a standalone OxyDex re-bundle on dead CSS).

## 4. (Optional) Remove now-empty "Projection(s)" reference sections
After the card removals, the GlucoDex `#projections` section is empty (comment only), and OxyDex/HRVDex/
PulseDex `#projections` now hold only VO₂ cards. Consider dropping the empty GlucoDex section + its
quick-jump link entirely (currently left as a stub with a removal comment). Pure doc polish, no gate.

---

## Acceptance (each PR)
- [ ] No surfaced metric reintroduced; export-schema null keys preserved (P3 back-compat test).
- [ ] If an app `*-dsp/-render/-app/.src.html` changed: re-bundled + BUILD-MANIFEST +
      verify-provenance clean. Reference-guide / fixture / manifest-only edits need no re-bundle.
- [ ] `Dex-Test-Suite.html` all green (hard-reload to bust any stale cached `tests/dex-tests.js`).

---

## Execution note (2026-06-29)

The **actionable-now, no-re-bundle** cleanup is done; the re-bundle-gated + optional items are carried
by design (the brief itself says §3 must ride an existing OxyDex re-bundle, §4 is optional).

- **§1 fixtures —**
  - **`tests/fixtures/oxydex.summary.json` (the structural test input): DONE.** Surgically nulled
    `ansAge` (top-level) + `newMetrics.bpProj` across **all 34 nights** (string-aware brace match — the
    rest of the file byte-unchanged), matching live OxyDex output (`oxyBuildNightElement` emits both
    `null`). Re-parses clean, 0 object residuals, −5.9 %. No test reads into `ansAge.proxy`/`bpProj.*`;
    the P3 back-compat group builds its OWN `{ansAge:null, bpProj:null}` input, so it's unaffected.
  - **`uploads/HRVDex_2026-06-17_2055_summary.json` + `uploads/ppgdex_20260616.json`: LEFT LEGACY**
    (the brief's sanctioned "or leave legacy"). These are **real committed exports** (house rule: don't
    hand-edit a real export), they're **ungated** (not value-checked, not in the `FIXTURE-PROVENANCE`
    sidecar), and a faithful re-run would now emit the **Phase-9 node-export envelope** — a *shape*
    change, not a field-strip — so regenerating is out of scope for a currency-only cleanup. Recorded,
    not punted.
- **§2 codegen manifests — DONE.** Removed the `ansAge` metric def + the whole `bp-proj` section from
  `codegen/manifests/oxydex.manifest.json` (valid JSON, no `ansAge`/`bp-proj`/`sbpProjection` tokens
  left). Audited the other six manifests — **clean** (no `ansAge`/`metAge`). Build-time scaffold, no
  gate, no re-bundle.
- **§3 dead `.readiness-ansage` CSS — CARRIED (ride the next OxyDex re-bundle).** Per the brief, an
  inline-`<style>` shell edit moves OxyDex's `buildHash` + forces a re-bundle, so it must NOT be a
  standalone pass. Whoever next re-bundles OxyDex (e.g. SELF-INGEST, or ENVELOPE-FOLLOWUPS work)
  should drop these orphaned rules in the same pass.
- **§4 empty "Projections" reference sections — DECLINED (optional).** Pure doc polish that touches the
  reference guides near the `cohesion-badges` gate; not worth the risk for a palate-cleanser. Left as a
  standing optional.

**Gates:** no bundle changed (fixture + codegen-manifest edits only) → `verify-provenance` GATE A/B
unaffected; `Dex-Test-Suite.html` all-green **1464/91** (oxydex.summary structural + no-NaN groups pass
over the nulled fixture). No `FIXTURE-PROVENANCE` change (`oxydex.summary` is a `tests/fixtures` file,
not a sidecar-gated `uploads/*.json`).

**No -II spawned:** the residue (§3 ride-along + §4 optional + §1 leave-legacy) is fully captured in
this header — all are standing/optional items, not new discoveries needing their own brief.
