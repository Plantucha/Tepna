# tepna-capture — tests/test_tepna_rssi_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-rssi.sh — the third NOPASSWD helper, and the third .sh outside the coverage denominator.
#
# It exists because reading a live ACL link's RSSI needs CAP_NET_ADMIN, and because `hcitool rssi` is
# BR/EDR-only: against a Bluetooth LOW ENERGY link it fails with ENOENT even though the link is up.
# So the script looks the connection HANDLE up and issues raw HCI Read_RSSI (OGF 0x05, OCF 0x0005),
# which is addressed by handle and therefore link-type agnostic.
#
# Two things need pinning. (1) It takes two strings straight into a privileged command, so its regex
# validation is the whole security surface. (2) The last byte of the Command Complete payload is a
# SIGNED int8 — the two's-complement fold is one line, it is the only arithmetic in the file, and an
# off-by-one there silently turns -85 dBm into a healthy-looking +171.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-rssi.sh")
MAC = "24:AC:AC:0C:30:1E"

CON_TEMPLATE = "Connections:\n\t< LE {mac} handle {handle} state 1 lm CENTRAL\n"
CMD_TEMPLATE = (
    "< HCI Command: ogf 0x05, ocf 0x0005, plen 2\n"
    "  0C 00 \n"
    "> HCI Event: 0x0e plen 7\n"
    "  01 05 14 00 0C 00 {byte} \n"
)


def _run(tmp_path, *args, con=None, cmd_out=None, cmd_rc=0):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    con_f = tmp_path / "con.txt"
    con_f.write_text(CON_TEMPLATE.format(mac=MAC, handle=12) if con is None else con)
    cmd_f = tmp_path / "cmd.txt"
    cmd_f.write_text(CMD_TEMPLATE.format(byte="AB") if cmd_out is None else cmd_out)
    log = tmp_path / "calls.log"
    log.write_text("")
    tool = bin_dir / "hcitool"
    tool.write_text(
        "#!/bin/sh\n"
        f'echo "hcitool $*" >> "{log}"\n'
        "shift 2\n"                                  # drop `-i hciN`
        "case \"$1\" in\n"
        f'  con) cat "{con_f}" ;;\n'
        f'  cmd) cat "{cmd_f}"; exit {cmd_rc} ;;\n'
        "esac\n"
    )
    tool.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    r = subprocess.run(["bash", SH, *args], capture_output=True, text=True, env=env)
    return r, log.read_text()


# ── the privileged-argument surface ──────────────────────────────────────────────────────────────────

def test_missing_arguments_print_usage_and_never_reach_hcitool(tmp_path):
    for argv in [[], ["hci0"]]:
        r, calls = _run(tmp_path, *argv)
        assert r.returncode != 0
        assert "usage" in r.stderr
        assert calls == ""


def test_a_bad_adapter_name_is_refused(tmp_path):
    for bad in ["hci", "hcia", "hci0; id", "../hci0", "HCI0", "hci0 hci1"]:
        r, calls = _run(tmp_path, bad, MAC)
        assert r.returncode == 2, f"{bad!r} was accepted"
        assert "bad adapter" in r.stderr
        assert calls == "", f"{bad!r} reached the privileged command"


def test_a_bad_mac_is_refused(tmp_path):
    for bad in ["24:AC:AC:0C:30", "not-a-mac-address", "24:AC:AC:0C:30:1E:FF", "24:AC:AC:0C:30:1G"]:
        r, calls = _run(tmp_path, "hci0", bad)
        assert r.returncode == 2, f"{bad!r} was accepted"
        assert "bad mac" in r.stderr
        assert calls == ""


# ── the handle lookup ────────────────────────────────────────────────────────────────────────────────

def test_it_finds_the_handle_for_this_peer_and_asks_for_read_rssi_by_handle(tmp_path):
    r, calls = _run(tmp_path, "hci0", MAC)
    assert r.returncode == 0, r.stderr
    assert "hcitool -i hci0 con" in calls
    assert "cmd 0x05 0x0005 0x0C 0x00" in calls, (
        "handle 12 must go out as little-endian u16 (0x0C 0x00) — this is the LE-capable path, "
        "not `hcitool rssi`, which is BR/EDR-only and fails with ENOENT on these links"
    )


def test_a_handle_above_255_splits_across_both_bytes(tmp_path):
    r, calls = _run(tmp_path, "hci0", MAC, con=CON_TEMPLATE.format(mac=MAC, handle=300))
    assert r.returncode == 0, r.stderr
    assert "cmd 0x05 0x0005 0x2C 0x01" in calls, "300 = 0x012C ⇒ lo 0x2C, hi 0x01"


def test_the_mac_match_is_case_insensitive(tmp_path):
    r, _ = _run(tmp_path, "hci0", MAC.lower(), con=CON_TEMPLATE.format(mac=MAC.upper(), handle=12))
    assert r.returncode == 0, r.stderr


def test_no_active_connection_is_its_own_exit_code(tmp_path):
    r, _ = _run(tmp_path, "hci0", MAC, con="Connections:\n")
    assert r.returncode == 3
    assert "no active connection" in r.stderr


def test_an_unparsable_handle_is_refused_rather_than_sent(tmp_path):
    r, calls = _run(tmp_path, "hci0", MAC, con=CON_TEMPLATE.format(mac=MAC, handle="0x0C"))
    assert r.returncode == 3
    assert "unparsable handle" in r.stderr
    assert "cmd 0x05" not in calls


# ── the reply: a SIGNED int8 ─────────────────────────────────────────────────────────────────────────

def test_a_negative_rssi_is_folded_from_twos_complement(tmp_path):
    """0xAB = 171 unsigned = -85 dBm. Every real link on this box reports a negative value; reading the
    byte unsigned would turn a marginal link into an impossible +171 and hide the failure mode the RSSI
    logging exists to watch."""
    r, _ = _run(tmp_path, "hci0", MAC, cmd_out=CMD_TEMPLATE.format(byte="AB"))
    assert r.returncode == 0, r.stderr
    assert "RSSI return value: -85" in r.stdout


def test_the_non_negative_arm_is_left_alone(tmp_path):
    """0x0A = 10 ⇒ +10, unusual but legal. The fold must not subtract 256 from everything — and the
    `((v > 127)) && v=...` idiom must not abort the script when the condition is false."""
    r, _ = _run(tmp_path, "hci0", MAC, cmd_out=CMD_TEMPLATE.format(byte="0A"))
    assert r.returncode == 0, r.stderr
    assert "RSSI return value: 10" in r.stdout


def test_boundary_bytes(tmp_path):
    for byte, expect in [("7F", 127), ("80", -128), ("FF", -1), ("00", 0)]:
        r, _ = _run(tmp_path, "hci0", MAC, cmd_out=CMD_TEMPLATE.format(byte=byte))
        assert r.returncode == 0, r.stderr
        assert f"RSSI return value: {expect}" in r.stdout, f"0x{byte} should read {expect}"


def test_a_failed_hci_command_is_its_own_exit_code(tmp_path):
    r, _ = _run(tmp_path, "hci0", MAC, cmd_rc=1)
    assert r.returncode == 4
    assert "HCI Read_RSSI failed" in r.stderr


def test_an_unparsable_reply_is_refused_rather_than_printed_as_a_number(tmp_path):
    r, _ = _run(tmp_path, "hci0", MAC, cmd_out="> HCI Event: 0x0e plen 7\n  no hex here\n")
    assert r.returncode == 5
    assert "unparsable HCI reply" in r.stderr
