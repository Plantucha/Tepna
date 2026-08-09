<!--
  NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-09 (§1 executed 2026-08-06; §2 PARKED on its own stated default; §3 executed
2026-08-09 — the four ungated nodes gain a 17-assertion envelope-tracking gate, mutation-verified in both
directions. ⚠️ **Executing §3 falsified the parent's §7 table for two of the four nodes:** PulseDex's
*untimed* path publishes DATA seconds as `durMin` **and asserts `coverage: 100`** on a stream it cannot
place in time, and GlucoDex's `recordedSec` is **the same expression as** `spanSec`, so a 6 h CGM dropout
reports full coverage — under a comment claiming the two "agree BY MEASUREMENT". Both are pinned as
characterization and routed to the follow-up; neither is fixed here, because both are compute-path DSP
edits owing a re-bundle + golden regeneration.) · **Created:** 2026-08-06 · **Follows:**
`NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md` (DONE — 2026-08-06) · **Spawns:**
`NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II-2026-08-09-BRIEF.md` · **Affects:** `motiondex-dsp.js`, `ppgdex-dsp.js`, the six nodes that do not publish `endEpochMs`

# What closing the duration ruling surfaced — one live fabrication, one residual, and a habit

The parent is DONE: every node either publishes both scalars or was measured not to need the second
one, and the two items that stayed open longest turned out to be **premises rather than measurements**
(parent §8). This is the residue. Item 1 is a real latent defect with a measured magnitude; items 2–4
are bounded observations recorded so they are not rediscovered.

---

## 1 · `motiondex-dsp.js durationOf` fabricates a duration from an assumed 26 Hz — and 26 is wrong

The parent's §8.2 measured both halves of this and deliberately did not fix it. Carried here because
"unreachable today" is a property of the current parser, not of the function.

```js
function durationOf(rows, t0Ms) {
  if (!rows || rows.length < 2) return 0;
  var last = relSecOf(rows[rows.length - 1], t0Ms, streamBaseMs(rows));
  return last != null && last > 0 ? last : rows.length / 26;   // ← motiondex-dsp.js:1127
}
```

**What is measured** (616 real ACC files · 121,429,712 rows · 690 h, both corpus trees):

- the branch fires **0 times** — no parsed row anywhere lacks both a Phone timestamp and a device counter;
- the delivered ACC rate is **20.9–202.7 Hz** (H10 median 50.7, Verity median 51.7), so 26 is wrong by
  **0.8×–7.8×** for the corpus it would be applied to;
- reached via `compute({ acc: rows })` with untimed pre-parsed rows, it publishes **462 s for a 60 s
  record** beside a `startEpochMs` of **`null`** — every other field says *unknown*, this one invents.

**Why it was not fixed in the parent.** `motiondex-dsp.js` is inside the compute closure, so any edit
moves `computeHash` and owes fixture re-verification — for a branch no input reaches (parent §7.2's
economics, which that brief spends a section defending). And the honest replacement is **not** a
one-liner: `durSec` feeds `bodyPosition` / `actigraphy` / `respiratoryEffort`, each of which divides by
it (`Math.ceil(durSec / epoch)`), so returning `0` or `null` changes three windowing denominators on a
path that currently returns a number.

**The shape a fix should probably take** — recorded as a starting point, not a decision:

1. **Scan backward** for the last row that resolves a `relSec`, instead of reading only `rows[n−1]`.
   Strictly better, cannot regress anything, and mirrors what `parsePPG` already does for `endEpochMs`
   ("read from the last row whose stamp parses"). This alone shrinks the branch's reachability.
2. Only when **no** row resolves one is the duration genuinely unknown — and then it must say so rather
   than divide by a nominal. Deciding between `0` and `null` is the part with blast radius, and it needs
   the three consumers looked at together.

**Done when:** the assumed-rate divide is gone; the three consumers are shown to behave sanely on a
no-timing stream; `motiondex-dsp · export · duration-semantics` still passes (it pins the *timed* path,
which must not move); and the re-bundle + `verify-fixtures` cycle the change owes is run, not asserted.

**Guardrail:** do **not** replace 26 with a better constant. A measured median of ~51 Hz would be wrong
for the 202.7 Hz files and the 20.9 Hz ones alike — "any assumed rate is wrong for some file" is already
this repo's recorded finding (`MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS` §2). The fix is to stop assuming.

## 2 · 43 PpgDex files where `t0 + durSec` OVERRUNS the last stamp by up to 24.9 s

The parent measured the shortfall direction thoroughly (§6.1, §8.1) and noticed the other tail without
chasing it: on 43 of 322 files `t0 + durSec` lands **past** the last stamp — worst 24.9 s over 9726 s,
i.e. **0.26 %**. All are contiguous Verity records with no coverage block, which points at the `fs`
estimate rather than at gap accounting: `durSec = (n−1)/fs`, so a rate under-estimated by 0.26 % over-runs
by exactly this much.

It changes no verdict — it is well inside the rounding of any duration field, and `endEpochMs` (read,
not derived) is unaffected by construction, which is the whole reason that field is read. Worth one pass
only if PpgDex's `fs` estimator is ever revisited for another reason. **Park unless that happens.**

## 3 · The six nodes still do not publish `endEpochMs`, and that is a standing decision, not a gap

Parent §7 measured that OxyDex · MotionDex · PulseDex · GlucoDex · CPAPDex · HRVDex each derive a span,
so `t0 + dur` already lands on the clock end to within their own rounding (±1–3 s). §7.3 routes the field
to "ride each node's next behavioural re-bundle".

**The risk to watch is drift, not absence.** Six nodes carrying an implicit convention that lives only in
a closed brief is how the original defect arose — §1's three nodes disagreed and nothing said which was
right. If a seventh node is added, or one of the six changes how it derives its duration, that node needs
the parent's §3 contract applied deliberately. A cheap ratchet would be a gate asserting each node's
published duration still tracks its own envelope on a synthetic gapped twin — the OxyDex and PpgDex gates
are the template, and four of the six have no such assertion today.

## 4 · The method note — the parent was wrong about its own nodes four times, always the same way

Recorded because it is cheap to repeat. §6.1 (PpgDex grouped with OxyDex on reasoning), §7 (six nodes
treated as uniform work), the OxyDex `[~]` (a stale `pending` label), and §8.1/§8.2 (two unmeasured
premises) were **all** corrected by driving the shipped code over real files, and **none** by re-reading
the source. In each case the source supported the wrong reading perfectly well.

The tell is a table describing behaviour with no measurement beside the row. This repo already has the
apparatus to settle such a row in minutes — a vm realm, `classicify`, the corpus — and the parent's four
corrections each cost one probe. **Before carrying a per-node claim forward a third time, run it.**

---

## 5 · Done when

- [x] **§1 — DONE 2026-08-06.** The assumed-26 Hz divide is gone; see §1-RESULT.
- [x] **§2 — PARKED (the stated default), 2026-08-09.** No PpgDex `fs`-estimator pass is scheduled, and
      the item's own reasoning holds: 0.26 % over 9726 s is inside the rounding of any duration field,
      and `endEpochMs` is read rather than derived so it is unaffected by construction. Re-open only if
      the `fs` estimator is revisited for another reason.
- [x] **§3 — DONE 2026-08-09, and NOT the way this item assumed.** The four ungated nodes gain the
      envelope-tracking assertion (17 assertions, `duration-semantics` tag, both lanes) — and running it
      found that **two of the four do not satisfy the contract**. See §3-RESULT.
- [x] **§4 — kept, and it just earned its keep again.** §3-RESULT is the fifth instance: the parent's §7
      table asserted a span for all four of these nodes, and two of those rows are wrong. Both were
      caught by executing the shipped builder, neither by reading. Do not delete this note.


---

## §1-RESULT · EXECUTED 2026-08-06 — and the blast radius was smaller than this brief feared

**What landed.** Two changes to `motiondex-dsp.js durationOf`:

1. **Scan BACKWARD** for the last row that resolves a time, instead of reading only the final row. A
   single stampless trailing row used to send the whole stream down the fallback — the duration of
   4,000 measured samples decided by the last one. This is the same "read the last row that parses"
   rule `parsePPG` already uses for `endEpochMs`.
2. **No resolvable time ⇒ `null`**, never `rows.length / 26`.

**The consumer risk this brief flagged turned out to be already handled, and that is worth recording
rather than quietly benefiting from.** §1 said returning `0`/`null` "changes three windowing
denominators" and was the part with blast radius. Reading them: all four sites already floor the value
— `Math.max(1, Math.ceil(durSec / epoch))` in `bodyPosition` (:370), `actigraphy` (:431) and
`respiratoryEffort` (:1026), and `Math.max(1, durSec)` in the rate fallback (:419) — and `durationOf`
*already* returned `0` for the <2-row case, so `0` was an established in-band value, not a new branch.
The windowing is therefore handed `0`; only the PUBLISHED duration becomes `null`.

**That split is deliberate.** A published `durSec: 0` is a *claim* — `NODE-EXPORT-RECORDING-DURATION`
shows a node declaring a zero length collapses to a point in the fold and drops out of it. Absence and
zero are different, and only one of them is true here.

**One trap found while doing it:** `Math.max(a, b, c)` coerces `null` to `0`, so an unmeasurable stream
would have read as a real zero-length one — winning nothing while hiding the absence. Replaced with
`maxDuration`, which ignores nulls and returns null only when every stream is unmeasurable.

**Gated** — `motiondex-dsp · export · absence`, 8 assertions, covering both halves: a stampless TAIL
still yields the measured duration, and a stream with no time at all publishes `null` (explicitly *not*
`0`) through to `recording.durSec`, beside the honest null `startEpochMs` it already published. A
CONTROL pins that a fully timed stream is unaffected. **Mutation-verified against the exact pre-fix
fallback:** 4 assertions red, reporting **154 s for a 20 s record** — the 7.7× the corpus census
predicted, reproduced at the seam.

**Re-bundle:** `manifestHash e9909afa69db → 87fc4db5a6cf`, 1 fixture re-stamped. That fixture's input is
a **committed synthetic twin**, so CI re-runs it from committed bytes on every push and no
`verify-fixtures` stamp is owed (CLAUDE.md §🔒 exemption); the equiv leg in `npm run check` is what
confirms the export did not move.

**The guardrail held:** 26 was not replaced with a better constant. A measured median of ~51 Hz would be
just as wrong for the 202.7 Hz files and the 20.9 Hz ones.

---

## §3-RESULT · EXECUTED 2026-08-09 — the assertion landed, and two of the four nodes fail the contract

§3 was written as bookkeeping: *"either the four ungated nodes gain an envelope-tracking assertion, or
this is consciously dropped."* It assumed the assertion would pass, because the parent's §7 table says
all six remaining nodes "already compute a span". **Two of those four rows are wrong.**

Every row below was produced by driving the **shipped export builder** over a synthetic twin with a hole
in it. None came from reading the source — which is §4's rule, and §4 is why the measurement was run at
all rather than the assertion being written from the table.

| node | published field | on a gapped twin | verdict |
|---|---|---|---|
| **CPAPDex** | `recording.durSec` | 8400 s against 1200 s of data (2 h off-mask hole) | **ENVELOPE ✓** |
| **HRVDex** | `coverage.recordedSec` | `null`, `nWithDuration 0/3`, span 345 600 s | **HONEST ✓** |
| **PulseDex** *(timestamped)* | `durMin` | 2700 s = span; `coverage` 66.7 % | **ENVELOPE ✓** |
| **PulseDex** *(no timestamps)* | `durMin` | 1800 s = **data**; `coverage` **100** | ✗ **DEFECT** |
| **GlucoDex** | `coverage.recordedSec` | **== `spanSec`** across a 6 h dropout | ✗ **DEFECT** |

### The two defects

**PulseDex — `beatTimes` has two branches and only one of them is a span.** With timestamps it returns
`(tsMs[i] − t0)/1000`, a true wall span. Without them it cumulates RR, so `durMin` silently changes
meaning from ENVELOPE to DATA — **the exact defect §1 of the parent fixed in ECGDex, surviving one
branch away in a different node.** Worse: `coverage` is initialised to `100` and only overwritten on the
timestamped path, so an untimed stream **asserts a completeness it has no way to know**. That is the
same fabricated-claim shape as §1's assumed-26 Hz, and it is live on every RR file that reaches PulseDex
without stamps.

**GlucoDex — `recordedSec` and `spanSec` are the same expression.** The block's own comment reads:

> *"here `spanSec` and `recordedSec` agree BY MEASUREMENT, which is precisely what the sparse case could
> not claim."*

They do not agree by measurement. They are **assigned the same value**, so they *cannot* disagree, and a
CGM wear with a 6 h sensor dropout reports **100 % coverage**. The same comment names HRVDex's sparse
block as its sibling — and HRVDex is the node that explicitly refuses this fabrication (*"the obvious fix
— stamp `durSec = lastTMs − firstTMs` — would FABRICATE COVERAGE"*). GlucoDex cites the right precedent
and then does the thing the precedent forbids.

### What landed here, and what did not

**Landed:** the gate (`tests/dex-tests.js`, group *"The four ungated nodes"*, 17 assertions). The two ✓
pairs are a genuine ratchet. The two ✗ are pinned as **characterization** — the wrong values are
recorded so that a fix must update this group deliberately instead of silently. Pinning a defect is not
endorsing it; leaving it unpinned is how it survives another six audits.

**Mutation-verified in BOTH directions**, because a gate that cannot fail is this repo's recurring
failure mode:

| mutant | assertion killed |
|---|---|
| HRVDex `recordedSec := spanSec` | *recordedSec is NULL, never 0* |
| CPAPDex `durSec := Σ session durations` | *durSec is the ENVELOPE* |
| PulseDex `coverage := null` (**the fix**) | the §1 pin — proving it catches a silent repair |
| GlucoDex `recordedSec` measured (**the fix**) | both §2 pins — same |

**Not landed:** the fixes. Both are compute-path edits to a bundled DSP, so each owes a re-bundle, a
`computeHash` move, golden regeneration (`tools/regen-glucodex-goldens.mjs` exists; PulseDex's too) and
a `verify-fixtures` re-stamp. That is a separate work-unit with a separate blast radius, and it is
routed to **`NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II-2026-08-09-BRIEF.md`** rather than bolted onto
a tests-only PR.

### The method note, again

The parent was wrong about its own nodes four times, always by reading. This makes **five and six** — and
both were in a table that had already been audited once and used to justify *not* doing work. A row that
says "yes" with no measurement beside it is not a finding; it is a hypothesis with good posture.
