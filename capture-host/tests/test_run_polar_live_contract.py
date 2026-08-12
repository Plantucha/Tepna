# tepna-capture — tests/test_run_polar_live_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""What `run_polar` hands the LIVE BUS — the monitor's cards, asserted by observing the calls.

WHY THIS FILE EXISTS. A mutation pass over `run_polar` (1286 mutants, 2026-08-08) left 655 survivors,
and the single largest coherent family — 69 of them — was `BUS.register` / `BUS.push` /
`BUS.unregister` with an argument DROPPED or replaced by `None`. Every one survived because nothing in
the suite looked at what those calls receive. `test_telemetry.py` exercises the bus directly with
hand-written calls; `test_capture_runners.py` drives `run_polar` and then asserts on FILES. Between
them sat the whole live-telemetry contract, unobserved.

That is not a hypothetical gap. Both defects this path has actually shipped were argument defects:

  * 2026-08-05 — the initial registration passed `pmd.SAMPLE_HZ[meas]`, the rate the HARDWARE ships at,
    not the rate this box negotiated. `telemetry.stream_health` judges WEAK as `eff_fs < 0.7*nominal`,
    so ACC delivering its agreed 25 Hz against a declared 200 scored 0.125 and painted amber all night.
    The fix registers 0 = "rate unknown" until START succeeds.
  * the `bpm` card did not exist — the strap's own HR was written to file and never registered, so it
    had no card at all, while RR did.

Neither is visible in a file on disk. Both are one argument.

⚠️ THIS REPLACES A SOURCE SCAN. `test_telemetry.py::test_capture_registers_pmd_streams_with_an_
UNKNOWN_rate_until_negotiated` pins the 2026-08-05 fix by grepping capture.py for `SAMPLE_HZ`, and says
why: *"the registration sits deep inside run_polar's per-connection setup, behind a live BLE session
that no unit test reaches. A behavioural test here would need the device."* That premise is FALSE —
`FlexPolarClient` in test_capture_runners.py negotiates all six PMD streams with no device at all, and
the two-phase registration is plainly visible in the calls. A text scan cannot tell `0` from `1`
(mutant 312 does exactly that and survives it); observing the call can. The scan is left in place — it
guards a different thing, the literal in the source — but it is no longer the only guard.
"""
import asyncio
import sys

import capture
import polar_pmd as pmd

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import test_capture_runners as T          # the fixture family: FlexPolarClient, _pdev, _polar_common


# The SAME module-global reset test_capture_runners.py uses, re-exported rather than re-implemented.
# `run_polar` mutates a lot of process-wide state, above all `_STOP`; without this the first test to
# finish leaves the runner stopped and every later one silently drives NOTHING — which reads as "the
# bus was never called", i.e. exactly the failure this file is supposed to detect. Re-implementing the
# reset here would be a second copy to drift; importing the fixture keeps one definition.
_clean_stop = T._clean_stop


class SpyBus:
    """Records every bus call verbatim.

    NOT a partial double — it captures the FULL arg tuple, args and kwargs, because the defect class
    being pinned here is an argument going MISSING, and a spy that stored only the fields it happens to
    care about would be blind to exactly that (`blind_spots.py`'s whole premise).

    Any bus method this spy does not model raises rather than no-ops: a silently swallowed call is an
    unasserted call, which is the state this file exists to end."""

    def __init__(self):
        self.seen: dict[str, list] = {"register": [], "push": [], "unregister": []}

    def register(self, *a, **k): self.seen["register"].append((a, k))
    def push(self, *a, **k): self.seen["push"].append((a, k))
    def unregister(self, *a, **k): self.seen["unregister"].append((a, k))

    def __getattr__(self, name):
        raise AttributeError(f"run_polar called BUS.{name}() — unmodelled by this spy, so unasserted")


def _spy(monkeypatch):
    b = SpyBus()
    monkeypatch.setattr(capture, "BUS", b)
    return b


def _spy_set(monkeypatch, into: list):
    """Record every `_set()` call into `into`, WITHOUT replacing it.

    The status card is cumulative — a later `_set` overwrites an earlier one — so the final STATUS dict
    cannot show that an intermediate call lost a field, and that is the defect class here. A recorder
    that stood IN for `_set` would break every downstream read (`link_epoch`'s counter, the charging
    inference), so this one wraps and delegates."""
    real = capture._set

    def rec(name, **kv):
        into.append((name, dict(kv)))
        return real(name, **kv)

    monkeypatch.setattr(capture, "_set", rec)


def _drive(monkeypatch, tmp_path, streams, frames=None, start_status=0x00, hr_frame=None,
           sets=None):
    """One full run_polar session against the fake Polar, returning the recorded bus calls.

    Pass a list as `sets` to also collect every `_set()` call into it. Trailing and optional, so every
    caller above is untouched."""
    bus = _spy(monkeypatch)
    if sets is not None:
        _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    if frames is None:
        frames = [T._ecg_frame(), T._acc_frame(), T._ppg_frame(),
                  T._gyro_frame(), T._mag_frame(), T._ppi_frame()]
    c = T.FlexPolarClient(data_frames=frames, start_status=start_status, hr_frame=hr_frame)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=streams), str(tmp_path)))
    return bus


# ── the card's identity: key · label · unit · channels · labels ─────────────────────────────────────
# Every field here drives something the operator SEES. A dropped `unit` mislabels the axis; a dropped
# `chans` collapses a 3-axis trace to one; a dropped `labels` unnames the series. None of it reaches a
# file, so none of it was covered.
EXPECT = {
    "ecg":      ("ECG (H10)",  "µV",  1, ()),
    "acc_h10":  ("ACC (H10)",  "mg",  3, ("X", "Y", "Z")),
    "ppg_h10":  ("PPG (H10)",  "raw", 4, ("LED1", "LED2", "LED3", "ambient")),
    "gyro_h10": ("Gyro (H10)", "dps", 3, ("X", "Y", "Z")),
    "mag_h10":  ("Mag (H10)",  "G",   3, ("X", "Y", "Z")),
    "ppi_h10":  ("PPI (H10)",  "ms",  2, ("PP-int", "HR")),
}
ALL6 = ["ecg", "acc", "ppg", "gyro", "mag", "ppi"]


def test_every_pmd_stream_registers_its_full_card_identity(tmp_path, monkeypatch):
    bus = _drive(monkeypatch, tmp_path, ALL6)
    first = {}
    for a, _k in [(c[0], c[1]) for c in bus.seen["register"]]:
        first.setdefault(a[0], a)
    assert set(first) == set(EXPECT), f"registered keys {sorted(first)} != {sorted(EXPECT)}"
    for key, (label, unit, chans, labels) in EXPECT.items():
        got = first[key]
        assert len(got) == 6, f"{key}: register() lost an argument — got {got}"
        assert got[1] == label, f"{key}: label {got[1]!r} != {label!r}"
        assert got[2] == unit, f"{key}: unit {got[2]!r} != {unit!r} — the axis would be mislabelled"
        assert got[4] == chans, f"{key}: {got[4]} channels != {chans} — the trace shape is wrong"
        assert tuple(got[5]) == labels, f"{key}: series labels {got[5]} != {labels}"


def test_the_ecg_key_is_BARE_and_the_rest_are_DEVICE_QUALIFIED(tmp_path, monkeypatch):
    """`_live_key`'s rule, observed rather than read: a stream only one sensor can produce keeps the bare
    key; everything else is suffixed, because two straps' ACC must not collide on one card (#410)."""
    bus = _drive(monkeypatch, tmp_path, ALL6)
    keys = {c[0][0] for c in bus.seen["register"]}
    assert "ecg" in keys and "ecg_h10" not in keys, "ECG is unique to the chest strap — bare key"
    for s in ("acc", "ppg", "gyro", "mag", "ppi"):
        assert f"{s}_h10" in keys and s not in keys, f"{s} must be device-qualified, not bare"


# ── the 2026-08-05 fix, behaviourally ───────────────────────────────────────────────────────────────
def test_a_stream_registers_at_rate_UNKNOWN_and_only_then_at_the_NEGOTIATED_rate(tmp_path, monkeypatch):
    """The two-phase registration. `0` means "irregular / rate unknown" and routes stream_health to the
    silence-only branch; any other value is a rate the device never agreed to, judged against."""
    bus = _drive(monkeypatch, tmp_path, ALL6)
    by_key: dict[str, list] = {}
    for c in bus.seen["register"]:
        by_key.setdefault(c[0][0], []).append(c[0])
    for key, calls in by_key.items():
        assert len(calls) == 2, f"{key}: expected register(unknown) then register(negotiated), got {len(calls)}"
        assert calls[0][3] == 0, (
            f"{key} was first registered at fs={calls[0][3]!r}, not 0. Between START and the re-register "
            "every stream would carry a nominal it never agreed to, and stream_health paints WEAK "
            "against it (measured 2026-08-04: ACC 0.125, MAG 0.21, neither a weak link).")
        assert calls[1][3] == 130, f"{key}: re-registered at {calls[1][3]}, not the negotiated 130 Hz"
        assert calls[0][0] == calls[1][0] and calls[0][1] == calls[1][1], (
            f"{key}: the re-register must replace the SAME card, not create a second one")


def test_an_hr_strap_registers_BOTH_the_rr_and_the_bpm_card(tmp_path, monkeypatch):
    """RR is the HRV substrate; bpm is the device's own reading. Both are real and both need a card —
    for a while only RR had one, and the strap's HR had no card at all."""
    bus = _drive(monkeypatch, tmp_path, ["ecg", "hr"])
    got = {c[0][0]: c[0] for c in bus.seen["register"]}
    assert "hr_h10" in got and "bpm_h10" in got, f"registered {sorted(got)} — an HR card is missing"
    assert got["hr_h10"][1:] == ("RR (H10)", "ms", 0), got["hr_h10"]
    assert got["bpm_h10"][1:] == ("HR (H10)", "bpm", 0), got["bpm_h10"]


# ── what actually reaches the plot ──────────────────────────────────────────────────────────────────
def test_each_stream_pushes_its_own_shape_and_its_own_device_clock(tmp_path, monkeypatch):
    bus = _drive(monkeypatch, tmp_path, ALL6)
    pushed = {c[0][0]: c for c in bus.seen["push"]}
    assert set(pushed) >= set(EXPECT), f"pushed {sorted(pushed)} — a stream reached no card"

    ecg_a, ecg_k = pushed["ecg"]
    assert all(not isinstance(v, list) for v in ecg_a[1]), (
        f"ECG is single-channel — push a flat scalar series, got {ecg_a[1][:2]}")
    for key in ("acc_h10", "ppg_h10", "gyro_h10", "mag_h10"):
        a, _k = pushed[key]
        assert all(isinstance(v, list) for v in a[1]), f"{key} is multi-channel — push lists, not scalars"

    # dev_ns is the DEVICE's own counter. effFs is measured off it rather than off arrival times,
    # because BLE hands several frames over per connection event and their arrival times collapse
    # together — an arrival denominator reports the radio's batching, not the sensor's rate.
    for key in ("ecg", "acc_h10", "ppg_h10", "gyro_h10", "mag_h10"):
        assert pushed[key][1].get("dev_ns"), f"{key}: dev_ns missing — effFs would measure the radio"
    assert "dev_ns" not in pushed["ppi_h10"][1], (
        "PPI is per-beat by construction (SAMPLE_HZ[PPI]=0) — it has no rate to measure and must be "
        "judged on silence alone")


def test_ppi_is_pushed_as_PP_interval_then_HR_not_the_decode_order(tmp_path, monkeypatch):
    """`[s.values[1], s.values[0]]` — the swap is deliberate and invisible in any file: the card plots
    the interval, the badge reads the HR. Reversed, the plot shows heart rate in millisecond units."""
    bus = _drive(monkeypatch, tmp_path, ALL6)
    a, _k = next(c for c in bus.seen["push"] if c[0][0] == "ppi_h10")
    rows = a[1]
    assert rows and all(len(r) == 2 for r in rows), f"PPI pushes [PP-int, HR] pairs, got {rows[:2]}"
    ppint, hr = rows[0]
    assert ppint > hr, (
        f"PPI pushed [{ppint}, {hr}] — a plausible interval (ms) exceeds a plausible HR (bpm); "
        "these look swapped, which puts bpm on a millisecond axis")


def test_a_rejected_stream_unregisters_its_card_instead_of_leaving_it_idle(tmp_path, monkeypatch):
    """START rejected on unsupported settings: the writer is discarded AND the card removed. Leaving the
    card would show a stream that will never tick, indistinguishable from a dead one."""
    bus = _drive(monkeypatch, tmp_path, ["ecg"], start_status=0x02)   # 0x02 = invalid setting, not transient
    assert bus.seen["unregister"], "a rejected stream left its card on the monitor"
    assert bus.seen["unregister"][0][0][0] == "ecg", bus.seen["unregister"]


# ── the HR strap's two live series ──────────────────────────────────────────────────────────────────
# `on_hr` is a separate callback from `on_pmd` and pushes to two DIFFERENT cards from one frame. Driving
# a PMD session alone never enters it, which is why 18 of this family's mutants survived the first pass:
# every assertion above was about streams `on_hr` does not touch.
def test_an_hr_frame_pushes_the_rr_series_and_the_bpm_series_to_their_OWN_cards(tmp_path, monkeypatch):
    hr = bytes([0x06, 57]) + (870).to_bytes(2, "little")   # contact supported+detected, bpm 57, one RR
    bus = _drive(monkeypatch, tmp_path, ["ecg", "hr"], frames=[T._ecg_frame()], hr_frame=hr)
    pushed = {c[0][0]: c[0] for c in bus.seen["push"]}
    assert "hr_h10" in pushed, f"the RR series reached no card — pushed {sorted(pushed)}"
    assert "bpm_h10" in pushed, (
        "the strap's own HR reached no card. RR and bpm are two real series from one frame — for a "
        "while only RR was pushed and the device's HR had no card at all.")
    # RR arrives in the SIG's 1/1024 s units and must reach the card in MILLISECONDS. 870/1024*1000 =
    # 849.6 -> 850. Pushing the raw 870 would be a silent +2.4 % on every interval, which is a plausible
    # number in a plausible unit — the shape of error nothing downstream can catch.
    assert pushed["hr_h10"][1] == [round(870 / 1024 * 1000)], (
        f"RR must be converted from 1/1024 s to ms, got {pushed['hr_h10'][1]}")
    assert pushed["bpm_h10"][1] == [57.0], f"bpm must be the device's own reading, got {pushed['bpm_h10'][1]}"
    # 0 = "irregular / rate unknown", the same honesty PPI uses: beats are not a sample rate. A nominal
    # here would send stream_health judging an aperiodic series against a rate nobody agreed to.
    assert pushed["hr_h10"][2] == 0, f"RR pushed at fs={pushed['hr_h10'][2]!r} — beats have no rate"
    assert pushed["bpm_h10"][2] == 0, f"bpm pushed at fs={pushed['bpm_h10'][2]!r} — beats have no rate"


def test_a_rejected_DEVICE_QUALIFIED_stream_unregisters_the_qualified_key(tmp_path, monkeypatch):
    """The sibling test above rejects ECG, whose key is BARE — so for it `_live_key(name, tag)` ignores
    the tag entirely and any mutation of the tag argument is equivalent. Rejecting ACC makes the tag
    load-bearing: unregister the unqualified `acc` and the H10's card survives while some other device's
    is torn down."""
    bus = _drive(monkeypatch, tmp_path, ["acc"], frames=[T._acc_frame()], start_status=0x02)
    assert bus.seen["unregister"], "a rejected stream left its card on the monitor"
    key = bus.seen["unregister"][0][0][0]
    assert key == "acc_h10", (
        f"unregistered {key!r}, not 'acc_h10' — an unqualified key removes the wrong device's card "
        "(#410: two sensors both stream ACC)")


def test_every_pmd_push_declares_a_rate_and_ppi_declares_ZERO(tmp_path, monkeypatch):
    """The `fs` on a push is not the same number as the `fs` on a register, and it is used differently.

    `stream_health` judges WEAK against the REGISTERED nominal (`m.fs`), so a wrong push rate does not
    paint amber — I checked, having assumed otherwise. What it does drive is `msg["fs"]`, the rate the
    live SSE frame declares and the monitor plots its time axis against, and the ring capacity
    (`max(64, ring_seconds * rate)`). A `None` there collapses to `rate = 1` while the card is still at
    the pre-negotiation `fs=0`, which is a one-sample-per-second axis under a 130 Hz trace.

    THE FALLBACK BRANCH IS WHAT THIS EXERCISES, on purpose. `hz` is `stream_fs.get(meas) or
    pmd.SAMPLE_HZ.get(meas)`, and here the fake delivers its frames at PMD_DATA subscribe time — before
    the per-stream negotiation sets `stream_fs`. That is not only a fixture quirk: the code documents a
    real device doing the same thing (an H10 stream still owned by a dead subscriber keeps notifying,
    polar-ble-sdk#287), and the NO_ACK arm deliberately keeps such a stream without setting `stream_fs`.
    So the vendor-default fallback is a live path, and it should be pinned rather than assumed absent."""
    bus = _drive(monkeypatch, tmp_path, ALL6)
    pushed = {c[0][0]: c[0] for c in bus.seen["push"]}
    for stream, key in (("ecg", "ecg"), ("acc", "acc_h10"), ("ppg", "ppg_h10"),
                        ("gyro", "gyro_h10"), ("mag", "mag_h10")):
        hz = pushed[key][2]
        assert hz == pmd.SAMPLE_HZ[getattr(pmd, stream.upper())], (
            f"{key} pushed at fs={hz!r}; with no negotiated rate yet the documented fallback is the "
            f"vendor nominal {pmd.SAMPLE_HZ[getattr(pmd, stream.upper())]}")
    assert pushed["ppi_h10"][2] == 0, (
        f"PPI pushed at fs={pushed['ppi_h10'][2]!r} — it is per-beat by construction "
        "(SAMPLE_HZ[PPI] = 0) and 0 is the 'no rate' marker; None would become rate=1")


# ══ the STATUS card: what an operator and every alert actually read ═════════════════════════════════
# Second family from the same pass: 45 REACHABLE survivors on `_set()` lines, the identical shape to
# the bus family — a keyword argument dropped or set to None. `_set` writes STATUS["devices"][name],
# which is what status.json carries, what monitor.html paints, and what alerts.py keys on. None of it
# reaches a capture file either, so the file-based assertions could not see any of it.
#
# Asserted on the RECORDED CALLS, not only on the final dict: the card is cumulative, so a later `_set`
# hides a field an earlier one dropped. `connected=False, address=addr, last_error=None` is overwritten
# within milliseconds by `connected=True`, and the whole point is that it ran.
def _fields(sets, **must):
    """Every recorded _set call whose kwargs match `must` exactly on those keys."""
    return [kv for _n, kv in sets if all(k in kv and kv[k] == v for k, v in must.items())]


def test_a_session_opens_by_clearing_the_card_and_naming_the_ADDRESS(tmp_path, monkeypatch):
    """`_set(name, connected=False, address=addr, last_error=None)` — three fields, one call, and each
    one matters separately. Dropping `last_error=None` leaves the PREVIOUS session's failure on the card
    for the whole of a healthy one; dropping `address` leaves the card unable to say which sensor it is."""
    sets: list = []
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()], sets=sets)
    opening = _fields(sets, connected=False, address="24:AC:AC:02:84:96", last_error=None)
    assert opening, (
        "no _set opened the session with connected=False + address + last_error=None; recorded: "
        f"{[sorted(kv) for _n, kv in sets][:6]}")
    assert capture.STATUS["devices"]["H10"]["address"] == "24:AC:AC:02:84:96"


def test_a_fresh_connection_increments_LINK_EPOCH(tmp_path, monkeypatch):
    """`link_epoch` is the counter that exposed the charging reconnect storm — 17 connects in 19 minutes,
    every one logged as a successful INFO "connected", so no alert could see it and only this number
    gave it away. It rides the LINK sidecar (E5)."""
    sets: list = []
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()], sets=sets)
    assert capture.STATUS["devices"]["H10"]["link_epoch"] >= 1, (
        "a connection that reached the card must have counted — link_epoch is the only signal a "
        "reconnect storm gives, since every cycle also logs a healthy 'connected'")
    assert _fields(sets, connected=True), "the connect itself must reach the card"


def test_the_device_menu_is_PUBLISHED_and_MERGED_not_replaced(tmp_path, monkeypatch):
    """`pmd_options` is the device's own list of legal rates, read off the hardware, and Settings offers
    exactly those values. It is written per-stream in a loop, each write MERGING the previous:
    `{**(STATUS…get("pmd_options") or {}), name: settings…}`. Lose the merge and Settings shows one
    stream's options — whichever negotiated last."""
    sets: list = []
    _drive(monkeypatch, tmp_path, ["ecg", "acc", "ppg"],
           frames=[T._ecg_frame(), T._acc_frame(), T._ppg_frame()], sets=sets)
    opts = capture.STATUS["devices"]["H10"]["pmd_options"]
    assert {"ecg", "acc", "ppg"} <= set(opts), (
        f"pmd_options carries {sorted(opts)} — a per-stream write that does not merge leaves only the "
        "last stream, and Settings then offers rates for one stream as if they were all of them")
    # ⚠️ WAS `== {"ecg","acc","ppg"}`, i.e. exactly the streams that were ENABLED — which is the very
    # narrowness that made a disabled stream's rate unsettable: no menu, so no dropdown, so the only way
    # to choose gyro's rate was to enable it at its default, reconnect, set it, and reconnect again. The
    # menu is now also read for supported-but-disabled measurements (a settings QUERY starts nothing),
    # so equality here would pin the bug. Both properties are asserted instead: the merge is preserved,
    # AND the off streams are present.
    assert {"gyro", "mag"} <= set(opts), (
        f"pmd_options carries {sorted(opts)} — a supported measurement that is switched OFF still needs "
        "its menu published, or its rate cannot be chosen without first enabling it at some default")
    for stream, legal in opts.items():
        assert legal == [130], f"{stream}: the device's own menu must be published verbatim, got {legal}"


def test_the_supported_measurement_list_reaches_the_card(tmp_path, monkeypatch):
    """`pmd_supported` is the feature bitmask read off the device — what it CAN serve, as opposed to
    what was asked for. Dropped, the card cannot distinguish "not requested" from "not supported"."""
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()])
    got = capture.STATUS["devices"]["H10"].get("pmd_supported")
    assert got, "the PMD feature list must reach the card"
    assert "ecg" in got and "acc" in got, got


def test_the_device_clock_and_its_SKEW_both_reach_the_card(tmp_path, monkeypatch):
    """The honest confirmation that a clock sync took effect. The H10 resets to its 2019 firmware
    default whenever it leaves the strap, so this is watched rather than assumed — and the SKEW is the
    half that says whether the device agrees with the host, which the timestamp alone cannot."""
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()])
    card = capture.STATUS["devices"]["H10"]
    assert card.get("device_time"), "the device's own clock must be surfaced"
    assert "T" in card["device_time"], f"an ISO stamp, got {card['device_time']!r}"
    assert card.get("clock_skew_sec") is not None, (
        "clock_skew_sec must be surfaced alongside it — a device time with no skew cannot say whether "
        "the sync took")
    assert isinstance(card["clock_skew_sec"], float)


def test_a_stream_the_device_REJECTS_says_so_on_the_card(tmp_path, monkeypatch):
    sets: list = []
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()], start_status=0x02, sets=sets)
    errs = [kv["last_error"] for _n, kv in sets if kv.get("last_error")]
    assert any("rejected" in e for e in errs), f"a rejected START must reach the card; saw {errs}"


class SilentStartClient(T.FlexPolarClient):
    """Answers STOP and GET_SETTINGS, and says NOTHING to START.

    `NO_ACK` is not a status byte — it is `-1`, what `_ctrl` returns when no control response arrives
    at all, so it cannot be produced with `start_status=`. An unknown byte like 0xFF really IS a
    rejection, which is the distinction this test exists to draw."""
    async def write_gatt_char(self, uuid, cmd, response=False):
        if uuid == pmd.PMD_CONTROL and cmd[0] == 0x02:      # START — dropped indication
            self.writes.append(bytes(cmd))
            return
        return await super().write_gatt_char(uuid, cmd, response=response)


def test_an_UNACKNOWLEDGED_start_says_re_negotiate_not_rejected(tmp_path, monkeypatch):
    """NO REPLY IS NOT A REJECTION. A dropped control indication leaves no verdict, and the stream is
    KEPT so the stall watchdog re-negotiates on a fresh link. The card must say so: the difference an
    operator acts on is whether the stream is coming back. The old code filed this under "unsupported
    settings" and deleted the writer, so one lost indication cost that stream the whole session."""
    monkeypatch.setattr(capture, "_PMD_CTRL_TIMEOUT_S", 0.01)   # the wait is real; make it brief
    sets: list = []
    bus = _spy(monkeypatch)
    _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, SilentStartClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    errs = [kv["last_error"] for _n, kv in sets if kv.get("last_error")]
    assert any("unacknowledged" in e and "re-negotiate" in e for e in errs), (
        f"an unacked START must be distinguishable from a rejection on the card; saw {errs}")
    assert not any("rejected" in e for e in errs), (
        "an unacked START must NOT read as rejected — they differ in whether the stream survives")
    assert not bus.seen["unregister"], (
        "the stream must be KEPT on no-ack — unregistering it is the old bug, one lost indication "
        "costing the stream its session")


def test_a_link_error_reaches_the_card_and_clears_connected(tmp_path, monkeypatch):
    """The except arm. `connected=False` AND the reason, together: a card that goes not-connected with
    no reason is the state an operator cannot act on."""
    sets: list = []
    T._polar_common(monkeypatch)
    _spy_set(monkeypatch, sets)
    _spy(monkeypatch)
    monkeypatch.setattr(capture, "_connect", lambda *a, **k: (_ for _ in ()).throw(OSError("le boom")))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    bad = [kv for _n, kv in sets if kv.get("connected") is False and kv.get("last_error")]
    assert bad, f"a link error must set connected=False WITH a reason; saw {[kv for _n, kv in sets]}"
    assert "boom" in str(bad[-1]["last_error"]), bad[-1]


# ── the four failure paths the card exists for, none of which a healthy session enters ──────────────
class RisingBatteryClient(T.FlexPolarClient):
    """A battery that CLIMBS between reads — the only mid-session signal that a device went on charge.

    A Polar exposes no charge flag while streaming: `in_charger` appears only when a PMD START is
    REFUSED, which cannot happen to a device that was already streaming when it hit the dock. So a
    device put on charge mid-session reported charging=False forever while its battery visibly rose —
    measured 2026-07-19, a Verity going 35 -> 61 %."""
    def __init__(self, *a, levels=(50, 60, 55), **k):
        super().__init__(*a, **k)
        self._levels, self._n = list(levels), 0

    async def read_gatt_char(self, uuid):
        if uuid == capture.BATTERY_UUID:
            lvl = self._levels[min(self._n, len(self._levels) - 1)]
            self._n += 1
            return bytes([lvl])
        return await super().read_gatt_char(uuid)


def test_a_RISING_battery_infers_charging_and_a_falling_one_clears_it(tmp_path, monkeypatch):
    sets: list = []
    _spy(monkeypatch); _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, RisingBatteryClient(data_frames=[T._ecg_frame()], levels=(50, 60, 55)))
    # The refresh rides `secs % 120 == 0`, so the rise lands at 120 and the FALL at 240 —
    # 130 ticks reach only the first and the sequence reads [False, True], never clearing.
    T._stop_after(monkeypatch, 250)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    # Filtered by device NAME: `_set(None, charging=…)` writes a phantom card and must not satisfy this.
    charge = [kv["charging"] for n, kv in sets if n == "H10" and "charging" in kv]
    assert True in charge, (
        f"a battery that ROSE must set charging=True — these cells do not self-charge; saw {charge}")
    # ORDER, not membership: a successful START also writes charging=False, so `False in charge` is
    # satisfied before the battery is ever read. The claim is that the FALL cleared it, i.e. last.
    assert charge[-1] is False, f"a battery that then FELL must clear it last; saw {charge}"
    assert charge.index(True) < len(charge) - 1, f"the rise must precede the clear; saw {charge}"
    assert capture.STATUS["devices"]["H10"]["battery"] in (50, 60, 55)


def test_a_frame_the_decoder_REJECTS_puts_the_REASON_on_the_card(tmp_path, monkeypatch):
    """A truncated frame raises inside the notification callback. The decoder must never disturb the
    callback, so it is caught — but caught silently is how a stream dies looking healthy. The card must
    carry the decoder's OWN message, not merely something truthy: `str(None)` is "None", which passes
    any `assert card.get("last_error")` while saying nothing."""
    sets: list = []
    # A TRUNCATED frame does NOT raise — decode_frame returns (None, []) and the callback moves on, so
    # truncation is not the way in. The parse error is a frame whose declared type and encoding
    # disagree: ACC requires base==1, and 0x00 is a ValueError.
    bad = T._pmd_frame(pmd.ACC, 1_000_000_000, 0x00, b"\x00" * 6)
    _drive(monkeypatch, tmp_path, ["acc"], frames=[bad], sets=sets)
    errs = [str(kv["last_error"]) for _n, kv in sets if kv.get("last_error")]
    assert errs, "a frame the decoder rejected reached no card at all"
    # Assert the message NAMES THE OFFENDING VALUE, not that it has particular wording. That kills the
    # placeholder forms — `str(None)` is "None", truthy, and passes any `assert card.get("last_error")`
    # while saying nothing — and survives a reword of the sentence around it.
    assert any(e not in ("None", "") and "0x00" in e for e in errs), (
        f"the card must name the frame type it could not decode; saw {errs}")


def test_an_OPTIONAL_backup_device_says_so_ONCE_and_stays_quiet(tmp_path, monkeypatch):
    """`optional: true` means KNOWN but not expected to join. A plain connect timeout is "simply not
    here", so it is noted once and then kept quiet — otherwise it warns every backoff cycle forever
    (the COOSPO spam). The card must still say connected=False with the reason."""
    sets: list = []
    _spy(monkeypatch); _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    capture._OPT_QUIET.clear()
    monkeypatch.setattr(capture, "_connect",
                        lambda *a, **k: (_ for _ in ()).throw(TimeoutError("not here")))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"], optional=True), str(tmp_path)))
    hits = [kv for _n, kv in sets if kv.get("connected") is False and "optional" in str(kv.get("last_error"))]
    assert hits, f"an absent optional device must say so on the card; saw {[kv for _n, kv in sets]}"
    assert "24:AC:AC:02:84:96" in capture._OPT_QUIET, (
        "the address must be marked quiet, or the note repeats every backoff cycle all night")


def test_a_STALLED_stream_says_re_negotiating_on_the_card(tmp_path, monkeypatch):
    """A started stream silent behind a LIVE link. The watchdog is what caught the 2026-07-25 freeze
    pattern; the card is where an operator sees it, and `last_error` is the only place it appears."""
    sets: list = []
    _spy(monkeypatch); _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_STREAM_STALL_S", 5.0)
    # No data frames at all: the writer opens, START succeeds, and no row ever arrives.
    T._inject_connect(monkeypatch, T.FlexPolarClient(data_frames=[], start_status=0x00))
    # The watchdog reads `_time.monotonic()`, which a patched `asyncio.sleep` does not advance — so a
    # sleep-counting helper alone leaves the stall clock frozen and the branch is never entered.
    clock = {"t": 1000.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])

    async def tick(secs):
        clock["t"] += max(secs, 1.0)
        if clock["t"] > 1060:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", tick)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    errs = [str(kv["last_error"]) for n, kv in sets if n == "H10" and kv.get("last_error")]
    assert any("silent" in e and "re-negotiating" in e for e in errs), (
        f"a stream silent behind a live link must say so on THIS device's card; saw {errs}")


def test_every_status_write_NAMES_THE_DEVICE_it_belongs_to(tmp_path, monkeypatch):
    """`_set(name, …)` — the first argument is which card is being written.

    Found by mutation: several `_set(None, …)` mutants survived every assertion above, because those
    all read the KWARGS and ignored the name. `STATUS["devices"][None]` is a real dict that silently
    accepts every field; the operator's card just never changes. On a box with more than one sensor the
    same defect writes one strap's error onto another's card.

    Blanket rather than per-call on purpose: the failure is generic, and a blanket check covers the
    paths this file drives today AND the ones a later fixture adds."""
    for driver in (
        lambda s: _drive(monkeypatch, tmp_path, ALL6, sets=s),
        lambda s: _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()],
                         start_status=0x02, sets=s),
    ):
        # The autouse reset runs between TESTS, not between two drives inside one — and `_stop_after`
        # leaves `_STOP` set, so a second run_polar returns immediately having done nothing. That reads
        # as "no status writes", i.e. exactly the signal this test looks for. Re-arm it explicitly.
        capture._STOP = asyncio.Event()
        sets: list = []
        driver(sets)
        assert sets, "nothing was written to any card — the driver reached no status write"
        bad = [(n, sorted(kv)) for n, kv in sets if n != "H10"]
        assert not bad, f"status written under the wrong device name: {bad}"


def test_a_status_write_carries_FIELDS_not_just_a_name(tmp_path, monkeypatch):
    """The mirror image: `_set(name, )` with every keyword dropped is a call that names the right card
    and says nothing to it. Each _set in a session must actually carry a field."""
    sets: list = []
    _drive(monkeypatch, tmp_path, ALL6, sets=sets)
    empty = [n for n, kv in sets if not kv]
    assert not empty, f"{len(empty)} status write(s) carried no fields at all"


def test_a_SUCCESSFUL_start_clears_the_charging_flag(tmp_path, monkeypatch):
    """A device that serves PMD is not on its dock — a Polar refuses START with `in_charger` while
    charging. So a successful negotiation is positive evidence, and `charging=False` is written from it.

    Asserted as `is False`, not falsy: `charging=None` means "unknown" everywhere else in this daemon
    (see the `contact`/`worn` rule and `stream_health`'s eff_fs), and a card that cannot say whether a
    device is charging is not the same as one saying it is not."""
    sets: list = []
    _drive(monkeypatch, tmp_path, ["ecg"], frames=[T._ecg_frame()], sets=sets)
    charge = [kv["charging"] for n, kv in sets if n == "H10" and "charging" in kv]
    assert charge, "a successful START must record that the device is off the charger"
    assert charge[0] is False, (
        f"the first charging write after a successful START must be False, not {charge[0]!r} — "
        "None reads as 'unknown', which is a different claim")
    assert capture.STATUS["devices"]["H10"]["charging"] is False


# ── the last four status paths: each is entered only when something has gone wrong ──────────────────
def test_a_PAUSED_link_says_WHY_it_is_paused_and_that_it_is_down(tmp_path, monkeypatch):
    """Two different reasons share one branch: an offline pull owns the link, or the watchdog is
    resetting the adapter. The card must distinguish them — one resolves itself in seconds, the other
    means the radio is being power-cycled — and `connected` must read False, not None.

    `is False`, not falsy: None is this daemon's "unknown" everywhere else, and a card that cannot say
    whether the link is up is a different claim from one saying it is down."""
    addr = "24:AC:AC:02:84:96"
    for setup, expect in ((lambda: capture._POLAR_PAUSED.add(addr), "paused"),
                          (lambda: capture._RECOVER.set(), "adapter recovering")):
        capture._STOP = asyncio.Event()
        capture._POLAR_PAUSED.clear(); capture._RECOVER.clear()
        sets: list = []
        _spy(monkeypatch); _spy_set(monkeypatch, sets)
        T._polar_common(monkeypatch)
        setup()
        T._stop_after(monkeypatch, 1)
        asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
        hits = [kv for n, kv in sets if n == "H10" and "connected" in kv]
        assert hits, f"a paused link wrote nothing to the card ({expect})"
        assert hits[0]["connected"] is False, (
            f"a paused link must read connected=False, not {hits[0]['connected']!r}")
        assert expect in str(hits[0].get("last_error")), (
            f"the card must say WHY it is paused; wanted {expect!r}, got {hits[0].get('last_error')!r}")
    capture._RECOVER.clear()


def test_a_REBOND_that_fails_tells_the_operator_to_pair_by_hand(tmp_path, monkeypatch):
    """A bond can go stale mid-session: BlueZ reports `Bonded: yes` while the sensor has forgotten us.
    The loop re-checks and re-pairs — and when the re-pair itself fails there is nothing more the daemon
    can do, so the card must hand the job to a human. On 2026-07-29 the absence of this recovery cost
    4.5 h of ECG while the task reconnected every ~70 s reporting success."""
    sets: list = []
    _spy(monkeypatch); _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_REBOND_EVERY", 1)          # every iteration, not every fifth
    async def not_bonded(*a, **k): return False
    async def cannot_bond(*a, **k): return False
    monkeypatch.setattr(capture.bonding, "is_bonded", not_bonded)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", cannot_bond)
    T._inject_connect(monkeypatch, T.FlexPolarClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    errs = [str(kv["last_error"]) for n, kv in sets if n == "H10" and kv.get("last_error")]
    assert any("bond lost" in e and "monitor page" in e for e in errs), (
        f"a failed re-pair must name the manual step — the daemon has no move left; saw {errs}")


def test_a_TWICE_refused_service_discovery_is_treated_as_a_stale_bond(tmp_path, monkeypatch):
    """TWO consecutive hits, not one. A single failed service discovery is also what an ordinary
    mid-negotiation drop looks like, and re-pairing costs ~20 s of scripted bluetoothctl — so firing on
    one would re-pair on every flap. The card says re-pairing only on the second."""
    sets: list = []
    _spy(monkeypatch); _spy_set(monkeypatch, sets)
    T._polar_common(monkeypatch)
    async def force_ok(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", force_ok)
    monkeypatch.setattr(capture, "_connect",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("Failed to discover services")))
    T._stop_after(monkeypatch, 4)                              # two failed iterations, then stop
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"]), str(tmp_path)))
    errs = [str(kv["last_error"]) for n, kv in sets if n == "H10" and kv.get("last_error")]
    assert any("re-pairing" in e and "forgotten this host" in e for e in errs), (
        f"two refusals in a row must be treated as a stale bond; saw {errs}")


def test_an_optional_device_that_TURNS_UP_stops_being_quiet(tmp_path, monkeypatch):
    """`_OPT_QUIET` suppresses the "not present" note for a backup device that is known but not expected.
    When it does connect, the address must be discarded from that set — otherwise a device that joins,
    drops, and is genuinely absent later never says so again."""
    addr = "24:AC:AC:02:84:96"
    capture._OPT_QUIET.add(addr)
    _spy(monkeypatch)
    T._polar_common(monkeypatch)
    T._inject_connect(monkeypatch, T.FlexPolarClient(data_frames=[T._ecg_frame()]))
    T._stop_after(monkeypatch, 1)
    asyncio.run(capture.run_polar(T._pdev(streams=["ecg"], optional=True), str(tmp_path)))
    assert addr not in capture._OPT_QUIET, (
        "a device that connected must be un-quieted — leaving it quiet means its LATER absence is "
        "never reported")
