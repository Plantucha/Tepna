

# ── clock-sync resilience (2026-07-18) ─────────────────────────────────────────────────────────────
# A daemon restart leaves the previous BLE connection tearing down, so the first sync attempt routinely
# hits org.bluez.Error.InProgress. That was treated as fatal, so BOTH Polars spent an evening with
# clock_synced unset — while their clocks were, by measurement, correct to 0.03 s.

def test_transient_ble_errors_are_retried_not_surrendered():
    import capture
    for msg in ("BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
                "BleakDeviceNotFoundError('O2Ring not advertising')",
                "org.bluez.Error.NotReady", "TimeoutError()", "org.bluez.Error.Busy"):
        assert capture.transient_ble_error(Exception(msg)), msg


def test_a_real_protocol_refusal_is_NOT_retried():
    """The H10 implements neither GET_LOCAL_TIME nor SET_SYSTEM_TIME and answers error 201
    NOT_IMPLEMENTED. Retrying that 12 times would just waste the offline slot every startup."""
    import capture
    assert not capture.transient_ble_error(Exception("error 201 NOT_IMPLEMENTED"))
    assert not capture.transient_ble_error(Exception("PsFtpError: NOT_IMPLEMENTED"))
    assert not capture.transient_ble_error(ValueError("bad payload"))
    # PRECEDENCE, and this is the assertion that actually gates the guard: the two plain messages above
    # contain no transient marker, so they return False whether or not the NOT_IMPLEMENTED check exists
    # — deleting it leaves them passing. Only a message carrying BOTH signals proves which one wins.
    assert not capture.transient_ble_error(
        Exception("org.bluez.Error.InProgress while reporting error 201 NOT_IMPLEMENTED"))
    assert capture.transient_ble_error(Exception("org.bluez.Error.InProgress"))  # control


def test_clock_tolerance_is_tight_vs_an_unsynced_device_loose_vs_a_healthy_one():
    """A healthy synced Polar measured 0.03 s; an unsynced H10 sits at its 2019 default (years out).
    The tolerance must separate those without flapping on normal jitter."""
    import capture
    assert 0.03 < capture.CLOCK_TOLERANCE_S < 60


# ── host clock provenance ──────────────────────────────────────────────────────────────────────────
# The box pushes its own time into all three sensors, so an undisciplined host clock yields a night that
# is SELF-CONSISTENTLY wrong: PAT still works (common base), absolute time does not, and every pill
# stays green. classify() is the pure core of that judgement, so it is the thing worth gating.

def _st(**over):
    base = {"available": True, "ntp_enabled": True, "synchronized": True, "stratum": 1,
            "reference": "PPS", "server": "192.168.0.123", "ignored": False}
    base.update(over)
    return base


def test_a_real_stratum1_pps_source_is_trusted():
    import host_clock
    v = host_clock.classify(_st())
    assert v["trust"] == "disciplined" and v["absolute_ok"] is True


def test_unsynchronised_is_holdover_not_trusted():
    """The 'no internet' case the RTC discussion is about: NTP configured, never reached. The clock is
    free-running and CANNOT know how far out it is."""
    import host_clock
    v = host_clock.classify(_st(synchronized=False))
    assert v["trust"] == "holdover" and v["absolute_ok"] is False


def test_a_REFUSED_ntp_reply_is_not_a_sync():
    """systemd reports Ignored=yes when it got a reply but rejected it (root distance too large). Every
    other field still looks healthy, which is exactly why this must be checked explicitly."""
    import host_clock
    v = host_clock.classify(_st(ignored=True))
    assert v["absolute_ok"] is False


def test_unreadable_state_is_NOT_treated_as_healthy():
    """Absence of evidence is not evidence of health — the whole point of the layer.

    NOTE the third assertion, and why the first two do not gate anything on their own: {} and
    {"available": False} also lack ntp_enabled, so the NEXT guard rejects them and the test passes even
    with the availability check deleted (caught by mutation, 2026-07-18). A guard shadowed by a later
    guard is untested until you construct the case where ONLY it applies — here, a state that claims
    perfect health while admitting we could not actually read it. That must still fail CLOSED."""
    import host_clock
    assert host_clock.classify({"available": False})["absolute_ok"] is False
    assert host_clock.classify({})["absolute_ok"] is False
    looks_perfect_but_unread = _st(available=False)     # synchronized, stratum 1, PPS ... yet unreadable
    assert host_clock.classify(looks_perfect_but_unread)["absolute_ok"] is False
    assert host_clock.classify(looks_perfect_but_unread)["trust"] == "unknown"


def test_an_absurd_stratum_is_rejected():
    import host_clock
    assert host_clock.classify(_st(stratum=15))["absolute_ok"] is False   # 15 = unsynchronised, RFC 5905
    assert host_clock.classify(_st(stratum=0))["absolute_ok"] is False
    assert host_clock.classify(_st(stratum=4))["absolute_ok"] is True     # boundary stays trusted


def test_ntp_disabled_entirely_is_holdover():
    import host_clock
    assert host_clock.classify(_st(ntp_enabled=False))["trust"] == "holdover"


def test_ntp_message_parser_reads_the_real_systemd_line():
    """Verbatim from this host (2026-07-18) — the format is the contract."""
    import host_clock
    m = host_clock.parse_ntp_message(
        "{ Leap=0, Version=4, Mode=4, Stratum=1, Precision=-19, RootDelay=0, "
        "RootDispersion=1.113ms, Reference=PPS, OriginateTimestamp=Sat 2026-07-18 18:04:29 EDT, "
        "Ignored=no, PacketCount=16, Jitter=170us }")
    assert m["Stratum"] == "1" and m["Reference"] == "PPS" and m["Ignored"] == "no"
    assert host_clock._num(m["RootDispersion"]) == 1.113
    assert host_clock._num(m["Jitter"]) == 170.0
    assert host_clock._num(None) is None            # absent stays None, never a fabricated 0
