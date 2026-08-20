<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-20 (§2's **glossary half is BUILT and gated**; the FAQ half and §1's DOI are the residue, both genuinely owner-scoped — see §4) · **Created:** 2026-08-04 · **Follows:** `REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md` (DONE — 2026-08-04) · **Parent chain:** `REPO-DISCOVERABILITY-2026-07-03-BRIEF.md` (DONE — 2026-08-04) · **Affects:** `CITATION.cff`, `docs/`, `DOCS-INDEX.md`

# What is left of discoverability is off-repo or new content — nothing in-repo is blocked

The two-brief chain closed on 2026-08-04. Everything gate-able landed: front-door links, generated
`sitemap.xml` + `robots.txt`, the `cohesion` gate, per-page meta on guides and content, the feed, and
the gated `<noscript>` fallback. **§4's GitHub topics — recorded as "off-repo, deferred" for a month —
turned out to be DONE**: the repo carries 13 topics (`cgm`, `cpap`, `ecg`, `h10`, `hrv`, `lingo`,
`o2ring`, `oximetry`, …), verified against the GitHub API rather than from a header.

Two items remain, and neither is a code change. They are carried here so a closed brief does not have to
stay open to hold them.

## 1 · Zenodo DOI (§5.8) — an owner action, and the groundwork is already done

`CITATION.cff` and `papers/` are in place, so minting is the only missing step:

1. Link the GitHub repo to Zenodo and cut a release (the release machinery already exists — `changes/*`
   → `tools/release.mjs`, per CLAUDE.md §📦).
2. Add the returned DOI to `CITATION.cff` and a **"Cite this"** surface.
3. Registry / backlink submissions — `awesome-quantified-self`, `awesome-selfhosted`,
   `awesome-local-first`, AlternativeTo, Show HN. Targets are listed in the parent.

**Constraint that survives from the parent:** a DOI badge is a static string. It must not become a
network fetch on any page — `no-network.html` gates that, and CLAUDE.md's literature policy §1 makes it
a hard line ("no networked data in a bundle, ever").

## 2 · Glossary + FAQ pages (§5.8) — new content surfaces, author-scoped

An HTML render of `docs/LEXICON.md` plus an FAQ carrying `FAQPage` JSON-LD. Author-scoped because the
FAQ's *answers* are editorial: they state what the suite does and does not claim, which is exactly the
class of text the health disclaimer governs (BRIEF §6.5).

If built, they inherit the machinery that already exists rather than adding any:
- generated into `docs/` by `tools/build-docs.mjs`, so `--check` guards them like every other page;
- `<link>` `dex-badges.css` rather than inlining disc CSS, so any grade shown inherits the gated visuals
  by construction (`cohesion-badges` C3);
- indexed in `DOCS-INDEX.md`, and reachable from the §1 front-door block.

## 3 · Done when

- [ ] A DOI is minted and surfaced, **or** the item is consciously dropped and this brief says so.
- [ ] ~~The glossary/FAQ pages exist~~ — **glossary half DONE 2026-08-20** (`Glossary.html`, gated by
      `build-docs --check`); the FAQ half is **not built and not dropped** — see §4.
- [x] **Neither introduces a network fetch into any bundle or page — VERIFIED 2026-08-20.**
      `Glossary.html` carries `script=0` and exactly the two `https://` strings every sibling content
      page carries: the `rel="canonical"` URL and the `og:image` property, both *metadata* rather than
      loads, and both written by `tools/build-docs.mjs` rather than by hand. No `@font-face`, no CDN,
      no `fetch(`. Measured against `Architecture.html` and `Why This Exists.html`, which match it
      field for field.

## 4 · What executing §2 settled, and what it did not

**The glossary half is built and is a RENDER, not a second source.** `Glossary.html` carries the
reflex-arc metaphor, the role-language table, the five-tier evidence ladder and the one-line glossary
— every one of them lifted from a document that is already authoritative (`docs/LEXICON.md`,
`dex-badges.css`, the Clock Contract) with a header saying so in as many words: *"where this page and
its source disagree, the source wins and this page is the bug."*

It inherits the existing machinery exactly as §2 required, and nothing new was added to carry it:

- generated into `docs/` by `tools/build-docs.mjs`, so `--check` guards it like every other page
  (55 pages, previously 54);
- `<link>`s `dex-badges.css` rather than inlining disc CSS, so its five discs are the gated visuals by
  construction (`cohesion-badges` C3);
- in `suite.manifest.json` `content`, so Phase 0 projects its `<head>` meta from the roster and Phase 2
  puts it in `sitemap.xml` and `llms.txt` — it appears in neither `feed.xml` nor `about.json`, which is
  **correct**: no content page does;
- linked from the front door in both the nav and the footer, and indexed in `DOCS-INDEX.md`.

⚠️ **One thing about the builder is worth recording, because it reads as a failure and is not.** A
brand-new page lands in `docs/` only after a **first manual add** — `build-docs.mjs` syncs root→docs
for files that already have a twin. Until that copy exists, a full run reports `copied 0` and
`--check` still says *"docs/ current"*, because the page is not yet in the set it owns. That is
documented at the top of the builder; it is stated again here because the green `--check` on a tree
that is genuinely missing the page is exactly the shape CLAUDE.md §4b warns about.

**It deliberately defines no per-metric clinical term.** Metric identity, units and evidence tier are
node facts owned by each `<node>-registry.js`; restating them on a content page would fork the grade
table CLAUDE.md §🎫 requires to have exactly one source, and the `cohesion-badges` gate exists because
that fork has been attempted before.

### The residue is two owner-scoped items, and neither was dropped on the author's behalf

Both remaining items are decisions rather than code, and the standing note below asks for an explicit
drop rather than a fourth carry. **That drop is the owner's to make, and is therefore not made here:**

1. **The Zenodo DOI (§1)** cannot be minted from the repository at all — it needs the GitHub↔Zenodo
   link and a cut release, both account actions. The groundwork (`CITATION.cff`, `papers/`, the
   release machinery) remains in place and unblocked.
2. **The FAQ (§2)** is left unbuilt *for the reason §2 itself gives*: its answers state what the suite
   does and does not claim, which is the class of text the health disclaimer governs (BRIEF §6.5). The
   glossary could be carried from existing sources without an editorial judgement; an FAQ cannot. The
   `FAQPage` JSON-LD and the build path are ready for it whenever the answers are written.

> **Recommendation for the owner, so the fourth carry is a decision and not an omission:** drop the FAQ
> explicitly unless there is a question readers actually keep asking, and keep §1 open — a DOI is
> cheap, permanent, and the only item here with a citation payoff.

> **Standing note.** Both items have now been carried across three briefs without landing. That is not a
> failure — they are genuinely off-repo/editorial and cannot be closed by a code change. But if they are
> not wanted, **dropping them explicitly is a valid and preferable outcome** to a fourth carry. The
> lifecycle allows a DONE brief to record a deliberately-dropped sub-item; it does not allow an
> indefinite IN-PROGRESS.
