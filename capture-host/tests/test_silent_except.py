# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""EVERY SWALLOWED EXCEPTION MUST SAY WHY, OR SAY WHAT IT HID.

`except X: pass` is sometimes exactly right — a diagnostic that must never disturb capture, a
teardown that must not outlive its timeout, an absent journal that correctly reads as UNKNOWN. It is
also this repo's dominant defect shape wearing a disguise: a handler that ran, examined nothing, and
reported success. The two are indistinguishable at a glance, which is the whole problem.

So the rule is not "never swallow". It is: a swallowing handler either LOGS what it hid, or carries
a comment saying why nothing was hidden. `capture.py` — the daemon, where a swallowed failure costs
a night — is held at ZERO unexplained. The rest of the tree is a RATCHET: the counts below are debt,
not approval, and they may only go down.
"""
import ast
import os

from _srcscan import HERE, module_path, module_source

# EMPTY, AND THAT IS THE POINT. This began at 69 unexplained swallows across 29 files
# (2026-08-31) and was drained file by file; the map is kept rather than deleted so the
# mechanism survives, and so the next entry has to be added deliberately by someone who has
# decided to owe the debt rather than pay it.
RATCHET: dict[str, int] = {}


def unexplained(src):
    """`[(lineno, text)]` — swallowing handlers with no comment on the clause or the statement.

    A "swallowing" handler is one whose ENTIRE body is `pass`, `continue` or `break`: control
    resumes as if the failure had not happened. A handler that logs, re-raises, sets a flag, or
    returns a sentinel is doing something with the failure and is not this gate's business."""
    lines = src.split("\n")
    found = []

    class V(ast.NodeVisitor):
        def visit_Try(self, node):
            for h in node.handlers:
                if len(h.body) == 1 and isinstance(h.body[0], (ast.Pass, ast.Continue, ast.Break)):
                    ln = h.body[0].lineno
                    # A comment on EITHER line counts: house style puts the reason beside whichever
                    # reads better, and both placements appear in this tree.
                    if "#" not in lines[ln - 1] and "#" not in lines[h.lineno - 1]:
                        found.append((ln, lines[ln - 1].strip()))
            self.generic_visit(node)

    V().visit(ast.parse(src))
    return found


def _py_files():
    for dirpath, dirs, files in os.walk(str(HERE)):
        dirs[:] = [d for d in dirs if d not in (".venv", "__pycache__", ".git", "node_modules")]
        for f in sorted(files):
            if f.endswith(".py"):
                yield os.path.relpath(os.path.join(dirpath, f), str(HERE))


def test_CAPTURE_PY_HAS_NO_UNEXPLAINED_SWALLOWED_EXCEPTION():
    """The daemon is held at zero. A swallowed failure here costs a night, and the night is gone
    before anyone can ask what happened — which is precisely when the log line would have been the
    only evidence there was."""
    bad = unexplained(module_source("capture.py"))
    assert not bad, "capture.py: swallowed exceptions with no reason and no log:\n" + "\n".join(
        f"  capture.py:{ln}  {txt}" for ln, txt in bad)


def test_THE_REST_OF_THE_TREE_ONLY_GETS_BETTER():
    """A ratchet, and it is now EMPTY — every file in the tree is held at zero.

    It stays a ratchet rather than a flat assertion because the two halves do different work: a new
    unexplained swallow reds, AND a file that improves without lowering its number reds as banked
    progress. With the map empty only the first half can fire, which is exactly the steady state
    this was aiming at."""
    worse, stale = [], []
    for rel in _py_files():
        # PER-FILE, never `module_source` here. That helper skips the WHOLE TEST on the first file
        # carrying the mutmut marker — and `mutation_pure.py` is a tracked module that contains the
        # marker as ordinary content, so the walk aborted on it and this ratchet silently examined
        # NOTHING. Caught 2026-08-31, one file into using it. Read through `module_path` (which
        # exists for exactly this) and skip only the generated file in front of us.
        with open(module_path(rel), encoding="utf-8") as fh:
            text = fh.read()
        if "__mutmut_orig" in text and rel != "mutation_pure.py":
            continue
        n = len(unexplained(text))
        allowed = RATCHET.get(rel, 0)
        if n > allowed:
            worse.append(f"  {rel}: {n} unexplained, ratchet allows {allowed}")
        elif n < allowed:
            stale.append(f"  {rel}: {n} unexplained, ratchet still says {allowed} — lower it")
    assert not worse, "new unexplained swallowed exceptions:\n" + "\n".join(worse)
    # A ratchet that is never tightened stops being one. This half is what makes the debt shrink.
    assert not stale, "the ratchet is looser than the tree — banked progress:\n" + "\n".join(stale)


def test_THE_GATE_BITES_ITS_OWN_SHAPES():
    """A plant, because a scanner that finds nothing and a scanner that looks at nothing read the
    same. Each swallowing form must be caught, and each explained form must be let through."""
    for form in ("pass", "continue", "break"):
        body = f"for i in []:\n    try:\n        f()\n    except Exception:\n        {form}\n"
        assert unexplained(body), f"a bare `{form}` handler was not caught"
        assert not unexplained(body.replace(form, f"{form}  # deliberate: why")), \
            f"a commented `{form}` handler was flagged"
        assert not unexplained(body.replace("except Exception:", "except Exception:  # why")), \
            "a handler explained on the CLAUSE line was flagged"
    # ...and a handler that does something with the failure is not this gate's business
    assert not unexplained("try:\n    f()\nexcept Exception:\n    log.warning('x')\n")
    assert not unexplained("try:\n    f()\nexcept Exception:\n    x = None\n    pass\n")
