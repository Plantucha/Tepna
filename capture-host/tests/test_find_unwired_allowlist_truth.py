# tepna-capture — tests/test_find_unwired_allowlist_truth.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""An allowlist entry is a CLAIM. These assert the checkable parts of it are true.

🔴 WHY THIS EXISTS. `find_unwired` excuses an unwired function when someone writes a reason. A reason
that says "used by X" and is FALSE does not merely mislead a reader — it converts the gate into a
rubber stamp for exactly the function it names, which is the failure that gate exists to prevent.

Measured 2026-08-30, two entries were false at once:

  · `start_key_exchange` / `confirm_key_exchange` — "used by the pairing probe". There is no pairing
    probe and there never was; no file matching *pair* appears in this repo's history.
  · `oxy_is_finalized` — "pull_session.py already gates re-pulls … via parse_trailer".
    `pull_session.py` exists and contains no `parse_trailer` at all; the gate is `oxy_inventory`.

And the entry between them, `pull_spool`, already carried "⚠️ THE PREVIOUS REASON WAS FALSE" from an
earlier correction — made without sweeping its siblings, which is how a second false reason survived
two lines away. A fix that does not sweep its own class leaves the rest.

⚠️ WHAT THESE DO AND DO NOT CATCH, stated so the guard is not over-trusted. They check the MECHANICAL
form: a named `*.py` must exist, and a backticked `module.identifier` must resolve to a real
definition. Neither would have caught the two defects AS THEY WERE PHRASED — "the pairing probe"
names no file, and the `pull_session.py` claim named a file that does exist. What they guarantee is
that a reason written in the checkable form is TRUE, and both corrected reasons are written that way.
Prose that names nothing checkable is still only as good as its author.
"""

import ast
import pathlib
import re


HERE = pathlib.Path(__file__).resolve().parent.parent
TOOL = HERE / "tools" / "find_unwired.py"


def _allowlists():
    tree = ast.parse(TOOL.read_text())
    out = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign):
            for t in n.targets:
                if getattr(t, "id", None) in ("ALLOW_FUNCS", "ALLOW_KEYS"):
                    out[t.id] = ast.literal_eval(n.value)
    assert "ALLOW_FUNCS" in out, "ALLOW_FUNCS is gone or reshaped — this test is stale, fix it"
    return out


def _modules():
    return {p.stem for p in HERE.glob("*.py")} | {p.stem for p in (HERE / "tools").glob("*.py")}


def test_every_py_file_a_reason_NAMES_actually_exists():
    """A reason pointing at a file that is not there sends a reader looking for evidence that cannot
    be found, and leaves the entry unfalsifiable."""
    missing = []
    for listname, d in _allowlists().items():
        for key, reason in d.items():
            for fn in re.findall(r"\b([a-z_][a-z0-9_]*\.py)\b", reason):
                if not (HERE / fn).exists() and not (HERE / "tools" / fn).exists():
                    missing.append(f"{listname}[{key!r}] names {fn}, which does not exist")
    assert not missing, "\n".join(missing)


def test_every_backticked_module_identifier_in_a_reason_RESOLVES():
    """🔴 The `oxy_is_finalized` defect in its general form: a reason named a real module and a real
    function, but that module did not contain that function. Written in the backticked form, that is
    mechanically checkable — so it is checked."""
    mods = _modules()
    broken = []
    for listname, d in _allowlists().items():
        for key, reason in d.items():
            for mod, ident in re.findall(r"`([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)`", reason):
                if mod not in mods:
                    broken.append(f"{listname}[{key!r}] names `{mod}.{ident}` — no module {mod}")
                    continue
                path = HERE / f"{mod}.py"
                if not path.exists():
                    path = HERE / "tools" / f"{mod}.py"
                body = path.read_text()
                if not re.search(rf"\b(def|class)\s+{ident}\b", body):
                    broken.append(f"{listname}[{key!r}] names `{mod}.{ident}` — {mod}.py defines no {ident}")
    assert not broken, "\n".join(broken)


def test_the_probe_that_no_allowlist_reason_may_invent():
    """The specific false claim, pinned so it cannot come back by copy-paste: nothing may be excused
    on the grounds that a PAIRING probe uses it, because no such probe exists."""
    probes = {p.name for p in HERE.glob("probe_*.py")}
    assert not any("pair" in p for p in probes), (
        "a pairing probe now exists — if it really does, the SRP allowlist reasons should say so BY "
        "NAME rather than reverting to the vague 'the pairing probe' that was false for a year"
    )
    for listname, d in _allowlists().items():
        for key, reason in d.items():
            assert "pairing probe" not in reason, f"{listname}[{key!r}] revives the false 'pairing probe' claim"


def test_the_guard_can_actually_SEE_a_false_reason():
    """The control. Without it, a checker whose regexes never match anything would pass on every
    allowlist including a wholly fabricated one — the shape this repo keeps finding."""
    reason = "redundant — `nonexistent_module.some_func` already does it, see ghost_file.py"
    mods = _modules()
    hits = re.findall(r"`([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)`", reason)
    assert hits and hits[0][0] not in mods, "the module probe matches nothing — it is blind"
    files = re.findall(r"\b([a-z_][a-z0-9_]*\.py)\b", reason)
    assert files and not (HERE / files[0]).exists(), "the filename probe matches nothing — it is blind"
    # and a TRUE reason must pass both, or the guard is merely noisy
    true_reason = "redundant — `oxy_inventory.classify` already gates on it"
    m, i = re.findall(r"`([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)`", true_reason)[0]
    assert m in mods and re.search(rf"\b(def|class)\s+{i}\b", (HERE / f"{m}.py").read_text())
