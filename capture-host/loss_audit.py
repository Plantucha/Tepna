# tepna-capture — loss_audit.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE NIGHT'S LOSS LEDGER — CAPTURE-LOSS-PRECEDENCE-AUDIT R4 (owner ruling 2026-09-22).

The audit's §0 metric, run every night by the daemon and written beside QC-SUMMARY.json as
`LOSS-AUDIT.json` with a `tepna.verdict/1` (`gate: night-loss`) beside it:

  · for each configured device's PRIMARY stream, every gap longer than the stream's own delivery
    cadence (`nights_index._cadence_gap` — the same cut the Nights page's fragment count uses);
  · each gap ATTRIBUTED to the last journal line for that device in the seconds before it opened —
    `daemon:*` (the box chose to end the link) · `link:*` (the radio) · `device:*` · `unattributed`;
  · summed as minutes per cause per device, and as the night's `worn_lost_min` — the gap minutes on
    nights where the device's own beat evidence says it was worn.

THE BAR IS 1 % OF THE WORN SPAN, RULED BY THE OWNER 2026-09-29. Until that day this module reported
the number under `status: UNKNOWN` and refused to judge it, because a PASS/FAIL would have been a bar
the module invented (memory `pre-state-the-threshold`); the ruling supplies the missing half and the
status now follows from it. The criterion is pre-stated with its source and is NOT derived from the
nights it judges (§🧾): `worn_but_not_recorded_fraction <= 0.01`. ⚠️ The criterion's NAME is the
published identity of the metric — it appears in `criterion.name` AND as the key in `result` — so it
stays `worn_but_not_recorded_fraction` verbatim; the ruling reached this session paraphrased as
`worn_not_recorded_fraction`, and renaming to match a paraphrase would break every consumer and every
stored verdict for no gain. What the object already does, bar or no bar: a night the daemon
itself tore names `daemon:not-worn drop` in `result.by_cause` the morning after — the tripwire that
would have caught 2026-09-03 (25 fragments) eighteen nights before 2026-09-20.

The journal is read with `journalctl` (read-only, the capture unit only, the night's window); where
it is unavailable every gap is `unattributed (no journal)` and the object says so.

The audit also records the journal's own SHAPE (`journal_shape`, published again in the verdict's
`result`): how many lines, how few distinct messages, and at what rate. A night's journal can be
99.6 % one repeated message, and until this landed nothing reported that — see `journal_shape`.
"""

from __future__ import annotations

import bisect
import datetime as _dt
import glob
import itertools
import math
import os
import re
import statistics
import subprocess

import nightqc
import nights_index as _ni
import probe_night as _probe
import verdict as _verdict

GATE = "night-loss"
TOOL = "capture-host/loss_audit.py"
AUDIT_NAME = "LOSS-AUDIT.json"
VERDICT_NAME = "LOSS-VERDICT.json"
# A superseded LOSS verdict is RECORDED, not erased: the poller re-runs this audit whenever the night's
# data is newer than it, so a night whose files keep arriving had each prior claim overwritten with no
# trace (`2026-10-05-the-loss-audit-replaces-its-own-verdict-with-no-withdrawal-record`). The mechanism
# is `verdict.withdraw`, the same one `solid_night` uses one layer up.
WITHDRAWN_NAME = "LOSS-VERDICT-WITHDRAWN.jsonl"
REAUDITED = (
    "re-audited: the night's data changed after this verdict was published, so the audit ran again "
    "over an input set this verdict does not describe"
)
# THE OWNER'S BAR, 2026-09-29: worn-but-not-recorded must be at most 1 % of the worn minutes. Stated
# here as a number with its source, before any night is judged by it — a threshold derived from the data
# it judges is UNKNOWN by the verdict contract, not a bar.
THRESHOLD: float = 0.01
CRITERION = {
    "name": "worn_but_not_recorded_fraction",
    "threshold": THRESHOLD,
    "unit": "fraction",
    "direction": "lte",
}
# ───────── THE JOURNAL'S SHAPE (residue 2026-09-23-a-journal-that-is-almost-entirely-one-line-is-reported-by-nothing)
# A night's journal can be 99.6 % ONE repeated message and no artifact says so. Measured on vigil for
# 2026-09-18 22:00 → 09-19 06:30: 415,161 lines, of which 206,800 `ERROR CPAP durable sink failed —
# counted (sink_errors=0)` plus 206,800 `NoneType: None` = 99.6 %, leaving 1,561 lines of real signal.
# The log bug itself was fixed (#2641 had slid a `_log.exception` into a timing `finally`, so it fired on
# every SUCCESSFUL write); what was never fixed is that NOTHING DETECTED IT — a person found it five
# nights later reading the journal for an unrelated reason.
#
# A failure path that also fires on success is a silent one: the real error, when it comes, is one line
# in two hundred thousand. So the shape of the journal is itself a measurement, and the night-loss
# verdict now reads it.
#
# THE THRESHOLDS ARE PRE-STATED AND CALIBRATED ON NIGHTS OTHER THAN THE ONES THEY JUDGE (§🧾). The
# flooded night ran at 415,161 / 30,600 s = 13.6 lines/s with a 99.6 % dominant share and 6.8 ERROR/s;
# the same window on 2026-09-17, 09-19, 09-20 and 09-22 — 365–440 recorded minutes each — returned a
# grep count of ZERO for that message. Round numbers with two orders of magnitude of headroom below the
# flood and above a normal night, so neither bound is a curve fitted to either:
JOURNAL_TOP_N = 3  # how many templates the share is summed over — see why it cannot be ONE, below
JOURNAL_TOP_SHARE = 0.90  # the top few templates taking nine tenths of the journal is a uniformity finding
JOURNAL_MIN_LINES = 10_000  # ...but ONLY over a journal big enough for uniformity to mean anything
JOURNAL_LINES_PER_S = 1.0  # a capture daemon does not have one event a second to report
JOURNAL_ERROR_PER_S = 0.1  # ...and an ERROR every ten seconds all night is not an error
# 🔴 THE SHARE IS SUMMED OVER THE TOP FEW TEMPLATES, NOT THE TOP ONE, AND THE FIRST DRAFT OF THIS RULE
# COULD NOT FIRE ON ITS OWN CALIBRATION NIGHT. The flood was 206,800 ERROR lines PLUS 206,800
# `NoneType: None` tracebacks — 99.6 % together, but the single biggest template is 206,800 / 415,161 =
# 49.8 %, UNDER a 50 % bar. A logged failure arrives as a message and its traceback, so the repeated
# unit is two lines, and a top-1 share measures half of it.
# 🔴 AND THE VOLUME FLOOR IS NOT A DETAIL. A quiet night is a short journal, and a short journal is
# easily nine tenths three templates — 1,561 lines of real signal is what the flooded night left, and a
# bar without a floor convicts every normal night of being uniform. 10,000 lines sits 6.4x above that
# normal night and 41x below the flood. The floor guards the SHARE only: the two rate findings carry
# their own volume by construction.
# Templates are formed by blanking every run of digits, so `sink_errors=0` and `sink_errors=12` collapse
# onto one message. Without that, a flood whose counter increments reads as 206,800 DISTINCT messages
# and the share is 1/206,800 — the uniformity is in the message, not in the bytes.
_JOURNAL_STAMP = re.compile(r"^\S+ \S+ ")  # `short-iso` stamp + host, dropped before templating
_JOURNAL_NUM = re.compile(r"\d+")
_JOURNAL_TEMPLATE_CHARS = 160  # a template is a label for a reader, not a record of the line

ATTRIB_WINDOW_S = 15.0
# ...and the same reach FORWARD of the gap's start. A gap's start is the stream's LAST DELIVERED ROW, so
# the daemon logs the action that caused it AFTER that row — measured on the H10 over 2026-09-17→23, all 39
# real-loss gaps (10-55 s device steps, 11.0 min) had their `pull paused live` line 1-3 s after the start
# and NOT ONE before it, so the backward-only search called every one `unattributed` and inflated
# SOLID-NIGHT's unattributed leg with the daemon's own designed behaviour.
#
# ⚠️ REACH PAST THE START, NOT ACROSS THE WHOLE GAP, and the difference is not cosmetic. The remedy first
# proposed was a window `[start, end + margin]` taking the first event inside it; the existing assertion at
# `test_attribution_takes_the_last_journal_line_within_the_window_or_says_unattributed` refutes it — there a
# `not-worn drop` sits 1 s BEFORE a 121 s gap and a `dbus busy` 101 s INTO it, and the wide window hands the
# gap to the event 101 s deep while demoting the one at the boundary. An event that merely happens during an
# outage is not its cause. So the forward reach is bounded by the same measurement that motivated it: the
# observed lag between action and log line ran to 1.895 s (2026-09-21T00:17:54 gap, pause at 00:17:55.895),
# and 3 s is the next whole second above that maximum. Events deeper in the gap are published as
# `in_gap_cause` — information a reader may want, never the attribution.
ATTRIB_FORWARD_S = 3.0

# journal line → cause bin, first match wins (order matters: a not-worn drop line also says "link")
KINDS: tuple[tuple[str, str], ...] = (
    ("daemon:not-worn drop", "not worn for"),
    ("daemon:pull paused live", "live capture paused"),
    ("daemon:charging hold", "charging — PMD streams unavailable"),
    # the clock watchdog re-sync runs an offline op that PAUSES live capture — the box tearing its own
    # recording. Without this bin 147 min of H10 loss over 28 corpus nights (2026-08-25 → 09-21, the
    # 2026-09-04/05/12 resync storms #2459 fixed) read as `unattributed`.
    ("daemon:clock re-sync", "off host (tolerance"),
    ("daemon:stream stall re-negotiate", "silent for"),
    ("device:powered off", "powered off"),
    ("link:timeout / not found", "TimeoutError"),
    ("link:not advertising", "not advertising"),
    ("link:dbus busy", "InProgress"),
    ("link:error other", "link error"),
    ("daemon:restart", "Starting tepna-capture"),
)

# which stream is a device's PRIMARY, by model — the same choice the Nights index makes
# ── THE RECORDING'S FOLDER SET — ONE DEFINITION, THE JUDGE'S ────────────────────────────────────────
#
# 🔴 THE DEFECT (owner, the night of 2026-10-09→10). The judge spans a recording across folders
# (`solid_night_inputs.recording_scope`, #3297/#3337) but this audit globbed ONE folder, so for a night
# whose wearables started after midnight — ring 21:25 in 2026-10-09, Verity 01:47 and H10 01:50 in
# 2026-10-10 — the primary glob found nothing, the audit wrote `"no primary file this night"` for both
# Polar devices, and the judge then said "the loss audit examined None, which does not cover the worn
# interval". The verdict was STRUCTURALLY UNKNOWN: no re-run could have fixed it, and the 18:51 re-audit
# on a current daemon reproduced it byte-identically.
#
# ⚠️ FIVE GLOBS CARRIED THE PER-FOLDER ASSUMPTION, not one — the primary, `wear_ends`,
# `_has_worn_evidence`, `signal_witness`, and `_relink_gap`, which already reached into the next day with
# its OWN hand-rolled date arithmetic. Fixing the primary alone would have left the WEAR evidence
# folder-scoped, so the audit's two halves would describe different nights — the same split this file's
# own `max(getsize)` comment records. One definition, asked of the judge.
#
# ⚠️ THE FOLDER SET AND THE MEMBERSHIP FILTER ARE SEPARATE CONCERNS, and conflating them breaks
# `_relink_gap`. Membership (`in_band`) answers "is this file part of THIS recording" and belongs on the
# audit's own evidence. `_relink_gap` asks "when did this stream next appear", whose answer may legally
# be in the NEXT band — filtering it would report "no next file" and turn a measured relink gap into a
# silent None. So the band filter is opt-out, and the one caller that opts out says why.


def _recording_dirs_and_band(night_dir: str):
    """`(dirs, band)` for the recording judged in `night_dir` — `recording_scope`'s own answer.

    Function-local import: `solid_night_inputs` imports THIS module (`import loss_audit as _la`), so a
    module-level import back would be a cycle. Checked before writing it."""
    import solid_night_inputs as _si

    sc = _si.recording_scope(night_dir)
    return (sc.get("dirs") or [night_dir.rstrip("/")]), sc.get("band")


def _recording_glob(night_dir: str, pattern: str, *, membership: bool = True) -> list[str]:
    """The recording's files matching `pattern`, across its folder set. Sorted, so callers that took a
    `sorted(glob.glob(...))` keep their order exactly."""
    import solid_night_inputs as _si

    dirs, band = _recording_dirs_and_band(night_dir)
    out = [p for d in dirs for p in glob.glob(os.path.join(d, pattern))]
    # `is not False`, NOT a truth test, and the difference is a killable mutant rather than style:
    # `membership=None` reads as False under `if membership:`, so a caller that passed None — or a
    # mutation that writes it — silently disabled the band filter and NO input could tell. Anything but
    # an explicit False now filters, which is also the fail-safe direction: the flag exists to widen the
    # scope deliberately, so an unrecognised value must not widen it by accident.
    if membership is not False:
        out = [p for p in out if _si.in_band(p, band)]
    return sorted(out)


PRIMARY_BY_MODEL: dict[str, str] = {
    "H10": "Polar_H10_*_ECG.txt",
    "VeritySense": "Polar_VeritySense_*_PPG.txt",
    "O2Ring-S": "Wellue_O2Ring-S_*_SPO2.csv",
}
# the device's OWN wear evidence for the night: a file whose rows carry a MEASURED value, named by the
# COLUMN that carries it. The column is resolved from each file's own header, never by position.
#
# Position was wrong, and wrong in the shape ABSENCE-IS-NULL names. The box wrote `_PPI.txt` in its own
# column order until 2026-08-05 (`5e5ac71a`), with `sensor timestamp [ns]` second -- a field the Polar PPI
# stream does not carry, written as a literal 0 on every row of all 7 such files. Reading column 1
# positionally therefore read that fabricated 0 as the beat interval, ran off the end of the file, and
# scored 2026-08-04 -- 24 997 measured beats, none of them zero -- as `worn_evidence: False`. Verified
# against the deployed reader on the box: False for that night, True for a phone-layout night beside it.
# Resolving by name is what makes the two layouts one reader, and it is why a header that does NOT name
# the column returns null below rather than a verdict.
WORN_EVIDENCE_BY_MODEL: dict[str, tuple[str, str]] = {
    "H10": ("Polar_H10_*_HR.txt", "HR [bpm]"),
    "VeritySense": ("Polar_VeritySense_*_PPI.txt", "PP-interval [ms]"),
    "O2Ring-S": ("Wellue_O2Ring-S_*_SPO2.csv", "Oxygen Level"),
}


# ── THE OPERATOR'S TIME SYNC is not the daemon's doing ─────────────────────────────────────────────────
# The monitor's sync button (`POST /api/timesync/all`) runs an offline-recording op per Polar, several in
# sequence, and each pauses live capture: a real loss that the journal names only as `offline-recording op —
# live capture paused`, i.e. `daemon:pull paused live`, which SOLID-NIGHT scores as a DAEMON REGRESSION. On
# 2026-09-24 one press (22:00:54) cost the night an H10 continuity FAIL that way. The press is its own cause.
# ⚠️ The access log is written at request COMPLETION (journal 22:01:17); the request START is in its brackets
# (`[24/Sep/2026:22:00:54 -0400]`). The event is dated from the brackets, so it precedes the pauses it caused.
OPERATOR_TIMESYNC = "operator:time-sync"
TIMESYNC_NEEDLE = "POST /api/timesync"
TIMESYNC_TAIL_S = 60.0  # CHOSEN: 2026-09-24's pauses ran to 48 s after the request completed
# ── AN EVENT-LOOP STALL names no device, and it is the daemon's doing ──────────────────────────────────────
# The loop monitor's warning (`event loop stalled 15682 ms — every live stream's host stamps waited behind
# whatever held it`) carries no device name or address, so the per-device key filter dropped every one, and
# a gap the stall opened read `unattributed` with `daemon_caused_min: 0`. Measured on vigil (residue
# 2026-10-13-the-stall-that-tore-the-ring-is-invisible-to-the-attribution): five of night 10-12's six ring
# gaps, and on 10-18 a 17 s ring gap at 03:45:57 under a 15.7 s stall that began 1.3 s after it.
# ⚠️ The warning is logged when the loop WAKES, i.e. at the stall's END; the line states its own length,
# so the event is dated at the stall's START, the moment the cause began. A stall with no gap near it adds
# nothing: a cause bin attributes gaps and never counts a stall as loss (11 stalls on 10-12, 5 gaps).
# ⚠️ The monitor rate-limits the warning to one per 300 s, so a stall it suppressed stays invisible here.
LOOP_STALL = "daemon:event-loop stall"
LOOP_STALL_NEEDLE = "event loop stalled"
_LOOP_STALL_MS = re.compile(r"event loop stalled (\d+) ms")

# 🔴 THE BIN IS A SAMPLE, AND THE ARTIFACT NOW SAYS SO. The caveat above lived here as a comment, so a
# reader of `LOSS-AUDIT.json` saw `daemon:event-loop stall` events with nothing to tell them what the
# set covers — and an `unattributed` gap may sit beside a stall the journal never printed.
# ⚠️ AND THE SUPPRESSION IS NOT DERIVABLE FROM THE JOURNAL, though the warning line makes it look free:
# the line states `stalls so far: N`, but `capture._LOOP_LAG_STALL_MS` COUNTS a stall at 100 ms while
# `capture._LOOP_LAG_WARN_MS` LOGS one at 1000 ms. Those are two populations, so N minus the lines seen
# mixes a stall that never logs with one the limiter dropped (§🧾). `suppressed` is therefore `null`
# with its reason named (§∅) and never a derived count.
# ⚠️ THE RECORD DOES EXIST, and the reason names where: the daemon's own `loop` status block carries the
# live counter. Measured on vigil 2026-10-13 over one 90 s loss poll — the journal printed ONE line
# reading `stalls so far: 5`, while `/api/state`'s `loop` block reached `stalls 11` in the same window.
# This file reads the journal, so it quotes the pointer rather than a count it cannot take.
LOOP_STALL_LOGGED_MS = 1000.0  # mirrors capture._LOOP_LAG_WARN_MS — the drift guard is in the tests
LOOP_STALL_COUNTED_MS = 100.0  # mirrors capture._LOOP_LAG_STALL_MS
LOOP_STALL_WARN_EVERY_S = 300.0  # mirrors capture._LOOP_LAG_WARN_EVERY_S
LOOP_STALL_SUPPRESSED_REASON = (
    "two populations: the daemon counts a stall at %.0f ms and logs one at %.0f ms, capped at one line "
    "per %.0f s, so the journal cannot separate a suppressed stall from one that never logs; the live "
    "count is in the daemon's own loop status block, not here"
) % (LOOP_STALL_COUNTED_MS, LOOP_STALL_LOGGED_MS, LOOP_STALL_WARN_EVERY_S)


def stall_sample() -> dict:
    """What the `daemon:event-loop stall` bin covers, published beside the gaps it attributes.

    Pre-stated and constant: these are the daemon's own thresholds, not a reading of the night. So the
    object describes the SAMPLE and never counts it — `suppressed` stays `null` for the reason the
    comment above measures."""
    return {
        "cause": LOOP_STALL,
        "logged_at_or_over_ms": LOOP_STALL_LOGGED_MS,
        "counted_at_or_over_ms": LOOP_STALL_COUNTED_MS,
        "at_most_one_line_per_period_s": LOOP_STALL_WARN_EVERY_S,
        "suppressed": None,
        "suppressed_reason": LOOP_STALL_SUPPRESSED_REASON,
    }


_ACCESS_START = re.compile(r"\[(\d{2})/([A-Z][a-z]{2})/(\d{4}):(\d{2}):(\d{2}):(\d{2}) [+-]\d{4}\]")
_MONTHS = {
    m: i + 1 for i, m in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"))
}


def _access_start(line: str) -> _dt.datetime | None:
    """The request START of an access-log line (local time, as written), or None when it carries none."""
    a = _ACCESS_START.search(line)
    if a is None or a.group(2) not in _MONTHS:
        return None
    d, mon, y, hh, mm, ss = a.groups()
    return _dt.datetime(int(y), _MONTHS[mon], int(d), int(hh), int(mm), int(ss))


# SOLID-NIGHT §A5's RECORD SET, which is NOT `KINDS` above and must never be folded into it. `KINDS` bins a
# journal line as the CAUSE of a gap; these four phrases record that a CLOCK EVENT happened, whether or not
# any gap followed. The brief is explicit about every phrase and about why: matching `off host` alone missed
# the `device clock JUMPED` line that recorded 2026-08-18, and the tripwire then flagged a night the daemon
# had logged. A FAILED re-sync is still a record that a clock event happened — the attempt reached the
# device's clock whether or not it landed — so `re-sync busy` and `device clock unreadable` are records too.
CLOCK_EVENT_PHRASES: tuple[str, ...] = (
    "off host (tolerance",
    "device clock JUMPED",
    "re-sync busy",
    "device clock unreadable",
)


def read_clock_events(
    since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, str, str]] | None:
    """`[(local stamp, the phrase matched, the raw line)]` for the night's clock-event lines, or None when
    journalctl is unavailable.

    ONE PASS FOR THE WHOLE NIGHT, not one per device, and the caller filters by device afterwards: the
    phrases carry the device in the line itself, and `read_journal` above is already a subprocess per
    device. Making this a second per-device call would double the audit's process count for a record set
    that is a handful of lines a night — measured on vigil 2026-09-28, the whole window holds exactly ONE
    (`device clock unreadable`), and none of the other three.

    🔴 WHY THIS HAS TO BE PERSISTED AT ALL. `LOSS-AUDIT.json` has always written `journal: "read"` — a
    STATUS, not the lines — so after the audit ran, "did the box record a clock event at 04:08?" was
    unanswerable from the night's own files, and journald rotates. SOLID-NIGHT §A5's tripwire must not
    fire on a step the box DID record, and the verdict side has no journal of its own. So the component
    that already reads the journal writes what it read, beside the night, like every other piece of
    evidence.

    None, never `[]`, when the journal cannot be read: an empty list means "no clock event was recorded"
    and would license the tripwire to fire, while "the record set could not be read" must stop it (§∅)."""
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    out: list[tuple[_dt.datetime, str, str]] = []
    for ln in r.stdout.split("\n"):
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ln)
        if not m:
            continue
        for phrase in CLOCK_EVENT_PHRASES:
            if phrase in ln:
                out.append((_dt.datetime.fromisoformat(m.group(1)), phrase, ln))
                break
    out.sort(key=lambda r: r[0])
    return out


# ── A JOB THE BOX DECLARES FOR ITSELF IS A SPAN, NOT A LINE ───────────────────────────────────────────
#
# `KINDS` bins ONE line as a gap's cause, and every needle in it names the device in that same line. A
# job the box starts for ITSELF names no device, logs a START and an END, and what tore the ring sat
# BETWEEN them. Measured on the night of 2026-10-12→13 (residue
# `2026-10-13-the-stall-that-tore-the-ring-is-invisible-to-the-attribution`): five of the ring's six gaps
# start inside a `solid-night … — re-judged` … `solid-night <date> PASS|FAIL|UNKNOWN` bracket, 33–60 s
# after the bracket's first line, while the `event loop stalled` warning inside the same bracket sits
# 5–26 s before each gap. The stall line is one SAMPLE of the job's occupancy and never the cause, and no
# window around it reaches the gap: `ATTRIB_FORWARD_S` is 3 s and `ATTRIB_WINDOW_S` 15 s, each by its own
# measurement.
#
# ⚠️ THE ROW STATES ITS OWN TRAP, AND THE KEY IS WHAT KEEPS THIS OUT OF IT. Eleven stalls fell inside
# that night's window and five opened a gap, so a bin keyed on the STALL would claim every stall as loss.
# This bin is keyed on the JOB the box declares, and it reaches only a gap whose START falls inside one.
# Measured over the captures tree, 117 closed brackets between 2026-08-30 and 10-19: the ring carries 30
# unattributed gaps and 5 of them start inside a bracket, against 0.097 expected if its gaps fell
# uniformly over its 222.9 h of coverage, of which the brackets hold 2605 s (0.325 %) — an enrichment of
# 52x. The Polar streams see the same 2605 s and 0 of their 17 unattributed gaps start inside one. That
# asymmetry IS the mechanism: the ring is POLLED and carries no buffer, so a second the loop never asked
# for does not exist, while a PMD stream's device buffer replays it late and #3168's delay test already
# calls that a delay.
#
# The cap is the instrument's own bound. A start whose end line never arrives would otherwise swallow
# every line until the next verdict, and measuring the same brackets WITHOUT a cap put one at 87,982 s.
# 117 of 135 brackets close inside it (median 49 s, p90 66 s, max 89 s) and 18 are abandoned.
JOB_SPAN_CAP_S = 300.0
JOB_SPANS: tuple[tuple[str, str, str], ...] = (
    (
        "daemon:solid-night re-judge",
        r"solid-night: .* — re-judged",
        r"solid-night: \d{4}-\d{2}-\d{2} (?:PASS|FAIL|UNKNOWN)",
    ),
)


def read_job_spans(
    since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, _dt.datetime, str]] | None:
    """`[(start, end, cause)]` for the box's own declared jobs in the window, or None when journalctl is
    unavailable.

    ONE PASS FOR THE NIGHT, like `read_clock_events` and for its reason: the lines name no device, so a
    per-device call would read the same lines again for every device.

    `None`, never `[]`, when the journal cannot be read — "no such job ran" may attribute a gap to the
    box and "nobody looked" may not (§∅). A bracket whose END never arrives is DROPPED rather than
    widened: an open span would reach every later gap, and the cap is what the measurement above bounds."""
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    pats = [(cause, re.compile(a), re.compile(b)) for cause, a, b in JOB_SPANS]
    open_at: dict[str, _dt.datetime] = {}
    out: list[tuple[_dt.datetime, _dt.datetime, str]] = []
    for ln in r.stdout.split("\n"):
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ln)
        if not m:
            continue
        ts = _dt.datetime.fromisoformat(m.group(1))
        for cause, start_re, end_re in pats:
            held = open_at.get(cause)
            if held is not None and (ts - held).total_seconds() > JOB_SPAN_CAP_S:
                del open_at[cause]
                held = None
            if start_re.search(ln):
                open_at[cause] = ts
            elif held is not None and end_re.search(ln):
                out.append((held, ts, cause))
                del open_at[cause]
    out.sort()
    return out


def journal_shape(lines, span_s: float | None) -> dict | None:
    """The night journal's SHAPE, or `None` when the journal could not be read.

    `None`, never a zeroed record: "the journal holds no flood" and "nobody looked" are different facts,
    and only the first may clear a night (§∅). `span_s` may be `None` — then the two RATE findings are
    `None` and the share finding still stands, because a share needs no clock.

    Streams `lines`, keeping a counter of TEMPLATES and no line bodies, so a 415,161-line night costs a
    few hundred entries rather than the 40 MB it arrived as."""
    if lines is None:
        return None
    counts: dict[str, int] = {}
    total = 0
    errors = 0
    for ln in lines:
        if not ln.strip():
            continue
        total += 1
        if " ERROR " in ln or ln.startswith("ERROR "):
            errors += 1
        t = _JOURNAL_NUM.sub("#", _JOURNAL_STAMP.sub("", ln).strip())[:_JOURNAL_TEMPLATE_CHARS]
        counts[t] = counts.get(t, 0) + 1
    if total == 0:
        # READ, and empty. A real state: the unit logged nothing in the window. Distinct from `None`.
        return {
            "lines": 0,
            "templates": 0,
            "span_s": span_s,
            "top": [],
            "dominant_share": None,
            "top_share": None,
            "lines_per_s": None,
            "error_lines": 0,
            "error_per_s": None,
            "findings": ["empty"],
        }
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:JOURNAL_TOP_N]
    top = [{"template": t, "count": c, "share": round(c / total, 4)} for t, c in ranked]
    top_share = sum(c for _, c in ranked) / total
    lps = total / span_s if span_s else None
    eps = errors / span_s if span_s else None
    # Each finding NAMES what was measured and nothing more; none claims a cause. They are independent,
    # and all three can hold at once — the flooded night held all three — so this is a list, not a
    # severity. `top` carries the repeating messages verbatim so the morning's reader sees the LINE.
    findings: list[str] = []
    if total >= JOURNAL_MIN_LINES and top_share >= JOURNAL_TOP_SHARE:
        findings.append("uniform")
    if lps is not None and lps >= JOURNAL_LINES_PER_S:
        findings.append("flooded")
    if eps is not None and eps >= JOURNAL_ERROR_PER_S:
        findings.append("error-rate")
    return {
        "lines": total,
        "templates": len(counts),
        "span_s": round(span_s, 1) if span_s else span_s,
        "top": top,
        "dominant_share": round(ranked[0][1] / total, 4),
        "top_share": round(top_share, 4),
        "lines_per_s": round(lps, 4) if lps is not None else None,
        "error_lines": errors,
        "error_per_s": round(eps, 4) if eps is not None else None,
        "findings": findings,
    }


def read_journal_shape(since: _dt.datetime, until: _dt.datetime, run=subprocess.run) -> dict | None:
    """`journal_shape` over the capture unit's whole window, or `None` when journalctl is unavailable.

    A SECOND pass over the same window as `read_clock_events`, deliberately. That reader returns a
    FILTERED record set — four phrases — and a share needs the denominator, every line the unit wrote.
    Folding both into one call would mean either returning two unrelated things from one function or
    filling a dict in place; one more read-only `journalctl` for the night is the cheaper price, and the
    audit already makes one per device."""
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return journal_shape(r.stdout.split("\n"), (until - since).total_seconds())


def read_probe_armed(
    since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, str]] | None:
    """`[(local stamp, the raw line)]` for the window's `heap probe: ARMED` lines, or `None` when
    journalctl is unavailable.

    WHY THE AUDIT CARRIES THIS AT ALL (SOLID-NIGHT-COWEAR-AND-PROBE §2). The heap probe injects
    event-loop stalls of 1-12 s on purpose, so a night it traced cannot be judged solid or not solid —
    and the judge keeps no journal, by design. The component that already reads the journal for this
    night writes what it read, beside the night, exactly as `read_clock_events` does and for the same
    reason: journald rotates, and a night must stay answerable from its own files.

    THE WINDOW IS THE AUDIT'S OWN (the night's date minus 6 h to plus 30 h), not the night band's: the
    line is logged at DAEMON START, which is routinely hours before the band opens. A probe armed
    before that window is not a declaration about this night — the probe is one-shot and finishes
    within hours of arming (30 min to live capture, then two snapshots 60 min apart).

    `None`, never `[]`, when the journal cannot be read: `[]` says no probe armed, which lets the
    ordinary judge run, and the two must not collapse (§∅)."""
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    out: list[tuple[_dt.datetime, str]] = []
    for ln in r.stdout.split("\n"):
        if _probe.ARMED_NEEDLE not in ln:
            continue
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ln)
        if m:
            out.append((_dt.datetime.fromisoformat(m.group(1)), ln))
    out.sort(key=lambda r: r[0])
    return out


def read_journal(
    name: str | tuple[str, ...], since: _dt.datetime, until: _dt.datetime, run=subprocess.run
) -> list[tuple[_dt.datetime, str]] | None:
    """[(local stamp, cause)] for one device's lines in the window, or None when journalctl is unavailable.

    `name` is the device name, or every string that identifies the device in a log line — its name AND
    its address. The offline-op lines (`Polar <address>: offline-recording op — live capture paused`)
    carry ONLY the address: 8,369 of the 8,956 such lines on the box 2026-08-24 → 09-23, all invisible
    to a name-only match, so `daemon:pull paused live` could almost never fire."""
    keys = (name,) if isinstance(name, str) else tuple(k for k in name if k)
    try:
        r = run(
            [
                "journalctl",
                "-u",
                "tepna-capture",
                "--no-pager",
                "-o",
                "short-iso",
                "--since",
                since.strftime("%Y-%m-%d %H:%M:%S"),
                "--until",
                until.strftime("%Y-%m-%d %H:%M:%S"),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    out: list[tuple[_dt.datetime, str]] = []
    syncs: list[tuple[_dt.datetime, _dt.datetime]] = []
    for ln in r.stdout.split("\n"):
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ln)
        if not m:
            continue
        if TIMESYNC_NEEDLE in ln:
            start = _access_start(ln)
            if start is not None:
                out.append((start, OPERATOR_TIMESYNC))
                syncs.append((start, _dt.datetime.fromisoformat(m.group(1)) + _dt.timedelta(seconds=TIMESYNC_TAIL_S)))
            continue
        if LOOP_STALL_NEEDLE in ln:
            ms = _LOOP_STALL_MS.search(ln)
            if ms is not None:
                woke = _dt.datetime.fromisoformat(m.group(1))
                out.append((woke - _dt.timedelta(milliseconds=int(ms.group(1))), LOOP_STALL))
            continue
        if not any(k in ln for k in keys) and "Starting tepna-capture" not in ln:
            continue
        for cause, needle in KINDS:
            if needle in ln:
                out.append((_dt.datetime.fromisoformat(m.group(1)), cause))
                break
    # a pause inside an operator's sync is the operator's, not the daemon's
    out = [
        (t, OPERATOR_TIMESYNC if c == "daemon:pull paused live" and any(a <= t <= b for a, b in syncs) else c)
        for t, c in out
    ]
    out.sort()
    return out


# ── DELAY IS NOT LOSS ─────────────────────────────────────────────────────────────────────────────────
# Gaps are found on the HOST stamps, and a batch that arrives LATE opens a host gap with every sample still in
# it. Measured on the H10, 2026-09-17 → 09-23: 16 of 55 unattributed gaps had a host step of 2.3–5.7 s and a
# DEVICE step of 0.008 s (one sample at 130 Hz), with PMD batches arriving inside each. Only 5 of the 16 had
# an `event loop stalled` warning within ±5 s, so the stall is corroboration, not the test. The device clock
# is the test: a host gap whose device step stays under DELAY_PERIODS sample periods is a DELAY (lost = 0);
# it is published as such and never enters `gaps`, `by_cause` or `lost_min`. A stream with no device clock
# (the ring's SPO2.csv) cannot tell the two apart, so every host gap there stays a gap: the honest default.
DEVICE_NS = "sensor timestamp [ns]"
DELAY_PERIODS = 1.5  # CHOSEN: a real loss drops ≥ 1 whole period; late delivery measured at 1.04 periods
_PERIOD_ROWS = 200  # positive device steps sampled to learn the stream's own period


def stream_scan(path: str) -> dict:
    """One pass over a stream file: its gaps, its delays, its span, and its own ENDPOINTS on both clocks.

    The endpoints are what a gaps-and-span scan alone could not report, and a fragmented night needs them. A gap BETWEEN
    two files is a real delivery event that no per-file scan can see — "sum the files' gaps" misses exactly
    the loss that made the night fragment — and judging it needs the previous file's last row and the next
    file's first row on the DEVICE clock as well as the host's (#3157: a delay is not a loss, and only the
    device counter tells them apart).

    Same cut and stamp parsing as the Nights index; the device column is found by HEADER name, per file,
    never by position."""
    cut = _ni._cadence_gap(path)
    gaps: list[tuple[_dt.datetime, float]] = []
    delays: list[tuple[_dt.datetime, float, int]] = []
    first = prev = None
    prev_dev = first_dev = None
    dev_col = None
    steps: list[int] = []
    period_ns = None
    with open(path, "rb") as fh:
        for raw in fh:
            line = raw.decode("utf-8", "replace")
            if line.startswith("Phone timestamp"):
                cols = [c.strip() for c in line.split(";")]  # a trailing newline, CR or space is not part of a name
                dev_col = cols.index(DEVICE_NS) if DEVICE_NS in cols else None
                continue
            stamp = _ni.parse_stamp(line)
            if stamp is None:
                continue
            dev = None
            if dev_col is not None:
                try:
                    dev = int(line.split(";")[dev_col])
                except (ValueError, IndexError):
                    dev = None  # a torn row carries no device time; the host gap is then judged as before
            if first is None:
                first = stamp
            if first_dev is None and dev is not None:
                first_dev = dev
            if prev is not None:
                g = (stamp - prev).total_seconds()
                step_ns = dev - prev_dev if dev is not None and prev_dev is not None else None
                if period_ns is None and step_ns is not None and step_ns > 0:
                    steps.append(step_ns)
                    if len(steps) >= _PERIOD_ROWS:
                        period_ns = sorted(steps)[len(steps) // 2]
                if g > cut:
                    if period_ns is not None and step_ns is not None and 0 <= step_ns < DELAY_PERIODS * period_ns:
                        delays.append((prev, g, step_ns))
                    else:
                        gaps.append((prev, g))
            prev = stamp
            if dev is not None:
                prev_dev = dev
    span = (prev - first).total_seconds() if first is not None and prev is not None else 0.0
    return {
        "gaps": gaps,
        "delays": delays,
        "span": max(0.0, span),
        "cut": cut,
        # the endpoints, on both clocks — None where the file carried neither a stamp nor a counter
        "first": first,
        "last": prev,
        "first_dev": first_dev,
        "last_dev": prev_dev,
        # the stream's own period, median of the first sampled positive steps; None on a file too short
        # to have learned one, in which case a boundary across it cannot be judged by the counter
        "period_ns": period_ns,
    }


#: The O2Ring's 0x04 frames, which carry the signal counter that witnesses a stall.
_RING_OXYFRAME = "Wellue_O2Ring-S_*_OXYFRAME.txt"
#: One count of `duration_s` is one second of produced signal, so the counter can only ever agree with a
#: gap to within its own quantum. A stall the ring produced signal across advances it by the gap's length
#: minus at most this; less than that and some of those seconds were never produced.
RING_WITNESS_TOL_S = 1.0


def signal_witness(night_dir: str) -> list[tuple[_dt.datetime, int]]:
    """`[(host stamp, duration_s)]` across every 0x04 frame file of the night, sorted by host stamp.

    WHAT THIS IS, PRECISELY. `duration_s` counts SECONDS OF SIGNAL THE RING PRODUCED, not seconds of
    time (residue 2026-09-06-ring-duration-counts-data-not-time). That is what makes it a witness here
    and it is also its limit: across a stall the ring produced nothing it advances by nothing, so
    "advanced by 13" and "13 s of time passed" are different claims and only the first is available.

    It is assembled across ALL of the night's frame files because the 0x04 stream fragments on its own
    schedule — 20 files beside a single `_SPO2.csv` on 2026-09-09 — so no one file brackets a given gap.

    ⚠️ NOT the exported per-sample axis, which cannot answer this. The raw streams' `sensor timestamp
    [ns]` is DRAWN (`sample_index x 7,953,045 ns`, one delta value at 100.0 % across 16 files) and the
    `_SPO2.csv` primary carries no device column at all. The ring has a clock — an onboard RTC we
    discipline with `SET_UTC_TIME` — but its axis carries no per-sample readings of it, which is a
    different statement and the one the owner has asked for by name.
    """
    out: list[tuple[_dt.datetime, int]] = []
    for path in _recording_glob(night_dir, _RING_OXYFRAME):
        try:
            with open(path, "rb") as fh:
                for raw in fh:
                    line = raw.decode("utf-8", "replace")
                    if line.startswith("Phone timestamp"):
                        continue
                    parts = line.split(";")
                    if len(parts) < 2:
                        continue
                    stamp = _ni.parse_stamp(line)
                    if stamp is None:
                        continue
                    try:
                        out.append((stamp, int(parts[1])))
                    except ValueError:
                        continue  # a torn row carries no counter; it is not a zero
        except OSError:
            continue  # one unreadable frame file is not the absence of a witness
    out.sort()
    return out


def witness_judges(witness, t0: _dt.datetime, g: float) -> tuple[str, float | None]:
    """`(verdict, advance_s)` for one gap — `"delay"`, `"silence"` or `"unwitnessed"`.

    The counter's reading at or before the gap start against its first reading at or after the gap end:
    advancing by the gap's length (within one count) means the ring produced those seconds and only the
    delivery was lost; not advancing means it produced nothing and they are gone.

    `"unwitnessed"` — never `"silence"` — where the counter cannot answer, and the caller must not fold
    those minutes into loss. Three such cases: no frame file at all; no reading on one side of the gap;
    and a counter that went BACKWARDS, which is a new recording session rather than a small step, and
    then nothing about the old value bounds the new one.
    """
    if not witness:
        return ("unwitnessed", None)
    ts = [w[0] for w in witness]
    i = bisect.bisect_right(ts, t0) - 1
    j = bisect.bisect_left(ts, t0 + _dt.timedelta(seconds=g))
    if i < 0 or j >= len(ts):
        return ("unwitnessed", None)
    advance = float(witness[j][1] - witness[i][1])
    if advance < 0:
        return ("unwitnessed", advance)  # the session restarted: the counter reset
    return ("delay" if advance >= g - RING_WITNESS_TOL_S else "silence", advance)


def _iso(t) -> "str | None":
    """A datetime as ISO-8601, or None — never a fabricated stamp for a file that carried none (§∅).

    `stream_scan` returns `None` for a file with neither a readable stamp nor a counter, and that absence
    has to survive into the JSON: a consumer that reads `""` or an epoch there would judge a boundary
    against a time nobody measured."""
    return t.isoformat() if t is not None else None


#: The ring's NOMINAL PPG ADC rate, from `capture.O2PPG_FS_DEFAULT = 125.000` (the crystal sample
#: clock). It is the denominator `shortfall_at_nominal` is stated against, and it is NOT a bar: the
#: corpus reads 124.53-125.92 delivered samples per device-second across clean hours, so a single
#: expected rate cannot decide whether a given hour lost signal. The number is published WITH the
#: ratio it was computed from, so a reader can restate the shortfall against any rate they can defend.
RING_NOMINAL_FS = 125.000
#: `ppg_n` and `duration_s` by HEADER NAME, never by position — `writers.OXYFRAME_COLUMNS` may grow at
#: the tail and an index counted from the end has no contract (that rule is written there, and three
#: writer tests moved onto the wrong column when `alarm_raw` was appended).
_OXYFRAME_COUNTER = "duration_s"
_OXYFRAME_SAMPLES = "ppg_n"


def _cell_int(cols: list[str], parts: list[str], name: str) -> int | None:
    """One named cell of a 0x04 frame row as an int, or None — a torn, blank or absent cell is NOT a 0.

    `0` is a legal reading of both columns this is used for: a frame can carry no PPG samples, and
    `duration_s` reads 0 on a ring with no session open. So absence travels as `None` and the caller
    counts it, rather than summing a zero that looks like a measurement (§∅)."""
    if name not in cols:
        return None
    i = cols.index(name)
    if i >= len(parts):
        return None
    try:
        return int(parts[i].strip())
    except ValueError:
        return None


def oxyframe_samples(path: str) -> list[tuple[_dt.datetime, int | None, int | None]]:
    """`[(host stamp, duration_s, ppg_n)]` for one 0x04 frame file, in file order, by header name.

    The stamp is read to the MILLISECOND the writer wrote, because the spans built from it are
    published to three decimals.

    A row before any header line is skipped: without the header there is no column contract, and
    guessing one is how a positional reader of a grown layout reports a different field's number."""
    out: list[tuple[_dt.datetime, int | None, int | None]] = []
    cols: list[str] | None = None
    with open(path, "rb") as fh:
        for raw in fh:
            line = raw.decode("utf-8", "replace")
            if line.startswith("Phone timestamp"):
                # No `rstrip` ahead of the split: every name is stripped here and every cell is stripped
                # in `_cell_int`, so trimming the newline first only adds a line no input can distinguish.
                cols = [c.strip() for c in line.split(";")]
                continue
            if cols is None:
                continue
            # `parse_host_stamp`, not `parse_stamp`: `O2PpgGrid`'s writer stamps this file to the
            # MILLISECOND (`writers.py`, `OXYFRAME` row: `%Y-%m-%dT%H:%M:%S.` + `microsecond // 1000`),
            # and `host_span_s` below is published to three decimals. Reading with the second-precision
            # sibling throws those digits away and makes the published precision empty — the two-readers
            # rule `parse_host_stamp` states, applied to the reader that measures with them.
            stamp = _ni.parse_host_stamp(line)
            if stamp is None:
                continue
            parts = line.split(";")
            out.append((stamp, _cell_int(cols, parts, _OXYFRAME_COUNTER), _cell_int(cols, parts, _OXYFRAME_SAMPLES)))
    return out


def _completeness_of_run(run: list[tuple[_dt.datetime, int | None, int | None]]) -> dict:
    """One recording run's two completeness measures, each stated in its own unit.

    THE TWO ANSWER DIFFERENT QUESTIONS AND THE PAIR IS THE POINT.

      * `host_minus_device_s` is the measure `O2PpgGrid`'s docstring names: host seconds elapsed minus
        the seconds of signal the ring says it produced. It reads near zero when no time passed without
        signal, which is the honest answer about TIME.
      * `samples_per_device_second` and `shortfall_at_nominal` are in SAMPLES. They are what reads short
        when every second carried signal and that second's frames carried fewer samples than the ring's
        own production rate. On 2026-09-07 the first measure read -1.2, -0.9, -1.0 and -0.5 s across
        hours 23-02 while about 4,600 samples per hour were absent (residue
        `2026-09-27-sample-shortfall-without-a-time-gap-is-unmeasured`).

    Neither is folded into the other, and neither is folded into the grid. A near-zero time measure
    beside a sample shortfall is not a contradiction, and inserting a gap for the shortfall would
    fabricate a hole in a stretch that really was covered.

    ⚠️ A SHORTFALL IS NOT LOSS. Whether the absent samples ever existed is not decidable from the 0x04
    file alone, so this reports the numbers and grades nothing.
    """
    counters = [d for _t, d, _n in run if d is not None]
    samples = [n for _t, _d, n in run if n is not None]
    first, last = run[0][0], run[-1][0]
    span = (last - first).total_seconds()
    # INCLUSIVE for the ratio's denominator, EXCLUSIVE for the advance: a run of frames stamped d0..dk
    # covers (dk - d0 + 1) device-seconds of signal, while the counter ADVANCED by (dk - d0). Mixing the
    # two is a one-second error in a 3,600-second hour and a 50 % error in a two-frame run.
    advance = None if len(counters) < 2 else counters[-1] - counters[0]
    device_seconds = None if not counters else counters[-1] - counters[0] + 1
    delivered = sum(samples) if samples else None
    # `delivered == 0` is a MEASUREMENT (frames arrived and carried no PPG samples), so the test is
    # `is None` and never falsiness — the two differ exactly where the answer is most interesting.
    # ONE guard for both numbers, rather than a second one phrased through the first: `device_seconds`
    # being truthy covers the absent case and the zero case together, and the pair is computed where
    # that is already known. No guard against a NEGATIVE count is written:
    # a run's readable counters are non-decreasing by construction, because a backward step is what
    # `sample_completeness` splits a run on. A guard no input can reach is a survivor nobody can kill.
    ratio: float | None = None
    shortfall: int | None = None
    if delivered is not None and device_seconds:
        ratio = delivered / device_seconds
        shortfall = round(RING_NOMINAL_FS * device_seconds) - delivered
    return {
        "first": _iso(first),
        "last": _iso(last),
        "host_span_s": round(span, 3),
        "device_seconds": device_seconds,
        "device_advance_s": advance,
        "host_minus_device_s": None if advance is None else round(span - advance, 3),
        "delivered": delivered,
        "samples_per_device_second": None if ratio is None else round(ratio, 3),
        "shortfall_at_nominal": shortfall,
        "frames": len(run),
        "frames_without_counter": len(run) - len(counters),
        "frames_without_samples": len(run) - len(samples),
    }


def sample_completeness(night_dir: str) -> dict:
    """The night's ring runs, each with its time-based and its SAMPLE-based completeness measure.

    A backward step in `duration_s` starts a new run, by the same rule `witness_judges` uses: the ring
    closed that session and opened another, so nothing about the old counter bounds the new one.

    Frames whose counter or sample count is absent are COUNTED, not dropped and not zeroed — reduced
    coverage annotates the number beside it, where a discontinuity would refuse it (owner ruling
    2026-09-17). An absent `ppg_n` column reads `frames_without_samples == frames`, which is how an
    older layout says it cannot answer rather than saying nothing was delivered.
    """
    rows: list[tuple[_dt.datetime, int | None, int | None]] = []
    unreadable: list[dict] = []
    files = _recording_glob(night_dir, _RING_OXYFRAME)
    for path in files:
        try:
            rows.extend(oxyframe_samples(path))
        except OSError as exc:
            # One unreadable frame file is not the absence of the measure, the same rule the rest of the
            # audit already follows one level down.
            unreadable.append({"file": os.path.basename(path), "reason": f"unreadable: {exc!r}"})
    rows.sort(key=lambda r: r[0])
    runs: list[list[tuple[_dt.datetime, int | None, int | None]]] = []
    # The last READABLE counter, carried forward rather than re-scanned: a night runs to tens of
    # thousands of frames, and re-reading the open run per row is quadratic in that count.
    last: int | None = None
    for row in rows:
        if runs and not (row[1] is not None and last is not None and row[1] < last):
            runs[-1].append(row)
        else:
            runs.append([row])
        if row[1] is not None:
            last = row[1]
    return {
        "nominal_fs": RING_NOMINAL_FS,
        "files": len(files),
        "unreadable": unreadable,
        "runs": [_completeness_of_run(r) for r in runs],
        "reason": None if runs else "no readable 0x04 frame row this night",
    }


def boundary_gap(prev: dict, nxt: dict) -> tuple | None:
    """The gap BETWEEN two consecutive fragments, judged the way an in-file gap is — or None if there is none.

    Returns `("loss", start, seconds)` or `("delay", start, seconds, step_ns)`, so a caller bins it exactly
    as `stream_scan` bins an in-file gap.

    A fragment boundary is a DELIVERY EVENT: the stream stopped and started again, and the time between is
    unrecorded whatever caused it. What the device counter decides is the same question as inside a file —
    whether the samples are GONE or merely arrived in the next file (#3157). Advancing across the boundary by
    much less than the host gap means the device kept its place and the wait was delivery; advancing by the
    whole gap means those samples do not exist.

    THREE WAYS THE COUNTER CANNOT ANSWER, all of which fall to `loss`, which is the conservative direction
    and the one that cannot silently forgive a real hole:
      * either endpoint carried no counter (a torn tail, a stream with no device column at all — the ring's
        raw buffers, residue `ring-stalls-count-as-loss-without-a-device-clock`, which this unit does not
        change);
      * the previous fragment never ran long enough to learn its own period;
      * the counter went BACKWARDS, which is not a small step but a different clock — a reconnect resets it
        (§🔒 §7: a resync is a change of clock), and nothing about the old counter's value then bounds the
        new one.
    """
    a, b = prev.get("last"), nxt.get("first")
    if a is None or b is None:
        return None
    g = (b - a).total_seconds()
    if g <= max(prev.get("cut") or 0.0, 0.0):
        return None  # the next file resumed inside the cadence: no gap to report
    period = prev.get("period_ns")
    da, db = prev.get("last_dev"), nxt.get("first_dev")
    if period and da is not None and db is not None:
        step = db - da
        if 0 <= step < DELAY_PERIODS * period:
            return ("delay", a, g, step)
    return ("loss", a, g)


def attribute_gaps_detail(gaps, events, spans=None) -> list[dict]:
    """Per gap: the cause, WHEN it was logged, which direction it was found in, and the backward candidate.

    THE WINDOW SPANS THE GAP. `[gap_start, gap_start + ATTRIB_FORWARD_S]` is searched first and its
    NEAREST event wins, because the gap's start is the stream's last delivered row and the action that caused
    it is logged after that row (see `ATTRIB_FORWARD_MARGIN_S` for the measurement). The old backward
    search is kept and published as `backward_cause`: it is the weaker evidence — an event that merely
    precedes a gap may have nothing to do with it — but it is what a night with no in-gap line still has,
    so it remains the fallback rather than being dropped.

    A JOB SPAN IS WEAKER THAN A DEVICE-NAMED LINE AND STRONGER THAN A BACKWARD ONE. `spans` is
    `[(start, end, cause)]` from `read_job_spans` — a job the box declared for itself, naming no device.
    A gap whose START falls inside one is attributed to that job when no device-named line sits in the
    forward window, because the box was inside its own job for the whole of the span while a backward
    line merely PRECEDES the gap. The containing job is published as `job_cause` either way, so an
    attribution that went to a device line does not lose it.

    `events` None ⇒ every gap 'unattributed (no journal)'.
    """
    if events is None:
        return [
            {
                "at": t0,
                "s": g,
                "cause": "unattributed (no journal)",
                "cause_at": None,
                "cause_dir": None,
                "backward_cause": None,
                "in_gap_cause": None,
                "job_cause": None,
            }
            for t0, g in gaps
        ]
    ts = [e[0] for e in events]
    out = []
    for t0, g in gaps:
        j = bisect.bisect_left(ts, t0)  # first event at or after the gap start
        fwd = (ts[j], events[j][1]) if (j < len(ts) and (ts[j] - t0).total_seconds() <= ATTRIB_FORWARD_S) else None
        i = bisect.bisect_right(ts, t0) - 1  # last event strictly before it
        back = (ts[i], events[i][1]) if i >= 0 and (t0 - ts[i]).total_seconds() <= ATTRIB_WINDOW_S else None
        # anything further into the outage: recorded, never the attribution — see ATTRIB_FORWARD_S
        k = bisect.bisect_right(ts, t0 + _dt.timedelta(seconds=ATTRIB_FORWARD_S))
        deep = (ts[k], events[k][1]) if (k < len(ts) and (ts[k] - t0).total_seconds() <= g) else None
        job = next(((a, c) for a, b, c in spans or () if a <= t0 <= b), None)
        if fwd:
            chosen, direction = fwd, "after"
        elif job:
            chosen, direction = job, "in_job"
        elif back:
            chosen, direction = back, "before"
        else:
            chosen, direction = None, None
        out.append(
            {
                "at": t0,
                "s": g,
                "cause": chosen[1] if chosen else "unattributed",
                "cause_at": chosen[0] if chosen else None,
                "cause_dir": direction,
                "backward_cause": back[1] if back else None,
                "in_gap_cause": deep[1] if deep else None,
                "job_cause": job[1] if job else None,
            }
        )
    return out


def attribute_gaps(gaps, events, spans=None) -> list[tuple[_dt.datetime, float, str]]:
    """[(gap start, seconds, cause)], one per gap — the tuple projection of `attribute_gaps_detail`.

    Published per gap (not only summed) because a consumer judging the WORN interval must count the gaps
    INSIDE it: the SOLID-NIGHT verdict's continuity band counts unattributed gaps by number as well as
    minutes, and only inside the worn interval (SOLID-NIGHT §3.4). A per-cause sum over the whole file
    can answer neither.

    ⚠️ `spans` RIDES THROUGH, and it is last and optional so every existing call reads unchanged. A
    projection that dropped it returned the attribution the detail function had BEFORE job spans existed,
    while claiming to be its projection — measured on a 10-12-shaped gap, `daemon:event-loop stall`
    (`before`) here against `daemon:solid-night re-judge` (`in_job`) there. The docstring below promising
    the two can never disagree is what made the omission unreadable."""
    return [(r["at"], r["s"], r["cause"]) for r in attribute_gaps_detail(gaps, events, spans=spans)]


def by_cause_of(per_gap) -> dict[str, float]:
    """Minutes per cause, summed from `attribute_gaps`' list — the one list both published keys come from."""
    out: dict[str, float] = {}
    for _, g, cause in per_gap:
        out[cause] = out.get(cause, 0.0) + g / 60.0
    return out


def attribute(gaps, events, spans=None) -> dict[str, float]:
    """Minutes per cause — the sum of `attribute_gaps`, so the two can never disagree. `spans` rides
    through for the same reason it does there."""
    return by_cause_of(attribute_gaps(gaps, events, spans=spans))


def _has_worn_evidence(night_dir: str, model: str) -> bool | None:
    spec = WORN_EVIDENCE_BY_MODEL.get(model)
    if spec is None:
        return None
    files = _recording_glob(night_dir, spec[0])
    if not files:
        return None
    read_one = False  # did ANY file actually get read down its named column?
    for f in files:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                head = next(fh, None)
                if head is None:
                    continue  # an empty file cannot vouch for wear
                cols = [c.strip() for c in re.split(r"[;,]", head.rstrip("\n"))]
                if spec[1] not in cols:
                    continue  # a header that does not name the column cannot vouch either way
                col = cols.index(spec[1])
                read_one = True
                for line in fh:
                    parts = re.split(r"[;,]", line.rstrip("\n"))
                    if len(parts) > col:
                        try:
                            if float(parts[col]) > 0:
                                return True
                        except ValueError:
                            continue  # a torn row (a live file's tail, a repeated header) is not evidence either way
        except OSError:
            continue  # an unreadable evidence file cannot vouch for wear; the next file may
    # False is a VERDICT -- "every measured value this device wrote was absent" -- and it is only ours to
    # give when a column was actually read. Files that existed but could not be opened, were empty, or
    # named no such column leave the question open, so the answer is null, not "not worn".
    return False if read_one else None


# ── WEAR ENDS — WHY EACH H10 / VERITY / RING FILE ENDED, AND WHERE THE WORN INTERVAL STOPS ──────────
# The loss ledger above says whether a stream had GAPS. It cannot say whether the device was WORN: on
# 2026-09-23 the H10 came off at 04:21:47 and streamed an empty strap (HR 82→172 bpm, ACC flat) for 27½
# min with 0.0 lost; on 2026-09-22 the same for 102 min — that window held 2 766 of the night's 2 767
# "PVCs" (#3001). File span is therefore not the worn interval, and this block reports the interval's END
# per device with a NAMED reason, never a bare boolean:
#   `doff`                    the device's own signal shows the removal (H10: an off-body tail; Verity: the
#                             removal burst in the final epoch; ring: the paired PPG2W file's off-finger tail)
#   `link-loss`               no removal signature, and the same stream's next file starts within
#                             WEAR_RELINK_S — the external label the thresholds below were validated against
#   `quiet-end-unclassified`  neither: no signature and no reconnect. Stated, not guessed.
# Reported, gated by NOTHING (the ring's `ppg2w_contact` precedent): a night the wearer ended early is not
# a capture failure.
#
# MEASURED vs CHOSEN, with the derivation AND the held-out record — including every miss — so the next miss
# is read against this record rather than re-tuned around (Wren, 2026-09-24; survey + pre-registrations in
# the measurer's notes on the box, thresholds frozen BEFORE the held-out nights were read):
#
#   H10 — epoch = 10 s, clock-aligned; rel = epoch ECG sd / the FILE's own median epoch ECG sd.
#   tail_off := the file's trailing run of rel >= H10_TAIL_REL_MIN is >= H10_TAIL_RUN_EPOCHS long.
#   H10_TAIL_REL_MIN = 5      CHOSEN between the worn upper edge (p99 1.2–2.2x, runs to 3x) and the off-body
#                             MINIMUM, 9.8x (n = 10 tails): sqrt(2.2 x 9.8) = 4.6, rounded up.
#   H10_TAIL_RUN_EPOCHS = 6   CHOSEN: 2 above the longest SUSTAINED worn run at >= 5x in derivation (4 epochs,
#                             2026-09-03 19:19).
#   derivation 2026-08-25..09-10, 26 files: off-body tails caught 9/10 — the miss, 2026-09-06 00:07, had a
#     4-epoch (40 s) tail: out of range before any sustained run could exist, a limit of every sustained
#     rule. Worn runs reaching 6 epochs: 0/26.
#   HELD-OUT 2026-09-11..09-23, 17 files: the one labelled night (09-23) flagged, doff 04:21:47 against a
#     pre-registered 04:21:40–04:22:40. ⚠️ THE MARGIN ON RUN LENGTH IS ZERO: one held-out file (2026-09-13
#     21:35) has a WORN run of exactly 6 epochs mid-file. It is not a false TAIL (only the trailing run is
#     read), but a worn run of 6 at a file's end would be called a doff. `max_worn_run` is published on
#     every block so the margin is visible night by night — do not raise the run length on one new miss;
#     re-derive on a fresh held-out set.
#   ACC stillness is NOT a condition: off-body tails read 0.8–1.7 mG sd, a still sleeping body's p10 is
#     1.2–4.7 mG. They overlap.
#
#   VERITY — why neither live vote is used: `optical_worn` (median |ambient| < 5000) is blind in a dark room
#   (2026-09-23's removal moved ambient -185 → -98), and `pulse_prominence` refuses under 4096 samples (74 s
#   at 55 Hz) while the Verity stops streaming ~10 s after removal, so any prominence window at the end is
#   mostly worn signal.
#   ⚠️ THE WINDOW IS BINDING: the FINAL EPOCH is the last CLOCK-ALIGNED 10-s bin (floor of the phone stamp's
#   seconds-of-day / 10) holding at least half the file's median epoch fill. On 2026-09-23 this window gives
#   an ambient ratio of 3.2; a trailing-10-s window ending at the last row gave 20.6 on the same file. The
#   verdict held under both; the value did not, and the thresholds were validated on the clock-aligned one.
#   doff := final ambient-sd ratio (vs the file's median epoch) >= VERITY_END_AMB_RATIO_MIN
#           OR final-epoch ACC |a| sd >= VERITY_END_ACC_SD_MIN
#   VERITY_END_AMB_RATIO_MIN = 1.5   CHOSEN between the link-loss ends' max (1.11) and the dark-room doff min (1.84)
#   VERITY_END_ACC_SD_MIN = 150      CHOSEN between the link-loss ends' max (23.3 mG) and the motion-only doff
#                                    min (170.4 mG). Worn p99 50.8, p99.9 257 — turning in bed; the label, not
#                                    motion, is what a link loss is judged by.
#   label = the gap to the stream's next file: > 1 h ended for the night, < 30 min link loss.
#   derivation 2026-08-25..09-10, 27 ends: night-ends called doff 14/15 — miss 2026-08-28 06:18 (ambient
#     0.98, ACC 2.2: no removal signature; a quiet end). Link-loss ends called doff 0/12.
#   HELD-OUT 2026-09-11..09-23, 18 ends: night-ends 13/14, link-loss ends 0/4. The miss, 2026-09-19 06:04
#     (ambient 0.96, ACC 139.5 mG), sits against a LINK-LOSS end the same night at 20:27 with ACC 131.8 mG:
#     motion alone cannot separate them and no threshold on it would. A feature limit, stated, not tuned.
#
#   RING — one end per `*_SPO2.csv` (the primary), judged by TWO of the device's own witnesses:
#   (1) the paired `*_PPG2W.txt` (same file stamp) has nightqc's off-finger tail — `ppg2w_contact`, its constants
#       untouched, epoched on CLOCK SECONDS (a fixed 100-row epoch put 2026-09-22's doff 5 h 37 min late once the
#       stream ran at ~199 rows/s);
#   (2) the ring's SpO2 stream stopped where that tail began: doff_at >= the SpO2 file's last row -
#       RING_DOFF_SPO2_AGREE_S. The ring stops reporting SpO2 when the finger leaves.
#   RING_DOFF_SPO2_AGREE_S = 30   CHOSEN between agreeing tails (doff_at - SpO2 last row = 0..+4 s on all 36,
#                                 2026-08-25..09-23) and the only two disagreeing ones (-80 s 2026-09-07 08:01,
#                                 -202 s 2026-09-11 20:15). Both of those held SpO2 98-100 % with a live pulse and
#                                 ch1 ~ 400 k counts through the "off" tail: the ch0/ch1 ratio drifted to ~3.3-3.6,
#                                 over PPG2W_RATIO_HI, with the finger IN. ⚠️ NO HELD-OUT RECORD: both were seen
#                                 before this rule was written, so the nights after 2026-09-23 are its held-out set.
#                                 A disagreeing tail is published (`ppg2w_contradicted`), never silently dropped.
#   The relink label is WEAKER for the ring than for the Polar pair: after a removal the daemon's own doff-pull and
#   reconnect open a new file (docs/O2RING-FINGER-OFF-2026-09-19.md), so a real doff can sit < 30 min before the next
#   file — 2026-09-07 07:32 (gap 468 s, both witnesses agree) reads `doff`, correctly, against a `link` label.
#   Ends by label 2026-08-25..09-23 under this rule: night-ends 33/33 usable-with-tail called doff (5 not: 3 under
#   60 s of PPG2W, refused; 2 daytime sessions with no tail -> quiet); link-labelled ends 1/40 (the one above).
WEAR_EPOCH_S = 10  # an INT: epoch keys and starts are integer arithmetic end to end
H10_TAIL_REL_MIN = 5.0
H10_TAIL_RUN_EPOCHS = 6
H10_MIN_EPOCHS = 60  # the derivation's floor: under 10 min there is no file baseline to judge against
VERITY_END_AMB_RATIO_MIN = 1.5
VERITY_END_ACC_SD_MIN = 150.0
VERITY_MIN_EPOCHS = 30  # the derivation's floor for a Verity file
WEAR_RELINK_S = 1800.0  # the label: a next file within 30 min is a reconnect
_ACC_TAIL_BYTES = 262_144  # the final epoch's ACC rows sit in the last ~25 KB at 52 Hz; 256 KB is generous
_ACC_MIN_ROWS = 50  # fewer ACC rows in the final epoch is not a motion measurement
_WEAR_STREAM = {"H10": ("Polar_H10_*_ECG.txt", [3]), "VeritySense": ("Polar_VeritySense_*_PPG.txt", [5])}
RING_DOFF_SPO2_AGREE_S = 30.0
_RING_SPO2 = "Wellue_O2Ring-S_*_SPO2.csv"
_TAIL_BYTES = 4096  # the last stamped row of an SpO2 file sits in its final ~30 bytes
_STAMP_IN_NAME = re.compile(r"_(\d{14})_")


def h10_tail(epoch_sd: list[float]) -> dict | None:
    """The off-body tail rule over one file's epoch ECG sds, in order. PURE. `None` when the file is too short
    to have a baseline, or has no variance to judge against — never a tail_off=False it did not measure."""
    n = len(epoch_sd)
    if n < H10_MIN_EPOCHS:
        return None
    med = statistics.median(epoch_sd)
    if not med > 0:
        return None
    rel = [s / med for s in epoch_sd]
    trail = sum(1 for _ in itertools.takewhile(lambda r: r >= H10_TAIL_REL_MIN, reversed(rel)))
    best = cur = 0
    for r in rel[: n - trail]:
        cur = cur + 1 if r >= H10_TAIL_REL_MIN else 0
        best = max(best, cur)
    return {"epochs": n, "trailing_off_epochs": trail, "tail_off": trail >= H10_TAIL_RUN_EPOCHS, "max_worn_run": best}


def verity_end_doff(final_amb_ratio: float | None, final_acc_sd: float | None) -> bool | None:
    """The Verity final-epoch rule. PURE. `None` only when neither feature was measured."""
    if final_amb_ratio is None and final_acc_sd is None:
        return None
    amb = final_amb_ratio is not None and final_amb_ratio >= VERITY_END_AMB_RATIO_MIN
    acc = final_acc_sd is not None and final_acc_sd >= VERITY_END_ACC_SD_MIN
    return amb or acc


def end_reason(doff: bool | None, relink_gap_s: float | None) -> str:
    """The named reason for one file end. PURE: the device's own evidence first, the reconnect label second."""
    if doff:
        return "doff"
    if relink_gap_s is not None and relink_gap_s <= WEAR_RELINK_S:
        return "link-loss"
    return "quiet-end-unclassified"


def epoch_stats(path: str, cols: list[int]) -> tuple[list[tuple[_dt.datetime, int, float]], _dt.datetime | None]:
    """One capture file → clock-aligned WEAR_EPOCH_S epochs [(start, rows, sd)] and the last row's stamp.
    Streaming (a running Welford mean/M2 per epoch), because an H10 ECG file is ~300 MB. Three columns are
    read as a vector magnitude (ACC). An epoch holding under half the file's median fill is dropped — a
    torn edge is not a measurement. Keys are absolute (day ordinal x 86400 + seconds of day), so a file that
    crosses midnight bins on one clock without a per-file origin."""
    bins: dict[int, list[float]] = {}
    width = max(cols)
    with open(path, "rb") as fh:
        for raw in fh:
            parts = raw.decode("utf-8", "replace").split(";")
            stamp = parts[0]
            if len(parts) <= width or len(stamp) < 19:
                continue  # the header, a row missing its value column, a stamp without a time: not samples
            try:
                vals = [float(parts[c]) for c in cols]
                day = _dt.date.fromisoformat(stamp[:10]).toordinal()
                sec = int(stamp[11:13]) * 3600 + int(stamp[14:16]) * 60 + float(stamp[17:23])
            except ValueError:
                continue  # a torn row at a live file's tail, a repeated header — skipped, not fatal
            v = vals[0] if len(vals) == 1 else math.sqrt(sum(x * x for x in vals))
            key = int(day * 86400 + sec) // WEAR_EPOCH_S
            b = bins.get(key)
            if b is None:
                bins[key] = [1, v, 0.0]
            else:
                b[0] += 1
                delta = v - b[1]
                b[1] += delta / b[0]
                b[2] += delta * (v - b[1])
            last = stamp[:23]
    if not bins:
        return [], None
    fill = statistics.median(b[0] for b in bins.values())
    out = []
    for key in sorted(bins):
        n, _mean, m2 = bins[key]
        if n < 0.5 * fill or n < 2:
            continue
        day, sod = divmod(key * WEAR_EPOCH_S, 86400)
        start = _dt.datetime.fromordinal(day) + _dt.timedelta(seconds=sod)
        out.append((start, int(n), math.sqrt(m2 / n)))
    return out, _dt.datetime.fromisoformat(last)


def _final_acc_sd(acc_path: str, start: _dt.datetime) -> float | None:
    """|a| sd over the ACC rows inside one epoch [start, start + WEAR_EPOCH_S), read from the file's TAIL."""
    if not os.path.exists(acc_path):
        return None
    lo = start.isoformat(timespec="milliseconds")
    hi = (start + _dt.timedelta(seconds=WEAR_EPOCH_S)).isoformat(timespec="milliseconds")
    mags = []
    with open(acc_path, "rb") as fh:
        fh.seek(max(0, os.path.getsize(acc_path) - _ACC_TAIL_BYTES))
        for raw in fh.read().decode("utf-8", "replace").splitlines():
            parts = raw.split(";")
            if len(parts) < 5 or not (lo <= parts[0] < hi):
                continue
            try:
                mags.append(math.sqrt(sum(float(parts[c]) ** 2 for c in (2, 3, 4))))
            except ValueError:
                continue  # a torn ACC row is skipped, never counted as motion
    return statistics.pstdev(mags) if len(mags) > _ACC_MIN_ROWS else None


def _relink_gap(night_dir: str, pattern: str, end: _dt.datetime) -> float | None:
    """Seconds from `end` to the next file of the same stream — this night's folder and the next day's."""
    # MEMBERSHIP OFF, deliberately: the next appearance of this stream may be in the NEXT band, and a
    # band filter would report "no next file" — turning a measured relink gap into a silent None. The
    # FOLDER SET is still the judge's, replacing the hand-rolled next-day arithmetic that stood here and
    # was a second definition of the same thing.
    starts = []
    for f in _recording_glob(night_dir, pattern, membership=False):
        m = _STAMP_IN_NAME.search(os.path.basename(f))
        if m:
            starts.append(_dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S"))
    later = [s for s in starts if s > end - _dt.timedelta(seconds=5)]
    return (min(later) - end).total_seconds() if later else None


def _wear_end(path: str, night_dir: str, model: str) -> dict:
    pattern, cols = _WEAR_STREAM[model]
    base = os.path.basename(path)
    ep, last = epoch_stats(path, cols)
    floor = H10_MIN_EPOCHS if model == "H10" else VERITY_MIN_EPOCHS
    if len(ep) < floor or last is None:
        return {"file": base, "usable": False, "reason": f"under {floor} epochs of {WEAR_EPOCH_S:.0f} s"}
    gap = _relink_gap(night_dir, pattern, last)
    if model == "H10":
        t = h10_tail([e[2] for e in ep])
        if t is None:
            return {"file": base, "usable": False, "reason": "no ECG variance to judge a tail against"}
        doff = t["tail_off"]
        worn_end = ep[len(ep) - t["trailing_off_epochs"]][0] if doff else last
        detail = t
    else:
        med = statistics.median(e[2] for e in ep)
        final = ep[-1]
        amb = final[2] / med if med > 0 else None
        acc = _final_acc_sd(path[: -len("_PPG.txt")] + "_ACC.txt", final[0])
        doff = verity_end_doff(amb, acc)
        worn_end = last  # the Verity stops ~10 s after removal: the removal IS the final epoch
        detail = {
            "epochs": len(ep),
            "final_epoch_at": final[0].isoformat(timespec="seconds"),
            "final_amb_ratio": None if amb is None else round(amb, 2),
            "final_acc_sd": None if acc is None else round(acc, 1),
        }
    return {
        "file": base,
        "usable": True,
        "end_at": last.isoformat(timespec="seconds"),
        "worn_end_at": worn_end.isoformat(timespec="seconds"),
        "reason": end_reason(doff, gap),
        "relink_gap_s": None if gap is None else round(gap),
        **detail,
    }


def _last_stamp(path: str) -> _dt.datetime | None:
    """The last parseable row stamp of a capture file (either layout the box writes), read from its tail."""
    with open(path, "rb") as fh:
        fh.seek(max(0, os.path.getsize(path) - _TAIL_BYTES))
        lines = fh.read().decode("utf-8", "replace").splitlines()
    for line in reversed(lines):
        stamp = _ni.parse_stamp(line)
        if stamp is not None:
            return stamp
    return None


def ring_end_doff(tail_off: bool | None, doff_at: _dt.datetime | None, spo2_last: _dt.datetime) -> bool | None:
    """The ring's two-witness rule. PURE. `None` when the PPG2W witness was not measured."""
    if tail_off is None:
        return None
    if not tail_off or doff_at is None:
        return False
    return (doff_at - spo2_last).total_seconds() >= -RING_DOFF_SPO2_AGREE_S


def _ring_end(path: str, night_dir: str, contact: list[dict]) -> dict:
    base = os.path.basename(path)
    last = _last_stamp(path)
    if last is None:
        return {"file": base, "usable": False, "reason": "no stamped SpO2 row"}
    m = _STAMP_IN_NAME.search(base)
    blk = next((b for b in contact if m and f"_{m.group(1)}_" in b["file"]), None)
    if blk is None or not blk["usable"]:
        tail, doff_at, why = None, None, "no paired PPG2W file" if blk is None else blk["reason"]
    else:
        tail, why = blk["tail_off"], None
        doff_at = _dt.datetime.fromisoformat(blk["doff_at"]) if blk["doff_at"] else None
    doff = ring_end_doff(tail, doff_at, last)
    gap = _relink_gap(night_dir, _RING_SPO2, last)
    # The worn interval ends where EITHER witness goes quiet: the doff second is typically 0–4 s AFTER the SpO2
    # file's last row, and a worn end past the primary's own last row can never be covered by that file (the
    # SOLID-NIGHT continuity band read UNKNOWN on 2026-09-24 for 2 s of exactly that). Within the 30 s agreement
    # bound the tail can also start first; then it is the earlier one.
    worn_end = last
    if doff:
        assert doff_at is not None  # ring_end_doff is never True without a doff time
        worn_end = min(doff_at, last)
    return {
        "file": base,
        "usable": True,
        "end_at": last.isoformat(timespec="seconds"),
        "worn_end_at": worn_end.isoformat(timespec="seconds"),
        "reason": end_reason(doff, gap),
        "relink_gap_s": None if gap is None else round(gap),
        "ppg2w_file": None if blk is None else blk["file"],
        "ppg2w_unusable": why,
        "tail_off": tail,
        "doff_at": None if doff_at is None else doff_at.isoformat(timespec="seconds"),
        "ppg2w_contradicted": bool(tail) and doff is False,
    }


def wear_ends(night_dir: str, model: str) -> dict:
    """Every H10 / Verity / ring file end in the night with its named reason, and the device's worn-interval
    END — the latest usable end. A model without a rule says so in words, never a bare null.

    The ring recomputes `nightqc.ppg2w_contact_quality` rather than reading the night's QC summary: summaries
    written before the clock-second epoch carry a wrong `doff_at`. One pass per settled night, ~300 MB peak."""
    ring = model == "O2Ring-S"
    spec = (_RING_SPO2, []) if ring else _WEAR_STREAM.get(model)
    if spec is None:
        return {"available": False, "reason": f"no wear-end rule for model {model!r}"}
    files = _recording_glob(night_dir, spec[0])
    contact = _ring_contact(files) if ring else []
    ends = []
    for f in files:
        try:
            ends.append(_ring_end(f, night_dir, contact) if ring else _wear_end(f, night_dir, model))
        except OSError as exc:
            ends.append({"file": os.path.basename(f), "usable": False, "reason": f"unreadable: {exc!r}"})
    return {"available": True, "ends": ends, "worn_end": worn_end_of(ends)}


def _ring_contact(spo2_files: list[str]) -> list[dict]:
    """The PPG2W contact blocks for these ring SpO2 files, read from EACH file's own folder.

    🔴 2026-10-18: the ring lost its link at 03:46 and reconnected at 03:46:22, so the second session's
    files landed in the 2026-10-19 folder. `_recording_glob` found that SpO2 file there, but the contact
    blocks were read from the night's folder alone. The second session had no PPG2W witness, its end read
    `quiet-end-unclassified`, and the ring's whole night went UNKNOWN although its PPG2W file was on disk.
    Each folder reads only the PPG2W files paired with a ring SpO2 file it holds, so a next-day folder
    costs only the sessions that belong to this night."""
    by_dir: dict[str, set[str]] = {}
    for f in spo2_files:
        by_dir.setdefault(os.path.dirname(f), set()).add(os.path.basename(f)[: -len("_SPO2.csv")] + "_PPG2W.txt")
    out: list[dict] = []
    for d in sorted(by_dir):
        out.extend(nightqc.ppg2w_contact_quality(d, only=frozenset(by_dir[d])))
    return out


def worn_end_of(ends: list[dict]) -> dict | None:
    """The device's worn-interval END from its file ends — the latest usable one — or None when none is
    usable. ONE rule, shared with `solid_night_inputs`, which re-derives it over a band-filtered subset."""
    usable = [e for e in ends if e["usable"]]
    last = max(usable, key=lambda e: e["end_at"]) if usable else None
    return {"at": last["worn_end_at"], "reason": last["reason"], "file": last["file"]} if last else None


def _device_keys(devices: list[dict]) -> list[str]:
    """Every string that identifies a configured device in a log line — its name AND its address.

    The same pair `read_journal` matches on, and for the same measured reason: the offline-op lines carry
    ONLY the address, so a name-only match sees a fraction of them. A clock-event line that names neither
    keeps an empty `devices` list rather than being dropped — an event the box recorded is a record even
    when the line does not say whose clock it was, and a tripwire must not fire through it."""
    out: list[str] = []
    for d in devices:
        if not isinstance(d, dict):
            continue
        for k in ("name", "address"):
            v = d.get(k)
            if v:
                out.append(str(v))
    return out


def audit_night(
    night_dir: str,
    devices: list[dict],
    *,
    journal=read_journal,
    clock_events=read_clock_events,
    job_spans=read_job_spans,
    journal_shape_of=read_journal_shape,
    probe_armed=read_probe_armed,
) -> dict:
    """The LOSS-AUDIT.json body: per device, the primary stream's gaps by cause, span, and whether the
    device's own evidence says it was worn that night."""
    night = os.path.basename(night_dir.rstrip("/"))
    try:
        day = _dt.datetime.strptime(night, "%Y-%m-%d")
    except ValueError:
        day = _dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    since, until = day - _dt.timedelta(hours=6), day + _dt.timedelta(hours=30)
    out: dict = {"night": night, "devices": {}, "journal": "read"}
    # SOLID-NIGHT §A5's record set, read ONCE for the night and written beside it. `journal: "read"` above
    # is a status; this is the evidence. `None` (journalctl unavailable) is kept DISTINCT from `[]` (read,
    # and no clock event happened) — the tripwire may fire only over the second, and collapsing them is
    # how a detector convicts a night the daemon logged.
    ce = clock_events(since, until)
    out["clock_events"] = (
        None
        if ce is None
        else [
            {
                "at": t.isoformat(timespec="seconds"),
                "phrase": phrase,
                "devices": sorted(n for n in _device_keys(devices) if n and n in ln),
            }
            for t, phrase, ln in ce
        ]
    )
    out["clock_events_source"] = "journalctl -u tepna-capture" if ce is not None else "unavailable"
    # The box's OWN jobs as spans, read once for the night — see `read_job_spans`. Written beside the
    # night for the reason `clock_events` is: the verdict side has no journal and journald rotates.
    js = job_spans(since, until)
    out["job_spans"] = (
        None
        if js is None
        else [
            {"at": a.isoformat(timespec="seconds"), "until": b.isoformat(timespec="seconds"), "cause": c}
            for a, b, c in js
        ]
    )
    # The journal's SHAPE over the same window. `None` when it could not be read — see `journal_shape`.
    out["journal_shape"] = journal_shape_of(since, until)
    # WHAT THE STALL BIN COVERS, beside the causes it assigns. Constant and pre-stated, so it is written
    # on every path — a reader of this file learns the sample without holding the source open.
    out["stall_sample"] = stall_sample()
    # THE PROBE DECLARATION'S JOURNAL HALF (SOLID-NIGHT-COWEAR-AND-PROBE §2), written beside the night
    # for the reason `clock_events` above is: the verdict side has no journal and journald rotates.
    # `None` (unread) stays distinct from `[]` (read, no probe armed) — only the second may let a night
    # be judged.
    pa = probe_armed(since, until)
    out["probe_armed"] = None if pa is None else [{"at": t.isoformat(timespec="seconds"), "line": ln} for t, ln in pa]
    out["probe_armed_source"] = "journalctl -u tepna-capture" if pa is not None else "unavailable"
    # The ring's SAMPLE-based completeness, beside the night's time-based gap ledger and never folded
    # into it. The two are in different units and answer different questions; residue
    # `2026-09-27-sample-shortfall-without-a-time-gap-is-unmeasured` is the night where the time measure
    # read near zero per hour while about 4,600 samples an hour were absent.
    out["ring_samples"] = sample_completeness(night_dir)
    for d in devices:
        if not isinstance(d, dict):
            continue
        model = str(d.get("model") or "")
        pat = PRIMARY_BY_MODEL.get(model)
        name = str(d.get("name") or model)
        if not pat:
            out["devices"][name] = {"primary": None, "reason": f"no primary stream known for model {model!r}"}
            continue
        files = _recording_glob(night_dir, pat)
        if not files:
            # ∅ NIGHT ABSENT is its own class (residue 2026-09-23-loss-audit-cannot-attribute-a-night-with-no-file).
            # `lost_min` is measured INSIDE a recorded span, so a device with no span contributes nothing and
            # reads exactly like a clean one. The flag is written HERE, from the device's own declaration
            # (`optional` ⇒ a manual backup, not expected — SOLID-NIGHT §3.2), so the verdict keys on it
            # rather than inferring absence from missing rows.
            out["devices"][name] = {
                "primary": pat,
                "file": None,
                "reason": "no primary file this night",
                "night_absent": not d.get("optional"),
            }
            continue
        # EVERY fragment, not the largest one. `max(getsize)` audited a single file per device, so on a
        # fragmented night the ledger read as the whole night while most of the recorded span was never
        # examined — measured on vigil 2026-09-24: 2026-09-10 H10 4 files, 53.7 % of the span unaudited;
        # 2026-09-19 Verity 5 files, 55.2 %; 2026-09-05 ring 32 files, 18.7 %. The `wear` block below
        # already walked every file (`wear_ends`), so the two halves of one audit disagreed about which
        # night they were describing.
        f = max(files, key=os.path.getsize)  # still reported as `file`: the largest fragment
        scans, unreadable = [], []
        for q in sorted(files):
            try:
                scans.append((os.path.basename(q), stream_scan(q)))
            except OSError as exc:
                # ONE bad fragment must not discard the readable ones — that is the same "does not end the
                # night" rule the single-file path already had, one level down.
                unreadable.append({"file": os.path.basename(q), "reason": f"unreadable: {exc!r}"})
        if not scans:
            out["devices"][name] = {
                "primary": pat,
                "file": os.path.basename(f),
                "reason": unreadable[0]["reason"] if unreadable else "unreadable",
            }
            continue
        # chronological by the file's OWN first row, not by name: the name carries the session start, and a
        # fragment whose name lies would put a boundary the wrong way round.
        scans.sort(key=lambda kv: (kv[1]["first"] is None, kv[1]["first"] or _dt.datetime.min, kv[0]))
        # each gap carries the fragment it came from, so a reader can tell an in-file hole from a boundary
        recs = [{"at": t, "s": g, "file": n} for n, sc in scans for t, g in sc["gaps"]]
        delays = [d for _n, sc in scans for d in sc["delays"]]
        span = sum(sc["span"] for _n, sc in scans)
        cut = scans[0][1]["cut"]
        n_boundary = 0
        for (_pn, pv), (_nn, nx) in zip(scans, scans[1:]):
            b = boundary_gap(pv, nx)
            if b is None:
                continue
            if b[0] == "delay":
                delays.append((b[1], b[2], b[3]))
            else:
                recs.append({"at": b[1], "s": b[2], "boundary": True})
                n_boundary += 1
        recs.sort(key=lambda r: (r["at"], r["s"]))
        # A STREAM WHOSE OWN AXIS CANNOT ANSWER GETS A SECOND WITNESS, and only such a stream.
        # GATED ON THE RING'S OWN PRIMARY, not merely on "this scan found no counter": `duration_s` is the
        # RING's production counter and says nothing whatever about an H10, and a Polar file that happens
        # to carry no device column (an older night, a torn header) must keep the behaviour it had rather
        # than borrow another device's witness. #3157's classification is untouched for every Polar stream.
        if pat == _RING_SPO2 and not any(sc["period_ns"] and sc["last_dev"] is not None for _n, sc in scans):
            witness = signal_witness(night_dir)
            kept = []
            for r in recs:
                verdict_, advance = witness_judges(witness, r["at"], r["s"])
                if verdict_ == "delay":
                    delays.append((r["at"], r["s"], None))
                    continue
                r["witness"] = verdict_
                r["witness_advance_s"] = None if advance is None else round(advance, 1)
                kept.append(r)
            recs = kept
        gaps = [(r["at"], r["s"]) for r in recs]
        address = str(d.get("address") or "")
        ev = journal((name, address) if address else name, since, until)
        if ev is None:
            out["journal"] = "unavailable — every gap is unattributed"
        detail = attribute_gaps_detail(gaps, ev, js)
        per_gap = [(r["at"], r["s"], r["cause"]) for r in detail]
        # ONE LIST STILL. `by_cause` covers every published gap, so `gaps` and `by_cause` cannot disagree
        # — the invariant `test_the_published_gaps_are_exactly_what_by_cause_sums` defends. What changes is
        # `lost_min`, and only by SUBTRACTING a portion computed from that same list.
        by_cause = by_cause_of(per_gap)
        # ∅ — `lost_min` is the number the night is JUDGED on: it feeds `worn_lost_min` and from there the
        # verdict's `worn_but_not_recorded_fraction`. So it must stay a claim about signal that
        # demonstrably does NOT exist. A gap no device-side witness could judge is not that claim, and
        # counting it there is what made every ring event-loop stall read as the ring losing signal.
        # Reported under its own name instead: reduced coverage annotates (§∅ owner ruling 2026-09-17).
        unwitnessed = sum(r["s"] for r, w in zip(detail, recs) if w.get("witness") == "unwitnessed") / 60.0
        lost = sum(by_cause.values()) - unwitnessed
        worn = _has_worn_evidence(night_dir, model)
        out["devices"][name] = {
            "primary": pat,
            # the LARGEST fragment, kept under its old name so a reader of an older ledger is not misled
            # about which key changed meaning; `files` below is the population actually audited.
            "file": os.path.basename(f),
            "files": [
                {
                    "file": n,
                    "span_min": round(sc["span"] / 60.0, 1),
                    "gaps": len(sc["gaps"]),
                    "delays": len(sc["delays"]),
                    # 🔴 THE ENDPOINTS, PUBLISHED SO A BOUNDARY ACROSS FOLDERS CAN BE JUDGED AT ALL. They
                    # were computed here and consumed only here, which was enough while a night WAS a
                    # folder. It is not: a recording may span two folders (NIGHT-IS-THE-RECORDING, #3297),
                    # each with its own audit, and the gap between the evening's last file and the
                    # morning's first is seen by NEITHER — while `stream_scan`'s own docstring says that
                    # gap "is exactly the loss that made the night fragment". `boundary_gap` already
                    # knows how to judge it and already distinguishes a delay from a loss by the device
                    # counter (#3157); it only ever lacked these six fields on the far side of the JSON.
                    # ADDITIVE: every existing reader of `files[]` sees exactly what it saw before.
                    "first": _iso(sc["first"]),
                    "last": _iso(sc["last"]),
                    "first_dev": sc["first_dev"],
                    "last_dev": sc["last_dev"],
                    "period_ns": sc["period_ns"],
                    "cut": sc["cut"],
                }
                for n, sc in scans
            ]
            + unreadable,
            "span_min": round(span / 60.0, 1),
            "gap_cut_s": round(cut, 2),
            # contiguous stretches of delivery: one per file, plus one for every gap INSIDE a file. A
            # boundary gap does not add one — the fragment after it is already counted by its own file.
            "fragments": len(gaps) - n_boundary + len(scans),
            "boundary_gaps": n_boundary,
            # minutes of gap no device-side witness could judge — NOT loss, and not silently dropped
            "unwitnessed_min": round(unwitnessed, 1),
            "lost_min": round(lost, 1),
            "by_cause": {k: round(v, 1) for k, v in sorted(by_cause.items(), key=lambda kv: -kv[1])},
            # every gap with its start, length and cause — what `by_cause` sums, kept so a consumer can
            # count gaps inside the worn interval (SOLID-NIGHT §3.4) rather than over the whole file.
            # every gap of every fragment, plus the gaps BETWEEN fragments (`boundary: true`), so an
            # empty list is now "none in the night" for this stream. `cause_dir` says which side of the
            # gap start its cause was found on; `in_gap_cause` is an event deeper inside the outage,
            # recorded but never the attribution (see ATTRIB_FORWARD_S).
            "gaps": [
                {
                    "at": r["at"].isoformat(timespec="seconds"),
                    "s": round(r["s"], 1),
                    "cause": r["cause"],
                    "cause_dir": r["cause_dir"],
                    "backward_cause": r["backward_cause"],
                    "in_gap_cause": r["in_gap_cause"],
                    **({"boundary": True} if w.get("boundary") else {"file": w["file"]}),
                    # present only where a second witness was consulted: the ring's streams
                    **(
                        {"witness": w["witness"], "witness_advance_s": w["witness_advance_s"]} if "witness" in w else {}
                    ),
                }
                for r, w in zip(detail, recs)
            ],
            # host gaps the DEVICE clock shows were only late delivery: 0 samples lost, never in `gaps`/`lost_min`
            "delays": [{"at": t.isoformat(timespec="seconds"), "s": round(g, 1), "device_ns": d} for t, g, d in delays],
            "delayed_min": round(sum(g for _, g, _ in delays) / 60.0, 1),
            "worn_evidence": worn,
            "worn_lost_min": round(lost, 1) if worn else (0.0 if worn is False else None),
            "daemon_caused_min": round(sum(v for k, v in by_cause.items() if k.startswith("daemon:")), 1),
            # where the WORN interval ends, per device, with its reason — gaps above are not wear
            "wear": wear_ends(night_dir, model),
        }
    return out


def wear_by_device(night_dir: str, devices: list[dict]) -> dict:
    """`{device name: wear_ends(...)}` for the configured devices — the mapping `nightqc.summarize`
    takes as its `wear` argument.

    The name and model are derived exactly as `audit_night` derives them, so a device is keyed the same
    way in both files and a reader can join them. A device with no model, or a model with no wear rule,
    is simply ABSENT from the mapping rather than present with a null: `nightqc` already reads a missing
    key as "not determined", and an entry saying nothing is one more thing that can be mistaken for a
    measurement."""
    out: dict = {}
    for d in devices or []:
        if not isinstance(d, dict):
            continue
        model = str(d.get("model") or "")
        name = str(d.get("name") or model)
        if not model or model not in WORN_EVIDENCE_BY_MODEL:
            continue
        out[name] = wear_ends(night_dir, model)
    return out


def night_verdict(audit: dict, *, night_dir: str, commit: str | None = None) -> dict:
    """One `tepna.verdict/1` over the night: population = configured devices with a primary stream on disk
    (checked) vs those without (excluded). UNKNOWN with the measurement until a bar exists; with a bar,
    FAIL names the device and the cause."""
    devs = audit.get("devices") or {}
    checked = {n: v for n, v in devs.items() if isinstance(v, dict) and v.get("file")}
    excluded = len(devs) - len(checked)
    pop = {"checked": len(checked), "eligible": len(devs), "excluded": excluded}
    evidence = [TOOL, os.path.join(night_dir, AUDIT_NAME), "journalctl -u tepna-capture"]
    worn_span = sum(v["span_min"] for v in checked.values() if v.get("worn_evidence"))
    worn_lost = sum(v["worn_lost_min"] or 0.0 for v in checked.values() if v.get("worn_evidence"))
    frac = round(worn_lost / worn_span, 4) if worn_span > 0 else None
    # EXPECTED devices that left no primary file. Excluded from `checked` (nothing to measure) but never
    # from the verdict: a PASS over the devices that DID record says nothing about these.
    absent = sorted(n for n, v in devs.items() if isinstance(v, dict) and v.get("night_absent") is True)
    result = {
        "night_absent": absent,
        "worn_but_not_recorded_fraction": frac,
        "worn_lost_min": round(worn_lost, 1),
        "worn_span_min": round(worn_span, 1),
        "daemon_caused_min": round(sum(v.get("daemon_caused_min") or 0.0 for v in checked.values()), 1),
        "by_device": {
            n: {"lost_min": v["lost_min"], "fragments": v["fragments"], "top_cause": next(iter(v["by_cause"]), None)}
            for n, v in checked.items()
        },
        "journal": audit.get("journal"),
        # THE JOURNAL'S SHAPE, so the morning's verdict names a flood instead of a person finding it five
        # nights later. It does NOT move `status`: the criterion is pre-stated and single
        # (`worn_but_not_recorded_fraction`), and widening a published criterion would break every stored
        # verdict and every consumer of this gate for a finding that is not capture loss. Whether a
        # flooded journal should FAIL a night is the owner's to rule; that it is REPORTED is this row.
        # On the NOT_RUN / NOT_APPLICABLE paths above `result` is None by contract, so the shape's
        # always-written home is `LOSS-AUDIT.json` — which is the artifact the row asked for.
        "journal_shape": audit.get("journal_shape"),
        # THE STALL BIN'S COVERAGE, republished here for the reason `journal_shape` is: a consumer of the
        # verdict reads `by_cause` and must know that this one cause is a 1 s, one-per-300 s sample.
        "stall_sample": audit.get("stall_sample"),
    }
    if not devs:
        return _verdict.make(
            gate=GATE,
            status="NOT_RUN",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no device is configured — nothing to audit",
            tool=TOOL,
            commit=commit,
        )
    if not checked:
        return _verdict.make(
            gate=GATE,
            status="NOT_RUN",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no configured device left a primary stream this night",
            tool=TOOL,
            commit=commit,
        )
    if absent and not (frac is not None and frac > THRESHOLD):
        # A clear FAIL below outranks this (a failure is not hidden behind an unknown). Otherwise neither
        # PASS nor NOT_APPLICABLE can be said over a population with an expected device missing.
        return _verdict.make(
            gate=GATE,
            status="UNKNOWN",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=evidence,
            reason=f"night absent: expected device(s) left no primary file — {', '.join(absent)}; "
            f"the {len(checked)} that recorded cannot speak for them",
            tool=TOOL,
            commit=commit,
        )
    if frac is None:
        return _verdict.make(
            gate=GATE,
            status="NOT_APPLICABLE",
            population=pop,
            criterion=CRITERION,
            result=None,
            evidence=evidence,
            reason="no device carried worn evidence this night — the criterion does not bind",
            tool=TOOL,
            commit=commit,
        )
    if frac <= THRESHOLD:
        return _verdict.make(
            gate=GATE,
            status="PASS",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=evidence,
            reason=None,
            tool=TOOL,
            commit=commit,
        )
    worst = max(checked.items(), key=lambda kv: kv[1]["lost_min"])
    return _verdict.make(
        gate=GATE,
        status="FAIL",
        population=pop,
        criterion=CRITERION,
        result=result,
        evidence=evidence,
        reason=f"{frac:.1%} of the worn span unrecorded (bar {THRESHOLD:.1%}); worst {worst[0]}: "
        f"{worst[1]['lost_min']} min, top cause {next(iter(worst[1]['by_cause']), 'none')}",
        tool=TOOL,
        commit=commit,
    )


def write_night(
    night_dir: str,
    devices: list[dict],
    *,
    commit: str | None = None,
    journal=read_journal,
    clock_events=read_clock_events,
    job_spans=read_job_spans,
    journal_shape_of=read_journal_shape,
    probe_armed=read_probe_armed,
) -> dict:
    """Audit + verdict beside the summary; returns the verdict. Never raises past a crash → UNKNOWN."""
    import json

    try:
        audit = audit_night(
            night_dir,
            devices,
            journal=journal,
            clock_events=clock_events,
            job_spans=job_spans,
            journal_shape_of=journal_shape_of,
            probe_armed=probe_armed,
        )
        tmp = os.path.join(night_dir, AUDIT_NAME + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(audit, fh, indent=1)
        os.replace(tmp, os.path.join(night_dir, AUDIT_NAME))
        obj = night_verdict(audit, night_dir=night_dir, commit=commit)
    except Exception as exc:  # noqa: BLE001 — a crash is not a verdict
        obj = _verdict.unknown(
            gate=GATE, criterion=CRITERION, evidence=[TOOL, os.path.join(night_dir, AUDIT_NAME)], tool=TOOL, exc=exc
        )
    vpath = os.path.join(night_dir, VERDICT_NAME)
    # BEFORE the replace, and never fatal: an unrecordable withdrawal must not stop the night getting
    # its correct verdict. A first verdict withdraws nothing and returns None.
    _verdict.withdraw(vpath, os.path.join(night_dir, WITHDRAWN_NAME), obj, reason=REAUDITED)
    try:
        _verdict.write(vpath, obj)
    except (OSError, ValueError):
        pass  # the object is returned to the caller either way; the file is the convenience
    return obj


SAMPLE_NIGHT = "2026-01-01"  # the folder name IS the night, and the night reaches the audit record
SAMPLE_BASE = "Polar_H10_SAMPLE_20260101220000"  # the 14-digit stamp is the declared start (§🔒.4)
SAMPLE_DEVICE = {"name": "Polar H10 SAMPLE", "model": "H10"}
SAMPLE_ROWS = 600  # 1 Hz, so the worn span is exactly 10 minutes and its denominator is not a rounding
SAMPLE_HOLE = (200, 320)  # half-open, strictly inside the span: exactly the 2.0 min the verdict names
SAMPLE_PLANTED_S = 199  # the drop line lands on the last RECORDED second before the hole opens
SAMPLE_PLANTED_CAUSE = "daemon:not-worn drop"
SAMPLE_HR_BPM = 62  # one HR row is what makes the span WORN; the value itself decides nothing


def sample_night(night: str) -> tuple[list[dict], dict]:
    """Lay out a synthetic TORN H10 night in `night`; return its device list and its READERS.

    SPLIT OUT OF `sample_object` SO A TEST CAN MEASURE THE FIXTURE — the same move `solid_night.sample_night`
    made, and for the same reason: twenty-seven mutations of this layout survived the mutation gate while
    `sample_object` was the only way in. The verdict publishes the hole's LENGTH (2.0 min of a 10.0 min
    worn span, in two fragments) and nothing else about the layout, so these are the properties it cannot
    hold, and `test_the_SAMPLE_FIXTURE_carries_the_properties_the_verdict_cannot_hold` holds them:
      · the start comes from the 14-digit stamp in `SAMPLE_BASE`, never from a second literal here, so
        the fixture cannot disagree with itself (Clock Contract §4, anchor rule 2);
      · `SAMPLE_ROWS` rows at exactly 1 Hz, both ends ON the nominal, so the span is a length;
      · ONE hole, `SAMPLE_HOLE`, half-open and strictly inside the span — so the night has exactly two
        recorded fragments and the tear is a tear, not an end-of-file;
      · the drop line at `SAMPLE_PLANTED_S`, the last recorded second BEFORE the hole opens, so the cause
        is attributed to the gap it precedes rather than read from inside one;
      · and the two READERS travel with the night rather than being wired at the call site, because the
        shape reader returning `None` is a claim about the sample — a synthetic night HAS no journal, so
        `None` is the honest value and the deterministic one. Wired at the call site, `lambda: 0` and a
        dropped keyword both survived: this box answers `journalctl -u tepna-capture` with nothing, so
        falling through to the real reader read the same as refusing to look (§∅)."""
    t0 = _dt.datetime.strptime(SAMPLE_BASE.rsplit("_", 1)[1], "%Y%m%d%H%M%S")
    with open(os.path.join(night, f"{SAMPLE_BASE}_ECG.txt"), "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;x\n")
        for i in range(SAMPLE_ROWS):
            if SAMPLE_HOLE[0] <= i < SAMPLE_HOLE[1]:
                continue  # a 2-minute hole
            fh.write((t0 + _dt.timedelta(seconds=i)).isoformat(timespec="milliseconds") + ";1\n")
    with open(os.path.join(night, f"{SAMPLE_BASE}_HR.txt"), "w", encoding="utf-8") as fh:
        fh.write("Phone timestamp;HR [bpm]\n" + (t0.isoformat(timespec="milliseconds") + f";{SAMPLE_HR_BPM}\n"))
    planted = [(t0 + _dt.timedelta(seconds=SAMPLE_PLANTED_S), SAMPLE_PLANTED_CAUSE)]
    return [dict(SAMPLE_DEVICE)], {
        "journal": lambda name, since, until: planted,
        # Reading this box's journald for a corpus-free sample would make the adoption gate's object
        # depend on the machine that emitted it.
        "journal_shape_of": lambda since, until: None,
    }


def sample_object() -> dict:
    """Corpus-free emission for the adoption gate: a synthetic night with one torn stream and a planted
    journal, scored by the real `night_verdict`."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        night = os.path.join(d, SAMPLE_NIGHT)
        os.makedirs(night)
        devices, readers = sample_night(night)
        return write_night(night, devices, commit=None, **readers)
