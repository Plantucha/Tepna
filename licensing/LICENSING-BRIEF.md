<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# LICENSING BRIEF — license & stamp every file in the suite

**Owner:** Michal Planicka · **Decision:** unify the whole suite on **Apache-2.0**.
**Status of this brief:** authoritative. Where it conflicts with anything except
`CLAUDE.md`, this wins; `CLAUDE.md` (Clock Contract, gates, frozen names) always
wins over this.

This is a mechanical, repo-wide pass. It does **four** things:

1. Add a canonical **Apache-2.0 SPDX header** to every authored source file.
2. **Remove every other license** (the MIT header) — one source hit + its bundle.
3. **Remove the only bundled third-party asset** (PulseDex's embedded IBM Plex
   Mono) so the suite ships zero licensed assets, matching every other node.
4. Roll out the **visible license/attribution stamp** (the `dxl-` components) to
   the places users see — sidebars, footers, About/Credits.

Root files already committed by the design pass — **do not regenerate**, just
keep them authoritative: `LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md`,
and `licensing/` (`SPDX-HEADERS.txt`, `dex-license.css`, `dex-license-samples.html`,
this brief).

---

## 0. Brand decision (read first)

- The **product/suite brand is `Tepna`** (replaces the old umbrella name
  `GanglioR` / `ANS Intelligence` in user-facing strings, headers, docs).
- The **event-bus codename `Ganglior` is FROZEN** (per `CLAUDE.md`) — it is an
  internal code name, **not** the brand. Do **NOT** rename `ganglior_*`,
  `Ganglior`, the `fascia` input alias, `ganglior-provenance.js`, the export
  `schema.name:"ganglior.node-export"`, or any bus identifier. Renaming the bus
  would break exports and the provenance/test gates.
- **Node names stay**: OxyDex, HRVDex, PulseDex, GlucoDex, ECGDex, PpgDex, CPAPDex.
- The Tepna brand rename of UI strings is **Phase 4 — COMMITTED, runs after
  Phase 3** (full spec in §9). Do the licensing (Phases 1–3) first; they're
  independent and lower-risk. Phase 4 only begins once §7's Phases 1–3 boxes are
  checked and both gates are green.

---

## 1. SPDX headers — every authored source file

Use the exact blocks in **`licensing/SPDX-HEADERS.txt`**. Rules:

- **Header, not full text.** Two canonical lines must appear:
  `Copyright 2026 Michal Planicka` and `SPDX-License-Identifier: Apache-2.0`,
  plus the short "Licensed under … see LICENSE/NOTICE" pointer.
- If a file already has a descriptive banner (most `*-dsp.js` do), **inject the
  two lines into the existing banner** rather than adding a second block.
- **Year = file's creation year.** Do not bump years on files you only touch.
- **Comment syntax per type:** `/* */` for `.css`; `/* */` or `//` for `.js`;
  `<!-- -->` inside `<head>` for source `.html`/`.src.html`; top HTML-comment for
  `.md`.

### Files that GET a header
- All `*-dsp.js`, `*-app.js`, `*-render.js`, `*-cross.js`, `*-registry.js`,
  `*-profile.js`, `*-fusion.js`, `*-morph.js`, `*-coimport.js`, `*-edf.js`,
  `*-longitudinal.js`, `*-overview.js`, and the shared `*.js`
  (`metric-registry.js`, `kernel-constants.js`, `ganglior-provenance.js`,
  `support.js`, `nsrr-adapter.js`, `crossnight-envelope.js`, `cohort-*.js`,
  `synth-gen.js`, `*-analysis.js`).
- `ans-design.css`, `dex-badges.css`, `paper.css`, and `licensing/dex-license.css`
  (already headered).
- All **source** HTML: `*.src.html`, the reference guides (`OxyDex Reference.html`,
  `ECGDex Reference.html`), `index.html`, `Theme Preview.html`,
  `Visual-Language-Spec.html`, the analysis tools (`odi-bias-analysis.html`,
  `hrv-confound-analysis.html`, `nights-icc-analysis.html`, `cohort-*.html`,
  `synth-gen.html`, `verify-provenance.html`, `Dex-Test-Suite.html`,
  `cpapdex-edf-*.html`), and `papers/*.html`.
- `tests/*.js` / `tests/*.mjs`.
- Markdown docs (`*.md`) — top HTML-comment line.

### Files that do NOT get a header
- **Bundled `*.html`** (OxyDex.html, HRVDex.html, PulseDex.html, ECGDex.html,
  GlucoDex.html, PpgDex.html, CPAPDex.html, Integrator.html) — never hand-edit a
  bundle. The header rides in via the **source** + re-bundle. See §4 re-bundle
  policy: do **not** re-bundle solely to carry an inert header comment.
- `uploads/*.json` and any captured fixtures/exports (data, not authored source).
- `.thumbnail`, screenshots, generated artifacts.

---

## 2. Remove every non-Apache license

- **Known hit (source):** `oxydex-dsp.js` header `// License : MIT License`.
  **Already fixed** by the design pass → now the Apache SPDX header. Verify it.
- **Sweep:** grep the repo (case-insensitive) for: `MIT License`, `\bMIT\b`,
  `BSD`, `GPL`, `ISC`, `WTFPL`, `Unlicense`, `Creative Commons`, `CC[ -]BY`,
  `proprietary`, `all rights reserved`. For any authored-source hit, replace the
  license statement with the Apache SPDX header. (Ignore matches inside
  unrelated prose, e.g. an abbreviation, or inside `uploads/` data.)
- **Stale bundle copy:** `OxyDex.html` (bundle) still contains the old MIT
  comment inside its `__bundler/template`. It's inert text, but for license
  clarity it should not ship "MIT". Reconcile it on OxyDex's **next behavioral
  re-bundle** (don't re-bundle just for the comment — see §4). Until then, the
  root `LICENSE`/`NOTICE` govern and are authoritative.

---

## 3. Remove the bundled IBM Plex Mono (PulseDex) → system mono

**Goal:** zero bundled/licensed fonts, suite-wide. Every node except PulseDex
already uses the system stack (the `'IBM Plex Mono'` name falls through to
`ui-monospace`). Make PulseDex match.

1. In PulseDex **source** (`PulseDex.src.html` and/or the inliner asset list it
   references), remove the embedded IBM Plex Mono font asset and any
   `@font-face` that points at it. Do **not** add a replacement `@font-face` and
   do **not** add a CDN (forbidden by `CLAUDE.md`).
2. Confirm PulseDex's `font-family` declarations keep a generic terminal, e.g.
   `'IBM Plex Mono', ui-monospace, monospace` — the name is a harmless fallback
   label once no binary is bundled. (Optional polish: normalize the stack to
   `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace` to drop the
   proprietary name entirely. Visual change is negligible.)
3. **Re-bundle PulseDex** (this is a real asset change → re-bundle is required).
4. This **changes PulseDex's `buildHash`** → the provenance fixture flips. Run
   the provenance gate (§4) and **re-stamp** the affected `uploads/*.json`
   PulseDex export with the new `buildHash` (or regenerate it from the rebuilt
   bundle).
5. Update `THIRD-PARTY.md`: once the binary is gone, **delete** the IBM Plex Mono
   / OFL block (the file already marks it as pending-removal).

---

## 4. Re-bundle & gate policy (do not skip)

**Re-bundle only when runtime/asset behavior changes.** A license **comment** is
inert — re-bundling all 7 apps just to carry a comment would flip **every**
provenance fixture for no behavioral reason. So:

- **Source header additions → NO immediate re-bundle.** Headers land in source;
  each bundle picks its header up on the next time it's re-bundled for a real
  reason. (Same precedent as the `BADGE_CSS` inert-export note in `CLAUDE.md`.)
- **PulseDex font removal → re-bundle PulseDex only** (real asset change).

**Gates — run before declaring done:**
1. **Regression:** open `Dex-Test-Suite.html`, wait ~3 s, confirm the `#summary`
   pill is **all green**. Run it after any `*-dsp.js`/`*-app.js`/`*-cross.js`
   edit and after re-bundling. (PulseDex font removal touches its bundle/app →
   mandatory.)
2. **Provenance:** open `verify-provenance.html` after re-bundling PulseDex;
   confirm **no red verdicts**. Expect the PulseDex fixture to need re-stamping
   (step 3.4). Pre-R1 "no provenance" fixtures are fine.
3. A passing live spot-check on one file is **not** a substitute for the suite.

---

## 5. Visible stamp rollout

Use **`licensing/dex-license.css`** + the snippets in
**`licensing/dex-license-samples.html`** (open it to copy markup). Place per
context; keep payload consistent (author · © 2026 · Apache-2.0 · disclaimer ·
`◈ Made in Asheville, NC` colophon).

| Where | Snippet | Notes |
|---|---|---|
| App sidebars (each node) | `.dxl-sidebar` | Replaces the existing "Reference Guide / Apache 2.0 License" data-card. In bundled apps this is a **source `.src.html`** edit → folds into that node's next re-bundle. |
| App view + paper footers | `.dxl-ribbon` or `.dxl-oneline` | `papers/*.html` can adopt the one-liner in the existing `.footer`. |
| Reference guides — Credits section | `.dxl-credits` | `OxyDex Reference.html` already has a 3-card Credits grid; reskin it to `.dxl-credits` and **fix its license string to Apache-2.0** (it currently reads "Apache 2.0" inconsistently elsewhere). These guides are **static, not bundled** → edit directly. |
| Landing / About hero | credits grid or the seal treatment | See `License Stamp Directions.html` for the seal mock. |

**Consistency fixes while you're in the guides:**
- `OxyDex Reference.html` footer + intro: ensure the license reads
  **`Apache-2.0`** everywhere (it appears 3×; keep them identical).
- The Credits "Licence & Suggested Citation" card: keep the citation format from
  `CITATION.cff` (`Planicka, M. (2026). Tepna … Version 1.0.0 …`).

---

## 6. Trademark line (one sentence, where licenses are listed)

Apache-2.0 grants **no** trademark rights (License §6). Where a file states the
license in prose (READMEs, About, reference-guide Credits), add:

> *"Tepna" and the Tepna marks (incl. OxyDex, HRVDex, PulseDex, GlucoDex, ECGDex,
> PpgDex, CPAPDex) are trademarks of Michal Planicka and are not licensed under
> Apache-2.0.*

Already present in `NOTICE`. Don't repeat it in every code file — once per
human-readable surface is enough.

---

## 6.5 Health / intended-use disclaimer (REQUIRED on every user-facing surface)

Apache-2.0's "AS IS / no warranty" covers *software* liability only. It does
**not** state intended use or the medical-device disclaimer that consumer
biometric tools are expected to carry. This is a separate, mandatory surface.
*(Not legal advice — the author should confirm wording for their jurisdiction;
this is the conventional general-wellness framing.)*

**ONE canonical string — single-sourced, do not paraphrase per file.** Store it
once as `Tepna.DISCLAIMER` (or a shared constant in `kernel-constants.js`) and
exposed in `dex-license.css` as the `.dxl-notice` block; every surface renders
that exact text.

### Canonical wording

> **Full (About / Credits / first-run / README):**
> *Tepna computes biometric patterns from your wearable and sensor data to
> support personal self-quantification. It is **not a medical device**, does not
> **diagnose, treat, cure, screen for, or prevent** any disease or condition,
> and is **not a substitute for professional clinical evaluation**. It has not
> been reviewed or cleared by the FDA, CE, or any regulatory body. Always
> consult a qualified healthcare provider about your health. Use at your own
> risk. For research and personal use only.*

> **Short (footers, sidebars, one-liners):**
> *Not a medical device · does not diagnose or treat · research & personal use only.*

> **Micro (tight chips):** `not a medical device`

### Where it must appear
- **Each app** — in About/info panel (full) + persistent footer/sidebar (short).
  App-shell text → **source edit, folds into that node's next re-bundle**
  (per §4 / §9.4); don't re-bundle solely for this — ride the next behavioral build.
- **Each reference guide** — full, near the Credits/Use block (static → direct edit).
- **`papers/*.html`** — short line in the footer (these are research notes).
- **`README.md` / Landing** — full, in an "Intended use & safety" section.
- **First run (optional, recommended):** show the full text once on first load
  per node, persisted via `localStorage` (e.g. `tepna.disclaimerAck.<node>`);
  never block offline use, just acknowledge.

### Render it with `.dxl-notice`
`dex-license.css` carries `.dxl-notice` (full block) and `.dxl-disclaimer`
(inline short line) — see `dex-license-samples.html` §5. Use those classes;
do not hand-format the paragraph.

---

## 7. Acceptance checklist (Phases 1–3 — gate Phase 4 on these)

- [ ] Every file in §1's "GET a header" list carries the two canonical lines.
- [ ] Grep for `MIT|BSD|GPL|ISC|proprietary|all rights reserved` returns **no**
      authored-source hits (data/prose excluded).
- [ ] `oxydex-dsp.js` header verified Apache-2.0 (no "MIT").
- [ ] PulseDex bundles **no** font binary; `THIRD-PARTY.md` font block deleted.
- [ ] PulseDex re-bundled; its `uploads/*.json` `buildHash` re-stamped.
- [ ] `Dex-Test-Suite.html` → all green.
- [ ] `verify-provenance.html` → no red verdicts.
- [ ] Root `LICENSE`, `NOTICE`, `CITATION.cff`, `THIRD-PARTY.md` present & correct.
- [ ] Visible stamp present in: every app sidebar, app/paper footers, each
      reference-guide Credits section; all license strings read `Apache-2.0`.
- [ ] **→ Phases 1–3 complete. Proceed to Phase 4 (§9).**

---

## 8. Out of scope / do not touch

- The frozen `Ganglior` bus name, `fascia` alias, `ganglior.node-export` schema.
- The Clock Contract and `parseTimestamp` duplication (intentional per CLAUDE.md).
- Evidence-badge CSS / grades (single source of truth per CLAUDE.md).
- `uploads/*` data contents (only re-stamp the PulseDex `buildHash` field).
- Re-bundling apps that had only header-comment changes.

---

## 9. Phase 4 — Tepna brand rename (runs AFTER Phase 3)

Start only when §7 is fully checked and both gates are green. This phase swaps the
two legacy **umbrella brand strings** to **Tepna** everywhere users (or readers)
see them. It is purely a display/string change — **no logic, no identifiers, no
schema, no filenames.**

### 9.1 THE disambiguation rule (read twice — this is the whole risk)

`GanglioR` (the suite/project brand, capital **R**) and `Ganglior` (the FROZEN
event-bus codename) are near-homographs. They are **different things.**

- **RENAME → `Tepna`:** a string that names the *whole product / project / suite*
  — page titles, paper banners/bylines, the design-system name, app header
  wordmarks, doc headings. Also the second umbrella brand **`ANS Intelligence`**.
- **NEVER TOUCH:** anything that names the *event bus, its events, exports, or
  provenance*, and **every code identifier**. This includes (non-exhaustive):
  `ganglior.node-export`, `ganglior_events`, `PULSEDEX_BUS = 'ganglior'`,
  `gangliorEvents()`, `GangliorProvenance`, `ganglior-provenance.js`, the
  `fascia` input alias, and UI strings that describe the bus itself
  (`"Ganglior · the bus"`, `"Ganglior bus export…"`, `"Ganglior events…"`).
- **Decision test for any hit:** *Does this string name the bus / an export /
  events / provenance, or is it a code token?* → **keep.** *Does it name the
  product as a whole?* → **rename.** When unsure, keep and flag for review.
- **Do NOT** do a blind global find-replace of `ganglior`/`Ganglior`. Case- and
  context-sensitive, hit by hit.

### 9.2 What changes (by surface)

| Surface | Hits to rename | Notes |
|---|---|---|
| `index.html` | `<title>ANS Intelligence — …>`, `.brand` wordmark, footer `<b>ANS Intelligence</b>` | Keep `"Ganglior · the bus"` in the Relay step — that's the bus. Keep the `by the -Dex suite` tagline. |
| `papers/*.html` + `papers/papers.html` | banners (`GanglioR Perspective/Preprint`), bylines (`GanglioR Project`), affil (`GanglioR physiological-signal suite`), `← GanglioR preprints`, titles | Prose mentions of “the GanglioR harness/suite” → “Tepna”. |
| `Dex-Test-Suite.html` | `<title>`, `<h1>`, `document.title` strings | Keep the `Ganglior event stream` assertion labels — those test the bus. |
| `HANDOFF.md` + other `*.md` | title `# GanglioR — …` and brand prose | Keep bus references. |
| `ans-design.css` | header comment `ANS Intelligence Design System` → `Tepna Design System` | Comment only. **Do not** rename the file or any class. |
| `codegen/dex-gen.js` | `ANS Intelligence Design System vX` strings/comments | Generator label only. |
| App banners in `*-dsp.js` / `*.src.html` (e.g. oxydex-dsp.js `· ANS Intelligence`) | brand label in the banner | Visible once re-bundled → see 9.4. |
| App header wordmark in each `*.src.html` | the on-screen suite name shown in the app shell | This is the user-facing rename that requires a re-bundle. |

### 9.3 Explicitly OUT of scope in Phase 4

- Filenames (`ans-design.css`, `ganglior-provenance.js`, `*.html`) — renaming
  them would break every `<link>`/`<script>`/bundle ref. Keep as-is.
- Any identifier, variable, function, CSS class, schema field, or the `fascia`
  alias. Strings only.
- The node names (OxyDex … CPAPDex) — already final.
- `uploads/*` export contents (the `schema.name:"ganglior.node-export"` stays).

### 9.4 Re-bundle & gates for Phase 4

Unlike the inert license comments, **brand strings shown in the app shell are
user-visible**, so the apps must be re-bundled for users to see “Tepna”:

1. Edit the brand string in each app's **source** (`*.src.html` / `*-app.js`
   banner), never the bundle.
2. **Re-bundle every app whose visible wordmark changed.** Each re-bundle changes
   that app's `buildHash` → its provenance fixture flips.
3. **Re-stamp** each affected `uploads/*.json` `buildHash` (or regenerate the
   fixture from the rebuilt bundle).
4. Run **both gates**: `Dex-Test-Suite.html` all-green, `verify-provenance.html`
   no red. (Bundling several apps at once is expected here — that's the cost of a
   visible rename, and it's intentional, not the inert-comment case from §4.)
5. Static, non-bundled files (papers, reference guides, Landing, test suite,
   docs) need no bundling — edit directly.

### 9.5 Phase 4 acceptance

- [ ] No user-facing string reads `GanglioR` or `ANS Intelligence`; all read `Tepna`.
- [ ] Grep confirms every surviving `ganglior`/`Ganglior` hit is a bus identifier,
      export/schema field, provenance, or a bus-describing UI label — **zero**
      suite-brand uses remain, and **none** of the bus tokens were altered.
- [ ] `fascia` alias intact; `ganglior.node-export` schema intact.
- [ ] All apps with a changed wordmark re-bundled; fixtures re-stamped.
- [ ] Both gates green.
- [ ] `CITATION.cff` / `NOTICE` / stamp samples already say `Tepna` (done) — verify
      they match the now-renamed UI.
