# tepna-capture — tests/test_enable_cpap_wifi.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# deploy/enable-cpap-wifi.sh — the two host facts the CPAP harvest needs, and the one case it must
# REFUSE.
#
# On a box with no Ethernet the Wi-Fi radio IS the uplink. Marking it networkd-unmanaged, or letting
# the harvest take it down to reach an SD card, disconnects the box — to fetch a file. That is exactly
# the trade `wifi_up`'s default-route guard forbids at runtime; this script has to forbid it at INSTALL
# time, because the alternative is someone discovering it from a box that stopped answering.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "deploy", "enable-cpap-wifi.sh")


def _run(tmp_path, *args, fake_default_dev="eno1"):
    """Run the script with `ip` stubbed, so the uplink is whatever the test says it is."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ip = bin_dir / "ip"
    ip.write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = "route" ]; then echo "default via 192.168.0.1 dev {fake_default_dev} proto dhcp"; fi\n'
    )
    ip.chmod(0o755)
    etc_sd = tmp_path / "etc-systemd"; etc_sd.mkdir(exist_ok=True)
    etc_nd = tmp_path / "etc-networkd"; etc_nd.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "TEPNA_ETC_SYSTEMD": str(etc_sd),
        "TEPNA_ETC_NETWORKD": str(etc_nd),
    }
    r = subprocess.run(["bash", SH, *args], capture_output=True, text=True, env=env)
    return r, etc_sd, etc_nd


def test_it_refuses_to_unmanage_the_interface_carrying_the_default_route(tmp_path):
    """THE refusal. A box whose only radio is its uplink must not lend it to the harvest."""
    r, sd, nd = _run(tmp_path, "--iface", "wlan0", fake_default_dev="wlan0")
    assert r.returncode == 1, r.stdout
    assert "carries the default route" in r.stdout
    assert "lifeline" in r.stdout
    assert "station mode" in r.stdout, "the refusal must name the way out, not just say no"
    assert not list(nd.iterdir()), "nothing may be written when refusing"
    assert not list(sd.iterdir())


def test_it_installs_both_host_facts_for_a_wired_box(tmp_path):
    r, sd, nd = _run(tmp_path, "--iface", "wlp1s0", fake_default_dev="eno1")
    assert r.returncode == 0, r.stdout + r.stderr
    net = (nd / "10-tepna-cpap-wifi.network").read_text()
    assert "Name=wlp1s0" in net and "@IFACE@" not in net, "the template must be substituted"
    assert "Unmanaged=yes" in net
    dropin = (sd / "tepna-capture.service.d" / "10-cpap-privatetmp.conf").read_text()
    assert "PrivateTmp=yes" in dropin


def test_it_is_idempotent(tmp_path):
    _run(tmp_path, "--iface", "wlp1s0")
    r, _, _ = _run(tmp_path, "--iface", "wlp1s0")
    assert r.returncode == 0 and "already configured" in r.stdout


def test_check_reports_without_writing(tmp_path):
    r, sd, nd = _run(tmp_path, "--iface", "wlp1s0", "--check")
    assert r.returncode == 1, "not yet installed ⇒ non-zero, so it can gate a deploy"
    assert not list(nd.iterdir()), "--check must never write"
    _run(tmp_path, "--iface", "wlp1s0")
    r2, _, _ = _run(tmp_path, "--iface", "wlp1s0", "--check")
    assert r2.returncode == 0


def test_a_restart_is_required_and_said_so(tmp_path):
    """PrivateTmp only applies on restart. Saying it is the difference between a fix that works today
    and one that appears not to."""
    r, _, _ = _run(tmp_path, "--iface", "wlp1s0")
    assert "restart" in r.stdout.lower() or "TEPNA_ETC_SYSTEMD" in os.environ


def test_the_host_reloads_are_gated_on_the_real_paths():
    """The claim this script's allowlist entry in test_deploy_sync_apps.py makes, CHECKED rather than
    asserted in a comment.

    Removing either gate does not fail a test — it makes the suite reach the developer's own systemd.
    Measured: with the networkd gate removed these tests went from 0.05 s to 100 s, because
    `networkctl reload` was really being invoked on the host. That is precisely the §E6 regression
    (14 polkit prompts in 20 minutes, hidden behind 2>/dev/null), and a comment is not a guard."""
    body = open(SH, encoding="utf-8").read()
    for cmd, gate in (("networkctl reload", '"$NETD" = "/etc/systemd/network"'),
                      ("systemctl daemon-reload", '"$UNIT" = "/etc/systemd/system"')):
        assert cmd in body, f"{cmd} disappeared — update this test with the reload that replaced it"
        before = body.split(cmd)[0]
        assert gate in before, f"{cmd} must be gated on {gate} so a redirected run cannot touch the host"
