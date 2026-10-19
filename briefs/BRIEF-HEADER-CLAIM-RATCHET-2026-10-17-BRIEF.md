<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-10-17 · **Created:** 2026-10-17 · 747 grandfathered tuples, `CLAIM headerClaimTuples = 747 FROM tools/brief-header-claim-baseline.json#tupleCount`

**Residue:** `2026-09-07-drain-stamp-asserted-a-count-it-never-read`

# The brief-header count-claim ratchet

## 1 · The defect

A triage stamp looks like evidence. Nothing checked that its author read the numbers.

Residue row `2026-09-07-drain-stamp-asserted-a-count-it-never-read` records the incident. A 2026-09-02
stamp on `MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md` asserted four nodes sit at zero
equivalence-ledger entries. They carried 26 / 48 / 71 / 100. The stamp did not rot — its author recalled
the count instead of re-reading it. The next session spent that stamp as a measurement and queued a
sweep that would have regenerated 245 committed entries.

## 2 · What the repository already had

Row `2026-09-23-sourced-claim-already-answers-the-stamp-problem` answered the mechanism question and
deliberately stopped there. `tests/dex-tests.js` §8d¹ already resolves one grammar:

```
CLAIM <name> = <value> FROM <path>#<pointer>
```

That resolver scans `briefs/` today, and an absent file or a dead pointer reds. It beats naming the
query that produced a number, because it re-reads the number rather than trusting a citation. The
absent half was the requirement: nothing obliged a header to use the grammar.

## 3 · The measurement that chose the design

The 09-23 row sized a mandatory check at 188 of 526 headers, with roughly one false positive in 20. That
figure does not reproduce. Re-measured on 2026-10-17 over 563 briefs:

| extraction | headers | tuples | sampled precision |
|---|---|---|---|
| four fixed grammars excluded | 212 | 1084 | ~1 wrong in 5 |
| plus tail stop-words and magnitudes | 194 | 782 | ~1 wrong in 6 |

The survivors name the reason. `9 emit`, `11 name`, `0 run` and `17 now` put a number before a verb, and
no word-class list separates them, because `run` is a noun in this repository and a verb in that
sentence.

So a mandate over this extraction would cry wolf on one header in six. §8d¹'s own header records the
same conclusion from two earlier attempts: precision comes from a rigid convention, never from the
checking. A marker that creates the convention is the only version that works.

## 4 · What landed

`tools/brief-header-claims.mjs` freezes today's population and gates the future:

- Every count-shaped assertion standing in a `**Status:**` header today sits in the baseline.
- A header that **gains** a count must source it, or the gate reds.
- The baseline may only shrink. `--base origin/main` refuses an appended tuple.
- The gate reports a retired tuple, never reds on it. Rewording or sourcing a stamp is the point.
- The gate never resolves a pointer. §8d¹ owns resolution, so the repository keeps one resolver.

The baseline grandfathers a number; it never verifies one. The baseline states the debt.

## 5 · Acceptance

1. ✅ A new unsourced count in a header reds (`unsourced-new-claim`; 21 selftests).
2. ✅ A sourced count passes with no baseline entry, matched by value.
3. ✅ An appended baseline tuple reds against the base ref.
4. ✅ The eight fixed grammars each stay out of the population.
5. ✅ One sourced claim stands in the tree — this brief's own header quotes the baseline.
6. ✅ The gate emits one `tepna.verdict/1` and sits in `npm run check`.

## 6 · What this does not do

It does not verify the 782 grandfathered numbers. It does not read body prose, which §8d¹ forbids on
measured grounds. It does not touch the incident stamp, whose author already retracted it.
