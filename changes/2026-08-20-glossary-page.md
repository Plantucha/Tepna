<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [docs]
brief: REPO-DISCOVERABILITY-FOLLOWUPS-II-2026-08-04-BRIEF.md
---

Add `Glossary.html` — a gated, reader-facing render of the suite's vocabulary.

Executes the glossary half of `REPO-DISCOVERABILITY-FOLLOWUPS-II` §2, which had been carried across
three briefs without landing. The page states the reflex-arc naming system, the role-language table,
the five-tier evidence ladder and the one-line glossary.

**It is a RENDER, not a source, and says so in its own header.** Every definition is carried from a
document that is already authoritative — `docs/LEXICON.md` for the naming system, `dex-badges.css` for
the ladder, the Clock Contract for the time model — under an explicit rule: *where this page and its
source disagree, the source wins and this page is the bug*. That is the same relationship the reference
guides already have with the metric registry.

**It deliberately defines no per-metric clinical term.** A metric's identity, unit and evidence tier are
node facts owned by that node's `<node>-registry.js`. Restating them on a content page would fork the
grade table CLAUDE.md §🎫 requires to have exactly one source — the fork `cohesion-badges` exists to
prevent.

It adds no machinery. `suite.manifest.json` `content` gains a row, so Phase 0 of `tools/build-docs.mjs`
projects its `<head>` meta from the roster and Phase 2 puts it in `sitemap.xml` and `llms.txt`; it
`<link>`s `dex-badges.css` rather than inlining disc CSS (`cohesion-badges` C3); it is linked from the
front door in both nav and footer, and indexed in `DOCS-INDEX.md`. `build-docs --check` now guards 55
pages where it guarded 54. It appears in neither `feed.xml` nor `about.json` — correct, no content page
does; checked against the four siblings rather than assumed.

**No network surface added, verified rather than asserted.** `script=0`, no `@font-face`, no CDN, no
`fetch(`. The only two `https://` strings are the `rel="canonical"` URL and the `og:image` property —
both metadata rather than loads, both written by the builder, and both present field-for-field on
`Architecture.html` and `Why This Exists.html`.

⚠️ **A builder behaviour worth recording, because it reads as a pass and is not.** A brand-new page
lands in `docs/` only after a **first manual add**: `build-docs.mjs` syncs root→docs for files that
already have a twin, so until that copy exists a full run reports `copied 0` **and `--check` still says
"docs/ current"** — green on a tree genuinely missing the page. The behaviour is documented at the top
of the builder; it is called out again in the brief because it is CLAUDE.md §4b's shape exactly, a check
reporting success about something it never examined.

The brief moves to IN-PROGRESS rather than DONE. Its residue is two **owner-scoped** items and neither
was dropped on the author's behalf: the Zenodo DOI (§1) needs the GitHub↔Zenodo link and a cut release,
both account actions; the FAQ half is left unbuilt for the reason §2 itself gives — its answers state
what the suite does and does not claim, the class of text the health disclaimer governs, so unlike the
glossary it cannot be carried from an existing source without an editorial judgement.
