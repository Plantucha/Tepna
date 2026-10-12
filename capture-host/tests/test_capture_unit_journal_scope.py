# tepna-capture — tests/test_capture_unit_journal_scope.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The capture unit itself says how its journal is read, because the wrong scope reads as health.

RESIDUE `2026-09-25-journal-user-unit-scope-reads-as-silence`: `journalctl --user-unit tepna-capture`
returned 1 line for a 3.5 h window where `-u` returned 10,836 lines with 97 warnings. The wrong scope does
not error; it returns almost nothing, which is indistinguishable from a healthy box. The guidance lives in
the unit file (the one copy install-services.sh installs), where whoever opens the unit to read its logs
finds it.
"""

import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIT = os.path.join(HERE, "deploy", "tepna-capture.service")


def _unit():
    with open(UNIT, encoding="utf-8") as f:
        return f.read()


def _comments():
    return "\n".join(ln for ln in _unit().splitlines() if ln.startswith("#"))


def test_unit_names_system_scope_and_warns_off_user_unit():
    c = _comments()
    assert "journalctl -u tepna-capture" in c
    assert "--user-unit" in c
    assert "SYSTEM unit" in c


def test_unit_demands_a_denominator_for_a_clean_journal_claim():
    c = _comments()
    assert "DENOMINATOR" in c
    assert "10,836" in c


def test_guidance_is_comment_only_and_adds_no_directive():
    for ln in _unit().splitlines():
        if "--user-unit" in ln:
            assert ln.startswith("#")
