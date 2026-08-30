# tepna-capture — tests/test_monitor_chip_scope.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Every chip `renderRemembered` calls must be reachable AT TOP LEVEL.

🔴 2026-08-29, owner-reported as "it just gone": the whole remembered-devices list vanished from the
Devices view. `presenceChip` and `witnessChip` had been pasted INSIDE `clockStatus`'s body, and a
`function` declaration inside another function is LOCAL to it. `clockStatus` kept working; nothing
logged; every neighbouring chip resolved. But `renderRemembered` calls these at top level, threw
ReferenceError on the FIRST device, and `.map()` took the entire list down — so the section rendered
EMPTY, which reads as "no devices configured" rather than as an error.

Confirmed in the live page before the fix: `typeof presenceChip === 'undefined'` while
`typeof clkChip === 'function'`.

This EXECUTES the shipped script and asks for the binding, because that is the only thing that can
tell top-level from nested — a text scan finds `function presenceChip(` either way, and would have
passed against the broken file.
"""

import os
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")


def _script_blocks(src):
    """The text of every `<script>` block in `src`.

    ⚠️ NOT a regex, deliberately. `<script[^>]*>(.*?)</script>` is what CodeQL's `py/bad-tag-filter`
    flags — correctly as a pattern, even though nothing here filters untrusted HTML: this reads a file
    we commit, to run its own JavaScript. Split instead, which is both unflagged and clearer about the
    one rule that matters — a script block ends at the FIRST `</script>`, exactly as a browser ends it,
    so the extraction and the runtime agree by construction rather than by coincidence.
    """
    out = []
    for chunk in str(src).split("<script")[1:]:
        _, _, after_tag = chunk.partition(">")
        body, _, _rest = after_tag.partition("</script>")
        out.append(body)
    return out


def _script():
    src = open(MON, encoding="utf-8").read()
    blocks = _script_blocks(src)
    assert blocks, "no <script> in monitor.html — extraction is testing nothing"
    return "\n".join(blocks)


def _typeofs(names):
    """`{name: typeof}` after HOISTING the shipped script, without running any of its side effects."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    js = _script()
    # Wrapped in a function so declarations hoist into ITS scope exactly as they do in the page's
    # top level, and `return` before any statement runs means no DOM is ever touched.
    prog = (
        "const names = " + repr(list(names)).replace("'", '"') + ";\n"
        "const out = {};\n"
        "(function(){\n"
        "  try { names.forEach(n => { out[n] = eval('typeof ' + n); }); } catch(e) { out.__err = e.message; }\n"
        "  return;\n" + js + "\n"
        "})();\n"
        "console.log(JSON.stringify(out));\n"
    )
    # Written to a file, not passed with -e: the shipped script is ~200 KB and an argv that size
    # raises OSError E2BIG, which would look like a broken test rather than a size limit.
    import json
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(prog)
        path = fh.name
    try:
        r = subprocess.run([node, path], capture_output=True, text=True, timeout=30)
    finally:
        os.unlink(path)
    assert r.returncode == 0, r.stderr[:2000]
    return json.loads(r.stdout)


CHIPS = [
    "chargeChip",
    "wornChip",
    "rateChip",
    "battChip",
    "deviceHealth",
    "rssiChip",
    "clkChip",
    "presenceChip",
    "witnessChip",
    "clockStatus",
]


def test_every_chip_renderRemembered_calls_is_reachable_at_top_level():
    got = _typeofs(CHIPS)
    assert "__err" not in got, got.get("__err")
    nested = [n for n in CHIPS if got.get(n) != "function"]
    assert not nested, (
        f"{nested} are NOT top-level functions — they are nested inside another function, so "
        f"renderRemembered will throw ReferenceError and the ENTIRE device list will render empty. "
        f"typeofs: {got}"
    )


def test_the_probe_can_actually_SEE_a_nested_function():
    """The control. Without this, a probe that returns 'function' for everything — because it is
    looking in the wrong scope — would pass against the very defect it exists to catch."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    prog = (
        "const out = {};\n"
        "(function(){\n"
        "  out.outer = typeof outerFn; out.inner = typeof innerFn;\n"
        "  return;\n"
        "  function outerFn(){ function innerFn(){} }\n"
        "})();\n"
        "console.log(JSON.stringify(out));\n"
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    import json

    got = json.loads(r.stdout)
    assert got["outer"] == "function", "the probe cannot see a top-level function"
    assert got["inner"] == "undefined", "the probe reports a NESTED function as reachable — it is blind"
