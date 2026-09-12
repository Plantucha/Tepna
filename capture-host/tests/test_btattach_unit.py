# tepna-capture — tests/test_btattach_unit.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A Zephyr HCI-UART dongle must come back with its identity, or not come back at all.

2026-09-12: three dongles power-cycled between the `0xFC06` address write and the read-back, and
every one read `00:00:00:00:00:00`. The write is runtime-only. That would be cosmetic except that
`capture._addressable()` refuses a zero address — so an attached-but-unwritten dongle is not a radio
that works badly, it is one that silently never joins the failover ladder. The unit exists to make
that state impossible: a dongle is either correctly identified, or loudly absent.

The paths that need no hardware are EXECUTED here (fail-closed on an unmapped serial, the absent
dongle, the usage error); the sequence that does need a controller (write → down/up → read-back) is
asserted against the source, the same way the autosuspend sibling is.
"""
import os
import re
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "systemd", "tepna-btattach.sh")
UNIT = os.path.join(HERE, "systemd", "tepna-btattach@.service")
MAP_EXAMPLE = os.path.join(HERE, "systemd", "tepna-btattach.map.example")

# A USB serial no dongle carries: 16 hex digits is the shape, but this value is not in any inventory.
ABSENT = "0000000000000000"


def _sh():
    return open(SH, encoding="utf-8").read()


def _unit():
    return open(UNIT, encoding="utf-8").read()


ADDR = "E7:FC:6D:6B:A4:4E"
FAKE_SERIAL = "1111111111111111"


def _run(tmp_path, args, map_text=None, hciconfig_out=None):
    """Run the script against a FAKE inventory. Both of its inputs are redirected unconditionally —
    the map and the tty sysfs tree both live under tmp_path — so no path through it can see a real
    dongle; and the three privileged commands are shadowed on PATH by stubs that exit 99, so a reach
    for real hardware is a visible failure, never a silent one. `hciconfig_out` replaces the stub's
    stdout for the read-back paths."""
    m = tmp_path / "btattach.map"
    if map_text is not None:
        m.write_text(map_text)
    sysfs = tmp_path / "tty"
    sysfs.mkdir(exist_ok=True)
    stubs = tmp_path / "bin"
    stubs.mkdir(exist_ok=True)
    for cmd in ("btattach", "hcitool", "hciconfig"):
        body = "#!/bin/sh\nexit 99\n"
        if cmd == "hciconfig" and hciconfig_out is not None:
            body = f"#!/bin/sh\nprintf '%s\\n' '{hciconfig_out}'\n"
        p = stubs / cmd
        p.write_text(body)
        p.chmod(0o755)
    return subprocess.run(
        ["bash", SH, *args],
        capture_output=True,
        text=True,
        env={
            "PATH": f"{stubs}:{os.environ['PATH']}",
            "TEPNA_BTATTACH_MAP": str(m),
            "TEPNA_BTATTACH_TTY_SYSFS": str(sysfs),
        },
        timeout=30,
    )


def _plug(tmp_path, tty, serial, hci=None):
    """A fake ttyACMn: `<tty>/device/../serial` is where the USB serial sits, and an attached
    controller shows up as `<tty>/hciN` — the two shapes the script reads."""
    d = tmp_path / "tty" / tty
    (d / "device").mkdir(parents=True)
    (d / "serial").write_text(serial + "\n")
    if hci:
        (d / hci).mkdir()


# ── executed: the paths that need no controller ──────────────────────────────────────────────
def test_an_unmapped_serial_fails_closed(tmp_path):
    """Attaching anyway would leave a zero-address adapter that capture drops without a word."""
    r = _run(tmp_path, [ABSENT], map_text="# no entries\n")
    assert r.returncode == 1, r.stderr
    assert "not in" in r.stderr and "refusing" in r.stderr


def test_a_missing_map_file_is_the_same_as_an_empty_one(tmp_path):
    r = _run(tmp_path, [ABSENT])
    assert r.returncode == 1


def test_a_mapped_dongle_that_is_not_plugged_in_is_not_a_failure(tmp_path):
    """The box may boot before the dongle is plugged in; Restart=on-failure must not spin on that."""
    r = _run(tmp_path, [ABSENT], map_text=f"{ABSENT} {ADDR}\n")
    assert r.returncode == 0, r.stderr
    assert "not present" in r.stderr


def test_a_row_is_found_by_its_first_token_amid_comments_and_trailing_words(tmp_path):
    """Only "found / not found" is observable without a dongle (exit 0 vs 1), so this proves the row
    is matched on its first token with comment lines, a blank line and trailing words around it —
    and no more. (Planted: dropping the comment guard is NOT caught here, and cannot be — a `#`
    token never equals a serial on either path. Dropping the lookup itself IS caught: exit 1.)"""
    r = _run(tmp_path, [ABSENT], map_text=f"# header\n\n{ABSENT}   {ADDR.lower()}   # trailing words\n")
    assert r.returncode == 0, r.stderr


def test_no_argument_is_a_usage_error(tmp_path):
    r = _run(tmp_path, [])
    assert r.returncode == 2
    assert "usage" in r.stderr


# ── executed: --check against a fake inventory ───────────────────────────────────────────────
def test_check_with_no_cdc_acm_controller_is_nothing_to_check(tmp_path):
    r = _run(tmp_path, ["--check"])
    assert r.returncode == 0, r.stderr
    assert "nothing to check" in r.stderr


def test_check_names_a_serial_that_is_not_in_the_map(tmp_path):
    _plug(tmp_path, "ttyACM9", FAKE_SERIAL)
    r = _run(tmp_path, ["--check"], map_text="# empty\n")
    assert r.returncode == 1
    assert "NOT IN MAP" in r.stderr and FAKE_SERIAL in r.stderr


def test_check_reports_a_mapped_dongle_with_no_adapter_as_not_attached(tmp_path):
    _plug(tmp_path, "ttyACM9", FAKE_SERIAL)
    r = _run(tmp_path, ["--check"], map_text=f"{FAKE_SERIAL} {ADDR}\n")
    assert r.returncode == 1
    assert "NOT ATTACHED" in r.stderr and "1 problem" in r.stderr


def test_check_passes_when_the_read_back_matches_the_map(tmp_path):
    """The verdict is the READ-BACK: hciconfig answers with the mapped address, so ✓ — and it is
    compared case-insensitively, the map being hand-typed."""
    _plug(tmp_path, "ttyACM9", FAKE_SERIAL, hci="hci7")
    r = _run(tmp_path, ["--check"], map_text=f"{FAKE_SERIAL} {ADDR.lower()}\n",
             hciconfig_out=f"hci7:\tType: Primary  Bus: UART\n\tBD Address: {ADDR}  ACL MTU: 27:7")
    assert r.returncode == 0, r.stderr
    assert f"✓ ttyACM9  hci7  {ADDR}" in r.stderr and "0 problem" in r.stderr


def test_check_calls_out_the_zero_address_as_the_invisible_failure(tmp_path):
    """An attached dongle whose write never took reads all zeros; downstream that is indistinguishable
    from 'not present', so the report has to say what it means."""
    _plug(tmp_path, "ttyACM9", FAKE_SERIAL, hci="hci7")
    r = _run(tmp_path, ["--check"], map_text=f"{FAKE_SERIAL} {ADDR}\n",
             hciconfig_out="\tBD Address: 00:00:00:00:00:00  ACL MTU: 27:7")
    assert r.returncode == 1
    assert "capture will silently exclude it" in r.stderr


def test_check_treats_an_unreadable_address_as_unknown_never_as_a_match(tmp_path):
    """The kernel-7.0 case: no sysfs attribute and hciconfig silent — the first version of the script
    reported ✗ for a correct adapter here; this one says UNREADABLE and still refuses to call it ✓."""
    _plug(tmp_path, "ttyACM9", FAKE_SERIAL, hci="hci7")
    r = _run(tmp_path, ["--check"], map_text=f"{FAKE_SERIAL} {ADDR}\n", hciconfig_out="")
    assert r.returncode == 1
    assert "UNREADABLE" in r.stderr


def test_the_example_map_parses_and_names_no_real_hardware():
    """The real map is deployment config on the box; the repo ships the mechanism and a placeholder."""
    body = open(MAP_EXAMPLE, encoding="utf-8").read()
    rows = [ln.split() for ln in body.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    assert rows, "the example must show at least one row"
    for row in rows:
        assert len(row) >= 2
        assert set(row[0]) == {"0"}, f"a real-looking USB serial in the repo: {row[0]}"


# ── asserted against the source: the sequence that needs a controller ─────────────────────────
def test_the_address_is_written_with_the_zephyr_vendor_opcode():
    assert re.search(r"hcitool -i \"\$hci\" cmd 0x3f 0x0006", _sh())


def test_the_address_bytes_go_on_the_wire_little_endian():
    """The wire order is the reverse of the printed order; a forward loop writes the mirror address."""
    assert re.search(r"for\(i=6;i>=1;i--\)", _sh())


def test_the_adapter_is_cycled_after_the_write():
    """The kernel caches BD_ADDR at HCI setup; without down/up the write reports success and every
    reader still sees zeros — measured."""
    s = _sh()
    write = s.index("cmd 0x3f 0x0006")
    down = s.index('hciconfig "$hci" down', write)
    up = s.index('hciconfig "$hci" up', down)
    assert write < down < up


def test_the_script_reports_the_read_back_not_the_intention():
    s = _sh()
    assert 'got=$(addr_of_hci "$hci")' in s
    assert 'if [ "$got" = "$ADDR" ]' in s


def test_a_wrong_identity_is_left_down_not_served():
    """An adapter carrying the wrong address is worse than an absent one: whatever pinned $ADDR would
    bond with a radio that is not the one it named."""
    s = _sh()
    mismatch = s.index("left DOWN")
    assert 'hciconfig "$hci" down' in s[mismatch - 200 : mismatch]


def test_the_address_is_read_from_hciconfig_first_with_sysfs_as_fallback():
    """/sys/class/bluetooth/hciN/address is absent on kernel 7.0 (every adapter); a sysfs-only read
    reports ✗ for a controller that is correct."""
    s = _sh()
    fn = s[s.index("addr_of_hci() {") :]
    assert fn.index("hciconfig") < fn.index("/sys/class/bluetooth")


def test_the_adapter_is_found_under_its_own_tty_not_by_diffing_hci_list():
    """Two instances starting at once must not claim each other's adapter."""
    assert '"$TTY_SYSFS/$1"/hci*' in _sh()


def test_every_sysfs_read_goes_through_the_redirectable_root():
    """The seam is only a seam if nothing bypasses it: a literal /sys/class/tty anywhere but the
    default would let a test — or the --check above — read this host's inventory after all."""
    code = "\n".join(ln for ln in _sh().splitlines() if not ln.lstrip().startswith("#"))
    assert code.count("/sys/class/tty") == 1, code.count("/sys/class/tty")
    assert 'TTY_SYSFS="${TEPNA_BTATTACH_TTY_SYSFS:-/sys/class/tty}"' in code


def test_resolution_is_by_usb_serial_never_by_tty_index():
    assert "device/../serial" in _sh()


def test_check_mode_names_the_zero_address_case_explicitly():
    """The zero case is the invisible one downstream, so the report has to say what it means."""
    assert "capture will silently exclude it" in _sh()


def test_there_is_no_derive_an_address_from_the_serial_fallback():
    """The serial→address transform is not a function across the dongles in hand; any rule would be
    invented, and a second path that yields a different address than the pinned one is worse than
    stopping."""
    assert re.findall(r"^ADDR=(.*)$", _sh(), re.M) == ['$(addr_for "$SERIAL")'], \
        "ADDR may come from the map lookup and nowhere else"


# ── the unit ──────────────────────────────────────────────────────────────────────────────────
def test_the_unit_is_a_template_instanced_by_serial():
    assert UNIT.endswith("@.service")
    assert re.search(r"^ExecStart=.*tepna-btattach\.sh %i$", _unit(), re.M)


def test_the_unit_runs_after_udev_settles_and_before_bluetooth_and_capture():
    u = _unit()
    assert re.search(r"^After=.*systemd-udev-settle", u, re.M)
    m = re.search(r"^Before=(.*)$", u, re.M)
    assert m and "bluetooth.service" in m.group(1) and "tepna-capture.service" in m.group(1)


def test_the_unit_invokes_the_script_via_bash():
    """Every shell script here is tracked 644; a bare ExecStart path fails with 203/EXEC."""
    m = re.search(r"^ExecStart=(\S+)", _unit(), re.M)
    assert m and os.path.basename(m.group(1)) == "bash"


def test_the_unit_restarts_on_failure_only():
    """An absent dongle exits 0 by design; Restart=always would spin on it forever."""
    u = _unit()
    assert re.search(r"^Restart=on-failure$", u, re.M)
    assert re.search(r"^Type=simple$", u, re.M), "btattach holds the line discipline; it is not a oneshot"


def test_the_privileged_work_is_its_own_short_unit():
    """Capture stays unprivileged; root is confined to the line discipline and the HCI write."""
    assert re.search(r"^User=root$", _unit(), re.M)
