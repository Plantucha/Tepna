---
bump: minor
type: added
---

**A rebase can silently discharge a verification, and nothing in the repo catches it.**
`rebase-safe` now says so.

`provenance/<App>.json` is a generated artifact, so the auto-resolve takes the base's copy — **correctly**
— and that copy carries the base's `verifiedUnder`, throwing away a stamp the branch had already earned.
Downstream sees nothing: GATE A compares `manifestHash`, and `verifiedUnder` is not a build product at
all. It is a claim that somebody **ran** the app on the real corpus and reproduced those bytes. Clean
tree, green gates, unproven claim.

**Measured 2026-08-17: three sessions nearly lost a stamp to a rebase in one evening.** One of them did
lose it and caught it only by hand — `computeHash 153afac14e59` against a stamp reading `3ecd871266f7`.
That is a missing guard, not three mistakes.

## It reports; it never fails

A legitimate rebase onto a moved base **will** stale a stamp, and the remedy is a corpus run this tool
cannot perform — the recordings are gitignored, so a contributor without them could never green a hard
failure. Failing closed would make `rebase-safe` unusable by exactly the people it protects. Same split
`verify-fixtures` already makes: report in CI, block at release.

## ⚠️ And it tells THIS rebase's damage from drift that was already there

| before | after | reported as |
|---|---|---|
| MATCH | stale | 🔴 **this rebase discharged it** — the only alarm |
| stale | stale | quiet mention; not blamed on this rebase |
| stale | MATCH | ⚙️ the rebase **restored** it |
| absent | any | silent — a fixture this branch adds was never verified here |

Without that split the guard fires on **every** rebase of any branch carrying a deliberately-unverified
fixture — and a warning that cries when nothing is wrong is one people learn to scroll past, leaving the
original failure exactly where it was with an extra line of output. **Quiet until it matters.**

The re-verify hint prints with the corpus flag filled in (`DEX_UPLOADS=<corpus> …`), because the failure
mode is running it from a worktree with no corpus, getting a refusal, and reading that as the guard
being broken. It also warns that a fixture whose **bytes** moved needs `regen` first — re-verifying a
moved golden stamps `verifiedUnder` over content the code does not reproduce.

`classifyStamps` is pure and exported, so the gate drives it by value rather than running a rebase.
Both mutants die: collapsing to "alarm on every stale stamp" fails 3 assertions; dropping the restored
arm fails 1.
