<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `CITATION-ATTRIBUTION-FOLLOWUPS-2026-08-05-BRIEF.md` (DONE — 2026-08-08) · **Evidence:** `audits/CITATION-VERIFICATION-2026-08-05.json`

# The citation gate works — on the surfaces it looks at. Three things executing it left behind.

`CITATION-ATTRIBUTION-FOLLOWUPS` closed with the ledger made load-bearing: 167 DOI occurrences across
10 source surfaces now assert that the surrounding citation names the ledger's first author and a year
within ±1, and the gate was watched failing twice before being trusted. None of what follows is a
regression from that work. §1 is an obligation it created and could not discharge; §2 is a scope
boundary it drew deliberately and did not justify; §3 is a mechanism it introduced without a home.

---

## 1 · A fixture re-verification is owed, and only the corpus holder can discharge it

A citation lives in a DSP comment, and a DSP is inside the **compute closure**, so `computeHash` moved
on all five rebuilt bundles (the pair is tabulated in the parent's residue block). Per `CLAUDE.md` §🔏
that means re-verification is owed — *"DSP/clock/export/registry edit → both move ⇒ re-verification
owed"* — and it was **not run**: `tools/verify-fixtures.mjs` refuses without the corpus (24 gitignored
inputs absent), which is the tool behaving exactly as designed.

**This is not a defect to fix; it is a debt to settle**, and the releaser is the one holding the corpus:

```sh
DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs
```

**Do not** work around it. Three specific temptations, all wrong:
- Do **not** hand-stamp `verifiedUnder`. `build.mjs` is forbidden to write it precisely because it does
  not run the app, and a stamp nobody earned is the false claim FIXTURE-VERIFICATION-GATE abolished.
- Do **not** write "export-inert" in prose. `computeHash` moved; that is the *computed* answer, and it
  says re-verification is owed regardless of how confident anyone is that a comment cannot move bytes.
- Do **not** read the green suite as settling it. The run was **6021/6021 with 12 skipped**, and those
  twelve are the corpus-absent equivalence legs — the GATE-C surface that would have proven the exports
  unchanged is exactly what did not run.

**Done when:** the corpus run is executed and `verifiedUnder` re-stamped, **or** a fixture genuinely
moved and is regenerated with its node's `tools/regen-<node>-goldens.mjs` first. Record which.

## 2 · The gate stops at source surfaces, and nobody has said whether that is right

Scope is the 7 authored `* Reference.html` guides + the 3 root `*.js` carrying citations. Generated
bundles are excluded on purpose and for a good reason — their text is a copy of the DSP's, so including
them double-reports every finding and names a file you must not edit.

But DOIs also appear in **`docs/` (11 files)** and **`briefs/` (10)**, and those are neither gated nor
consciously exempted. The two cases differ and should not be decided together:

- **`docs/`** — mostly served copies of root pages, which are already gated at their source, so gating
  them again would duplicate. But `docs/` also holds **28 authored specs** no builder writes
  (`docs/LEXICON.md`, `docs/EXPORT-SHAPES.md`, all of `docs/COMPLIANCE/`) — those are unchecked source.
- **`briefs/`** — argumentative prose that cites papers in passing. A brief citing a paper loosely is
  not the same defect as a reference guide misattributing one, and gating briefs may be pure noise.

**Done when:** each of the two is either brought into scope or **explicitly exempted with the reason
recorded in the gate's own comment** — not left unmentioned, which currently reads as coverage.

## 3 · `authorAliases` is a new mechanism documented only inside the file it lives in

The gate needs aliases to avoid false reds, and four entries now carry them: a corporate author
(`10.1161/…`, whose Crossref surname is the last word of the ESC/NASPE Task Force's full name), a
spacing variant (`Du BOIS` vs `DuBois`), and **two records for which Crossref carries no author at all**
(`10.12710/cardiometry.2017.10.6676`, `10.1056/NEJM198710223171717`), supplied from the papers.

That last kind deserves scrutiny this brief is not the place to resolve: an alias sourced from the
citation being checked is mildly **circular**. It is defensible — a human-verified fact recorded in the
ledger, which is the source of truth — but it is not the same evidential class as a Crossref-resolved
author, and nothing currently distinguishes them.

**Done when:** the policy is stated where a contributor will meet it (`CLAUDE.md` §📚 or
`CONTRIBUTING.md`, not only the ledger's `_aliasPolicy` string), **and** the two authorless entries
carry a marker separating "verified against Crossref" from "supplied from the paper because Crossref
has no author" — so a future reader can tell which claim rests on what.

---

## Explicitly NOT in scope

**Gating DOI existence.** It needs network, which CI must not have, and it is the weak half anyway: all
three wrong-paper DOIs in the 2026-08-05 pass resolved perfectly. The parent settled this; re-opening it
would trade a real offline check for a fragile online one.

## Cross-references

- Parent: `CITATION-ATTRIBUTION-FOLLOWUPS-2026-08-05-BRIEF.md` (DONE — 2026-08-08).
- `CLAUDE.md` §🔏 (computeHash / `verifiedUnder` / the release wall) · §📚 (literature attribution).
- The gate: `tests/dex-tests.js`, group `docs · citation-ledger`; its data comes from
  `tests/run-tests.mjs` `readCitations()`.
