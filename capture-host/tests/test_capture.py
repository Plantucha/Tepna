# tepna-capture — capture watchdog tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# The adapter watchdog's whole job is to auto-recover a WEDGED radio WITHOUT reacting to the benign
# 'sensors simply not worn' state — so its classifier is where that distinction must be locked down.
import capture   # importable with stdlib + local modules only (yaml/bleak/aiohttp are lazy/runtime)


def test_not_worn_is_benign():
    # clean 'not found' on every device, no phantom link, no InProgress → NOT a wedge (user took them off)
    devs = [
        {"name": "H10", "address": "AA", "connected": False,
         "last_error": "BleakDeviceNotFoundError('... was not found.')", "bluez_connected": False},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "O2Ring not advertising (wear it finger-in + close the phone app)", "bluez_connected": False},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False and h["reasons"] == [] and h["phantom"] == []


def test_inprogress_is_wedge():
    devs = [{"name": "H10", "address": "AA", "connected": False,
             "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
             "bluez_connected": False}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and "InProgress" in h["reasons"][0]


def test_phantom_link_is_wedge_and_names_address():
    # BlueZ says Connected: yes but our daemon has no link → stale phantom link (blocks re-advertise)
    devs = [{"name": "O2Ring", "address": "D1:98:62:7C:92:B3", "connected": False,
             "last_error": None, "bluez_connected": True}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and h["phantom"] == ["D1:98:62:7C:92:B3"]


def test_connected_device_not_flagged():
    # a device BlueZ-connected AND owned by the daemon (streaming) is healthy, not a phantom
    devs = [{"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False and h["phantom"] == []


def test_mixed_one_streaming_one_notworn_is_benign():
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "not advertising", "bluez_connected": False},
    ]
    assert capture.classify_adapter_health(devs)["wedged"] is False


def test_import_capture_needs_no_bleak():
    """`import capture` MUST work with stdlib + local modules only — the hardware-free CI has no bleak,
    yaml or aiohttp. Regression for 2026-07-18, when a top-level `import polar_psftp` (which imports
    bleak eagerly) turned the whole capture-host test job red; it passed locally only because the dev
    venv happens to have bleak installed. Runtime-only deps must be imported at their call site.

    Blocks the import via `sys.modules[name] = None`, which makes `import bleak` raise. (An earlier
    version of this test used a meta_path finder with find_module/load_module — an API REMOVED in
    Python 3.12 — so it blocked nothing and passed even with the bug present.)"""
    import subprocess
    import sys
    code = (
        "import sys\n"
        "for m in ('bleak', 'bleak.exc', 'bleak.backends', 'aiohttp', 'yaml'):\n"
        "    sys.modules[m] = None\n"
        "import capture\n"
        "print('ok')\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=".")
    assert r.returncode == 0, f"import capture pulled in a runtime-only dep:\n{r.stderr[-900:]}"


def test_inprogress_with_a_live_device_is_NOT_a_wedge():
    """MEASURED 2026-07-20: the churny O2Ring threw InProgress 22x while the H10 was streaming ECG. The
    watchdog read that lone InProgress as an ADAPTER wedge and power-cycled the radio 8x, dropping every
    link — a ~25 min self-inflicted outage. A single device's InProgress while ANOTHER is connected is
    device contention, not an adapter wedge: the radio is demonstrably working (it holds the other link)."""
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
         "bluez_connected": False},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False, "a lone InProgress while another device streams must NOT power-cycle"


def test_inprogress_with_NO_live_device_is_still_a_wedge():
    """The real-wedge case is preserved: InProgress while the radio serves NOBODY (no device connected)
    is a genuine adapter wedge and still triggers recovery — this is the 2026-07-18 saga the signal exists
    for. Only the 'a live link is present' case is downgraded to benign contention."""
    devs = [
        {"name": "H10", "address": "AA", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
         "bluez_connected": False},
        {"name": "O2Ring", "address": "BB", "connected": False, "last_error": "not advertising",
         "bluez_connected": False},
    ]
    assert capture.classify_adapter_health(devs)["wedged"] is True


def test_phantom_link_is_a_wedge_even_with_a_live_device():
    """The phantom-link signal is independent of the InProgress gate — a stale BlueZ link nobody can
    re-grab is a wedge regardless of whether another device is streaming."""
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False, "last_error": None, "bluez_connected": True},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and h["phantom"] == ["BB"]


# ── VIGIL-DEEP-ANALYSIS §2C — per-stream stall watchdog (a dead stream behind a live sibling) ──
def test_any_stream_stalled_catches_one_dead_stream_behind_a_live_one():
    now = 1000.0
    # ECG advanced 1 s ago (live), ACC last advanced 100 s ago (dead) — grace 90 s. The OLD collective
    # check reset a shared timer whenever ECG moved, so it never fired; per-stream catches ACC.
    assert capture.any_stream_stalled([now - 1, now - 100], now, 90.0) is True


def test_any_stream_stalled_false_when_all_recently_flowed():
    now = 1000.0
    assert capture.any_stream_stalled([now - 1, now - 2, now - 3], now, 90.0) is False


def test_any_stream_stalled_off_when_grace_zero_or_empty():
    assert capture.any_stream_stalled([500.0], 1000.0, 0) is False       # feature disabled
    assert capture.any_stream_stalled([], 1000.0, 90.0) is False          # nothing started
    assert capture.any_stream_stalled([None], 1000.0, 90.0) is False      # stream not started yet


# ── VIGIL-DEEP-ANALYSIS §2D — a connection-ceiling error is diagnosable, not "sensor off" ──
def test_connection_ceiling_error_is_recognised():
    assert capture.connection_ceiling_error(RuntimeError("org.bluez.Error.Failed: br-connection-profile-unavailable"))
    assert capture.connection_ceiling_error(Exception("Too many open connections"))


def test_connection_ceiling_error_ignores_an_ordinary_drop():
    assert not capture.connection_ceiling_error(TimeoutError("connect timed out"))
    assert not capture.connection_ceiling_error(RuntimeError("device disconnected"))


# ── on-charger auto-pull trigger (VIGIL-DEEP-ANALYSIS §2C — fast, event-driven vs the hourly cadence) ──
def test_charger_pull_due_fires_after_the_settle_window():
    # on charger 20 s, settle 15 s, not yet pulled → due
    assert capture.charger_pull_due(True, 1000.0, 1020.0, 15.0, False) is True


def test_charger_pull_not_due_before_the_settle_window():
    assert capture.charger_pull_due(True, 1000.0, 1010.0, 15.0, False) is False   # only 10 s on charger


def test_charger_pull_not_due_off_charger_or_not_armed():
    assert capture.charger_pull_due(False, 1000.0, 1020.0, 15.0, False) is False  # off the charger
    assert capture.charger_pull_due(True, None, 1020.0, 15.0, False) is False     # never went on charger


def test_charger_pull_only_once_per_charge_session():
    assert capture.charger_pull_due(True, 1000.0, 1020.0, 15.0, True) is False    # already pulled this session


# ── VIGIL-DEEP-ANALYSIS §2D — stronger adapter recovery (hci reset + gated USB rebind), never raises ──
import asyncio as _aio


def test_adapter_cmd_returns_true_on_success_and_never_raises(monkeypatch):
    class _P:
        async def wait(self): return 0
    async def fake_exec(*a, **k): return _P()
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    assert _aio.run(capture._adapter_cmd(["hciconfig", "hci0", "reset"])) is True


def test_adapter_cmd_swallows_a_missing_binary(monkeypatch):
    async def boom(*a, **k): raise FileNotFoundError("hciconfig")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    assert _aio.run(capture._adapter_cmd(["hciconfig", "hci0", "reset"])) is False   # graceful, no raise


def test_usb_rebind_writes_unbind_then_bind(monkeypatch):
    writes = []
    import builtins
    real_open = builtins.open
    def fake_open(path, *a, **k):
        if "/sys/bus/usb/drivers/usb" in str(path):
            class _F:
                def __enter__(s): return s
                def __exit__(s, *e): return False
                def write(s, v): writes.append((str(path).rsplit("/", 1)[-1], v))
            return _F()
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", fake_open)
    assert _aio.run(capture._usb_rebind("3-1")) is True
    assert writes == [("unbind", "3-1"), ("bind", "3-1")]


def _deny_sysfs(monkeypatch):
    """Make the direct unbind/bind write fail exactly as it does on the real box: EACCES, because the
    files are `--w------- root root` and the daemon is unprivileged."""
    import builtins
    real_open = builtins.open
    def deny(path, *a, **k):
        if "/sys/bus/usb" in str(path): raise PermissionError("EACCES")
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", deny)


def test_usb_rebind_is_graceful_when_sysfs_is_unwritable(monkeypatch):
    _deny_sysfs(monkeypatch)
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/nonexistent/" + n)
    assert _aio.run(capture._usb_rebind("3-1")) is False   # no raise on a dev box without the caps


def test_usb_rebind_falls_back_to_the_root_helper_when_sysfs_is_denied(monkeypatch):
    """THE FIX (VIGIL-OVERNIGHT-FINDINGS §P1.3, 2026-08-05). The direct write can never succeed on the
    real box, so before this fallback existed the last recovery rung was unreachable — and said so only
    at INFO, as "skipped". It now goes through the root-owned helper under `sudo -n`, exactly as the
    clock, RSSI and radio-restart rungs already do."""
    _deny_sysfs(monkeypatch)
    calls = []
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/usr/local/lib/tepna/" + n)
    monkeypatch.setattr(capture.os, "access", lambda p, m: True)
    async def fake_helper(*args, timeout=45):
        calls.append(args); return 0, "re-bound: 3-1 (2357:0604)"
    monkeypatch.setattr(capture, "_run_helper", fake_helper)
    assert _aio.run(capture._usb_rebind("3-1")) is True
    assert calls == [("sudo", "-n", "/usr/local/lib/tepna/tepna-btreset.sh", "3-1")]


def test_usb_rebind_reports_a_failing_helper_rather_than_claiming_success(monkeypatch):
    """A recovery that cannot run must not look like one that ran — the false-'healthy' shape that let a
    wedged adapter read as recovered 25+ times on 2026-07-23."""
    _deny_sysfs(monkeypatch)
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/usr/local/lib/tepna/" + n)
    monkeypatch.setattr(capture.os, "access", lambda p, m: True)
    async def fake_helper(*args, timeout=45): return 4, "cannot write (run as root)"
    monkeypatch.setattr(capture, "_run_helper", fake_helper)
    assert _aio.run(capture._usb_rebind("3-1")) is False


def test_usb_rebind_survives_a_raising_helper_path(monkeypatch):
    """`resolve()` cannot raise today, but the ladder must not turn an unresolvable helper into a
    traceback out of the watchdog — the same guard, and the same reasoning, as `_restart_radio`'s
    (test_radio_deafness.py). A recovery rung that raises takes the watchdog with it."""
    _deny_sysfs(monkeypatch)
    def boom(_n): raise RuntimeError("no such deploy root")
    monkeypatch.setattr(capture.helper_path, "resolve", boom)
    assert _aio.run(capture._usb_rebind("3-1")) is False


def test_usb_rebind_does_not_call_the_helper_when_the_direct_write_worked(monkeypatch):
    """A box that granted the capability must not pay a subprocess + sudo on every recovery."""
    called = []
    async def fake_helper(*args, timeout=45):
        called.append(args); return 0, ""
    monkeypatch.setattr(capture, "_run_helper", fake_helper)
    import builtins
    real_open = builtins.open
    def ok(path, *a, **k):
        if "/sys/bus/usb/drivers/usb" in str(path):
            class _F:
                def __enter__(s): return s
                def __exit__(s, *e): return False
                def write(s, v): pass
            return _F()
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", ok)
    assert _aio.run(capture._usb_rebind("3-1")) is True
    assert called == []


def test_a_connection_ceiling_is_NAMED_not_logged_as_a_generic_link_error():
    """⚠️ THE PREDICATE THAT COULD ALWAYS TELL THESE APART, AND WAS CALLED BY NOTHING.

    The comment above `_CEILING_SIGNS` says it outright — *"classify it so the log says 'adapter
    connection ceiling', not a generic link error"* — and all three link-error sites logged the generic
    form anyway. The two failures want OPPOSITE responses: a ceiling is over-provisioning you fix at the
    adapter, an absent sensor is a battery or a strap. `TimeoutError()` reads identically either way,
    which is VIGIL-DEEP-ANALYSIS §2D's complaint that an over-provisioned dongle looks like flapping
    sensors."""
    ceiling = capture.link_error_text(RuntimeError("org.bluez.Error.Failed: br-connection-profile-unavailable"))
    assert "ADAPTER CONNECTION CEILING" in ceiling
    assert "NOT an absent sensor" in ceiling
    plain = capture.link_error_text(TimeoutError("connect timed out"))
    assert "CEILING" not in plain and "link error:" in plain


def test_EVERY_link_error_site_routes_through_the_one_formatter():
    """Three sites, and a grep that stopped at the first two would have left the third drifting — which
    is exactly how the "a charging device cannot be on a body" rule came to be written twice with only
    one copy checking `charging`."""
    import io
    import tokenize
    from tests._srcscan import module_source
    src = module_source("capture.py")
    code = tokenize.untokenize([t for t in tokenize.generate_tokens(io.StringIO(src).readline)
                                if t.type != tokenize.COMMENT])
    assert 'log.warning("%s link error: %r", name, e)' not in code, (
        "a link-error site is still logging the unclassified form")
    # FOUR since the auto-pull drain's own handler joined them (2026-09-06). ⚠️ Note what this count
    # does and does not buy: it catches a formatter call being REMOVED, and it does not catch a NEW
    # site logging some other unclassified form — only the assertion above does that, and only for
    # the one form it names. The number is the weak half of this test; the `not in code` is the guard.
    assert code.count("link_error_text(e)") == 4, (
        "expected all four sites to route through the formatter, found %d"
        % code.count("link_error_text(e)"))


# ── NOT-WORN PULL TRIGGER (POLAR-ONBOARD-BACKUP-FOLLOWUPS §4) ────────────────────────────────
# The H10 runs on a CR2025 coin cell, so `charging` is permanently False and the on-charger trigger
# is unreachable for it. These pin the doff trigger that reaches it. Each DENY is paired with an
# ALLOW, so a predicate that simply never fires cannot pass.

# ── autopull_arming — one flag used to gate two triggers, and nothing said so ─────────────────────
# Measured on the box 2026-08-24: `auto-pull: armed` 0 occurrences vs 312 poller lines, no trigger
# ever fired. `on_charger: False` returned before arming, disabling the NOT-WORN trigger too — the
# only reachable trigger for a coin-cell device such as the H10.


def test_defaults_arm_the_two_settle_triggers_but_NOT_the_close_path():
    """Defaults arm charger and not-worn, and leave the §8/§14 close-triggered harvest OFF. `why` names
    it, because a flag that is off and unmentioned is the exact shape of the defect this function was
    written for — one layer along."""
    a = capture.autopull_arming({"auto": True})
    assert a["charger"] is True and a["doff"] is True
    assert a["close"] is False
    assert "on_close" in a["why"]


def test_a_pull_in_flight_DEFERS_the_power_drop():
    """The owner's 2026-08-26 amendment: the doff pull now fires INSIDE the power-drop grace, so the
    collision §4 prevented by clamping is resolved here by deferral. Dropping mid-pull would kill the
    transfer the drop was waiting for."""
    long_ago = 0.0
    assert capture.should_drop_not_worn(long_ago, 10_000.0, 180.0) is True, "control: it would drop"
    assert capture.should_drop_not_worn(long_ago, 10_000.0, 180.0, pull_in_flight=True) is False


def test_deferral_does_NOT_survive_the_pull():
    """Bounded, not indefinite. Once the pull clears its flag the drop proceeds on the next check —
    otherwise a coin-cell device never sleeps again and the amendment costs a battery instead of a
    grace window."""
    assert capture.should_drop_not_worn(0.0, 10_000.0, 180.0, pull_in_flight=False) is True


def test_the_configured_settle_IS_the_effective_settle():
    """🔴 The silent no-op, deleted. `max(cfg, _DROP_NOT_WORN_SEC + 30)` turned a configured 45 into an
    effective 210 while the config still read 45 — the signature defect in config form. A floor
    reintroduced here would pass every other test in this file."""
    import inspect
    src = inspect.getsource(capture.charger_pull_poller)
    assert "doff_settle = _doff_cfg" in src, "the configured value must apply unmodified"
    assert "max(_doff_cfg" not in src, "a silent floor is back — a config reading 45 would run 210"


def test_a_doff_pull_asks_for_LATEST_because_it_races_a_closing_window():
    """§14b measured which=all at p90 69.4 s against a window a doff pull cannot extend. latest is
    p90 31.1 s. The first production firing (2026-08-26 06:44:23) went out at `all`."""
    assert capture.pull_scope_for("not-worn") == "latest"


def test_a_charger_pull_still_sweeps_EVERYTHING():
    """A ring on a charger is awake and reachable indefinitely — no window to race, so the complete
    sweep is free. Narrowing this too would silently turn the charger trigger into a second `latest`
    and lose the catch-up it exists to provide."""
    assert capture.pull_scope_for("charger") == "all"


def test_a_PRESENCE_pull_asks_for_LATEST_because_it_races_the_SAME_window_as_a_doff():
    """A ring that advertised is awake and on its post-session tail — the closing window §14b measured
    `all` at p90 69.4 s against and found it could not make. The safe DEFAULT below is conservative
    about data loss, which is a different question from whether the pull FITS; a trigger that races a
    window must name itself in the scope table rather than inherit."""
    assert capture.pull_scope_for("presence") == "latest"


def test_an_UNKNOWN_trigger_sweeps_rather_than_narrowing():
    """The safe default is the COMPLETE scope: a narrow pull that misses a session loses data until
    the next poller lap, while a wide one merely costs link time. A new trigger added later without
    touching this function gets the conservative answer."""
    assert capture.pull_scope_for("something-new") == "all"


def test_on_close_NEVER_INHERITS_unlike_on_doff():
    """🔴 THE ASYMMETRY IS THE POINT, and it is not an inconsistency.

    `on_doff` inherits `on_charger` because it was SPLIT OUT of it and had to reproduce existing
    behaviour exactly on every host. `on_close` names a path that has never run anywhere, so there is
    no behaviour to preserve — and `pull.on_doff` is currently ENABLED on the box for the awake-tail
    measurement, so an inheriting `on_close` would switch the close-triggered harvest on at the next
    daemon restart. That is the silent deployed-behaviour change §7's Done-when forbids."""
    for cfg in ({"auto": True},
                {"auto": True, "on_charger": True},
                {"auto": True, "on_doff": True},
                {"auto": True, "on_charger": True, "on_doff": True}):
        assert capture.autopull_arming(cfg)["close"] is False, cfg


def test_on_close_arms_only_when_asked_explicitly():
    a = capture.autopull_arming({"auto": True, "on_close": True})
    assert a["close"] is True and "on_close" not in a["why"]


def test_auto_off_reports_every_trigger_off_including_close():
    """`pull.auto` is the master switch; a new trigger must not leak past it."""
    a = capture.autopull_arming({"auto": False, "on_close": True})
    assert a["charger"] is False and a["doff"] is False and a["close"] is False


def test_on_charger_false_no_longer_silently_kills_the_doff_trigger():
    """The split: after it, on_charger governs ONLY the charger trigger."""
    a = capture.autopull_arming({"auto": True, "on_charger": False, "on_doff": True})
    assert a["charger"] is False
    assert a["doff"] is True, "on_charger must not gate the not-worn trigger once split"


def test_on_doff_INHERITS_on_charger_so_deploying_changes_nothing():
    """🔴 THE BACK-COMPAT CONTRACT. Defaulting on_doff True would arm a never-executed path on the
    next auto-deploy; defaulting it False would disarm the doff trigger on every host that leaves
    on_charger at its default. Inheriting reproduces today's behaviour exactly on every host."""
    assert capture.autopull_arming({"auto": True, "on_charger": False})["doff"] is False
    assert capture.autopull_arming({"auto": True, "on_charger": True})["doff"] is True
    assert capture.autopull_arming({"auto": True})["doff"] is True


def _why_clause(arming: dict, flag: str) -> str:
    """The ONE `why` clause naming `flag`. `why` is a "; "-joined list of per-flag clauses, and asserting
    a word is absent from the WHOLE string silently couples every flag's wording to every other's —
    adding `on_close`, whose clause legitimately contains "never inherits", broke an assertion about
    `on_doff` that had nothing to do with it. Scope the assertion to the clause it is about."""
    return next((c for c in arming["why"].split("; ") if flag in c), "")


def test_the_reason_NAMES_the_governing_flag_and_its_value():
    """The defect was never that the flag was False — it was that nothing said so."""
    box = capture.autopull_arming({"auto": True, "on_charger": False})
    assert "pull.on_charger=False" in box["why"]
    assert "inherits" in _why_clause(box, "on_doff"), "an inherited default must say it was inherited"
    explicit = capture.autopull_arming({"auto": True, "on_charger": True, "on_doff": False})
    assert "pull.on_doff=False" in explicit["why"]
    assert "inherits" not in _why_clause(explicit, "on_doff"), "an explicit False is not inherited"


def test_auto_off_disarms_both_and_says_which_flag():
    a = capture.autopull_arming({"auto": False, "on_charger": True})
    assert a["charger"] is False and a["doff"] is False and a["why"] == "pull.auto is off"


def test_an_empty_config_does_not_arm():
    a = capture.autopull_arming({})
    assert a["charger"] is False and a["doff"] is False


def test_notworn_pull_due_fires_after_the_settle_window():
    # off the body 400 s, settle 300 s, not yet pulled → due
    assert capture.notworn_pull_due(False, 1000.0, 1400.0, 300.0, False) is True


def test_notworn_pull_not_due_before_the_settle_window():
    assert capture.notworn_pull_due(False, 1000.0, 1200.0, 300.0, False) is False


def test_notworn_pull_not_due_when_already_pulled_this_doff():
    # the ALLOW twin of the line above: identical inputs, only `already` differs
    assert capture.notworn_pull_due(False, 1000.0, 1400.0, 300.0, True) is False
    assert capture.notworn_pull_due(False, 1000.0, 1400.0, 300.0, False) is True


def test_notworn_pull_not_due_while_worn():
    assert capture.notworn_pull_due(True, 1000.0, 1400.0, 300.0, False) is False


def test_notworn_pull_treats_unknown_worn_as_NOT_a_doff():
    """`worn` is tri-state: None means NO VERDICT (no contact bit, no optical inference), and the
    device may still be on the body mid-recording. Falsy-testing instead of `is False` would pull
    against it — and would diverge from the `worn is not False` convention the power drop and
    `cpap_harvest.blocking_devices` both use."""
    assert capture.notworn_pull_due(None, 1000.0, 1400.0, 300.0, False) is False
    # ALLOW twin — the same call with an explicit False verdict DOES fire
    assert capture.notworn_pull_due(False, 1000.0, 1400.0, 300.0, False) is True


def test_notworn_pull_not_due_without_an_arming_timestamp():
    assert capture.notworn_pull_due(False, None, 1400.0, 300.0, False) is False


def test_notworn_settle_default_clears_the_power_drop_grace():
    """THE INVARIANT, not a preference. A pull holds a connection; `should_drop_not_worn` closes one.
    A doff settle inside the grace window would block the drop — the one thing §4 forbids. The default
    must clear it, and the poller clamps any config that does not."""
    assert 300.0 > capture._DROP_NOT_WORN_SEC
    # and the clamp the poller applies is strictly above the grace, not merely equal to it
    assert max(10.0, capture._DROP_NOT_WORN_SEC + 30.0) > capture._DROP_NOT_WORN_SEC

# ── the adapter lock: the scan must not overlap the connect (2026-08-26) ──────────────────────────


def _run_async(coro):
    """Drive one coroutine on a fresh loop (this file has no async fixtures)."""
    import asyncio as _aio
    return _aio.new_event_loop().run_until_complete(coro)


def test_the_SCAN_runs_under_the_adapter_lock(monkeypatch):
    """🔴 THE PLANTED CONTROL, and my first version of it was VACUOUS — it took `_CONNECT_LOCK` in the
    test body and asserted two scans serialised, which is true of any lock and says nothing about
    whether `_connect_scan` takes one.

    This drives `_connect_scan` itself and asserts INTERLEAVING: `[scan, scan]` back-to-back would
    mean they overlapped; `[scan, done, scan, done]` is only producible if the second waits.

    WHY IT MATTERS: before this, the scan ran OUTSIDE `_CONNECT_LOCK` while the connect ran inside —
    two operations needing the same adapter, one serialised and one not. That is what let a scan
    collide with the clock-sync path's adapter ops (Verity and H10 both threw InProgress from clock
    auto-sync at 06:40 and 06:42 on 2026-08-26)."""
    import asyncio as _aio
    import sys
    import types

    order = []

    async def _find(*a, **k):
        order.append("scan")
        await _aio.sleep(0.02)          # a real scan holds the adapter for a while
        order.append("done")
        return None                      # not found — the connect never runs, which is fine

    class _S:
        find_device_by_filter = staticmethod(_find)

    class _C:
        def __init__(self, *a, **k):
            pass

    fake = types.ModuleType("bleak")
    fake.BleakClient, fake.BleakScanner = _C, _S
    exc = types.ModuleType("bleak.exc")

    class _NF(Exception):
        def __init__(self, *a):
            pass

    exc.BleakDeviceNotFoundError, exc.BleakError = _NF, Exception
    monkeypatch.setitem(sys.modules, "bleak", fake)
    monkeypatch.setitem(sys.modules, "bleak.exc", exc)

    async def _no_kw():
        return {}
    monkeypatch.setattr(capture, "adapter_kw", _no_kw)
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", False)

    async def _attempt():
        try:
            async with capture._connect_scan("AA:BB:CC:DD:EE:FF", timeout=0.05):
                pass
        except Exception:
            pass   # the connect is EXPECTED to fail with no radio; what is under test is the
                   # state the context manager leaves behind, asserted after this block

    async def _both():
        await _aio.gather(_attempt(), _attempt())

    _run_async(_both())
    assert order == ["scan", "done", "scan", "done"], f"scans overlapped on the adapter: {order}"



# ── §7's third done-when: the arming diagnostic must be proven in BOTH directions ─────────────────
# OXYII-DAT-AUTO-HARVEST-REFINEMENT §7 asks for "a control [that] proves the diagnostic fires in both
# directions — the absent-line failure cannot recur". Both LINES exist (`auto-pull: armed` and
# `auto-pull: NOT armed`, each naming its governing flags); until now nothing asserted either.
#
# That gap is the same shape as the defect the lines were added for. The original failure was an
# ABSENCE — measured on the box 2026-08-24, `auto-pull: armed` appeared 0 times against 312 poller
# lines — and an absence is what an unasserted log line degrades back into the moment someone edits
# the branch above it. A test on `autopull_arming()` alone cannot see that: it checks the decision,
# not that the decision is ever SAID.
#
# Paired deliberately. A one-directional test passes just as well against a diagnostic that prints
# the same string unconditionally, which is the failure mode that would hide a wrongly-armed poller.
_PULL_DEV = {"name": "Wellue O2Ring-S", "vendor": "Wellue", "model": "O2Ring",
             "device_id": "S8AW2100", "address": "AA:BB:CC:DD:EE:FF"}


def _run_poller_once(cfg, caplog):
    """Emit the arming line and stop. The line is logged BEFORE `while not _STOP.is_set()`, so a
    pre-set stop flag yields exactly one pass with no sleeping and no device I/O."""
    was_set = capture._STOP.is_set()
    capture._STOP.set()
    try:
        with caplog.at_level("INFO"):
            _aio.run(capture.charger_pull_poller(cfg, "/tmp"))
    finally:
        if not was_set:
            capture._STOP.clear()
    return caplog.text


def test_the_autopull_arming_line_fires_when_ARMED(caplog):
    text = _run_poller_once({"pull": {"auto": True}, "devices": [_PULL_DEV]}, caplog)
    assert "auto-pull: armed" in text, f"the armed half never printed: {text!r}"
    # ...and it names the governing flags with their values, which is what makes it actionable.
    assert "charger=" in text and "not-worn=" in text


def test_the_autopull_arming_line_fires_when_NOT_ARMED(caplog):
    text = _run_poller_once(
        {"pull": {"auto": True, "on_charger": False, "on_doff": False, "on_close": False},
         "devices": [_PULL_DEV]},
        caplog,
    )
    assert "auto-pull: NOT armed" in text, f"the NOT-armed half never printed: {text!r}"
    assert "armed —" not in text.replace("NOT armed", ""), "the two halves must be exclusive"

# ⚠️ NO THIRD LINE FOR "armed, but nothing eligible" — and this is a DECISION, not an omission.
# Writing this control I hit that silent path (`if not devices: return`) and started to name it, on
# the reasoning that silence there is indistinguishable from a poller that never started. That is
# already answered: `test_the_charger_poller_returns_when_no_device_can_be_pulled` pins the silence
# deliberately — "a fleet of Muse headbands has no onboard recording to fetch; arming a poller with
# nothing to poll would log 'armed — pulling 0 device(s)', which is worse than silence."
# Recorded here because I re-derived the question and the answer already existed one test file over,
# which is the cost this repo keeps paying. The gate caught the contradiction: my line reddened THEIR
# assertion, which is what a deliberate decision defended by a test is supposed to do.
