---
bump: patch
type: added
brief: none
---

A command that prints thousands of lines now reaches the transcript as 101 lines. `trim-output.sh` is
a PreToolUse(Bash) rewriter: it captures the output to a file, prints the first 60 lines, counts what
it left out, names the file, and prints the last 40 lines. It does not change the command, and it
does not change the exit code.

The number, because the hook is discipline and not a saving: tool results are approximately 0.2M
tokens a day across the fleet, which is under 1 % of the spend. Nobody measured a saving here. The
rule it mechanises is CLAUDE.md §4b, "never read a verdict off a tail".

Two properties carry the design. It never sends `permissionDecision`: the PreToolUse contract accepts
`updatedInput` alone, and a hook that sent `permissionDecision: "allow"` would approve the call with
no prompt and would step past the owner's permission mode.

It also fails open, and here that means "pass the command through unchanged". Six shapes pass
through: a command that already bounds its own output, a command that writes to a file, a heredoc, a
background command, a command that can end the shell, and an already-wrapped command.

The size test runs inside the wrapper, not in the hook. A PreToolUse hook reads the command before
the command runs, so it cannot know how many lines the command prints. Output of 200 lines or fewer
therefore prints whole.

The cost, measured 2026-10-11: the rewritten text is what the permission flow matches, so a
pre-approval keyed to the original text stops matching. `.claude/settings.local.json` in this
checkout holds 47 `Bash(…)` allow rules, 18 with a `*` and 29 exact. The committed
`.claude/settings.json` holds 0, so the cost falls on a local file.
