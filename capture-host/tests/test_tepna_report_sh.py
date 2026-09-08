# tepna-capture — tests/test_tepna_report_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-report.sh — the morning report's plumbing. `night_report.py` is unit-tested next door as pure
# functions; what cannot be tested there is what this script alone owns:
#
#   * THE SECRET. The webhook URL carries a token. It is read from config.yaml and must appear in
#     NOTHING the script produces — not stdout, not stderr, not the report file. That is asserted here
#     against a distinctive fake token, because a leak of this kind is invisible until it is public.
#   * WHICH NIGHT. The newest dated directory, not `date -d yesterday`: a box that was off would
#     otherwise report an empty night that never existed.
#   * WHAT COUNTS AS FAILURE. Alerts disabled is a SUCCESS — the report was still written — while a
#     configured send that fails is exit 5. Getting that backwards would put a permanent red in
#     `systemctl --failed` for a choice the operator made.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-report.sh")
TOKEN = "tk_SECRET_do_not_leak_9f3a"          # distinctive enough that a substring search is decisive

SUMMARY = ('{"night":"2026-09-06","devices":[{"name":"Wellue O2Ring-S",'
           '"streams":{"spo2":34964}}],"class_b":[]}')


def _run(tmp_path, *args, nights=("2026-09-06",), enabled=False, url=None, summary=SUMMARY):
    """The REAL layout: `root` is the base and the nights are one level down, under `captures/`.

    ⚠️ This fixture used to point `root` straight at the captures directory, which made every test
    pass against a tree no box has. `writers.night_dir` writes `<root>/captures/<YYYY-MM-DD>` and the
    daemon's config carries `root: /srv/tepna`, so a script searching `<root>` finds nothing on a real
    box and exits 4 — "nothing to report", every morning, indistinguishable from a night that never
    recorded. The fixture is the thing that decides whether this test file can see that bug at all.
    """
    base = tmp_path / "srv"
    root = base / "captures"
    root.mkdir(parents=True, exist_ok=True)
    for n in nights:
        d = root / n
        d.mkdir(exist_ok=True)
        if summary is not None:
            (d / "QC-SUMMARY.json").write_text(summary, encoding="utf-8")
    cfg = tmp_path / "config.yaml"
    lines = ["root: %s" % base, "alerts:", "  enabled: %s" % ("true" if enabled else "false")]
    if url:
        lines.append("  webhook_url: %s" % url)
    cfg.write_text("\n".join(lines) + "\n", encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    syslog = tmp_path / "syslog.txt"
    (bin_dir / "logger").write_text("#!/bin/sh\nshift 2; shift; echo \"$*\" >> \"%s\"\n" % syslog)
    (bin_dir / "logger").chmod(0o755)
    env = {**os.environ, "PATH": "%s:%s" % (bin_dir, os.environ["PATH"]),
           "TEPNA_CONFIG": str(cfg)}
    r = subprocess.run(["bash", SH, *args], capture_output=True, text=True, env=env, timeout=120)
    return r, root, (syslog.read_text(encoding="utf-8") if syslog.exists() else "")


def test_the_night_is_found_under_root_SLASH_captures_and_not_under_root(tmp_path):
    """The layout check, stated on its own so it cannot be lost in a refactor of the fixture. A night
    directory sitting directly under `root` must NOT be picked up — that path exists on no box, and a
    script that accepts it would keep passing while reporting nothing in production."""
    base = tmp_path / "srv"
    (base / "captures" / "2026-09-06").mkdir(parents=True)
    (base / "captures" / "2026-09-06" / "QC-SUMMARY.json").write_text(SUMMARY, encoding="utf-8")
    decoy = base / "2026-09-99"                     # not a real date, and not where nights live
    decoy.mkdir()
    cfg = tmp_path / "config.yaml"
    cfg.write_text("root: %s\nalerts:\n  enabled: false\n" % base, encoding="utf-8")
    r = subprocess.run(["bash", SH], capture_output=True, text=True, timeout=120,
                       env={**os.environ, "TEPNA_CONFIG": str(cfg)})
    assert r.returncode == 0, r.stderr
    assert (base / "captures" / "2026-09-06" / "NIGHT-REPORT.txt").exists()
    assert not (decoy / "NIGHT-REPORT.txt").exists()


def test_it_writes_the_report_and_logs_the_line_with_alerts_disabled(tmp_path):
    r, root, log = _run(tmp_path)
    assert r.returncode == 0, r.stderr
    body = (root / "2026-09-06" / "NIGHT-REPORT.txt").read_text(encoding="utf-8")
    assert body.splitlines()[0] == "2026-09-06: ring 9.7 h, 0 spans, back-check ok, sniffer coverage unknown ?"
    assert "2026-09-06: ring 9.7 h" in log, "the line goes to the journal, not only to the file"
    assert "nothing sent" in r.stderr


def test_alerts_disabled_is_a_SUCCESS_not_a_failure(tmp_path):
    """A box with no webhook still wrote its report. Exiting non-zero here would leave a permanent red
    in `systemctl --failed` for a configuration the operator chose."""
    r, _, _ = _run(tmp_path, enabled=False)
    assert r.returncode == 0


def test_the_webhook_token_appears_in_NOTHING_the_script_produces(tmp_path):
    """The leak this file exists to prevent. The URL is read, handed to the notifier, and must not
    reach stdout, stderr, the journal line or the report file — a send is ATTEMPTED here (against a
    closed port) so the failure path is the one under test, which is where a careless error message
    would echo the URL."""
    r, root, log = _run(tmp_path, enabled=True, url="http://127.0.0.1:1/%s" % TOKEN)
    haystack = "\n".join([r.stdout, r.stderr, log,
                          (root / "2026-09-06" / "NIGHT-REPORT.txt").read_text(encoding="utf-8")])
    assert TOKEN not in haystack, "the webhook token leaked into the script's own output"
    assert "127.0.0.1:1" not in haystack, "…and neither may the URL it lives in"


def test_a_configured_send_that_FAILS_is_exit_5(tmp_path):
    """Distinct from 'disabled': here the operator asked for a notification and did not get one."""
    r, _, log = _run(tmp_path, enabled=True, url="http://127.0.0.1:1/x")
    assert r.returncode == 5, r.stderr
    assert "could not be delivered" in log


def test_no_night_directory_at_all_is_exit_4_and_says_so(tmp_path):
    r, _, log = _run(tmp_path, nights=())
    assert r.returncode == 4
    assert "nothing to report" in log


def test_the_NEWEST_night_is_reported_and_an_explicit_one_overrides_it(tmp_path):
    """Newest, not `yesterday`: a box that was off for a week must report the night it actually has."""
    r, root, _ = _run(tmp_path, nights=("2026-09-04", "2026-09-06", "2026-09-05"))
    assert (root / "2026-09-06" / "NIGHT-REPORT.txt").exists()
    assert not (root / "2026-09-04" / "NIGHT-REPORT.txt").exists()
    r2, root2, _ = _run(tmp_path / "b", "2026-09-04", nights=("2026-09-04", "2026-09-06"))
    assert r2.returncode == 0
    assert (root2 / "2026-09-04" / "NIGHT-REPORT.txt").exists()


def test_a_night_with_no_summary_still_reports_unknowns_rather_than_failing(tmp_path):
    """The night the box crashed is exactly the night the line is read. It must be produced."""
    r, root, _ = _run(tmp_path, summary=None)
    assert r.returncode == 0
    body = (root / "2026-09-06" / "NIGHT-REPORT.txt").read_text(encoding="utf-8")
    assert "ring unknown h" in body and "back-check unknown" in body
    assert " 0 " not in body.splitlines()[0], "an absent night must not report a zero"
