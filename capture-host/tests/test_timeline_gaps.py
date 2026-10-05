"""timeline.py gap-fill — the degrade-gracefully branches.

The timeline is read from whatever the night left on disk, so every parse here has to survive a torn
row, an unreadable directory and a filename that is not a capture. The rule throughout is the module's
own: a value it cannot prove is left absent, never guessed — an invented link state reads as evidence.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc
import timeline  # noqa: E402

HDR = "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;link_epoch;address\n"


def _link(dirpath, name="Tepna_20260725_LINK.csv", header=HDR, body=""):
    p = os.path.join(str(dirpath), name)
    with open(p, "w") as fh:
        fh.write(header + body)
    return p


# ── _stamp_ms ───────────────────────────────────────────────────────────────────────────────────────
def test_stamp_ms_none_when_the_name_carries_no_stamp():
    assert timeline._stamp_ms("README.md") is None


def test_stamp_ms_none_when_the_stamp_is_not_a_real_instant():
    """Shape-matches but is not a date — month 13. Refuse it rather than let strptime raise up into the
    timeline build, which would take the whole night's view down over one stray filename."""
    assert timeline._stamp_ms("Polar_H10_1_20261345225058_ECG.txt") is None


# ── bucketing guards ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("n,t0,t1", [(0, 0.0, 10.0), (-1, 0.0, 10.0), (4, 10.0, 10.0), (4, 10.0, 5.0)])
def test_bucket_stream_refuses_a_degenerate_window(n, t0, t1):
    """A zero/negative bucket count or a non-advancing window has no honest rendering — return empty
    rather than divide by zero or emit buckets spanning backwards time."""
    assert timeline.bucket_stream([(0.0, 5.0)], t0, t1, n) == []


@pytest.mark.parametrize("n,t0,t1", [(0, 0.0, 10.0), (4, 10.0, 10.0)])
def test_bucket_link_refuses_a_degenerate_window(n, t0, t1):
    assert timeline.bucket_link([(1.0, 1, -60.0)], t0, t1, n) == ([], [])


# ── read_link_samples: torn rows and unreadable paths ───────────────────────────────────────────────
def test_read_link_samples_skips_an_unlistable_directory(tmp_path):
    """A night folder that vanished mid-read (retention pruning, an unmounted archive) must not abort
    the whole timeline — the other folders still have a story to tell."""
    good = tmp_path / "a"
    good.mkdir()
    _link(good, body="2026-07-25T22:00:00.000;H10;1;-60;;;;1;24:AC:AC:02:84:96\n")
    out = timeline.read_link_samples([str(good), str(tmp_path / "gone")])
    assert out and any(v for v in out.values())


def test_read_link_samples_tolerates_short_bad_and_unreadable_rows(tmp_path):
    """One torn row must cost one row, not the file. Rows here: too few columns, an unparseable
    timestamp, a non-numeric RSSI (kept, with rssi absent), and one good row."""
    body = (
        "short;row\n"
        "notatimestamp;H10;1;-60;;;;1;AA\n"
        "2026-07-25T22:00:05.000;H10;1;notanumber;;;;1;24:AC:AC:02:84:96\n"
        "2026-07-25T22:00:10.000;H10;1;-61;;;;1;24:AC:AC:02:84:96\n"
    )
    _link(tmp_path, body=body)
    out = timeline.read_link_samples(str(tmp_path))
    samples = [s for v in out.values() for s in v]
    assert len(samples) == 2, samples  # the two parseable rows survived
    assert any(s[2] is None for s in samples)  # bad RSSI became absent, not 0.0
    assert any(s[2] == -61.0 for s in samples)


def test_read_link_samples_skips_a_file_it_cannot_open(tmp_path, monkeypatch):
    _link(tmp_path, body="2026-07-25T22:00:00.000;H10;1;-60;;;;1;AA\n")
    real = timeline.open if hasattr(timeline, "open") else open

    def boom(path, *a, **k):
        if str(path).endswith("_LINK.csv"):
            raise OSError("EIO")
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", boom)
    assert timeline.read_link_samples(str(tmp_path)) == {}


# ── link_adapter: the provenance header ─────────────────────────────────────────────────────────────
def test_link_adapter_reads_the_header_comment(tmp_path):
    _link(tmp_path, header="# adapter=AC:A7:F1:29:9D:1D hci=hci0\n" + HDR)
    out = timeline.link_adapter(str(tmp_path))
    assert "adapter=AC:A7:F1:29:9D:1D" in next(iter(out.values()))


def test_link_adapter_skips_unlistable_dirs_and_unopenable_files(tmp_path, monkeypatch):
    assert timeline.link_adapter([str(tmp_path / "missing")]) == {}
    _link(tmp_path, header="# adapter=x hci=hci0\n" + HDR)
    real = open

    def boom(path, *a, **k):
        if str(path).endswith("_LINK.csv"):
            raise OSError("EIO")
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", boom)
    assert timeline.link_adapter(str(tmp_path)) == {}


# ── wedge_buckets ───────────────────────────────────────────────────────────────────────────────────
def test_wedge_buckets_returns_empty_for_no_buckets():
    assert timeline.wedge_buckets({}, 0.0, 10.0, 0) == []
    assert timeline.wedge_buckets({}, 0.0, 10.0, -3) == []


def test_wedge_buckets_needs_two_devices_to_call_it_an_adapter_fault():
    """One sensor dropping is range; all of them dropping together is the radio. With fewer than two
    devices ever connected there is no way to tell those apart, and guessing would report the more
    alarming of the two."""
    one = {"H10": [(1.0, 1, -60.0), (2.0, 0, None)]}
    assert timeline.wedge_buckets(one, 0.0, 10.0, 5) == [False] * 5


def test_wedge_buckets_reports_nothing_before_the_radio_ever_worked():
    """Both devices connected at SOME point — so they pass the two-device gate — but not inside the
    rendered window, leaving no bucket where the radio was demonstrably up. Wedge detection starts only
    after a first confirmed connection, so flagging this stretch would report startup as a fault."""
    outside = {"H10": [(1000.0, 1, -60.0)], "Verity": [(1001.0, 1, -55.0)]}
    assert timeline.wedge_buckets(outside, 0.0, 10.0, 5) == [False] * 5


# ── 2026-09-28: a dropping stream was measured by the samples it RECEIVED ────────────────────────
VERITY_ACC = "Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt"
H10_ACC = "Polar_H10_02849638_20260928213612_ACC.txt"


def _f(name, rows, stream="ACC", **kw):
    """A session-file record as `timeline._placed` reads them: the filename carries the stamp and the
    device id, `stream` is the file tag, `rows` is what arrived, and the duration keys are whichever
    bases that file actually has."""
    return {"file": name, "stream": stream, "rows": rows, **kw}


def _start(iv):
    assert len(iv) == 1, iv
    return iv[0][0]


def test_a_dropping_stream_is_measured_by_its_OWN_host_stamps_not_by_received_samples():
    """2026-09-28: the Verity ACC ran to 04:20:39 and the bar stopped at ~03:52 — 28 min of real
    recording painted as nothing. `rows / fs` measures RECEIVED SAMPLES, so a link that drops packets
    writes fewer rows than the clock says elapsed, and the old order reached for it before the host
    stamps. Here 3600 s of wall time at 50 Hz would be 180 000 rows; 90 000 arrived."""
    dropping = [_f(VERITY_ACC, 90_000, stream="ACCRAW", host_span_sec=3600.0)]
    iv = timeline.stream_intervals(dropping, "0C301E3F", "ACCRAW", 50.0)
    assert len(iv) == 1
    assert iv[0][1] - iv[0][0] == 3600.0, "the host stamps say an hour; received samples would say half"


def test_the_device_clock_still_wins_when_the_file_carries_one():
    """§A4c is untouched: `span_sec` is the file's own device clock and outranks both others."""
    both = [_f(VERITY_ACC, 90_000, stream="ACCRAW", span_sec=1234.0, host_span_sec=3600.0)]
    iv = timeline.stream_intervals(both, "0C301E3F", "ACCRAW", 50.0)
    assert iv[0][1] - iv[0][0] == 1234.0


def test_rows_over_fs_is_still_there_for_a_file_with_neither():
    """Last, not gone — a file with no clock of its own and no host span is still measurable."""
    iv = timeline.stream_intervals([_f(H10_ACC, 6000)], "02849638", "ACC", 50.0)
    assert iv[0][1] - iv[0][0] == 120.0


def test_no_basis_at_all_is_a_REFUSAL_and_counted_as_unmeasurable():
    """§∅ — `None`, not a zero, and `unmeasurable_files` is what lets a percentage say so."""
    nothing = [_f(H10_ACC, 6000)]
    assert timeline.stream_intervals(nothing, "02849638", "ACC", 0.0) == []
    assert timeline.unmeasurable_files(nothing, "02849638", "ACC", 0.0) == 1


# ── `offset_sec` is the frame, and every branch of it is observed ────────────────────────────────
# ⚠️ THESE THREE EXIST BECAUSE THE MUTATION GATE SAID SO, and they are the whole reason the carve-out
# was worth making. `_placed` adds `offset_sec` to the floating stamp, and nothing in the suite looked
# at the result: the default, the explicit `None` and the sign of the addition were all unobserved, so
# a mutant could default it to 1.0, treat `None` as 1.0, or SUBTRACT the offset and stay green
# (`timeline.x__placed__mutmut_1 / _34 / _36 / _37`, survivors in run 36618574693). The three
# assertions below are about the FRAME, which is a Clock-Contract fact (§🔒 §1: the stamp is floating
# and `offset_sec` is what raises it into the caller's), not about the duration this PR reorders.
def test_the_start_is_the_bare_floating_stamp_when_no_offset_is_given():
    """The default is 0.0 — "already one frame", which is what every synthetic file list here is."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    assert stamp is not None, "the fixture filename must carry a readable stamp or this proves nothing"
    iv = timeline.stream_intervals([_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0)
    assert _start(iv) == stamp


def test_an_explicit_None_offset_raises_the_stamp_by_nothing_rather_than_by_one_second():
    """`None` means "the caller has no frame to add", which is 0.0 and not 1.0 — the distinction a
    mutant erased, and the one that would silently shift a whole night's bar by a second."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    iv = timeline.stream_intervals(
        [_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0, offset_sec=None
    )
    assert _start(iv) == stamp


def test_an_offset_is_ADDED_to_the_stamp_and_the_sign_is_observed():
    """`build` passes the writer's recovered UTC offset here, so the sign is the difference between a
    night rendered in the writer's frame and one rendered two offsets away from it."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    iv = timeline.stream_intervals(
        [_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0, offset_sec=7200.0
    )
    assert _start(iv) == stamp + 7200.0


# ── the two survivors the gate found that the tests above could NOT see ──────────────────────────
# ⚠️ BOTH ARE REACHED ONLY BY CALLING `_placed` DIRECTLY OR WITH MORE THAN ONE FILE, which is why the
# public-surface tests above missed them and the mutation gate did not (run 2026-10-03, local
# `mutate_diff --base origin/main`: `timeline.x__placed__mutmut_1` and `__mutmut_28` survived while 47
# of 51 were killed). Writing them down rather than excusing them: neither is unkillable.
VERITY_ACC_LATER = "Polar_VeritySense_0C301E3F_20260928220000_ACCRAW.txt"


def test_placeds_OWN_offset_default_is_zero_and_only_a_direct_call_can_see_it():
    """`_placed`'s `offset_sec=0.0` default is invisible through both callers — `stream_intervals`
    passes its own default through explicitly, and `unmeasurable_files` returns a COUNT, which no
    offset can move. So a mutant defaulting the frame to 1.0 shifted every direct caller's night by a
    second and stayed green. `_placed` is this module's own helper and the suite already drives
    `_stamp_ms` and `_file_device_id` directly; this is the same, and it is a gap rather than an
    equivalence precisely because one call reaches it."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    assert stamp is not None
    placed = list(timeline._placed([_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0))
    assert placed == [(stamp, 60.0)], "the default must add nothing at all, not one second"


def test_an_unplaceable_file_is_SKIPPED_and_the_rest_of_the_night_still_counts():
    """The `continue` after the stamp/rows check is a SKIP, not a stop. A mutant turning it into
    `break` discarded every file after the first unplaceable one — on a real night that is the whole
    remainder of the session thrown away by one header-only file — and no single-file test can tell
    the two apart, because with one file `continue` and `break` end the loop identically."""
    files = [
        _f(VERITY_ACC, 0, stream="ACCRAW", span_sec=60.0),  # rows 0 → unplaceable, must be SKIPPED
        _f(VERITY_ACC_LATER, 900, stream="ACCRAW", span_sec=60.0),  # must still be placed
    ]
    later = timeline._stamp_ms(VERITY_ACC_LATER)
    assert later is not None and later != timeline._stamp_ms(VERITY_ACC)
    assert list(timeline._placed(files, "0C301E3F", "ACCRAW", 50.0)) == [(later, 60.0)]
    assert timeline.stream_intervals(files, "0C301E3F", "ACCRAW", 50.0) == [(later, later + 60.0)]


def test_a_file_of_ANOTHER_stream_is_skipped_rather_than_ending_the_scan():
    """The sibling `continue`, on the tag/id filter. Already killed by the single-tag assertions above,
    kept because it is the same `continue`-is-not-`break` claim one branch earlier and the two mutants
    renumber independently."""
    files = [
        _f(VERITY_ACC, 900, stream="PPG", span_sec=60.0),  # wrong stream → skipped
        _f(VERITY_ACC_LATER, 900, stream="ACCRAW", span_sec=60.0),
    ]
    later = timeline._stamp_ms(VERITY_ACC_LATER)
    assert list(timeline._placed(files, "0C301E3F", "ACCRAW", 50.0)) == [(later, 60.0)]


# ── THE EQUIVALENCE BATTERY for `ids.discard("")` ────────────────────────────────────────────────
# ⚠️ THIS IS A COMMITTED BATTERY, AND THAT IS THE POINT. `tools/mutate-equivalence.json` requires a
# `probe` field saying what was actually run, and MUTATION-EQUIVALENCE §8.4 names the failure this
# avoids: "the batteries that produced them were never committed, so those verdicts cannot be
# re-checked, widened, or re-run against moved code". Living here rather than in
# `tools/probe_equivalence.py` because that prober's battery is written against polar_pmd's API by
# name and its `observe`/`CANARIES` are part of its own test contract; a second battery belongs
# beside the module it probes. Running in-process rather than per-subprocess keeps it at ~0.2 s.
#
# ⚠️ THE CANARY RULE — a battery that distinguishes nothing looks exactly like one too narrow to see.
# So this asserts FIRST that four known-killable mutants each produce differences, and only then that
# the candidate produces none. If a canary ever goes blind this test fails on the canary, which is the
# honest failure: it says the battery stopped proving things, not that the candidate became equivalent.
_TL_NAMES = [
    VERITY_ACC,  # id = 0C301E3F
    H10_ACC,  # id = 02849638
    "Tepna_20260928213651_LINK.csv",  # no id field at all -> None
    "ACC.txt",  # fewer than 3 parts -> None
    "_20260928213651_ACC.txt",  # the id slot is EMPTY -> None, never ""
]
# The `device_id` axis IS the candidate: `ids.discard("")` can only matter if `""` reaches `ids`, so
# the axis carries the str form (including `""`), the iterable form (including one holding `""`),
# `None` and an empty one.
_TL_DEVICE_IDS = ["", "0C301E3F", "NOPE", None, [], [""], ["0C301E3F"], ["", "0C301E3F"], ["", None], (None,)]
_TL_DURATION_KEYS = [{}, {"span_sec": 60.0}, {"host_span_sec": 3600.0}, {"span_sec": 60.0, "host_span_sec": 3600.0}]

# (anchor, replacement, why it is killable, the committed test that kills it)
_TL_CANARIES = [
    (
        # ⚠️ ANCHOR UPDATED 2026-10-04 with the line it guards: E4 made `tag` a SET, so the filter is
        # now `not in want`. The battery refused rather than quietly testing nothing — "anchor matched
        # 0x, need exactly 1" — which is the assertion that makes a committed battery survive the code
        # moving under it. A canary whose anchor has gone stale proves nothing and says so.
        'if f["stream"] not in want or not ids',
        'if f["stream"] in want or not ids',
        "stream tag filter inverted",
        "test_a_dropping_stream_is_measured_by_its_OWN_host_stamps_not_by_received_samples",
    ),
    (
        'if t0 is None or not f["rows"]:',
        'if t0 is None or f["rows"]:',
        "rows refusal inverted",
        "test_the_device_clock_still_wins_when_the_file_carries_one",
    ),
    (
        'dur = f.get("span_sec") or f.get("host_span_sec")',
        'dur = f.get("host_span_sec") or f.get("span_sec")',
        "duration preference order swapped",
        "test_the_device_clock_still_wins_when_the_file_carries_one",
    ),
    (
        "t0 += 0.0 if offset_sec is None else offset_sec",
        "t0 -= 0.0 if offset_sec is None else offset_sec",
        "frame offset sign flipped",
        "test_an_offset_is_ADDED_to_the_stamp_and_the_sign_is_observed",
    ),
]
_TL_CANDIDATE = ('ids.discard("")', "ids.discard(None)")


def _tl_battery():
    """(label, files, device_id, tag, fs, offset_sec) — every axis `_placed` branches on."""
    filesets = []
    for name in _TL_NAMES:
        for stream in ("ACC", "ACCRAW"):
            for rows in (0, 900):
                for kw in _TL_DURATION_KEYS:
                    filesets.append(
                        (
                            f"{name}|{stream}|{rows}|{','.join(sorted(kw)) or 'none'}",
                            [{"file": name, "stream": stream, "rows": rows, **kw}],
                        )
                    )
    # A multi-file set, so a mutant that stops the loop instead of skipping one record is visible —
    # a single-file battery cannot tell `continue` from `break`.
    filesets.append(("five-files", [{"file": n, "stream": "ACC", "rows": 900, "span_sec": 60.0} for n in _TL_NAMES]))
    for label, files in filesets:
        for dev in _TL_DEVICE_IDS:
            for tag in ("ACC", "ACCRAW"):
                for fs in (0.0, 50.0):
                    for off in (0.0, None, 7200.0):
                        yield (f"{label} dev={dev!r} {tag} fs={fs} off={off}", files, dev, tag, fs, off)


def _tl_variant(before=None, after=None):
    """`timeline` with one line optionally replaced, loaded into its own namespace.

    ⚠️ THE SOURCE READ GOES THROUGH `_srcscan.module_source`, NOT `open()`. A raw read of a mutatable
    module makes mutmut report "failed to collect stats" and the WHOLE module comes back unmeasurable —
    it reads as an environment fault, not a test failure, and `test_mutation_hygiene.py` exists to catch
    exactly this (it caught this battery's first draft). Here the helper's skip is also the right
    behaviour on its own terms: under mutmut `timeline.py` is one file holding every mutant inline, so
    re-parsing it and replacing a single line would be probing the mutant harness rather than `_placed`."""
    import types

    from _srcscan import module_source

    src = module_source("timeline.py")
    if before is not None:
        assert src.count(before) == 1, f"anchor matched {src.count(before)}x, need exactly 1: {before}"
        src = src.replace(before, after)
    mod = types.ModuleType("timeline_variant")
    mod.__dict__["__file__"] = timeline.__file__
    exec(compile(src, timeline.__file__, "exec"), mod.__dict__)
    return mod


def _tl_observe(mod):
    """Everything a caller of `_placed` can see: the yielded pairs, or the exception instead."""
    out = []
    for label, files, dev, tag, fs, off in _tl_battery():
        try:
            out.append((label, tuple(mod._placed(files, dev, tag, fs, off))))
        except Exception as e:  # an exception IS an observable outcome
            out.append((label, "EXC:" + type(e).__name__))
    return out


def _tl_differences(a, b):
    """How many observations distinguish the variant. A length mismatch is a difference — the largest
    one — and `zip` alone cannot see it: a variant that dropped observations would read as equivalent."""
    return sum(1 for x, y in zip(a, b) if x[1] != y[1]) + abs(len(a) - len(b))


def test_the_discard_guard_is_unkillable_and_the_battery_can_PROVE_it():
    """The committed battery behind `mutate-equivalence.json`'s `timeline.py` entry.

    `ids.discard("")` can only matter if `""` reaches `ids` AND `writers.file_device_id` can return
    `""`. The first is reachable; the second is not — its last line is
    `return parts[i - 1] if i - 1 >= 2 and parts[i - 1] else None`, so an empty id slot yields None.
    Asserted here rather than argued, and the canaries come first so a zero is evidence."""
    base = _tl_observe(_tl_variant())
    assert len(base) > 5000, f"the battery must be wide enough to mean something, got {len(base)}"
    assert timeline._file_device_id("_20260928213651_ACC.txt") is None, "an empty id slot must not be ''"

    for before, after, why, killed_by in _TL_CANARIES:
        n = _tl_differences(base, _tl_observe(_tl_variant(before, after)))
        assert n > 0, f"BATTERY BLIND to '{why}' (killed by {killed_by}) — it cannot prove anything"

    n = _tl_differences(base, _tl_observe(_tl_variant(*_TL_CANDIDATE)))
    assert n == 0, f"{_TL_CANDIDATE[0]} -> {_TL_CANDIDATE[1]} IS killable ({n} of {len(base)}) — the entry is wrong"


# ── E4 · the ring's ACCRAW, carved out of #3239 ───────────────────────────────────────────────────
def test_E4_the_rings_ACCRAW_is_FOUND_under_the_acc_stream():
    """2026-09-28: the ring's 10,137,042-byte `_ACCRAW.txt` matched nothing and its whole night was
    painted `idle` — the one state that reads as a FINDING rather than a miss. `timeline` compared the
    file tag against `s.upper()` alone; `nightqc.stream_file_tags('acc')` has always returned BOTH."""
    import nightqc

    tags = nightqc.stream_file_tags("acc")
    assert "ACCRAW" in tags and "ACC" in tags, tags
    ring = [_f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 900, stream="ACCRAW", span_sec=60.0)]
    assert timeline.stream_intervals(ring, "0C301E3F", tags, 50.0) != [], "the ring's file must be placed"
    assert timeline.stream_intervals(ring, "0C301E3F", "ACC", 50.0) == [], "…and the single-tag call is what missed it"


def test_E4_accepting_both_tags_cannot_let_one_device_cover_for_another():
    """The UNION is safe only because the id filter is independent of the tag — asserted, not assumed,
    since that is the whole reason nightqc could make it a union rather than a per-device mapping."""
    import nightqc

    mixed = [
        _f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 900, stream="ACCRAW", span_sec=60.0),
        _f("Polar_H10_02849638_20260928213612_ACC.txt", 900, stream="ACC", span_sec=60.0),
    ]
    only_ring = timeline.stream_intervals(mixed, "0C301E3F", nightqc.stream_file_tags("acc"), 50.0)
    assert len(only_ring) == 1, "the other device's file is excluded by ID, not by tag"


def test_E4_a_bare_string_tag_still_works_so_every_existing_caller_is_unchanged():
    """The parameter widened; it did not change. A single tag is still a single tag."""
    h10 = [_f("Polar_H10_02849638_20260928213612_ACC.txt", 900, stream="ACC", span_sec=60.0)]
    assert timeline.stream_intervals(h10, "02849638", "ACC", 50.0) != []
    assert timeline.stream_intervals(h10, "02849638", ("ACC",), 50.0) != []
    assert timeline.stream_intervals(h10, "02849638", "ACCRAW", 50.0) == []


# ── E6 · the rate `bucket_stream` never used ──────────────────────────────────────────────────────
def test_E6_bucket_stream_does_not_take_a_rate_it_cannot_use():
    """`bucket_stream` buckets INTERVALS against a window; the sample rate never entered the
    arithmetic. An accepted-and-ignored parameter is worse than none: every caller had to invent a
    value, and a reader had to check whether it mattered. Pinned by signature so it cannot come back
    silently."""
    import inspect

    params = list(inspect.signature(timeline.bucket_stream).parameters)
    assert params == ["intervals", "t0", "t1", "n"], params


# ── `bucket_stream`'s coverage arithmetic (10 survivors, #3239 carve, 2026-10-04) ──────────────────
# E6 changed this function's signature, which put the whole body in the gate's scope. Every survivor
# below sits on a line E6 never touched: the existing tests assert the STATES for a clean window and a
# half-covered one, and nothing pinned the bucket edges, the summation, or either threshold.
def test_bucket_stream_with_ONE_bucket_still_reports_it():
    """Kills `if n <= 0` → `n <= 1`. One bucket is a legal request — the monitor asks for exactly one
    when the window is short — and widening the refusal silently returns an empty timeline."""
    assert timeline.bucket_stream([(0.0, 10.0)], 0.0, 10.0, 1) == ["captured"]


def test_each_bucket_spans_ONE_width_not_two():
    """Kills `t0 + (i + 1) * width` → `(i + 2) * width`. With a double-width bucket 0, coverage that
    belongs to bucket 1 is credited to bucket 0 and the picture shifts left."""
    # 4 buckets of 10 s; the stream covers only the SECOND one
    assert timeline.bucket_stream([(10.0, 20.0)], 0.0, 40.0, 4) == ["idle", "captured", "idle", "idle"]


def test_an_UNCOVERED_bucket_starts_from_zero_coverage():
    """Kills `covered = 0.0` → `1.0`. A single second of phantom coverage turns `idle` into
    `degraded`, and idle-vs-degraded is the distinction an operator reads as "nothing was recorded"
    against "something was"."""
    assert timeline.bucket_stream([], 0.0, 10.0, 1) == ["idle"]
    assert timeline.bucket_stream([(0.0, 10.0)], 0.0, 20.0, 2) == ["captured", "idle"]


def test_an_interval_that_ENDS_before_a_bucket_does_not_stop_the_scan():
    """Kills `continue` → `break` in the skip-earlier-intervals arm. With `break`, the first interval
    that ends before the bucket aborts the whole scan, so every later interval — including the one
    that covers this bucket — is lost and the bucket reads idle."""
    ivs = [(0.0, 5.0), (10.0, 20.0)]  # the first ends before bucket 1 starts
    assert timeline.bucket_stream(ivs, 0.0, 20.0, 2) == ["degraded", "captured"]


def test_coverage_from_SEVERAL_intervals_in_one_bucket_is_SUMMED():
    """Kills `covered += …` → `covered = …`. Two fragments of 4 s each in a 10 s bucket are 80 %
    coverage — captured. Keeping only the last is 40 % — degraded. A dropping link writes exactly this
    shape, so the bug would report every reconnecting stream as worse than it was."""
    ivs = [(0.0, 4.0), (4.0, 8.0)]
    assert timeline.bucket_stream(ivs, 0.0, 10.0, 1) == ["captured"]


def test_EXACTLY_the_captured_threshold_is_captured():
    """Kills `frac >= DEGRADED_BELOW` → `>`. 0.6 coverage is the boundary and must round up into
    `captured`, or the state flips for a stream sitting exactly on the published bar."""
    assert timeline.DEGRADED_BELOW == 0.6
    assert timeline.bucket_stream([(0.0, 6.0)], 0.0, 10.0, 1) == ["captured"]


def test_EXACTLY_the_degraded_floor_is_degraded_not_idle():
    """Kills `frac > 0.02` → `>=`. At exactly 2 % the original reports `idle`; the mutant reports
    `degraded`. The floor exists so a single stray row does not paint a whole bucket as recording."""
    assert timeline.bucket_stream([(0.0, 0.2)], 0.0, 10.0, 1) == ["idle"]
    assert timeline.bucket_stream([(0.0, 0.3)], 0.0, 10.0, 1) == ["degraded"]


# ── `build`'s response fields (50 survivors, #3239 carve) ─────────────────────────────────────────
# E4/E6 touched three call sites inside `build`, which put the whole 150-line orchestrator in scope.
# The existing tests assert that a night BUILDS and that devices appear; almost nothing pinned the
# scalar fields the monitor actually renders.
def _night(tmp_path, rows=112, step_ms=1000, name="2026-07-25"):
    """A night folder with one H10 ECG session. ⚠️ 112 rows at 1 s is not arbitrary: the span is 111 s
    over 240 buckets, so `bucket_sec` is 0.5 at one decimal and 0.46 at two — the only shape that can
    tell the rounding mutants apart. A round span cannot."""
    d = tmp_path / name
    d.mkdir()
    out = []
    for i in range(rows):
        ms = i * step_ms
        out.append(f"2026-07-25T22:{(ms // 60000) % 60:02d}:{(ms // 1000) % 60:02d}.{ms % 1000:03d};{i}000000000;1")
    (d / "Polar_H10_02849638_20260725220000_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(out) + "\n"
    )
    return d


_DEV = [{"name": "H10", "device_id": "02849638", "model": "H10", "streams": ["ecg"]}]


def test_bucket_sec_is_the_window_divided_by_the_buckets_to_ONE_decimal(tmp_path):
    """Kills six mutants on the `bucket_sec` line — `round(x, None)`, `round(1)`, `round(x, )`,
    `round(x, 2)`, `(t1 - t0) * buckets`, `(t1 + t0) / buckets`, and the `and False` that forces the
    else arm. The field is what the monitor labels its x-axis with, and it was asserted nowhere."""
    out = timeline.build(str(_night(tmp_path)), _DEV)
    span = out["t1"] - out["t0"]
    assert span == 111.0 and out["buckets"] == 240, (span, out["buckets"])
    assert out["bucket_sec"] == 0.5, out["bucket_sec"]  # not 0, not 1, not 0.46, not 26640.0


def test_the_night_name_is_the_folder_basename_with_a_trailing_slash_stripped(tmp_path):
    """Kills `rstrip("/")` → `rstrip(None)` and → `lstrip("/")`. A path handed in with a trailing
    slash must still name the night: `basename("…/2026-07-25/")` is the empty string, which is why the
    strip is there. `lstrip` strips the wrong end and `rstrip(None)` strips whitespace instead."""
    d = _night(tmp_path)
    assert timeline.build(str(d), _DEV)["night"] == "2026-07-25"
    assert timeline.build(str(d) + "/", _DEV)["night"] == "2026-07-25", "a trailing slash emptied the name"


def test_the_writer_offset_keeps_its_own_fields_AND_gains_the_frame(tmp_path):
    """Kills five mutants on the `writer_offset` line — `frame=None`, `dict(frame=…)` without `_off`,
    `dict(_off, )` without the frame, and the two that swap the frame's words. `frame` is how a reader
    knows whether the stamps are absolute or floating (§🔒), and dropping either half is silent."""
    wo = timeline.build(str(_night(tmp_path)), _DEV)["writer_offset"]
    assert wo["frame"] == "floating", wo.get("frame")  # no offset voted ⇒ floating, not absolute
    assert wo["offset_sec"] is None and wo["voters"] == 0, wo
    assert "reason" in wo and "the floor is 3" in wo["reason"], "the vote's own fields must survive"


def test_a_degenerate_window_is_widened_by_exactly_one_second(tmp_path):
    """Kills `t1 = t0 + 1` → `t0 - 1` and → `t0 + 2`, and `if t1 <= t0` → `<`. A night whose only file
    carries a single row has t1 == t0; the window is nudged forward so the buckets exist at all.
    Backwards would invert it, and two seconds would misreport the span."""
    d = _night(tmp_path, rows=1)
    out = timeline.build(str(d), _DEV)
    assert out["t1"] - out["t0"] == 1.0, out["t1"] - out["t0"]
    assert out["t1"] > out["t0"]


def _two_sessions(tmp_path, seam_at=None):
    """Two ECG sessions whose OPENINGS are 20 s apart, each carrying 10 s of rows, optionally with a
    daemon restart between them in `STARTS.csv`. Under the 3600 s gap rule the two merge into one
    session; a daemon start between their openings splits them however small the gap."""
    d = tmp_path / "2026-07-25"
    d.mkdir(parents=True)
    for start, hhmmss in ((0, "220000"), (20, "220020")):
        rows = [f"2026-07-25T22:00:{start + i:02d}.000;{i}000000000;1" for i in range(10)]
        (d / f"Polar_H10_02849638_20260725{hhmmss}_ECG.txt").write_text(
            "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(rows) + "\n"
        )
    if seam_at is not None:
        (d / "STARTS.csv").write_text(
            "Phone timestamp;pid;git;dirty;adapter\n"
            f"2026-07-25T22:00:{seam_at:02d}.000;400443;2cd12712;no;F4:CE:36:2E:CD:98\n"
        )
    return d


def test_a_daemon_RESTART_between_two_sessions_splits_the_night(tmp_path):
    """Kills three `build` mutants at once — `_seams = None`, `starts=None`, and the `starts=` argument
    dropped. All three make the seam list empty, and `nightqc.merge_sessions` then merges the two runs
    under the gap rule, so the night's window silently spans both.

    A daemon restart means the two files belong to DIFFERENT runs however small the gap between them,
    which is the whole reason `build` collects `daemon_starts` and hands them over.

    ⚠️ The distinguishing input came from Codex (owner's standing rule, 2026-10-04) — a seam inside
    `(session_start, next_file_start]`, which is `nightqc.py:1360`'s predicate — and was VERIFIED here
    before being written: `merge_sessions` on those two files returns 2 sessions with `starts=[1015]`
    and 1 with `starts=None`. The assertion below is on `build`'s OWN output, not on merge_sessions,
    because that is where the mutants live."""
    merged = timeline.build(str(_two_sessions(tmp_path / "a")), _DEV)
    assert merged["t1"] - merged["t0"] == 29.0, "without a restart the two runs are one session"

    split = timeline.build(str(_two_sessions(tmp_path / "b", seam_at=15)), _DEV)
    assert split["t1"] - split["t0"] == 9.0, (
        f"the restart must split the night; got a {split['t1'] - split['t0']} s window, which means the "
        "seam was not consulted"
    )
    assert split["t0"] > merged["t0"], "the judged session must be the one AFTER the restart"


def _day(root, date, hhmmss, rows=10, base_sec=0):
    """One day's folder with a single ECG session opening at `hhmmss`."""
    d = root / date
    d.mkdir(parents=True, exist_ok=True)
    hh, mm, ss = int(hhmmss[:2]), int(hhmmss[2:4]), int(hhmmss[4:])
    lines = [f"{date}T{hh:02d}:{mm:02d}:{ss + i:02d}.000;{i}000000000;1" for i in range(rows)]
    (d / f"Polar_H10_02849638_{date.replace('-', '')}{hhmmss}_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(lines) + "\n"
    )
    return d


def test_a_session_opening_EXACTLY_at_midnight_pools_the_previous_day(tmp_path):
    """Kills `0 <= earliest - midnight` → `1 <=` and → `0 <`.

    The pooling gate asks whether this folder's earliest session began just after midnight, because
    that is the tail of a session the previous day's folder holds the head of. A session opening at
    exactly 00:00:00 is the boundary case, and both mutants exclude it — so the pre-midnight half of
    a cross-midnight night silently disappears from the timeline, which is the shape that reported a
    full night as a short one."""
    _day(tmp_path, "2026-07-24", "230000")  # yesterday's half
    tonight = _day(tmp_path, "2026-07-25", "000000")  # opens AT midnight
    out = timeline.build(str(tonight), _DEV)
    assert out["t0"] < out["t1"]
    # pooling pulls yesterday's 23:00 session in, so the window starts the previous DAY
    import datetime as _dt

    assert _dt.datetime.fromtimestamp(out["t0"], _dt.UTC).day == 24, (
        f"the previous day was not pooled; window starts {_dt.datetime.fromtimestamp(out['t0'], _dt.UTC)}"
    )


def test_a_session_a_FULL_GAP_after_midnight_does_NOT_pool(tmp_path):
    """Kills `< nightqc._SESSION_GAP_SEC` → `<=`. At exactly the gap the session is NOT the tail of
    anything — that is what the gap means — and pooling yesterday there would merge two separate
    nights into one window."""
    assert nightqc._SESSION_GAP_SEC == 3600.0
    _day(tmp_path, "2026-07-24", "230000")
    tonight = _day(tmp_path, "2026-07-25", "010000")  # exactly 3600 s after midnight
    out = timeline.build(str(tonight), _DEV)
    import datetime as _dt

    assert _dt.datetime.fromtimestamp(out["t0"], _dt.UTC).day == 25, (
        "a session a full gap after midnight pooled the previous day anyway"
    )
