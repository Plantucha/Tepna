# tepna-capture — cpap_continuity.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""INV8 — recovery does not imply continuity until continuity is VERIFIED (CPAP-ACQ-P3 W3).

THE FACT THIS MODULE EXISTS TO STATE. On this box a BLE drop ENDS the live acquisition: `LiveStreamController`
does not resume, the pump raises out of its loop, and `cpap_live`'s bounded auto-start opens a NEW session —
new streamId, new sinks. Measured 2026-09-18 on vigil: 5–27 live-stream starts per day, i.e. that boundary
is the common case, not the exception. Until now the session after a drop was indistinguishable from a
first session, and a consumer downstream could not tell "this stream ran unbroken" from "this stream is
the second half of something that tore". The supervisor's own comment (`cpap_supervisor.py:225`, *"we can
no longer vouch for its continuity"*) names the condition; nothing carried it.

WHAT "VERIFIED" MEANS HERE — CONCRETELY, from the evidence the device already sends. Every StreamData frame
carries `startTime` (a device ISO stamp, e.g. `2026-08-23T01:30:28.730Z`) and `intervalMs`. So the last
frame of a session fixes the device time of the NEXT sample that should have followed it. The first frame
of the session that follows a drop either starts there (the device buffered through the drop and NOTHING
was lost) or starts later (a gap, whose length is `first − expected`). That comparison is the verification:
it is done on the device's own clock, so host wall-time, BLE latency and the auto-start's retry backoff
cannot fake it either way.

FOUR STATES, NOT THREE — and the fourth is the §∅ point, so it is stated rather than argued around:

    continuous           this acquisition was never interrupted (a first session, or one after a
                         DELIBERATE stop — a stop is not a recovery)
    resumed-unverified   this session follows a DROP and the device times have not been compared:
                         no frame has arrived yet, the previous session left no usable frame, or the
                         daemon restarted in between and the predecessor's clock was never persisted
    verified-continuous  follows a drop, and the first frame's device time is at (or before) the sample
                         the previous session was owed — no samples lost
    verified-gap         follows a drop, and the device time shows samples WERE lost; `gap_ms` says how many

W3's text names three. The design brief left "what verification means" open, and a verification that can
return only one answer is not one. §∅ says "the unverified case is its own value"; the same rule, read in the
other direction, says the VERIFIED case must not be hidden inside the unverified one: ASSERTING IGNORANCE
WHERE THERE IS KNOWLEDGE IS THE MIRROR OF ASSERTING KNOWLEDGE WHERE THERE IS IGNORANCE. Folding a measured
gap into `resumed-unverified` hands a consumer "we did not check" when the truth is "we checked, and this
much was lost"; folding it into `verified-continuous` is the plain fabrication. Either way a number the
device supplied is thrown away. The gap is what the consumer needs to know; it gets its own word. (Kestrel's
phrasing of the symmetry, adopted 2026-09-18 because it generalises past this field.)

∅ THE DEFAULT AFTER A DROP IS `resumed-unverified`, NEVER `continuous`. `continuous` is EARNED by a fresh
start with no predecessor drop, or by a deliberate stop clearing the slate. A daemon that comes up with no
persisted predecessor state — a crash, a SIGKILL — also cannot claim `continuous` for a session that may
be a resume; the controller resolves that with `resume_hint` from the autostart record.

Pure and deterministic: no clock is read, no I/O, no transport. The stamp parser is EXPLICIT-FORMAT per the
Clock Contract §2 — a regex on the device's own shape, never `datetime.fromisoformat` on a vendor string;
anything else parses to None and the tracker stays honest rather than guessing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

# The device's own shape, verbatim from the wire: `2026-08-23T01:30:28.730Z`. Fractional seconds are
# optional (some frames carry `.000`), the zone is the literal `Z`. Nothing else is accepted.
_DEV_STAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$")

# A first frame is "at or before the owed sample" if it lands within ONE interval of it. The device
# batches samples into frames, so a resume that picks up mid-frame is still lossless; half an interval
# would flag ordinary batching as a gap, two would hide a one-frame loss.
TOLERANCE_INTERVALS = 1.0


class Continuity(str, Enum):
    CONTINUOUS = "continuous"
    RESUMED_UNVERIFIED = "resumed-unverified"
    VERIFIED_CONTINUOUS = "verified-continuous"
    VERIFIED_GAP = "verified-gap"


def parse_device_stamp_ms(s) -> float | None:
    """Device ISO `…Z` stamp → epoch ms, or None. Explicit format; a stamp in any other shape is
    ABSENT, not guessed (Clock Contract §2, §∅)."""
    if not isinstance(s, str):
        return None
    m = _DEV_STAMP.match(s.strip())
    if not m:
        return None
    y, mo, d, hh, mm, ss, frac = m.groups()
    try:
        dt = datetime(int(y), int(mo), int(d), int(hh), int(mm), int(ss), tzinfo=timezone.utc)
    except ValueError:  # 2026-13-45 — the regex matches digits, not calendars (§2.7)
        return None
    ms = int((frac or "0").ljust(6, "0")[:6]) / 1000.0
    return dt.timestamp() * 1000.0 + ms


@dataclass
class ContinuityTracker:
    """One per controller; lives across sessions so the session after a drop can see the one before it.

    The three notifications map onto the three things a controller actually knows:
      • `note_frame`  — the pump saw an OK StreamData frame (called per frame; cheap)
      • `note_end`    — the pump finished, and whether it did so CLEANLY (deliberate stop / therapy end)
                        or by RAISING (a drop). Only a drop arms a resume.
      • `note_start`  — a new session is opening; resolves the status the session begins in
    `status` and `gap_ms` are what the surfaces publish. `snapshot()` is the dict form."""
    status: Continuity = Continuity.CONTINUOUS
    gap_ms: int | None = None
    # device epoch-ms of the sample the previous session was OWED (last frame's start + its span)
    _expected_next_ms: float | None = None
    # set by a drop, cleared by a clean end or by the first frame of the following session
    _armed: bool = False
    # the interval the verification tolerance is measured in; from the last frame seen
    _interval_ms: float | None = None

    # ── notifications ──────────────────────────────────────────────────────────────────────────────
    def note_frame(self, start_time, n_samples, interval_ms) -> None:
        """Called per OK frame. The FIRST frame after an armed drop performs the verification; every
        frame advances the owed-sample clock. Unparseable inputs leave the clock untouched rather than
        moving it to a guess."""
        start = parse_device_stamp_ms(start_time)
        try:
            n = int(n_samples)
            iv = float(interval_ms)
        except (TypeError, ValueError):
            n, iv = 0, 0.0
        if self._armed:
            self._verify(start)
            self._armed = False
        if start is None or iv <= 0:
            return  # no usable device clock on this frame; the owed sample stays where it was
        self._interval_ms = iv
        self._expected_next_ms = start + n * iv

    def note_end(self, *, clean: bool) -> None:
        """The pump finished. Clean (a deliberate stop, a therapy-end auto-stop) means the NEXT session is a
        fresh acquisition and starts `continuous`. Not clean (the link raised) means the next session is a
        RESUME and starts `resumed-unverified` until its first frame says otherwise."""
        if clean:
            self._armed = False
            self._expected_next_ms = None
        else:
            self._armed = True

    def note_start(self, *, resume_hint: bool = False) -> None:
        """A session is opening. `resume_hint=True` is the controller telling us the daemon was restarted
        with a therapy in progress (the autostart record says so): the predecessor's clock is gone, so
        the honest state is `resumed-unverified`, not the `continuous` a fresh tracker would default to."""
        if resume_hint and not self._armed:
            self._armed = True
            self._expected_next_ms = None
        if self._armed:
            self.status = Continuity.RESUMED_UNVERIFIED
        else:
            self.status = Continuity.CONTINUOUS
        self.gap_ms = None

    # ── the verification ───────────────────────────────────────────────────────────────────────────
    def _verify(self, first_start_ms) -> None:
        if first_start_ms is None or self._expected_next_ms is None or not self._interval_ms:
            # Nothing to compare against: the predecessor left no usable clock, or this frame has none.
            # Stays RESUMED_UNVERIFIED — which is the truth, and is why the state exists.
            return
        delta = first_start_ms - self._expected_next_ms
        if delta <= TOLERANCE_INTERVALS * self._interval_ms:
            self.status = Continuity.VERIFIED_CONTINUOUS
            self.gap_ms = 0
        else:
            self.status = Continuity.VERIFIED_GAP
            self.gap_ms = int(round(delta))

    # ── surfaces ───────────────────────────────────────────────────────────────────────────────────
    def snapshot(self) -> dict:
        return {"continuity_status": self.status.value, "continuity_gap_ms": self.gap_ms}


def resume_hint_from_autostart(record) -> bool:
    """Was a therapy in progress when the daemon last ran? Read off the auto-start record the daemon
    keeps across restarts (`cpap-autostart-session.json`): a numeric `session_ms` means the loop had
    keyed a live session and did not close it. That is the one fact a brand-new tracker cannot know
    and must not default — a daemon that comes up mid-therapy is RESUMING, whatever its memory says.
    None / malformed / no session ⇒ False (no claim, not a claim of continuity)."""
    if not isinstance(record, dict):
        return False
    return isinstance(record.get("session_ms"), (int, float)) and not isinstance(record.get("session_ms"), bool)
