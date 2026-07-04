<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-04 · **Created:** 2026-07-04 · **Parent:** `SELF-INGEST-FOLLOWUPS-III-2026-07-04-BRIEF.md` (DONE 2026-07-04) · **Supersedes:** — · **Followed-by:** — (no `-V`: the only open item is the standing conditional F2, which rides in-place per the brief lifecycle's "say so rather than spawn an empty follow-up") · **House pattern:** `SELF-INGEST-FOLLOWUPS` → `-II` → `-III` → `-IV`

> **EXECUTED 2026-07-04.** **F1 ✅** — executed STANDALONE (not deferred to a future fold): `oxydex-render.js` — `OxyDex.reviewView` `nights` default `review.elements` → `review.nights`, plus an honest empty-nights placeholder in `oxyClinicalSummary` (an events-only reload now says "nothing to review here" instead of the misleading "No flags raised" skeleton). **Correction to this brief's original F1 claim:** `oxyClinicalSummary` was ALREADY crash-safe on `[]` (the `first ?` / `nights[0]||{}` guards), so the empty-nights change is an HONESTY improvement, not a crash fix. Two `-III` "Done when" test legs added to the OxyDex render-coverage probe (no-arg default == explicit-nights render; events-only reload renders the placeholder without throwing) — logic validated headlessly. OxyDex re-bundled (render-only → EXPORT-INERT): `cf8f4ceaf1fe → 7fbedea9a12f`, GATE-A + both OxyDex fixtures re-recorded (outputHashes unchanged). ⚠️ **Provenance note:** an out-of-band pipeline wrote a stale `bd269931cae1` into both ledgers after the source edit; per the PROVENANCE-NONDETERMINISM re-read-before-trust rule I re-derived ground truth (the shipped bundle is deterministically `7fbedea9a12f` under BOTH build-core AND the authoritative `manifest-gate.js`) and reconciled the ledgers to it. **F2 DEFERRED (standing, in-place)** — trigger: any `buildV2` change; NOT re-spawned as `-V`. Gates: `verify-provenance` `provenanceOK/gateA/gateB` all true · bundle==docs==BUILD-MANIFEST==both fixtures.

# Self-ingest roll-out — follow-ups IV (residue surfaced executing -III)

> **What this is.** The lifecycle-mandated follow-up after executing `SELF-INGEST-FOLLOWUPS-III`
> (OxyDex live review-render leg, gate-green 2026-07-04). Two items, both **LOW**: one newly discovered
> during -III (F1), one standing conditional-defer carried forward since -II F4 (F2). Read `CLAUDE.md`
> first. Neither is urgent; F1 folds on the next OxyDex re-bundle, F2 only fires if `buildV2` changes.

---

## F1 — ✅ DONE 2026-07-04 (executed standalone) · 🟢 LOW (consistency): `OxyDex.reviewView`'s `nights` default is `review.elements`, but OxyDex reloads return `review.nights`

The F5 (`-II`) namespace wrapper in `oxydex-render.js` is:
```js
window.OxyDex.reviewView = function (review, nights){ return oxyReviewBanner(review) + oxyClinicalSummary(review, nights || (review && review.elements) || []); };
```
But `oxyLoadOwnExport` returns the reconstructed nights on **`review.nights`**, NOT `review.elements`
(the other five nodes surface `.elements`; OxyDex is the odd one out because its clinical summary is
nights-based). So a bare `OxyDex.reviewView(review)` call would fall through to `review.elements` →
`undefined` → `[]` → an empty clinical summary (and `oxyClinicalSummary` on an empty `nights[]` is itself
not hardened — `asc[0].date` on `[]` would throw). **Harmless today**: the only caller (the `-III` live
probe) passes `review.nights` explicitly, so the default is never exercised. But it is inconsistent and a
latent foot-gun.

**Do (LOW).** Change the default to `review.nights` (and, belt-and-braces, guard `oxyClinicalSummary`
against an empty `nights[]` — return an honest "no nights in this export" note rather than deref
`asc[0]`). **Fold on the NEXT OxyDex re-bundle** (like the D1 `oxyScrubExport` fold) — do not re-bundle
OxyDex solely for this cosmetic default. Test-adjacent; if fixed standalone, honor the §🔏 re-bundle +
provenance gate. **Done when:** the default is `review.nights` and an empty-nights reload renders an
honest placeholder instead of throwing.

---

## F2 — ⏸ DEFERRED (standing, in-place — NO `-V`; trigger: any `buildV2` change) · 🟡 LOW (test fidelity): ECGDex + PpgDex §7 groups drive HAND-BUILT exports, not `compute()` (carried from -II F4 → -III F2)

**Standing conditional-defer.** Unlike Pulse/Gluco/HRVDex (whose §7 groups drive `compute()` →
`loadOwnExport` on a real synthetic input), the ECGDex + PpgDex §7 groups reload a **hand-authored**
buildV2-shaped export (raw ECG/PPG synthesis is heavy and `buildV2` is DOM-adjacent app code, not the
headless `compute()` light builder). Each has a **guarded** `genSynthetic→compute(rich)` authenticity
leg, but it exercises the LIGHT `ppg/ecgBuildNodeExport` rich branch, not the app's `buildV2` the user
actually reloads. Residual risk: if `buildV2`'s field shape drifts from what `ecg/ppgLoadOwnExport`
reads, the hand-built test won't catch it.

**Do (LOW).** Extract the `buildV2` field assembly to a DOM-free helper (or add a headless golden of one
real `buildV2` output) so a §7 leg can assert the reader against the ACTUAL rich shape. **DEFER unless
`buildV2` changes** — this has ridden forward since -II F4 precisely because it is not worth a
buildV2 refactor on its own. **Done when:** at least one §7 leg per node reloads a real
`buildV2`-produced export.

---

## Sequencing & gate expectations
- **F1** — fold on the next OxyDex re-bundle (do not re-bundle for it alone); if fixed standalone, it is
  an `oxydex-render.js` source change → OxyDex re-bundle + GATE-A hand-update + code-gated fixture
  `manifestHash` re-record (EXPORT-INERT — render-only) + `verify-provenance`/`?full`/`no-network` green.
- **F2** — only if `buildV2` is touched; test-only; `?full` green.
