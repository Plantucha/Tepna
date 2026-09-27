# tepna-capture — tests/test_status_hermeticity.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`capture.STATUS` is restored between tests, and the fixture that does it is not vacuous.

A restoring fixture is exactly the kind of mechanism that passes by doing nothing: `yield` with no
restore, or a SHALLOW copy, both leave every test green while the leak continues. These two tests are
ordered and adjacent on purpose — the first dirties `STATUS` the way the real writers do, the second
asserts it came back.
"""

import copy

import os

import capture

_SENTINEL = "tests/test_status_hermeticity.py planted this"
_CONFTEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conftest.py")


def test_a_dirtied_STATUS_is_the_setup_for_the_next_test():
    """Writes STATUS the way the 15 non-hermetic writers do — a rebind AND a nested in-place mutation,
    because those are restored by different halves of the fixture."""
    capture.STATUS["devices"] = {"Planted": {"connected": True}}
    capture.STATUS["devices"].setdefault("Planted", {})["leaked"] = _SENTINEL  # in-place, nested
    capture.STATUS["planted_top_level"] = _SENTINEL
    assert capture.STATUS["devices"]["Planted"]["leaked"] == _SENTINEL


def test_STATUS_came_back_clean_after_the_test_that_dirtied_it():
    """The pair's assertion: the rebind and the top-level key are gone.

    ⚠️ THIS DOES NOT DISCRIMINATE COPY DEPTH, and an earlier draft of this file claimed it did. The test
    above REBINDS `STATUS["devices"]` to a new dict, so the inner dict it then mutates was never in the
    fixture's snapshot — restoring the snapshot drops it whatever the copy depth. Verified by planting a
    shallow copy in the fixture: this test still passed. The depth is discriminated by
    `test_a_shallow_snapshot_does_not_restore_an_IN_PLACE_nested_write` below, directly, because through
    the autouse machinery it cannot be done deterministically — whether a leak survives depends on
    whether the key already existed when the snapshot was taken, i.e. on test order."""
    assert "planted_top_level" not in capture.STATUS, "a rebind leaked"
    assert "Planted" not in (capture.STATUS.get("devices") or {}), "a planted device leaked"


def test_a_shallow_snapshot_does_not_restore_an_IN_PLACE_nested_write():
    """THE DEPTH DISCRIMINATOR, run directly on the fixture's own save/restore steps.

    Production writes nested and IN PLACE — `STATUS["devices"].setdefault(name, {})` in `_set()`, then
    mutating that inner dict — so the object being mutated is the one the snapshot holds a reference to.
    A shallow snapshot therefore restores the outer rebinds and keeps the inner write, which is the
    failure mode a shallow fixture has while passing every cross-test assertion above."""
    for depth, keep_fn, restores in (("shallow", dict, False), ("deep", copy.deepcopy, True)):
        live = {"devices": {"H10": {"connected": True}}}
        keep = keep_fn(live)  # the fixture's save step
        live["devices"]["H10"]["connected"] = False  # what `_set()` does: in place, nested
        live.clear()
        live.update(keep)  # the fixture's restore step
        got = live["devices"]["H10"]["connected"]
        assert got is restores, (
            f"a {depth} snapshot restored the nested write to {got!r}; expected {restores!r} — "
            "this is why the fixture deep-copies"
        )


def test_the_deep_copy_is_what_makes_that_possible():
    """The control, run in-process so it needs no fixture: a shallow copy demonstrably does NOT protect
    a nested mutation, so the `deepcopy` in the fixture is load-bearing rather than decorative."""
    original = {"devices": {"H10": {"connected": True}}}
    shallow, deep = dict(original), copy.deepcopy(original)
    original["devices"]["H10"]["connected"] = False  # the in-place write `_set()` makes
    assert shallow["devices"]["H10"]["connected"] is False, "a shallow copy shares the inner dict"
    assert deep["devices"]["H10"]["connected"] is True, "a deep copy does not"


def test_the_fixture_ITSELF_deep_copies_and_this_is_a_SPELLING_assertion():
    """⚠️ A SPELLING TEST, DELIBERATELY, AND THE ONLY THING THAT BINDS THE FIXTURE'S COPY DEPTH.

    Measured: changing the fixture's `copy.deepcopy` to `dict` leaves every other test in this file
    GREEN. The cross-test pair above cannot see it (the dirtying test rebinds, so the mutated inner dict
    was never in the snapshot) and the depth test above exercises the save/restore STEPS rather than the
    fixture's own call. Whether a real leak survives a shallow snapshot depends on whether the key
    already existed when the snapshot was taken — i.e. on test order — so there is no deterministic
    behavioural test to write here.

    Asserting the spelling is normally the weak form (`done-when-names-the-capability`), and it is the
    right form exactly when the capability IS one call and nothing else can observe it. If someone finds
    a deterministic behavioural test, replace this."""
    src = open(_CONFTEST, encoding="utf-8").read()
    body = src[src.index("def _capture_STATUS_is_not_leaked(") :]
    body = body[: body.index("@_pytest.fixture", 1)] if "@_pytest.fixture" in body[1:] else body
    assert "copy.deepcopy(capture.STATUS)" in body, (
        "the STATUS fixture must DEEP-copy: a shallow snapshot restores rebinds and silently keeps every "
        "nested in-place write, which is most of what `_set()` does"
    )
    assert "capture.STATUS.update(keep)" in body, "and it must restore what it saved"
