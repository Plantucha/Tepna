<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-08 (all four items executed in one work-unit, because §3's gate reds on §1/§2 and a red gate cannot land: the gate was built FIRST, and it rediscovered exactly the four defects §1/§2 describe and nothing else — that, rather than the fix being present afterwards, is the evidence it works. `computeHash` moved on all five rebuilt bundles, so a fixture re-verification is **owed and unrun** — see the residue block below and `CITATION-ATTRIBUTION-FOLLOWUPS-II-2026-08-08-BRIEF.md`.) · **Created:** 2026-08-05 · **Follows:** `DEX-CITATION-FORMULA-AUDIT-BRIEF.md` · **Evidence:** `audits/CITATION-VERIFICATION-2026-08-05.md` · **Follow-up:** `CITATION-ATTRIBUTION-FOLLOWUPS-II-2026-08-08-BRIEF.md`

# Three attribution defects that need a DSP edit — and the gate that would have caught all six

The 2026-08-05 citation verification resolved all 86 DOIs and fixed the three that pointed at the wrong
paper. Three more defects are real but live in `*-dsp.js`, so each carries a re-bundle **and** — because
a DSP file is inside the `computeHash` closure — a fixture re-verification. They are routed here rather
than bolted onto a docs-only change.

## §1 · `integrator-dsp.js` — two citations credit the wrong authors

Both titles and DOIs are correct; only the author lists are wrong, which is the failure mode a reader is
least able to detect (the link works and lands on the paper being described).

- `10.3390/s21144777` — credited to *"Straczkiewicz M, Huang EJ, Onnela J-P (2021)"*; actually
  **Brønd JC, Pedersen NH, Larsen KT, Grøntved A (2021)**, *Sensors* 21(14):4777.
- `10.3390/jimaging8050120` — credited to *"Bent B et al. (2022)"*; actually **Xiao R, Ding C, Hu X
  (2022)**, *J. Imaging* 8(5):120.

The same wrong attribution is repeated in a `tests/dex-tests.js` comment (`Method per Straczkiewicz 2021
(Sensors 21:4777)`) — fix both, or the next reader re-derives the error from the test.

**Cost:** `Integrator.html` + `OverDex.html` re-bundle. Comment-only, so `computeHash` moves but no
export content does — which is exactly the case §🔏 says must be *proven* rather than asserted: record
the `computeHash` pair, do not write "export-inert" as prose.

## §2 · `ecgdex-dsp.js` / `ppgdex-dsp.js` — a DOI with no attribution at all

`10.1088/1361-6501/ae6a09` is cited as *"The published joint clock-skew framework (doi: …)"* across 13
sites (4 bundles + 9 analysis pages). CLAUDE.md §📚 requires **author·year·journal·DOI** in the doc and a
source comment in code; a bare DOI satisfies "checkable" but not "attributed". Correct form:
**Abdessalem K. (2026)**, *A software-only framework for synchronization of independently clocked
cardiac-linked biomedical signals*, **Meas Sci Technol**, `10.1088/1361-6501/ae6a09`.

**Cost:** `ECGDex`, `PpgDex`, `OverDex`, `Data Unifier` re-bundle + the analysis-tool rebuild.

## §3 · The gate — make the ledger load-bearing instead of decorative

`audits/CITATION-VERIFICATION-2026-08-05.json` currently records the truth and enforces nothing. A
Node-lane group (sibling of `docs-ledger`, which already reads the tree) should assert: **for every DOI
appearing in a reference guide or analysis page, the surrounding citation names the ledger's first
author and a year within one of the ledger's year.** Offline, deterministic, no network in CI.

Two design constraints, both learned the hard way in this pass:

1. **Corporate authors must not red.** Crossref stores `10.1161/01.CIR.93.5.1043`'s author as *"Task
   Force of the European Society of Cardiology and the North American Society of Pacing and
   Electrophysiology"*; the guides' *"Task Force of the ESC and NASPE"* is correct. A naive surname
   match flags three guides. The ledger needs an `authorAliases` field for these.
2. **±1 year is agreement.** Crossref's `issued` is the online-first year, a citation quotes the issue
   year. Four DOIs differ this way. Flagging them produces noise that buries a real finding — the
   failure mode this whole audit exists to prevent.

**Do NOT gate DOI existence.** That needs network, which CI must not have, and it is the *weak* half
anyway: all three real errors resolved perfectly.

## Done when

- [x] **§1 EXECUTED 2026-08-08.** `10.3390/s21144777` Straczkiewicz M, Huang EJ, Onnela J-P →
      **Brønd JC, Pedersen NH, Larsen KT, Grøntved A**; `10.3390/jimaging8050120` Bent B et al. →
      **Xiao R, Ding C, Hu X**; the repeated wrong attribution in the `tests/dex-tests.js` comment fixed
      too. Bundles rebuilt, `computeHash` pair recorded below.
- [x] **§2 EXECUTED 2026-08-08.** `10.1088/1361-6501/ae6a09` now carries **Abdessalem K. (2026),
      *A software-only framework for synchronization of independently clocked cardiac-linked biomedical
      signals*, Meas Sci Technol** in both `ecgdex-dsp.js` and `ppgdex-dsp.js`. Four bundles + the
      analysis tools rebuilt.
- [x] **§3 EXECUTED 2026-08-08** — `Citation ledger — every DOI is attributed to the right author`,
      Node-lane, 167 DOI occurrences across 10 source surfaces. **Verified by making it fail, twice,
      before being trusted:** a swapped ledger author reds with *"citation does not name X"*, a year
      shifted outside the band reds with *"no year within ±1"*. Both restored.
- [x] **Ledger `last-verified` — N/A, and that is the correct outcome.** No DOI was added or changed;
      only `authorAliases` + `aliasNote` were added to four entries, plus an `_aliasPolicy` note. The
      86 DOIs and their `_verifiedOn: 2026-08-05` stamp are untouched, so re-stamping would have
      asserted a re-verification nobody ran.

## Residue — what executing this surfaced (carried to FOLLOWUPS-II)

**A fixture re-verification is OWED and was NOT run.** A DSP comment sits inside the compute closure,
so `computeHash` moved on every rebuilt bundle — this is the pair §🔏 requires be *recorded* rather than
waved away as "export-inert":

| bundle | manifestHash | computeHash |
|---|---|---|
| Integrator | `682b2fe13c8a` → `5a8fc6e8a8ea` | `5b498233c04d` → `f7173b2d12b9` |
| OverDex | `b6938f0716d1` → `db31bb020183` | `abdd48a42639` → `bcdf71ea9966` |
| ECGDex | `2ca10218c318` → `1d280212470a` | `3e8455599fcc` → `7efa556794e9` |
| PpgDex | `3400c1294988` → `8ae8d3a027ab` | `f8aae1978b57` → `479effe13136` |
| Data Unifier | `fa22a2e1961c` → `69af34ebbb3b` | `0377802300d6` → `0c8ae2e692b5` |

`tools/verify-fixtures.mjs` refuses on a machine without the corpus — 24 gitignored inputs absent — so
`verifiedUnder` is unstamped and `tools/release.mjs` will refuse a release until the corpus holder runs
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. The node suite ran 6021/6021 with **12 skipped**,
and those twelve are the corpus-absent equivalence legs — i.e. the GATE-C surface that would have proven
the exports unchanged did not run. That is stated rather than papered over.

The other two residues — the gate's scope stops at source surfaces while DOIs also live in `docs/` and
`briefs/`, and the new `authorAliases` mechanism is documented only inside the ledger — are specified in
`CITATION-ATTRIBUTION-FOLLOWUPS-II-2026-08-08-BRIEF.md`.
