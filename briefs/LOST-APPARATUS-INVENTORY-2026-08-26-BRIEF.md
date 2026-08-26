<!--
  LOST-APPARATUS-INVENTORY-2026-08-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-26 · **Follows:** `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md` (DONE — 2026-08-26, where the first instance surfaced) · **Precedent:** `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §5

# Eleven measurement scripts are named in briefs and none of them exist

## 1 · The finding

`O2RING-WAVEFORM-SPO2-SHIP` carried a follow-up item reading *"`ppg2w-sweep.mjs` lives in session
scratch; promote to `tools/` if a second device or a post-#1596 re-sweep needs it."* The 2026-08-19
ext4 migration wiped that scratch. Checking whether it was an isolated case found it is not:

| brief | status | apparatus named | committed? | on disk? |
|---|---|---|---|---|
| `CLOCK-PARSE-EQUIVALENCE-2026-08-09` | DONE | `/tmp/sweep.js` | no | **gone** |
| `CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03` | DONE | `/tmp/alerttest.py` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/eca/long1.mjs` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/tchaudit/e6.mjs` | no | **gone** |
| `DEEP-AUDIT-V-2026-08-04` | DONE | `/tmp/tchaudit/e9.mjs` | no | **gone** |
| `DEEP-STAGE-DESAT-CONFOUND-2026-07-29` | IN-PROGRESS | `/tmp/cpap-exports.js` | no | **gone** |
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
