<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Closes §2. The equivalence ledger was keyed by **line number**, and lines move — so **379 of 383
keys had silently stopped matching**, taking 416 pieces of real human triage with them. A
classification that stops matching is indistinguishable from one that never existed, which is why it
rotted unnoticed.

**Re-anchored on the mutation's TEXT, and no ledger format change was needed** — `before` and `after`
were already recorded in every entry. Only what is *read* changes.

**Measured on the one file with a journal to check against (ppgdex, 129 classifications):**

| key | matches |
|---|---:|
| `(line, op)` — before | **4** |
| `(op, before, after)` — after | **126** |

The inventory now reports **139 classified** for ppgdex against 4, and its open count falls from 804
to **669**. The three that still miss are correct misses: killed since, or genuinely edited.

**Exact text, not a truncated prefix.** Cutting both sides to 100 chars scores the same 126 while
introducing **33 colliding journal keys** — distinct mutants whose first 100 characters agree — so it
buys nothing and costs the ability to tell them apart. The price of exactness is that 39 ledger
entries whose `before` is exactly 100 chars were written truncated and can never match; that is
reported by `staleClassifications` rather than hidden, which is the invariant a peer session asked
for: **a key that stops matching must say so.**

⚠️ **`describeMutant`'s `before`/`after` are DISPLAY fields** — trimmed and cut to 72 chars for
terminal readability. Keying on those would match on the first 72 characters and silently conflate
two different mutations of the same long line. `rawBefore`/`rawAfter` are now returned alongside, and
only the raw pair is used as a key.

**Three mutations planted; one survived and is now caught.** Removing the `e.before == null` guard —
which would index un-keyable entries under a partial key — passed every assertion, because the
assertion covering it had been lost when an earlier edit aborted mid-script. Added, re-planted, now
exits 1.

71 assertions. typecheck 0 · biome 0 · `test:tools` green.
