# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The Apply-restart control, and the two ways its predecessors failed SILENTLY.

Every assertion here is a SOURCE SCAN rather than a behavioural plant, and that is deliberate: the
defects in this family are ABSENT CALLS and WRONG KEYS. There is no runtime state that differs — the
page renders, the button paints, the POST returns 200-shaped JSON, and nothing happens. A behavioural
test would have to assert on the absence of an effect, which is exactly what these bugs already look
like. Reading the source is the only check that can fail against them.

Each test below was run against the UNFIXED text and observed to FAIL. A test that cannot fail against
the defect it names is a green that certifies nothing.
"""
from __future__ import annotations
import pathlib
import re

MON = (pathlib.Path(__file__).resolve().parent.parent / "monitor.html").read_text(encoding="utf-8")


def test_the_ring_default_stream_set_includes_acc():
    """The O2Ring's ACC is device-PUSHED and gated by AUTO_RT_SWITCH bit 3, which capture.py ORs in
    from this exact list AT CONNECT. Omitted here, the stream is not merely 'off by default': nothing
    ever asks the ring to push, `acc_o2` is never registered, and the card cannot appear even after
    the operator ticks the box. It was `['spo2']` alone until 2026-09-03 while the H10 got
    `['ecg','acc','hr']` and the Verity `['ppg','acc','gyro','mag']`."""
    m = re.search(r"o2ring\|wellue\|viatom\|checkme.*?streams\s*=\s*\[([^\]]*)\]", MON, re.S)
    assert m, "the Wellue/O2Ring branch of guessDevice() is gone or was reshaped — re-read it"
    streams = {s.strip().strip("'\"") for s in m.group(1).split(",") if s.strip()}
    assert "acc" in streams, f"the ring's default streams must include acc; got {sorted(streams)}"
    assert "spo2" in streams, f"oximetry must not be lost while adding acc; got {sorted(streams)}"


def test_every_daemon_post_sends_verb_not_action():
    """`/api/daemon` reads `body.get("verb")` and looks it up in daemon_control._VERBS. A body keyed
    `action` is not a different spelling — it is a MISSING verb, rejected 400, and the operator sees a
    button that does nothing. Caught in review 2026-09-03 in this file's own first draft, which is the
    point: the wrong key is invisible until the button is pressed on hardware."""
    bodies = re.findall(r"/api/daemon.*?JSON\.stringify\((\{.*?\})\)", MON, re.S)
    assert bodies, "no /api/daemon POST found — the selector this test scans for has moved"
    for b in bodies:
        assert "action:" not in b, (
            f"/api/daemon takes `verb`, never `action` — this body would 400: {b[:80]}")


def test_the_ids_the_save_path_writes_to_exist_in_the_markup():
    """`saveSettings` serves TWO panels. Writing a result into an id that only exists on the panel the
    operator is NOT looking at produces no error and no output — the save silently appears to do
    nothing. That is what `#setStreams` did to three collectors, and what `#setMsg` alone did to every
    save made from the Devices panel."""
    for ident in ("setMsg", "devSetMsg", "devApplyBtn"):
        assert re.search(rf"""id=["']{ident}["']""", MON), (
            f"the script addresses #{ident} but no element declares that id")


def test_apply_restart_is_hidden_until_the_server_asks_for_it():
    """A restart control standing permanently beside Save invites a restart after saves that need
    none, on a daemon that is writing a night. It must be revealed by the server's `restart_needed`
    and by nothing else."""
    assert re.search(r"""id=["']devApplyBtn["'][^>]*style=["'][^"']*display:\s*none""", MON), (
        "#devApplyBtn must render hidden")
    assert re.search(r"showApplyRestart\(\s*!!\(\s*r\.ok\s*&&\s*r\.restart_needed\s*\)\s*\)", MON), (
        "the reveal must be driven by the server's restart_needed, not by a local guess")
