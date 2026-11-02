# tepna-capture — tests/test_status_snapshot_depth.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The `STATUS` snapshot in `conftest.py` must copy DEEP, and nothing else in the suite observes that.

A restoring fixture is the kind of mechanism that passes by doing nothing: `yield` with no restore, or
a copy one level shallower than the writes it guards, both leave every test green while the leak runs.

⚠️ A CROSS-TEST PAIR CANNOT DISCRIMINATE THE DEPTH, and an earlier draft of this file thought it could.
A test that dirties `STATUS` REBINDS `STATUS["devices"]`, so the inner dict it then mutates was never in
the snapshot, and restoring the snapshot drops it at any copy depth. Whether a real leak survives
depends on whether the device key already existed when the snapshot was taken — on test ORDER. So the
depth is bound here directly: on the fixture's own save and restore steps, with the real writer, and by
one spelling assertion for the fixture's own call.
"""

import ast
import copy
import os

import capture

_CONFTEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conftest.py")


def test_a_one_level_snapshot_does_not_restore_what_set_writes(monkeypatch):
    """THE DISCRIMINATOR, driven by `capture._set()` itself rather than an imitation of it.

    `_set()` does `STATUS["devices"].setdefault(name, {})` and then `d.update(kv)` — in place, at depth
    two. A one-level snapshot copies the outer `devices` dict and keeps references to the per-device
    dicts inside it, so it hands back the mutation it was supposed to undo. A device key must already
    exist for this to bite, which is why the test plants one.
    """
    one_level = lambda s: {k: (dict(v) if isinstance(v, dict) else v) for k, v in s.items()}  # noqa: E731
    for label, snapshot, restores in (("one-level", one_level, False), ("deep", copy.deepcopy, True)):
        fresh = {"devices": {"H10-probe": {"connected": True, "link_epoch": 3}}}
        monkeypatch.setattr(capture, "STATUS", fresh)  # hermetic at the site: the real STATUS is untouched
        keep = snapshot(capture.STATUS)  # the fixture's save step
        capture._set("H10-probe", connected=False)  # connected falsy, so no _LINK_EPOCH write
        capture.STATUS.clear()
        capture.STATUS.update(keep)  # the fixture's restore step
        got = capture.STATUS["devices"]["H10-probe"]["connected"]
        assert got is restores, (
            f"a {label} snapshot restored `connected` to {got!r}, expected {restores!r} — "
            "this is why the fixture deep-copies"
        )


def test_a_depth_one_addition_comes_back_at_either_depth():
    """The other half of the measurement, so the finding is not read wider than it is. Adding or
    rebinding a key in `devices` is undone by a one-level copy too — which is why the suite stayed green
    with the shallower snapshot, and why only the test above can see the difference."""

    def one_level(s):
        return {k: (dict(v) if isinstance(v, dict) else v) for k, v in s.items()}

    for label, snapshot in (("one-level", one_level), ("deep", copy.deepcopy)):
        live = {"devices": {}}
        keep = snapshot(live)
        live["devices"]["ADDED"] = {"connected": True}
        live.clear()
        live.update(keep)
        assert "ADDED" not in live["devices"], f"a {label} snapshot must undo a depth-1 addition"


def test_the_fixture_ITSELF_deep_copies_and_this_is_a_SPELLING_assertion():
    """⚠️ A SPELLING TEST, DELIBERATELY, AND THE ONLY THING THAT BINDS THE FIXTURE'S OWN CALL.

    Measured: changing the fixture's `copy.deepcopy` back to a one-level comprehension leaves every
    other test in this suite GREEN, for the reason the module docstring gives. Asserting the spelling is
    normally the weak form, and it is the right form exactly when the capability IS one call and nothing
    else can observe it. Replace this the day a deterministic behavioural test exists.

    🔴 The body is taken as an AST segment, not a text window. Measured 2026-11-02: bounding it at
    the next `@_pytest.fixture` ran PAST the fixture, because a comment and a module-level import sit
    between this fixture and the following one — the window reached into the timezone fixture below and
    would have passed on a sibling's text. The parse ends the body where the function ends, and the
    `tzset` guard below asserts it did.
    """
    src = open(_CONFTEST, encoding="utf-8").read()
    fn = next(
        (
            n
            for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.FunctionDef) and n.name == "_capture_status_is_not_leaked"
        ),
        None,
    )
    assert fn is not None, "the STATUS fixture is gone from conftest.py under that name"
    body = ast.get_source_segment(src, fn) or ""
    assert "tzset" not in body, "the segment ran past the fixture — every assertion below would be vacuous"
    assert "copy.deepcopy(capture.STATUS)" in body, (
        "the STATUS fixture must DEEP-copy: a one-level snapshot restores rebinds and keeps every "
        "nested in-place write, which is what `_set()` makes"
    )
    assert "capture.STATUS.update(keep)" in body, "and it must restore what it saved"
    assert "depth TWO" in body, "and it must not re-state the property the measurement refuted"
