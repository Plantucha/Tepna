# tepna-capture — tests/test_webmon_state_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`GET /api/state` — the WHOLE body, field by field.

`/api/state` is the monitor's only source of truth: every card, dot and number in `monitor.html` is a
field of this response, and the daemon is the only writer. The tests next door assert a handful of them
(`name`, `connected`, `battery`, `rssi`, `link_epoch`) and prove the projection works. What they leave
free is every OTHER key — and the mutation audit measured the size of that gap: 50 surviving mutants in
`_remembered` alone, each one renaming a `status` lookup so the field silently becomes `null`.

That failure is invisible from the daemon's side. Nothing raises; the key is simply absent from the
dict `status` publishes, `.get()` answers `None`, and the card renders empty as though the device had
never reported. `worn`, `charging`, `clock_skew_sec` and `pull_progress` are exactly the fields where an
empty reading is indistinguishable from a real one.

So this asserts the projection as a CONTRACT: the exact key set, and every value round-tripped from a
status block where no two fields share a value — because a test whose fixture uses `True` twice cannot
tell two transposed fields apart.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_webmon_api import _mk, _serve, telemetry, webmon  # noqa: E402

# Every value distinct, and distinct from the CONFIG values below — a transposition has to change
# something for a test to be able to see it.
FULL_STATUS = {
    "presence": "pres_present",
    "presence_reason": "2 sightings >= 2",
    "presence_witness": "stops at probe_attempted (3/10)",
    "connected": True,
    "battery": 88,
    "rssi": -55,
    "clock_synced": True,
    "device_time": "2026-08-02 14:31:07",
    "clock_skew_sec": -1.25,
    "pull_progress": {"done": 3, "total": 7, "pct": 42},
    "link_epoch": 7,
    "worn": True,
    "worn_why": "worn per hr-contact-bit",
    "worn_optical": False,
    "worn_optical_why": "not worn per ambient-stability",
    "charging": True,
    "last_error": "gatt write failed",
    # The ring's readable clock + gated settings (2026-08-19) — values distinct from everything above.
    "ring_rtc_offset_s": -1.3,
    "ring_rtc_read": "2026-08-19T21:56:12",
    "ring_config": {"brightness": 2, "motor": 61},
    "ring_config_verdict": "brightness=2 applied",
    "ring_buzz_at": "2026-08-19T22:41:03.117",
    "ring_rtc_reset_suspect": "2026-08-20T05:02:11",
}

DEV = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678",
       "device_id_aliases": ["1234-5678"], "name_aliases": ["Polar H10 12345678"],
       "address": "AA:BB:CC:DD:EE:FF", "streams": ["ecg", "acc"], "rates": {}}

# The projection's key set, in full. `rates` is deliberately NOT here: it is a config-only concern the
# monitor does not render, and adding it would be a new contract rather than an assertion about this one.
DEVICE_KEYS = {
    "name", "vendor", "model", "device_id", "device_id_aliases", "name_aliases", "address", "streams",
    "connected", "battery", "rssi", "clock_synced", "device_time", "clock_skew_sec", "pull_progress",
    "link_epoch", "worn", "worn_why", "worn_optical", "worn_optical_why", "charging", "last_error",
    "clock_uncorrectable", "rate_unmet",
    # How many of this device's flushes to disk have FAILED. Declared here rather than by relaxing
    # the assertion, per the note below: a write-failing device looks healthy on every other field —
    # link up, rows climbing, rate nominal — so this is the only one that can say the night is being
    # lost. Zero on a healthy device; absent (None) before the daemon has reported.
    "flush_failures",
    "clock_uncorrectable", "last_sample",
    # The ring's readable clock + gated settings (2026-08-19): the RTC-vs-host offset (GET_INFO [24:31]),
    # when it was read, the ring's own 0x00-read-back settings struct, and the last write's verdict.
    "ring_rtc_offset_s", "ring_rtc_read", "ring_config", "ring_config_verdict", "ring_buzz_at",
    "ring_rtc_reset_suspect",
    # The O2Ring PRESENCE axis and its §19 EXECUTION WITNESS (O2RING-AUTONOMOUS-HARVEST §19/§20).
    # Added to this contract DELIBERATELY rather than by relaxing the assertion: the key set IS the
    # monitor's contract, and §20 exists because a field that reaches `/api/state` and no further is
    # not exposed to anybody. `presence_witness` is the load-bearing one — it names where the §19
    # chain STOPS, so an armed-but-never-executed path cannot render as healthy.
    "presence", "presence_reason", "presence_witness",
}


def _state(tmp_path, devices, status):
    app, *_ = _mk(tmp_path, devices=devices, status=status)

    async def go(c):
        return await (await c.get("/api/state")).json()
    return _serve(app, go)


def test_a_device_projects_every_field_it_promises(tmp_path):
    d = _state(tmp_path, [DEV], {"H10": FULL_STATUS})["devices"][0]
    assert set(d) == DEVICE_KEYS, "the device projection's key set is the monitor's contract"
    # config half
    assert d["name"] == "H10" and d["vendor"] == "Polar" and d["model"] == "H10"
    assert d["device_id"] == "12345678"
    assert d["device_id_aliases"] == ["1234-5678"]
    assert d["name_aliases"] == ["Polar H10 12345678"]
    assert d["address"] == "AA:BB:CC:DD:EE:FF"
    assert d["streams"] == ["ecg", "acc"]
    # live half — every one read from `status`, and every one a field the UI renders
    assert d["connected"] is True
    assert d["battery"] == 88
    assert d["rssi"] == -55
    assert d["clock_synced"] is True
    assert d["device_time"] == "2026-08-02 14:31:07"
    assert d["clock_skew_sec"] == -1.25
    assert d["pull_progress"] == {"done": 3, "total": 7, "pct": 42}
    assert d["link_epoch"] == 7
    assert d["worn"] is True
    # PROVENANCE, not just the verdict. `worn` alone is a bare tri-state: on 2026-08-13 a desk
    # armband read True from its HR contact bit for ten hours with nothing saying where that came
    # from, or that the optical detector disagreed. These three must ARRIVE — a field published into
    # STATUS but not forwarded here is not published at all, and that failure is silent both ways.
    assert d["presence"] == "pres_present"
    assert d["presence_reason"] == "2 sightings >= 2"
    assert d["presence_witness"] == "stops at probe_attempted (3/10)", (
        "the witness must arrive as the SENTENCE, not as a chain the reader has to audit")
    assert d["worn_why"] == "worn per hr-contact-bit"
    assert d["worn_optical"] is False, "the disagreeing opinion must reach the monitor, not just the log"
    assert d["worn_optical_why"] == "not worn per ambient-stability"
    assert d["charging"] is True
    assert d["last_error"] == "gatt write failed"
    # The ring's clock and settings read-backs: published into STATUS by the oxyii session, and — the
    # rule this file exists to enforce — forwarded here or not published at all.
    assert d["ring_rtc_offset_s"] == -1.3
    assert d["ring_rtc_read"] == "2026-08-19T21:56:12"
    assert d["ring_config"] == {"brightness": 2, "motor": 61}
    assert d["ring_config_verdict"] == "brightness=2 applied"
    assert d["ring_buzz_at"] == "2026-08-19T22:41:03.117"
    assert d["ring_rtc_reset_suspect"] == "2026-08-20T05:02:11"


def test_an_unreported_device_yields_nulls_not_missing_keys(tmp_path):
    """The empty case must have the SAME shape. A card that reads a key the response never sent gets
    `undefined`, which renders identically to a real null — so the absence has to be impossible, not
    merely unlikely."""
    d = _state(tmp_path, [DEV], {})["devices"][0]
    assert set(d) == DEVICE_KEYS
    assert d["connected"] is False, "never reported is a definite NO, not unknown"
    assert d["charging"] is False
    for k in ("battery", "rssi", "clock_synced", "device_time", "clock_skew_sec", "pull_progress",
              "link_epoch", "worn", "last_error"):
        assert d[k] is None, f"{k} must be null when the device has never reported"


def test_status_is_matched_to_a_device_by_NAME_not_by_position(tmp_path):
    """`status['devices']` is keyed by device name. Two configured devices with one status block between
    them is the case that catches a positional read — the unreported one must not inherit the other's
    battery and dot."""
    ring = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
            "address": "D1:98:62:7C:92:B3", "streams": ["spo2"], "rates": {}}
    devs = _state(tmp_path, [DEV, ring], {"Ring": FULL_STATUS})["devices"]
    by_name = {d["name"]: d for d in devs}
    assert by_name["Ring"]["battery"] == 88 and by_name["Ring"]["connected"] is True
    assert by_name["H10"]["battery"] is None and by_name["H10"]["connected"] is False


def test_the_top_level_blocks_are_projected_verbatim(tmp_path):
    """Each of these is a whole UI panel, and each is null until its poller has run once. Reading the
    wrong status key gives a permanently-empty panel with nothing logged — the same silent shape as the
    per-device fields above."""
    # `_mk` only threads `devices` into status, so build the app directly to set the sibling blocks.
    # Every value distinct, so a lookup reading the wrong key cannot land on the right answer.
    st = {"devices": {},
          "host_clock": {"source": "chrony", "stratum": 1},
          "storage": {"free_gb": 83.4},
          "qc": {"nights": 3},
          "host": {"started_at": 1750000000},
          "archive": {"verified": True},
          "cpap": {"state": "ok", "files": 5}}
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": [dict(DEV)]}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)

    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    assert body["adapter"] == "AA:AA:AA:AA:AA:AA"
    assert body["host_clock"] == {"source": "chrony", "stratum": 1}
    assert body["storage"] == {"free_gb": 83.4}
    assert body["qc"] == {"nights": 3}
    assert body["host"] == {"started_at": 1750000000}
    assert body["archive"] == {"verified": True}
    assert body["cpap"] == {"state": "ok", "files": 5}
    assert set(body) == {"adapter", "devices", "streams", "host_clock", "storage", "qc", "host",
                         # `alerts` is the ALERT TRANSPORT's own health, not an alert. It belongs on
                         # this surface because every other block here is designed to reach the
                         # operator by webhook, so a webhook that silently stops turns each of them
                         # into "found out next week" — the transport has to be as visible as what it
                         # guards. Three states, kept apart: delivered / unproven / failing.
                         # `cpap_live` is DELIBERATELY a sibling of `cpap` rather than a key inside
                         # it. Merging them was tried first and this very assertion caught it — the
                         # verbatim rule above is the guard, and the right response was a new block,
                         # not a relaxed contract. The two answer different questions: `cpap` counts
                         # harvested FILES on a daily timer, `cpap_live` reads the AS11 shadow
                         # detector and is aged at SERVE time.
                         "archive", "cpap", "cpap_live", "alerts",
                         # Per-device reconnect distress. Declared here rather than by relaxing the
                         # assertion, per the rule above — and it is the second half of a fix whose
                         # first half was that this block reached STATUS and no projection at all,
                         # so nothing rendered it and nothing could.
                         "radio_distress"}


def test_the_top_level_blocks_are_null_before_their_pollers_run(tmp_path):
    body = _state(tmp_path, [DEV], {})
    for k in ("host_clock", "storage", "qc", "host", "archive", "cpap", "alerts"):
        assert k in body, f"{k} must be present-and-null, never absent"
    for k in ("storage", "qc", "host", "archive", "cpap"):
        assert body[k] is None


def test_clock_uncorrectable_REACHES_the_monitor(tmp_path):
    """⚠️ A VERDICT WITH NO CONSUMER IS NOT PUBLISHED, which is what this field was until now.

    `capture.py` sets `clock_uncorrectable` when the clock watchdog exhausts its give-up budget and
    retracts it on the next successful sync — behaviour pinned by 7 tests. Nothing read it: not this
    projection, not `alerts`, not `nightqc`, not the monitor. For a suite whose Clock Contract rests on
    device time being trustworthy, a night captured under an uncorrectable clock was downstream
    indistinguishable from a good one.

    This asserts the forwarding, which is the half that fails silently — the comment beside `worn_why`
    in `webmon.py` says exactly why: a field that exists in STATUS but is not forwarded here is NOT
    published, and it fails silently in both directions."""
    body = _state(tmp_path, [{"name": "H10", "address": "AA"}],
                  {"H10": {"connected": True, "clock_uncorrectable": True}})
    assert body["devices"][0]["clock_uncorrectable"] is True, body["devices"][0]


def test_a_RETRACTED_uncorrectable_verdict_reaches_the_monitor_too(tmp_path):
    """The retraction is the half that matters operationally: a device written off while docked, then
    synced cleanly once off the dock, must stop reading as uncorrectable. Forwarding only the True case
    would leave a stale red pill that nothing could clear."""
    body = _state(tmp_path, [{"name": "H10", "address": "AA"}],
                  {"H10": {"connected": True, "clock_uncorrectable": False}})
    assert body["devices"][0]["clock_uncorrectable"] is False, body["devices"][0]


def test_a_device_that_never_reported_gets_None_not_a_fabricated_False(tmp_path):
    """Absent is not the same as "correctable", and the suite's own honesty rule applies: an unknown
    must stay visible as unknown rather than being defaulted into a reassuring answer."""
    body = _state(tmp_path, [{"name": "H10", "address": "AA"}], {"H10": {"connected": True}})
    assert body["devices"][0]["clock_uncorrectable"] is None, body["devices"][0]


def test_rate_unmet_REACHES_the_monitor(tmp_path):
    """⚠️ THE FIELD WHOSE OWN LOG LINE SAID NOBODY WOULD SEE IT.

    `capture.py` warns "configured rate %s Hz was NOT offered by the device — capturing at %s Hz
    instead … The config still says %s; nothing else will tell you it did not happen", then publishes
    `rate_unmet` so something CAN tell you. Nothing read it, so the sentence was literally true.

    It is not cosmetic: the config keeps claiming the rate that was asked for, so a Verity negotiated
    down from 176 Hz to 55 Hz produces a materially different recording that looks correctly configured
    for as long as anyone reads the config instead of this field."""
    body = _state(tmp_path, [{"name": "Verity", "address": "AA"}],
                  {"Verity": {"connected": True,
                              "rate_unmet": {"ppg": {"want": 176, "got": 55}}}})
    got = body["devices"][0]["rate_unmet"]
    assert got == {"ppg": {"want": 176, "got": 55}}, body["devices"][0]


def test_a_device_that_got_every_rate_it_asked_for_reports_None(tmp_path):
    """Absent is not "negotiated down to something" — the honest empty, not a fabricated one."""
    body = _state(tmp_path, [{"name": "Verity", "address": "AA"}], {"Verity": {"connected": True}})
    assert body["devices"][0]["rate_unmet"] is None


def test_cpap_live_is_its_OWN_block_and_leaves_cpap_verbatim(tmp_path):
    """`cpap_live` answers "is therapy running NOW"; `cpap` counts harvested FILES. Two facts about one
    machine, two blocks — and merging them was tried first and broke
    `test_the_top_level_blocks_are_projected_verbatim` above, which is exactly the guard that contract
    exists to be. The verbatim rule wins; the new fact gets its own key."""
    st = {"devices": {}, "cpap": {"state": "ok", "files": 5, "therapy": True,
                                  "fg_state": "Therapy", "detector_host_ms": 1000.0}}
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": [dict(DEV)],
           "as11_detector": {"poll_interval_sec": 30}}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)

    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    # `cpap` is untouched — no `live` key smuggled in
    assert body["cpap"] == {"state": "ok", "files": 5, "therapy": True,
                            "fg_state": "Therapy", "detector_host_ms": 1000.0}
    live = body["cpap_live"]
    assert set(live) == {"state", "therapy", "age_s", "stale_after_s", "fresh"}
    assert live["stale_after_s"] == 90.0, "the threshold must come from the configured poll interval"
    # The stamp is from 1970 in host-ms terms, so the reading is ancient: unknown, with its age shown.
    assert live["state"] == "unknown" and live["fresh"] is False
    assert live["age_s"] is not None, "the age must be reported even when the reading is stale"


def test_cpap_live_is_null_rather_than_absent_when_there_is_no_cpap_block(tmp_path):
    """A missing key and a null are different to a consumer; the other blocks are null-until-polled and
    this one matches them."""
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": [dict(DEV)]}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", {"devices": {}}, None)

    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    assert "cpap_live" in body and body["cpap_live"] is None


def test_a_broken_live_view_omits_the_block_rather_than_taking_the_endpoint_down(tmp_path, monkeypatch):
    """`cpap_live` is a DIAGNOSTIC OVERLAY, not a participant. If it throws, the state endpoint must
    still serve — every other panel on the monitor depends on this response, and losing the whole page
    because a freshness helper raised would be a far worse outcome than a missing sub-block.

    Pinned because the failure is silent by construction: the except branch returns None, which is the
    same value as "no cpap block at all", so nothing downstream can tell the two apart. The log line
    is the only signal, and an untested except branch is one nobody knows is reachable."""
    import cpap_live

    def _boom(*a, **k):
        raise RuntimeError("live view exploded")
    monkeypatch.setattr(cpap_live, "live_view", _boom)
    st = {"devices": {}, "cpap": {"state": "ok", "files": 5}}
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": [dict(DEV)]}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)

    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    assert body["cpap_live"] is None, "a throwing overlay must degrade to null"
    assert body["cpap"] == {"state": "ok", "files": 5}, "the harvest block must survive untouched"
    # `devices` is built by `_remembered()` from the CONFIG, not echoed from the status dict — my
    # first version of this assertion compared it against the raw `{}` and failed, which was the test
    # being wrong rather than the code. What matters here is only that the endpoint still SERVED.
    assert isinstance(body["devices"], list) and "streams" in body, "the rest of the endpoint must still serve"
