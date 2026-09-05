# tepna-capture — tests/test_bonding.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The bluetoothctl wrapper. A Polar H10 REFUSES PMD on an unauthenticated link and drops ~1-2 s after
# connect, so a correct bond is the difference between a night of ECG and a night of nothing. All of the
# logic here is text-scraping a CLI whose output format is not a contract, which is exactly why it needs
# tests: the failure mode is a silent misparse (a device reported unbonded forever, or a failed pair
# reported as success), not an exception.
#
# _btctl / _delayed_script are the only subprocess surface; both are stubbed, so no BlueZ is touched.

import asyncio

import pytest

import bonding

DEVICES_OUT = """\
Device AA:BB:CC:DD:EE:FF Polar H10 02849638
Device 11:22:33:44:55:66 Polar Verity Sense 0C301E3F
Device 99:88:77:66:55:44 Some Random Speaker
Device AA:BB:CC:DD:EE:FF Polar H10 02849638
"""

INFO_BONDED = """\
Device AA:BB:CC:DD:EE:FF (public)
\tName: Polar H10 02849638
\tPaired: yes
\tBonded: yes
\tConnected: yes
\tRSSI: 0xffffffc8 (-56)
"""

INFO_FRESH = """\
Device 11:22:33:44:55:66 (public)
\tName: Polar Verity Sense
\tPaired: no
\tBonded: no
\tConnected: no
\tRSSI: 0xffffffb0 (-80)
"""


@pytest.fixture(autouse=True)
def _no_real_bluez(monkeypatch):
    """This box HAS bluetoothctl and the CI runner does not, so a test that forgets to stub a subprocess
    entry is green here and red there — which is how two tests below shipped reaching the real binary
    (#937). `scan()` has TWO entries, `_delayed_script` and `_btctl`; stubbing one is not stubbing it.
    A test that means to drive the exec itself patches it after this fixture, so its own setattr wins."""
    async def _forbidden(*argv, **kw):
        raise AssertionError(
            f"a bonding test reached the real bluetoothctl ({argv!r}) — use _stub(), which patches "
            "BOTH _delayed_script and _btctl")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _forbidden)


def _run(coro):
    return asyncio.run(coro)


def _stub(monkeypatch, *, delayed="", info_by_addr=None, record=None):
    async def fake_delayed(lines):
        if record is not None:
            record.extend(lines)
        return delayed

    async def fake_btctl(script, timeout=20.0):
        if record is not None:
            record.append(script)
        for addr, out in (info_by_addr or {}).items():
            if addr in script:
                return out
        return delayed
    monkeypatch.setattr(bonding, "_delayed_script", fake_delayed)
    monkeypatch.setattr(bonding, "_btctl", fake_btctl)


# ── adapter selection ───────────────────────────────────────────────────────────────────────────────
def test_adapter_prefix_selects_the_configured_radio_or_nothing():
    assert bonding._adapter_prefix("AA:AA:AA:AA:AA:AA") == [(0, "select AA:AA:AA:AA:AA:AA")]
    assert bonding._adapter_prefix(None) == [], "unconfigured must not emit a select at all"


def test_scan_selects_the_adapter_before_scanning(monkeypatch):
    """On a multi-radio host, scanning the wrong controller finds nothing and looks like a dead sensor."""
    rec = []
    _stub(monkeypatch, delayed=DEVICES_OUT, record=rec)
    _run(bonding.scan("AA:AA:AA:AA:AA:AA", seconds=0))
    assert rec[0] == (0, "select AA:AA:AA:AA:AA:AA"), "select must come first, before scan on"


# ── scan parsing ────────────────────────────────────────────────────────────────────────────────────
def test_scan_parses_devices_and_dedupes_by_address(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT)
    found = _run(bonding.scan(seconds=0))
    addrs = [f.address for f in found]
    assert len(addrs) == len(set(addrs)) == 3, "a repeated advertisement must not duplicate the device"
    assert "AA:BB:CC:DD:EE:FF" in addrs


def test_scan_flags_known_health_sensors(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT)
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    assert by["AA:BB:CC:DD:EE:FF"].health is True
    assert by["11:22:33:44:55:66"].health is True
    assert by["99:88:77:66:55:44"].health is False, "a speaker must not be foregrounded as a sensor"


def test_scan_enriches_from_info(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT,
          info_by_addr={"AA:BB:CC:DD:EE:FF": INFO_BONDED, "11:22:33:44:55:66": INFO_FRESH})
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    h10 = by["AA:BB:CC:DD:EE:FF"]
    assert h10.bonded is True and h10.connected is True and h10.rssi == -56
    verity = by["11:22:33:44:55:66"]
    assert verity.bonded is False and verity.connected is False and verity.rssi == -80


def test_scan_reads_the_signed_rssi_not_the_hex_word(monkeypatch):
    """bluetoothctl prints `RSSI: 0xffffffc8 (-56)`. Taking the hex would yield 4294967240."""
    _stub(monkeypatch, delayed="Device AA:BB:CC:DD:EE:FF X\n",
          info_by_addr={"AA:BB:CC:DD:EE:FF": INFO_BONDED})
    assert _run(bonding.scan(seconds=0))[0].rssi == -56


def test_scan_leaves_rssi_none_when_absent(monkeypatch):
    """No RSSI line means unknown. A fabricated 0 would sort as the strongest signal on the list."""
    _stub(monkeypatch, delayed="Device AA:BB:CC:DD:EE:FF Polar H10\n",
          info_by_addr={"AA:BB:CC:DD:EE:FF": "Device AA:BB:CC:DD:EE:FF\n\tBonded: no\n"})
    assert _run(bonding.scan(seconds=0))[0].rssi is None


def test_scan_orders_health_first_then_strongest_signal(monkeypatch):
    """Ordering is what the UI shows first — a bedside user picking their strap should not have to hunt
    past a neighbour's speaker."""
    out = ("Device 99:88:77:66:55:44 Loud Speaker\n"
           "Device AA:BB:CC:DD:EE:FF Polar H10\n"
           "Device 11:22:33:44:55:66 Polar Verity Sense\n")
    _stub(monkeypatch, delayed=out, info_by_addr={
        "99:88:77:66:55:44": "\tRSSI: 0x0 (-30)\n",     # strongest, but not a sensor
        "AA:BB:CC:DD:EE:FF": "\tRSSI: 0x0 (-70)\n",
        "11:22:33:44:55:66": "\tRSSI: 0x0 (-50)\n",
    })
    order = [f.address for f in _run(bonding.scan(seconds=0))]
    assert order[0] == "11:22:33:44:55:66", "health sensors first, strongest of them leading"
    assert order[1] == "AA:BB:CC:DD:EE:FF"
    assert order[2] == "99:88:77:66:55:44", "non-sensor sorts last despite the best RSSI"


def test_scan_puts_unknown_rssi_after_known_within_the_same_class(monkeypatch):
    out = "Device AA:BB:CC:DD:EE:FF Polar A\nDevice 11:22:33:44:55:66 Polar B\n"
    _stub(monkeypatch, delayed=out, info_by_addr={
        "AA:BB:CC:DD:EE:FF": "\tBonded: no\n",           # no RSSI at all
        "11:22:33:44:55:66": "\tRSSI: 0x0 (-90)\n",      # weak, but known
    })
    assert [f.address for f in _run(bonding.scan(seconds=0))][0] == "11:22:33:44:55:66"


# ── is_bonded / ensure_bonded ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("info,expected", [
    ("\tBonded: yes\n", True),
    ("\tBonded: yes\n\tPaired: yes\n", True),
    # VIGIL-DEEP-ANALYSIS §2D: `Paired: yes` WITHOUT `Bonded: yes` is a transient LE pairing with no
    # stored long-term keys — NOT bonded. It used to return True, so ensure_bonded skipped the re-pair
    # and the strap kept dropping discovery. Now it falls through to a re-pair (idempotent, costs nothing).
    ("\tPaired: yes\n", False),
    ("\tBonded: no\n\tPaired: yes\n", False),
    ("\tBonded: no\n\tPaired: no\n", False),
    ("", False),                        # device unknown to the controller
])
def test_is_bonded_requires_bonded_not_merely_paired(monkeypatch, info, expected):
    _stub(monkeypatch, delayed=info)
    assert _run(bonding.is_bonded("AA:BB:CC:DD:EE:FF")) is expected


def test_ensure_bonded_short_circuits_when_already_bonded(monkeypatch):
    """Called before every connect. Re-pairing an already-bonded strap costs ~20 s of scripted
    bluetoothctl and can drop a live link, so the fast path must not touch bond()."""
    _stub(monkeypatch, delayed="\tBonded: yes\n")
    called = []
    monkeypatch.setattr(bonding, "bond", lambda *a, **k: called.append(a))
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is True
    assert not called, "must not re-bond an already-bonded device"


def test_ensure_bonded_bonds_when_not_yet_paired(monkeypatch):
    _stub(monkeypatch, delayed="\tBonded: no\n")

    async def fake_bond(address, adapter_mac=None):
        return {"ok": True, "detail": "paired", "address": address}
    monkeypatch.setattr(bonding, "bond", fake_bond)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is True


def test_ensure_bonded_reports_failure_rather_than_raising(monkeypatch):
    _stub(monkeypatch, delayed="\tBonded: no\n")

    async def fake_bond(address, adapter_mac=None):
        return {"ok": False, "detail": "auth-failed", "address": address}
    monkeypatch.setattr(bonding, "bond", fake_bond)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is False


# ── bond ────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("out,ok,detail", [
    ("Pairing successful", True, "paired"),
    ("\tBonded: yes\n", True, "paired"),
    ("Failed to pair: org.bluez.Error.AuthenticationFailed", False, "auth-failed"),
    ("Device AA:BB:CC:DD:EE:FF not available", False, "not-found"),
    ("some other noise", False, "failed"),
])
def test_bond_classifies_the_outcome(monkeypatch, out, ok, detail):
    """The detail string drives what the UI tells the user to do — retry, move closer, or wake the
    device. Collapsing these into a bare False sends them to the wrong remedy."""
    _stub(monkeypatch, delayed=out)
    r = _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    assert r["ok"] is ok and r["detail"] == detail and r["address"] == "AA:BB:CC:DD:EE:FF"


def test_bond_registers_a_just_works_agent_before_pairing(monkeypatch):
    """Headless: with no agent registered the pair prompts on a console nobody is watching and times out."""
    rec = []
    _stub(monkeypatch, delayed="Pairing successful", record=rec)
    _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    cmds = [c for _d, c in rec if isinstance(_d, (int, float))]
    assert "agent NoInputNoOutput" in cmds and "default-agent" in cmds
    assert cmds.index("agent NoInputNoOutput") < cmds.index("pair AA:BB:CC:DD:EE:FF")


def test_bond_never_sets_trust_and_still_untrusts_after_pair(monkeypatch):
    """The §B2 leak window is CLOSED BY CONSTRUCTION (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT 2026-09-05).

    The old script set `trust` ~10 s before revoking it, so a session death in between leaked the
    flag permanently — measured on the live box: both Polars `Trusted: yes` months after the untrust
    shipped. A script that never issues `trust` has no window to leak; the trailing `untrust` stays
    as retrofit cleanup for flags left by the old script or an operator's hand-`trust`.
    (Deliberately replaces the former 'trust must precede pair — 2026-07-16' assertion.)"""
    rec = []
    _stub(monkeypatch, delayed="Pairing successful", record=rec)
    _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    cmds = [c for _d, c in rec if isinstance(_d, (int, float))]
    assert "trust AA:BB:CC:DD:EE:FF" not in cmds
    assert cmds.index("pair AA:BB:CC:DD:EE:FF") < cmds.index("untrust AA:BB:CC:DD:EE:FF")


# ── trusted_flags — the §B2 startup tripwire ────────────────────────────────────────────────────────
def test_trusted_flags_returns_only_the_trusted_subset(monkeypatch):
    _stub(monkeypatch, info_by_addr={
        "AA:AA:AA:AA:AA:AA": "Paired: yes\n\tBonded: yes\n\tTrusted: yes",
        "BB:BB:BB:BB:BB:BB": "Paired: yes\n\tBonded: yes\n\tTrusted: no",
        "CC:CC:CC:CC:CC:CC": "Device CC:CC:CC:CC:CC:CC not available"})
    got = _run(bonding.trusted_flags(
        ["AA:AA:AA:AA:AA:AA", "BB:BB:BB:BB:BB:BB", "CC:CC:CC:CC:CC:CC"]))
    assert got == ["AA:AA:AA:AA:AA:AA"]


def test_trusted_flags_selects_the_configured_adapter(monkeypatch):
    """Trust is PER-ADAPTER (the live box read Trusted:no on hci0 and yes on hci1 for the same
    device) — an unselected query answers about the wrong radio and under-warns."""
    rec = []
    _stub(monkeypatch, delayed="Trusted: yes", record=rec)
    got = _run(bonding.trusted_flags(["AA:AA:AA:AA:AA:AA"], "00:11:22:33:44:55"))
    assert got == ["AA:AA:AA:AA:AA:AA"]
    assert rec and rec[0].startswith("select 00:11:22:33:44:55\n")


def test_trusted_flags_treats_a_read_failure_as_unknown_not_trusted(monkeypatch):
    async def boom(script, timeout=20.0):
        raise RuntimeError("bluetoothctl unavailable")
    monkeypatch.setattr(bonding, "_btctl", boom)
    assert _run(bonding.trusted_flags(["AA:AA:AA:AA:AA:AA"])) == []


# ── forget ──────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("out,ok", [
    ("Device has been removed", True),
    ("[DEL] Device AA:BB:CC:DD:EE:FF removed", True),
    ("Device AA:BB:CC:DD:EE:FF not available", False),
])
def test_forget_reports_removal(monkeypatch, out, ok):
    _stub(monkeypatch, delayed=out)
    assert _run(bonding.forget("AA:BB:CC:DD:EE:FF"))["ok"] is ok


def test_forget_targets_the_configured_adapter(monkeypatch):
    rec = []
    _stub(monkeypatch, delayed="Device has been removed", record=rec)
    _run(bonding.forget("AA:BB:CC:DD:EE:FF", "AA:AA:AA:AA:AA:AA"))
    assert "select AA:AA:AA:AA:AA:AA" in rec[0]
    assert "remove AA:BB:CC:DD:EE:FF" in rec[0]


# ── property updates are not names (2026-07-19) ─────────────────────────────────────────────────────
# bluetoothctl prints announcements and property updates in the SAME `Device <addr> <rest>` shape:
#     [NEW] Device 24:AC:AC:0C:30:1E Polar Sense 0C301E3F
#     [CHG] Device 24:AC:AC:0C:30:1E RSSI: 0xffffffd8 (-40)
# A naive capture takes the RSSI line for the name. That is not cosmetic — the monitor infers
# vendor/model from the name, matches nothing, and the identity gate then REFUSES to remember the
# sensor: "not recognised — needs vendor, model", for a device sitting at -40 dBm that BlueZ knew
# perfectly well as "Polar Sense 0C301E3F".

SCAN_WITH_PROPS = """\
[NEW] Device 24:AC:AC:0C:30:1E Polar Sense 0C301E3F
[CHG] Device 24:AC:AC:0C:30:1E RSSI: 0xffffffd8 (-40)
[CHG] Device 24:AC:AC:0C:30:1E TxPower: 4
[CHG] Device 24:AC:AC:0C:30:1E ManufacturerData Key: 0x006b
[NEW] Device 99:88:77:66:55:44 99-88-77-66-55-44
[CHG] Device 99:88:77:66:55:44 Name: Later Real Name
"""


@pytest.mark.parametrize("tail", [
    "RSSI: 0xffffffd8 (-40)", "TxPower: 4", "Connected: yes", "Paired: no",
    "ServicesResolved: yes", "UUIDs: 0000180f-0000-1000-8000-00805f9b34fb", "Battery Percentage: 0x64",
])
def test_property_updates_are_not_treated_as_names(tail):
    assert bonding.is_property_line(tail) is True


@pytest.mark.parametrize("name", ["Polar Sense 0C301E3F", "Polar H10 02849638", "S8-AW 2100",
                                  "Laser Carver", "PR BT 6C03"])
def test_real_names_are_not_mistaken_for_properties(name):
    assert bonding.is_property_line(name) is False


def test_a_real_name_survives_an_rssi_line_arriving_first(monkeypatch):
    """THE regression. Order must not decide the name."""
    _stub(monkeypatch, delayed=SCAN_WITH_PROPS)
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    assert by["24:AC:AC:0C:30:1E"].name == "Polar Sense 0C301E3F"
    assert by["24:AC:AC:0C:30:1E"].health is True, "a correctly-named Polar must be flagged a sensor"


def test_rssi_is_taken_from_the_scan_stream(monkeypatch):
    """`info` reports RSSI only for a LIVE connection, so every discovered device came back with
    rssi=None — while the value sat in the scan lines being discarded as names."""
    _stub(monkeypatch, delayed=SCAN_WITH_PROPS, info_by_addr={"24:AC:AC:0C:30:1E": "\tBonded: yes\n"})
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    assert by["24:AC:AC:0C:30:1E"].rssi == -40


def test_a_real_name_replaces_an_address_placeholder(monkeypatch):
    _stub(monkeypatch, delayed=SCAN_WITH_PROPS)
    assert bonding.is_placeholder_name("99-88-77-66-55-44") is True
    assert bonding.is_placeholder_name("Polar Sense 0C301E3F") is False


def test_info_supplies_a_name_when_the_scan_only_saw_a_placeholder(monkeypatch):
    """Last resort: BlueZ's cached Name is authoritative and survives a scan that never announced one."""
    _stub(monkeypatch, delayed="[NEW] Device 24:AC:AC:0C:30:1E 24-AC-AC-0C-30-1E\n",
          info_by_addr={"24:AC:AC:0C:30:1E": "\tName: Polar Sense 0C301E3F\n\tBonded: yes\n"})
    f = _run(bonding.scan(seconds=0))[0]
    assert f.name == "Polar Sense 0C301E3F" and f.health is True


def test_a_placeholder_never_overwrites_a_real_name(monkeypatch):
    _stub(monkeypatch, delayed=("[NEW] Device 24:AC:AC:0C:30:1E Polar Sense 0C301E3F\n"
                                "[CHG] Device 24:AC:AC:0C:30:1E 24-AC-AC-0C-30-1E\n"))
    assert _run(bonding.scan(seconds=0))[0].name == "Polar Sense 0C301E3F"


def test_bond_untrusts_after_pairing_so_bleak_is_the_sole_initiator(monkeypatch):
    # VIGIL-DEEP-ANALYSIS §2D: the LTK from `pair` is the bond; persistent `trust` makes the kernel
    # auto-reconnect and race bleak. bond() must revoke it (untrust) after pairing.
    rec = []
    _stub(monkeypatch, delayed="Pairing successful\n", record=rec)
    _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    cmds = " ".join(c for _, c in [x if isinstance(x, tuple) else (0, x) for x in rec])
    assert "untrust AA:BB:CC:DD:EE:FF" in cmds
    assert "pair AA:BB:CC:DD:EE:FF" in cmds        # still pairs (the bond is kept)


# ── _btctl: the pipes, and the script that reaches bluetoothctl ─────────────────────────────────────
# Every bond, scan and info goes through one `create_subprocess_exec`. Existing tests fake it and assert
# the PARSED result, so the three pipe arguments and the script bytes were never observed.

def test_btctl_wires_all_three_pipes_and_feeds_the_script_on_stdin(monkeypatch):
    """bluetoothctl is interactive: without `stdin=PIPE` the script cannot be delivered at all and the
    session sits at its prompt until the timeout. Without `stdout=PIPE` the answer goes to the daemon's
    own stdout and `out` is None. And `stderr=STDOUT` is why a failed pair — which bluetoothctl reports
    on stderr — reaches the `"Pairing successful" in out` test rather than vanishing."""
    seen = {}

    class P:
        returncode = 0

    async def fake_exec(*argv, **kw):
        seen["argv"], seen["kw"] = list(argv), kw
        return P()

    async def fake_comm(proc, timeout, stdin=None):
        seen["stdin"], seen["timeout"] = stdin, timeout
        return b"Bonded: yes\n", b""

    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(bonding.proc_util, "communicate", fake_comm)

    out = _run(bonding._btctl("info AA:BB\nquit\n", timeout=8))
    assert out == "Bonded: yes\n"
    assert seen["argv"] == ["bluetoothctl"]
    assert seen["kw"]["stdin"] is bonding.asyncio.subprocess.PIPE, "no stdin pipe = the script is never delivered"
    assert seen["kw"]["stdout"] is bonding.asyncio.subprocess.PIPE, "no stdout pipe = no answer to parse"
    assert seen["kw"]["stderr"] is bonding.asyncio.subprocess.STDOUT, \
        "bluetoothctl reports pairing failures on stderr; they must land in the stream that is read"
    assert seen["stdin"] == b"info AA:BB\nquit\n", "the script must arrive verbatim, as bytes"
    assert seen["timeout"] == 8, "the caller's bound must reach communicate, which kills AND reaps"


def test_a_btctl_timeout_yields_empty_text_rather_than_raising(monkeypatch):
    """`out = b""` on TimeoutError. Callers do substring tests on the result; a raise here would take
    down a bond attempt that should simply report "not paired"."""
    class P:
        returncode = 0

    async def fake_exec(*a, **k):
        return P()

    async def boom(proc, timeout, stdin=None):
        raise bonding.asyncio.TimeoutError()

    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(bonding.proc_util, "communicate", boom)
    assert _run(bonding._btctl("x\n")) == ""


def test_the_pair_script_revokes_trust_and_ends_cleanly(monkeypatch):
    """The `untrust` is deliberate and documented: `trust` only sets the kernel auto-reconnect flag,
    which RACES bleak for the single ACL slot and produces br-connection-canceled. Dropping it leaves
    the kernel competing with the app for every future connect — a failure that shows up nowhere near
    the bond that caused it."""
    seen = {}

    async def fake_delayed(lines):
        seen["lines"] = list(lines)
        return "Pairing successful\n"

    monkeypatch.setattr(bonding, "_delayed_script", fake_delayed)
    _run(bonding.bond("AA:BB:CC:DD:EE:FF"))

    cmds = [c for _d, c in seen["lines"]]
    assert "pair AA:BB:CC:DD:EE:FF" in cmds, "the address must reach the pair command"
    assert "untrust AA:BB:CC:DD:EE:FF" in cmds, \
        "trust is revoked so bleak is the sole initiator — omitting it re-opens the ACL race"
    assert cmds[-1] == "quit", "the session must be closed, not left for the timeout to reap"
    assert cmds.index("pair AA:BB:CC:DD:EE:FF") < cmds.index("untrust AA:BB:CC:DD:EE:FF"), \
        "untrust follows the pair — reversing it revokes nothing"
    assert all(d >= 0 for d, _c in seen["lines"]), "every step is delay-paced; bluetoothctl drops fast input"


# ── _delayed_script: the session that must stay open, and be closed ─────────────────────────────────
def _script_harness(monkeypatch, output=b"", wait_raises=None):
    """A bluetoothctl stand-in that records the pipes, every byte written, and whether it was reaped."""
    seen = {"writes": [], "killed": False, "stdin_closed": False, "sleeps": []}

    class _Stdin:
        def write(self, b):
            seen["writes"].append(b)

        async def drain(self):
            pass

        def close(self):
            seen["stdin_closed"] = True

    class _Stdout:
        def __init__(self, data):
            self._d = [data, b""]

        async def read(self, n):
            return self._d.pop(0) if self._d else b""

    class P:
        returncode = 0

        def __init__(self):
            self.stdin, self.stdout = _Stdin(), _Stdout(output)

        async def wait(self):
            if wait_raises:
                raise wait_raises
            return 0

        def kill(self):
            seen["killed"] = True

    async def fake_exec(*argv, **kw):
        seen["argv"], seen["kw"] = list(argv), kw
        return P()

    async def fake_sleep(d):
        seen["sleeps"].append(d)

    monkeypatch.setattr(bonding.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(bonding.asyncio, "sleep", fake_sleep)
    return seen


def test_the_scripted_session_writes_every_command_and_closes_stdin(monkeypatch):
    """ONE bluetoothctl session, because a cross-session scan loses the discovery cache — that is why
    this exists instead of separate `_btctl` calls. Each command is newline-terminated and delivered on
    stdin; closing stdin is what makes bluetoothctl exit rather than sit until the 5 s reap."""
    seen = _script_harness(monkeypatch, output=b"Device AA:BB Polar H10\n")
    out = _run(bonding._delayed_script([(0.5, "scan on"), (1.0, "scan off"), (0, "quit")]))

    assert out == "Device AA:BB Polar H10\n", "the drained stdout must be returned, decoded"
    assert seen["writes"] == [b"scan on\n", b"scan off\n", b"quit\n"], \
        "every command, in order, newline-terminated"
    assert seen["stdin_closed"] is True, "stdin must close or bluetoothctl never exits on its own"
    assert seen["kw"]["stdin"] is bonding.asyncio.subprocess.PIPE
    assert seen["kw"]["stdout"] is bonding.asyncio.subprocess.PIPE
    assert seen["kw"]["stderr"] is bonding.asyncio.subprocess.STDOUT


def test_the_delays_are_honoured_because_discovery_needs_time(monkeypatch):
    """`scan on` must be given real time before `devices` is asked, or the listing is empty. A dropped
    delay does not fail — it returns a SHORTER device list, which reads as "nothing was advertising"."""
    seen = _script_harness(monkeypatch)
    _run(bonding._delayed_script([(0.5, "scan on"), (8.0, "scan off"), (0, "quit")]))
    assert 0.5 in seen["sleeps"] and 8.0 in seen["sleeps"], "each stated delay is actually awaited"
    assert 0 not in seen["sleeps"], "a zero delay is skipped, not slept on"


def test_a_session_that_will_not_exit_is_killed_rather_than_left(monkeypatch):
    """CAPTURE-HOST-DEEP-AUDIT §E1's neighbour: a bluetoothctl that ignores its closed stdin must be
    killed, or it holds the adapter for the daemon's lifetime and every later scan finds nothing."""
    seen = _script_harness(monkeypatch, wait_raises=bonding.asyncio.TimeoutError())
    _run(bonding._delayed_script([(0, "quit")]))
    assert seen["killed"] is True, "the reap is bounded at 5s and then it is killed"


def test_scan_asks_for_devices_after_scanning_and_quits(monkeypatch):
    """The order is the whole function: scan on -> wait -> scan off -> devices -> quit. Asking for
    `devices` before `scan off` returns a partial list; omitting `quit` leaves the session to time out."""
    rec = []
    _stub(monkeypatch, delayed="Device AA:BB:CC:DD:EE:FF Polar H10 ABCDEF\n",
          info_by_addr={"AA:BB:CC:DD:EE:FF": "Bonded: yes\n"}, record=rec)
    found = _run(bonding.scan(seconds=3.0))

    script = [x for x in rec if isinstance(x, tuple)]
    assert [c for _d, c in script] == ["scan on", "scan off", "devices", "quit"], \
        "the order is load-bearing"
    assert [d for d, c in script if c == "scan off"] == [3.0], \
        "the caller's duration is what the scan actually runs for"
    # The `info` enrichment is part of scan(), not a separate call the caller makes. An earlier version
    # of this test stubbed only _delayed_script, so this loop ran against the REAL bluetoothctl.
    assert [x for x in rec if isinstance(x, str)] == ["info AA:BB:CC:DD:EE:FF\nquit\n"], \
        "one info query per discovered address, and nothing else reaches bluetoothctl"
    assert len(found) == 1 and found[0].address == "AA:BB:CC:DD:EE:FF"
    assert found[0].health is True, "a Polar H10 is a health device"
    assert found[0].bonded is True, "bonded comes from the info pass; the scan lines cannot supply it"


def test_a_real_name_replaces_a_placeholder_for_the_same_address(monkeypatch):
    """bluetoothctl announces a device by MAC first and its real name later. Keeping the first sighting
    would leave every device listed as its own address, which is what the operator picks from."""
    _stub(monkeypatch,
          delayed=("Device AA:BB:CC:DD:EE:FF AA-BB-CC-DD-EE-FF\n"
                   "Device AA:BB:CC:DD:EE:FF Polar H10 ABCDEF\n"),
          info_by_addr={"AA:BB:CC:DD:EE:FF": ""})
    found = _run(bonding.scan())
    assert len(found) == 1, "one address, one entry"
    assert "Polar" in found[0].name, "the real name must win over the placeholder"
