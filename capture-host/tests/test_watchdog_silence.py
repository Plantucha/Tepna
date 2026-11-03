# tepna-capture — tests/test_watchdog_silence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The watchdog's decisions (watchdog_silence.py). The property worth pinning: a connected device whose
# silence the status file EXPLAINS is never a restart, and an absent or unknown explanation still is.
# Device names and addresses are synthetic.

import datetime as dt
import json

import watchdog_silence as ws

NOW = dt.datetime(2026, 11, 2, 15, 0, 0)
OLD = (NOW - dt.timedelta(seconds=1750)).isoformat()
FRESH = (NOW - dt.timedelta(seconds=30)).isoformat()


def _dev(**kw):
    return {"connected": True, "last_sample": OLD, "address": "AA:00", **kw}


def test_unexplained_silence_is_a_fault():
    faults, explained = ws.silent_devices({"devices": {"Strap A": _dev()}}, NOW)
    assert faults == ["Strap A=1750s"]
    assert explained == []


def test_absent_gates_explain_nothing():
    st = {"gates": None, "devices": {"Strap A": _dev()}}
    assert ws.silent_devices(st, NOW)[0] == ["Strap A=1750s"]


def test_alerts_states_explain_the_silence():
    st = {
        "gates": {"polar_paused": ["AA:03"]},
        "devices": {
            "Strap A": _dev(charging=True),
            "Strap B": _dev(worn=False, address="AA:02"),
            "Strap C": _dev(address="AA:03"),
        },
    }
    faults, explained = ws.silent_devices(st, NOW)
    assert faults == []
    assert explained == ["Strap A=1750s:charging", "Strap B=1750s:not-worn", "Strap C=1750s:offline-op"]


def test_worn_unknown_is_not_an_explanation():
    st = {"devices": {"Strap A": _dev(worn=None, charging=None)}}
    assert ws.silent_devices(st, NOW)[0] == ["Strap A=1750s"]


def test_each_gate_names_its_reason():
    cases = [
        ({"stop": True}, {}, "daemon-stopping"),
        ({"recover": True}, {}, "radio-recover"),
        ({"offline_slot": "Strap A"}, {}, "offline-slot"),
        ({"oxyii_pause": True}, {"oxy_lifecycle": "pull"}, "oxyii-pause"),
    ]
    for gates, extra, why in cases:
        st = {"gates": gates, "devices": {"Strap A": _dev(**extra)}}
        assert ws.silent_devices(st, NOW) == ([], [f"Strap A=1750s:{why}"])


def test_a_gate_for_another_device_explains_nothing():
    st = {"gates": {"offline_slot": "Strap B", "oxyii_pause": True}, "devices": {"Strap A": _dev()}}
    assert ws.silent_devices(st, NOW)[0] == ["Strap A=1750s"]


def test_not_silent_or_not_judgeable_is_neither():
    st = {
        "devices": {
            "off": {"connected": False, "last_sample": OLD},
            "fresh": _dev(last_sample=FRESH),
            "nostamp": _dev(last_sample=None),
            "junk": _dev(last_sample="not a time"),
            "typed": _dev(last_sample=5),
            "notdict": "x",
        }
    }
    assert ws.silent_devices(st, NOW) == ([], [])
    assert ws.silent_devices({}, NOW) == ([], [])


def test_wedged_reads_inprogress_only():
    st = {
        "devices": {
            "a": {"last_error": "org.bluez.Error.InProgress"},
            "b": {"last_error": None},
            "c": {"last_error": "Timeout"},
            "d": "x",
        }
    }
    assert ws.wedged_devices(st) == ["a"]
    assert ws.wedged_devices({}) == []


def test_summary_line():
    st = {"devices": {"Strap A x": {"connected": True}, "Ring": {"connected": False}, "": "x"}}
    assert ws.summary(st) == "Strap:up, Ring:off, :off"


def test_main_modes(tmp_path, capsys):
    p = tmp_path / "status.json"
    p.write_text(
        json.dumps(
            {
                "gates": {"offline_slot": "Strap B"},
                "devices": {
                    "Strap A": _dev(last_error="InProgress"),
                    "Strap B": _dev(),
                },
            }
        )
    )
    assert ws.main(["silent", str(p)], now=NOW) == 0
    assert capsys.readouterr().out == "Strap A=1750s\tStrap B=1750s:offline-slot\n"
    assert ws.main(["wedged", str(p)]) == 0
    assert capsys.readouterr().out == "Strap A\n"
    assert ws.main(["summary", str(p)]) == 0
    assert capsys.readouterr().out == "Strap:up, Strap:up\n"
    assert ws.main(["silent", str(p)]) == 0  # real clock: the stamps are long past
    assert "Strap A=" in capsys.readouterr().out
    assert ws.main(["nope", str(p)]) == 2
    assert ws.main([]) == 2


def test_every_skip_kind_continues_past_itself():
    # `continue` versus `break` needs a later device: each skip kind sits BEFORE a silent device.
    devices = {
        "off": {"connected": False, "last_sample": OLD},
        "nostamp": _dev(last_sample=None),
        "junk": _dev(last_sample="not a time"),
        "fresh": _dev(last_sample=FRESH),
        "Strap Z": _dev(),
    }
    assert ws.silent_devices({"devices": devices}, NOW) == (["Strap Z=1750s"], [])


def test_exactly_at_the_threshold_is_not_silent():
    at = (NOW - dt.timedelta(seconds=ws.SILENT_SEC)).isoformat()
    over = (NOW - dt.timedelta(seconds=ws.SILENT_SEC + 1)).isoformat()
    assert ws.silent_devices({"devices": {"a": _dev(last_sample=at)}}, NOW) == ([], [])
    assert ws.silent_devices({"devices": {"a": _dev(last_sample=over)}}, NOW)[0] == ["a=1201s"]


def test_usage_goes_to_stderr_only(capsys):
    assert ws.main(["silent"]) == 2
    out, err = capsys.readouterr()
    assert out == ""
    assert err == "usage: watchdog_silence.py silent|wedged|summary <status.json>\n"


def test_a_non_ascii_name_reads_as_written(tmp_path, capsys):
    p = tmp_path / "status.json"
    p.write_bytes(json.dumps({"devices": {"Pás Ž": {"connected": True}}}, ensure_ascii=False).encode("utf-8"))
    assert ws.main(["summary", str(p)]) == 0
    assert capsys.readouterr().out == "Pás:up\n"
