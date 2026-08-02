# tepna-capture — tests/test_webmon_polar_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/polar/pull` — where the recording lands, and whether the answer is honest.

The tests next door cover the failure surface well: a bad session path, a non-Polar address, a busy
offline slot (409), a generic failure (502), and the pause-hook wiring. What none of them look at is the
part the operator ends up holding — the DIRECTORY NAME the recording is written to, and whether `ok`
means the pull actually succeeded.

Both matter. The directory name is the only identity an offline pull carries: it is assembled from the
device model, its id and the session path, and nothing downstream re-derives it from the file contents.
And `ok` mirrors the MANIFEST's verdict rather than "the request completed" — a distinction audit F3 had
to make, because a pull that came back short must not render as a success in the monitor. That mirroring
had no test at this layer, so it could be replaced by a constant `True` with the suite green.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import webmon  # noqa: E402
from tests.test_webmon_api import H10, _mk, _serve  # noqa: E402

ADDR = H10["address"]                       # AA:BB:CC:DD:EE:FF
SESSION = "/U/0/20260719/E/034500/"


@pytest.fixture(autouse=True)
def _no_bonding(monkeypatch):
    """Every _polar_run bonds first, which shells out to bluetoothctl."""
    async def ok(*a, **k):
        return True
    monkeypatch.setattr(webmon.bonding, "ensure_bonded", ok)


def _pull(tmp_path, body, manifest=None, devices=None, capture=None, status=None):
    async def fake_pull(address, session, out_dir, on_progress=None):
        if capture is not None:
            capture.update(address=address, session=session, out_dir=out_dir, prog=on_progress)
        return manifest if manifest is not None else {"ok": True, "files": 3}
    webmon.polar_psftp.pull_recording = fake_pull
    app, _cfg, st, *_ = _mk(tmp_path, devices=devices, status=status, polar_pause=None)

    async def go(c):
        r = await c.post("/api/polar/pull", json=body)
        return r.status, await r.json()
    return (*_serve(app, go), st)


@pytest.fixture(autouse=True)
def _restore_psftp():
    real = webmon.polar_psftp.pull_recording
    yield
    webmon.polar_psftp.pull_recording = real


# ── where the recording lands ───────────────────────────────────────────────────────────────────────
def test_the_output_directory_names_the_device_and_the_session(tmp_path):
    """`Polar_<model>_<device_id>_offline_<session with separators flattened>`, under
    `<root>/captures/stored`. The session's slashes MUST be flattened — left in, they would make the
    session path a directory tree of its own, in a name the adapter layer cannot route."""
    cap = {}
    status, body, _st = _pull(tmp_path, {"address": ADDR, "session": SESSION}, capture=cap)
    assert status == 200 and body["ok"] is True
    assert cap["out_dir"] == os.path.join(
        str(tmp_path), "captures", "stored", "Polar_H10_12345678_offline_U_0_20260719_E_034500")
    assert cap["address"] == ADDR and cap["session"] == SESSION


def test_a_device_without_a_configured_id_falls_back_to_its_mac_tail(tmp_path):
    """A remembered device always has a device_id, but this endpoint does not require one — and an
    unnamed directory would collide with the next such device's. The tail of the MAC is the fallback
    identity."""
    dev = {k: v for k, v in H10.items() if k != "device_id"}
    cap = {}
    _pull(tmp_path, {"address": ADDR, "session": SESSION}, devices=[dev], capture=cap)
    assert cap["out_dir"].endswith("Polar_H10_CCDDEEFF_offline_U_0_20260719_E_034500"), cap["out_dir"]


def test_a_device_without_a_model_still_produces_a_usable_name(tmp_path):
    dev = {k: v for k, v in H10.items() if k != "model"}
    cap = {}
    _pull(tmp_path, {"address": ADDR, "session": SESSION}, devices=[dev], capture=cap)
    assert "Polar_Device_12345678_offline_" in cap["out_dir"], cap["out_dir"]


# ── the verdict ─────────────────────────────────────────────────────────────────────────────────────
def test_ok_mirrors_the_manifests_verdict_not_merely_that_the_request_finished(tmp_path):
    """Audit F3. `polar_psftp` marks a manifest `ok: False` when a file came back short — a truncated
    recording that still produced files and raised nothing. Reporting `ok: True` here would render a
    partial night as a completed one, which is the whole failure the manifest verdict exists to expose."""
    status, body, _st = _pull(tmp_path, {"address": ADDR, "session": SESSION},
                              manifest={"ok": False, "short": ["ACC.BPB: 1200 of 8000"]})
    assert status == 200, "a short pull is a reported outcome, not a transport failure"
    assert body["ok"] is False
    assert body["manifest"] == {"ok": False, "short": ["ACC.BPB: 1200 of 8000"]}


def test_a_manifest_without_a_verdict_is_treated_as_success(tmp_path):
    """Older manifests carry no `ok` key. Defaulting them to False would report every historical pull
    as failed; defaulting to True keeps the honest verdict opt-in for producers that emit one."""
    _s, body, _st = _pull(tmp_path, {"address": ADDR, "session": SESSION}, manifest={"files": 2})
    assert body["ok"] is True and body["manifest"] == {"files": 2}


# ── progress, and its cleanup ───────────────────────────────────────────────────────────────────────
def test_progress_is_published_against_the_device_the_monitor_shows(tmp_path):
    """The card reads `status.devices[<name>].pull_progress`. Published under the wrong name — or with
    the wrong arithmetic — the bar belongs to another device or sits at 0 % all the way through."""
    seen = {}

    async def fake_pull(address, session, out_dir, on_progress=None):
        on_progress(2500, 10000)
        seen["mid"] = dict(st["devices"]["H10"]["pull_progress"])
        return {"ok": True}
    webmon.polar_psftp.pull_recording = fake_pull
    app, _cfg, st, *_ = _mk(tmp_path, polar_pause=None)

    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": ADDR, "session": SESSION})
        return await r.json()
    _serve(app, go)
    assert seen["mid"] == {"device": "H10", "bytes": 2500, "total": 10000, "pct": 25}


def test_progress_with_an_unknown_total_reports_zero_rather_than_dividing_by_it(tmp_path):
    seen = {}

    async def fake_pull(address, session, out_dir, on_progress=None):
        on_progress(500, 0)
        seen["mid"] = dict(st["devices"]["H10"]["pull_progress"])
        return {"ok": True}
    webmon.polar_psftp.pull_recording = fake_pull
    app, _cfg, st, *_ = _mk(tmp_path, polar_pause=None)

    async def go(c):
        return await (await c.post("/api/polar/pull",
                                   json={"address": ADDR, "session": SESSION})).json()
    _serve(app, go)
    assert seen["mid"]["pct"] == 0 and seen["mid"]["total"] == 0


def test_progress_is_cleared_when_the_pull_ends(tmp_path):
    """A leftover `pull_progress` is a bar frozen at 87 % for the rest of the daemon's life."""
    _s, _b, st = _pull(tmp_path, {"address": ADDR, "session": SESSION},
                       status={"H10": {"connected": True}})
    assert "pull_progress" not in st["devices"].get("H10", {})


def test_progress_is_cleared_even_when_the_pull_fails(tmp_path):
    async def boom(address, session, out_dir, on_progress=None):
        on_progress(10, 100)
        raise RuntimeError("link dropped")
    webmon.polar_psftp.pull_recording = boom
    app, _cfg, st, *_ = _mk(tmp_path, polar_pause=None)

    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": ADDR, "session": SESSION})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 502 and "link dropped" in body["error"]
    assert "pull_progress" not in st["devices"].get("H10", {}), \
        "a failed pull must not leave a progress bar behind"


# ── which devices this endpoint will talk to at all ─────────────────────────────────────────────────
def test_a_remembered_non_polar_device_at_the_same_address_is_refused(tmp_path):
    """The lookup is address AND vendor. Matching on address alone would send PS-FTP at an O2Ring,
    which speaks nothing of the sort."""
    ring = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
            "address": ADDR, "streams": ["spo2"], "rates": {}}
    status, body, _st = _pull(tmp_path, {"address": ADDR, "session": SESSION}, devices=[ring])
    assert status == 400 and "bad address or session path" in body["error"]
