# tepna-capture — tests/test_link_baselines.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The baseline producer — what turns the radio-distress signal from report-only into a verdict.

`assess` refuses below three nights per device per adapter, and until this nothing wrote those
nights, so on every box every verdict was honestly UNKNOWN. Exercised against the real LINK.csv shape
(the header comment carries the adapter MAC, which is what makes a rate attributable to a radio).
"""

import json

import capture
import link_distress as D

HDR = "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;link_epoch;address"


def _link_csv(adapter, rows):
    """rows: (iso, device, connected, epoch)"""
    out = [f"# adapter={adapter} hci=hci1", HDR]
    out += [f"{t};{dev};{'1' if c else '0'};-50;90;0;0;{ep};AA:BB" for t, dev, c, ep in rows]
    return "\n".join(out)


def _night(dev="ring", hours=6.0, reconnects=3, n=200, adapter="00:01:95:CC:53:02", connected=True):
    import datetime as dt

    t0 = dt.datetime(2026, 8, 20, 23, 0, 0)
    rows = []
    for i in range(n):
        t = t0 + dt.timedelta(seconds=i * (hours * 3600.0 / max(1, n - 1)))
        ep = 1 + (i * reconnects) // max(1, n)
        rows.append((t.isoformat(timespec="milliseconds"), dev, connected, ep))
    return _link_csv(adapter, rows)


def test_the_rate_is_over_the_CONNECTED_span_not_the_file():
    """🔴 Measured while deriving the bands: normalising over the whole file gives `down% = 100` for a
    strap that was never worn, and dilutes every rate by hours a device sat in a drawer. The question
    is how often the link dropped WHILE IT WAS UP."""
    import datetime as dt

    t0 = dt.datetime(2026, 8, 20, 20, 0, 0)
    rows = []
    for i in range(120):  # three hours DISCONNECTED first — a device in a drawer
        rows.append(((t0 + dt.timedelta(seconds=i * 90)).isoformat(timespec="milliseconds"), "ring", False, 1))
    t1 = t0 + dt.timedelta(hours=3)
    for i in range(200):  # then two hours connected with 4 reconnects
        rows.append(
            ((t1 + dt.timedelta(seconds=i * 36)).isoformat(timespec="milliseconds"), "ring", True, 1 + (i * 4) // 200)
        )
    _ad, rates = D.night_rates(_link_csv("AA:BB:CC:DD:EE:FF", rows))
    assert 1.4 < rates["ring"] < 1.8, rates  # ~3 reconnects over ~2 h, not over 5 h


def test_the_ADAPTER_comes_from_the_files_own_header():
    """The wearables moved UB500 → Sena mid-corpus, so the two arms are SEQUENTIAL populations. A rate
    that cannot be attributed to its radio would pool them into one meaningless number."""
    ad, rates = D.night_rates(_night(adapter="AC:A7:F1:29:9D:1D"))
    assert ad == "AC:A7:F1:29:9D:1D" and "ring" in rates
    ad2, _ = D.night_rates("no header here\n" + HDR)
    assert ad2 is None


def test_a_SHORT_session_is_omitted_rather_than_rated():
    """One reconnect across four minutes is 15/h, which would trip any band. Not a night."""
    _ad, rates = D.night_rates(_night(hours=0.3))
    assert rates == {}
    _ad, few = D.night_rates(_night(n=5))
    assert few == {}


def test_a_device_that_was_never_connected_gets_no_rate():
    _ad, rates = D.night_rates(_night(connected=False))
    assert rates == {}


def test_unusable_input_yields_nothing_rather_than_raising():
    assert D.night_rates("") == (None, {})
    assert D.night_rates(None) == (None, {})
    assert D.night_rates("# adapter=AA:BB:CC:DD:EE:FF hci=hci1\nno header row")[1] == {}


def test_merge_keeps_the_most_recent_nights_and_drops_the_rest():
    """A baseline over all history eventually describes a radio that is no longer in the box."""
    base = {}
    for i in range(20):
        base = D.merge_baselines(base, "AA:BB", {"ring": float(i)}, keep=14)
    assert base["AA:BB"]["ring"] == [float(i) for i in range(6, 20)]
    assert len(base["AA:BB"]["ring"]) == 14


def test_merge_refuses_junk_rates_without_losing_the_good_ones():
    base = D.merge_baselines(
        {}, "AA:BB", {"ring": 1.0, "bad": "x", "nan": float("nan"), "neg": -1.0, "inf": float("inf")}
    )
    assert base["AA:BB"] == {"ring": [1.0]}


def test_merge_does_not_MUTATE_the_record_it_was_given():
    prior = {"AA:BB": {"ring": [1.0]}}
    D.merge_baselines(prior, "AA:BB", {"ring": 2.0})
    assert prior == {"AA:BB": {"ring": [1.0]}}, "the caller's record was mutated in place"


# ── the daemon half ────────────────────────────────────────────────────────────────────────────


def test_the_rebuild_walks_the_night_dirs_and_writes_the_file(tmp_path):
    caps = tmp_path / "captures"
    for night in ("2026-08-20", "2026-08-21", "2026-08-22"):
        d = caps / night
        d.mkdir(parents=True)
        (d / f"Tepna_{night.replace('-', '')}000000_LINK.csv").write_text(_night(reconnects=3))
    got = capture._rebuild_link_baselines(str(tmp_path))
    assert got and "00:01:95:CC:53:02" in got
    on_disk = json.loads((caps / "link-baselines.json").read_text())
    assert on_disk == got
    med, n = D.baseline_median(got["00:01:95:CC:53:02"]["ring"])
    assert n == 3 and med is not None, "three nights is exactly what assess needs"


def test_the_rebuild_is_BOUNDED_to_the_recent_nights(tmp_path):
    caps = tmp_path / "captures"
    for i in range(6):
        d = caps / f"2026-08-{10 + i:02d}"
        d.mkdir(parents=True)
        (d / "Tepna_x_LINK.csv").write_text(_night())
    got = capture._rebuild_link_baselines(str(tmp_path), nights=2)
    assert len(got["00:01:95:CC:53:02"]["ring"]) == 2


def test_ONE_unreadable_night_does_not_lose_the_others(tmp_path):
    caps = tmp_path / "captures"
    for night in ("2026-08-20", "2026-08-21", "2026-08-22"):
        d = caps / night
        d.mkdir(parents=True)
        (d / "Tepna_x_LINK.csv").write_text(_night())
    # A REAL unreadable file, not a patched `capture.open` — the function uses the builtin, so
    # patching the module attribute would have changed nothing and the test would have passed while
    # exercising the happy path. chmod 000 is the honest way to make one night fail.
    victim = caps / "2026-08-21" / "Tepna_x_LINK.csv"
    victim.chmod(0o000)
    try:
        got = capture._rebuild_link_baselines(str(tmp_path))
    finally:
        victim.chmod(0o644)
    assert len(got["00:01:95:CC:53:02"]["ring"]) == 2, "one bad night took the others with it"


def test_a_missing_captures_tree_leaves_the_previous_baselines_alone(tmp_path):
    """Never raises: this feeds a REPORT. Returning None says 'not rebuilt', and `assess` refuses on a
    short history anyway."""
    assert capture._rebuild_link_baselines(str(tmp_path / "nope")) is None


def test_an_UNWRITEABLE_file_does_not_lose_the_computation(tmp_path, monkeypatch):
    caps = tmp_path / "captures" / "2026-08-20"
    caps.mkdir(parents=True)
    (caps / "Tepna_x_LINK.csv").write_text(_night())
    monkeypatch.setattr(capture.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("ro")))
    got = capture._rebuild_link_baselines(str(tmp_path))
    assert got and "00:01:95:CC:53:02" in got, "the record is still returned to the caller"


def test_a_header_MISSING_A_COLUMN_yields_nothing_rather_than_guessing():
    """A LINK.csv whose header lacks `link_epoch` cannot produce a reconnect rate at all. Positional
    fallback would be the vendor-layout trap: a column order silently reinterpreted."""
    bad = "# adapter=AA:BB:CC:DD:EE:FF hci=hci1\nPhone timestamp;device;connected\n2026-08-20T23:00:00;ring;1"
    assert D.night_rates(bad) == ("AA:BB:CC:DD:EE:FF", {})


def test_short_and_unparseable_rows_are_skipped_not_counted():
    """A torn line mid-file must not stop the walk, and must not be read as a sample."""
    good = [f"2026-08-20T23:{m:02d}:00;ring;1;-50;90;0;0;1;AA" for m in range(0, 60)]
    good += [f"2026-08-21T00:{m:02d}:00;ring;1;-50;90;0;0;2;AA" for m in range(0, 30)]
    text = "\n".join(
        ["# adapter=AA:BB:CC:DD:EE:FF hci=hci1", HDR]
        + good[:20]
        + ["short;row"]
        + ["not-a-time;ring;1;-50;90;0;0;1;AA"]
        + good[20:]
    )
    _ad, rates = D.night_rates(text)
    assert "ring" in rates and rates["ring"] > 0, "a torn line stopped the walk"


def test_merge_with_no_adapter_or_no_rates_returns_the_record_unchanged():
    prior = {"AA:BB": {"ring": [1.0]}}
    assert D.merge_baselines(prior, None, {"ring": 2.0}) == prior
    assert D.merge_baselines(prior, "AA:BB", {}) == prior


def test_an_UNEXPECTED_failure_mid_rebuild_keeps_the_previous_baselines(tmp_path, monkeypatch):
    """The broad except. A baseline is a report about reports — it must never raise into the poller,
    and it must not half-write a record it could not finish."""
    caps = tmp_path / "captures" / "2026-08-20"
    caps.mkdir(parents=True)
    (caps / "Tepna_x_LINK.csv").write_text(_night())

    def boom(*a, **k):
        raise RuntimeError("listing exploded")

    monkeypatch.setattr(capture.diskguard, "list_nights", boom)
    assert capture._rebuild_link_baselines(str(tmp_path)) is None
    assert not (tmp_path / "captures" / "link-baselines.json").exists()


def test_the_poller_rebuilds_baselines_ONCE_A_DAY_without_a_notifier(tmp_path, monkeypatch):
    """🔴 Deliberately not gated on `notifier` the way the morning digest beside it is. A baseline is
    not an alert, and on a box with no webhook the distress signal would otherwise stay UNKNOWN
    forever while looking configured."""
    import datetime as dtm

    from test_capture_runners import _run, _stop_after

    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260719_ECG.txt").write_text("h\n1\n2\n")
    called = []
    monkeypatch.setattr(capture, "_rebuild_link_baselines", lambda root: called.append(root))
    monkeypatch.setattr(capture, "_now", lambda: dtm.datetime(2026, 7, 19, 11, 5, 0))
    capture._STOP.clear()
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 600, "baseline_hour": 11}, "devices": []}, str(tmp_path)))
    capture._STOP.clear()
    assert called == [str(tmp_path)], "the daily baseline rebuild did not run (or ran twice)"


# ── mutants that survived the diff-scoped gate on #1967 ─────────────────────────────────────────


def test_a_ZERO_rate_is_a_MEASUREMENT_and_keeps_its_place_in_the_baseline():
    """🔴 `r < 0` guards junk; `r <= 0` would drop a perfectly quiet night. A device that reconnected
    ZERO times is the best night it ever had, and discarding it biases every median upward — the
    baseline would learn only from the nights that went badly, which is the opposite of a baseline."""
    base = D.merge_baselines({}, "AA:BB", {"ring": 0.0})
    assert base["AA:BB"]["ring"] == [0.0], "a flawless night was dropped from the baseline"
    med, n = D.baseline_median([0.0, 0.0, 0.4])
    assert n == 3 and med == 0.0


def test_a_JUNK_rate_does_not_stop_the_rest_of_the_devices():
    """`continue` vs `break`. The junk sits FIRST here on purpose: with it last, the two are
    indistinguishable — the same weakness the AS11 anchor parser's torn-line test had."""
    # BOTH skip paths, because they are separate `continue`s and a `break` in either truncates:
    # a non-numeric rate takes the float() except; a non-finite one takes the isfinite guard.
    base = D.merge_baselines({}, "AA:BB", {"aaa_bad": "x", "zzz_good": 1.5})
    assert base["AA:BB"] == {"zzz_good": [1.5]}, "an unparseable rate discarded every device after it"
    base2 = D.merge_baselines({}, "AA:BB", {"aaa_nan": float("nan"), "zzz_good": 2.5})
    assert base2["AA:BB"] == {"zzz_good": [2.5]}, "a non-finite rate discarded every device after it"


def test_the_stored_rate_KEEPS_ITS_PRECISION():
    """🔴 `round(r, 4)` → `round(r, None)` returns an INT. Every rate below 0.5 would become 0, so the
    ring's real 0.23 median would read as a device that never reconnects — and the band, being
    `max(floor, 10 x median)`, would quietly collapse to the floor for every quiet device."""
    base = D.merge_baselines({}, "AA:BB", {"ring": 0.2345678})
    stored = base["AA:BB"]["ring"][0]
    assert isinstance(stored, float) and stored == 0.2346, stored
    assert D.merge_baselines({}, "AA:BB", {"ring": 0.4})["AA:BB"]["ring"] == [0.4]


def test_the_DEFAULT_keep_is_fourteen_nights():
    """Pinned because every call site relies on the default; the tests passed `keep` explicitly, so
    the shipped value was covered by nothing."""
    base = {}
    for i in range(20):
        base = D.merge_baselines(base, "AA:BB", {"ring": float(i)})
    assert len(base["AA:BB"]["ring"]) == 14


def test_a_row_SHORTER_than_the_widest_column_index_is_skipped():
    """The `<=` boundary: a row with exactly `max_index` fields has no value AT that index, so `<`
    would read one column past the end of a torn line."""
    hdr_only = "# adapter=AA:BB:CC:DD:EE:FF hci=hci1\n" + HDR
    # link_epoch is index 7, so a row of exactly 7 fields must be rejected, and 8 accepted
    seven = "2026-08-20T23:00:00;ring;1;-50;90;0;0"
    assert D.night_rates(hdr_only + "\n" + seven)[1] == {}
