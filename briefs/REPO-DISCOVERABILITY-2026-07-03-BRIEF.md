<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-07-03 · **Created:** 2026-07-03

# Repo discoverability — "first-look" clarity for humans, crawlers & LLMs

> **What this is.** A proposal (external, unsolicited) to make Tepna *legible on first landing* —
> so an AI or a developer who opens the repo (or `tepna.net`) grasps the full scope in seconds and
> can reach the deep technical surfaces (reference guides, wiring pages, papers) without spelunking.
> This is a **surface / signposting** change only: it adds navigation and search metadata, it does
> **NOT** touch the local-first, zero-backend, no-CDN architecture, the gates, the Clock Contract,
> or any frozen identifier.
>
> **Read `CLAUDE.md` first.** One step of the source proposal (renaming the reference guides)
> collides head-on with the **FROZEN-filename** rule; §2 below records why and the sanctioned
> alternative. The authoritative doc wins.

---

## §0 — Why (the actual gap)

The elite engineering under the hood is real; the *entry path over it* is thin. Today the front
door is `README.md` + `DOCS-INDEX.md`, and the deep surfaces — the 7 `* Reference.html` guides, the
13 `wiring/` "How It's Wired" pages, `Architecture.html` / `Science.html`, the `papers/` preprints —
are only reachable if you already know they exist. A first-time reader (or an indexing crawler, or
an LLM asked "what is Tepna?") sees a fraction of the depth. The fix is signposting, not new
material.

**Non-goals (explicit):** no new analytical content, no marketing copy, no network calls, no CDN,
no build/runtime behavior change, **no re-bundle** (nothing here edits a `*.js`/`.src.html`), and
**no gate churn** (no `manifestHash` moves, no fixture re-records).

---

## §1 — Front-door link block, near "About" (do this first — cheapest, highest value)

Per the source proposal's Step 1 **and** the steer to "put links in the index near about": the
first thing a reader hits should point at the deep surfaces explicitly.

- **`DOCS-INDEX.md` — add an "At a glance / live surfaces" block right under the intro** (above
  "§0 · Read first"), linking the *live HTML* a reader actually wants first: the 7 reference guides,
  `Architecture.html`, `Science.html`, `papers/papers.html`, and `wiring/`. `DOCS-INDEX.md` today
  maps the ~60 *markdown* docs; it under-surfaces the HTML. This block closes that.
- **`README.md` — promote the repo map to a structural manifest** (Step 1's shape), with a
  `## 🛠️ Architecture: The Dex Suite` node list where each Dex links its reference guide, and a
  `## 🔬 Scientific Foundation` line linking `papers/`. Keep it terse — node → one-line role → link.
  Reuse the existing roster; invent no new prose.
- **Link hygiene:** filenames contain spaces, so every link must be URL-encoded (`OxyDex%20Reference.html`).
  Markdown link *text* can stay human ("Read Technical Reference"); only the target is encoded. This
  is the correct fix for the space-in-filename friction — **not** renaming the files (see §2).

**Done when:** from `DOCS-INDEX.md` top and `README.md`, every reference guide + `papers/` + wiring
set is reachable in one click; all links resolve (spaces `%20`-encoded); no link 404s.

---

## §2 — ⚠️ Do NOT rename the reference guides (source Step 2 conflicts with a house rule)

The source proposal's Step 2 ("rename `CPAPDex Reference.html` → `CPAPDex-Reference.html` / a
lowercase `docs/` tree") **must not be executed as written.** These filenames are **FROZEN
cross-references**, and renaming them would break, at minimum:

- the **regression gate** — `Dex-Test-Suite.html` and `tests/run-tests.mjs` fetch each guide by its
  exact spaced name for the `cohesion-badges` group (engine ≡ `dex-badges.css` ≡ guide); a rename
  reds the gate;
- the **deploy manifest** `SITE-DEPLOY-AND-LAYOUT.md`, `BADGE-COVERAGE-AUDIT-BRIEF.md`'s node table,
  `ECGDEX-REFERENCE-GUIDE-BRIEF.md`, and numerous other briefs that name the files verbatim;
- the `docs/` and `uploads/` mirror copies.

CLAUDE.md is unambiguous: filenames are stable cross-reference targets; you don't rename to "improve"
them. The stated *goal* of Step 2 — crawlers resolving the paths — is met by §1's URL-encoding plus
§3's sitemap, with **zero** breakage.

- **Sanctioned alternative (optional, only if a clean URL is genuinely wanted):** ship a
  **redirect stub** at the pretty path (e.g. `docs/cpapdex-reference.html` → `<meta http-equiv=
  "refresh">` / `<link rel="canonical">` to the real file) — additive, breaks nothing, and is the
  same redirect-stub pattern CLAUDE.md already sanctions for relocations. Prefer even this only if
  someone asks; the encoded links + sitemap are enough.
- **⚠️ Do NOT invert the file identity (rules out the "copy to new name, stub the old one" idea).**
  A tempting variant is to make the new hyphenated file canonical and turn the old spaced file into
  a superseded stub. Rejected: that forces rewiring *everything that points at the spaced name* (the
  gate's fetch lists, `SITE-DEPLOY-AND-LAYOUT.md`, `BADGE-COVERAGE-AUDIT-BRIEF.md`, the guide briefs,
  the `docs/` mirror) — i.e. editing the FROZEN references the rule protects — and splits git history
  + creates duplicate content. The stub must always be the NEW pretty path pointing BACK to the
  canonical spaced file, so **nothing existing is rewired and no gate moves.** Direction matters.

**Done when:** decision recorded that the guides are **not** renamed; if stubs are added, the gate
and provenance both stay green (stubs are new files, not edits to gated ones).

---

## §3 — Static `sitemap.xml` + `robots.txt` (source Step 3 — a good fit, local-safe)

A static sitemap is fully compatible with the zero-backend model — it's just two committed files, no
runtime, no network from the app.

- Add **`sitemap.xml`** at the deploy root listing every live `.html` surface (the 7 guides,
  `Architecture.html`, `Science.html`, `index`/front door, `papers/*.html`, `wiring/*.html`,
  `how-to-collect`). Use encoded URLs for spaced filenames.
- Add **`robots.txt`** that `Allow`s all and points at the sitemap.
- **Generate it, don't hand-maintain it:** a tiny committed Node script (sibling of the existing
  `tests/*.mjs` tooling) that walks the deploy set from `SITE-DEPLOY-AND-LAYOUT.md`'s manifest and
  emits `sitemap.xml`, so it can't drift as pages are added. (My addition — see §5.)
- **Scope caveat:** this only helps if `tepna.net` is a *public* deployment the author wants indexed.
  If the site is private/local-only (the Health-Box `tepna.local` LAN case), a `robots.txt` that
  **disallows** indexing is the correct opposite choice. Confirm intent before shipping — this is a
  one-line flip, not a rewrite.

**Done when:** `sitemap.xml` lists every live page with resolving (encoded) URLs and is regenerated by
the script, not by hand; `robots.txt` matches the author's public/private intent.

---

## §4 — GitHub topic manifest (source Step 4 — do it, it's free)

Tag the GitHub repo with standard keywords so search graphs and LLMs pull the right context:
`local-first`, `self-quantification`, `biometrics`, `hrv-analysis`, `open-health`,
`signal-processing` — plus suite-specific ones worth adding: `oximetry`, `ecg`, `cgm`, `sleep`,
`offline-first`, `apache-2.0`.

This is a repo-settings action (the sidebar "Topics" field), not a file change — capture it here so
it isn't lost, and note it in `README.md`'s header for humans who read the file, not the sidebar.

**Done when:** topics set on the repo; the keyword list is recorded in this brief (above) as the
source of truth so it can be re-applied.

---

## §5 — House additions (my ideas — same "make it legible" spirit, same constraints)

These extend the proposal in the suite's own idiom (single-source-of-truth, gate-backed, additive):

1. **Machine-readable `about.json` / JSON-LD `SoftwareApplication` block** in the front-door page's
   `<head>`. A crawler/LLM gets name, description, license (Apache-2.0, author Michal Planicka),
   the node roster, and "100% local / no network" as *structured* data — the strongest possible
   "first-look" signal, and it costs one static block. Source of truth = the same roster §1 uses;
   don't fork it.
2. **One canonical roster, referenced everywhere.** README's node list, DOCS-INDEX's live-surface
   block, the sitemap, and `about.json` should all derive from **one** roster (the manifest in
   `SITE-DEPLOY-AND-LAYOUT.md` or a new tiny `suite.manifest.json`). Otherwise these four surfaces
   drift — exactly the failure mode CLAUDE.md's single-source-of-truth rule exists to prevent. Wire
   a lightweight check into `tests/dex-tests.js` (a "discoverability-cohesion" group: every deploy
   page appears in the sitemap; every node in the roster has a resolving reference-guide link) so
   the signposting can't silently rot as EEGDex/SpiroDex land.
3. **Per-page `<meta name="description">` + `<title>` audit** on the live HTML surfaces — the single
   most impactful SEO/first-look signal after the sitemap, and today likely thin/absent. One line per
   page, drawn from the roster role. Additive, no re-bundle (these are the static doc/guide pages,
   not the bundled apps — confirm per file).
4. **`llms.txt` at the deploy root** (the emerging convention, sibling of `robots.txt`): a short
   plain-text map that tells an LLM crawler *where the authoritative context lives* — `CLAUDE.md`,
   `ORIENTATION.md`, `ARCHITECTURE-PRINCIPLES.md`, the reference guides — so a model summarizing
   Tepna reaches for the constitution, not a random brief. Pure static, on-brand for a suite that
   already thinks about being "ingested."
5. **Guard the invariant:** whatever ships here, re-affirm no egress. The new artifacts
   (`sitemap.xml`, `robots.txt`, `llms.txt`, `about.json`, meta tags) are static and network-free by
   construction, but run **`no-network.html`** after if any live app `<head>` is touched, so the
   privacy gate stays honest.
6. **On-page SEO pass (organic — the high-value, on-brand half).** Beyond the per-page meta of
   §5.3, do the classic on-page set, all static and local:
   - **`<title>` = specific, front-loaded** — e.g. *"OxyDex — Overnight SpO₂ & ODI Analysis · Tepna"*,
     not *"OxyDex Reference"*. One keyword-bearing phrase per page, drawn from the roster role.
   - **Open Graph + Twitter Card tags** (`og:title`, `og:description`, `og:type`, `og:url`,
     `og:image`, `twitter:card`) so a shared link renders a rich preview instead of a bare URL.
     Needs one static preview image per page (or one suite-wide) — **use a real asset / placeholder,
     ask the author**; do not SVG-fake it.
   - **One `<h1>` per page, semantic heading order, descriptive link text** (already partly true in
     the guides — audit and fix outliers).
   - **`<link rel="canonical">`** on every live page (also resolves the encoded-vs-pretty-URL and
     `docs/` mirror duplicate-content question — point all copies at one canonical).
   - **Structured data beyond §5.1:** JSON-LD `Dataset`/`TechArticle`/`FAQPage` where it genuinely
     fits (the papers are `ScholarlyArticle`; the guides are `TechArticle`) — only where truthful,
     never keyword-stuffed.
7. **SEM / keyword strategy (scope honestly — mostly organic, not paid).** For a free, local-first,
   no-account open-source health tool there is little to *sell*, so paid search (Google/Bing Ads)
   is likely **out of scope** — flag it and let the author decide rather than assuming a budget.
   The valuable, free "SEM" work here is the **keyword map** feeding §6/§5.3/§5.6:
   - Cluster around intent: *device* terms (`O2Ring analysis`, `Polar H10 HRV`, `Verity Sense PPG`,
     `CGM overnight`), *method* terms (`RMSSD`, `ODI-4`, `three-cornered hat sensor error`,
     `Lomb–Scargle HRV`), and *philosophy* terms (`local-first health`, `offline biometrics`,
     `no-account self-quantification`) — Tepna's genuine differentiator is that last cluster; lead
     with it.
   - Map one primary + one secondary keyword to each live page; that map is the single source the
     `<title>`/meta/OG copy derives from (keeps §5.2's no-drift discipline).
   - **If** the author ever does want paid acquisition, the honest angle is the privacy/local-first
     value prop, not clinical claims — but treat that as a separate, later decision; this brief ships
     no ad spend and no tracking pixels (a tracker would violate the no-egress invariant outright).
8. **Off-site & ingestion signals (highest real leverage — mostly free backlinks).** On-page SEO is
   table stakes; *inbound links + citability* move the needle far more:
   - **Registry / backlink submissions.** Submit to `awesome-quantified-self`, `awesome-selfhosted`,
     `awesome-local-first`, AlternativeTo, and a *Show HN*. External links to `tepna.net` are the
     single strongest ranking lever and cost only time. Track the list here so it's repeatable.
   - **Zenodo DOI (biggest AI-visibility win).** `CITATION.cff` + the real `papers/` preprints are
     already in place — cut a Zenodo release to mint a **DOI**. That makes the work citable, indexes
     it in Google Scholar / Semantic Scholar, and is *heavily* favored by research-trained LLMs.
     Add a "Cite this" surface + `ScholarlyArticle`/`SoftwareSourceCode` JSON-LD once the DOI exists.
   - **RSS/Atom feed for `papers/`** — a static `feed.xml` (regenerated by the §5.2 script) is a
     "what's new" signal crawlers and AI ingesters prioritize.
   - **`llms-full.txt`** alongside `llms.txt` (§5.4): the concatenated-authoritative-docs convention
     (CLAUDE.md + ORIENTATION + ARCHITECTURE-PRINCIPLES + the guides) so a model gets full context in
     one fetch, not a map it then has to crawl.
   - **Glossary / definition pages** (an HTML render of `LEXICON.md`) + a **FAQ page with `FAQPage`
     JSON-LD.** Long-tail method queries (RMSSD, ODI-4, three-cornered hat) and question-form LLM
     prompts ("how to analyze O2Ring data") land on exactly these — definition/FAQ pages rank well
     and are what models quote.
   - **Dense internal cross-linking** — every guide links its siblings + back to the index; lets
     crawlers reach depth and flows link-equity through the set.
   - **Freshness signals** — `lastmod` in `sitemap.xml` + `dateModified` in JSON-LD.
   - **PWA `manifest.json` + icons / suite `og:image`** — already offline-capable, so an installable
     manifest is a natural, cheap credibility + shareability signal (pairs with the OG tags in §5.6).
9. **Crawlable fallback for the JS-heavy app pages (a real gap, flag before executing).** The
   `* Reference.html` guides are static and index cleanly, but the bundled app pages
   (`OxyDex.html`, `ECGDex.html`, …) likely render a near-**empty shell** to a crawler/LLM that
   doesn't run the app's JS — so those canonical URLs contribute little to discoverability. Give each
   app page a **static `<head>` (title + description + canonical + OG) and a `<noscript>` summary**
   (what the node does, its inputs, a link to its reference guide) so the URL is meaningful without
   execution. ⚠️ **This edits a bundled `Foo.html`'s `<head>` → it MUST be done in the app's
   `*.src.html` and re-bundled, then that app's `BUILD-MANIFEST.json` entry updated** (GATE A moves)
   — the one item in this brief that is NOT a zero-gate change. Sequence it deliberately, run
   `Dex-Test-Suite.html` + `verify-provenance.html` after, and re-affirm `no-network.html`.

---

## §6 — Sequencing & gates

1. §1 front-door links (README + DOCS-INDEX) — pure markdown, no gate impact.
2. §4 GitHub topics + §5.8 registry/backlink submissions + Zenodo DOI — off-repo actions, no file gate.
3. §3 sitemap/robots + §5.1–5.4 + §5.6 metadata + §5.8 static artifacts (feed.xml, llms-full.txt,
   glossary/FAQ, manifest.json) — static files; `tepna.net` is public (§7) so robots = Allow.
4. §5.2 cohesion check — wire into **both** runners (`tests/run-tests.mjs` + `Dex-Test-Suite.html`).
5. §2 — **decision only** (no rename); optional redirect stubs are additive.
6. **§5.9 crawlable app fallback — LAST, and gated.** The only step that edits a bundled app
   (`*.src.html` `<head>` → re-bundle → update `BUILD-MANIFEST.json`); do it deliberately, one app
   at a time, honoring the full re-bundle checklist.

**Gate expectations:** everything in §1–§5.8 is additive static/markdown/off-repo — **no re-bundle,
no `manifestHash` move, no fixture re-record**; `Dex-Test-Suite.html` + `verify-provenance.html` stay
green and the only new gate is the optional discoverability-cohesion group (§5.2). **§5.9 is the
single exception:** it touches bundled apps' `<head>`, so each affected app re-bundles and updates its
`BUILD-MANIFEST.json` entry per the CLAUDE.md checklist — flag and sequence it, never fold it into a
static-only pass.

## §7 — Open questions for the author (answer before executing §3/§5)

- ~~Is `tepna.net` public or LAN-only?~~ **Answered 2026-07-03: `tepna.net` is a live PUBLIC
  deployment (and still fully usable offline).** → `robots.txt` = **Allow all**, `sitemap.xml` is
  wanted, and the SEO/OG/canonical work in §5–6 is in scope. (The LAN `tepna.local` Health-Box case,
  if it ever serves publicly, would want its own Disallow — separate origin, not this one.)
- Is there a single front-door `index.html` on the deployment (the natural home for JSON-LD / meta),
  or does the site open on `DOCS-INDEX`/`README` rendered by the host?
- Want the optional pretty-URL redirect stubs (§2), or leave the encoded links as the only path?
