# tepna-capture — tests/test_verity_sdk_config.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The decisions behind the one-night Verity SDK trial: which block, which keys, what moved.

THE DEFECT UNDER TEST. The trial writes two keys into the live config, and the operator reads a diff
to decide whether to run it. Three things can be silently wrong: the edit can land on the wrong
device block, it can move a third value the diff does not make obvious, and the rate can read 176
while the capture runs at 55. The proof `only_two_keys_moved` is the one that must not report success
about something it never examined, so its negative controls are here: a third moved value, a parsed
file with no Verity device, and a file with two of them.

A refusal is a `Refusal`, never an exit, so every refusal below is asserted on its reason text.
"""

from __future__ import annotations

import pytest
import verity_sdk_config as VT
import yaml

LOAD = yaml.safe_load

BASE = """root: /data/tepna
devices:
  - name: VERITY-01
    address: AA:BB:CC:DD:EE:FF
    streams: [ppg, acc, ppi, hr]
    rates:
      ppg: 55
      acc: 52
  - name: H10-01
    address: 11:22:33:44:55:66
    streams: [ecg, acc]
pull:
  enabled: true
"""


def lines(text: str) -> list[str]:
    return text.splitlines(keepends=True)


# ── redaction and the small readers ────────────────────────────────────────────────────────────────


def test_a_mac_never_reaches_the_output():
    assert VT.redact("address: AA:BB:CC:DD:EE:FF") == "address: <MAC>"
    assert VT.redact("no address here") == "no address here"


def test_value_of_takes_the_text_after_the_first_colon():
    assert VT.value_of("    address: AA:BB:CC:DD:EE:FF\n") == "AA:BB:CC:DD:EE:FF"


def test_a_value_is_read_past_its_measured_comment():
    """The live config documents findings on these very lines, so a comment is not part of a value."""
    assert VT.value_of("      ppg: 55        # the device offers 55 only without SDK mode\n") == "55"
    assert VT.value_of("root: /srv/tepna  # the capture root\n") == "/srv/tepna"
    assert VT.split_comment("ppg: 55") == ("ppg: 55", "")
    assert VT.comment_of("      ppg: 55   # measured\n") == "   # measured"
    assert VT.comment_of("      ppg: 55\n") == ""


def test_a_rewritten_line_carries_its_comment_forward():
    """A text edit exists to keep the comments a YAML dump would drop, including on the edited line."""
    text = (
        "devices:\n  - name: VERITY-01\n    sdk_mode: false  # off since 2026-09-22\n"
        "    rates:\n      ppg: 55   # the device offers 55 only without SDK mode\n"
    )
    out, notes = VT.edit(lines(text), 176)
    assert notes == ["sdk_mode: false -> true", "rates.ppg: 55 -> 176"]
    assert out[2] == "    sdk_mode: true  # off since 2026-09-22\n"
    assert out[4] == "      ppg: 176   # the device offers 55 only without SDK mode\n"


def test_indent_of_counts_the_leading_spaces():
    assert VT.indent_of("    ppg: 55\n") == 4
    assert VT.indent_of("ppg: 55\n") == 0


def test_key_line_returns_the_index_or_the_absence():
    ls = lines(BASE)
    assert VT.value_of(ls[VT.key_line(ls, 0, len(ls), "root")]) == "/data/tepna"
    assert VT.key_line(ls, 0, len(ls), "sdk_mode") is None


def test_config_root_falls_back_to_the_filesystem_root():
    assert VT.config_root(lines(BASE)) == "/data/tepna"
    assert VT.config_root(lines("devices: []\n")) == "/"


# ── the block scan ────────────────────────────────────────────────────────────────────────────────


def test_device_blocks_names_both_items_and_ends_the_list_at_the_next_top_level_key():
    blocks = VT.device_blocks(lines(BASE))
    assert [b[2] for b in blocks] == ["VERITY-01", "H10-01"]
    lo, hi, _ = blocks[1]
    assert "".join(lines(BASE)[lo:hi]).endswith("streams: [ecg, acc]\n")


def test_a_device_list_that_runs_to_the_end_of_the_file_still_closes():
    text = "devices:\n  - name: VERITY-01\n    rates:\n      ppg: 55\n"
    blocks = VT.device_blocks(lines(text))
    assert blocks == [(1, 4, "VERITY-01")]


def test_an_empty_device_list_ends_with_no_block_open():
    assert VT.device_blocks(lines("devices:\n\npull:\n  enabled: true\n")) == []


def test_find_verity_refuses_an_absent_and_a_duplicated_block():
    with pytest.raises(VT.Refusal, match="no device block"):
        VT.find_verity(lines("devices:\n  - name: H10-01\n    streams: [ecg]\n"))
    twice = "devices:\n  - name: VERITY-01\n    streams: [ppg]\n  - name: verity-02\n    streams: [ppg]\n"
    with pytest.raises(VT.Refusal, match="2 Verity device blocks"):
        VT.find_verity(lines(twice))


def test_find_verity_returns_the_one_block_it_found():
    lo, hi, name = VT.find_verity(lines(BASE))
    assert name == "VERITY-01"
    assert lines(BASE)[lo].strip() == "- name: VERITY-01"
    assert lines(BASE)[hi].strip() == "- name: H10-01"


def test_rates_span_covers_the_nested_keys_and_a_blank_line():
    text = BASE.replace("      ppg: 55\n", "      ppg: 55\n\n")
    ls = lines(text)
    lo, hi, _ = VT.find_verity(ls)
    r0, r1 = VT.rates_span(ls, lo, hi)
    assert ls[r0].strip() == "rates:"
    assert "".join(ls[r0:r1]).count("acc: 52") == 1


def test_rates_span_reads_an_absent_key_as_absent_not_as_an_empty_span():
    ls = lines("devices:\n  - name: VERITY-01\n    streams: [ppg]\n")
    lo, hi, _ = VT.find_verity(ls)
    assert VT.rates_span(ls, lo, hi) is None


def test_rates_span_stops_at_the_end_of_the_block():
    ls = lines("devices:\n  - name: VERITY-01\n    rates:\n      ppg: 55\n")
    lo, hi, _ = VT.find_verity(ls)
    assert VT.rates_span(ls, lo, hi) == (2, 4)


def test_body_indent_refuses_a_block_with_no_body_keys():
    ls = lines("devices:\n  - name: VERITY-01\n")
    lo, hi, _ = VT.find_verity(ls)
    with pytest.raises(VT.Refusal, match="no body keys"):
        VT.body_indent_of(ls, lo, hi)


# ── the edit ──────────────────────────────────────────────────────────────────────────────────────


def test_the_edit_inserts_sdk_mode_after_streams_and_moves_the_rate():
    out, notes = VT.edit(lines(BASE), 176)
    assert notes == ["sdk_mode: ABSENT -> true (inserted)", "rates.ppg: 55 -> 176"]
    text = "".join(out)
    assert "    sdk_mode: true\n" in text
    assert text.index("sdk_mode") > text.index("streams: [ppg")
    assert "      ppg: 176\n" in text
    assert "      acc: 52\n" in text  # the sibling rate never moves
    assert yaml.safe_load(text)["devices"][1]["name"] == "H10-01"


def test_the_edit_anchors_on_address_when_streams_is_absent():
    text = "devices:\n  - name: VERITY-01\n    address: AA:BB:CC:DD:EE:FF\n    rates:\n      ppg: 55\n"
    out, _ = VT.edit(lines(text), 176)
    assert out[3] == "    sdk_mode: true\n"


def test_the_edit_anchors_on_the_item_line_when_neither_key_is_present():
    out, _ = VT.edit(lines("devices:\n  - name: VERITY-01\n    rates:\n      ppg: 55\n"), 176)
    assert out[2] == "    sdk_mode: true\n"


def test_an_already_true_sdk_mode_and_an_already_set_rate_are_reported_unchanged():
    text = BASE.replace("    streams: [ppg", "    sdk_mode: true\n    streams: [ppg").replace("ppg: 55", "ppg: 176")
    out, notes = VT.edit(lines(text), 176)
    assert notes == ["sdk_mode: already true (unchanged)", "rates.ppg: already 176 (unchanged)"]
    assert out == lines(text)


def test_a_false_sdk_mode_is_overwritten_in_place():
    text = BASE.replace("    streams: [ppg", "    sdk_mode: false\n    streams: [ppg")
    out, notes = VT.edit(lines(text), 176)
    assert notes[0] == "sdk_mode: false -> true"
    assert "sdk_mode: false" not in "".join(out)


def test_an_absent_rates_block_is_inserted_under_sdk_mode():
    text = "devices:\n  - name: VERITY-01\n    sdk_mode: true\n    streams: [ppg]\n"
    out, notes = VT.edit(lines(text), 176)
    assert notes == ["sdk_mode: already true (unchanged)", "rates: ABSENT -> rates.ppg = 176 (inserted)"]
    assert yaml.safe_load("".join(out))["devices"][0]["rates"] == {"ppg": 176}


def test_an_absent_ppg_joins_an_existing_rates_block():
    text = "devices:\n  - name: VERITY-01\n    sdk_mode: true\n    rates:\n      acc: 52\n"
    out, notes = VT.edit(lines(text), 176)
    assert notes[1] == "rates.ppg: ABSENT -> 176 (inserted)"
    assert yaml.safe_load("".join(out))["devices"][0]["rates"] == {"ppg": 176, "acc": 52}


def test_the_edit_refuses_a_config_with_no_verity_block():
    with pytest.raises(VT.Refusal, match="no device block"):
        VT.edit(lines("devices:\n  - name: H10-01\n    streams: [ecg]\n"), 176)


# ── the proof ─────────────────────────────────────────────────────────────────────────────────────


def test_the_proof_passes_the_edit_it_is_meant_to_pass():
    after, _ = VT.edit(lines(BASE), 176)
    assert VT.only_two_keys_moved(BASE, "".join(after), 176, LOAD) == []


def test_the_proof_passes_when_the_disk_already_held_both_keys():
    text = BASE.replace("    streams: [ppg", "    sdk_mode: false\n    streams: [ppg")
    after, _ = VT.edit(lines(text), 176)
    assert VT.only_two_keys_moved(text, "".join(after), 176, LOAD) == []


def test_the_proof_passes_when_the_disk_held_a_rates_block_without_ppg():
    text = "devices:\n  - name: VERITY-01\n    sdk_mode: true\n    rates:\n      acc: 52\n"
    after, _ = VT.edit(lines(text), 176)
    assert VT.only_two_keys_moved(text, "".join(after), 176, LOAD) == []


def test_the_proof_passes_when_the_disk_held_no_rates_block_at_all():
    text = "devices:\n  - name: VERITY-01\n    sdk_mode: true\n    streams: [ppg]\n"
    after, _ = VT.edit(lines(text), 176)
    assert VT.only_two_keys_moved(text, "".join(after), 176, LOAD) == []


def test_a_third_moved_value_is_the_finding_the_proof_exists_for():
    after, _ = VT.edit(lines(BASE), 176)
    tampered = "".join(after).replace("      acc: 52", "      acc: 26")
    assert VT.only_two_keys_moved(BASE, tampered, 176, LOAD) == [
        "a third value moved — the write changes more than the two keys"
    ]


def test_the_proof_reports_a_written_file_holding_the_wrong_number_of_verity_devices():
    assert VT.only_two_keys_moved(BASE, "devices: []\n", 176, LOAD) == ["the written file holds 0 Verity devices"]
    two = BASE.replace("  - name: H10-01", "  - name: VERITY-02")
    assert VT.only_two_keys_moved(BASE, two, 176, LOAD) == ["the written file holds 2 Verity devices"]


def test_the_proof_reports_a_disk_file_with_nothing_to_compare_against():
    after, _ = VT.edit(lines(BASE), 176)
    assert VT.only_two_keys_moved("devices:\n  - name: H10-01\n", "".join(after), 176, LOAD) == [
        "the file on disk holds no Verity device, so there is nothing to compare against"
    ]


def test_the_proof_reads_a_missing_devices_key_and_an_empty_document():
    assert VT.only_two_keys_moved(BASE, "pull:\n  enabled: true\n", 176, LOAD) == [
        "the written file holds 0 Verity devices"
    ]
    assert VT.only_two_keys_moved(BASE, "", 176, LOAD) == ["the written file holds 0 Verity devices"]


def test_the_proof_names_both_keys_when_neither_landed():
    after = BASE.replace("    streams: [ppg", "    sdk_mode: false\n    streams: [ppg")
    problems = VT.only_two_keys_moved(BASE, after, 176, LOAD)
    assert problems[0] == "sdk_mode reads False, not True"
    assert problems[1] == "rates.ppg reads 55, not 176"


def test_the_proof_names_the_rate_when_the_rates_block_is_absent_entirely():
    before = "devices:\n  - name: VERITY-01\n    streams: [ppg]\n"
    after = "devices:\n  - name: VERITY-01\n    sdk_mode: true\n    streams: [ppg]\n"
    assert VT.only_two_keys_moved(before, after, 176, LOAD) == ["rates.ppg reads None, not 176"]


# ── what the operator reads ───────────────────────────────────────────────────────────────────────


def test_the_warnings_name_the_streams_sdk_mode_silences():
    w = VT.warn_about(lines(BASE))
    assert "SDK mode disables ppi + hr" in w[0]
    assert any("8.60 %/h" in x for x in w)
    assert any("PMD START" in x for x in w)
    assert any("44-55 Hz" in x for x in w)


def test_the_warnings_name_gyro_and_mag_when_the_config_asks_for_them():
    text = BASE.replace("[ppg, acc, ppi, hr]", "[ppg, acc, gyro, mag]")
    w = VT.warn_about(lines(text))
    assert [x for x in w if "`gyro`" in x] and [x for x in w if "`mag`" in x]
    assert not [x for x in w if "SDK mode disables" in x]


def test_the_warnings_still_carry_the_measured_costs_with_no_streams_key():
    w = VT.warn_about(lines("devices:\n  - name: VERITY-01\n    rates:\n      ppg: 55\n"))
    assert len(w) == 3
    assert not [x for x in w if "SDK mode disables" in x]


def test_the_block_is_shown_with_the_address_redacted():
    shown = VT.show_block(lines(BASE))
    assert shown.startswith("  - name: VERITY-01")
    assert "<MAC>" in shown and "AA:BB" not in shown
    assert "H10-01" not in shown


def test_the_diff_is_redacted_and_empty_when_nothing_changes():
    before = lines(BASE)
    after, _ = VT.edit(before, 176)
    d = VT.diff_text(before, after)
    assert "+      ppg: 176" in d and "AA:BB" not in d
    assert VT.diff_text(before, before) == ""


def test_the_module_pins_the_rate_menu_sdk_mode_unlocks():
    assert VT.WANT_PPG == 176
    assert VT.SDK_RATES == (28, 44, 55, 135, 176)
