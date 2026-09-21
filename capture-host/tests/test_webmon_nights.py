# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""/api/nights and the monitor's Ledger / Capture pages (2026-09-20, owner request). The endpoint is
the index over the box's captures tree; the page turns each figure into a click that opens the
analyzer with that night's files loaded. The HTML contract is checked as text — the other monitor
tests' idiom — because the load runs in a browser against a same-origin app window."""
import os

import webmon
from tests.test_webmon_api import _mk, _serve

ROWS = "Phone timestamp;x\n2026-09-19T22:00:00.000;1\n2026-09-19T23:00:00.000;1\n"


def _night(tmp_path, night="2026-09-19"):
    d = tmp_path / "captures" / night
    d.mkdir(parents=True)
    for s in ("ECG", "ACC"):
        (d / f"Polar_H10_02849638_20260919220000_{s}.txt").write_text(ROWS)
    (d / "Polar_VeritySense_0C301E3F_20260919220000_PPG.txt").write_text(ROWS)
    return d


def test_api_nights_indexes_the_box_root_and_names_its_columns(tmp_path):
    _night(tmp_path)
    app, *_ = _mk(tmp_path)
    async def go(c):
        r = await c.get("/api/nights?n=5")
        return r.status, await r.json()
    status, j = _serve(app, go)
    assert status == 200 and j["root"] == str(tmp_path)
    assert [n["night"] for n in j["nights"]] == ["2026-09-19"]
    n = j["nights"][0]
    assert n["ECGDex"]["hours"] == 1.0 and n["ECGDex"]["loadable"] is True and len(n["ECGDex"]["files"]) == 2
    assert n["OxyDex"] is None and n["3 corner hat"] is False and n["PAT"] is True
    assert j["columns"] == list(webmon._nights.COLUMNS)


def test_api_nights_clamps_n_and_survives_a_bad_value(tmp_path):
    for night in ("2026-09-17", "2026-09-18", "2026-09-19"):
        _night(tmp_path, night)
    app, *_ = _mk(tmp_path)
    async def go(c):
        a = await (await c.get("/api/nights?n=2")).json()
        b = await (await c.get("/api/nights?n=zero")).json()
        z = await (await c.get("/api/nights?n=0")).json()
        return [x["night"] for x in a["nights"]], len(b["nights"]), len(z["nights"])
    two, bad, zero = _serve(app, go)
    assert two == ["2026-09-18", "2026-09-19"] and bad == 3 and zero == 1


def test_api_nights_reports_an_indexing_failure_instead_of_a_bare_500(tmp_path, monkeypatch):
    app, *_ = _mk(tmp_path)
    def boom(root, n):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(webmon._nights, "index_nights", boom)
    async def go(c):
        r = await c.get("/api/nights")
        return r.status, await r.json()
    status, j = _serve(app, go)
    assert status == 500 and j["error"] == "RuntimeError: disk gone"


def test_the_monitor_carries_the_ledger_and_capture_pages_and_the_load_hook():
    html = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "monitor.html"), encoding="utf-8").read()
    for frag in ('data-view="ledger"', 'data-view="capture"', 'id="view-ledger"', 'id="view-capture"',
                 "id=\"ledgerTable\"", "id=\"captureTable\"", "fetch('/api/nights?n=", "function openNight(",
                 "ledger:'Ledger', capture:'Capture'", "v==='ledger' || v==='capture'"):
        assert frag in html, frag
    # the load hands files to the app's OWN input and fires its change event — no bundle is changed
    assert "el.files = dt.files; el.dispatchEvent(new w.Event('change', {bubbles:true}))" in html
    # ECGDex routes by stream suffix; the Integrator is shown but never offered as a click
    assert '["_ECG.txt","#ecgInput"]' in html and "folds run on rig" in html
    # every analyzer column the index publishes has an app to open
    import nights_index as ni
    for col in ni.COLUMNS:
        assert f'{col if " " in col else col}:' in html or f'"{col}":' in html, f"no app mapped for {col}"
