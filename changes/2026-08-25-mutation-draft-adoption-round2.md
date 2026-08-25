<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md
---

Mutation draft-bank drain, round 2 — the five FRESH-crawl banks (cpapdex, glucodex, hrvdex, motiondex,
pulsedex). **27 assertions adopted, 26 mutants verified dead by re-applying each one; 17 of 44 drafts
REJECTED on a human read.**

Every bank was re-triaged against the current suite before adoption (banks go stale within a day):
38 of 44 drafts still described a surviving mutant.

The rejections are the substance, and they cluster into four repeatable classes:

* **Zero-arity calls.** `getFilteredRows(null)` and `persistHRVRows(null)` take NO parameters. The
  drafted argument is inert and the recorded value depends on module-level `allRows` the assertion
  never establishes — an order-dependent pin.
* **Type confusion as the discriminator.** `smooth([1,2],[3,4])` passes an array where `k` must be a
  number; the type error is *what discriminates*, so it pins accidental behaviour, not the fast path.
* **Fixture tautologies.** Four cpapdex DRAFTS I rejected mutate literals inside `_synthRaw`, the
  synthetic-night FIXTURE BUILDER, so they assert that a hardcoded `timeSec: 5000` equals 5000.
  (Four is the count of rejected DRAFTS, not of survivors — `mutation-worklist.mjs` measures 19
  survivors in that function. Two different quantities; naming them precisely matters because a peer
  briefly copied "4" into a survivor ledger from an earlier, looser phrasing of this line.)
* **A string-literal mutant.** pulsedex's `<path` → `<=path` inside a template string; the draft only
  checks that a string was not corrupted, which has no contract behind it.

Where a draft pinned real behaviour but expressed it badly, it was transcribed correctly rather than
adopted verbatim — phantom trailing arguments dropped, and the motiondex calls RE-ARGED (the real
signature is `(accRows, t0Ms, durSec, unit)`, so the drafts' unit string was landing in `t0Ms`) with
valid `{x,y,z}` rows instead of bare numbers, which the drafts fed into a NaN cascade.

Highest-value adoption: glucodex's seven `|| null` mutants, which turn a MISSING nutrient from `null`
into `0`. Those pin the suite's UNKNOWN ≠ ABSENT contract directly — "missing is visible, never
fabricated" — rather than an implementation detail.

**Also fixes a ROUND-1 ESCAPE this drain surfaced.** `H.persistHRVRows(null)`, adopted in round 1 and
green in `main` ever since, killed nothing: the function takes no parameters, so the argument was inert
and the assertion passed under both the real code and its `|| → &&` mutant. Re-triage caught it because
the mutant it was meant to cover still survived. Replaced with an assertion that sets the discriminating
module state EXPLICITLY through the accessor the file already exposes (and restores it in a `finally`),
so it is order-independent — the other half of why the original never worked. Verified by mutant
re-application like the rest. A shipped no-op assertion is worse than no assertion: it reports coverage
that does not exist.
