# tepna-capture — tests/test_capture_status.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Branch coverage for the capture-status renderer + its injectable fetch. No network — the fetch seam
# is a fake, and render() is a pure function of a /api/state dict.

import capture_status as C


def _state():
    """The live box's real shape: bus KEYS carry device tags (`acc_h10`, `ppg_vs`, bare `ecg`) while the
    configured stream NAMES are bare (`acc`, `ppg`, `ecg`), and the daemon says which device OWNS each
    key. This fixture used to spell keys equal to names, which made the old equality join look right —
    it was the accident residue 2026-09-05-capture-status-joins-two-key-namespaces measured, pinned as
    the world by the test that should have caught it."""
    return {
        "adapter": "AC:A7:F1:29:9D:1D",
        "streams": [
            {"key": "ecg", "active": True, "effFs": 130.2, "health": "ok", "device": "Polar H10"},
            {"key": "acc_h10", "active": True, "effFs": 52.1, "health": "ok", "device": "Polar H10"},
            {"key": "ppg_vs", "active": False, "effFs": None, "health": "idle", "device": "Verity"},
        ],
        "devices": [
            {  # streaming, all extras present
                "name": "Polar H10",
                "streams": ["ecg", "acc"],
                "connected": True,
                "worn": True,
                "rssi": -55,
                "battery": 80,
                "last_sample": 123.0,
                "last_error": None,
            },
            {  # connected but idle stream + last_error + no extras
                "name": "Verity",
                "streams": ["ppg"],
                "connected": True,
                "last_error": "timed out",
            },
            {  # offline, no streams, name missing -> device_id
                "device_id": "S8AW2100",
                "connected": False,
                "streams": [],
            },
            {  # name AND device_id missing -> "?"
                "connected": False,
            },
        ],
        "cpap": {"enabled": True, "state": "idle", "at_hour": 13},
    }


def test_render_streaming_count_and_states():
    out = C.render(_state())
    assert "1/4 device(s) STREAMING" in out  # only H10 has an active stream
    assert "Polar H10" in out and "STREAMING" in out
    assert "Verity" in out and "connected (idle)" in out
    assert "S8AW2100" in out and "OFFLINE" in out  # name fell back to device_id
    assert "?" in out  # nameless + idless device


def test_render_extras_and_streams_and_error():
    out = C.render(_state())
    assert "worn=True" in out and "rssi=-55" in out and "batt=80" in out and "last_sample=123.0" in out
    assert "ecg" in out and "effFs=130.2" in out and "health=ok" in out
    assert "last_error: timed out" in out


def test_render_cpap_line():
    assert "CPAP: idle (enabled=True, SD harvest 13:00)" in C.render(_state())


def test_render_no_cpap_and_missing_streams_key():
    """Used to assert `connected (idle)` and an `active=None` line for the unmatched name `k` — the exact
    rendering residue 2026-09-05-capture-status-joins-two-key-namespaces calls out, because it is
    indistinguishable from a stream that is genuinely idle. Deliberately changed: with no streams
    published at all, the name is UNMATCHED and the line says the daemon reported no ownership."""
    st = {"adapter": "AA", "devices": [{"name": "X", "connected": True, "streams": ["k"]}]}
    out = C.render(st)  # no top-level "streams", no "cpap"
    assert "0/1 device(s) STREAMING" in out
    assert "X" in out and "connected (UNMATCHED)" in out
    assert "CPAP" not in out
    assert "UNMATCHED 1 configured: k" in out         # the name still renders, as what it is
    assert "active=None" not in out


def test_render_empty():
    out = C.render({})
    assert "0/0 device(s) STREAMING" in out


# --- fetch_state ------------------------------------------------------------------------


class _Resp:
    def __init__(self, data):
        self._data = data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._data


def test_fetch_state_parses_json():
    got = C.fetch_state("http://x/api/state", opener=lambda url, timeout: _Resp(b'{"adapter":"AA"}'))
    assert got["adapter"] == "AA"


# --- main -------------------------------------------------------------------------------


def test_main_success(capsys):
    rc = C.main(["--url", "http://x/api/state"], fetch=lambda url: {"adapter": "AA", "devices": []})
    assert rc == 0
    assert "CAPTURE STATUS" in capsys.readouterr().out


def test_main_fetch_error(capsys):
    def boom(_url):
        raise OSError("connection refused")

    rc = C.main(["--url", "http://x/api/state"], fetch=boom)
    assert rc == 1
    assert "could not read" in capsys.readouterr().err


# ── ownership, not spelling (residue 2026-09-05-capture-status-joins-two-key-namespaces) ──────────────
def _own(key, device, active):
    return {"key": key, "active": active, "effFs": None, "health": None, "device": device}


def test_a_device_whose_keys_share_NO_spelling_with_its_names_is_STREAMING():
    """THE PLANT. On the live box the Verity's configured names are `acc ppg ppi` and its bus keys are
    `acc_vs ppg_vs ppi_vs`: zero equality matches, so it rendered `connected (idle)` while writing
    16.8 MB. Ownership joins it."""
    st = {"streams": [_own("acc_vs", "Verity", True), _own("ppg_vs", "Verity", False)],
          "devices": [{"name": "Verity", "connected": True, "streams": ["acc", "ppg", "ppi"]}]}
    out = C.render(st)
    assert "Verity" in out and "STREAMING" in out and "1/1 device(s) STREAMING" in out
    assert "acc_vs" in out and "idle" not in out.split("Verity")[1].split("\n")[0]


def test_spelling_alone_never_joins_a_stream_to_a_device():
    """A key that happens to EQUAL a configured name — the two accidental matches on the live box — must
    not attach to that device when another device owns it. That accident was the only thing keeping the
    old headline partly true, and it flips on the next tidy-up of key names."""
    st = {"streams": [_own("ecg", "Other", True)],
          "devices": [{"name": "H10", "connected": True, "streams": ["ecg"]},
                      {"name": "Other", "connected": True, "streams": ["x"]}]}
    out = C.render(st)
    h10 = out.split("  H10")[1].split("\n")[0]
    assert "STREAMING" not in h10 and "UNMATCHED" in h10
    assert "1/2 device(s) STREAMING" in out            # Other, via ownership


def test_unmatched_names_are_said_to_be_UNMATCHED_not_rendered_as_idle():
    """`active=None` for an unmatched name is indistinguishable from a genuinely idle stream. Say which."""
    st = {"streams": [_own("acc_h10", "H10", True)],
          "devices": [{"name": "Ring", "connected": True, "streams": ["spo2", "ppg"]},
                      {"name": "H10", "connected": True, "streams": ["acc"]}]}
    out = C.render(st)
    ring = out.split("  Ring")[1]
    assert "connected (UNMATCHED)" in ring.split("\n")[0]
    assert "UNMATCHED 2 configured: spo2 ppg" in ring
    assert "no bus stream is owned by this device" in ring
    assert "active=None" not in out


def test_a_daemon_older_than_the_device_field_is_named_as_the_reason():
    """No ownership anywhere in the state means the daemon predates `streams[].device`. Every name is
    then unmatched, and the line says WHY rather than silently reviving the equality join."""
    st = {"streams": [{"key": "ecg", "active": True}],
          "devices": [{"name": "H10", "connected": True, "streams": ["ecg"]}]}
    out = C.render(st)
    assert "0/1 device(s) STREAMING" in out
    assert "connected (UNMATCHED)" in out
    assert "older than streams[].device" in out


def test_a_device_with_no_configured_streams_gets_no_unmatched_line():
    st = {"streams": [], "devices": [{"name": "Bare", "connected": True, "streams": []}]}
    out = C.render(st)
    assert "connected (idle)" in out and "UNMATCHED" not in out
