---
bump: patch
type: added
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

The mutation-equivalence classification was prose in a brief; it is now data the sweep reads.

A surviving mutant is not automatically a test gap. `if (lo < 0) lo = 0` mutated to `<=` still assigns
0 when lo IS 0 — no input distinguishes them and none ever will. Counting those against
`killed / tested` makes the target unreachable by arithmetic and buries the real gaps among the noise;
on clock.js the brief measured 12 of 15 survivors in one cluster as equivalent. Until now that finding
lived only in the brief, so every sweep re-litigated the same survivors and no tool could report it.

`tools/mutate-equivalence.json` follows the shape `mutate-canaries.json` established and is matched on
(line, op, before) — the same key `findCanary` uses, with `after` recorded for a reader rather than as
part of the key so an operator's output text can change without silently orphaning an entry.
`mutate.mjs` gains pure, exported `loadEquivalence` and `classifySurvivors`, and each per-file result
carries an equivalence block. The console prints the distinguishable rate BESIDE the raw one rather
than instead of it: the gap between the two denominators is the brief's whole argument, and hiding the
raw number would make it unauditable.

This is deliberately not an allowlist. `mutate.mjs`'s own header set the condition — "prefer arguing
with the gate occasionally over a gate that silently excuses whatever it cannot kill" — so three states
shout. REFUTED: an entry claims equivalence and the mutant was KILLED, meaning the classification is
wrong and a distinguishing input exists after all; the fix is the entry, never the test. ORPHANED: an
entry matches no generated mutant, so it is excluded from every count until re-verified and staleness
shrinks nothing. UNCLASSIFIED: survivors with no entry, counted and named, because silence is never
equivalence. `real-gap` entries stay in the denominator — a classification file is not a place to
launder debt into a better number.

Eight known-answer selftests cover every branch including the three anti-laundering ones. Only the
three documented real-gap entries are seeded; the twelve equivalent ones are not, because §3 names only
two of them individually and writing the rest from a prose summary would invent exactly the kind of
data this mechanism exists to replace. The tool now names each unprobed survivor instead.

The owner restated the target on 2026-08-08: 90 % of DISTINGUISHABLE mutants killed, and every
non-distinguishable one classified. The raw rate is still printed beside it and is still worth
sanity-checking against; it is no longer the bar. What makes that restatement safe rather than a
lowered bar is that the classification stopped being a claim and became data on the same day — nothing
leaves the denominator without a named entry, a recorded probe, and a tool that shouts REFUTED the
moment a mutant it excused is killed. `mutate.mjs`'s header carried the now-false line "the
classification exists but is prose, not data"; it is corrected, since a stale claim in the tool that
enforces the rule is exactly the failure this repo keeps finding.
