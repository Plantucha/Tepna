

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
