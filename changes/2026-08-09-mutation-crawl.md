<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md
---
A mutation sweep produces **survivors**, and a survivor is not a work item. On `ppgdex-dsp.js`: 767 of them across 84 functions, roughly three quarters killable by no input at all. Turning that pile into work means, per survivor, finding an input that separates it from the original — mechanical, slow, and exactly what should run while nobody is watching.

`tools/mutation-crawl.mjs` does that unattended: **sweep → triage → probe → work list**, one file at a time, resumable, over a whole weekend if you like. It hands back *"these N mutants ARE killable, and here is the input that proves each"* instead of *"here are 767 survivors"*.

**It deliberately does not write tests.** Every kill in this repo's mutation work came from reading a distinguishing input and deciding what *contract* it implies — that a flat spectrum means "no peak" rather than "rate zero"; that a refusal must still *name* the node. A script can hand you the input; it cannot decide what the code ought to promise, and a generated assertion that merely pins current output kills the mutant while proving nothing.

**It never touches source, tests, or git** — only its results directory (gitignored).

### The guards, each from a failure that actually happened today

| guard | the failure it prevents |
|---|---|
| co-loads the spine (`clock.js` &c.) | first end-to-end run reported **"0 KILLABLE of 298"** — the realm had thrown `DexClock is not defined` before a single function existed |
| `probeFailed` ⇒ `killable: null` | that same run **recorded 0 as if it were a measurement**. A probe that could not run is *unmeasured*, never zero |
| `batteryIsUsable` | a probe reading `PPGDSP.loadOwnExport` (undefined) had every case throw identically, so original matched mutant **by construction** — it reported 0 of 22; the right handle found 17 |
| `isRealmArtefact` | `typeof DexUnits !== 'undefined' && …` mutated to `\|\|` throws only because *the probe's realm* lacks the module. Filtered **11 of 34** false killables on hrvdex |
| nested `calleesOf` | HRVDex hangs its API off `_bare.computeDerived`; a flat scan called all 298 survivors "unreachable" |
| `otherSweepPids` excludes self | a wait loop matching its own command line never exits — hit three times today with `pkill -f` |
| canary `FAILED` ⇒ VOID | a voided sweep is **no result**, not a low score |

Verified end-to-end on `hrvdex-dsp.js`: 490 mutants swept (canary `PASSED`), 298 survivors probed, **23 killable** after filtering 11 realm artefacts, 150 correctly reported unreachable. 27 known-answer selftest cases; `--selftest` and `--status` touch nothing.

**The number it reports is a lower bound and the provenance travels with it** — every finding carries which battery ran and how many inputs it had.
