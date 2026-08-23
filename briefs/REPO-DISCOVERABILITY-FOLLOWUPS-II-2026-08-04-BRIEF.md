<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Follows:** `REPO-DISCOVERABILITY-FOLLOWUPS-2026-07-04-BRIEF.md` (DONE — 2026-08-04) · **Parent chain:** `REPO-DISCOVERABILITY-2026-07-03-BRIEF.md` (DONE — 2026-08-04) · **Affects:** `CITATION.cff`, `docs/`, `DOCS-INDEX.md`

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

- [x] A DOI is minted and surfaced, **or** the item is consciously dropped and this brief says so.
      **MINTED 2026-08-23** — the owner enabled the Zenodo↔GitHub integration and the v2.7.0 release
      publication triggered the first archive: concept DOI **10.5281/zenodo.22068939** (all versions),
      version DOI **10.5281/zenodo.22068940** (v2.7.0). Deposit metadata is deliberate via the
      `.zenodo.json` added in the release fold (title · author · Apache-2.0 · keywords), not scraped.
      Surfaced in `CITATION.cff` (`doi:` + `identifiers:`). No token, no secret, no network in any
      bundle — the integration is webhook-side on Zenodo. After three briefs of carrying, closed by
      the third path nobody listed: the item was never droppable OR mintable from the repo; it was a
      2-minute owner toggle plus a release.
- [ ] The glossary/FAQ pages exist and are gated by `build-docs --check`, **or** they are consciously
      dropped and this brief says so.
      **BUILT 2026-08-23 (owner said KEEP)** — `Glossary.html`: a 15-term glossary (mirroring
      `docs/LEXICON.md`'s reflex-arc naming + the Clock Contract vocabulary, inventing nothing the
      code does not carry) and a 10-question FAQ (privacy, devices, correctness mechanisms, clock
      disagreement, citing via the new DOI). Registered in `suite.manifest.json` `content[]` so
      Phase 0 injects roster-derived meta; first manual `docs/` copy made; linked from the front-door
      footer; in `sitemap.xml` + `llms.txt`. `build-docs --check` covers it from now on.
- [ ] Neither introduces a network fetch into any bundle or page.

> **Standing note.** Both items have now been carried across three briefs without landing. That is not a
> failure — they are genuinely off-repo/editorial and cannot be closed by a code change. But if they are
> not wanted, **dropping them explicitly is a valid and preferable outcome** to a fourth carry. The
> lifecycle allows a DONE brief to record a deliberately-dropped sub-item; it does not allow an
> indefinite IN-PROGRESS.
