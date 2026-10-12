<!-- SPDX-License-Identifier: Apache-2.0 -->
# Launcher smoke unit

**state:** DONE
**unit:** Prove the launcher works end to end, and change no repo file but this one.
**bird:** heron
**branch:** claude/launch-smoke-hrn
**worktree:** ../wt-launch-smoke-hrn
**doc-search:** ste lint approved word layer writing rules glossary
**stopping-point:** lint run, finding recorded (2026-10-11)
**next-step:** none — unit done.
**done-when:** This file carries the top finding, `**state:** DONE`, and the session has run `/exit`.

## Open questions

- None. This unit exists to test `tools/unit-launch.sh`. Write the finding into this file, set
  `**state:** DONE`, then run `/exit`. Do not open a PR. Do not touch any other file.

## Finding (2026-10-11, Fleet-Session: Heron)

Rule 0: `ste lint approved word layer writing rules glossary` → `changes/ste-lint.md`, `tools/ste-lint.mjs`,
`docs/GLOSSARY.md`.

`node tools/ste-lint.mjs docs/GLOSSARY.md` → exit 0, **0 findings over 21 prose lines**. There is no top
finding. Verdict: `ste-lint` `NOT_APPLICABLE`, population checked 21 / eligible 21 / excluded 0, reason
"advisory — 0 finding(s); the threshold is not armed (use --strict)", commit `0c08981c`.
The file has 63 lines; about 22 are non-table, non-heading prose, so the lint did examine the glossary.
