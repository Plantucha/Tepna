<!--
  SITE-DEPLOY-AND-LAYOUT.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Tepna — GitHub move + website deploy manifest

**Status:** REFERENCE (living manifest) · **Created:** 2026-06 (undated) · last-verified 2026-07-01
<!-- Not an executable build brief — a deploy / repo-layout decision manifest. The two concrete repo
     actions it specifies ARE done: Integrator.src copy.html deleted (only Integrator.src.html remains) and
     the screens/ .gitignore gap closed (screens/ now ignored). The website upload tiers and the Tier-3
     live-tools publish decision are external hosting actions, not trackable in-repo. -->

Two questions answered, traced from real `src`/`href` references (not memory):

1. **What to upload to the website** (the reachable static site).
2. **What to move / leave where** when the repo goes to GitHub.

> **Headline:** the repo is intentionally **flat**. The build system uses bare relative refs
> (`OxyDex.src.html` → `oxydex-app.js`, gates → root `*.js`, `BUILD-MANIFEST.json` by name). Moving
> source/build files breaks those refs **and** forces a full re-bundle + manifest regen + gate
> re-run. So below, the source/build/doc files **stay at root**; the real actions are (A) selecting
> the website deploy set and (B) sweeping a handful of true scratch files out of the repo root.

---

## A · WEBSITE — files to upload

The site is one link-connected static graph rooted at **`index.html`**. Every page pulls
`licensing/dex-license.css`; the 8 app bundles are fully self-contained (inliner output, zero
external refs — verified). Keep relative paths identical to the repo so links resolve.

### Tier 1 — Core public site (upload these)
| Item | Notes |
|---|---|
| `index.html` | Entry point (formerly `Landing.html`) — the site root. |
| `OxyDex.html` `ECGDex.html` `PulseDex.html` `PpgDex.html` `HRVDex.html` `GlucoDex.html` `CPAPDex.html` `Integrator.html` | The 8 bundled apps. Self-contained — no companion files needed. |
| `Science.html` `Architecture.html` `Why This Exists.html` `How to Collect Data.html` | Content pages linked from the nav/footer. |
| `licensing/dex-license.css` | **Shared dependency of every front-door page.** Must ship. |
| `how-to-collect/img/*` (18 imgs) + `how-to-collect/image-slot.js` | Required by *How to Collect Data.html*. |
| `OxyDex Reference.html` `ECGDex Reference.html` `PulseDex Reference.html` `PpgDex Reference.html` `HRVDex Reference.html` `GlucoDex Reference.html` `CPAPDex Reference.html` | The 7 reference guides (each needs `dex-license.css` **and** `dex-badges.css`). Reachable companions — upload. |
| `wiring/` (all 13 "How It's Wired" pages) | Architecture reference set. **Brings two extra deps:** `dex-wired.css` (root) and `templates/Visual-Language-Spec.html` (self-contained). |
| `dex-wired.css` | Root CSS required by every `wiring/` page (`../dex-wired.css`). |
| `dex-badges.css` | Root CSS `<link>`ed by all 7 reference guides (evidence-badge disc visuals — the cohesion-badges gate requires the `<link>`, not inlined). |
| `templates/Visual-Language-Spec.html` | Linked from every per-node wiring page; self-contained. |

### Tier 2 — Papers (static, safe to publish)
Reachable via `Science.html → papers/papers.html`. All self-contained static HTML + one CSS + PNGs.
| Item |
|---|
| `papers/papers.html` + the 12 paper pages (`sigma-no-reference.html`, `sensor-trio-nights.html`, `synthetic-data-frontier.html`, `robustness-benchmark.html`, `qrs-yield.html`, `rmssd-equivalence.html`, `odi4-ahi-bias.html`, `hrv-age-confound.html`, `nights-icc.html`, `treatment-response.html`, `cgm-hrv-coupling.html`) |
| `papers/paper.css` · `papers/figures/*.png` (25 figures) |

### Tier 3 — Live research tools ⚠️ DECISION REQUIRED
`Science.html` also links **interactive tools**: `*-analysis.html`, `cohort-runner.html`,
`cohort-regression.html`, `synth-gen.html`, `ECG Splitter.html`, plus the dev **gates**
`Dex-Test-Suite.html` and `verify-provenance.html`. These import **dozens of root `*.js` source
modules** at runtime — publishing them means shipping most of `/*.js` and exposing the test gates.

**Recommend:** publish Tier 1 + Tier 2 only, and on `Science.html` either (a) point the "live tool"
links at the static paper instead, or (b) drop those links for the public build. If you *do* want
the tools live, treat it as "deploy the whole repo" (see the import lists in
`sigma-no-reference-analysis.html`, `odi-bias-analysis.html`, `cohort-runner.html`, etc.).

> **Note (wiring + Tier 3):** three wiring pages — *How It's Wired - Experiments / Science Papers /
> SynthGen* — link the same live tools (`../odi-bias-analysis.html`, `../synth-gen.html`,
> `../cohort-runner.html`, `../cohort-regression.html`, `../hrv-confound-analysis.html`,
> `../nights-icc-analysis.html`). If you ship `wiring/` without Tier 3, those few links dangle; the
> other 10 wiring pages are fully satisfied by Tier 1 + Tier 2.

### Do NOT upload
`*.src.html`, all `*-*.js` source modules, `BUILD-MANIFEST.json`, `FIXTURE-PROVENANCE.json`,
`uploads/` (gitignored — personal health data), `tests/`, `codegen/`, `tools/`, `screens/`, all
`*.md`, design mockups, and exploration scratch (see §C).

---

## B · STAYS AT ROOT — do not reorganize (build system depends on it)

Moving any of these breaks bare relative refs and the CLAUDE.md gates. Leave flat:

- **Source shells:** the 8 `*.src.html` (reference root `*.js` by bare name).
- **Bundled apps:** the 8 app `*.html` (Landing links them at root; output convention).
- **Source modules:** every `*-app.js / -dsp.js / -render.js / -registry.js / -cross.js / -morph.js / -profile.js / -fusion.js / -overview.js / -coimport.js / -edf.js`, plus shared `kernel-constants.js`, `ganglior-provenance.js`, `metric-registry.js`, `dex-profile.js`, `crossnight-envelope.js`, `synth-gen.js`, `dex-patient-gen.js`, `oxydex-util.js`, `nsrr-adapter.js`, `support.js`, `cohort-*.js`, `dex-badges.css`, `ans-design.css`, `dex-wired.css`.
- **Gates + config:** `Dex-Test-Suite.html`, `verify-provenance.html`, `BUILD-MANIFEST.json`, `FIXTURE-PROVENANCE.json` (read by bare name).
- **Docs read by bare name:** `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `DOCS-INDEX.md`, `LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md` — root is correct (GitHub renders them; many are cross-linked by flat name).

> The ~50 `*-BRIEF.md` / `*-AUDIT*.md` could *in principle* go to a `docs/` folder, but `DOCS-INDEX.md`
> and `CLAUDE.md` link them by flat name — moving them means rewriting every link for marginal tidiness.
> **Recommend leaving them at root** unless you also update the index. (They're already grouped
> logically in `DOCS-INDEX.md`.)

---

## C · Scratch / dev artifacts — sweep before pushing

Not part of the site, not part of the build. Either delete, `.gitignore`, or move to `docs-archive/`:

| File / folder | What it is | Suggested action |
|---|---|---|
| `Integrator.src copy.html` | Stray duplicate of `Integrator.src.html` | **Delete** |
| `Landing Explorations.html` + `landing-explore/` | Landing design exploration (uses `design-canvas.jsx`) | Move to `docs-archive/` or delete |
| `Logo Exploration.html` · `Tepna Logo.html` | Logo studies | Move to `docs-archive/` |
| `Canvas.dc.html` | Scratch design canvas (`./support.js`) | Move to `docs-archive/` or delete |
| `screens/` (38 PNGs) | Design screenshots — **not** in `.gitignore` (only `screenshots/` is) | Add `screens/` to `.gitignore` or move to `docs-archive/` |

### Keep at root — cited specs, NOT scratch (do not archive)
| File | Why it stays |
|---|---|
| `Unified Profile - Detailed Mockup.html` | **`dex-profile.js` names it as the profile-system spec**; also cited by `PROFILE-UNIFY-BRIEF.md`. |
| `User Profile - Unified Proposal.html` · `Export Bar - Unified Proposal.html` | Active reference artifacts cited by `PROFILE-UNIFY-BRIEF.md`. |
| `design-canvas.jsx` | Shared starter referenced by `templates/License Stamp Directions.html` (`../design-canvas.jsx`). |

### `.gitignore` gap to fix
`.gitignore` ignores `screenshots/` but the actual folder is **`screens/`** (38 design PNGs would be
committed). Add `screens/` (or rename the folder) before the first push.

---

## TL;DR
- **Website root =** `index.html` (entry) + 8 app bundles + 4 content pages + 7 reference guides + `wiring/` + `licensing/dex-license.css` + `dex-wired.css` + `dex-badges.css` + `templates/Visual-Language-Spec.html` + `how-to-collect/{img,image-slot.js}` + `papers/`. Nothing else required for a working public site.
- **Repo =** leave flat; the build/gate system depends on it. Only real cleanup: delete `Integrator.src copy.html`, sweep the design-exploration scratch (§C), and fix the `screens/` `.gitignore` gap.
- **One decision:** whether the live research tools + gates go public (Tier 3) — recommend **no**, keep the static papers only.

---

## D · `docs/` — generated GitHub-Pages build (2026-07-01)

A ready-to-serve snapshot of **Tier 1 + Tier 2** lives in **`docs/`** (95 files), so GitHub Pages can
serve it with **Settings → Pages → Deploy from a branch → `main` / `/docs`**. It mirrors the repo's
relative paths, so every internal link resolves (verified: 38 non-bundle pages scanned, 0 broken refs).
Contents: `index.html` + the 8 app bundles + 4 content pages + 7 reference guides + `wiring/` (13) +
`papers/` (12 pages + `paper.css` + 25 figures) + `licensing/dex-license.css` + `dex-wired.css` +
`dex-badges.css` + `templates/Visual-Language-Spec.html` + `how-to-collect/{img,image-slot.js}` + an
empty `.nojekyll` (serve files/folders with spaces & apostrophes as-is; no Jekyll mangling).

- **Tier 3 excluded + de-linked:** the live tools + gates are NOT copied; their links were removed from
  the `docs/` copies of `Science.html` (11 per-study “Open live tool” links stripped; the lab-bench grid
  converted to non-clickable cards) and unlinked across the 5 `wiring/` pages that referenced them (29
  links) — so the public build has **zero dead links**. The ROOT copies are untouched (tools still work
  locally / for the dev gates).
- **`dex-badges.css` correction:** all 7 reference guides `<link>` it (evidence-badge discs); the earlier
  “refs need only dex-license.css” note was wrong — it is now in Tier 1 above and shipped in `docs/`.
- **Regenerating:** `docs/` is a generated snapshot, not a source of truth — do NOT hand-edit it. After a
  re-bundle or content edit, re-copy the changed file(s) into `docs/` (same relative path) and re-run the
  de-link pass on any re-copied `Science.html` / `wiring/` page. A CI-built `gh-pages` branch is the
  tidier long-term home than committing the snapshot.
- **Optional:** `docs/Science.html`’s lab-bench section now reads “they live in the source repository” —
  add your GitHub repo URL there if you want it linked.
