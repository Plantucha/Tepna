<!--
  MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-28 (**two of §6's five items shipped and were never stamped here** — their closure is recorded in a *sibling* brief. Audited item-by-item against the code and the on-disk corpus 2026-08-28; the three that remain now carry numbers instead of adjectives. See §6a.) · **Created:** 2026-08-24 · **Follows:** `MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md` (§3e) · **Affects:** `tools/mutation-ai-probe.mjs`, `tools/mutation-crawl.mjs`, `tools/mutate_diff.py`, `tools/ai-probe-overnight.sh` · **DRAIN 2026-09-02 (Osprey):** verified 1 of 8 Done-when boxes ticked, 7 open — the least-advanced brief in this family. **Owner: Osprey. Next step:** re-scope before executing; 7 open boxes is more than one work-unit and the brief should be split or trimmed rather than picked up whole.

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

## 6a · AUDIT 2026-08-28 — item by item, against the code and the corpus

Run before proposing any work on this brief, per the house rule that a documented failure is not an
open failure. **Two of the five were already done.**

| § | item | verdict |
|---|---|---|
| 6.1 | `mutateAtLine` refuses an absent `after` | **OPEN — and correctly still deferred**, now with a number |
| 6.2 | the MODIFY asymmetry | **OPEN**, still unmeasured |
| 6.3 | scratch verdict cache, first-run control | ✅ **DONE — #1726** (`mmeta.py`) |
| 6.4 | zero-mutant-module guard | ✅ **DONE** — refuses on the induced failure |
| 6.5 | `before` stored `.slice(0, 120)` | **OPEN, still theoretical** — verified present |

### 🔴 6.3 and 6.4 shipped, and their closure is written in a DIFFERENT brief

`OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23` records both — *"the mutation-cache re-key passed
its first-run control (#1726, `mmeta.py`), and the zero-mutant-module guard refuses on the induced
failure"* — while this brief has carried them as open for four days. Nobody was wrong locally: the
work was done, and it was stamped where it was executed rather than where it was proposed.

That is the third instance of this shape in one week, and the correction is the standing one:
**stamp the closure at the narrative, not only at the changelog** — and when a sibling brief executes
your item, the stamp is owed in BOTH places.

⚠️ **6.4 shipped by a DIFFERENT mechanism than proposed, and that is worth recording rather than
smoothing over.** This brief specified *"keyed on `exit_code_by_key` entries under the glob prefix"*;
`mutate_diff.py` instead keys on `mmeta.generated_count(work, module, g) == 0` and a separate
`_crashed` list, and hands `_ran` back in both cases (`_ran -= 1`). The brief's stated objection to
the alternative — *"the `_ran` counter cannot express it: a crashed invocation increments it"* — is
answered by decrementing it rather than by re-keying. The concern is satisfied; the proposed
implementation is not the one that landed. A reader comparing the two would otherwise conclude the
item was still open.

### 6.1 — deferred is still right, and the deferral now has a completion percentage

The brief defers this because *"every existing record lacks it, so refusing today stops the nightly
pipeline"*, reachable *"once crawls carry `after` (#1723)"*. Measured across every
`.mutation-crawl/*.crawl.json` on this box, 2026-08-28:

> **181 of 2703 mutant records carry `after` — 6.7 %.**

#1723 landed and the writer is correct (`mutation-crawl.mjs:899` records `after` beside `before`), but
**the corpus has not turned over**. Refusing today would still stop the pipeline on 93 % of records.
So the deferral stands — and *"deferred until crawls carry `after`"* is now *"deferred, 6.7 % of the
way there"*, which is a condition the next reader can re-measure in one command instead of re-deriving.

`mutateAtLine` currently guards `before` only (`if (!b) return null`) and takes `after` unguarded —
verified at `tools/mutation-ai-probe.mjs:424`.

### 6.5 — verified present, still theoretical

`mutation-crawl.mjs:899` still stores `before: String(m.before).trim().slice(0, 120)`. Unchanged, and
unchanged in consequence: recorded so it is not rediscovered as a surprise.

### What this audit did NOT do

It did not touch 6.2. The MODIFY asymmetry is *"measured, unexplained, and deliberately not guessed
at"*, and an audit that has not run the measurement has nothing to add to that — saying so is the
honest outcome, not a gap in the audit.

## 7 · Done when

- [x] **Audited 2026-08-28 (§6a)** — 6.3 and 6.4 were already built (#1726 / induced-failure refusal);
      6.1 and 6.5 are recorded as deferred **with measurements** (6.7 % corpus turnover; the slice
      verified present); 6.2 remains open and unmeasured, stated rather than guessed.
- [ ] 6.1 built with a control that fails first, once corpus turnover makes refusal safe (re-measure
      the 6.7 % before starting).
- [ ] No diagnostic in this pipeline names a cause the code did not check.
