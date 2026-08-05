<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-05 · **Follows:** `DEX-CITATION-FORMULA-AUDIT-BRIEF.md` · **Evidence:** `audits/CITATION-VERIFICATION-2026-08-05.md`

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

- [ ] §1 author lists corrected in `integrator-dsp.js` + the `tests/dex-tests.js` comment; both bundles
      rebuilt; `computeHash` pair recorded.
- [ ] §2 attribution completed in both DSPs; four bundles + analysis tools rebuilt.
- [ ] §3 gate added, and **verified by making it fail** — swap one ledger author, see it red — before it
      is trusted. A gate nobody has watched fail is not evidence.
- [ ] Ledger `last-verified` re-stamped if any DOI is added or changed.
