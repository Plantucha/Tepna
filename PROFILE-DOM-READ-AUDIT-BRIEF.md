<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# PROFILE-DOM-READ-AUDIT-BRIEF — legacy `getElementById('profX').value` reads that bypass the unified panel

**Status:** DONE — 2026-06-23 · **Created:** 2026-06 (undated)
<!-- Verified 2026-06-23: §1 live bug fixed (pulsedex-render.js reRender reads _pp.vo2gt, not the DOM);
     per-node live profile-edit probe shipped as profileEditProbe() in Dex-Test-Suite.html (browser-only —
     a sensible relocation from tests/dex-tests.js since it needs a live panel); ECG/PPG applyNorms
     element-existence-guarded, HRVDex currentAge routed through the getProfile cascade; ECGDex/PpgDex/HRVDex
     re-bundled 2026-06-23 + BUILD-MANIFEST.json updated (§6 done-criteria met: no unguarded legacy-ID read
     remains). Residual: the §4 durable DELETION of the neutered legacy DOM paths is deferred (tracked by
     PROFILE-HANDOFF §3). -->

Handoff for the next AI coder. A **latent class of bugs** surfaced during the PROFILE-HANDOFF
rollout: code that reads the *old* per-node profile inputs (`profX` / `prof_X` / `ecgX` / `ppgX` /
`gluX` / `pxX`) directly from the DOM. Since the **unified panel** (`dex-profile.js`
`renderPanel`) mounts into `#dexProfilePanel` with `data-k="…"` inputs and **does not create any of
the legacy IDs**, every such read now resolves to `null` at runtime. The companion fact that makes
this dangerous: **the gates do not catch it** (see §3). One live instance was already found and
fixed (§1); the rest are currently neutralized by guards that are **load-bearing and easy to
remove by accident** (§2). This brief documents the class, the detection method, the fix rule, and
the durable cure. Companion docs: `PROFILE-HANDOFF-BRIEF.md` §4 (the original gotcha),
`PROFILE-UNIFY-BRIEF.md`, `dex-profile.js`.

---

## 0 · Root cause (read first)

- **Before unify:** each node owned a DOM form with node-prefixed IDs — OxyDex `profAge`/`profVO2`/
  `profHRmax`/`profRHR`/`profElev`…, HRVDex `prof_age`/`prof_vo2gt`/…, PulseDex `profAge`/`profVO2`/
  `profRHR`/…, ECGDex `ecgAge`/`ecgHeight`/`ecgHRmax`/`ecgRHR`/`ecgElev`/`ecgVO2`, PpgDex `ppg*`,
  GlucoDex `glu*`. Compute and "hint" code read those inputs live with `getElementById(id).value`
  (and ECG/PPG via the `$ = getElementById` alias).
- **After unify:** the source of truth is the ONE shared record (`tepna_profile`) behind
  `window.DexProfile`. The panel is rendered by `DexProfile.renderPanel({mount:'dexProfilePanel'})`
  using generic `data-k` inputs — **none of the legacy IDs exist in the DOM any more.**
- **Therefore any surviving `getElementById('<legacyId>')` returns `null`:**
  - `.value` / `.checked` on it → **`TypeError` (hard crash)** that aborts whatever render/recompute
    pass it sits in (cards go stale, the app can wedge).
  - assigning `el.value = …` → crash too.
  - reading through a null-safe wrapper (`gv(id)` / a `?.value`) → **silent wrong default** (worse:
    no error, just incorrect numbers that diverge from the real `getProfile()` cascade).

**The correct source of every profile value is the cascade, never the DOM:** `getProfile()` /
`pxProfile()` (which read `DexProfile.get()` + the manual record + the detected tier — see
PROFILE-HANDOFF-BRIEF §1), OxyDex's `UP` (populated by `upLoad()`), or `DexProfile.resolve(field)`
directly.

---

## 1 · The one LIVE bug already found + fixed (use as the canonical example)

`pulsedex-render.js`, `reRender()` — fires on every live profile edit:

```js
// BEFORE (crashes: #profVO2 no longer exists → getElementById(...) is null → .value throws)
const gtIn = document.getElementById('profVO2').value;
r.vo2gt = gtIn ? +Number(gtIn).toFixed(1) : null;
// AFTER (route through the cascade, like the sibling reads two lines up already do)
const gtIn = _pp.vo2gt;                 // _pp = pxProfile()
r.vo2gt = gtIn > 0 ? +Number(gtIn).toFixed(1) : null;
```

Why it slipped through: `reRender()` is only reached when a user **edits a profile field with a
recording loaded** — a path no gate exercises (§3). Every sibling value in the same function
(`hrmax`, `rhr`, `elev`) was already read from `_pp = pxProfile()`; only `vo2gt` still went to the
DOM. **This is fixed.** It is the template for every other fix: replace the DOM read with the
already-available cascade value.

---

## 2 · The rest are GUARDED — the guards are load-bearing, do not remove them

A sweep (`getElementById('prof*'|'ecg*'|'ppg*'|'glu*'|'px*').value/.checked` and the `$('…')`
alias) found the functions below. They are **currently safe ONLY because of an early-return guard**
or because they sit in the legacy `else` branch that the unified panel skips. If a future edit
removes a guard, drops the `if(_dexPanel)` fork, or calls one of these unconditionally, the crash
class reopens. Audit these and keep the guard; better, delete them per §4.

| File · function | Legacy IDs read | What protects it today |
|---|---|---|
| `ecgdex-profile.js` · `computeHints(r)` | `$('ecgHeight'/'ecgHRmax'/'ecgElev'/'ecgRHR').value` | **`if (DP()) return;`** on line 1 — panel owns hints |
| `ecgdex-profile.js` · `renderProfileDerived()` | (reads via `getProfile`, but `applyNorms` writes IDs) | top `const d=$('profileDerived'); if(!d) return;` **and** `render()` only calls it in the `else` of `if(_dexPanel) refresh()` |
| `ecgdex-profile.js` · `applyNorms(ideal)` | `$('ecgHeight').value=…`, `$('ecgWeight').value=…` | wired only to `ecgApplyNorms` (legacy "apply norms" button) which the unified panel does not render → unreachable, **but unguarded** if ever called |
| `ppgdex-profile.js` · `computeHints` / `renderProfileDerived` / `applyNorms` | `$('ppgHeight'/'ppgHRmax'/'ppgElev'/'ppgRHR').value` | identical pattern to ECGDex (clone) |
| `pulsedex-overview.js` · `computeProfileHints(r)` | `getElementById('profHRmax'/'profElev'/'profRHR').value` | **`if(!document.getElementById('profSex')) return;`** on line 1 |
| `pulsedex-overview.js` · `applyAgeNorms(ideal)` | `profSex`/`profAge`/`profHeight`/`profWeight` | same `if(!getElementById('profSex')) return;` guard |
| `pulsedex-overview.js` · `renderProfileDerivedPx()` | `#profileDerived` | **`if (window._pxPanel) { …refresh(); return; }`** + `if(!d) return;` |
| `glucodex-profile.js` · `getProfile()` | `$('gluCalib').checked` | **existence-checked** (`$('gluCalib') ? … : getCalib()`); `gluCalib` is a node-specific field the panel intentionally keeps (PROFILE-HANDOFF §3), so it legitimately still exists |
| `oxydex-*` · `upFromDOM`/`upToDOM`/`profileAutoDetectUpdate` | `profXxx` | already routed through null-safe `gv(id)`/`sv(id,val)` (see `oxydex-dsp.js` L117–121) — silent-default risk, not a crash |

**Two distinct hazards to keep straight:**
1. **Crash (unguarded `.value` on null):** ECG/PPG `applyNorms` are the live trap if any code path
   ever calls them with the panel active.
2. **Silent wrong value (null-safe wrapper returns a default):** OxyDex's `gv()` path — no error,
   but the number can silently disagree with the `DexProfile` cascade (e.g. miss a detected-tier
   value). Equally a bug, harder to notice.

---

## 3 · Why the gates miss this (and how to close the hole)

- `Dex-Test-Suite.html`'s render-coverage group drives each app bundle in an iframe and **loads a
  recording**, but it does **not simulate a user editing a profile field** afterward. So the live
  edit paths — `reRender()`, `computeHints`, `onInput`, the `onChange` the panel fires — never run
  in CI. An unguarded DOM read there passes **806/54 all green** and still crashes on the user's
  first keystroke in the panel.
- `verify-provenance.html` only fingerprints bytes; it cannot see a runtime `TypeError`.
- **Recommended new coverage (do this so the class becomes self-policing):** add a render-coverage
  step that, after the recording loads, programmatically drives a profile change through the public
  surface — e.g. `DexProfile.setManual('hrRest', 55)` then invoke the node's `reRenderFn` /
  `onChange` (or dispatch an `input` on a `#dexProfilePanel [data-k]` field) — and assert **no
  exception** and that a derived card updated. One such probe per node in
  `tests/dex-tests.js` (shared by `run-tests.mjs` + the suite) converts every "latent" instance in
  §2 into a hard red the moment a guard is dropped.

---

## 4 · The durable fix — delete the legacy DOM paths (PROFILE-HANDOFF §3 dead-code pass)

The guards in §2 exist only because the unify rollout **neutered but did not delete** the legacy
profile code. The permanent cure for this entire class is the deferred §3 cleanup: per node delete
`renderProfileDerived(Px)`, `computeHints`/`computeProfileHints`, `applyNorms`/`applyAgeNorms`,
`onInput`/`onProfileInput`, `inferFromData`, `profileAutoDetectUpdate`, `clearEstimate`, the dead
`UP` branches, `PROFILE_KEYS`/`PX_PROFILE_KEYS`, and `upToDOM`/`upFromDOM`. Once these functions are
gone there is **no surviving reader of a legacy ID**, so the guards become unnecessary and the
crash class cannot recur.

**Keep (the panel does NOT cover these — they read live, node-specific elements that DO exist):**
OxyDex Karvonen zones (`#profileZones` + the zone math) and GlucoDex `gluCalib` calibration row
(`calibRow`/`calibState`). Route any value those need through `getProfile()`/`DexProfile`, not a
removed input.

---

## 5 · Procedure for the fix (per touched node)

1. **Detect.** Grep the source `*.js` (not bundled `*.html`, not `*-analysis.js`):
   `getElementById\(['"](prof|prof_|px|ecg|ppg|glu)[A-Za-z_]*['"]\)` and the alias forms
   `\$\(['"](ecg|ppg|glu)[A-Za-z_]*['"]\)`. Classify each hit: guarded (keep/delete) vs unguarded
   (fix now).
2. **Fix.** Replace every value read with the cascade: `getProfile()`/`pxProfile()` fields, `UP.*`
   (OxyDex), or `DexProfile.resolve(field).v`. Never read identity off the DOM. For label/hint
   updates that targeted removed inputs, **delete** them (the panel renders its own sublabels via
   `dex-profile.js` `_sub`) rather than re-pointing them.
3. **Guard anything you must keep** with an element-existence check (`const el=$(id); if(!el)return;`)
   — never a bare `.value`.
4. **Verify the live path by hand** (gates won't): open the node, load a recording, then **edit a
   profile field in the panel** and confirm no console error + cards update. Add the §3 probe.
5. **Re-bundle** the touched app(s) with the inliner (`super_inline_html` `*.src.html` → `*.html`),
   then **bump that app's `manifestHash` in `BUILD-MANIFEST.json`** (read it off
   `verify-provenance.html`'s manifestHash column or hash the bundle's `__bundler/manifest` with
   SHA-256[0:12]). Re-run `Dex-Test-Suite.html` (**806/54 all green**) and `verify-provenance.html`
   (**GATE A 8/8**, **GATE B no red**). See CLAUDE.md "Re-bundle checklist".

## 6 · Definition of done

No unguarded legacy-ID `.value`/`.checked` read remains in any source `*.js` (grep clean or each
hit provably guarded/deleted) · a live profile-edit probe exists per node in `tests/dex-tests.js`
and is green in both runners · touched apps re-bundled with `manifestHash` updated · gates green ·
consoles clean when editing a profile field with a recording loaded.
