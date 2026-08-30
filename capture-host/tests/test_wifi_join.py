# tepna-capture — tests/test_wifi_join.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Joining a Wi-Fi network from the monitor: what is parsed, what is refused, and what reaches disk.

🔴 THE CENTRAL TEST IS THAT THE PLAINTEXT PASSPHRASE NEVER LANDS. `wpa_passphrase` echoes it back as
a `#psk="…"` comment, so the obvious implementation — pipe its output to a file — stores the
cleartext beside the derivation that was supposed to replace it.
"""

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


# ── derive_psk ────────────────────────────────────────────────────────────────────────────────────
# The vector is `wpa_passphrase TestNet "correct horse battery"`, captured 2026-08-30. Pinning against
# the reference implementation is the point: a PSK we derive differently from every other supplicant on
# earth would associate with nothing, and would do it while looking perfectly well-formed.
def test_PSK_MATCHES_WPA_PASSPHRASE_BYTE_FOR_BYTE():
    assert W.derive_psk("TestNet", "correct horse battery") == (
        "6a4c6233c07e5ca2a9eb92472aff2b8c200be20561592c9dcc5124d880ab49ec"
    )


def test_THE_SSID_IS_THE_SALT_SO_THE_SAME_PASSWORD_DIFFERS_PER_NETWORK():
    # Not a property test for its own sake: PBKDF2's salt is the SSID, and an implementation that
    # dropped it would still return 64 plausible hex characters for every input. This is the assertion
    # that can tell those two apart.
    a = W.derive_psk("HotelWifi", "correct horse battery")
    b = W.derive_psk("MyHotspot", "correct horse battery")
    assert a != b
    assert len(a) == len(b) == 64


def test_AN_ALREADY_DERIVED_PSK_IS_NOT_DERIVED_AGAIN():
    raw = "A" * 64
    assert W.derive_psk("AnyNet", raw) == "a" * 64      # passed through, lowercased


def test_A_NON_ASCII_PASSPHRASE_DERIVES_WITHOUT_RAISING():
    psk = W.derive_psk("Café", "heslohesloé")
    assert len(psk) == 64 and int(psk, 16) >= 0


# ── a hidden network is an ESCAPE STRING, not a blank field ───────────────────────────────────────
# Captured from the real radio on vigil 2026-08-30 — the first scan this code ever ran against live
# air. The prior test used "" for a hidden network because that is what one was IMAGINED to look like;
# nothing had asked the hardware. wpa_cli renders a non-printable ssid as escape sequences, so the
# hidden AP sailed through the blank check and rendered in the picker as a clickable row of `\x00`s
# that could never join anything.
BS = chr(92)
_REAL_SCAN = (
    "bssid / frequency / signal level / flags / ssid\n"
    "10:5a:95:88:79:ed\t5180\t-57\t[WPA2-PSK+SAE+FT/PSK+FT/SAE-CCMP][SAE-H2E][ESS]\tRidgemoore\n"
    "10:5a:95:88:79:ec\t2437\t-58\t[WPA2-PSK+SAE+FT/PSK+FT/SAE-CCMP][SAE-H2E][ESS]\tRidgemoore\n"
    "52:dc:e7:1f:45:0e\t5745\t-62\t[WPA2-PSK-CCMP][ESS]\t" + (BS + "x00") * 25 + "\n"
    "f4:55:95:11:3f:24\t2462\t-18\t[WPA2-PSK-CCMP][ESS]\tez Share\n"
)


def test_A_HIDDEN_NETWORK_ARRIVES_AS_ESCAPES_AND_IS_DROPPED():
    names = [n["ssid"] for n in W.parse_scan_results(_REAL_SCAN)]
    assert names == ["ez Share", "Ridgemoore"], names
    assert not any(BS + "x00" in n for n in names), "the escape-string hidden network reached the picker"


def test_AN_ESCAPE_INSIDE_A_REAL_NAME_IS_NOT_A_HIDDEN_NETWORK():
    # The opposite failure, and the worse one: a café's non-ASCII name is escaped by wpa_cli too, so a
    # rule that drops anything CONTAINING an escape would hide joinable networks. The check is anchored
    # to the whole field for exactly this reason.
    scan = ("bssid\tfrequency\tsignal level\tflags\tssid\n"
            "aa:bb:cc:dd:ee:ff\t2412\t-40\t[ESS]\tCaf" + BS + "xc3" + BS + "xa9 WiFi\n")
    assert [n["ssid"] for n in W.parse_scan_results(scan)] == ["Caf" + BS + "xc3" + BS + "xa9 WiFi"]


def test_THE_REAL_SCAN_STILL_COLLAPSES_ONE_NETWORK_ON_TWO_BANDS():
    # Ridgemoore advertises on 5180 and 2437 from the same router; the picker must show it once, at its
    # strongest sighting. This is real duplication from the capture, not a synthetic case.
    rows = [n for n in W.parse_scan_results(_REAL_SCAN) if n["ssid"] == "Ridgemoore"]
    assert len(rows) == 1 and rows[0]["signal"] == -57


def test_AN_SSID_THAT_IS_LITERALLY_THE_WORD_NONE_IS_STILL_A_NAME():
    scan = ("bssid\tfrequency\tsignal level\tflags\tssid\n"
            "aa:bb:cc:dd:ee:01\t2412\t-40\t[ESS]\tnone\n")
    assert [n["ssid"] for n in W.parse_scan_results(scan)] == ["none"]
