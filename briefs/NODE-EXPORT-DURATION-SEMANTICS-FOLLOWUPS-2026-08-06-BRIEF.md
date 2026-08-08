<!--
  NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-06 · **Follows:** `NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md` (DONE — 2026-08-06) · **Affects:** `motiondex-dsp.js`, `ppgdex-dsp.js`, the six nodes that do not publish `endEpochMs`

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

- [ ] §1 — the assumed-26 Hz divide is removed, its three consumers are shown safe on a no-timing stream,
      and the re-bundle + `verify-fixtures` cycle is run.
- [ ] §2 — parked (default), or folded into a future PpgDex `fs`-estimator pass.
- [ ] §3 — either the four ungated nodes gain an envelope-tracking assertion, or this is consciously
      dropped and this brief says so.
- [ ] §4 — nothing to execute; it is a note. Delete it if it ever stops being true.
