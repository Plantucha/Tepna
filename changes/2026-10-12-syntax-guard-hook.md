---
bump: patch
type: added
brief: none
---

**The hook names a file that no longer parses, while the edit is still in view.**

`.claude/hooks/guard-syntax.sh` is a PostToolUse guard on Edit and Write. It runs
`node --check` on a `.js`, `.mjs` or `.cjs` file, and `py_compile` on a `.py` file. A parse error
goes back to the session as a blocking message with the caret line. Everything else exits 0.

This moves no invariant. `npm run check` and `capture-host/check.sh` parse every file they run, and
they remain the agent-neutral answer. The hook only moves the discovery earlier, and a checkout that
never pulled it inherits nothing.

It fails open on every absence: no payload, no `file_path`, an absent path, a directory, no `jq`, no
`node`, no `python3`. A guard that refuses on an input it could not read is the shape CLAUDE.md §4b
names, wearing a refusal instead of a pass.

Two measurements shaped the Python half. `python3 -m py_compile` writes `__pycache__` beside the
source, and `PYTHONPYCACHEPREFIX` does not survive `-I`, so the cache goes to an explicit temporary
path. `cfile=os.devnull` raises `FileExistsError` before it parses anything, so a hook written that
way exits 1 on a perfect file and blocks every Python edit.

Calibration: the check ran over every tracked source file, 427 JavaScript and 492 Python, with zero
failures. `guard-syntax.test.sh` plants real errors to show the hook can fire, and pairs each one
with a file that differs in one property. Escape hatch: `CLAUDE_ALLOW_SYNTAX_ERROR=1`.
