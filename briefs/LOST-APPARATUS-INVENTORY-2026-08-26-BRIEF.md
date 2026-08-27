<!--
  LOST-APPARATUS-INVENTORY-2026-08-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-27 (executed: 🟡 closed by listing, 🟠 given an evidence table, 🔴 routed for decision with both sides costed. ⚠️ **The inventory's own count was WRONG and is corrected here: 11 lost, not 12.** Two entries were OUTPUT files, not apparatus — `/tmp/sweep.json` and `/tmp/cpap-exports.json`, both `>` redirect targets of COMMITTED tools (`mutate.mjs`, `cpap-corpus.mjs`). My scan regex matched `.js` as a prefix of `.json` with no trailing word boundary, so it read two live reproduction commands as lost scripts. Nothing was lost in either case and both commands run today. A regex without a boundary producing a confident wrong count is the same defect class this brief exists to document, committed by the instrument that documented it.) · **Created:** 2026-08-26 · **Follows:** `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md` (DONE — 2026-08-26, where the first instance surfaced) · **Precedent:** `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §5

# Eleven measurement scripts are named in briefs and none of them exist

## 1 · The finding

`O2RING-WAVEFORM-SPO2-SHIP` carried a follow-up item reading *"`ppg2w-sweep.mjs` lives in session
scratch; promote to `tools/` if a second device or a post-#1596 re-sweep needs it."* The 2026-08-19
ext4 migration wiped that scratch. Checking whether it was an isolated case found it is not:

| brief | status | apparatus named | committed? | on disk? |
|---|---|---|---|---|
| ~~`CLOCK-PARSE-EQUIVALENCE-2026-08-09`~~ | — | ~~`/tmp/sweep.js`~~ | — | ⚠️ **NOT LOST — misread.** It is `/tmp/sweep.json`, the `>` target of `node tools/mutate.mjs --json`. The tool is committed; the command runs today. |
| `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03` | DONE | `/tmp/alerttest.py` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/eca/long1.mjs` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/tchaudit/e6.mjs` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/tchaudit/e9.mjs` | no | **gone** |
| ~~`DEEP-STAGE-DESAT-CONFOUND-2026-07-29`~~ | — | ~~`/tmp/cpap-exports.js`~~ | — | ⚠️ **NOT LOST — misread.** It is `/tmp/cpap-exports.json`, the `--out` of `tools/cpap-corpus.mjs`. Tool committed; command runs today. |
| `O2RING-ADAPTIVE-TIMEBASE-FOLLOWUPS-2026-08-09` | DONE | `/tmp/badhost.mjs` | no | **gone** |
| `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05` | IN-PROGRESS | `/tmp/ppg2w-sweep-results.js` | no | **gone** |
| `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05` | IN-PROGRESS | `/tmp/rprobe.js` | no | **gone** |
| `O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05` | IN-PROGRESS | `/tmp/probe_rt_ppg_rate.py` | no | **gone** |
| `PPG-SAMPLE-RATE-AND-PAT-2026-08-03` | REFERENCE | `/tmp/decimate.py` | no | **gone** |

Plus `ppg2w-sweep.mjs` itself, named without a path. **Twelve, across nine briefs.**

⚠️ **The filter matters, and a keyword sweep gets this wrong.** Searching briefs for
`scratch|/tmp|not committed` returns **42** hits, most benign — `/tmp/sweep.json` as an *output* path,
uncommitted corpus inputs, retired spike dirs. The discriminating property is *a named **script**
(`.mjs`/`.py`/`.js`/`.sh`) under a scratch path*: apparatus, not artefact. Filtering on the property
rather than the keyword takes 42 to 12.

## 2 · Why this is not bookkeeping

`PPGDEX-ALGORITHM-DEEP-DIVE` §5 already records the consequence, in its own words: a jitter bound
became unverifiable because *"§2.2 names the method and no tool"*, so **nobody — including its author
— could re-derive it**, and the threshold had to be rebuilt with a new instrument. That is one bound.
This is twelve.

**Severity is not uniform, and the split is what should drive the response:**

- 🔴 **Apparatus whose output reached a SHIPPED decision.** `ppg2w-sweep.mjs` chose the estimator that
  shipped in #1609. The winning result is live; the thing that selected it is gone, so the
  post-#1596 re-sweep the follow-up exists to enable cannot be compared against the original call.
- 🟠 **Apparatus behind a RECORDED FINDING.** `DEEP-AUDIT-V`'s three probes, `badhost.mjs`,
  `decimate.py`. The findings are written down and survive; what is lost is the ability to re-run
  them against changed code — so they age into unfalsifiable claims rather than wrong ones.
- 🟡 **Apparatus for work still OPEN.** `cpap-exports.js`, `rprobe.js`, `probe_rt_ppg_rate.py`,
  `ppg2w-sweep-results.js`. These block their own briefs' next step and will be rebuilt by whoever
  resumes — cost is duplicated effort, not lost truth.

## 3 · The rule this brief proposes

> **An apparatus whose output reaches a shipped decision or a published number is committed at the
> moment of that decision — not when someone next needs it.**

*"Promote if needed"* is a bet that scratch outlives the need. Measured: it lost that bet in **six
days** for `ppg2w-sweep.mjs`, and the reboot that broke it was itself announced in advance.

**The counter-argument, stated fairly:** committing every throwaway probe would bloat `tools/` with
one-shot scripts nobody runs again, and most scratch genuinely is disposable. That is why the trigger
is *the output reaching a decision*, not *the script existing*. A probe whose result is never cited
can be discarded freely; the moment its number appears in a brief, a PR body or a card, the script
that produced it is evidence and belongs in the repo.

## 4 · Explicitly NOT claimed

- **Not that the findings are wrong.** Nothing here re-opens a measurement. A finding whose apparatus
  is gone is unfalsifiable-by-re-run, which is a different and lesser problem than being incorrect.
- **Not that all twelve should be rebuilt.** Most should not. The 🟠 tier's value is re-runnability
  against future code, and that is worth paying for only where the claim still gates something.
- **Not that this is the complete inventory.** It covers scripts named with an explicit scratch path
  in a brief. Apparatus referenced by name only (as `ppg2w-sweep.mjs` was) is invisible to this
  filter — that one was found by reading, not by grep, and there is no cheap sweep for it.

## 4a · EXECUTION, 2026-08-27 — the three tiers worked

### 🟡 CLOSED BY LISTING — cost is duplication, not lost truth

Three survive the count correction. Each was checked against `tools/` directly rather than by
doc-search, which indexes docs and would have returned a confident nothing:

| script | brief | does a committed tool already cover it? |
|---|---|---|
| `/tmp/rprobe.js` | `O2RING-RAW-DUAL-WAVELENGTH` | **No.** Nearest are `tools/ppg2w-rate.mjs` and `ppg2w-spo2-fit.mjs`; neither computes the R-ratio probe. Rebuild if the question returns. |
| `/tmp/ppg2w-sweep-results.js` | `O2RING-RAW-DUAL-WAVELENGTH` | **No** — and see 🔴: it wrote the results of the sweep that is itself gone. |
| `/tmp/probe_rt_ppg_rate.py` | `O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS` | **No.** `tools/ppg2w-rate.mjs` measures the ppg2w rate against the 125 Hz pleth — a different quantity from the realtime-stream probe. |

**Closed. No rebuild is scheduled**: each belongs to work that is still open, so whoever resumes it
rebuilds the probe as part of resuming. The cost is duplicated effort, and it is bounded.

### 🟠 EVIDENCE TABLE — what a re-run costs, and whether the finding is load-bearing

| apparatus | the finding it produced | re-run cost | load-bearing? |
|---|---|---|---|
| `/tmp/eca/long1.mjs` · `/tmp/tchaudit/e6.mjs` · `/tmp/tchaudit/e9.mjs` | `DEEP-AUDIT-V`'s per-sensor sigma card is published despite the hat being unable to identify the reliable pair | rebuild 3 probes + a 96-epoch corpus run | **Yes** — it gates a published card. But the finding is *recorded* and the card still ships, so what is lost is the ability to re-check it against changed code, not the conclusion. |
| `/tmp/badhost.mjs` | routes a bad-host night through the adaptive timebase | rebuild + a bad-host night, which the local corpus does not contain | **No** — the brief already parks it as awaiting such a capture. |
| `/tmp/decimate.py` | `PPG-SAMPLE-RATE-AND-PAT` decimation check | small rebuild; inputs committed | **No** — REFERENCE brief, conclusion stable. |
| `/tmp/alerttest.py` | the CPAP alert POST harness — *"no alert has yet been observed to arrive"* | rebuild on the box | **No, and note the shape**: the finding was that the thing was NOT verified. Losing the harness does not un-verify anything; it was never verified. |

**The pattern worth keeping:** an apparatus behind a *negative* or *parked* finding costs almost
nothing when it is lost. The expensive losses are behind findings that something still depends on.

### 🔴 ROUTED FOR DECISION — `ppg2w-sweep.mjs`, both sides costed

**The situation.** The sweep chose the estimator that shipped in **#1609**. The estimator is live in
production; the selector is gone. The brief's re-sweep item asks to compare a post-#1596 re-fit against
the original — and that comparison is now impossible as written, because there is no original to
compare against.

**Option A — REBUILD the sweep.**
*Cost:* re-derive the estimator grid and re-run it over the corpus; unknown but not small, and the
result would be a *new* sweep, not the original.
*Risk:* ⚠️ **a rebuilt sweep that picks a different winner cannot distinguish "the original was wrong"
from "my rebuild differs" — the very ambiguity the comparison exists to resolve.** It buys a number
whose meaning is contested.

**Option B — RETRACT the re-sweep item.**
*Cost:* the brief loses a planned validation; #1609's estimator keeps shipping on its original evidence.
*Risk:* the estimator's selection is permanently un-re-checkable. If #1596 did change the right answer,
nothing will surface it.

**What I would not do:** rebuild and present it *as* the baseline. That is the fabrication this repo
guards against — a reconstructed selector reported as the one that made the call.

**RULED, 2026-08-27 — and it is neither option as posed.** The rebuild risk is decisive: a re-check is
**unbuyable at any effort price**, because no rebuilt sweep can tell "the original was wrong" from "my
rebuild differs". So option A is off. But option B is not taken bare either —
`O2RING-WAVEFORM-SPO2-SHIP` already owes a **post-#1596 re-fit on more data**, and that unit builds a
sweep as its own apparatus and selects **afresh**. That is a **supersession, not a re-check**: it
sidesteps the ambiguity instead of contesting it, and it is owed anyway.

So: the re-sweep **comparison** is retracted; the rebuild folds into the re-fit; the re-fit inherits one
line — *your sweep is new apparatus making a new selection; commit it when its output reaches the
decision*; and **#1609's selection is stamped permanently un-re-checkable at its own evidence trail**
rather than here. That last is the closure-stamp convention pointed the uncomfortable way: **a
limitation gets stamped exactly like a fix**, or the written record keeps over-representing what is
still open while quietly under-representing what can no longer be reopened.

### The convention this brief proposed, now stated for adoption

> **An apparatus whose output reaches a shipped decision or a published number is committed at the
> moment of that decision — not when someone next needs it.**

*"Promote if needed"* bets that scratch outlives the need; it lost that bet in six days for
`ppg2w-sweep.mjs`, against a migration announced in advance.

⚠️ **Its sibling, and they belong together:** *when a failure is fixed, stamp the closure AT the
narrative, not only in the changelog.* This repo records failures vividly and closures quietly, so the
written record over-represents open problems — which caused two remediation assignments in one day for
work already done. One convention keeps evidence alive; the other keeps its status readable.

## 5 · Done when

- [ ] The 🔴 tier is resolved: either `ppg2w-sweep.mjs` is rebuilt and committed, or
      `O2RING-WAVEFORM-SPO2-SHIP`'s re-sweep item is rewritten to state that no baseline comparison
      is possible and why.
- [ ] Each 🟠 brief carries a one-line note at its finding: *apparatus not committed, finding not
      re-runnable* — so a future reader knows the claim cannot be re-derived before trusting it.
- [ ] The §3 rule is recorded where a session will hit it before writing a brief, and the counter-
      argument in §3 is kept with it so the trigger is not widened to "commit every probe".

## 6 · Related

- `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §5 — the precedent, and the cost of ignoring it.
- `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md` — the 🔴 instance, corrected 2026-08-26.
- `tools/guide-directive-audit.mjs` (#1547) — the counter-example: apparatus committed so that
  #1529's four published card counts have a re-derivation rather than a citation.
