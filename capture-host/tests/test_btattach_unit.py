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


def _run(args, env):
    return subprocess.run(
        ["bash", SH, *args],
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"], **env},
        timeout=30,
    )


# ── executed: the paths that need no controller ──────────────────────────────────────────────
def test_an_unmapped_serial_fails_closed(tmp_path):
    """Attaching anyway would leave a zero-address adapter that capture drops without a word."""
    m = tmp_path / "btattach.map"
    m.write_text("# no entries\n")
    r = _run([ABSENT], {"TEPNA_BTATTACH_MAP": str(m)})
    assert r.returncode == 1, r.stderr
    assert "not in" in r.stderr and "refusing" in r.stderr


def test_a_missing_map_file_is_the_same_as_an_empty_one(tmp_path):
    r = _run([ABSENT], {"TEPNA_BTATTACH_MAP": str(tmp_path / "absent.map")})
    assert r.returncode == 1


def test_a_mapped_dongle_that_is_not_plugged_in_is_not_a_failure(tmp_path):
    """The box may boot before the dongle is plugged in; Restart=on-failure must not spin on that."""
    m = tmp_path / "btattach.map"
    m.write_text(f"{ABSENT} E7:FC:6D:6B:A4:4E\n")
    r = _run([ABSENT], {"TEPNA_BTATTACH_MAP": str(m)})
    assert r.returncode == 0, r.stderr
    assert "not present" in r.stderr


def test_a_row_is_found_by_its_first_token_amid_comments_and_trailing_words(tmp_path):
    """Only "found / not found" is observable without a dongle (exit 0 vs 1), so this proves the row
    is matched on its first token with comment lines, a blank line and trailing words around it —
    and no more. (Planted: dropping the comment guard is NOT caught here, and cannot be — a `#`
    token never equals a serial on either path. Dropping the lookup itself IS caught: exit 1.)"""
    m = tmp_path / "btattach.map"
    m.write_text(f"# header\n\n{ABSENT}   e7:fc:6d:6b:a4:4e   # trailing words\n")
    r = _run([ABSENT], {"TEPNA_BTATTACH_MAP": str(m)})
    assert r.returncode == 0, r.stderr


def test_no_argument_is_a_usage_error():
    r = _run([], {})
    assert r.returncode == 2
    assert "usage" in r.stderr


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
    assert '"/sys/class/tty/$1"/hci*' in _sh()


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
