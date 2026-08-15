"""Tests for cpap_harvest — CPAP-AUTOHARVEST-2026-07-26-BRIEF.

The pure functions carry every decision that can silently corrupt a night, so they are what is tested:
listing parse (metadata/anchor alignment), STR.edf casing, skip-if-present, short-read detection, the
daily window, and the streaming interlock. Real card fixtures, captured 2026-07-26.
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_harvest as ch  # noqa: E402

# Verbatim from the real card (night 20260725). The leading spaces and the split date/time formatting
# are exactly as served — they are the reason a naive parser mis-aligns.
NIGHT_HTML = """
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG%5C20260725"> .</a>
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> ..</a>
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=D%5C202607~1.EDF"> 20260725_225050_CSL.edf</a>
   2026- 7-26    6:42:26           2KB  <a href="http://192.168.4.1/download?file=D%5C202607~2.EDF"> 20260725_225050_EVE.edf</a>
   2026- 7-26   10:10:56         204KB  <a href="http://192.168.4.1/download?file=D%5C202607~3.EDF"> 20260725_225058_PLD.edf</a>
   2026- 7-26   10:10:58          91KB  <a href="http://192.168.4.1/download?file=D%5C202607~4.EDF"> 20260725_225058_SA2.edf</a>
   2026- 7-26   10:10:58        2229KB  <a href="http://192.168.4.1/download?file=D%5C202607~5.EDF"> 20260725_225058_BRP.edf</a>
   Total Entries: 7 Total Size: 2527KB
"""

ROOT_HTML = """
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=JOURNAL.JNL"> JOURNAL.JNL</a>
   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> DATALOG</a>
   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CSETTINGS"> SETTINGS</a>
   2026- 7-26    6:42:26         105KB  <a href="http://192.168.4.1/download?file=STR.EDF"> STR.EDF</a>
   2026- 7-26    6:42:26           1KB  <a href="http://192.168.4.1/download?file=EZSHARE.CFG"> ezshare.cfg</a>
"""


def test_parse_aligns_metadata_with_the_right_file():
    """The bug this guards: metadata PRECEDES the anchor, so anchor-first parsing shifts every row by
    one. It looks plausible and is wrong — during Phase 0 it attributed a 91KB size to the 2229KB BRP
    file and produced a bogus throughput figure."""
    rows = ch.parse_listing(NIGHT_HTML)
    assert len(rows) == 5, [r["name"] for r in rows]          # . / .. dropped, footer not a file
    by = {r["name"]: r for r in rows}
    assert by["20260725_225050_CSL.edf"]["size"] == "1KB"
    assert by["20260725_225050_CSL.edf"]["mtime"] == "2026-7-26 3:50:50"
    assert by["20260725_225058_BRP.edf"]["size"] == "2229KB"   # the big one, correctly attributed
    assert by["20260725_225058_SA2.edf"]["size"] == "91KB"
    assert all(not r["isdir"] for r in rows)


def test_footer_is_not_mistaken_for_a_file():
    assert not any("Total" in r["name"] for r in ch.parse_listing(NIGHT_HTML))


def test_ignore_list_applied_and_dirs_flagged():
    rows = ch.parse_listing(ROOT_HTML)
    names = {r["name"] for r in rows}
    assert "JOURNAL.JNL" not in names and "ezshare.cfg" not in names   # device noise + card credentials
    assert {"DATALOG", "SETTINGS", "STR.EDF"} <= names
    assert {r["name"] for r in rows if r["isdir"]} == {"DATALOG", "SETTINGS"}


def test_str_edf_is_lowercased_and_nothing_else_is():
    """OSCAR and the resmed-edf adapter expect STR.edf. On a case-sensitive filesystem the served
    uppercase form yields a night with session EDFs and NO summary — partial data, not an obvious bug."""
    assert ch.local_name("STR.EDF") == "STR.edf"
    assert ch.local_name("STR.edf") == "STR.edf"
    assert ch.local_name("20260725_225058_BRP.edf") == "20260725_225058_BRP.edf"
    assert ch.local_name("Identification.json") == "Identification.json"


def test_size_kb_units():
    assert ch.size_kb("2229KB") == 2229
    assert ch.size_kb("1.5MB") == 1536
    assert ch.size_kb("832B") == 832 / 1024
    assert ch.size_kb("") == 0.0


def test_should_fetch_skips_present_refetches_wrong_size(tmp_path):
    e = {"name": "x.edf", "size": "100KB"}
    p = tmp_path / "x.edf"
    assert ch.should_fetch(e, str(p))                          # absent
    p.write_bytes(b"\0" * 100 * 1024)
    assert not ch.should_fetch(e, str(p))                      # right size -> skip (steady state is free)
    p.write_bytes(b"\0" * 40 * 1024)
    assert ch.should_fetch(e, str(p))                          # truncated on disk -> re-fetch, not trust


def test_short_read_detected():
    """A card that truncates under load writes an EDF that parses far enough to look real — the same
    class of failure as the part-decoded PMD frame in VIGIL-HARDENING-III §1."""
    e = {"name": "b.edf", "size": "2229KB"}
    assert ch.short_read(e, 1000 * 1024)
    assert not ch.short_read(e, 2229 * 1024)
    # `assert not ch.short_read(e, 2200 * 1024)  # rounding tolerance` USED TO BE HERE, and it was the
    # assertion pinning CAPTURE-HOST-DEEP-AUDIT §C5 green. 29 KB missing from a 2229 KB file is not
    # rounding — the listing prints integer KB, so its error is ±0.5 KB whatever the file's size. The
    # percentage tolerance that made 29 KB look like rounding is exactly what opened the 0-2 % band in
    # which a truncated EDF was accepted, reported ok, and skipped forever.
    assert ch.short_read(e, 2200 * 1024), "29 KB short is a truncation, not rounding"
    assert not ch.short_read(e, 2229 * 1024 - 400), "but a sub-0.5KB difference IS the listing rounding"
    assert not ch.short_read({"name": "x", "size": ""}, 5)      # unknown size never claims a short read


def test_the_skip_test_and_the_truncation_detector_cannot_disagree(tmp_path):
    """§C5's mechanism, stated directly. `should_fetch` allowed max(1.0, want*0.02) and `short_read`
    flagged only > max(2.0, want*0.05). Because 5 % > 2 %, EVERY truncation the detector could see was
    one the resume logic would re-fetch anyway — and the whole 0-2 % band was invisible to both, so the
    file was accepted, reported ok, and never repaired. They now share one tolerance by construction."""
    import os
    e = {"name": "BRP.edf", "size": "2229KB"}
    dest = str(tmp_path / "BRP.edf")
    for pct in (0.005, 0.01, 0.019, 0.021, 0.05):
        with open(dest, "wb") as fh:
            fh.write(b"x" * int(2229 * 1024 * (1 - pct)))
        got = os.path.getsize(dest)
        assert ch.short_read(e, got), f"{pct:.1%} truncation must be SEEN"
        assert ch.should_fetch(e, dest), f"{pct:.1%} truncation must be RE-FETCHED"


def test_the_tolerance_follows_the_listings_printed_precision():
    """Not a percentage: the only error the listing introduces is the quantization of the number it
    printed. `2229KB` is exact to ±0.5 KB whether the file is 2 KB or 2 GB — scaling that with the file
    is what gave a 2229 KB BRP.edf 44.6 KB of slack."""
    assert ch.size_tolerance_kb("2229KB") == 0.5
    assert ch.size_tolerance_kb("1.5MB") == 1024.0 / 20        # 0.1 MB quantum -> +/- 51.2 KB
    assert ch.size_tolerance_kb("832B") < 0.001 + 1e-9         # bytes are exact
    assert ch.size_tolerance_kb("") == 0.0


def test_due_now_fires_only_inside_a_bounded_window():
    """A FLOOR (`hour >= at_hour`) shipped once and was wrong. Observed live 2026-07-26: a 19:25 restart
    re-armed a 13:00 job, and since a deferral deliberately does not consume the day it then retried
    every 60 s — so it would have fired the moment the sensors came off at bedtime, starting a 2.4 GHz
    transfer at the START of a night. Only the streaming interlock stood in the way."""
    d = dt.date(2026, 7, 26)
    at = lambda h, m=5: dt.datetime(2026, 7, 26, h, m)   # noqa: E731
    assert not ch.due_now(at(12, 59), 13, None)          # before the window
    assert ch.due_now(at(13), 13, None)                  # open
    assert ch.due_now(at(14, 59), 13, None)              # still open (default 2 h)
    assert not ch.due_now(at(15), 13, None)              # CLOSED — waits for tomorrow
    assert not ch.due_now(at(19, 25), 13, None), "the 19:25 restart bug must not come back"
    assert not ch.due_now(at(13), 13, d)                 # already ran today
    assert ch.due_now(dt.datetime(2026, 7, 27, 13, 5), 13, d)   # next day reopens


def test_due_now_window_is_configurable():
    assert ch.due_now(dt.datetime(2026, 7, 26, 16, 0), 13, None, window_h=4)
    assert not ch.due_now(dt.datetime(2026, 7, 26, 17, 0), 13, None, window_h=4)


def test_nights_for_scopes():
    """`missing` is None — every night on the card, which with skip-if-present fetches only what is
    absent. `last` spans yesterday AND today so a session straddling midnight cannot be missed."""
    now = dt.datetime(2026, 7, 26, 13, 5)
    assert ch.nights_for("missing", now) is None
    assert ch.nights_for("last", now) == {"20260725", "20260726"}
    wk = ch.nights_for("week", now)
    assert len(wk) == 8 and "20260719" in wk and "20260726" in wk


def test_nine_am_would_have_missed_the_waveform():
    """Regression guard on the schedule decision itself. Real mtimes from 20260725: the flow waveform
    (BRP) was written at 10:10. Anything scheduled before that hour is wrong for this machine."""
    rows = {r["name"]: r["mtime"] for r in ch.parse_listing(NIGHT_HTML)}
    brp_hour = int(rows["20260725_225058_BRP.edf"].split()[1].split(":")[0])
    assert brp_hour == 10
    assert brp_hour > 9, "09:00 would have missed BRP.edf — see brief §3.2"


def test_a_streaming_device_blocks_the_harvest():
    devs = {"Polar H10": {"connected": True}, "O2Ring": {"connected": False}, "COOSPO": {}}
    assert ch.blocking_devices(devs) == ["Polar H10"]
    assert ch.blocking_devices({"a": {"connected": False}}) == []
    assert ch.blocking_devices({}) == []
    assert ch.blocking_devices(None) == []


def test_a_charging_or_off_body_sensor_does_NOT_block():
    """`connected` is not `streaming`. A docked sensor stays connected while producing nothing — the
    Verity refuses PMD outright while charging, and the ring reports worn=False on the dock. Blocking
    on `connected` made the window unreachable on any evening the sensors were charging, which is
    exactly when a pull is safest. Observed live 2026-07-26."""
    assert ch.blocking_devices({"Verity": {"connected": True, "charging": True}}) == []
    assert ch.blocking_devices({"Ring": {"connected": True, "charging": True, "worn": False}}) == []
    assert ch.blocking_devices({"Ring": {"connected": True, "worn": False}}) == []
    # the real state of the box that night: everything docked, nothing streaming
    assert ch.blocking_devices({"Polar Verity Sense": {"connected": True, "charging": True},
                                "Wellue O2Ring-S": {"connected": True, "charging": True, "worn": False},
                                "Polar H10": {"connected": False}}) == []
    # but a worn, streaming sensor still blocks — worn=True is not off-body
    assert ch.blocking_devices({"H10": {"connected": True, "worn": True}}) == ["H10"]


def test_is_night_dir():
    assert ch.is_night_dir({"isdir": True, "name": "20260725"})
    assert not ch.is_night_dir({"isdir": True, "name": "SETTINGS"})
    assert not ch.is_night_dir({"isdir": False, "name": "20260725"})


def test_size_kb_accepts_the_G_its_own_listing_regex_matches(tmp_path):
    """§E3. `_ROW` accepts `[KMG]?B` but `size_kb` had no G branch, so `2.5GB` fell through to the bytes
    case and became 0.0024 KB — producer and consumer disagreeing inside one file. A complete download
    then reads as an enormous over-read and is re-fetched forever. Latent on the real ResMed card
    (integer KB throughout, largest observed 2613 KB), which is why nothing caught it."""
    assert ch.size_kb("2.5GB") == 2.5 * 1024 * 1024
    assert ch.size_kb("1.5MB") == 1536.0
    assert ch.size_kb("2229KB") == 2229.0
    assert ch.size_kb("832B") == 832 / 1024
    # and the round trip that matters: a complete file is not a short read
    e = {"name": "big.edf", "size": "2.5GB"}
    assert not ch.short_read(e, int(2.5 * 1024 * 1024 * 1024))
    p = tmp_path / "big.edf"
    p.write_bytes(b"")
    assert ch.should_fetch(e, str(p)), "an empty local file is still missing the whole thing"


def test_due_now_window_wraps_midnight():
    """§E4. `at_hour <= h < at_hour + window_h` is arithmetic on a value that wraps mod 24, so a window
    starting late in the day was clipped at 23:59. With the shipped window_h=2 the only reachable clip
    is at_hour 23, which got one hour instead of two; the default 13 is unaffected."""
    import datetime as _d
    at = 23
    assert ch.due_now(_d.datetime(2026, 7, 26, 23, 30), at, None) is True
    assert ch.due_now(_d.datetime(2026, 7, 27, 0, 30), at, None) is True, "the second hour is past midnight"
    assert ch.due_now(_d.datetime(2026, 7, 27, 1, 30), at, None) is False, "and the window then closes"
    # the once-per-day key is the window's START date, so a post-midnight firing consumes the 26th
    d = ch.window_start_date(_d.datetime(2026, 7, 27, 0, 30), at)
    assert d == _d.date(2026, 7, 26)
    assert ch.due_now(_d.datetime(2026, 7, 27, 0, 45), at, d) is False, \
        "recording today's date instead would leave it due again a minute later, forever"


def test_the_default_window_is_unaffected_by_the_wrap_fix():
    """The control: at_hour 13 never wraps, and its behaviour must be byte-identical."""
    import datetime as _d
    for h, want in ((12, False), (13, True), (14, True), (15, False), (0, False)):
        assert ch.due_now(_d.datetime(2026, 7, 26, h, 0), 13, None) is want, h


# ── the size-window boundaries, landed ON rather than either side ───────────────────────────────────
def test_a_file_exactly_one_quantum_short_is_refetched_not_trusted():
    """The window is HALF-OPEN at the bottom: `(P - q, P]`. A file of exactly `P - q` KB is OUTSIDE it
    and must be re-fetched. The existing tests bracket this edge (100 KB and 40 KB against a 100 KB
    listing) without ever landing on it, so opening the low bound to `<=` is invisible to them — and
    that mutation silently ACCEPTS a file a whole quantum short, which is the §C5 hole this family
    exists to close."""
    lo, hi = ch.size_window_kb("2229KB")
    assert (lo, round(hi)) == (2228.0, 2229), "guard: the window is (P-1, P] for an integer-KB listing"
    assert ch.short_read({"size": "2229KB"}, int(lo * 1024)), \
        "exactly one quantum short is short — the low bound is exclusive"
    assert not ch.short_read({"size": "2229KB"}, int(lo * 1024) + 1), "one byte inside is complete"


def test_a_one_kb_listing_is_still_size_checked():
    """`want <= 0` means 'the listing told us nothing'. Moving it to `<= 1` makes every 1 KB file
    unverifiable — and the real card serves them (CSL is 832 B, listed 1KB)."""
    assert ch.size_kb("1KB") == 1.0
    assert ch.short_read({"size": "1KB"}, 0), "an empty body against a 1KB listing is short"
    assert not ch.short_read({"size": "1KB"}, 1024)


def test_content_length_zero_does_not_certify_an_empty_body():
    """`content_length > 0` is the guard for 'the server declared a length'. At `>= 0` a declared ZERO
    would be taken as authoritative and `got < 0` is never true, so an empty body reads as complete
    instead of falling through to the listing check."""
    assert ch.short_read({"size": "104KB"}, 0, 0), "0 bytes against a 104KB listing is short"
    # and a declared length of 1 must still be honoured rather than skipped
    assert ch.short_read({"size": "104KB"}, 0, 1)
    assert not ch.short_read({"size": "104KB"}, 1, 1)


def test_a_fractional_gigabyte_listing_scales_by_its_own_precision():
    """The G branch multiplies the decimal quantum by 1024^2. Every test here uses integer KB, where
    that branch never runs and any arithmetic in it — replacing the multiply, dividing instead, or an
    off-by-one on either 1024 — is unobservable. A whole `2GB` cannot see it either (quantum is 1.0 and
    `q = 1024*1024` equals `q *= 1024*1024`); it takes a FRACTIONAL value."""
    assert abs(ch.size_tolerance_kb("1.5GB") - 52428.8) < 1e-6, \
        "one decimal place on a GB listing is 0.1 GB, half of it is the tolerance"
    assert abs(ch.size_tolerance_kb("2GB") - 524288.0) < 1e-6
    assert abs(ch.size_tolerance_kb("1.5MB") - 51.2) < 1e-6


def test_a_part_that_differs_beyond_the_first_chunk_is_not_reaped(tmp_path):
    """`reap_stale_part` compares in 64 KB chunks and breaks on EOF. Breaking on a NON-empty chunk
    instead stops after the first one, so two files identical for 64 KB and different afterwards are
    declared identical and the `.part` is DELETED — destroying the only copy of an interrupted
    download's bytes, which is the one thing the .part convention exists to prevent. Same size on both
    sides, because the cheap getsize check would otherwise catch it first."""
    dest = tmp_path / "x.edf"
    dest.write_bytes(b"A" * 65536 + b"B" * 4000)
    part = tmp_path / "x.edf.part"
    part.write_bytes(b"A" * 65536 + b"C" * 4000)          # identical first chunk, differs after
    assert ch.reap_stale_part(str(dest)) is False
    assert part.exists(), "a .part that differs is evidence, not residue — it must survive"
    # the genuine case still reaps
    part.write_bytes(dest.read_bytes())
    assert ch.reap_stale_part(str(dest)) is True
    assert not part.exists()


def test_should_fetch_shares_short_reads_boundaries_not_just_its_verdict(tmp_path):
    """`should_fetch` and `short_read` carry PARALLEL copies of the window test and the `want <= 0`
    guard. Testing the boundaries on one leaves the other's copy unobservable — which is the §C5 hole
    in miniature: the two drifting apart is exactly the failure `size_tolerance_kb` was written to
    prevent, so both sides need the same edges landed on."""
    lo, _ = ch.size_window_kb("2229KB")
    p = tmp_path / "b.edf"
    p.write_bytes(b"\0" * int(lo * 1024))                  # exactly one quantum short
    assert ch.should_fetch({"size": "2229KB", "name": p.name}, str(p)), \
        "a file exactly at the low bound is OUTSIDE the half-open window — re-fetch it"
    p.write_bytes(b"\0" * (int(lo * 1024) + 1))
    assert not ch.should_fetch({"size": "2229KB", "name": p.name}, str(p))

    # `want <= 0` means "the listing told us nothing"; at `<= 1` every 1 KB file becomes untrustable,
    # and the real card serves them (CSL is 832 B, listed 1KB).
    q = tmp_path / "csl.edf"
    q.write_bytes(b"")
    assert ch.should_fetch({"size": "1KB", "name": q.name}, str(q)), \
        "an empty file against a 1KB listing must be re-fetched, not skipped as unverifiable"


# ── one rule, one encoding ──────────────────────────────────────────────────────────────────────────

def test_on_body_says_NO_for_a_charging_device_whatever_worn_claims():
    """*A charging device cannot be on a body.* The rule was encoded twice and only `blocking_devices`
    said so — `capture.autopull_poller` gated on `worn is True` alone. It matters most in exactly the
    contradictory state the Polar produces: a docked strap whose HR contact bit still reports skin
    contact (measured 2026-08-14, 3 h 24 m into a charger under `worn: True`)."""
    import telemetry
    assert telemetry.on_body({"connected": True, "charging": True, "worn": True}) is False
    assert telemetry.on_body({"connected": True, "worn": True}) is True
    assert telemetry.on_body({"connected": False, "worn": True}) is False


def test_on_body_returns_None_for_unknown_rather_than_guessing():
    """⚠️ THE ASYMMETRY IS THE POINT, not an oversight to tidy away. The two callers answer `None`
    differently because their costs differ: blocking a harvest on an unknown is cheap (the next run
    retries), while refusing to auto-pull on an unknown loses the ONLY backup for a lossy night.
    Collapsing this to a bool would silently pick one policy for both."""
    import telemetry
    assert telemetry.on_body({"connected": True}) is None
    assert telemetry.on_body({}) is False and telemetry.on_body(None) is False


def test_blocking_devices_still_blocks_on_UNKNOWN():
    """The conservative side of the asymmetry, pinned so a later "simplification" cannot flip it."""
    import cpap_harvest as ch
    assert ch.blocking_devices({"Ring": {"connected": True}}) == ["Ring"]
    assert ch.blocking_devices({"Ring": {"connected": True, "charging": True}}) == []
