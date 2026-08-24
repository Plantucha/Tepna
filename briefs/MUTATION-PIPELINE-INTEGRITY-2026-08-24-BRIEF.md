<!--
  MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-24 · **Follows:** `MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md` (§3e) · **Affects:** `tools/mutation-ai-probe.mjs`, `tools/mutation-crawl.mjs`, `tools/mutate_diff.py`, `tools/ai-probe-overnight.sh`

# The mutation pipeline reported converged for three days while discarding its own results

Five defects, found in one day, in a pipeline every gate said was healthy. They are recorded together
because **they chained**: each one hid the next, and the outermost produced a confident, specific, and
entirely fabricated diagnosis.

---

## 1 · The chain, outermost first

| # | defect | what it produced | fixed in |
|---|---|---|---|
| 1 | `CLI_FLAGS` missing 5 implemented flags | the drafting step refused all 8 files | #1704 |
| 2 | `\| tail -4` discarding the exit code, then the rejection reasons | the refusal exited 0 and read as green | #1704 / #1718 |
| 3 | draft step not gated on the probe's canary | drafted from data the probe had loudly refused | #1718 |
| 4 | `verdictFor` size guard ahead of the crash check | decisive crash-kills scored `kill:false` | #1720 |
| 5 | `journalVerdict` guard order | **1271 seed-pool kills per run journalled as `NOPROPOSAL`** | #1719 |
| 6 | crawl records omit `after` | the canary replayed `if (undefined)`, not the recorded op | #1723 |

🔴 **The reason this survived: every layer was individually plausible.** A refused file looked like a
stale crawl. A stale crawl looked like post-merge drift. Drift looked like a reason to re-crawl. Nobody
was wrong locally; the pipeline was wrong globally.

## 2 · The fabricated diagnosis — the most expensive single line

The probe printed:

> *"CANARY DID NOT FIRE — the source moved since the crawl, so recorded lines no longer address this code."*

**Three of the four accused files had ZERO commits since their crawl.** The real cause was defect 4
(their fixture functions return >100 KB, so every crash-kill hit the size guard), reached through
defect 6 (the replayed mutation was `undefined`-substitution, which crashes on declaration lines).

**A tool that reports a cause it did not measure is worse than one that reports nothing**, because the
next reader acts on it — here, by planning four re-crawls that were never needed.

- **Rule:** a diagnostic message may name only what the code actually checked. "Detection failed" is
  honest; "the source moved" is a hypothesis, and belongs in prose next to the evidence for it.

## 3 · Amnesia presenting as convergence

Defect 5 is the one that made everything look finished. `journalVerdict` tested `!lastN` before `hit`,
and a seed-pool kill sets `hit` while spending no tier — so it was journalled `NOPROPOSAL` and
discarded. **1271 per run.** Nothing new reached the journal, so:

- the distill output came out **byte-identical** to the previous day's apart from one date digit;
- the candidate count sat at exactly **1516** for three consecutive runs;
- and the run reported **"probe converged"**.

⚠️ **Converged and amnesiac are indistinguishable from the outside.** Both produce a stable number. The
discriminator is not the count — it is whether the count *should* have moved, which only a
liveness check can answer.

## 4 · Two dead branches, each naming the case it could never reach

Both defects 4 and 5 left a branch that existed **only** to handle the case its own guard order made
unreachable:

```js
record(key, 'KILL', { hit: rec, tier: poolHit ? 'pool' : tier });   // poolHit could never be true here
if (/^THREW/.test(mutStr) && /^THREW/.test(origStr)) …              // origStr-threw returned 2 lines up
```

**A dead branch that names a specific case is a bug carrying its own signature.** Both were found by
reading the code that *described* the missing behaviour, not by tracing the failure. Worth a sweep:
unreachable branches whose condition names a real scenario are a searchable class.

## 5 · What actually caught each one

Not one was caught by a gate. Every one was caught by the same move — **run it against the real failure
and check a number that should have moved**:

- 1271 pool kills reported vs **0** `FROM POOL` log lines.
- Byte-identical distill: `cmp` → differs at byte 46, the date.
- 32 canary refusals vs a **green** verdict line.
- 165 `KILLABLE` records vs **0** carrying `after`.
- Run 6 survived / run 7 killed with a **byte-identical tree**.

🔴 **The null experiment was the decisive one.** Every earlier attempt at §3e changed something, so
none could separate *"the change fixed it"* from *"a second run fixed it"*. Run 7 changed **nothing**
and settled it. **When two explanations both predict improvement, the experiment that improves nothing
is the one that discriminates.**

## 6 · Open

- [ ] **Make `mutateAtLine` refuse an absent `after`.** Correct end state, deliberately deferred: every
      existing record lacks it, so refusing today stops the nightly pipeline. Reachable once crawls
      carry `after` (#1723).
- [ ] **The MODIFY asymmetry** (`MUTATION-SUITE-FOLLOWUPS` §3e): tests are absent from
      `hash_by_function_name`, so a modified test should have been missed too — and was not. Measured,
      unexplained, and deliberately not guessed at.
- [ ] **Scratch verdict cache keyed on source + test revision**, with the regression asserting on the
      **first** run after an addition. A control that runs the gate twice passes today.
- [ ] **Zero-mutant-module guard** keyed on `exit_code_by_key` entries under the glob prefix. The
      `_ran` counter cannot express it: a crashed invocation increments it.
- [ ] **`before` is stored `.slice(0, 120)`** — would corrupt a replay on a longer line. **0 of 165
      records reach the cap**, so it is theoretical; recorded so it is not rediscovered as a surprise.

## 7 · Done when

- [ ] The four deferred items above are each either built with a control that fails first, or recorded
      as declined with a measured reason.
- [ ] No diagnostic in this pipeline names a cause the code did not check.
