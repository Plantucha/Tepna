# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""AN UNREADABLE LINK SIDECAR MUST NOT READ AS A DISCONNECTED DEVICE.

`timeline.py` renders when each device was connected. A gap in that picture is how this suite says
"not connected" — so a directory or file it merely failed to READ, dropped in silence, becomes an
assertion about the radio that nothing in the data supports.

`link_adapter` has the sharper version: it answers WHICH RADIO served a night, and a skipped file is
indistinguishable from "no sidecar recorded an adapter", which is the honest answer for an old night.
"""
import timeline


def test_AN_UNLISTABLE_DIRECTORY_IS_ANNOUNCED(tmp_path, caplog, monkeypatch):
    def boom(_d):
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(timeline.os, "listdir", boom)
    with caplog.at_level("WARNING"):
        got = timeline.read_link_samples(str(tmp_path))
    assert got == {}
    assert "absent rather than empty" in caplog.text


def test_AN_UNATTRIBUTABLE_NIGHT_IS_ANNOUNCED(tmp_path, caplog, monkeypatch):
    def boom(_d):
        raise OSError(5, "Input/output error")

    monkeypatch.setattr(timeline.os, "listdir", boom)
    with caplog.at_level("WARNING"):
        got = timeline.link_adapter(str(tmp_path))
    assert got == {}
    assert "adapter cannot be attributed" in caplog.text


def test_AN_UNREADABLE_SIDECAR_IS_ANNOUNCED(tmp_path, caplog, monkeypatch):
    (tmp_path / "2026-08-31_H10-01_LINK.csv").write_text("#hci0\nts;device;connected\n")
    real = timeline.open if hasattr(timeline, "open") else open

    def boom(path, *a, **k):
        if str(path).endswith("_LINK.csv"):
            raise OSError(5, "Input/output error")
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", boom)
    with caplog.at_level("WARNING"):
        timeline.link_adapter(str(tmp_path))
    assert "cannot say which adapter served it" in caplog.text


def test_A_READABLE_NIGHT_SAYS_NOTHING(tmp_path, caplog):
    """The control. Every assertion above is satisfied by a module that warns unconditionally."""
    (tmp_path / "2026-08-31_H10-01_LINK.csv").write_text("#hci0\nts;device;connected\n")
    with caplog.at_level("WARNING"):
        got = timeline.link_adapter(str(tmp_path))
    assert got == {"2026-08-31_H10-01_LINK.csv": "hci0"}
    assert caplog.text == ""
