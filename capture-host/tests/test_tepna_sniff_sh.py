# tepna-capture — tests/test_tepna_sniff_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-sniff.sh — the nightly air audit (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05 D3).
#
# `ble_sniff.audit()` is unit-tested next door as a pure function; what CANNOT be tested there is the
# plumbing, and the plumbing is where this script's two known hazards live:
#
#   * THE EXIT CODE OF THE EXTCAP IS NOT THE VERDICT. Nordic's nrf_sniffer_ble.py exits **0** on a
#     LockedException (another process holds the serial port) after writing a 24-byte header-only
#     pcap, and `timeout` exits **124** on the NORMAL end of a capture. A script that believed either
#     number would report a clean night for a capture that never happened. So the tests below drive
#     the fake extcap to exit 0 with no packets (must FAIL) and non-zero with a good pcap (must PASS).
#   * THE UNIT MUST FAIL VISIBLY. `tepna-sniff.service` is a oneshot: a failed audit only reaches
#     `systemctl --failed` if the script propagates ble_sniff's exit 3.
#
# Everything the script touches outside the tmp tree is stubbed on PATH (`bluetoothctl`, `logger`) or
# pointed at a fixture by env (`TEPNA_SNIFF_EXTCAP`, `TEPNA_SNIFF_TTY`, `TEPNA_CONFIG`), so no test
# here needs a radio, a sniffer, or the box.

import os
import shutil
import subprocess
import sys
import time

import pytest

from test_ble_sniff import (
    RING,
    RING_WIRE,
    SENA,
    SENA_WIRE,
    STRANGER,
    STRANGER_WIRE,
    _adv,
    _connect_ind,
    _pcap,
    _pcap_ts,
)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-sniff.sh")
SECS = 5

# Writes the bytes it was told to write to whatever --fifo names, records its argv, exits as told.
FAKE_EXTCAP = (
    "import binascii, os, sys\n"
    'with open(os.environ["FAKE_ARGV_LOG"], "a") as fh:\n'
    '    fh.write("\\0".join(sys.argv[1:]) + "\\n")\n'
    'fifo = sys.argv[sys.argv.index("--fifo") + 1]\n'
    'with open(fifo, "wb") as fh:\n'
    '    fh.write(binascii.unhexlify(os.environ["FAKE_PCAP_HEX"]))\n'
    'sys.exit(int(os.environ["FAKE_RC"]))\n'
)

CLEAN = _pcap_ts((100, 0, _connect_ind(SENA_WIRE, RING_WIRE)), (100 + SECS, 0, _adv(0x0, RING_WIRE)))
FOREIGN = _pcap_ts((100, 0, _connect_ind(STRANGER_WIRE, RING_WIRE)),
                   (100 + SECS, 0, _adv(0x0, RING_WIRE)))
DIED_EARLY = _pcap_ts((100, 0, _adv(0x0, RING_WIRE)), (101, 0, _adv(0x0, RING_WIRE)))
LOCKED = _pcap()          # the LockedException shape: a pcap global header and nothing else


def _stub(bin_dir, name, body):
    p = bin_dir / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(0o755)
    return p


class Run:
    """One `tepna-sniff.sh` invocation and everything it left behind."""

    def __init__(self, proc, out_dir, argv_log, syslog):
        self.proc, self.out_dir = proc, out_dir
        self.rc = proc.returncode
        self.argv = [ln.split("\0") for ln in argv_log.read_text().splitlines()] \
            if argv_log.exists() else []
        self.syslog = syslog.read_text() if syslog.exists() else ""
        self.pcaps = sorted(p for p in os.listdir(out_dir)) if os.path.isdir(out_dir) else []

    @property
    def verdict(self):
        names = [n for n in self.pcaps if n.endswith(".verdict.txt")]
        assert len(names) == 1, f"expected exactly one verdict file, got {self.pcaps}"
        return open(os.path.join(self.out_dir, names[0])).read()


def _sealed_path(tmp_path, bin_dir):
    """A PATH holding every tool the script needs EXCEPT bluetoothctl.

    Stubbing bluetoothctl to answer nothing exercises a different branch from bluetoothctl being
    absent, and only the absent case can prove the `command -v` guard leaves the adapter list empty
    rather than at some earlier value.
    """
    sealed = tmp_path / "sealed-bin"
    sealed.mkdir(exist_ok=True)
    for tool in ("bash", "dirname", "nice", "timeout", "date", "mkdir", "awk", "paste", "head",
                 "sed", "grep", "find"):
        real = shutil.which(tool)
        if real is None:                                    # pragma: no cover - not on this box
            pytest.skip(f"{tool} is not on PATH")
        link = sealed / tool
        if not link.exists():
            link.symlink_to(real)
    for stub in os.listdir(bin_dir):
        if stub != "bluetoothctl":
            shutil.copy2(bin_dir / stub, sealed / stub)
    assert shutil.which("bluetoothctl", path=str(sealed)) is None
    return str(sealed)


def _run(tmp_path, pcap=CLEAN, *, rc=0, secs=SECS, keep_days=30, controllers=None,
         tty=True, extcap=True, config=True, out_dir=None, sealed=False):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    argv_log = tmp_path / "extcap-argv.log"
    syslog = tmp_path / "syslog.txt"
    _stub(bin_dir, "logger", f'shift 2; shift; echo "$*" >> "{syslog}"\n')
    lines = "Controller %s sena [default]" % SENA if controllers is None else controllers
    _stub(bin_dir, "bluetoothctl", f'[ "$1" = list ] && printf "%s" {lines!r}\n')
    # Only reached where .venv is absent (CI); locally the script finds the venv interpreter itself.
    _stub(bin_dir, "python3", f'exec "{sys.executable}" "$@"\n')

    fake = tmp_path / "nrf_sniffer_ble.py"
    fake.write_text(FAKE_EXTCAP)
    cfg = tmp_path / "config.yaml"
    cfg.write_text("devices:\n  - name: ring\n    address: %s\n" % RING)
    out = str(out_dir or (tmp_path / "captures"))
    ttyfile = tmp_path / "ttyACM0"
    ttyfile.write_text("")

    env = {
        **os.environ,
        "PATH": _sealed_path(tmp_path, bin_dir) if sealed else f"{bin_dir}:{os.environ['PATH']}",
        "TEPNA_SNIFF_DIR": out,
        "TEPNA_SNIFF_SECONDS": str(secs),
        "TEPNA_SNIFF_KEEP_DAYS": str(keep_days),
        "TEPNA_SNIFF_EXTCAP": str(fake if extcap else tmp_path / "absent.py"),
        "TEPNA_SNIFF_PY": sys.executable,
        "TEPNA_SNIFF_TTY": str(ttyfile if tty else tmp_path / "no-such-tty"),
        "TEPNA_CONFIG": str(cfg if config else tmp_path / "absent.yaml"),
        "FAKE_ARGV_LOG": str(argv_log),
        "FAKE_PCAP_HEX": pcap.hex(),
        "FAKE_RC": str(rc),
    }
    proc = subprocess.run(["bash", SH], capture_output=True, text=True, env=env, timeout=120)
    return Run(proc, out, argv_log, syslog)


# ── the clean night ──────────────────────────────────────────────────────────────────────────────

def test_a_clean_night_exits_zero_and_leaves_the_verdict_beside_the_pcap(tmp_path):
    r = _run(tmp_path)
    assert r.rc == 0, r.proc.stderr
    assert [n for n in r.pcaps if n.startswith("nightly-") and n.endswith(".pcap")], r.pcaps
    assert "AIR AUDIT: OK" in r.verdict
    assert "1 configured, 1 heard" in r.verdict


def test_the_audit_line_reaches_the_journal_not_only_the_file(tmp_path):
    """A verdict nobody reads is not a monitored surface: the one-line answer goes to syslog under
    the `tepna-sniff` tag, so `journalctl -t tepna-sniff` is the whole history of the audit."""
    r = _run(tmp_path)
    assert "AIR AUDIT: OK" in r.syslog
    assert ".verdict.txt" in r.syslog, "the journal line must point at the full report"


def test_the_extcap_is_asked_for_this_sniffer_and_this_pcap(tmp_path):
    r = _run(tmp_path)
    assert len(r.argv) == 1
    argv = r.argv[0]
    assert "--capture" in argv
    tty = str(tmp_path / "ttyACM0")
    assert argv[argv.index("--extcap-interface") + 1] == tty + "-None", (
        "the interface id is the device path with Nordic's phy suffix; the bare path is rejected "
        "by the extcap with a usage error"
    )
    fifo = argv[argv.index("--fifo") + 1]
    assert fifo.startswith(r.out_dir + "/nightly-") and fifo.endswith(".pcap")
    assert argv[argv.index("--device") + 1] == "", "an empty --device means all-advertising"
    assert "--scan-follow-rsp" in argv and "--scan-follow-aux" in argv


# ── the exit code of the extcap is not the verdict ───────────────────────────────────────────────

def test_the_locked_port_shape_exits_zero_with_no_packets_and_still_fails(tmp_path):
    """LockedException: the extcap logs at INFO, writes a header-only pcap and exits 0. Believing
    that code would report a clean night for a capture that never ran."""
    r = _run(tmp_path, LOCKED, rc=0)
    assert r.rc == 3
    assert "no packets at all in a 5 s window" in r.verdict
    assert "AIR AUDIT: FAILED" in r.syslog


def test_an_extcap_that_dies_is_logged_and_its_bytes_are_judged_anyway(tmp_path):
    """The mirror case: a non-zero exit with a full window of packets is still a good night. The
    code is recorded for the operator and does not enter the verdict."""
    r = _run(tmp_path, CLEAN, rc=1)
    assert r.rc == 0, r.proc.stderr
    assert "extcap exited 1 before the window ended" in r.proc.stderr
    assert "AIR AUDIT: OK" in r.verdict


# ── the two findings ─────────────────────────────────────────────────────────────────────────────

def test_a_foreign_connect_fails_the_oneshot(tmp_path):
    """C1 seen on air. Exit 3 is what puts `tepna-sniff.service` into `systemctl --failed`."""
    r = _run(tmp_path, FOREIGN)
    assert r.rc == 3
    assert "AIR AUDIT: FAILED — 1 foreign connect(s) to our devices" in r.verdict
    assert "%s -> %s" % (STRANGER, RING) in r.verdict


def test_a_capture_that_died_early_fails_the_oneshot(tmp_path):
    """F2's shape: the file exists, its mtime spans the night, and it holds a fraction of it."""
    r = _run(tmp_path, DIED_EARLY)
    assert r.rc == 3
    assert "captured 1.0 s of 5 s expected" in r.verdict


def test_our_own_adapters_come_from_bluetoothctl_and_attribute_the_connect(tmp_path):
    r = _run(tmp_path, CLEAN)
    assert r.rc == 0
    assert "our adapters    : %s" % SENA in r.verdict


def test_an_adapter_list_that_could_not_be_read_makes_every_connect_to_us_foreign(tmp_path):
    """`bluetoothctl` present but answering nothing (bluetoothd down, D-Bus busy). The connect in
    CLEAN is from our OWN adapter, and must still be reported: 'could not attribute' is a finding,
    not a clean night."""
    r = _run(tmp_path, CLEAN, controllers="")
    assert r.rc == 3
    assert "NONE listed — every connect to our devices counts as foreign" in r.verdict
    assert "%s -> %s" % (SENA, RING) in r.verdict


def test_bluetoothctl_absent_leaves_the_adapter_list_empty_rather_than_stale(tmp_path):
    """The `command -v` guard's other arm. A default that survived the guard — an adapter address
    left over from an earlier assignment, say — would attribute a connect to a radio nobody
    confirmed exists, which is the one direction this audit must never fail in."""
    r = _run(tmp_path, CLEAN, sealed=True)
    assert r.rc == 3
    assert "NONE listed — every connect to our devices counts as foreign" in r.verdict


# ── refusals, before anything is captured ────────────────────────────────────────────────────────

def test_no_sniffer_on_the_bus_is_its_own_exit_code(tmp_path):
    r = _run(tmp_path, tty=False)
    assert r.rc == 5
    assert r.argv == [], "the extcap must not be started without a sniffer"
    assert "no nRF Sniffer on the bus" in r.proc.stderr


def test_a_missing_extcap_is_its_own_exit_code(tmp_path):
    r = _run(tmp_path, extcap=False)
    assert r.rc == 6
    assert "extcap missing" in r.proc.stderr


def test_a_bad_window_length_is_refused_before_the_radio_is_touched(tmp_path):
    for bad in ["0", "soon", "-30", "10.5", "600 "]:
        r = _run(tmp_path, secs=bad)
        assert r.rc == 2, f"{bad!r} was accepted as a window length"
        assert "bad TEPNA_SNIFF_SECONDS" in r.proc.stderr
        assert r.argv == []


# ── retention ────────────────────────────────────────────────────────────────────────────────────

def test_retention_deletes_only_the_captures_this_script_names(tmp_path):
    """A 600 s all-advertising pcap is tens of MB and /srv/tepna also holds the recordings this box
    exists to keep. The prune is anchored to the `nightly-` prefix, and nothing else in the
    directory is a candidate — including an old pcap someone captured by hand."""
    out = tmp_path / "captures"
    out.mkdir()
    old, byhand, fresh = out / "nightly-20260101-0300.pcap", out / "allscan-20260101.pcap", \
        out / "nightly-20260904-0300.pcap"
    long_ago = time.time() - 40 * 86400
    for p in (old, byhand, fresh):
        p.write_bytes(b"x")
    for p in (old, byhand):
        os.utime(p, (long_ago, long_ago))

    r = _run(tmp_path, out_dir=out, keep_days=30)
    assert r.rc == 0, r.proc.stderr
    assert not old.exists(), "a 40-day-old nightly capture should have been pruned"
    assert byhand.exists(), "only files this script names are candidates for deletion"
    assert fresh.exists()


def test_retention_keeps_everything_when_the_horizon_is_wide(tmp_path):
    """The delete is `-mtime +KEEP_DAYS`, so the horizon is honoured rather than assumed."""
    out = tmp_path / "captures"
    out.mkdir()
    old = out / "nightly-20260101-0300.pcap"
    old.write_bytes(b"x")
    long_ago = time.time() - 40 * 86400
    os.utime(old, (long_ago, long_ago))

    assert _run(tmp_path, out_dir=out, keep_days=365).rc == 0
    assert old.exists()
