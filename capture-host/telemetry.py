# tepna-capture — telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# In-memory live-sample bus for the monitor page. The capture callbacks push each decoded frame's
# samples here; SSE subscribers (the browser canvas) get compact per-frame batches. This is a live
# view ONLY — the durable record is still the vendor-layout files on disk (Clock Contract / §8).
# A dropped subscriber or a slow browser never blocks capture: the per-subscriber queue drops oldest.

from __future__ import annotations
import asyncio, collections, datetime as _dt, logging, math, statistics, time
from dataclasses import dataclass

log = logging.getLogger("tepna.telemetry")

# ── Link-health thresholds (stream-rate side of the weak-signal warning; the RSSI side is link_rssi.py).
# A weak/failing BLE link shows up as fewer packets than the stream's nominal rate BEFORE it fully drops —
# the daemon sees every frame, so this needs no root (unlike connection RSSI). Waveform streams are judged
# by effective-vs-nominal Hz; slow/event streams (spo2/pr/ppi/rr ~1 Hz) can only be judged by silence.
_RATE_WIN_S = 5.0          # trailing window the effective rate is measured over
_WEAK_FRAC = 0.7           # < 70 % of nominal Hz ⇒ WEAK (amber)
_STALL_S = 6.0             # no sample for this long ⇒ STALL (red)
_WARMUP_S = 1.5            # < this much history ⇒ too early to call WEAK (a just-opened stream)


# ── OPTICAL WEAR, FROM THE SIGNAL ITSELF ────────────────────────────────────────────────────────────
#
# WHY THIS EXISTS. `worn` normally comes from a strap's skin-contact bit. The Polar Verity Sense
# declares `contact_supported: false` and emits 1 Hz of `0000` forever, so that path yields None for it
# — honestly, but permanently. The consequence is not cosmetic: `power.drop_not_worn_sec` can never
# fire for the armband, and `cpap_harvest.blocking_devices` treats `worn is not False` as "streaming",
# so an armband on a desk both drains itself and blocks the CPAP harvest.
#
# Measured 2026-08-10: the Verity streamed 3 hours and 42.5 MB into a desk at a flawless 55.0 Hz, zero
# gaps, RSSI −37 — and every health check read green, because every health check asks about the
# TRANSPORT (rate, age) and none about the CONTENT. Battery went 100 % → 74 %.
#
# THE DEVICE DOES SAY, on a channel nobody read. The ambient photodiode sees ROOM LIGHT off the body
# and DARKNESS under skin, and the separation is not subtle. Scanned across 5730 windows of 30 s from
# 45 real Verity PPG files (2026-08-01 → 08-10):
#
#     |ambient| median per window   worn ~140–190        unworn ~3.2e5–6.5e5
#     log10 histogram              1–3: 3795 windows     5: 1931 windows     4: FOUR windows
#
# Three orders of magnitude apart with four windows in the gap. The threshold below is the geometric
# midpoint of the widest empty interval in the middle 98 % (1993 → 13160, a factor of 7), NOT a number
# anyone picked: 5121, rounded to 5000. Validated on files whose state was known independently — the
# desk file scored 0.0 % worn windows, the overnight file 100.0 %.
#
# ⚠️ AMBIENT, NOT PULSE AMPLITUDE. Per-channel SD also separates (14–28×) but its histogram is
# continuous, so any threshold on it is a judgement call; ambient's is bimodal with an empty gap. And
# amplitude conflates "not worn" with "worn badly" — a poorly perfused but genuinely worn sensor must
# not be dropped for power.
_WORN_AMBIENT_MAX = 5000.0   # |ambient| below this ⇒ under skin. See the gap above.
_WORN_MIN_SAMPLES = 128      # ~2.3 s at 55 Hz; fewer is not a measurement

# ── THE CALIBRATION'S DOMAIN, DECLARED BESIDE THE NUMBER IT QUALIFIES ───────────────────────────────
#
# Every threshold above came from 45 real Verity PPG files captured at 55 Hz. NONE of it was measured
# anywhere else, and the ambient channel does not scale the way one might assume: at 176 Hz the same
# worn armband reads ~650,800 with a spread of 208 counts — a PEGGED value, not a light level — which
# lands squarely in the 55 Hz "unworn" cluster (3.2e5–6.5e5). So the detector reports NOT WORN for a
# device on a wrist, confidently, using a number that is simply not about that rate.
#
# Measured 2026-08-10, and it shipped: PPG default moved to 176 Hz in the morning and this detector
# landed in the evening, each defensible alone and neither checked against the other. A worn armband
# showing a textbook pulse at 57 bpm was dropped every 90 s to "save battery".
#
# ⚠️ THE AFTERNOON CHECK THAT "VALIDATED" IT WAS RUN ON AN UNWORN DEVICE, so it agreed for the wrong
# reason. A passing check on a case that cannot fail is not evidence — see AUDIT-PROMPT's standing
# complaint about gates that pass without exercising anything.
#
# So the constant carries its domain and the function REFUSES outside it. Adding a rate here is not a
# config change: it means someone captured a worn night at that rate and re-derived the numbers.
_WORN_CALIBRATED_PPG_HZ = (55.0,)
_WORN_FS_TOL_HZ = 1.0        # the box logs 55.0 but a device may report 54.9; this is not a rate menu


# PPI flag byte (polar_pmd: bit0 blocker, bit1 skinContact, bit2 skinContactSupported).
_PPI_CONTACT = 0x02
_PPI_CONTACT_SUPPORTED = 0x04


def ppi_contact(flags) -> bool | None:
    """Skin contact as the DEVICE reports it in its PPI stream. `True`/`False`/**`None` = not offered**.

    ⚠️ THE VERITY ANSWERS THIS QUESTION TWICE, DIFFERENTLY, AND THE CODE ONLY EVER ASKED THE CHANNEL
    THAT SAYS NO. Its HR characteristic reports `contact_supported: false` and streams 1 Hz of `0000`
    forever, which is why `worn` was `None` for it forever. Its PPI stream sets
    `skinContactSupported = 1` and reports real contact. Measured 2026-08-10 on the same unit:

        armband on a desk    contact = 0 on 31 877 of 31 877 rows
        armband worn (night) contact = 1 on 20 957 of 20 957 rows

    Perfect separation, no threshold, and it is the device's own measurement rather than an inference —
    so this OUTRANKS `optical_worn` wherever PPI is a configured stream. `optical_worn` remains the
    fallback for a configuration that does not enable PPI.

    `None` when the device does not claim support, because an unsupported bit reads 0 and 0 is
    indistinguishable from a genuine "not touching skin"."""
    if flags is None:
        return None
    f = int(flags)
    if not f & _PPI_CONTACT_SUPPORTED:
        return None
    return bool(f & _PPI_CONTACT)


def calibrated_for(fs, *, rates=_WORN_CALIBRATED_PPG_HZ, tol: float = _WORN_FS_TOL_HZ) -> bool:
    """Is the optical worn calibration valid at this PPG rate?

    PURE and separate from `optical_worn` so the daemon can say WHY it has no verdict, and so the
    domain is assertable without feeding samples through the detector.

    ⚠️ AN UNKNOWN RATE (`None`) IS TREATED AS IN-DOMAIN. That is deliberate and is the one concession:
    every caller that cannot report a rate predates this parameter, and refusing there would silently
    disable worn detection for all of them. A caller that KNOWS its rate and reports one we never
    measured is the case this exists to catch."""
    if fs is None:
        return True
    return any(abs(float(fs) - r) <= tol for r in rates)


def optical_worn(ambient, *, threshold: float = _WORN_AMBIENT_MAX,
                 min_samples: int = _WORN_MIN_SAMPLES, fs: float | None = None) -> bool | None:
    """Is an optical sensor against skin? `True` / `False` / **`None` when it cannot be said**.

    PURE, so it is unit-testable without a device. Takes raw ambient values (sign is irrelevant — the
    Verity reports them negative), uses the MEDIAN so a handful of saturated samples cannot swing it,
    and refuses on too little data rather than guessing.

    ⚠️ `None` IS NOT `False`, and the callers make that distinction load-bearing: `worn=False` drops the
    link for power and unblocks the CPAP harvest, while `None` means "no verdict" and changes nothing.
    Returning False on a short or empty buffer would drop a sensor that had merely just connected."""
    if not calibrated_for(fs):
        # REFUSE, don't guess. `None` already means "no verdict" everywhere downstream — the power drop
        # and the CPAP interlock both read `worn is False`, not `worn is not True` — so refusing costs
        # a feature and guessing costs a night's capture.
        return None
    vals = [abs(v) for v in ambient if v is not None and v == v]   # drop None/NaN, keep magnitude
    if len(vals) < max(1, min_samples):
        return None
    # `statistics.median`, not a hand-rolled index. The hand-rolled version carried TEN index/operator
    # mutants that the whole suite could not see (mutate-diff, #1134) — every test fed it a flat buffer,
    # so `// 2` vs `// 3` and `- 1` vs `+ 1` all returned the same number. The even-length branch is the
    # part no fixture reached. Deleting the arithmetic is a better answer than fixturing around it.
    return statistics.median(vals) < threshold


# ── DETECTOR B · AMBIENT *STABILITY*, FOR THE RATE WHERE THE LEVEL IS BLIND ─────────────────────────
#
# `optical_worn` above thresholds the ambient LEVEL and refuses outside 55 Hz, which left 176 Hz — the
# rate this box actually runs — with no optical verdict at all. This is the detector for that domain,
# and it exists because THE PEGGING INVERTS BETWEEN THE TWO RATES:
#
#     55 Hz   worn = DARK  (|median| ~1e2)      unworn = pegged bright (~3e5) — and pegged is QUIET
#     176 Hz  worn = PEGGED (~6.5e5), QUIET     unworn = unpegged room light  — and that is NOISY
#
# So the level separates at 55 Hz and the variance separates at 176 Hz, and each statistic is blind at
# the other's rate. That is not a tuning problem; it is two different physical regimes, which is why
# this ships as a second calibrated detector rather than a widened threshold on the first.
#
# Measured 2026-08-13 over 90 windows of 30 s from 15 real 176 Hz Verity files:
#
#     ambient SD    worn 32.0 – 36.7  (n=54)      desk 141.4 – 30 399.3  (n=36)
#
# A clean gap of 3.9x with nothing in it. The threshold is its geometric midpoint (sqrt(36.7 * 141.4)
# = 72.1, rounded to 72), the same rule that produced the 5000 above — not a number anyone picked.
#
# ⚠️ THIS CALIBRATION IS WEAKER THAN THE 55 Hz ONE AND THE DIFFERENCE IS STATED, NOT SMOOTHED OVER.
# The 5000 came from 5730 windows across 45 files whose worn/unworn state was known independently.
# This came from 90 windows across 15 files whose state is inferred from capture time (evening and
# overnight = worn; 2026-08-03 09:23–12:13 = desk). That inference is corroborated by an INDEPENDENT
# statistic — per-file cardiac-band power differs 20–100x between the two groups — but corroboration
# is not the same as knowing, and a wider corpus should re-derive this before anyone leans harder on it.
#
# ⚠️ CARDIAC-BAND POWER WAS TRIED AS A THIRD DETECTOR AND REFUTED — do not re-derive it. The idea is
# attractive (periodicity is rate-independent, and unlike amplitude it does not conflate "not worn"
# with "worn badly"), and on two hand-picked windows it looked like a 94x separation. Over the corpus
# it is not a detector at all: at 55 Hz 468 of 474 windows fall in the overlap (worn median 0.026 vs
# unworn 0.013, and the unworn MAXIMUM 1.088 exceeds the worn maximum 0.882), and even at 176 Hz worn
# reaches down to 0.00089 while desk reaches up to 0.02234. An unworn sensor has ample 0.7–3.5 Hz
# energy from room-light flicker, handling and drift, and normalising by total power rewards a quiet
# drifting signal. It survives only as a per-FILE indicator, which is what labelled the corpus above.
_WORN_AMBIENT_SD_MAX = 72.0        # ambient SD below this ⇒ under skin, AT 176 Hz. See the gap above.
_WORN_SD_MIN_SAMPLES = 256         # ~1.5 s at 176 Hz; fewer is not a spread
_WORN_SD_CALIBRATED_PPG_HZ = (176.0,)
_WORN_SD_FS_TOL_HZ = 2.0           # files measure 175.4–176.6; this is a tolerance, not a rate menu


def sd_calibrated_for(fs, *, rates=_WORN_SD_CALIBRATED_PPG_HZ,
                      tol: float = _WORN_SD_FS_TOL_HZ) -> bool:
    """Is the ambient-STABILITY calibration valid at this PPG rate?

    ⚠️ AN UNKNOWN RATE (`None`) IS OUT OF DOMAIN HERE — the opposite of `calibrated_for`. That
    asymmetry is deliberate, not an oversight. `calibrated_for` admits `None` because callers older
    than the parameter would otherwise lose worn detection entirely; this detector has no such callers,
    so admitting an unknown rate would only ever let it run somewhere it was never measured. A new
    detector gets the strict rule; the concession is not inherited."""
    if fs is None:
        return False
    return any(abs(float(fs) - r) <= tol for r in rates)


def ambient_stability_worn(ambient, *, threshold: float = _WORN_AMBIENT_SD_MAX,
                           min_samples: int = _WORN_SD_MIN_SAMPLES,
                           fs: float | None = None) -> bool | None:
    """Is an optical sensor against skin, judged by how STILL its ambient channel is?

    PURE. `True` / `False` / `None` when it cannot be said — the same three-valued contract as
    `optical_worn`, and for the same reason: `None` changes nothing downstream, `False` drops a link.

    Uses population SD over the raw values. Sign is irrelevant (the Verity reports ambient negative)
    and, unlike the level detector, the magnitude is NOT taken — |x| would fold a signal that crosses
    zero and understate its spread. Nothing in this corpus crosses zero, so the two agree today; taking
    the spread of the values as they arrive is simply the thing being described."""
    if not sd_calibrated_for(fs):
        return None
    vals = [v for v in ambient if v is not None and v == v]      # drop None/NaN; keep sign
    if len(vals) < max(2, min_samples):
        return None
    return statistics.pstdev(vals) < threshold


# ── PULSE PROMINENCE ────────────────────────────────────────────────────────────────────────────────
# Measured 2026-08-15, on the morning a docked Verity streamed noise for 30 min while EVERY existing
# guard reported it worn:
#   · `charging` was False — charging is inferred from a Polar refusing PMD START with 0x0D in_charger,
#     and this device ACCEPTED the start while docked, so the inference never fired;
#   · the HR contact bit said worn (its documented lie);
#   · `ambient_stability_worn` said worn — a dock has beautifully stable ambient light, so the vote meant
#     to be the honest one is a false positive in exactly the condition that matters.
# Both votes agreed, so the disagreement chip could not fire either. Three detectors, one dock, no alarm.
#
# ⚠️ THE OBVIOUS FIX WAS MEASURED AND REJECTED. A motion veto does not work: a sleeping arm sits at ACC
# SD 2.2 mg, QUIETER than this dock's 3.4 mg. A motion threshold would veto real sleep — a worse failure
# than the one it fixes. Do not re-propose it without re-measuring.
#
# What separates them is whether there is a PULSE at all. Note the docked stream's spectral peak lands at
# 45–54 bpm, entirely plausible — which is why the monitor believed 106 bpm. The peak's LOCATION carries
# no information; its PROMINENCE does.
_PULSE_BAND_HZ = (0.70, 3.00)      # 42–180 bpm
_PULSE_NOISE_BAND_HZ = (6.0, 12.0)  # above any pulse harmonic that matters, below the anti-alias corner
_PULSE_PROMINENCE_MIN = 250.0
_PULSE_MIN_SAMPLES = 4096
_PULSE_MIN_FS_HZ = 30.0             # the 6–12 Hz reference band must sit below Nyquist


def _goertzel_power(vals, f: float, fs: float) -> float:
    """Power at one frequency. Cheaper than an FFT when only ~60 bins are wanted."""
    w = 2 * math.pi * f / fs
    coeff = 2 * math.cos(w)
    s1 = s2 = 0.0
    for x in vals:
        s0 = x + coeff * s1 - s2
        s2 = s1
        s1 = s0
    return s1 * s1 + s2 * s2 - coeff * s1 * s2


def pulse_prominence(ppg, *, fs: float | None) -> "float | None":
    # `fs: float | None`, not `float`: the None case is HANDLED, not accidental — see the
    # `if fs is None` return on the first line of the body. The narrower annotation described a
    # contract this function does not have, and callers legitimately pass an unset rate.
    """Peak power in the pulse band over mean power in a reference band above it. `None` if unmeasurable.

    Rate-independent by construction — the bands are in Hz and the transform is evaluated at the given
    `fs` — which is why this does NOT inherit `sd_calibrated_for`'s exact-rate menu. It was measured at
    BOTH 55 Hz and 176 Hz on the same device and separates at both, so an exact-rate gate would reject
    data it demonstrably handles. The gate it does need is Nyquist: below ~30 Hz the reference band folds.
    """
    if fs is None or not (fs >= _PULSE_MIN_FS_HZ):
        return None
    vals = [float(v) for v in ppg if v is not None and v == v]
    if len(vals) < _PULSE_MIN_SAMPLES:
        return None
    mean = sum(vals) / len(vals)
    vals = [v - mean for v in vals]
    lo, hi = _PULSE_BAND_HZ
    band = max(_goertzel_power(vals, f / 100.0, fs) for f in range(int(lo * 100), int(hi * 100) + 1, 6))
    nlo, nhi = _PULSE_NOISE_BAND_HZ
    ref = [_goertzel_power(vals, f / 10.0, fs) for f in range(int(nlo * 10), int(nhi * 10) + 1, 3)]
    denom = sum(ref) / len(ref)
    if not (denom > 0):
        return None
    return band / denom


def pulse_prominence_worn(ppg, *, fs: float | None,
                          # Widened with its callee: this forwards `fs` straight to
                          # `pulse_prominence`, which returns None for a None rate.
                          threshold: float = _PULSE_PROMINENCE_MIN) -> "bool | None":
    """Is this optical sensor on skin, judged by whether a pulse is present at all?

    PURE, three-valued, same contract as the other worn detectors: `None` changes nothing downstream.

    THE THRESHOLD IS THE GEOMETRIC MIDPOINT OF MEASURED POPULATIONS, not a round number. Corpus of
    2026-08-15 — 12 windows across a worn night (55 Hz) and 10 across the docked morning (176 Hz):

        worn   min  1985   median  33 950   max 18 161 494
        dock   min   4.9   median      11.2 max      34.4

    Worst-worn / worst-dock = **58x**, with nothing between. sqrt(34.4 x 1985) = 261, so 250 sits ~7x
    above the loudest dock and ~8x below the quietest worn beat. Both margins are stated because a
    threshold quoted without the distance to each population cannot be re-judged when the corpus grows.
    """
    p = pulse_prominence(ppg, fs=fs)
    if p is None:
        return None
    return p > threshold


def on_body(st: "dict | None") -> "bool | None":
    """PURE. Is this device on a body right now? `True` / `False` / `None` when unknown.

    ONE ENCODING OF ONE RULE — *a charging device cannot be on a body*. It was written twice, and only
    one copy said so: `cpap_harvest.blocking_devices` checked `charging` (after the 2026-07-26 evening
    when every sensor was docked and a manual pull still refused, "which is precisely when a pull is
    safest"), while `capture.autopull_poller` gated on `worn is True` alone.

    ⚠️ `None` IS RETURNED, NOT COLLAPSED, because the two callers must answer it DIFFERENTLY and that
    asymmetry is deliberate rather than an oversight to be tidied away. Their costs are not symmetric:
      · blocking a harvest on an unknown is cheap — the next run retries;
      · refusing to auto-pull on an unknown loses the ONLY backup for a lossy night, and the O2Ring's
        `worn` is never actually unknown, so a conservative default there buys nothing real.
    So `blocking_devices` blocks on `is not False`, and the auto-pull skips only on `is True`. Folding
    them into a single boolean would silently pick one policy for both."""
    st = st or {}
    if not st.get("connected"):
        return False
    if st.get("charging"):
        return False
    return st.get("worn")


# ── EVIDENCE SOURCES: AGREEMENT BETWEEN CORRELATED DETECTORS IS NOT CORROBORATION ──────────────────
# INTERDISCIPLINARY-LITERATURE-DIAGNOSIS §4.2 — fusing evidence as if independent becomes OVERCONFIDENT
# when it shares a source. `ambient-level` and `ambient-stability` are two statistics of ONE signal, so
# they fail TOGETHER: a dock has both a low ambient level and a stable one. `hr-contact-bit` and
# `ppi-contact` are two characteristics reporting one physical contact sensor.
#
# The incident that makes this concrete (2026-08-15): a Verity sat in its charger streaming noise while
# the verdict read "worn per ambient-level, ambient-stability". Two detectors named, ONE signal behind
# them, and the string invites an operator to count two.
#
# `pulse-prominence` displaces the ambient pair when available, so this mostly matters when it is not —
# which is exactly the 55 Hz / no-PPG configuration where the ambient pair is all there is.
_WORN_SOURCE = {
    "hr-contact-bit": "device-contact",
    "ppi-contact": "device-contact",
    "ambient-level": "optical-ambient",
    "ambient-stability": "optical-ambient",
    "pulse-prominence": "optical-pulse",
}


def independent_sources(names) -> list:
    """The DISTINCT evidence origins behind a set of detector names, sorted.

    Detectors sharing an origin count once. An UNKNOWN name becomes its own source, which over-states
    independence — the wrong direction — so a new detector must be added to `_WORN_SOURCE`. A test
    asserts every name `worn_verdict` can emit is mapped, so the failure is caught at CI rather than in
    a reason string an operator is reading at 3 a.m.
    """
    return sorted({_WORN_SOURCE.get(n, n) for n in names})


def worn_verdict(*, ppi_flags=None, ambient=None, fs: float | None = None,
                 charging: bool | None = None,
                 contact: bool | None = None,
                 ppg=None) -> tuple[bool | None, str]:
    """Combine every worn detector that is AVAILABLE and IN DOMAIN into one verdict plus its reason.

    Returns `(verdict, why)`. `why` names which detectors voted, so "no verdict" is visible rather
    than silent — the failure this function was written after was not a wrong answer but a STALE one:
    the caller declined to publish when the detector abstained, and the previous `True` stood for ten
    hours while an armband streamed into a desk.

    ── THE COMBINER IS ASYMMETRIC, BECAUSE THE TWO ERRORS DO NOT COST THE SAME ──
    A false NOT-WORN drops a live link mid-night and costs a recording. A false WORN wastes battery
    and costs a charge. So:
        · WORN     if ANY detector says worn
        · NOT WORN only if at least one detector has an opinion and EVERY opinion is not-worn
        · None     if no detector is available or in domain
    Today the two optical detectors have disjoint domains (55 Hz vs 176 Hz) so they cannot disagree,
    and the rule reads like a dispatch. It is written as a vote anyway: the moment a second rate is
    calibrated for both, the disagreement case exists, and it must resolve toward keeping the link.

    ── PPI CONTACT OUTRANKS NOTHING; IT SIMPLY VOTES FIRST AND USUALLY DECIDES ──
    `ppi_contact` is the device's own measurement rather than an inference, and it separated perfectly
    on this hardware (contact=0 on 31 877 desk rows, contact=1 on 20 957 worn rows). It is unavailable
    whenever SDK mode is on, because the Verity refuses PPI there — which is exactly the configuration
    that made this whole function necessary."""
    # ── CHARGING OUTRANKS EVERY OTHER DETECTOR, and it is the ONE case that inverts the asymmetry ──
    #
    # The rule below is "worn if ANY detector says worn", because a false NOT-worn drops a live link
    # and costs a night while a false worn costs a charge. That reasoning does not apply here: a device
    # sitting in a dock is not on a wrist, so the expensive error is not available to be made. This is
    # the only signal in the set that is a PHYSICAL FACT about where the device is rather than an
    # inference about what it is seeing, which is why it may overrule a contact bit that says worn —
    # and on 2026-08-14 that contact bit did say worn, for 80 minutes, on a charger.
    if charging:
        return False, "not worn — on charger (a docked device is not on a wrist)"
    votes: list[tuple[str, bool]] = []
    # The HR characteristic's contact bit, ALREADY DECODED by the caller — a different signal from the
    # PPI flag byte below, carried by a different stream, and the reason this parameter exists: it had
    # no way into this function, so `capture.on_hr` published `worn` directly and the charging veto
    # above was unreachable on the one device that has both a contact bit and a charging dock. The
    # Verity streamed 3 h 24 m into its charger on 2026-08-14 under `worn: True` because of it.
    if contact is not None:
        votes.append(("hr-contact-bit", contact))
    ppi = ppi_contact(ppi_flags)
    if ppi is not None:
        votes.append(("ppi-contact", ppi))
    if ambient is not None:
        level = optical_worn(ambient, fs=fs)
        if level is not None:
            votes.append(("ambient-level", level))
        spread = ambient_stability_worn(ambient, fs=fs)
        if spread is not None:
            votes.append(("ambient-stability", spread))
    # ── A PULSE OVERRULES THE AMBIENT PROXIES, and only them ────────────────────────────────────────
    # Both ambient detectors are PROXIES: stable-or-dark light ⇒ *probably* under skin. Pulse presence
    # is the thing itself ⇒ perfused tissue. When the direct measurement contradicts the proxy, the
    # direct one wins; that is not the general "worn if ANY" rule and it is deliberately narrow.
    #
    # ⚠️ IT MAY NOT OVERRULE A CONTACT BIT, and the asymmetry still holds for that. A false not-worn
    # drops a live link and costs a night — a cold, poorly-perfused wrist can genuinely show no pulse.
    # This verdict is published as `worn_optical`, which does NOT own the drop; the contact bit does.
    # So the cost of being wrong here is a wrong diagnostic and a spurious conflict warning, not a lost
    # recording. That is the only reason the override is affordable at all.
    #
    # Measured 2026-08-15, the morning a docked Verity streamed noise while ambient-stability called it
    # worn: 12 windows across a worn night gave prominence 1985 .. 18 161 494; 10 docked windows gave
    # 4.9 .. 34.4. 58x between the worst of each, nothing in between.
    if ppg is not None:
        pulse = pulse_prominence_worn(ppg, fs=fs)
        if pulse is not None:
            votes = [(n2, v) for (n2, v) in votes if not n2.startswith("ambient-")]
            votes.append(("pulse-prominence", pulse))
    if not votes:
        return None, ("no worn detector is available and in domain"
                      + (f" at {fs:g} Hz" if fs is not None else " (PPG rate unknown)"))
    worn_by = [n for n, v in votes if v]
    named = worn_by if worn_by else [n for n, _ in votes]
    # ⚠️ NAME THE INDEPENDENT SOURCES, NOT THE DETECTOR COUNT. Two statistics of one ambient series
    # agreeing is one piece of evidence, not two (§4.2). Appended only when they differ, so the common
    # single-detector case reads exactly as it did.
    srcs = independent_sources(named)
    qual = "" if len(srcs) == len(named) else f" ({len(srcs)} independent source(s): {', '.join(srcs)})"
    if worn_by:
        return True, "worn per " + ", ".join(worn_by) + qual
    return False, "not worn per " + ", ".join(named) + qual


# ── CHARGING AT FULL, WHERE THE RISING RULE IS STRUCTURALLY BLIND ───────────────────────────────────
#
# `capture._read_batt` already infers charging from a RISING battery, which is unambiguous — these cells
# do not self-charge — and it works everywhere it can fire (measured 2026-07-19: Verity 35 -> 61 %).
#
# It cannot fire at 100 %. A full cell has nowhere to rise to, so a device docked while full reports
# `charging: False` for as long as it sits there. Measured 2026-08-14: the Verity streamed 80 minutes
# at 176 Hz with `battery` pinned at 100 and `charging` False the whole time, so nothing downstream
# could tell a charger from a wrist.
#
# THE SUBSTITUTE SIGNAL AT FULL IS FLATNESS, and it is quantitative rather than a hunch. Streaming
# drains this hardware at roughly 9 %/h — measured on the 2026-08-10 desk incident, 100 % -> 74 % in
# three hours at 55 Hz, and 176 Hz costs more, not less. So a *streaming* device that has held 100 %
# for 45 minutes should have shed ~7 points and has shed none. The window is deliberately long: it
# spans several battery quantisation steps whatever the device's reporting granularity, and the cost of
# waiting is a few minutes of streaming while the cost of being wrong is a dropped link.
#
# ⚠️ RESTRICTED TO FULL ON PURPOSE. Flatness lower down is weak — a slow drain and a coarse reporting
# step look identical — and it does not need to work there, because a battery below 100 that goes on
# charge RISES and the existing rule already catches it. This fills the one hole that rule cannot
# reach, and claims nothing outside it.
_BATT_FULL_PCT = 100
_BATT_FLAT_CHARGING_S = 2700.0     # 45 min; ~7 points of expected drain at the measured 9 %/h


def full_battery_implies_charging(level, seconds_flat, *, full_pct: int = _BATT_FULL_PCT,
                                  min_flat_s: float = _BATT_FLAT_CHARGING_S) -> bool | None:
    """`True` when a FULL battery has stayed put long enough that a draining device would have moved.

    PURE. `None` means "no claim" — below full (where the rising rule applies), on a short observation,
    or with nothing to read. Never returns False: a battery flat for ten minutes has not proved it is
    discharging, and saying so would be inventing the opposite verdict out of insufficient evidence."""
    # ⚠️ NO `is None` GUARD HERE, deliberately. One used to sit on this line and the mutation gate
    # showed it was dead: `or` mutated to `and` survived, because a lone `None` simply falls through to
    # `int(None)` / `float(None)`, raises TypeError, and returns None from the handler below by a
    # different route. A guard that cannot change any output is not a guard — it is a second, silent
    # copy of the rule underneath it, and the next reader has to prove they agree.
    try:
        lvl, flat = int(level), float(seconds_flat)
    except (TypeError, ValueError):
        return None
    if lvl < full_pct or flat < min_flat_s:
        return None
    return True


def note_flat_battery(store: dict, name: str, prev, lvl, now: float,
                      *, min_flat_s: float = _BATT_FLAT_CHARGING_S) -> bool:
    """Advance a device's flat-battery clock and say whether it now implies charging.

    PURE apart from the `store` it is handed — which is the point: the clock lives in the CALLER's
    module-level dict rather than in a connection-scoped local, so it survives a reconnect.

    ⚠️ THAT IS THE WHOLE BUG THIS EXISTS TO FIX. The rule needs 2700 s of a battery not moving at 100 %.
    While the clock was a local inside `run_polar`'s `async with _connect(...)` block, every dropped link
    restarted the count — and a device in a dock is precisely a device that keeps dropping its link.
    Measured 2026-08-15: the Verity reconnected at 10:03 / 10:10 / 10:15 / 10:20, gaps of 6.7, 4.9 and
    5.0 min, streaming noise at 176 Hz with battery pinned at 100 and `charging` False throughout. The
    guard was correct, wired, and structurally unreachable in the one scenario it was written for.

    `prev` came from module-level STATUS and so already survived; only the clock did not. Half the rule
    persisted and half reset, which is why the asymmetry was invisible from either half.
    """
    if prev != lvl or store.get(name) is None:
        store[name] = now
        return False
    return bool(full_battery_implies_charging(lvl, now - store[name], min_flat_s=min_flat_s))


def stream_health(nominal_fs, eff_fs, age_s, warmup: bool = False,
                  *, weak_frac: float = _WEAK_FRAC, stall_s: float = _STALL_S) -> str:
    """Classify one stream's link health from its nominal rate, measured effective rate, and the age of
    its last sample. PURE (no bus state) so it is unit-testable. Returns 'good'|'weak'|'stall'|'idle'.
      • idle  — declared but never produced a sample (age_s is None)
      • waveform stream (nominal > 5 Hz): stall on silence > stall_s, else weak when eff < weak_frac·nominal
      • slow/event stream (spo2/pr/ppi/rr): rate-judging is meaningless → only stall on prolonged silence.

    `eff_fs` may be None — "not enough history to state a rate" (see TelemetryBus._stream_rate). That is
    NOT the same as 0.0, and it must never paint WEAK: silence is already caught by `age_s` above, so an
    unmeasurable rate carries no bad news. Reporting 0.0 there is the fabrication this distinction
    exists to prevent — a measurement of silence for a stream nobody measured."""
    if age_s is None:
        return "idle"
    if (nominal_fs or 0) > 5:                       # continuous waveform
        if age_s > stall_s:
            return "stall"
        if warmup or eff_fs is None:
            return "good"                           # not enough history to call it weak yet
        return "weak" if eff_fs < weak_frac * nominal_fs else "good"
    quiet = max(stall_s, 4.0 / (nominal_fs or 1))   # event stream: expect a sample every ~1/fs s
    return "stall" if age_s > quiet else "good"


@dataclass
class StreamMeta:
    key: str            # 'ecg' | 'ppg' | 'acc_h10' | ...  (device-qualified where a stream isn't unique)
    label: str          # human label for the UI
    unit: str
    fs: float           # nominal sample rate (Hz); 0 for irregular / per-event (ppi, rr, spo2)
    chans: int = 1      # channels per sample (ppg=4, acc/gyro/mag=3) — UI draws one trace per channel
    labels: tuple = ()  # per-channel labels, e.g. ("LED1","LED2","LED3","ambient") | ("X","Y","Z")


# Device-unique base streams. Anything that can come from >1 device (ACC/GYRO/MAG/PPI/PPG) is registered
# per-device at capture time via bus.register() with a device-qualified key, so two sensors' ACC never
# collide on one ring.
#
# `ppg` was listed here and has been REMOVED (issue #410). It stopped being device-unique when the
# O2Ring began streaming its finger pleth: two devices then declared `ppg`, the bare key went to
# whichever the UI matched first, and the Verity's card showed the ring's battery/RSSI. Its live entry
# is now registered as `ppg_vs` from capture.py; leaving a placeholder here would paint a permanently
# idle "PPG" card that no device ever fills.
DEFAULT_META = {
    "ecg":  StreamMeta("ecg",  "ECG (Polar H10)",        "µV",    130),
    "spo2": StreamMeta("spo2", "SpO₂ (Wellue O2Ring)",   "%",       1),
    "pr":   StreamMeta("pr",   "Pulse rate (O2Ring)",    "bpm",     1),
}


class TelemetryBus:
    def __init__(self, ring_seconds: float = 12.0):
        self._ring_seconds = ring_seconds
        self._rings: dict[str, collections.deque] = {}
        self._meta: dict[str, StreamMeta] = dict(DEFAULT_META)
        self._subs: set[asyncio.Queue] = set()
        self._active: set[str] = set()   # streams that have produced data this session
        self._win: dict[str, collections.deque] = {}   # stream -> deque[(mono_ts, n_samples)] for rate calc
        self._last_mono: dict[str, float] = {}         # stream -> monotonic time of last push (stall calc)
        self._shape_err: dict[str, str] = {}           # stream -> "declared N, got M" (channel-count breach)

    def _stream_rate(self, stream: str, now: float) -> tuple[float | None, float | None, bool]:
        """(effective_fs | None, age_of_last_sample_s | None, warmup) for one stream.

        MEASURED ON THE DEVICE CLOCK where the frames carry one (DEVICE-RATE-TRUTH §6.3). Two defects
        were fixed together here, because they have the same cure:

        · OFF-BY-ONE. This used to run `span` from the OLDEST frame's ARRIVAL while `total` counted that
          frame's samples as well — but those samples arrived AT the start of the interval, they were not
          produced during it. For k frames of n samples at spacing T that is `k·n / ((k−1)·T)`: a k/(k−1)
          overstatement that is always positive and never averages out. The 5 s window holds ~9 ECG
          frames, so 130 Hz read 130 × 9/8 = 146.25 predicted, 146.6 observed on the box. Counting
          exactly the frames that closed inside the interval (`frames[1:]`) makes it an identity.

        · HOST CLOCK. BLE hands over several frames in one connection event, so their arrival times
          collapse together and an arrival-time denominator measures the RADIO's batching rather than
          the sensor. The device's own `sensor_ns` is immune by construction.

        Falls back to arrival times — with the off-by-one still fixed — for streams that push no device
        stamp (the O2Ring paths), and for a device clock that did not advance: the H10 resets to a 2019
        epoch whenever it leaves the strap (DEVICE-RATE-TRUTH §3), so a non-monotonic pair is a real
        event, not a theoretical one, and 'refuse this reading' beats a negative rate.

        Returns None — never 0.0 — when there is no interval to measure over. `0.0` is a *measurement*
        of silence and reads downstream as a dead stream; "one frame so far" is not that.
        """
        last = self._last_mono.get(stream)
        age = (now - last) if last is not None else None
        w = self._win.get(stream)
        if not w:
            return None, age, True
        cutoff = now - _RATE_WIN_S
        while w and w[0][0] < cutoff:
            w.popleft()
        # < 2 frames spans no interval. Note this also covers the everything-aged-out case, which used
        # to return 0.0 and is the same fabrication: an empty window has not measured a rate of zero.
        if len(w) < 2:
            return None, age, True
        dev0, devN = w[0][2], w[-1][2]
        span = (devN - dev0) / 1e9 if (dev0 is not None and devN is not None and devN > dev0) else (w[-1][0] - w[0][0])
        if span <= 0:
            return None, age, True        # simultaneous arrivals and no usable device stamp
        # frames[1:] — exactly the samples that closed inside (first, last]. The oldest frame's samples
        # mark the interval's START; counting them is the k/(k−1) bias.
        total = sum(n for _, n, _ in list(w)[1:])
        return total / span, age, span < _WARMUP_S

    def meta(self) -> list[dict]:
        now = time.monotonic()
        out = []
        for m in self._meta.values():
            eff, age, warmup = self._stream_rate(m.key, now)
            row = {"key": m.key, "label": m.label, "unit": m.unit, "fs": m.fs,
                   "chans": m.chans, "labels": list(m.labels),
                   "active": m.key in self._active,
                   # null, not 0, when the window holds no interval — the JSON contract mirrors
                   # `_stream_rate`'s refusal rather than flattening it into a measured zero.
                   "effFs": None if eff is None else round(eff, 3),
                   "health": stream_health(m.fs, eff, age, warmup)}
            # Present ONLY when breached, so a reader can treat the key's existence as the alarm and no
            # existing consumer sees a new field on a healthy stream.
            if m.key in self._shape_err:
                row["shapeError"] = self._shape_err[m.key]
            out.append(row)
        return out

    def shape_errors(self) -> dict[str, str]:
        """{stream: description} for every stream that has EVER delivered a frame whose channel count
        contradicted its declared shape. Sticky for the life of the bus — a breach is a data-integrity
        event, so it must not be cleared by the next well-formed frame. Empty dict == clean."""
        return dict(self._shape_err)

    def register(self, key: str, label: str, unit: str, fs: float,
                 chans: int = 1, labels=()) -> None:
        """Declare a stream so the UI shows it (with per-channel labels) even before the first frame.
        Idempotent; call once per device stream when its capture opens."""
        self._meta[key] = StreamMeta(key, label, unit, fs, chans, tuple(labels))

    def unregister(self, key: str) -> None:
        """Drop a stream (e.g. its START was rejected) so it stops showing as an idle card."""
        self._meta.pop(key, None)
        self._rings.pop(key, None)
        self._active.discard(key)
        self._win.pop(key, None)
        self._last_mono.pop(key, None)
        # `_shape_err` is deliberately NOT cleared: a breach recorded against this key is evidence about
        # the night, and an unregister/re-register cycle (which every reconnect performs) must not be
        # able to launder it away.

    def push(self, stream: str, values, fs: float | None = None, dev_ns: int | None = None):
        """Append a frame's worth of samples and broadcast to subscribers. `values` is either a flat
        iterable of numbers (scalar stream) OR an iterable of per-sample channel sequences (multi-channel,
        e.g. PPG [c0,c1,c2,amb] or ACC [x,y,z]). The `v` field mirrors that shape so the UI knows.

        `dev_ns` is this frame's LAST sample on the DEVICE's own counter (PMD `sensor_ns`). Optional and
        additive: streams that have no device clock (the O2Ring paths) simply omit it and keep the
        arrival-time rate. Passing it is what makes `effFs` immune to BLE batching — see `_stream_rate`."""
        values = list(values)
        if not values:
            return
        multi = isinstance(values[0], (list, tuple))
        rows = [tuple(float(x) for x in row) for row in values] if multi else [float(v) for v in values]
        nch = len(rows[0]) if multi else 1
        m = self._meta.get(stream)
        rate = fs or (m.fs if m else 0) or 1
        # STREAM SHAPE IS AN INVARIANT, NOT A FIELD TO REFRESH (2026-07-25). This used to do
        # `m.chans = nch` — silently conforming the DECLARED shape to whatever arrived. A stream's
        # channel count is fixed by the hardware (`_LIVE_META` in capture.py declares it at START:
        # ECG 1, PPG 4, ACC/GYRO/MAG 3, PPI 2), so a frame of a different width is decoder corruption,
        # and rewriting the metadata is precisely the "quietly normalise bad input" move this suite
        # forbids — it makes the UI believe the sensor genuinely changed shape.
        #
        # Recorded and logged rather than RAISED, deliberately. `push()` is called from bleak's
        # notification callback AFTER the durable write, and outside `on_pmd`'s try/except — a raise
        # there escapes into the D-Bus dispatch, where it is logged and swallowed. That is quieter, not
        # louder, and it would abort the status update while changing nothing on disk. `shape_errors()`
        # rides `meta()` to the monitor, which is the surface a human actually watches.
        if m and m.chans != nch:
            prev = self._shape_err.get(stream)
            self._shape_err[stream] = f"declared {m.chans} channel(s), frame carried {nch}"
            if prev is None:       # once per stream — this path can run at 130 Hz
                log.error("STREAM SHAPE BREACH on %r: %s — decoder corruption, not a shape change; "
                          "dropping the frame from the live view and flagging the stream",
                          stream, self._shape_err[stream])
            # DROP the malformed frame rather than ring it. Mixing widths in one ring would hand
            # `snapshot()` ragged rows under a single declared `chans`, so the UI would mis-plot them as
            # if they were real. This is a live view — a corrupt frame has no value worth rendering, and
            # the flag says so out loud. The durable file is unaffected: it was written before this call.
            return
        # Min 64 keeps slow/event streams (spo2/pr/ppi/rr @ ~1 Hz) to a usable window, not ~12 samples.
        cap = max(64, int(self._ring_seconds * rate))
        ring = self._rings.get(stream)
        if ring is None or ring.maxlen != cap:
            ring = collections.deque(ring or (), maxlen=cap)
            self._rings[stream] = ring
        ring.extend(rows)
        self._active.add(stream)
        now = time.monotonic()                       # link-health: track packets/sec vs nominal (no root)
        self._last_mono[stream] = now
        w = self._win.get(stream)
        if w is None:
            w = self._win[stream] = collections.deque()
        w.append((now, len(rows), dev_ns))
        cutoff = now - _RATE_WIN_S
        while w and w[0][0] < cutoff:
            w.popleft()
        msg = {"stream": stream, "fs": rate, "v": rows, "chans": nch,
               "t": _dt.datetime.now().strftime("%H:%M:%S")}
        for q in list(self._subs):
            if q.full():
                try: q.get_nowait()
                except asyncio.QueueEmpty: pass
            try: q.put_nowait(msg)
            except asyncio.QueueFull: pass

    def snapshot(self, stream: str) -> dict:
        ring = self._rings.get(stream)
        m = self._meta.get(stream)
        return {"stream": stream, "fs": m.fs if m else 0,
                "chans": m.chans if m else 1, "labels": list(m.labels) if m else [],
                "v": list(ring) if ring else []}

    def subscribe(self, maxsize: int = 64) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subs.discard(q)
