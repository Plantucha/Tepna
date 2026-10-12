# tepna-capture — tests/test_capture_predicates.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE PURE DECISION PREDICATES — the go/no-go functions every poller in capture.py turns on.
#
# Mutation pass 2026-08-03. `capture.py` is the module the audit could never measure: 7 197 mutants, of
# which 69 had ever been run. Scoped to these 16 predicates it measured 230 mutants, 191 killed (83 %).
# What survived was not spread evenly — it clustered on BOUNDARIES (`>` vs `>=`, `> 0` vs `> 1`) and on
# SUBSTRINGS the assertions only partially read.
#
# These functions are pure and each one's docstring names the night it was written after. That makes the
# stakes concrete: a flipped comparison here does not raise, it silently power-cycles a working radio,
# refuses to correct a device clock, or declares a live stream dead.

import datetime as _dt

import capture
import pytest


# ── transient_ble_error: which failures are worth retrying ──────────────────────────────────────────
# `text = repr(exc).lower()`, so the two markers are matched against ALREADY-LOWERCASED text. Five
# mutants survived here: the `or` swapped to `and`, and each marker case-flipped or mangled. A
# case-flipped marker can NEVER match a lowercased string, so the refusal silently stops being detected
# and the session retries a protocol refusal until it surrenders.
@pytest.mark.parametrize("marker", ["not_implemented", "error 201"])
def test_a_protocol_refusal_beats_a_transient_looking_message(marker):
    """EITHER marker alone must refuse, and the text must ALSO carry a transient marker — otherwise the
    test cannot see the mutants at all.

    That is the subtlety these five survived on. `text = repr(exc).lower()`, so `"NOT_IMPLEMENTED"`
    can never match; the mutant simply falls through to the transient check. If the message contains no
    transient marker either, the fall-through ALSO returns False and the mutation is invisible. Only a
    message that is both a refusal AND transient-looking separates them — which is exactly the real
    case: the H10 answers SET_SYSTEM_TIME with `not_implemented` and then the link drops."""
    exc = RuntimeError(f"org.bluez.Error: {marker} — device disconnected")
    assert capture.transient_ble_error(exc) is False, \
        "a protocol refusal is not retried, however transient the rest of the message looks"
    # control: the same transient tail WITHOUT a refusal marker is retried, so the assertion above is
    # about the marker and not about the message being unmatched
    assert capture.transient_ble_error(RuntimeError("device disconnected")) is True


def test_a_genuinely_transient_error_is_still_retried():
    """The other arm, so the refusal check cannot be made unconditional."""
    assert capture.transient_ble_error(RuntimeError("le-connection-abort-by-local")) is True


# ── radio_looks_deaf: is the RECEIVER dead, or is nobody wearing the sensors ─────────────────────────
def test_hearing_even_one_advertisement_is_not_deafness():
    """`seen > 0` → `seen > 1`. One advertisement is proof the receiver receives; under the mutant a
    radio that heard something gets power-cycled anyway.

    The docstring's incident is the opposite failure — on 2026-07-30 hci0 read `UP RUNNING` with 332 MB
    of lifetime traffic while a 20 s scan saw ZERO advertisements, and ~20 min of a night was lost. The
    bar for calling a radio deaf is deliberately low, but 'heard exactly one' is on the working side."""
    assert capture.radio_looks_deaf(seen=1, connected_any=False, consecutive_silent=5) is False
    assert capture.radio_looks_deaf(seen=0, connected_any=False, consecutive_silent=2) is True


# ── the stall boundaries: exactly-at-the-grace is stalled ───────────────────────────────────────────
def test_a_stream_silent_for_exactly_the_grace_is_stalled():
    """`(now - last_change) >= grace` → `> grace`. The guard tears down a session after 90 s of TOTAL
    silence; at exactly 90 s the mutant waits another poll. Small, but it is the difference between the
    documented threshold and an undocumented one."""
    assert capture.stream_is_stalled(last_change=0.0, now=90.0, grace=90.0) is True
    assert capture.stream_is_stalled(last_change=0.0, now=89.9, grace=90.0) is False


def test_a_one_second_stall_grace_is_honoured_not_treated_as_off():
    """`grace > 0` → `grace > 1`. A grace of 1 s is a legal configuration (`stream.stall_sec`), and the
    mutant silently disables the whole stall guard for it — the guard whose absence let H10 ECG + ACC
    sit at ZERO ROWS for ten minutes behind a healthy link on 2026-07-19.

    (`grace >= 0` is EQUIVALENT and is expected to survive: `bool(grace and ...)` short-circuits on
    0 either way, so the two cannot be distinguished by any input.)"""
    assert capture.stream_is_stalled(last_change=0.0, now=5.0, grace=1) is True
    assert capture.any_stream_stalled(last_changes=[0.0], now=5.0, grace=1) is True
    assert capture.stream_is_stalled(last_change=0.0, now=5.0, grace=0) is False, "0 disables it"


# ── clock_resync_reason: whether a device clock gets corrected at all ────────────────────────────────
def test_a_clock_that_moved_by_exactly_the_jump_threshold_counts_as_a_jump():
    """`abs(skew - prev) >= jump` → `>`. 'jump' is the outcome that is ALWAYS corrected however many
    times we have failed before, because an H10 resets to its 2019 firmware default whenever it leaves
    the strap — so demoting a real jump to nothing is how a night gets stamped seven years early."""
    assert capture.clock_resync_reason(skew=5.0, prev=0.0, jump=5.0, tolerance=2.0) == "jump"
    assert capture.clock_resync_reason(skew=4.9, prev=0.0, jump=5.0, tolerance=10.0) is None


def test_a_skew_exactly_at_tolerance_is_within_tolerance():
    """`abs(skew) > tolerance` → `>=`. The threshold is the documented limit of acceptable drift; at
    exactly the limit the device is fine, and re-syncing it burns the give-up budget for nothing."""
    assert capture.clock_resync_reason(skew=2.0, prev=None, jump=5.0, tolerance=2.0) is None
    assert capture.clock_resync_reason(skew=2.1, prev=None, jump=5.0, tolerance=2.0) == "adrift"


def test_the_give_up_budget_starts_from_zero_failures():
    """`failed_adrift=0` → `1`. The default is what a caller that has never failed gets implicitly;
    starting the count at 1 spends part of the budget before the first attempt.

    Asserted BEHAVIOURALLY, not via `inspect.signature`: mutmut dispatches through a wrapper that keeps
    the original signature, so a signature-default mutation is invisible to introspection. Setting
    `giveup=1` is what makes the two defaults observable — 0 < 1 corrects, 1 < 1 does not."""
    assert capture.clock_resync_reason(skew=99.0, prev=None, jump=5.0, tolerance=2.0,
                                       giveup=1) == "adrift", "a first, never-failed attempt corrects"


def test_a_clock_we_have_repeatedly_failed_to_move_is_left_alone():
    """The give-up arm, so the budget cannot be made unreachable."""
    assert capture.clock_resync_reason(skew=99.0, prev=None, jump=5.0, tolerance=2.0,
                                       failed_adrift=capture.CLOCK_ADRIFT_GIVEUP) is None


# ── oxyii_rtc_due: the ring's write-only clock ──────────────────────────────────────────────────────
def test_the_drift_backstop_fires_exactly_at_the_interval():
    """`age >= resync_sec` → `>`. The ring cannot be asked what time it thinks it is, so this interval
    is the only thing standing between its RTC and unbounded drift."""
    now = _dt.datetime(2026, 8, 3, 12, 0, 0)
    at = now - _dt.timedelta(seconds=21600)
    assert capture.oxyii_rtc_due(at, now, False, 21600.0).startswith("drift backstop")
    just_under = now - _dt.timedelta(seconds=21599)
    assert capture.oxyii_rtc_due(just_under, now, False, 21600.0) is None


def test_the_drift_backstop_reports_the_age_in_hours():
    """`age / 3600` → `age * 3600` and `/ 3601`. The reason string is the operator's only readout of how
    stale the ring's clock was, and the assertion on it was `why.startswith("drift backstop")` — which
    cannot see the number at all."""
    now = _dt.datetime(2026, 8, 3, 12, 0, 0)
    at = now - _dt.timedelta(hours=7, minutes=30)
    assert capture.oxyii_rtc_due(at, now, False, 21600.0) == "drift backstop, 7.5 h since last"


# ── rebond_due: the cadence that must span a whole night ────────────────────────────────────────────
def test_a_cadence_of_one_means_every_reconnect_not_disabled():
    """`every <= 0` → `every <= 1`. `every=1` means 'try on every reconnect', a legal and deliberate
    configuration; the mutant reads it as 'disabled' and silently never re-bonds."""
    assert capture.rebond_due(needs_pmd=True, bonded=False, iteration=3, attempts=0,
                              every=1, limit=72) is True
    assert capture.rebond_due(needs_pmd=True, bonded=False, iteration=3, attempts=0,
                              every=0, limit=72) is False, "0 disables it"


# ── classify_adapter_health: the phantom link names the device ──────────────────────────────────────
def test_a_phantom_link_reason_names_the_device(recwarn):
    """Three mutants replaced `d.get('name')` with `d.get(None)` / `d.get('NAME')` in the phantom
    reason. They survived because the assertions read `"phantom BlueZ link" in h["reasons"][0]` — a
    SUBSTRING of one element, which is blind to the prefix.

    The prefix is the actionable half: the watchdog issues a targeted disconnect, and an operator
    reading `None: phantom BlueZ link` at 02:00 cannot tell which of three sensors is stuck."""
    devs = [{"name": "H10", "address": "AA:BB:CC:DD:EE:FF",
             "connected": False, "bluez_connected": True, "last_error": ""}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True
    assert h["reasons"] == ["H10: phantom BlueZ link"], "the whole reason, prefix included"
    assert h["phantom"] == ["AA:BB:CC:DD:EE:FF"]


# ── device_absent_error: ABSENT is not BUSY (2026-08-09) ─────────────────────────────────────────────
# `auto_sync_clock`'s 12-attempt ladder holds the GLOBAL _CONNECT_LOCK on every attempt, so spending it
# on a device the scan cannot see blocks every OTHER device's reconnect for nothing. Measured on the box
# with an H10 on a desk: 51 ops in 59.1 min, mean hold 41.1 s — a 59 % duty cycle. This predicate is what
# lets the ladder tell "waiting will help" from "waiting cannot help".

def test_device_not_found_is_absence():
    for msg in ("BleakDeviceNotFoundError: device not found",
                "bleak.exc.BleakDeviceNotFoundError",
                "Device not advertising"):
        assert capture.device_absent_error(Exception(msg)) is True, msg


def test_contention_is_NOT_absence():
    """The case the retry ladder exists for. If InProgress ever reads as absence, the 2026-07-18 bug
    returns: both Polars spent an evening unsynced because a restart's InProgress was treated as fatal."""
    for msg in ("org.bluez.Error.InProgress", "in progress", "resource temporarily unavailable",
                "not ready", "device busy"):
        assert capture.device_absent_error(Exception(msg)) is False, msg


def test_a_bare_timeout_is_NOT_absence():
    """Deliberate and worth pinning: a connect can time out against a device that is present but
    contended. Calling that 'absent' would surrender a sync the ladder should have waited out — the
    predicate is narrower than transient_ble_error on purpose, not by omission."""
    assert capture.device_absent_error(TimeoutError("connect timed out after 30s")) is False
    assert capture.transient_ble_error(TimeoutError("connect timed out after 30s")) is True


def test_absence_is_a_STRICT_SUBSET_of_transient():
    """Every absence signal must still be transient — the RECONNECT loop is right to keep looking for an
    out-of-range sensor. This fix changes who retries, not whether anyone does. If these ever diverge,
    the reconnect loop would stop chasing a device that merely walked out of range."""
    # STRUCTURAL, not example-based: check the token lists themselves, so a future edit that widens
    # absence beyond transient fails here rather than in the field.
    for tok in capture._ABSENT_BLE:
        assert tok in capture._TRANSIENT_BLE, f"{tok!r} is absent-but-not-transient"
    for msg in ("BleakDeviceNotFoundError", "not advertising"):
        assert capture.device_absent_error(Exception(msg)) is True, msg
        assert capture.transient_ble_error(Exception(msg)) is True, msg


def test_a_protocol_refusal_is_not_absence():
    assert capture.device_absent_error(Exception("error 201 NOT_IMPLEMENTED")) is False


# ── the retry log must name WHICH error it is retrying on (2026-08-09) ────────────────────────────────
@pytest.mark.tree_scan
def test_the_auto_sync_retry_line_logs_the_message_not_just_the_class():
    """A diagnostic gap that cost a wrong fix, so it is pinned rather than trusted.

    `BleakError` is bleak's catch-all for a dozen unrelated conditions — `device '<path>' not found`,
    `failed to connect: <cause>`, `br-connection-canceled`, adapter-missing — which need different
    responses. The line used to print only `type(e).__name__`, so the journal said `busy (BleakError)`
    for an hour and could not say which. #1062's absence predicate was aimed at a guessed string on the
    strength of that, and fires zero times on the live box.

    Asserted on the SOURCE because the alternative is asserting on a log record, and what matters is
    that the format string carries the payload at all."""
    import inspect
    src = inspect.getsource(capture.auto_sync_clock)
    line = next(l for l in src.splitlines() if "clock auto-sync busy" in l)
    assert "%s" in line.split("busy")[1], "the retry line must interpolate the error text"
    body = src[src.index("clock auto-sync busy"):]
    assert "repr(e)" in body[:400], "repr(e), not str(e) — str() on a bare BleakError can be empty"
    assert "[:160]" in body[:400] or "[:" in body[:400], "truncate: this runs up to 12x per ladder"


@pytest.mark.tree_scan
def test_the_deferred_line_names_the_reason_too():
    """Its sibling. An absence deferral that just said 'deferred' would rebuild the same blind spot."""
    import inspect
    src = inspect.getsource(capture.auto_sync_clock)
    line = next(l for l in src.splitlines() if "auto-sync deferred" in l)
    assert "device not found" in line


# ── _device_on_air: the three answers, and why None is one of them ───────────────────────────────────
def _run_coro(c):
    import asyncio as _a
    return _a.new_event_loop().run_until_complete(c)


def test_device_on_air_reports_found_and_not_found(monkeypatch):
    import types
    async def hci(): return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", hci)
    for found, want in ((object(), True), (None, False)):
        async def finder(addr, timeout=None, adapter=None, _f=found): return _f
        fake = types.SimpleNamespace(BleakScanner=types.SimpleNamespace(find_device_by_address=finder))
        monkeypatch.setitem(__import__("sys").modules, "bleak", fake)
        assert _run_coro(capture._device_on_air("AA:BB", 0.05)) is want


def test_device_on_air_returns_None_when_it_CANNOT_ASK(monkeypatch):
    """None is not False, and that distinction is the safety property: a scan that errors, an adapter
    that is busy, or a bleak that will not import must leave the caller doing what it did before. If
    this ever collapsed to False, one scan outage would silently stop every clock sync on the box."""
    import types
    async def hci(): return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", hci)
    async def boom(addr, timeout=None, adapter=None): raise RuntimeError("adapter busy")
    fake = types.SimpleNamespace(BleakScanner=types.SimpleNamespace(find_device_by_address=boom))
    monkeypatch.setitem(__import__("sys").modules, "bleak", fake)
    assert _run_coro(capture._device_on_air("AA:BB", 0.05)) is None
