<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-10-11 · **Created:** 2026-10-11 · **Residue:** 2026-10-11-five-cited-methods-papers-have-no-local-text

# Literature ≡ formula parity — code against the papers' own text

## The gap this closes

Two audits already ran, and **neither one ever opened a paper**:

| dimension | what it compared | where |
|---|---|---|
| 1 · citation resolves | DOI → Crossref record (author, year) | `DEX-CITATION-FORMULA-AUDIT` (DONE 2026-08-05), gate `citation-ledger` |
| 2 · doc ≡ code | guide formula ≡ **code** formula | `tools/formula-constant-audit.mjs`, `tools/docs-constants.mjs` |
| **3 · code ≡ the paper** | **the code's value against what the paper states** | **nothing, until now** |

Dimensions 1 and 2 can both pass while the code and the paper disagree: a DOI that resolves and a guide
that agrees with the code say nothing about whether the number was read correctly in the first place.
The 2026-08-05 audit checked formulas "by web search, never against the papers' own text" — which was
the only option then, because the literature was not local.

It is local now (172 papers, 52 with full text), so dimension 3 became answerable by reading.

## Population and result

**18 citation sites across 8 root files, 14 distinct DOIs.** Per site: the code's value or formula and
its source comment; the paper's own sentence stating it (quoted, ≤ 15 words); a verdict.

    checked      11   (MATCH 11, MISMATCH 0)
    excluded      7   no local full text AND the claim is not in the abstract
    eligible     18

**`tepna.verdict/1` → PASS** on the pre-stated criterion *"every code constant equals the paper's stated
value in the paper's unit"*. Ledger: `audits/LITERATURE-FORMULA-PARITY-2026-10-11.json`.

**Zero mismatches is the honest result, and it is worth stating plainly rather than dressing up.** Every
figure that could be checked was right, in the paper's unit, for the paper's population — including the
two that could most easily have been wrong: `MAE 1.43 bpm, bias −0.05 bpm` is attributed to the Verity
Sense *worn on the upper arm*, which is the device and wear location the paper measured; and Arnal's
`83.5 ± 6.4 %` / `86.4 ± 8.0 %` are accuracy and F1 figures the code explicitly warns must not be read
against the kappa ranges beside them.

## The three findings that are not a mismatch

**1 · A clock-only residual is quoted as synchronisation accuracy** (items 3, 4 — `ecgdex-dsp.js:6663`,
`ppgdex-dsp.js:6658`). The code says a framework "synchronises … to 0.2-0.4 ms". The paper's abstract
says *"Clock-only error … was reduced to approximately 0.40 ms and 0.21 ms"* — the value is exact and
the scope is right, but **total IBI RMSE after correction was 3.254–4.219 ms**, an order of magnitude
worse. Nothing is miscited; the qualifier "clock-only" is missing, and without it the sentence reads as
end-to-end accuracy. → residue row `2026-10-11-clock-only-residual-quoted-as-sync-accuracy`, whose source is the code site itself (`ecgdex-dsp.js:6663`, twin at `ppgdex-dsp.js:6658`) and NOT this brief — the real origin, never the nearest brief.

**2 · Seven items cannot be checked locally, and that names what is missing** (items 7–9, 11–14). All
five DOIs behind them are pre-2000 paywalled methods papers or 1974 proceedings: Allan 1966, Gray &
Allan 1974, Knapp & Carter 1976, Sen 1968, Mann & Lees 1996. For each, the citation's **identity** is
confirmed from local metadata (title, year, journal); the **method claim** is not. The highest-value
one is **Mann & Lees 1996** — the only one whose method decides whether a metric is emitted at all,
since the AR(1)-background condition is what makes a PB cycle `null` instead of a fabricated argmax on
roughly 42 % of featureless nights. → residue row naming all five.

**3 · One paper disagrees with itself, and our code picked a side** (item 1). Arnal 2020's abstract
gives the five experts' accuracy as `86.4 ± 8.0 %`; its Table 4 narrative says *"the overall accuracy of
the five scorers is of 86.4 ± 7.4%"*. The code carries the abstract's. **Not our defect and not a
residue row** — recorded in the ledger so that nobody "corrects" the code to the other figure without
first deciding which one the paper means.

## Method, and one thing it nearly got wrong

Per paper, streamed (never the corpus in memory): locate the cited claim by searching for **the value
the code claims**, then read the sentence around it.

⚠️ **Searching for the claimed value is load-bearing, not a detail.** On item 3 the abstract's prominent
numbers are `3.254–3.263 ms` and `4.215–4.219 ms`, and reading those first put a MISMATCH one step from
being filed. `0.21 ms` and `0.40 ms` were in the same abstract, attached to a different quantity. **A
search for the claimed value finds it or proves it absent; reading the prominent numbers tests a
different claim and reports the answer under the first claim's name.**

## Acceptance

- [x] 18 sites enumerated from `grep` over root `*.js`, each routable as `file:line`
- [x] Every checkable item carries the paper's own sentence, quoted, from `~/tepna-literature`
- [x] One `tepna.verdict/1` with `checked + excluded = eligible` and a pre-stated criterion
- [x] Divergences are residue rows, not fixes — no code changed in this unit
- [x] Missing full texts enumerated by DOI with what each is wanted for
- [x] `npm run check` green

**Supersedes nothing**; it adds dimension 3 beside `DEX-CITATION-FORMULA-AUDIT-BRIEF.md` (dimension 1)
and `tools/formula-constant-audit.mjs` (dimension 2).
