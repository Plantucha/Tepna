# tepna-capture — tests/test_oxyii_link.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The ring's data callback AS A SEAM. `on_data` was a 567-line closure inside `run_oxyii`, reachable
# only by driving a whole fake BLE session (tests/test_capture_runners.py does that, 194 times, and
# stays the regression suite for the frame handling itself). These tests cover the three things the
# lift ADDED and that no end-to-end run can fail on: the context is frozen, the router sends a frame
# to exactly one handler, and the non-live handler's True/False answer is the old `continue`.

from __future__ import annotations

import dataclasses
import types
from typing import Any

import pytest

import capture


def _link(**kw: Any) -> capture._OxyiiLink:
    """A context with every field None but the ones a test names. The handlers read what they read."""
    base: dict[str, Any] = {f.name: None for f in dataclasses.fields(capture._OxyiiLink)}
    base.update(kw)
    return capture._OxyiiLink(**base)


def _gate(recording: bool | None) -> types.SimpleNamespace:
    return types.SimpleNamespace(recording=recording)


def test_the_link_context_is_frozen_so_a_rebind_cannot_desync_the_callback():
    # The lift is sound BECAUSE every captured name was read-only and bound before the old `def` line:
    # a snapshot then equals the capture. `frozen=True` is that premise, enforced. A later session that
    # rebinds a writer after the context is built gets an error at the rebind, not a stale callback.
    cx = _link(name="ring")
    with pytest.raises(dataclasses.FrozenInstanceError):
        cx.name = "other"  # type: ignore[misc]


def test_a_live_frame_is_not_consumed_by_the_nonlive_handler():
    # False is the old fall-through out of the opcode chain into the live pipeline.
    cx = _link(_ring_gate=_gate(True), ppg2wr=None, plethawr=None)
    assert capture._oxyii_nonlive_frame(cx, (capture.oxyii.OP_LIVE, b"")) is False


def test_a_frame_that_is_not_live_is_consumed():
    # True is the old `continue`: an opcode with no handler reaches the not-live test and stops there.
    cx = _link(_ring_gate=_gate(True))
    assert capture._oxyii_nonlive_frame(cx, (0x7E, b"")) is True


def test_an_undecodable_frame_is_consumed():
    # `oxyii.decode` returns None for a frame it cannot read; the chain's every test is `if r and ...`.
    cx = _link(_ring_gate=_gate(True))
    assert capture._oxyii_nonlive_frame(cx, None) is True


def test_the_router_sends_only_the_frames_the_nonlive_handler_left(monkeypatch):
    seen = []
    monkeypatch.setattr(capture, "_oxyii_nonlive_frame", lambda cx, r: r == "consumed")
    monkeypatch.setattr(capture, "_oxyii_live_frame", lambda cx, r: seen.append(r))
    monkeypatch.setattr(capture.oxyii, "decode", lambda frame: frame)
    cx = _link(reasm=types.SimpleNamespace(feed=lambda b: ["consumed", "live", "consumed"]))
    capture._oxyii_on_data(cx, None, b"\x00")
    assert seen == ["live"], "a consumed frame must not reach the live pipeline, and a left one must"
