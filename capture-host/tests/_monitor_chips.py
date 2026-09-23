# tepna-capture — tests/_monitor_chips.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE CHIP LIST IS DERIVED FROM THE TEMPLATE, NOT KEPT BY HAND — residue 2026-09-05-monitor-chip-registries.

Two node-only test files each kept a list of the chip functions `renderRemembered` calls: one to
assert they are top-level (`test_monitor_chip_scope.CHIPS`), one to stub them
(`test_monitor_device_cards._render`'s prelude). A chip added to the template and absent from either
list failed ONLY where node is installed — on the capture box those files skip, and a skip beside a
green summary is no signal at all. Measured 2026-09-05: `oxyStormChip` landed in `monitor.html` with
both lists untouched, and the miss surfaced on someone else's machine.

So there is now ONE source, and it is the page: every `name(` that `renderRemembered`'s body calls,
matching `*Chip` / `*Health` / `*Status`, closed transitively over the bodies of the top-level
functions it reaches (`clkChip` → `clockStatus`, the nesting whose history motivated the scope test).
Both test files consume this; neither lists a name.
"""

import os
import re

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CHIPISH = re.compile(r"\b(\w+(?:Chip|Health|Status))\(")


def _monitor_src():
    # `monitor.html` is not a Python module, so a raw read is fine here (tests/test_mutation_hygiene.py
    # guards mutatable modules, which this is not).
    return open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()


def _body(src: str, name: str) -> "str | None":
    """The balanced-brace body of top-level `function <name>(`, or None if it is not top-level."""
    m = re.search(r"^function " + re.escape(name) + r"\(", src, re.M)
    if not m:
        return None
    j = src.index("{", m.end())
    depth, k = 0, j
    while True:
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        if depth == 0:
            return src[j:k + 1]
        k += 1


def derive_chips(src: "str | None" = None) -> list:
    """Sorted names of every chip-ish function reachable from `renderRemembered`, transitively."""
    src = _monitor_src() if src is None else src
    root = _body(src, "renderRemembered")
    assert root is not None, "renderRemembered is not a top-level function in monitor.html"
    seen: set = set()
    frontier = set(_CHIPISH.findall(root))
    while frontier:
        n = frontier.pop()
        if n in seen:
            continue
        seen.add(n)
        b = _body(src, n)
        if b:
            frontier |= set(_CHIPISH.findall(b)) - seen
    return sorted(seen)


def stub_prelude(names=None) -> str:
    """A JS prelude stubbing every derived chip so `renderRemembered` can run headless. Only
    `deviceHealth` needs a shape (the template reads `.health` / `.title`); everything else renders ''."""
    names = derive_chips() if names is None else names
    parts = []
    for n in names:
        parts.append(f"{n}=()=>({{health:'',title:''}})" if n == "deviceHealth" else f"{n}=()=>''")
    return "const " + ", ".join(parts) + ";\n"
