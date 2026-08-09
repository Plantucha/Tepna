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

> ### ✅ SETTLED 2026-08-08 — and this section asked about the wrong two surfaces
>
> §2 named `docs/` and `briefs/`. It **missed `papers/`** — and that is the one that mattered: three
> published papers carry **32 DOIs**, authored (`rebase-safe --classify` → `source`), reader-facing,
> and entirely ungated. If a wrong author list is worst where the link still resolves and still lands
> on the paper being described, a *paper* is the worst place for it.
>
> Each surface was **measured before deciding**, not reasoned about:
>
> | surface | occurrences | problems | verdict |
> |---|---|---|---|
> | `papers/**` | 32 | **0** | **IN** |
> | `docs/**.md` | 4 | **0** | **IN** |
> | `briefs/` | 49 | **17** | **OUT** |
> | `docs/*.html` | — | — | OUT — served copies, already gated at their source |
>
> **`briefs/` is exempt on evidence, not on a hunch.** All 17 are false: a brief quotes a wrong
> attribution *in order to say it is wrong*, and the top offender is `CITATION-ATTRIBUTION-FOLLOWUPS`
> itself, tripping four times on the very defects it fixed. Gating briefs would make the gate loudest
> exactly where the repo documents its own corrections. The reason now lives in the gate's comment.
>
> **Gating a clean surface is the point, not a waste.** `papers/` and `docs/**.md` added zero findings
> — they are correct today, and now they cannot drift.
>
> **Scope is pinned structurally, not by a count.** A count floor cannot distinguish "`papers/` was
> dropped" from "a paper lost a citation", and dropping a surface is the failure that passes quietly
> because a narrower gate is always greener. Three assertions name the surfaces directly.
>
> **Verified by making it fail on a NEWLY covered file** — corrupting `Schipper` in
> `papers/acc-respiratory-rate.html` reds 4 DOIs. The first attempt replaced only the *first* of six
> occurrences, left every citation window intact, and passed: a falsifier that does not reach the code
> reports the gate as fine, which is the same trap §3's battery lessons describe. Total 167 → **203**
> occurrences, 10 → **14** surfaces.

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

> ### ✅ EXECUTED 2026-08-08 — and the marker is gate-enforced, because an unchecked marker decays too
>
> **`aliasSource` is now required on every aliased entry**, with exactly two values:
>
> | DOI | `firstAuthor` | `aliasSource` | why |
> |---|---|---|---|
> | `10.1001/archinte.1916.…` | `"Du BOIS"` | `crossref-variant` | spacing — the paper spells it `DuBois` |
> | `10.1161/01.CIR.93.5.1043` | `"Electrophysiology"` | `crossref-variant` | corporate — last word of the ESC/NASPE Task Force's full name |
> | `10.1056/NEJM198710223171717` | `""` | `from-paper` | Crossref carries **no author**; read off the paper (Mosteller RD) |
> | `10.12710/cardiometry.2017.10.6676` | `""` | `from-paper` | Crossref carries **no author**; read off the paper (Baevsky RM) |
>
> The distinction §3 asked for is exactly this: a `crossref-variant` alias still rests on Crossref, so
> the check is independent of the thing being checked. A `from-paper` alias does not — the citation
> supplies its own answer. That is defensible and it is **marked rather than hidden**.
>
> **Recording it was not enough, which is this brief's own thesis applied to itself.** A marker nobody
> checks is a claim in prose, and §1 of `GENERATOR-FOLLOWUPS-III` measured what happens to those: an
> artifact claim decays silently as the tree moves. So the `citation-ledger` group now asserts it, and
> was **watched failing three ways** before being trusted — a missing `aliasSource`, an unknown value,
> and `from-paper` asserted on a record where Crossref *did* record an author (which would launder a
> variant into the weaker class). All three red; all three restored.
>
> **Policy stated in `CLAUDE.md` §📚**, not only in the ledger — including the scope (guides, `papers/**`,
> `docs/**.md`, root `*.js`; `briefs/` deliberately out at 35 % false positives; no DOI resolution,
> which needs network) and one prohibition worth naming: **never silence a finding by editing
> `firstAuthor`.** That is the single edit which makes a real defect disappear, and no gate can catch
> it — the ledger is the oracle.

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
