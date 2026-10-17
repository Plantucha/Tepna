# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Tests for the 31-day stitch trigger in qc_child.audit_and_compose.

CONTRACT: a PASS verdict triggers the stitcher; any other status does not.
A stitch failure is recorded in res["stitch"], never raised: the verdict stands.
"""

import json
import os
from unittest import mock

import qc_child


def _make_job(tmp_path, night, verdict_status):
    """Create a night dir with a loss audit and a stubbed verdict path."""
    captures = str(tmp_path / "captures")
    night_dir = os.path.join(captures, night)
    os.makedirs(night_dir, exist_ok=True)
    # Minimal LOSS-AUDIT.json so compose_due() sees an audit.
    with open(os.path.join(night_dir, "LOSS-AUDIT.json"), "w") as fh:
        json.dump({"night": night}, fh)
    return {
        "dir": night_dir,
        "night": night,
        "audit": False,  # skip the audit write; stub the verdict below
        "why": "test",
        "_verdict_status": verdict_status,
    }


def test_stitch_triggered_on_pass(tmp_path):
    """A PASS verdict triggers stitch_31d.stitch_31d with the captures dir."""
    job = _make_job(tmp_path, "2026-10-16", "PASS")
    captures = str(tmp_path / "captures")

    fake_verdict = (
        {"status": "PASS", "reason": None, "at": "2026-10-17T00:00:00"},
        {"statement": "s", "solid": 1, "exit": 0},
    )

    with (
        mock.patch("qc_child.solid_night.write_night", return_value=fake_verdict),
        mock.patch("qc_child.stitch_31d.stitch_31d") as m_stitch,
        mock.patch("qc_child.compose_due", return_value=True),
    ):
        out = qc_child.audit_and_compose([job], devices=[], nights=["2026-10-16"], active=set(), commit=None)

    assert out[0]["solid"]["status"] == "PASS"
    m_stitch.assert_called_once_with(captures, "/srv/tepna/stitched")
    assert out[0]["stitch"]["ok"] is True


def test_stitch_not_triggered_on_non_pass(tmp_path):
    """FAIL/UNKNOWN verdicts do not trigger the stitcher; res["stitch"] is None."""
    for status in ("FAIL", "UNKNOWN", "NOT_APPLICABLE"):
        job = _make_job(tmp_path, "2026-10-16", status)
        fake_verdict = (
            {"status": status, "reason": None, "at": "2026-10-17T00:00:00"},
            {"statement": "s", "solid": 0, "exit": 0},
        )
        with (
            mock.patch("qc_child.solid_night.write_night", return_value=fake_verdict),
            mock.patch("qc_child.stitch_31d.stitch_31d") as m_stitch,
            mock.patch("qc_child.compose_due", return_value=True),
        ):
            out = qc_child.audit_and_compose([job], devices=[], nights=["2026-10-16"], active=set(), commit=None)
        assert out[0]["solid"]["status"] == status
        m_stitch.assert_not_called()
        assert out[0]["stitch"] is None


def test_stitch_failure_does_not_break_verdict(tmp_path):
    """A stitch exception is recorded, never raised: the verdict stands."""
    job = _make_job(tmp_path, "2026-10-16", "PASS")
    fake_verdict = (
        {"status": "PASS", "reason": None, "at": "2026-10-17T00:00:00"},
        {"statement": "s", "solid": 1, "exit": 0},
    )
    with (
        mock.patch("qc_child.solid_night.write_night", return_value=fake_verdict),
        mock.patch("qc_child.stitch_31d.stitch_31d", side_effect=RuntimeError("disk full")),
        mock.patch("qc_child.compose_due", return_value=True),
    ):
        out = qc_child.audit_and_compose([job], devices=[], nights=["2026-10-16"], active=set(), commit=None)
    # Verdict recorded; stitch failure captured as a value.
    assert out[0]["solid"]["status"] == "PASS"
    assert out[0]["stitch"]["ok"] is False
    assert "RuntimeError" in out[0]["stitch"]["error"]
