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


def test_api_nights_reports_how_many_streams_are_still_pending(tmp_path, monkeypatch):
    """The response carries `pending` — the count of primary streams whose fragments/coverage did not fit
    the request's time budget — so the page knows whether to ask again; a later call serves them from
    the per-file cache."""
    import nights_index as ni

    _night(tmp_path)
    app, *_ = _mk(tmp_path)
    real = ni.index_nights
    monkeypatch.setattr(ni, "index_nights", lambda root, limit=60, budget_s=15.0: real(root, limit, 0.0))
    ni._cache.clear(); ni._cache_loaded_from = None
    async def go(c):
        r = await c.get("/api/nights?n=5")
        return r.status, await r.json()
    status, j = _serve(app, go)
    n = [x for x in j["nights"] if x["night"] == "2026-09-19"][0]
    assert status == 200 and j["pending"] >= 1 and n["ECGDex"]["pending"] is True and n["ECGDex"]["fragments"] is None
    monkeypatch.setattr(ni, "index_nights", real)
    app, *_ = _mk(tmp_path)                        # a fresh app: one aiohttp app serves on one loop
    status, j = _serve(app, go)
    n = [x for x in j["nights"] if x["night"] == "2026-09-19"][0]
    assert j["pending"] == 0 and n["ECGDex"]["pending"] is False and n["ECGDex"]["fragments"] == 2
    assert n["ECGDex"]["coverage"] == 0.0      # two rows an hour apart: one hole, the whole span


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


def test_the_monitor_carries_ONE_nights_page_and_the_load_hook():
    """Ledger and Capture were two pages of the same rows (2026-09-20); the owner folded them into one
    (2026-09-21) once each cell carried fragments + coverage as well as size / span."""
    html = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "monitor.html"), encoding="utf-8").read()
    for frag in ('data-view="nights"', 'id="view-nights"', "id=\"nightsTable\"", "fetch('/api/nights?n=",
                 "function openNight(", "nights:'Nights'", "v==='nights'", "fragment", "v.coverage", "v.pending"):
        assert frag in html, frag
    for gone in ('data-view="ledger"', 'data-view="capture"', "ledgerTable", "captureTable"):
        assert gone not in html, gone
    # while the server is still counting fragments the page asks again — and stops when nothing is pending
    assert "NIGHTS_PENDING>0 && VIEW==='nights'" in html
    # the load hands files to the app's OWN input and fires its change event — no bundle is changed
    assert "el.files = dt.files; el.dispatchEvent(new w.Event('change', {bubbles:true}))" in html
    # ECGDex routes by stream suffix; the Integrator is shown but never offered as a click
    assert '["_ECG.txt","#ecgInput"]' in html and "folds run on rig" in html
    # every analyzer column the index publishes has an app to open
    import nights_index as ni
    for col in ni.COLUMNS:
        assert f'{col if " " in col else col}:' in html or f'"{col}":' in html, f"no app mapped for {col}"


def _monitor_js_table(html, name):
    """The `const NAME = {...};` literal from the monitor, as a Python dict (the values are JSON)."""
    import json
    import re

    m = re.search(r"const " + name + r" = (\{.*?\});\n", html, re.S)
    assert m, name
    # bare identifiers as keys → quoted; everything else in these tables is already JSON
    return json.loads(re.sub(r"(?<=[{,\s])([A-Za-z_]\w*)(?=:)", r'"\1"', m.group(1)))


def test_every_clickable_night_routes_to_an_input_the_app_actually_has():
    """The first deployed click (2026-09-20) sent OxyDex's four SpO₂ CSVs to `#ecgJsonInput` — the
    document's FIRST file input, which is its ECG-export sidecar loader — because OxyDex had no route
    and the monitor fell back to a positional guess; the files were silently dropped. Now every node a
    click can reach names its input, and each selector is checked against the app's OWN source so a
    renamed input reds here rather than at the click. The population is derived from the index and pinned
    as an EQUALITY: every NODES entry with a glob (a night can hold it) that is loadable — and nothing
    else, so a route for a figure-only column (HRVDex) cannot quietly come back."""
    import re

    import nights_index as ni

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html = open(os.path.join(here, "monitor.html"), encoding="utf-8").read()
    routes = _monitor_js_table(html, "NIGHT_INPUT")
    apps = _monitor_js_table(html, "NIGHT_APP")
    clickable = [c for c, (globs, _p) in ni.NODES.items() if globs and c not in ni.NOT_LOADABLE] + list(ni.DERIVED)
    assert set(routes) == set(clickable), (sorted(set(clickable) - set(routes)), sorted(set(routes) - set(clickable)))
    # the derived tools are a click again (their classifiers read box filenames since 2026-09-20 —
    # test_the_tool_classifiers_accept_box_filenames), so the ✓ pill carries the same data-night/data-node
    # the node figures do, and their routes are in the equality above like any other clickable column
    assert 'data-node="${k}"' in html.split("function nDerived")[1].split("\n")[0]
    # the positional fallback is gone: a missing route or selector refuses instead of guessing
    assert "doc.querySelector('input[type=file]:not([webkitdirectory])')" not in html
    assert "has no input route for it" in html and "input is missing" in html
    root = os.path.dirname(here)
    for node, route in routes.items():
        page = apps[node]
        src = os.path.join(root, page[:-5] + ".src.html")
        if not os.path.exists(src):
            src = os.path.join(root, page)  # analysis tools are authored in place
        assert os.path.exists(src), (node, src)
        text = open(src, encoding="utf-8").read()
        tags = re.findall(r'<input\b[^>]*\btype="file"[^>]*>', text)
        ids = {m.group(1) for tag in tags for m in [re.search(r'\bid="([^"]+)"', tag)] if m}
        sels = [s for _suffix, s in route] if isinstance(route, list) else [route]
        for sel in sels:
            assert sel.startswith("#") and sel[1:] in ids, (node, sel, sorted(ids))


def test_a_cpap_night_present_in_both_trees_is_handed_over_once(tmp_path):
    """Both `cpap/` (SD card) and `cpap-ble/` (BLE pull) hold the same session; handing CPAPDex both
    doubled the night (14.3 h therapy for 7.2 h). The SD set wins when present, the BLE pull otherwise,
    and the hours figure reads from the tree the files came from."""
    import nights_index as ni

    root = tmp_path / "captures"
    (root / "2026-09-19").mkdir(parents=True)

    def edf(rel, records):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        hdr = bytearray(b" " * 256)
        hdr[236:244] = f"{records:<8d}".encode()
        hdr[244:252] = b"1       "
        p.write_bytes(bytes(hdr))

    edf("cpap-ble/DATALOG/20260919/20260919_230717_BRP.edf", 7200)
    only_ble = ni.night_entry(str(root), str(root / "2026-09-19"))["CPAPDex"]
    assert [f.split("/")[0] for f in only_ble["files"]] == ["cpap-ble"] and only_ble["hours"] == 2.0
    for kind, records in (("BRP", 3600), ("PLD", 3600), ("SA2", 3600)):
        edf(f"cpap/DATALOG/20260919/20260919_230652_{kind}.edf", records)
    both = ni.night_entry(str(root), str(root / "2026-09-19"))["CPAPDex"]
    assert {f.split("/")[0] for f in both["files"]} == {"cpap"} and len(both["files"]) == 3
    assert both["hours"] == 1.0, both  # the SD tree's BRP, not the BLE pull's
    assert both["bytes"] == 3 * 256
    # the Integrator's figure follows the same rule — it lists the raw input a fold would take, once
    integ = ni.night_entry(str(root), str(root / "2026-09-19"))["Integrator"]
    assert {f.split("/")[0] for f in integ["files"]} == {"cpap"}


def test_hrvdex_is_a_figure_never_a_click(tmp_path):
    """HRVDex ingests Welltory CSV or an ECGDex export; a raw Polar RR file handed to it is dropped
    silently (measured 2026-09-20). Its cell keeps the raw-input figure and `loadable: False`."""
    import nights_index as ni

    d = _night(tmp_path)
    (d / "Polar_H10_02849638_20260919220000_RR.txt").write_text(ROWS)
    e = ni.night_entry(str(tmp_path / "captures"), str(d))
    assert e["HRVDex"]["loadable"] is False and e["HRVDex"]["hours"] == 1.0
    assert e["ECGDex"]["loadable"] is True


BOX_NAMES = (
    "Polar_H10_02849638_20260919183658_ECG.txt",
    "Polar_H10_02849638_20260919183658_HR.txt",
    "Polar_VeritySense_0C301E3F_20260919183724_PPG.txt",
    "Wellue_O2Ring-S_S8AW2100_20260919002219_SPO2.csv",
)


def _classifier_regexes(path):
    """Every STAMP-capturing regex literal inside the tool's `function classify(...)` body — the ones
    that classify a file (they capture the YYYYMMDD stamp); a bare device test like /Polar_H10/ only
    picks a role after the match. Compiled by Python `re` (the literals there share syntax)."""
    import re

    text = open(path, encoding="utf-8").read()
    start = text.index("function classify(")
    body = text[start:text.index("\n  }\n", start)]
    out = []
    for m in re.finditer(r"/((?:\\/|[^/\n])+)/([a-z]*)", body):
        if "(" not in m.group(1):
            continue
        try:
            out.append(re.compile(m.group(1), re.I if "i" in m.group(2) else 0))
        except re.error:
            continue  # a JS-only construct Python cannot compile is not a classifier we can test; the assert below requires ≥1 survivor
    assert out, path
    return out


def test_the_tool_classifiers_accept_box_filenames():
    r"""Was the TRIPWIRE `…still_reject_box_filenames` (2026-09-20 morning): 0 of the 134 files in the box's
    09-19 night matched either tool's classifier, both written for the phone-app names, so the Ledger
    showed ✓ as on-disk eligibility and offered no click. It fired the same evening — the classifiers now
    take both layouts (`(\d{8})_?(\d{6})`, and the ring's box `_SPO2.csv` as the `o2` role) — and a
    tripwire that has fired becomes the regression guard: every box name a tool has a ROLE for must match
    one of its stamp-capturing regexes, read from the tool's own `classify` body so a rewrite cannot
    pass by editing this file. Names no regex of a tool matches (the hat has none for the ring's raw PPG; PAT has none for
    `_HR.txt` or the ring CSV) are asserted as still REJECTED, so the widening did not become a wildcard."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    wants = {
        "sensor-trio-power-analysis.js": {
            "Polar_H10_02849638_20260919183658_HR.txt": True,
            "Polar_VeritySense_0C301E3F_20260919183724_PPG.txt": True,
            "Wellue_O2Ring-S_S8AW2100_20260919002219_SPO2.csv": True,
            # the ring's raw PPG waveform: no regex — the hat reads the ring's PULSE from its CSV. (The hat's
            # H10 regex matches every _KIND.txt and keeps only HR AFTER the match, in JS; that filter is
            # not visible at this layer, so an _ECG.txt is not a usable negative here.)
            "Wellue_O2Ring-S_S8AW2100_20260919002219_PPG.txt": False,
        },
        "sensor-trio-night.js": {
            # the per-night landing page carries the hat's classifier VERBATIM; gated by the same table so
            # the copy cannot drift from sensor-trio-power-analysis.js (same positives, same negatives)
            "Polar_H10_02849638_20260919183658_HR.txt": True,
            "Polar_VeritySense_0C301E3F_20260919183724_PPG.txt": True,
            "Wellue_O2Ring-S_S8AW2100_20260919002219_SPO2.csv": True,
            "Wellue_O2Ring-S_S8AW2100_20260919002219_PPG.txt": False,
        },
        "pat-feasibility.js": {
            "Polar_H10_02849638_20260919183658_ECG.txt": True,
            "Polar_VeritySense_0C301E3F_20260919183724_PPG.txt": True,
            # the ring's raw PPG is PAT's FINGER site since 2026-09-26 (role decided after the match, in JS)
            "Wellue_O2Ring-S_S8AW2100_20260919002219_PPG.txt": True,
            "Polar_H10_02849638_20260919183658_HR.txt": False,
            "Wellue_O2Ring-S_S8AW2100_20260919002219_SPO2.csv": False,
        },
    }
    for tool, table in wants.items():
        regexes = _classifier_regexes(os.path.join(root, tool))
        assert regexes, f"{tool}: no stamp-capturing regex found in classify() — the extractor lost the body"
        for name, want in table.items():
            hit = any(r.search(name) for r in regexes)
            assert hit == want, f"{tool} {'rejects' if want else 'accepts'} box name {name}"
    # and the phone-app names the classifiers were written for still match — both layouts, one rule each
    for tool, name in (("sensor-trio-power-analysis.js", "Polar_H10_02849638_20260610_211538_HR.txt"),
                       ("sensor-trio-power-analysis.js", "O2Ring S 2100_20260503210952.csv"),
                       ("sensor-trio-night.js", "Polar_H10_02849638_20260610_211538_HR.txt"),
                       ("pat-feasibility.js", "Polar_Sense_0C301E3F_20260609_190208_PPG.txt")):
        assert any(r.search(name) for r in _classifier_regexes(os.path.join(root, tool))), (tool, name)

def test_the_batch_tools_get_their_process_button_pressed_and_the_selector_is_real():
    """The six analyzers process on load; the two batch tools index the night and WAIT for their Process
    button (measured 2026-09-21 on the box after #2746: "1 nights indexed from 10 files", `#procBtn`
    enabled, status idle — the owner asked for "process it without other clicking"). openNight now waits
    for that button to enable and presses it; if it never enables the toast says the tool found no
    eligible night rather than "processing". NIGHT_RUN is pinned as an EQUALITY to the derived tools, and
    each selector must be an element id in the tool's own source."""
    import re

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html = open(os.path.join(here, "monitor.html"), encoding="utf-8").read()
    run = _monitor_js_table(html, "NIGHT_RUN")
    apps = _monitor_js_table(html, "NIGHT_APP")
    m = re.search(r'const NIGHT_DERIVED = \[(.*?)\];', html)
    assert m
    derived_keys = [k.strip().strip('"') for k in m.group(1).split(",")]
    assert set(run) == set(derived_keys), (sorted(run), derived_keys)
    assert "btn.click();" in html and "Process pressed" in html and "found no eligible night" in html
    root = os.path.dirname(here)
    for node, sel in run.items():
        src = os.path.join(root, apps[node])  # the analysis tools are authored/built in place at the root
        text = open(src, encoding="utf-8").read()
        assert sel.startswith("#") and f'id="{sel[1:]}"' in text, (node, sel)
