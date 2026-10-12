# tepna-capture — tests/test_settle_trigger_wording.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The settle trigger is described as the rule the code runs — RESIDUE `2026-09-25-settle-trigger-is-the-later-of-two`.

Night N is judged once N's OWN newest device-data write is `settle_sec` old (`nightqc.data_settled`, read by
`capture.loss_poller`), on the next poll tick. Night N+1's first write is not consulted; a device worn past it
(the H10 on 2026-09-24, writing into N until 06:00:06) holds N open. `solid_night`'s docstring, the brief's
§3.1 and `diskguard.active_nights` said "until night N+1's first data write", which no code path computes.
"""

import os
import time

import diskguard
import nightqc
import solid_night

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIEF = os.path.join(os.path.dirname(HERE), "briefs", "SOLID-NIGHT-2026-09-23-BRIEF.md")
OLD = "until night N+1's first data write"
SETTLE = 1200.0


def _touch(path, age_s, now):
    with open(path, "w") as fh:
        fh.write("h\n")
    os.utime(path, (now - age_s, now - age_s))


def test_solid_night_docstring_states_data_settle_not_the_next_nights_first_write():
    doc = solid_night.__doc__
    assert OLD not in doc
    assert "nightqc.data_settled" in doc
    assert "N+1's first write is NOT the trigger" in doc
    assert "nightqc.data_settled" in solid_night.night_verdict.__doc__


def test_diskguard_active_nights_names_the_real_trigger():
    doc = diskguard.active_nights.__doc__
    assert "NOT THE SOLID-NIGHT SETTLE TRIGGER" in doc
    assert "nightqc.data_settled" in doc


def test_brief_rule_one_no_longer_states_the_single_trigger():
    """Rule 1 spans several lines, so the whole paragraph is the unit of text to read."""
    with open(BRIEF, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    i = next(k for k, ln in enumerate(lines) if ln.startswith("1. **UNKNOWN, reason `not settled`**"))
    para = [lines[i]]
    for ln in lines[i + 1 :]:
        if not ln.startswith("   "):
            break
        para.append(ln)
    rule = "\n".join(para)
    assert OLD not in rule
    assert "nightqc.data_settled" in rule
    assert "SUPERSEDES" in rule
    assert "capture.py:9425" in rule, "the trigger names the line that reads it"


def test_the_trigger_the_text_describes_is_the_one_the_predicate_computes(tmp_path):
    """Behaviour, not prose: N settles on its own last device write, whatever N+1 holds."""
    now = time.time()
    n, n1 = tmp_path / "2026-09-24", tmp_path / "2026-09-25"
    n.mkdir()
    n1.mkdir()
    # a device still writing into N (5 min ago) while N+1 already has data (Verity at 05:37) → N is OPEN
    _touch(str(n / "Polar_H10_AAAA_ECG.txt"), 300, now)
    _touch(str(n1 / "Polar_Verity_BBBB_PPG.txt"), 4000, now)
    m = nightqc.newest_data_mtime(str(n))
    assert not nightqc.data_settled(m, SETTLE, now)
    # its last write plus the settle window → settled, with N+1 never consulted
    assert nightqc.data_settled(m, SETTLE, now + SETTLE)
    # N+1 absent altogether changes nothing about N
    os.remove(str(n1 / "Polar_Verity_BBBB_PPG.txt"))
    assert nightqc.data_settled(nightqc.newest_data_mtime(str(n)), SETTLE, now + SETTLE)
    # a sidecar written into N is the box talking about itself and does not hold it open
    _touch(str(n / "QC-SUMMARY.json"), 0, now + SETTLE)
    _touch(str(n / "OXYLIFE.csv"), 0, now + SETTLE)
    assert nightqc.data_settled(nightqc.newest_data_mtime(str(n)), SETTLE, now + SETTLE)
    # …while diskguard's wider question DOES still call it active (a different set, named as such)
    assert str(n.name) in diskguard.active_nights(str(tmp_path), SETTLE, _now=lambda: now + SETTLE)
