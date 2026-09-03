# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""TWO SWALLOWS THAT BROKE A STATED GUARANTEE, SILENTLY.

Most of this audit's sites cost a reason or a partial total. These two cost something the code
itself promises in a comment on the very line above:

  "the PSK does not outlive the association"   — and on a failed unlink, it does
  "back up before writing — a bad write bricks the daemon"  — and the write proceeds regardless

Both are correct to continue. Neither was correct to stay quiet: a surviving secret is a file
nothing else will ever look for, and a missing rollback copy is discovered only at the moment it
was needed.
"""
import cpap_harvest


def test_A_PSK_THAT_SURVIVED_ITS_ASSOCIATION_IS_ANNOUNCED(caplog, monkeypatch):
    """Drive the real `finally` with an unlink that refuses, and watch it say so. The association
    itself is stubbed to fail fast — what is under test is the teardown, not the join."""
    monkeypatch.setattr(cpap_harvest, "_sh", lambda *a, **k: (1, "supplicant refused"))
    monkeypatch.setattr(cpap_harvest, "_wpa_down", lambda *a, **k: True)
    monkeypatch.setattr(cpap_harvest.os.path, "isdir", lambda _p: False)

    kept = []
    real_unlink = cpap_harvest.os.unlink

    def wont_unlink(path):
        kept.append(path)
        raise OSError(1, "Operation not permitted")

    monkeypatch.setattr(cpap_harvest.os, "unlink", wont_unlink)
    with caplog.at_level("WARNING"):
        assert cpap_harvest._wpa_up("wlan0", "ssid", "psk", "aa:bb", 0.0) is False

    assert "still holds a Wi-Fi PSK" in caplog.text
    assert kept and kept[0] in caplog.text, "the message must name the surviving file"
    for f in kept:                                  # do not leave a real PSK behind in the tmpdir
        try:
            real_unlink(f)
        except OSError:
            pass   # best-effort tidy-up of a test artifact; the assertions above have already run,
                   # and failing the test because the cleanup failed would report the wrong thing


def test_THE_WARNING_NAMES_THE_FILE_SO_A_HUMAN_CAN_REMOVE_IT():
    """The message must carry the PATH. 'could not remove the config' sends the operator hunting;
    this is the only record that the secret exists at all."""
    import tests._srcscan as _s
    src = _s.module_source("cpap_harvest.py")
    i = src.index("still holds a Wi-Fi PSK")
    seg = src[i - 400:i + 200]
    assert "%s" in seg and "conf" in seg
    assert "delete it by hand" in seg


def test_THE_BACKUP_WARNING_SAYS_THE_WRITE_WENT_AHEAD():
    """Continuing is the right call — refusing a settings change because a backup failed strands the
    operator. The message has to say BOTH halves, or it reads as 'the change did not happen'."""
    import tests._srcscan as _s
    src = _s.module_source("webmon.py")
    i = src.index("could not back up")
    assert "WITHOUT a rollback copy" in src[i:i + 160]
