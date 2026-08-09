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


def _drive(monkeypatch, tmp_path, streams, frames=None, start_status=0x00, hr_frame=None):
    """One full run_polar session against the fake Polar, returning the recorded bus calls."""
    bus = _spy(monkeypatch)
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
