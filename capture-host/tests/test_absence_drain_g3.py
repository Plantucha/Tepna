# tepna-capture — tests/test_absence_drain_g3.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ABSENCE-SURVEY drain, group 3 (capture.py): the plants for the findings whose existing tests could not see
the defect — each runs a full `run_polar` session against the fake Polar, as the live-contract suite does."""

import os

import capture
import polar_pmd as pmd
import test_capture_runners as T
from test_run_polar_live_contract import _drive

# The module-global reset `run_polar` needs (above all `_STOP`), re-exported rather than re-implemented,
# exactly as test_run_polar_live_contract.py does.
_clean_stop = T._clean_stop


def test_an_HR_session_opens_NO_seam_sidecar_because_HR_has_no_device_clock(tmp_path, monkeypatch):
    """PLANT 875bb6954cdb: `write_hr(_now(), 0, …)` fed the seam sidecar a device clock of 0, and the sidecar
    treats only None as "no clock" — so every HR session opened an `…HRSEAMS.txt` whose device axis never
    moves. The SIG Heart Rate characteristic carries no timestamp at all; the sample is fed as None."""
    _drive(monkeypatch, tmp_path, ["ecg", "hr"], frames=[T._ecg_frame()], hr_frame=bytes([0x00, 60]))
    files = [f for _d, _s, fs in os.walk(tmp_path) for f in fs]
    assert any(f.endswith("_HR.txt") for f in files), files  # the HR stream did record
    assert not [f for f in files if f.endswith("HRSEAMS.txt")], files


class _NoAccMenu(T.FlexPolarClient):
    """Answers GET_SETTINGS for ACC with an EMPTY menu — a menu the device did not report."""

    async def write_gatt_char(self, uuid, cmd, response=False):
        if uuid == pmd.PMD_CONTROL and len(cmd) >= 2 and cmd[0] == 0x01 and cmd[1] == pmd.ACC:
            self.writes.append(bytes(cmd))
            ctrl = self.cbs.get(pmd.PMD_CONTROL)
            if ctrl:
                ctrl(0, bytes([0xF0, 0x01, cmd[1], 0x00, 0x00]))
            return
        return await super().write_gatt_char(uuid, cmd, response)


def test_a_menu_NOT_READ_publishes_no_key_rather_than_an_empty_list(tmp_path, monkeypatch):
    """PLANT 49b190952a2b: `settings.get(0x00) or []` published `acc: []` for a stream whose menu was never
    read, and webmon copies any non-empty `pmd_options` into `pmd_options_seen` — overwriting the menu it
    HAD seen with nothing. A stream with no menu read contributes no key; the others keep theirs."""
    T._polar_common(monkeypatch)
    c = _NoAccMenu(data_frames=[T._ecg_frame(), T._acc_frame()])
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    import asyncio

    asyncio.run(capture.run_polar(T._pdev(streams=["ecg", "acc"]), str(tmp_path)))
    opts = capture.STATUS["devices"]["H10"].get("pmd_options") or {}
    assert opts.get("ecg") == [130], opts
    assert "acc" not in opts, opts
