#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-syntax.sh — PostToolUse(Edit|Write) guard: a file this session just wrote
# that no longer PARSES is reported back at once, while the edit is still in view.
#
# WHY POST AND NOT PRE. A syntax error is not a judgement call and not a style
# rule — the file either parses or it does not. At PreToolUse the file does not
# exist yet in its new form, so the only honest moment is after the write. The
# cost this removes is the round trip where a broken file is found by a gate
# several minutes later, in a log, next to 32 other steps.
#
# ⚠ THIS IS NOT A GATE AND IT MOVES NO INVARIANT. CLAUDE.md §👥.2 is explicit:
# "Hook-enforced means Claude Code, in a checkout that has pulled the hook". A
# terminal edit, another agent, the GitHub web UI and an un-pulled checkout all
# inherit nothing. The agent-neutral answer stays `npm run check`, which parses
# every file it runs, and `capture-host/check.sh`. Deleting this file would change
# no invariant — it would only move the discovery later.
#
# WHAT IT READS. `.tool_input.file_path`, which Edit and Write both carry:
#   · `.js` `.mjs` `.cjs`  → `node --check`
#   · `.py`                → `py_compile.compile(..., doraise=True)`
# Everything else exits 0 untouched. Markdown, JSON, HTML and the bundles are not
# this hook's business.
#
# ⚠ FAILS OPEN ON EVERY ABSENCE, and the list is deliberate. No payload, no
# `file_path`, a path that does not exist, a path outside this checkout, no `jq`,
# no `node`, no `python3` — each one exits 0. A guard that denies on an
# unreadable input is "success reported about something never examined"
# (CLAUDE.md §4b) wearing a refusal instead of a pass, and it would block a
# session on a box where an interpreter is simply absent.
#
# ── TWO MEASUREMENTS THAT SHAPED THE PYTHON HALF (2026-10-12) ────────────────────
# 1 · `python3 -m py_compile <f>` WRITES `__pycache__/` BESIDE THE FILE. The obvious
#     fix, `PYTHONPYCACHEPREFIX`, does not survive `-I`: isolated mode implies `-E`,
#     which ignores every PYTHON* variable, so the cache lands in the tree anyway.
#     Measured: with `-I` and the prefix set, the prefix directory was ABSENT and
#     `__pycache__/` appeared in the working tree. `-I` is not optional here — it
#     drops the script directory from `sys.path`, so a file named `py_compile.py`
#     sitting beside the source cannot shadow the stdlib module. So the cache goes
#     to an explicit `cfile` under the system temp directory, and `-I` stays.
# 2 · `cfile=os.devnull` LOOKS RIGHT AND REFUSES EVERY FILE. `py_compile` checks
#     that the target is a regular file and raises `FileExistsError` before it ever
#     parses. A hook written that way exits 1 on a PERFECT file: it would have
#     blocked every Python edit in the repo and reported a syntax error that does
#     not exist. The tell was exit 1 on a two-line function that compiles fine.
#
# A third, from the JS half: `node --check` was measured against both module forms
# in a `.js` file with no `"type"` in `package.json` — a top-level `export`, a
# top-level `import`, and `module.exports` all return 0 on Node v22. There is no
# CommonJS-versus-module false positive to work around.
#
# CALIBRATION, so a green run is not an empty one: the check was run over every
# tracked source file in this repo on 2026-10-12 — 427 JavaScript files and 492
# Python files, zero failures. The hook therefore blocks nothing that is already
# committed, and `guard-syntax.test.sh` plants real errors to prove it can fire.
#
# Escape hatch: CLAUDE_ALLOW_SYNTAX_ERROR=1 — for deliberately writing a file that
# does not parse, which the hook tests themselves do.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_SYNTAX_ERROR:-}" = "1" ] && exit 0

command -v jq >/dev/null 2>&1 || exit 0          # no jq ⇒ FAIL OPEN (see the header)

payload="$(cat 2>/dev/null)" || exit 0
path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -z "$path" ] && exit 0
[ -f "$path" ] && [ -r "$path" ] || exit 0       # deleted, renamed, or never written

case "$path" in
  *.js|*.mjs|*.cjs) lang=js ;;
  *.py)             lang=py ;;
  *)                exit 0 ;;
esac

if [ "$lang" = js ]; then
  command -v node >/dev/null 2>&1 || exit 0
  out="$(node --check "$path" 2>&1)" && exit 0
  # Drop node's own stack frames. They name `cjs/loader` and `check_syntax`, never
  # the file, and they push the caret off the top of a short message.
  out="$(printf '%s\n' "$out" | sed '/^[[:space:]]*at /,$d')"
  tool='node --check'
  hint="    node --check $path"
else
  # Prefer the checkout's own interpreter when the file is capture-host Python, the
  # same precedence guard-ruff.sh uses for its linter: on the capture box the venv
  # and the system python need not be the same version, and a syntax check is
  # version-sensitive (a match statement, a walrus, a type parameter list).
  py=''
  root="$(git -C "$(dirname "$path")" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$root" ] && [ -x "$root/capture-host/.venv/bin/python3" ] && py="$root/capture-host/.venv/bin/python3"
  [ -n "$py" ] || py="$(command -v python3 2>/dev/null || true)"
  [ -n "$py" ] && [ -x "$py" ] || exit 0
  cdir="$(mktemp -d 2>/dev/null)" || exit 0
  # `doraise` carries the formatted SyntaxError in `PyCompileError.msg`. Printing the
  # EXCEPTION instead gives nine lines of `importlib._bootstrap` frames before the
  # caret, and the reader needs the caret.
  out="$("$py" -I -c 'import sys, py_compile
try:
    py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)
except py_compile.PyCompileError as exc:
    sys.stderr.write(exc.msg)
    raise SystemExit(1)' "$path" "$cdir/c.pyc" 2>&1)" && { rm -rf "$cdir"; exit 0; }
  rm -rf "$cdir"
  tool='py_compile'
  hint="    python3 -c 'import py_compile; py_compile.compile(\"$path\", doraise=True)'"
fi

cat >&2 <<EOF
BLOCKED: the file you just wrote does not parse.

  $path

\`$tool\` reports:

$(printf '%s' "$out" | head -20)

Re-read the file around that line and fix it before the next step. Reproduce with:

$hint

⚠ NOTHING DOWNSTREAM OF THIS READS A BROKEN FILE HONESTLY. A bundle built from a
  file that does not parse still produces a \`manifestHash\`, a \`--group=\` filter
  that cannot load its suite reads as a pass, and \`pytest\` collects zero tests
  from a module it cannot import and prints a green line about them (CLAUDE.md §4b).

Writing a file that deliberately does not parse? CLAUDE_ALLOW_SYNTAX_ERROR=1
EOF
exit 2
