# tepna-capture — tests/test_wifi_join.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Joining a Wi-Fi network from the monitor: what is parsed, what is refused, and what reaches disk.

🔴 THE CENTRAL TEST IS THAT THE PLAINTEXT PASSPHRASE NEVER LANDS. `wpa_passphrase` echoes it back as
a `#psk="…"` comment, so the obvious implementation — pipe its output to a file — stores the
cleartext beside the derivation that was supposed to replace it.
"""

import pytest

import wifi_join as W

# Real `wpa_cli scan_results` shape: bssid / frequency / signal / flags / ssid, tab-separated.
SCAN = "\n".join(
    [
        "bssid / frequency / signal level / flags / ssid",
        "aa:bb:cc:dd:ee:01\t2437\t-42\t[WPA2-PSK-CCMP][ESS]\tHotelGuest",
        "aa:bb:cc:dd:ee:02\t5180\t-71\t[WPA2-PSK-CCMP][ESS]\tHotelGuest",
        "aa:bb:cc:dd:ee:03\t2412\t-55\t[ESS]\tOpenCafe",
        "aa:bb:cc:dd:ee:04\t2462\t-38\t[WPA2-PSK-CCMP][WPS][ESS]\tPixel_Hotspot",
        "aa:bb:cc:dd:ee:05\t2437\t-60\t[WPA2-PSK-CCMP][ESS]\t",
        "malformed line",
        "aa:bb:cc:dd:ee:06\t2437\tNOTANUMBER\t[ESS]\tJunk",
    ]
)


def test_the_strongest_sighting_wins_and_duplicates_collapse():
    """Every hotel has one SSID on a dozen APs. Without collapsing, the picker is a wall of identical
    rows and the operator cannot tell which is which."""
    nets = W.parse_scan_results(SCAN)
    names = [n["ssid"] for n in nets]
    assert names.count("HotelGuest") == 1
    assert next(n for n in nets if n["ssid"] == "HotelGuest")["signal"] == -42


def test_networks_are_ordered_by_signal_so_the_likely_one_is_first():
    assert [n["ssid"] for n in W.parse_scan_results(SCAN)][:2] == ["Pixel_Hotspot", "HotelGuest"]


def test_a_HIDDEN_network_is_dropped_rather_than_shown_as_blank():
    """A blank SSID cannot be joined by name from a list — offering it would be a control that
    cannot work, and a blank row reads as a rendering bug."""
    assert all(n["ssid"] for n in W.parse_scan_results(SCAN))
    assert "" not in [n["ssid"] for n in W.parse_scan_results(SCAN)]


def test_security_is_read_from_the_FLAGS_not_guessed():
    nets = {n["ssid"]: n for n in W.parse_scan_results(SCAN)}
    assert nets["HotelGuest"]["security"] == W.SECURED
    assert nets["OpenCafe"]["security"] == W.OPEN


def test_malformed_rows_and_headers_are_skipped_not_counted():
    nets = W.parse_scan_results(SCAN)
    assert "Junk" not in [n["ssid"] for n in nets]  # unparseable signal
    assert len(nets) == 3
    assert W.parse_scan_results("") == [] and W.parse_scan_results(None) == []


# ── validation, before anything reaches a command line ─────────────────────────────────────────


def test_a_too_short_or_too_long_password_is_refused_with_a_SENTENCE():
    ok, err = W.validate_passphrase("Net", "short")
    assert ok is False and "at least 8" in err
    ok2, err2 = W.validate_passphrase("Net", "x" * 64)
    assert ok2 is False and "at most 63" in err2


def test_an_ORDINARY_valid_passphrase_is_accepted():
    """The commonest case of all, and it was covered by nothing — every other validation test asserts
    a REJECTION, so the success path was reachable only in production. The coverage floor caught it."""
    assert W.validate_passphrase("HotelGuest", "hunter2hunter2") == (True, None)
    assert W.validate_passphrase("Net", "x" * W.MIN_PSK_LEN)[0] is True
    assert W.validate_passphrase("Net", "x" * W.MAX_PSK_LEN)[0] is True


def test_a_raw_64_hex_PSK_is_accepted_as_is():
    """Someone pasting a PSK rather than a passphrase is not an error — it is the same secret one
    derivation later."""
    assert W.validate_passphrase("Net", "a" * 64)[0] is True


def test_an_OPEN_network_takes_no_password_and_says_so():
    assert W.validate_passphrase("Cafe", "", W.OPEN)[0] is True
    ok, err = W.validate_passphrase("Cafe", "somepass", W.OPEN)
    assert ok is False and "open" in err


def test_an_absent_or_oversized_ssid_is_refused():
    assert W.validate_passphrase("", "abcdefgh")[0] is False
    assert W.validate_passphrase("  ", "abcdefgh")[0] is False
    assert W.validate_passphrase("x" * 33, "abcdefgh")[0] is False


# ── 🔴 the security property ───────────────────────────────────────────────────────────────────


def test_THE_PLAINTEXT_NEVER_SURVIVES_SANITISING():
    """The whole point. `wpa_passphrase` echoes the passphrase back as a comment; writing its output
    verbatim stores the cleartext next to the PSK meant to replace it."""
    secret = "correct horse battery staple"
    raw = 'network={\n\tssid="Net"\n\t#psk="%s"\n\tpsk=%s\n}' % (secret, "de" * 32)
    clean = W.sanitize_block(raw, secret)
    assert secret not in clean, "the plaintext passphrase survived into the stored block"
    assert "psk=" + "de" * 32 in clean, "the derivation itself was lost"
    assert 'ssid="Net"' in clean


def test_an_UNEXPECTED_output_shape_that_still_holds_the_plaintext_is_REFUSED():
    """Belt and braces: if a future `wpa_passphrase` emits the passphrase somewhere the comment regex
    does not match, the write must fail loudly rather than quietly storing it."""
    secret = "notarealpassword"
    with pytest.raises(ValueError, match="plaintext"):
        W.sanitize_block('network={\n\tssid="%s"\n}' % secret, secret)


def test_sanitising_handles_an_empty_or_absent_block():
    assert W.sanitize_block("") == "" and W.sanitize_block(None) == ""


# ── the config file ────────────────────────────────────────────────────────────────────────────


def test_the_config_carries_a_ctrl_interface_or_nothing_can_confirm_the_association():
    """The harvest's own header records why this is not optional: without it the daemon starts,
    associates or not, and creates no control socket — so the association can never be confirmed."""
    txt = W.config_text(['network={\n\tssid="A"\n}'], "/run/tepna-wpa")
    assert txt.startswith("ctrl_interface=/run/tepna-wpa\n")
    assert "update_config=1" in txt and 'ssid="A"' in txt


def test_empty_blocks_are_dropped_so_the_file_stays_parseable():
    txt = W.config_text(["", None, 'network={\n\tssid="A"\n}', "   "], "/run/x")
    assert txt.count("network={") == 1


# ── one radio, two users: the uplink yields to the harvest ─────────────────────────────────────


def test_a_JOINED_uplink_is_suspended_so_the_harvest_can_take_the_radio():
    act, why = W.suspend_plan(W.JOINED, "HotelGuest")
    assert act is True and "HotelGuest" in why


def test_nothing_to_suspend_when_no_uplink_is_up():
    assert W.suspend_plan(W.IDLE, "HotelGuest")[0] is False
    assert W.suspend_plan(W.SUSPENDED, "HotelGuest")[0] is False


def test_a_joined_uplink_with_NOTHING_SAVED_is_left_alone():
    """Dropping it would be a suspend with no way back — a one-way trip dressed as a pause."""
    act, why = W.suspend_plan(W.JOINED, "")
    assert act is False and "no saved network" in why


def test_RESUME_HAPPENS_EVEN_WHEN_THE_HARVEST_FAILED():
    """🔴 The dangerous half. A failed harvest is exactly when the box most needs to be reachable, and
    resuming only on success turns a crash into an indefinite outage — the harvest window is 5400 s,
    and 'until someone walks over with a keyboard' is not a window at all."""
    for outcome in (True, False, None):
        act, why = W.should_resume(W.SUSPENDED, "HotelGuest", outcome)
        assert act is True, outcome
    assert "FAILED" in W.should_resume(W.SUSPENDED, "HotelGuest", False)[1]
    assert "ok" in W.should_resume(W.SUSPENDED, "HotelGuest", True)[1]


def test_resume_does_nothing_when_nothing_was_suspended():
    assert W.should_resume(W.IDLE, "HotelGuest")[0] is False
    assert W.should_resume(W.JOINED, "HotelGuest")[0] is False
    assert W.should_resume(W.SUSPENDED, None)[0] is False
