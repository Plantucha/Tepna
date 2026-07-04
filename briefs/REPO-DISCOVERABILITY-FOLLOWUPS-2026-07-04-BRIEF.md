<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-04 (§3 + §5.1 + §5.4 + §5.6-text + §5.8-feed EXECUTED; asset-gated / test-infra / gated / off-repo items deferred — see the execution log) · **Created:** 2026-07-04 · **Parent:** `REPO-DISCOVERABILITY-2026-07-03-BRIEF.md` (IN-PROGRESS — §1 executed 2026-07-04)

# Repo discoverability — follow-ups (everything after the §1 front-door links)

> **What this is.** The residue of `REPO-DISCOVERABILITY-2026-07-03-BRIEF.md` after its §1 (front-door
> link block in `DOCS-INDEX.md` + `README.md`) shipped 2026-07-04. Same constraints as the parent:
> **surface / signposting only** — no change to the local-first, zero-backend, no-CDN architecture, the
> gates, the Clock Contract, or any frozen identifier. The parent's §7 is answered: **`tepna.net` is a
> live PUBLIC deployment**, so `robots.txt` = **Allow all** and the SEO/OG/sitemap work is in scope.
>
> **Read `CLAUDE.md` first.** The guide filenames stay **FROZEN** (parent §2). Only §5.9 here is
> gated — it edits bundled apps' `<head>` and therefore re-bundles + moves `manifestHash`; sequence it
> last and honor the full re-bundle checklist. Everything else is additive static/markdown/off-repo.

---

## Execution log (2026-07-04) — static artifacts shipped, asset/gated/off-repo items deferred

> **The live site serves from `docs/`** (GitHub-Pages root, `docs/SITE-DEPLOY-AND-LAYOUT.md` §D), so all
> served artifacts were written there — NOT repo root. Their **source of truth is the committed builder
> `tools/build-docs.mjs`** (reads `suite.manifest.json`, syncs root→docs page bodies, then walks `docs/`),
> so they are generated output, not unmanaged hand-edits of the snapshot; re-run `node tools/build-docs.mjs`
> (or `--check` in CI) after any re-bundle / content edit / deploy-set change.

**DONE (static, zero-gate — no re-bundle, no `manifestHash` move, no fixture churn):**
- **§5.2 canonical roster** — new `suite.manifest.json` (site meta + node roster + authoritative-context list) is the SINGLE source the artifacts derive from (no forked roster).
- **§3 sitemap + robots** — `tools/build-docs.mjs` walks the 46 served `docs/*.html` and emits `docs/sitemap.xml` (`%20`-encoded, `lastmod`, home as bare `https://tepna.net/`; 0 gate/tool pages leaked) + `docs/robots.txt` (**Allow all** + `Sitemap:` — §7 public).
- **§5.1 structured data** — JSON-LD `SoftwareApplication` inlined in `index.html` `<head>` + standalone `docs/about.json` (both roster-derived, `isAccessibleForFree`, Apache-2.0, not-a-medical-device disclaimer).
- **§5.6 (text half)** — `index.html` `<head>` gained `<meta description>`, `<link rel=canonical>`, `theme-color`, OG + Twitter-Card **text** tags, `<link rel=sitemap>` + `<link rel=alternate>` feed.
- **§5.4 llms** — `docs/llms.txt` (map: guides + overview + repo-hosted authoritative docs) + `docs/llms-full.txt` (52 KB concatenation of README/ORIENTATION/ARCHITECTURE-PRINCIPLES/LEXICON/WHY-THIS-EXISTS — **CLAUDE.md deliberately excluded** as internal build/gate ops, a considered deviation from the brief's literal list).
- **§5.8 (feed)** — `docs/feed.xml` (Atom, 11 preprints, titles read from each page).
- **Root→`docs/` sync (the proposed enhancement — DONE, full coverage)** — `tools/build-docs.mjs` **Phase 1** now syncs the whole served tree, closing the "content edits need manual re-copy" gap. **Phase 1a (pages):** straight-copy every deploy `.html` that links only to shipped targets (apps, guides, content, papers, clean wiring); **mechanically de-link** pages that link to non-public targets (Tier-3 tools/gates + any raw `.md` → `<span class="tool-off">` — verified to reproduce the 13 hand-de-linked wiring pages **byte-for-byte**); **preserve** `deploy.delinkPreserve` pages (Science.html — editorially reworded lab-bench prose; `--force-delink` overrides). **Phase 1b (assets):** byte-compare + copy the 48 CSS/JS/image deploy assets. Coverage audit: all **46 pages + 48 assets have root twins** (0 orphans), so `--check` guards the entire deploy. Applied now: **8 stale app bundles** (docs/ held pre-OWN-THE-BUILD legacy builds → re-synced to the current owned plain-inline bundles, root==docs on all 8) + **GlucoDex Reference.html** + `docs/index.html`; assets audited all in-sync. Result: **0 stale, 0 dead links** across the deploy; Science.html preserved. Policy in `suite.manifest.json` `deploy{}`.

**DEFERRED (needs an asset, test-infra, a re-bundle, or an off-repo action — recorded, not half-shipped):**
- **§5.6 `og:image` + §5.8 PWA `manifest.json`/icons** — both need a **real preview image / icon PNGs**; brief says do NOT SVG-fake → **ask the author** for assets, then add.
- **§5.2 `discoverability-cohesion` gate** — the both-runners test group (every deploy page in the sitemap; every roster node has a resolving guide) is deferred to avoid a full-suite re-run this pass; `--check` in `gen-discoverability.mjs` is the interim guard.
- **§5.3 / §5.6 per-page meta on the non-index served pages** (guides, content) — front door done; the rest is a mechanical static pass, next.
- **§5.9 crawlable `<noscript>` app fallback** — **GATED** (edits bundled `*.src.html` `<head>` → re-bundle + `BUILD-MANIFEST.json` + `?full`/provenance/`no-network`); sequence last, one app at a time.
- **§4 GitHub topics · §5.8 Zenodo DOI + registry/backlink submissions** — off-repo actions; keyword/topic list + submission targets are recorded in the parent brief.
- **§5.8 glossary / FAQ pages** — new content surfaces (HTML render of `LEXICON.md` + `FAQPage`); author-scoped.

---

## Carried from the parent (unchanged scope — see the parent for the full rationale)

### §3 — Static `sitemap.xml` + `robots.txt`, **generated not hand-maintained**
- `sitemap.xml` at the deploy root listing every live `.html` surface (7 reference guides,
  `Architecture.html`, `Science.html`, `index.html`, `papers/*.html`, `wiring/*.html`,
  `how-to-collect`), spaced names `%20`-encoded, with `lastmod`.
- `robots.txt` = **Allow all** (public site) + `Sitemap:` line.
- **Generate it:** a committed Node script (sibling of `tests/*.mjs`) that walks the deploy set from
  `docs/SITE-DEPLOY-AND-LAYOUT.md`'s manifest and emits `sitemap.xml`, so it can't drift as pages land.
- **Done when:** sitemap lists every live page with resolving encoded URLs, emitted by the script (not
  by hand); `robots.txt` = Allow + Sitemap pointer.

### §4 — GitHub topic manifest (off-repo settings action)
Set repo topics: `local-first`, `self-quantification`, `biometrics`, `hrv-analysis`, `open-health`,
`signal-processing`, `oximetry`, `ecg`, `cgm`, `sleep`, `offline-first`, `apache-2.0`. Recorded here as
the source of truth so it's re-appliable. **Done when:** topics set on the repo.

### §5.1–5.8 — House additions (additive, static/off-repo)
1. **`about.json` / JSON-LD `SoftwareApplication`** in the front-door `<head>` — name, description,
   Apache-2.0 / author Michal Planicka, node roster, "100% local / no network" as structured data.
2. **One canonical roster** feeding README's node list, the DOCS-INDEX at-a-glance block, the sitemap,
   and `about.json` (a tiny `suite.manifest.json` or the deploy manifest) + a **`discoverability-cohesion`
   gate** in BOTH runners (`tests/run-tests.mjs` + `Dex-Test-Suite.html`): every deploy page appears in
   the sitemap; every roster node has a resolving reference-guide link. Stops the four surfaces drifting.
3. **Per-page `<meta name="description">` + specific front-loaded `<title>`** on the live HTML surfaces
   (static doc/guide pages — confirm per file; NOT the bundled apps → those are §5.9).
4. **`llms.txt`** (+ **`llms-full.txt`**) at the deploy root — a plain-text map / concatenation of the
   authoritative context (`CLAUDE.md`, `ORIENTATION.md`, `ARCHITECTURE-PRINCIPLES.md`, the guides).
5. **Re-affirm no egress** — run `no-network.html` after anything that touches a live app `<head>`.
6. **On-page SEO pass** — OG/Twitter-Card tags (needs a real preview image — **ask the author**, don't
   SVG-fake), one `<h1>`/page, `<link rel="canonical">` on every live page (also resolves the
   encoded-vs-pretty + `docs/` mirror duplicate-content question), truthful JSON-LD (`TechArticle` for
   guides, `ScholarlyArticle` for papers).
7. **SEM / keyword map** — organic only (a free, no-account tool has little to sell; paid search likely
   out of scope — flag, don't assume budget). One primary + one secondary keyword per page, the single
   source the `<title>`/meta/OG copy derives from. Lead with the local-first/privacy cluster.
8. **Off-site & ingestion signals (highest real leverage)** — registry/backlink submissions
   (`awesome-quantified-self`/`-selfhosted`/`-local-first`, AlternativeTo, Show HN); **Zenodo DOI**
   (`CITATION.cff` + `papers/` already in place → mint a DOI, add a "Cite this" surface +
   `ScholarlyArticle`/`SoftwareSourceCode` JSON-LD); static `feed.xml` for `papers/` (regenerated by
   the §3 script); glossary (HTML render of `LEXICON.md`) + FAQ with `FAQPage` JSON-LD; dense internal
   cross-linking; `lastmod`/`dateModified` freshness; PWA `manifest.json` + icons.

### §5.9 — ⚠️ GATED, LAST — crawlable `<noscript>` fallback for the JS-heavy app pages
The bundled app pages (`OxyDex.html`, `ECGDex.html`, …) render a near-empty shell to a crawler/LLM
that doesn't run their JS. Give each a **static `<head>` (title + description + canonical + OG) and a
`<noscript>` summary** (what the node does, its inputs, a link to its reference guide) so the URL is
meaningful without execution.

**This is the one non-zero-gate item.** It edits a bundled `Foo.html`'s `<head>`, so it MUST be done in
the app's `*.src.html`, re-bundled (owned build — `node tools/build.mjs --app <Name>`), that app's
`BUILD-MANIFEST.json` `manifestHash` updated, and `Dex-Test-Suite.html?full` + `verify-provenance.html`
re-run + `no-network.html` re-affirmed. One app at a time; never fold into a static-only pass.

---

## §2 (parent) — optional pretty-URL redirect stubs (decision, only if wanted)
The guides are **not** renamed. IF a clean URL is genuinely wanted, ship an additive redirect stub at
the pretty path (`docs/oxydex-reference.html` → `<meta http-equiv="refresh">` / `<link rel="canonical">`
to the real spaced file). The stub is always the NEW pretty path pointing BACK to the canonical spaced
file, so nothing existing is rewired and no gate moves. Prefer even this only if the author asks.

---

## Sequencing & gates
1. §3 sitemap/robots + generator, §4 topics (off-repo), §5.1–5.8 metadata/off-site — additive
   static/markdown/off-repo, **no re-bundle, no `manifestHash` move, no fixture re-record**; gates stay
   green and the only new gate is the §5.2 discoverability-cohesion group.
2. **§5.9 LAST and gated** — per-app `*.src.html` `<head>` → re-bundle → `BUILD-MANIFEST.json` →
   `?full` + `verify-provenance` + `no-network`.

## Open questions for the author (answer before executing)
- Is there a single front-door `index.html` as the home for JSON-LD/meta (yes — `index.html` exists), or
  should structured data also live on the rendered `DOCS-INDEX`/`README`?
- Provide a real OG preview image (suite-wide or per-page), or defer OG tags until one exists?
- Want the optional §2 pretty-URL redirect stubs, or leave the `%20`-encoded links as the only path?
- Paid SEM: in or out of scope? (Default assumption: **out** — organic only, no trackers.)
