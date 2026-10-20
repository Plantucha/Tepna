#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-syntax.test.sh — self-test for guard-syntax.sh.
#
# Drives the hook exactly as the harness does: the tool-call JSON on stdin. Every
# DENY is paired with an ALLOW differing in ONE property, so a rule that fires on
# everything scores as loudly as one that fires on nothing — the discipline
# guard-format.test.sh established and guard-ruff.test.sh carried on.
#
# Three cases are not symmetry, they are the measurements the hook is built on:
#   · a `.py` check must leave NO `__pycache__` beside the source;
#   · a planted `py_compile.py` beside the source must not shadow the stdlib;
#   · module syntax in a `.js` file must ALLOW, because a false positive there
#     would block most of the root of this repo.
#
# ⚠ WITHOUT node OR python3 THE MATCHING HALF SKIPS RATHER THAN PASSES. The hook
# fails open on an absent interpreter, so a green run that never invoked one would
# certify nothing. Skipping says so out loud.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-syntax.sh"
# ⚠ THE WRITER-FATE PAYLOAD IS SIZED FROM THE KERNEL, NOT FROM A ROUND NUMBER. `--probe-bytes` returns
# four times this box's `fs.pipe-max-size` with a 4 MiB floor, and nothing past that ceiling can be
# absorbed into a pipe. The literal 100 KB these legs used to stage looked like twice the 64 KB pipe
# buffer, but `cat` moves a file in with `copy_file_range`, which may push pages past the 16-slot
# limit up to `fs.pipe-max-size` (1048576 here). Measured 2026-10-20 against a planted non-draining
# hook, 12 trials a size: 100 KB stranded the writer 7 times, 4000 KB 12 of 12. Re-measured the same
# day under load average 20: 100 KB stranded it 35 times of 36, one batch reading 11 of 12 — so the
# RATE is the box's scheduling at that moment, not a property of the size, and a sample cannot bound
# it. The derived size needs no rate: nothing past `fs.pipe-max-size` can be absorbed at all. A leg
# that is a coin flip on a broken hook is SILENT rather than flaky, because the hook it guards drains.
# A size that cannot be derived refuses (exit 2) — it is a leg that would examine nothing.
_PROBE_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/hook-contract.mjs"
_PROBE_BYTES="$(node "$_PROBE_TOOL" --probe-bytes 2>/dev/null)"
case "$_PROBE_BYTES" in ''|*[!0-9]*) printf '  REFUSE  the writer-fate payload size could not be derived (%s --probe-bytes)\n' "$_PROBE_TOOL" >&2; exit 2 ;; esac

fail=0
have_node=0; have_py=0
command -v node >/dev/null 2>&1 && have_node=1
command -v python3 >/dev/null 2>&1 && have_py=1
if ! command -v jq >/dev/null 2>&1; then
  echo "  SKIP  guard-syntax.test.sh — no jq; the guard fails OPEN here and this test would certify nothing"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/w"
mkdir -p "$W"
cd "$W" || exit 1

run() { # run <path> ; echoes DENY or ALLOW
  jq -nc --arg p "$1" '{tool_input:{file_path:$p}}' | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <path>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-62s %s\n' "$2" "$got"
  else printf '  FAIL  %-62s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

# ── JavaScript ───────────────────────────────────────────────────────────────────
printf 'function f() {\n  const x = ;\n}\n' > broken.js
printf 'function f() {\n  const x = 1;\n  return x;\n}\n' > whole.js
printf 'const x = {\n'                        > broken.mjs
printf 'export const x = 1;\n'                > whole.mjs
printf 'module.exports = {\n'                 > broken.cjs
printf 'module.exports = { x: 1 };\n'         > whole.cjs
printf 'export const x = 1;\n'                > esm-in-js.js
printf 'import fs from "node:fs";\nconsole.log(fs);\n' > import-in-js.js
printf 'const x = 1;\nmodule.exports = { x };\n'       > cjs-in-js.js
if [ "$have_node" = 1 ]; then
  expect DENY  'a .js that does not parse'                            "$W/broken.js"
  expect ALLOW '…the same file, parsing — the one-property pair'       "$W/whole.js"
  expect DENY  'a .mjs that does not parse'                           "$W/broken.mjs"
  expect ALLOW '…and a .mjs that parses'                              "$W/whole.mjs"
  expect DENY  'a .cjs that does not parse'                           "$W/broken.cjs"
  expect ALLOW '…and a .cjs that parses'                              "$W/whole.cjs"
  # Measured on Node v22 with no "type" in package.json: all three return 0.
  expect ALLOW 'a top-level export in a .js file is NOT an error'     "$W/esm-in-js.js"
  expect ALLOW 'a top-level import in a .js file is NOT an error'     "$W/import-in-js.js"
  expect ALLOW 'module.exports in a .js file is NOT an error'         "$W/cjs-in-js.js"
else
  echo "  SKIP  the JavaScript half — no node, so the guard fails open and this would certify nothing"
fi

# ── Python ───────────────────────────────────────────────────────────────────────
printf 'def f(:\n'              > broken.py
printf 'def f():\n    return 1\n' > whole.py
if [ "$have_py" = 1 ]; then
  expect DENY  'a .py that does not parse'                            "$W/broken.py"
  expect ALLOW '…the same file, parsing'                              "$W/whole.py"

  # MEASURED DEFECT 1: `python3 -m py_compile` writes `__pycache__/` beside the
  # source, and PYTHONPYCACHEPREFIX does not survive `-I`.
  rm -rf __pycache__
  run "$W/whole.py" >/dev/null
  if [ -d __pycache__ ]; then
    echo "  FAIL  the .py check left __pycache__ in the tree"; fail=$((fail+1))
  else echo "  ok    the .py check writes no __pycache__ beside the source"; fi

  # MEASURED DEFECT 2: `-I` exists so a file beside the source cannot shadow the
  # stdlib module. A shadow that WERE imported raises, and the hook would DENY a
  # file that parses — so ALLOW here is the whole assertion.
  mkdir -p shadowed
  printf 'def f():\n    return 1\n' > shadowed/whole.py
  printf 'def f(:\n' > shadowed/broken.py
  printf 'raise SystemExit("the planted module ran")\n' > shadowed/py_compile.py
  expect ALLOW 'a planted py_compile.py beside the source does not shadow'  "$W/shadowed/whole.py"
  expect DENY  '…and a broken file in that same directory still denies'     "$W/shadowed/broken.py"
else
  echo "  SKIP  the Python half — no python3, so the guard fails open and this would certify nothing"
fi

# ── the extension gate: the same broken bytes under a name the hook ignores ──────
cp broken.js broken.md
cp broken.js broken.json
cp broken.js broken.html
cp broken.js broken.txt
expect ALLOW 'broken bytes in a .md are not this hook'                "$W/broken.md"
expect ALLOW 'broken bytes in a .json are not this hook'              "$W/broken.json"
expect ALLOW 'broken bytes in a .html are not this hook'              "$W/broken.html"
expect ALLOW 'a file with no extension at all'                        "$W/broken.txt"

# ── fails open on every absence ──────────────────────────────────────────────────
expect ALLOW 'a path that does not exist'                             "$W/absent.js"
mkdir -p adir.js
expect ALLOW 'a DIRECTORY whose name ends in .js'                     "$W/adir.js"

got="$(printf '{}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    a payload with no file_path fails OPEN"
else echo "  FAIL  a payload with no file_path denied"; fail=$((fail+1)); fi
got="$(printf 'not json at all' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    a malformed payload fails OPEN"
else echo "  FAIL  a malformed payload denied"; fail=$((fail+1)); fi
got="$(: | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    an EMPTY payload fails OPEN"
else echo "  FAIL  an empty payload denied"; fail=$((fail+1)); fi

# ── the escape hatch ────────────────────────────────────────────────────────────
if [ "$have_node" = 1 ]; then
  got="$(jq -nc --arg p "$W/broken.js" '{tool_input:{file_path:$p}}' \
    | CLAUDE_ALLOW_SYNTAX_ERROR=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
  if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_SYNTAX_ERROR=1 releases a broken file"
  else echo "  FAIL  the escape hatch did not release a broken file"; fail=$((fail+1)); fi
fi

# ── the message must carry the fix, not just the refusal ─────────────────────────
if [ "$have_node" = 1 ]; then
  msg="$(jq -nc --arg p "$W/broken.js" '{tool_input:{file_path:$p}}' | bash "$H" 2>&1 >/dev/null)"
  for want in 'broken.js' 'node --check' 'CLAUDE_ALLOW_SYNTAX_ERROR=1' 'Reproduce with'; do
    if printf '%s' "$msg" | grep -qF "$want"; then printf '  ok    message carries %-42s\n' "$want"
    else printf '  FAIL  message missing %s\n' "$want"; fail=$((fail+1)); fi
  done
  # The caret is the only part a reader acts on, and node's own frames push it away.
  if printf '%s' "$msg" | grep -q '\^'; then echo "  ok    …and keeps the caret line"
  else echo "  FAIL  message lost the caret"; fail=$((fail+1)); fi
  if printf '%s' "$msg" | grep -qE '^[[:space:]]+at '; then
    echo "  FAIL  message still carries node's internal stack frames"; fail=$((fail+1))
  else echo "  ok    …and drops node's internal stack frames"; fi
  # §4b: the reason a broken file must not travel is that the gates report green about it.
  if printf '%s' "$msg" | grep -qF 'reads as a pass'; then echo "  ok    …and says why a broken file must not travel"
  else echo "  FAIL  message omits the §4b caveat"; fail=$((fail+1)); fi
fi

# ── structural: the two checks every guard test in this directory pins ───────────
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2'"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit"; fi

# ⚠ THE HOOK MUST DRAIN STDIN BEFORE ITS EARLY EXITS, AND NO LEG ABOVE CAN SEE IT. Every leg above
# reads the hook's verdict as DENY (exit 2) or ALLOW (anything else), so an exit that left the
# writer on a closed pipe — the harness, in production — scored as the ALLOW it wanted: the
# writer's 141 (SIGPIPE) is "not 2". This leg watches the WRITER's fate instead. The pipe stays ON
# PURPOSE (a redirect has no writer to lose), the payload is sized from `fs.pipe-max-size`
# so the kernel cannot absorb it, and it repeats because the defect is a race. Same contract trim-output.test.sh pins
# (#3493). The hatch is the exit under test; the absent-jq exit cannot be staged here, and it sits
# below the same drain.
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$TMP/stdin-big"
jq -nc --rawfile c "$TMP/stdin-big" '{tool_input:{file_path:"/nonexistent/x.py"},pad:$c}' > "$TMP/stdin-big.json"
_worst=0
for _i in 1 2 3 4 5; do
  cat "$TMP/stdin-big.json" | CLAUDE_ALLOW_SYNTAX_ERROR=1 bash "$H" >/dev/null 2>&1
  _rc="${PIPESTATUS[0]}"; [ "$_rc" != 0 ] && _worst="$_rc"
done
if [ "$_worst" = 0 ]; then echo "  ok    the writer into the hatched hook survives"
else echo "  FAIL  the writer into the hatched hook exited $_worst (141 = SIGPIPE, the hook never read it)"; fail=$((fail+1)); fi

[ "$fail" -eq 0 ] && echo "  all guard-syntax checks passed" || echo "  $fail FAILED"
exit $((fail > 0))
