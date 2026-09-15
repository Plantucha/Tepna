---
bump: patch
type: fixed
brief: none
---

`tools/rebase-safe.mjs` acts on the checkout it **lives in**, not the one you are standing in — and
every git call is bound to that checkout: **6 `cwd: ROOT` sites, none bound to `process.cwd()`** — counted BEFORE this fix, which is the state the hazard describes. After it the file reads 7 and 1, because the guard added below needs one of each to detect the mismatch; a reader grepping the shipped file will see those and should not read them as hazard sites. `gitQuiet`
delegates to `git`, so `gitQuiet('rebase', onto)`, the generated-path auto-resolve
`gitQuiet('checkout', onto, '--', p)`, the `add`, the `rebase --continue` and the builders all run there
too.

Measured 2026-09-15: `node /home/michal/Tepna/tools/rebase-safe.mjs` invoked from a worktree refused
with *"working tree is not clean"* while that worktree was spotless. It was reporting the **shared
root's** cleanliness.

⚠️ **It fails safe *because* the shared root is dirty, which is exactly what makes it dangerous.** The
bug's own symptom — a permanent refusal that reads as a tool bug — is what has protected the repo,
since nobody ever got past it. That inverts the moment someone tidies the root: the guard then passes
and the tool rebases `main`, auto-resolves generated paths and runs `build.mjs --check` **in a checkout
other sessions are standing in.** CLAUDE.md §👥.2b's hazard reached through a different door — not a
hand ref-move, but a tool operating on its own checkout instead of yours.

**The fix REFUSES; it does not retarget.** Resolving `ROOT` from `git rev-parse --show-toplevel` was the
obvious repair and is wrong: it would make `node /other/checkout/tools/rebase-safe.mjs` silently act on
the cwd — the same surprise inverted, and a tool that quietly retargets itself is its own hazard.
`--show-toplevel` **detects** the mismatch and never resolves it. An ambiguous invocation reports as
ambiguous, names **both** paths, and points at `cd <your checkout> && node tools/rebase-safe.mjs`
(exit 4). Within one checkout — including from a subdirectory — it is silent; outside a git checkout it
is silent too, with the probe's stderr suppressed so a guard that has nothing to say leaks nothing.

Gated by a source scan (the guard is a process-level exit and cannot be imported), including an
**anti-retarget** assertion that `ROOT` still derives from the script's own location — without it, a
future "fix" resolving `ROOT` from the cwd would make the refusal unreachable while every other
assertion stayed green. Mutation-verified: deleting the refusal reds 3 assertions; swapping in the
retarget reds the dedicated one.

Found while a sibling session was fixing a different `rebase-safe` defect (#2518, union-merge
blindness); kept out of that PR deliberately, since folding an unrelated fix into it is the `cabd7f7`
harm CLAUDE.md §👥.2 names.
