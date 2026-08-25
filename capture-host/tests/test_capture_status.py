# tepna-capture — tests/test_capture_status.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Branch coverage for the capture-status renderer + its injectable fetch. No network — the fetch seam
# is a fake, and render() is a pure function of a /api/state dict.

import capture_status as C


def _state():
    return {
        "adapter": "AC:A7:F1:29:9D:1D",
        "streams": [
            {"key": "ecg", "active": True, "effFs": 130.2, "health": "ok"},
            {"key": "acc", "active": True, "effFs": 52.1, "health": "ok"},
            {"key": "ppg", "active": False, "effFs": None, "health": "idle"},
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
    st = {"adapter": "AA", "devices": [{"name": "X", "connected": True, "streams": ["k"]}]}
    out = C.render(st)  # no top-level "streams", no "cpap"
    assert "0/1 device(s) STREAMING" in out
    assert "X" in out and "connected (idle)" in out
    assert "CPAP" not in out
    assert "k" in out  # the unknown stream key still renders a line


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
