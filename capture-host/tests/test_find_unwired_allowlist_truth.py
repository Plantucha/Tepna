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

from _srcscan import module_source


HERE = pathlib.Path(__file__).resolve().parent.parent
TOOL = HERE / "tools" / "find_unwired.py"


def _allowlists():
    """EVERY `ALLOW_*` list the tool defines, by PREFIX rather than by name.

    🔴 WHY THE PREFIX. This read named `ALLOW_FUNCS` and `ALLOW_KEYS` and stopped there, so four lists
    were never checked for a false reason at all — ALLOW_MODULES among them, which is where the longest-
    lived entries live and where a reason naming the wrong absent half sat for weeks (residue
    2026-11-04-the-unwired-allowlist-waits-on-a-writer-that-already-ships). A seventh list added
    tomorrow is examined the moment it is defined, which an explicit tuple of names cannot promise."""
    tree = ast.parse(TOOL.read_text())
    out = {}
    for n in ast.walk(tree):
        names = []
        if isinstance(n, ast.Assign):
            names = [getattr(x, "id", None) for x in n.targets]
        elif isinstance(n, ast.AnnAssign):
            names = [getattr(n.target, "id", None)]
        for nm in names:
            if nm and nm.startswith("ALLOW_") and n.value is not None:
                out[nm] = ast.literal_eval(n.value)
    assert "ALLOW_FUNCS" in out, "ALLOW_FUNCS is gone or reshaped — this test is stale, fix it"
    return out


def test_the_read_covers_EVERY_allowlist_the_tool_defines():
    """The regression guard on the read above. If a later edit narrows it back to two lists, or a new
    list escapes the prefix, this says so by name rather than passing over an unexamined allowlist."""
    source = TOOL.read_text()
    declared = set(re.findall(r"^(ALLOW_[A-Z_]+)\s*(?::[^=]+)?=", source, re.M))
    assert declared, "no ALLOW_* list found at all — the probe is blind"
    examined = set(_allowlists())
    assert declared == examined, "declared but not examined: %s" % sorted(declared - examined)
    # the five the tool gates on, named so a deletion is deliberate rather than silent
    for expected in ("ALLOW_KEYS", "ALLOW_FUNCS", "ALLOW_MODULES", "ALLOW_RENDERED", "ALLOW_JS"):
        assert expected in examined, expected


def test_no_reason_may_claim_the_PER_INSTANCE_STATUS_WRITER_IS_ABSENT():
    """🔴 THE FALSE CLAIM ITSELF, pinned so it cannot return by copy-paste. Two entries read that
    "nothing yet writes" the per-instance `status.<instance>.json`, and one promised to retire "when
    the writer lands". The writer had landed. A retirement condition that has already fired cannot
    retire anything, so the entry outlives its own criterion while reading as tracked."""
    # via `module_source`, never a raw read: a raw read makes capture.py unmeasurable under mutmut
    # (tests/test_mutation_hygiene.py::test_no_test_reads_a_mutatable_module_source_raw)
    capture = module_source("capture.py")
    assert re.search(r"def status_path\(root: str, instance: str \| None", capture), (
        "the per-instance status writer changed shape — re-read the ALLOW_MODULES reason that cites it"
    )
    assert "status.{instance}.json" in capture or "status.%s.json" in capture
    assert '"--instance"' in capture, "capture.py no longer declares --instance"
    # ⚠️ A RETRACTION MUST NOT QUOTE THE CLAIM IT RETRACTS, or this guard fires on the correction —
    # measured 2026-11-04 on the first draft of the corrected entry, which quoted both phrases.
    # A reason that paraphrases keeps the ban strict, which is what makes it worth having.
    for listname, d in _allowlists().items():
        for key, reason in d.items():
            for dead in ("nothing yet writes", "retires when the writer lands"):
                assert dead not in reason.lower(), (
                    "%s[%r] revives the claim that the per-instance writer is absent: %r" % (listname, key, dead)
                )


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
