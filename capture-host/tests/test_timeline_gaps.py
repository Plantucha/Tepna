"""timeline.py gap-fill — the degrade-gracefully branches.

The timeline is read from whatever the night left on disk, so every parse here has to survive a torn
row, an unreadable directory and a filename that is not a capture. The rule throughout is the module's
own: a value it cannot prove is left absent, never guessed — an invented link state reads as evidence.
"""

import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc  # noqa: E402
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


def test_placed_accepts_a_TAG_SET_so_one_stream_can_arrive_under_TWO_file_tags():
    """`_placed` is the one place the file tag is compared, so it is the one place that has to accept
    a SET of them. One configured stream can legitimately be written under more than one tag — `acc`
    arrives as `_ACC.` from the H10 and `_ACCRAW.` from the ring — and `nightqc.stream_file_tags`
    already owns that mapping and its reasoning (a UNION, because no device writes both: 38 `_ACCRAW.`
    against 2 `_ACC.` on the 2026-09-05 corpus, disjoint by device).

    Measured 2026-09-28, which is why this is not a tidy-up: the ring's 10,137,042-byte `_ACCRAW.txt`
    matched nothing here and its whole night was painted `idle` — the one state that reads as a
    FINDING rather than a miss.

    ⚠️ Called DIRECTLY rather than through `stream_intervals`, deliberately. The callers' annotations
    still say `tag: str`, so a tuple passed through one of them would red mypy before this capability
    is in place. That is also why this lands first: on `origin/main`'s `_placed`, `f["stream"] != tag`
    against a tuple is true for EVERY file, so a caller that hands one over skips the whole night —
    measured, the bare string places the ring's file and the tuple returns nothing. The capability has
    to exist before anything passes one.

    The four assertions pin the set in both directions: a tuple containing the tag places the file, a
    bare string still behaves exactly as before, a non-matching bare string still discriminates, and a
    tuple that EXCLUDES the tag still excludes it — which is what stops `set(tag)` on a string (whose
    members would be the letters) and `not in` → `in` from passing."""
    ring = [_f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 900, stream="ACCRAW", span_sec=60.0)]
    assert list(timeline._placed(ring, "0C301E3F", ("ACC", "ACCRAW"), 50.0)), "a tag SET must place it"
    assert list(timeline._placed(ring, "0C301E3F", "ACCRAW", 50.0)), "a bare string must be unchanged"
    assert list(timeline._placed(ring, "0C301E3F", "ACC", 50.0)) == [], "a bare non-match still excludes"
    assert list(timeline._placed(ring, "0C301E3F", ("ACC",), 50.0)) == [], "a SET without the tag excludes"


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
        # ⚠️ RE-ANCHORED 2026-10-05 when `_placed` began accepting a tag SET: the line is now
        # `not in want`, so the old `!= tag` anchor matched 0 times and `_tl_variant`'s
        # `count(before) == 1` failed the battery loudly rather than silently canarying nothing.
        # That assert is the reason this was a red test and not a quiet downgrade — keep it.
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


def test_an_EMPTY_night_still_names_itself_even_with_a_trailing_slash(tmp_path):
    """Kills `rstrip("/")` → `rstrip(None)` and → `lstrip("/")` on the EMPTY-NIGHT return.

    ⚠️ A SECOND COPY OF THE SAME EXPRESSION, on a different line and reached by a different path.
    `test_the_night_name_is_the_folder_basename_with_a_trailing_slash_stripped` pins the final return
    and kills its mutants; this early return — taken when nothing in the folder produced a span —
    carries its own `basename(rstrip("/"))` and its own mutants. The existing empty-night test asserts
    `buckets == 0` and `devices == []` and never looks at the name, so a night that recorded nothing
    could report itself as the empty string, which is the row a reader would skip rather than chase."""
    d = tmp_path / "2026-07-25"
    d.mkdir()
    for path in (str(d), str(d) + "/"):
        out = timeline.build(path, _DEV)
        assert out["night"] == "2026-07-25", f"{path!r} -> {out['night']!r}"
        assert out["buckets"] == 0 and out["devices"] == []


def test_the_window_spans_the_whole_judged_session(tmp_path):
    """Pins the window against the judged session's own bounds.

    ⚠️ IT DOES NOT KILL `spans = [cur[0], cur[1]]` → `[cur[1], cur[1]]`, and I checked rather than
    assumed: hand-applying that mutant leaves this suite green. The seed is immediately followed by a
    loop that appends every file's own stamp, and `cur[0]` IS the earliest of those stamps — so
    re-seeding with the end is undone by the next few lines and `min(spans)` is unchanged. Killing it
    needs a session whose opening is NOT any file's stamp (a LINK-only window, or a file whose
    `session` parses while its FILENAME stamp does not), which is a different fixture than this one;
    until that exists the mutant stays on the survivor list rather than behind a test that claims it.

    What this does pin is the window itself, which nothing else asserted."""
    out = timeline.build(str(_night(tmp_path, rows=112)), _DEV)
    # 112 rows at 1 s: the session opens at 22:00:00 and the window must start there, not at 22:01:51
    import datetime as _dt

    t0 = _dt.datetime.fromtimestamp(out["t0"], _dt.UTC)
    assert (t0.hour, t0.minute, t0.second) == (22, 0, 0), t0
    assert out["t1"] - out["t0"] == 111.0, "the window collapsed toward the session's end"


def test_an_unrecoverable_writer_offset_REFUSES_coverage_and_names_why(tmp_path):
    """Kills `if _offset is None` → `if (_offset is None) and False` in the coverage-reason ladder.

    Without a recovered offset the window is built from floating stamps plus the files' own durations,
    so `t1 - t0` collapses toward `covered` and the ratio tends to 1 BY CONSTRUCTION — a coverage
    figure that cannot go down is not a measurement (§∅). The refusal names its cause; measuring would
    hide it. With `and False` the ladder falls through to the next arm and the night reports either
    `None` with no reason or the wrong reason, which is the difference between "we could not measure
    this" and "there was nothing to measure"."""
    out = timeline.build(str(_night(tmp_path)), _DEV)
    assert out["writer_offset"]["offset_sec"] is None, "this fixture must have no recoverable offset"
    s = out["devices"][0]["streams"]["ecg"]
    assert s["coverage_reason"] == "writer-offset-unrecoverable", s["coverage_reason"]
    assert s["coverage_pct"] is None, "a ratio that cannot go down must not be published"


def test_every_bucket_carries_a_STATE_not_an_absent_list(tmp_path):
    """Kills `st = apply_link_states(...)` → `st = None`. The states list IS the timeline — it is what
    the monitor draws — and nothing asserted it was a list at all, so a stream could report no states
    and the strip would render empty rather than wrong, which reads as "no data" instead of a bug."""
    out = timeline.build(str(_night(tmp_path)), _DEV)
    states = out["devices"][0]["streams"]["ecg"]["states"]
    assert isinstance(states, list) and states, f"states is {states!r}"
    assert len(states) == out["buckets"], (len(states), out["buckets"])
    assert set(states) <= {"captured", "degraded", "idle", "nosignal", "wedged"}, set(states)


def test_each_device_row_carries_the_five_fields_the_monitor_reads(tmp_path):
    """Kills the `out_devs.append({...})` mutant. The device record is the row a reader identifies a
    sensor by; dropping or renaming a key leaves the strip unable to say WHICH device it is drawing,
    and no test asserted the record's shape."""
    dev = timeline.build(str(_night(tmp_path)), _DEV)["devices"][0]
    assert sorted(dev) == ["address", "device_id", "name", "rssi", "streams"], sorted(dev)
    assert dev["name"] == "H10" and dev["device_id"] == "02849638"
    assert "ecg" in dev["streams"]


def _clamped_night(tmp_path, host_only=False, seam_at=40):
    """A night whose JUDGED session is clamped to a daemon restart that fell INSIDE the file still being
    written. ⚠️ The shape is load-bearing in three ways, each measured: the seam must land inside the
    substantive file's own span (40 s into a 111 s file), there must be a second file for the seam to
    make a second session out of, and the substantive file must be the one `judged_session` picks — a
    seam between two files clamps nothing, and a clamped session that is not the judged one is invisible.
    `host_only` drops the device-clock column so the extent is known only from the host stamps."""
    d = tmp_path / "2026-07-25"
    d.mkdir(parents=True)
    for hhmmss, n, off in (("220000", 112, 0), ("221000", 2, 600)):
        if host_only:
            rows = [f"2026-07-25T22:{(off + i) // 60:02d}:{(off + i) % 60:02d}.000;1;2;3" for i in range(n)]
            hdr, st = "Phone timestamp;X [mg];Y [mg];Z [mg]", "ACC"
        else:
            rows = [f"2026-07-25T22:{(off + i) // 60:02d}:{(off + i) % 60:02d}.000;{i}000000000;1" for i in range(n)]
            hdr, st = "Phone timestamp;sensor timestamp [ns];channel 0", "ECG"
        (d / f"Polar_H10_02849638_20260725{hhmmss}_{st}.txt").write_text(hdr + "\n" + "\n".join(rows) + "\n")
    (d / "STARTS.csv").write_text(
        "Phone timestamp;pid;git;dirty;adapter\n"
        f"2026-07-25T22:00:{seam_at:02d}.000;400443;2cd12712;no;F4:CE:36:2E:CD:98\n"
    )
    return d


_CLAMP_DEV = [{"name": "H10", "device_id": "02849638", "model": "H10", "streams": ["ecg", "acc"]}]


@pytest.mark.parametrize(
    "host_only,clock",
    [(False, "span_sec"), (True, "host_span_sec")],
    ids=["device-clock", "host-stamps-only"],
)
def test_a_file_STILL_BEING_WRITTEN_at_a_daemon_restart_keeps_the_window_it_filled(tmp_path, host_only, clock):
    """Kills the four mutants on `_ext = f.get("span_sec") or f.get("host_span_sec")` — `_ext = None`,
    `or` → `and`, and either key replaced by `None`.

    `merge_sessions` CLAMPS a session's end to a daemon restart that falls inside it (nightqc.py's own
    rule: a start after the session opened means the session opened in an earlier run). A file still
    being written when the daemon restarted therefore holds 111 s of rows inside a session the clamp
    ends at 40 s — and `spans` collects file START stamps, so without this line the night's window stops
    at the restart and reports a 40 s night that recorded 111 s. The coverage ratio is computed against
    that window, so the error does not announce itself as a missing window; it announces itself as
    coverage over 100 %, which is the 156.5 % and 466.7 % the line's own comment records.

    Both clocks are asserted because each mutant needs a different one to be distinguished: with a
    device clock `host_span_sec` is absent, so `and` and `f.get(None) or …` collapse to None; with
    host stamps only `span_sec` is absent, so `… or f.get(None)` collapses instead. One file shape
    cannot tell all four apart — measured, not assumed."""
    d = _clamped_night(tmp_path, host_only=host_only)
    data = [f for f in nightqc.scan_night(str(d)) if f["stream"] not in nightqc._SIDECAR_TAGS]
    assert data[0].get(clock) == 111.0, f"the fixture must state the extent via {clock}: {data[0]}"

    seams = sorted(nightqc.daemon_starts(str(d), offset_sec=None)["stamps"])
    cur = nightqc.judged_session(nightqc.merge_sessions(data, starts=seams, offset_sec=None))
    assert cur[1] - cur[0] == 40.0, (
        f"the fixture is only distinguishing while the judged session is CLAMPED to the seam; "
        f"got {cur[1] - cur[0]} s, so the window below would be right for the wrong reason"
    )

    out = timeline.build(str(d), _CLAMP_DEV)
    assert out["t1"] - out["t0"] == 111.0, (
        f"the window stopped at {out['t1'] - out['t0']} s — the file's own extent was not counted, so "
        "the night reports a window shorter than the data it holds"
    )


def test_ZERO_buckets_reports_a_bucket_sec_of_ZERO_instead_of_dividing_by_it(tmp_path):
    """Kills `if buckets else 0` → `if (buckets) or True` (a ZeroDivisionError) and `else 0` → `else 1`.

    The guard is reachable: `buckets` is a caller argument, and a night with data takes the full return
    rather than the empty-night early one, so `bucket_sec` is computed. `0` is the honest answer — there
    is no bucket to state a width for — and `1` would name a width no bucket has (§∅: a width that was
    never divided is absent, not one second). `test_bucket_sec_is_…_ONE_decimal` covers the arm where
    `buckets` is truthy; nothing covered this one, because the only existing zero-bucket test takes the
    empty-night early return and never reaches this dict."""
    out = timeline.build(str(_night(tmp_path)), _DEV, buckets=0)
    assert out["buckets"] == 0 and out["t1"] > out["t0"], out  # a real window, so the dict is reached
    assert out["bucket_sec"] == 0, out["bucket_sec"]  # not 1, and not a ZeroDivisionError


def test_a_DECLARED_writer_offset_makes_the_frame_ABSOLUTE_not_floating(tmp_path):
    """Kills `frame="floating" if (_offset is None) or True else "absolute"`, which forces the floating
    arm for every night. `frame` is how a reader knows whether `t0`/`t1` are instants or floating civil
    values (§🔒), and a night whose offset IS known being published as floating is the §∅ failure in
    reverse: a value that WAS measured reported as absent. `test_the_writer_offset_keeps_its_own_fields`
    covers the floating arm; nothing reached this one, because every fixture let the offset be recovered
    and the recovery floor is 3 voters.

    ⚠️ Only the FRAME is asserted here, deliberately. `merge_sessions` in an absolute frame takes a
    file's end from its mtime, and a fixture's files are written seconds ago — so `t1` on a freshly
    created July night is the CURRENT clock, and any window assertion here would be a clock-dependent
    one. The mtime is pinned below so the fixture does not quietly depend on when the suite runs; it was
    measured as the cause (session end 1791… with mtime now, 1785… with mtime pinned), not guessed."""
    d = _night(tmp_path)
    for f in os.listdir(str(d)):
        os.utime(os.path.join(str(d), f), (1785016911.0, 1785016911.0))

    declared = {"offset_sec": 7200.0, "voters": 3, "reason": "declared by the caller"}
    wo = timeline.build(str(d), _DEV, writer_offset=declared)["writer_offset"]
    assert wo["frame"] == "absolute", f"a known offset must not publish as floating: {wo}"
    assert wo["offset_sec"] == 7200.0 and wo["voters"] == 3, wo  # the caller's own fields survive

    recovered = timeline.build(str(d), _DEV)["writer_offset"]
    assert recovered["frame"] == "floating", recovered  # and the other arm still works


def test_a_NAME_keyed_sidecar_still_finds_the_device_when_the_address_column_is_empty(tmp_path):
    """Kills `d.get("name")` → `d.get(None)` in the key list handed to `merge_link_samples`.

    The address column arrived mid-corpus, so rows written before it landed carry only the device NAME
    and `read_link_samples` leaves them keyed under it. A device whose sidecar rows are all name-keyed
    therefore has its entire signal trace reachable only through the name, and dropping that key does
    not error — it returns an empty sample list, which renders as a flat trace. `merge_link_samples`'s
    own docstring records the real 2026-07-26 night this family cost: 1238 name-keyed rows against 158
    address-keyed ones for the same H10, where a short flat trace read as a quiet night rather than a
    missing one. The `rssi` assertion below is what distinguishes the two readings."""
    d = _night(tmp_path)
    (d / "Tepna_20260725_LINK.csv").write_text(
        HDR + "".join(f"2026-07-25T22:00:{i:02d}.000;H10;1;-7{i};80;0;0;1;\n" for i in range(3))
    )
    link = timeline.read_link_samples([str(d)])
    assert list(link) == ["H10"], f"the fixture must be NAME-keyed, or the mutant is not exercised: {list(link)}"

    dev = [{"name": "H10", "address": "F4:CE:36:2E:CD:98", "device_id": "02849638", "model": "H10", "streams": ["ecg"]}]
    rssi = timeline.build(str(d), dev)["devices"][0]["rssi"]
    assert any(v is not None for v in rssi), (
        "every sidecar row for this device is name-keyed, so dropping the name key loses the whole "
        "trace — and an empty trace reads as a quiet night, not a missing one"
    )


def test_a_night_whose_files_ALL_LACK_a_stamp_has_no_earliest_rather_than_crashing(tmp_path):
    """Kills `earliest = min(_stamped) if _stamped else None` → `if (_stamped) or True`, which calls
    `min([])` and raises ValueError on any night whose files carry no parsable stamp.

    `_stamped` drops the `None` sessions deliberately — an unstamped file has no floating start to be
    the earliest of (§∅: absent, not defaulted). The guard is therefore load-bearing exactly when the
    night is least well formed, which is when the timeline is most needed: a reader opening a night of
    unstamped files must get a timeline that says so, not a traceback. `data` is non-empty here, so the
    `if data:` block IS entered and the guard IS reached — that is what makes the mutant reachable."""
    d = tmp_path / "2026-07-25"
    d.mkdir(parents=True)
    rows = [f"2026-07-25T22:00:{i:02d}.000;{i}000000000;1" for i in range(10)]
    (d / "Polar_H10_02849638_ECG.txt").write_text(  # no 14-digit stamp anywhere in the name
        "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(rows) + "\n"
    )
    data = [f for f in nightqc.scan_night(str(d)) if f["stream"] not in nightqc._SIDECAR_TAGS]
    assert data and all(f["session"] is None for f in data), (
        f"the fixture must yield files with NO session, or the guard is not reached: {data}"
    )

    out = timeline.build(str(d), _DEV)  # must not raise
    assert out["night"] == "2026-07-25"


_DECLARED = {"offset_sec": 7200.0, "voters": 3, "reason": "declared by the caller"}
_MTIME = 1785016911.0  # the night's own end, so an absolute frame does not read the file as still open


def _pin(d):
    """⚠️ In an ABSOLUTE frame `merge_sessions` takes a file's end from its MTIME, and a fixture's files
    were written seconds ago — so without this a July night's `t1` is the CURRENT clock (measured: a
    71-day window, coverage 0.0 %). Pinning it is what makes every declared-offset assertion below a
    statement about the offset rather than about when the suite ran."""
    for f in os.listdir(str(d)):
        os.utime(os.path.join(str(d), f), (_MTIME, _MTIME))
    return d


def test_a_DECLARED_offset_is_carried_into_the_sidecar_and_the_intervals_not_just_the_window(tmp_path):
    """Kills three mutants that all leave one consumer in the WRONG FRAME while the window moves to the
    right one — `ts + _shift` → `ts - _shift` on the link samples, and `stream_intervals(…,
    offset_sec=_offset)` with the offset replaced by `None` or dropped so its default 0.0 applies.

    Every one of them is invisible without a declared offset: `_shift` is 0.0 when `_offset` is None, and
    `offset_sec=None` and the 0.0 default both mean "no shift", so each mutant is byte-identical to the
    original on every fixture that lets the offset be RECOVERED. The recovery floor is 3 voters, which
    no fixture meets — so this whole family sat unkillable behind an argument nothing passed.

    What they break is not an error: the sidecar stamps and the stream intervals are raised into the
    window's frame, and a consumer left 7200 s behind it simply falls outside the window and is dropped.
    The trace goes flat and the coverage goes to 0 % on a night that recorded 100 % — absence
    manufactured by a frame mismatch, which is why both are asserted as VALUES here, not as truthiness."""
    d = _pin(_night(tmp_path))
    (d / "Tepna_20260725_LINK.csv").write_text(
        HDR + "".join(f"2026-07-25T22:00:{i * 20:02d}.000;H10;1;-7{i};80;0;0;1;F4:CE:36:2E:CD:98\n" for i in range(3))
    )
    _pin(d)
    dev = [{"name": "H10", "address": "F4:CE:36:2E:CD:98", "device_id": "02849638", "model": "H10", "streams": ["ecg"]}]

    out = timeline.build(str(d), dev, writer_offset=_DECLARED)
    assert out["t0"] == 1785024000.0, f"the window itself must be in the absolute frame: {out['t0']}"

    rssi = out["devices"][0]["rssi"]
    assert any(v is not None for v in rssi), (
        "the sidecar stamps were not raised into the window's frame, so every sample fell outside it "
        "and the signal trace went flat — a quiet night, manufactured"
    )
    ecg = out["devices"][0]["streams"]["ecg"]
    assert ecg["covered_sec"] == 111 and ecg["coverage_pct"] == 100.0, (
        f"the window and the intervals disagree: {ecg['covered_sec']} s covered, {ecg['coverage_pct']} %"
    )
    # ⚠️ `covered_sec` and `coverage_pct` do NOT distinguish the interval frame, and predicting that
    # they would was wrong — measured, both mutants leave them at 111 and 100.0. `covered` sums interval
    # DURATIONS, which a frame shift does not change, and the ratio is taken against the window's own
    # width. The STATES strip is the position-dependent output: intervals left 7200 s behind the window
    # intersect no bucket in it, so every bucket reads `idle` on a night that recorded continuously.
    assert set(ecg["states"]) == {"captured"}, (
        f"the intervals were not raised into the window's frame, so they intersect no bucket in it: "
        f"{sorted(set(ecg['states']))} — a fully recorded night drawn as empty"
    )


def test_a_DECLARED_offset_puts_the_daemon_SEAMS_in_the_same_frame_as_the_sessions(tmp_path):
    """Kills `daemon_starts(d, offset_sec=_offset)` with the offset replaced by `None` or dropped.

    The seams decide where one daemon run ends and the next begins, and they are compared against
    session bounds that the declared offset has already moved. A seam left 7200 s behind lands outside
    the window entirely, so it splits nothing and the two runs merge — `build`'s window then spans both,
    which is exactly the disagreement with `summarize` that sharing `merge_sessions` exists to prevent.

    Measured, so the fixture is known to distinguish: in the correct frame the seam is 1785024010.0,
    which falls in `(session start, next file start]`; with the offset dropped it is 1785016810.0, which
    does not. 9 s is the first run alone, 29 s is the two merged."""
    d = _pin(_two_sessions(tmp_path, seam_at=10))
    out = timeline.build(str(d), _DEV, writer_offset=_DECLARED)
    span = out["t1"] - out["t0"]
    assert span == 9.0, (
        f"got a {span} s window — 29 s means the seam was read in the floating frame, fell outside the "
        "absolute window and split nothing, so the two daemon runs merged into one session"
    )


def _cross_midnight_pair(tmp_path):
    """Yesterday's session CROSSES midnight; tonight's opens exactly one `_SESSION_GAP_SEC` after it.

    Real-shaped: a daemon running through midnight writes the whole session into the folder it STARTED
    in, so `2026-07-24` holds rows stamped `2026-07-25T00:00:…`. Mtimes are pinned because an absolute
    frame reads a file's end from the mtime."""
    y = tmp_path / "2026-07-24"
    y.mkdir(parents=True)
    rows = []
    for i in range(120):  # 23:59:00 → 00:00:59, so the coverage ENDS after midnight
        t = 23 * 3600 + 59 * 60 + i
        day, tt = (24, t) if t < 86400 else (25, t - 86400)
        rows.append(f"2026-07-{day:02d}T{tt // 3600:02d}:{(tt % 3600) // 60:02d}:{tt % 60:02d}.000;{i}000000000;1")
    (y / "Polar_H10_02849638_20260724235900_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(rows) + "\n"
    )
    t_ = tmp_path / "2026-07-25"
    t_.mkdir(parents=True)
    r2 = [f"2026-07-25T01:00:{i:02d}.000;{i}000000000;1" for i in range(10)]
    (t_ / "Polar_H10_02849638_20260725010000_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(r2) + "\n"
    )
    _pin(y)
    _pin(t_)
    return t_


def test_a_session_opening_ONE_WHOLE_GAP_after_midnight_still_pools_the_previous_day(tmp_path):
    """The pooling gate's UPPER bound is INCLUSIVE, and this is the case that proves it must be.

    Kills `0 <= earliest - midnight <= _SESSION_GAP_SEC` → `<`, which is what the code said until this
    PR. The strict bound asks midnight → session START while `merge_sessions` — the authority on what
    one session is — asks from the running coverage's END, and a previous-day session that crossed
    midnight pushes that end past 00:00. So a session opening at exactly one gap was refused, while
    `merge_sessions` given both folders returns ONE session.

    MEASURED, and the numbers are the whole point: yesterday's coverage ends 00:00:59, tonight opens
    01:00:00, so `earliest - midnight` is exactly 3600.0 against a 3600.0 gap and the gap from the
    previous END to this open is 3541 s — inside the rule. Pooled, the window is 3669 s. Unpooled, it
    is 9 s: 61 minutes of one continuous session published as nine seconds, with no error and no
    refusal, which reads as a short recording rather than a truncated one.

    ⚠️ I first wrote this test the other way round — asserting the window STAYS at 9 s on day 25 — and
    it passed, because that was the behaviour. A test that asserts the current behaviour retires the one
    mutant pointing at the defect. The mutant not dying against it is what sent me to measure what the
    other bound would actually change.

    This closes the BOUNDARY, not the class: a previous day running to 01:30 still merges with a 02:00
    session this gate never looks for. Residue row
    `2026-10-05-midnight-pooling-gate-is-narrower-than-the-session-gap-rule-it-guards` stays OPEN."""
    tonight = _cross_midnight_pair(tmp_path)
    out = timeline.build(str(tonight), _DEV)

    assert out["t1"] - out["t0"] == 3669.0, (
        f"got a {out['t1'] - out['t0']} s window — 9 s means the previous day was not pooled, so the "
        "head of one continuous session was dropped and the night reads as a short recording"
    )
    assert datetime.datetime.fromtimestamp(out["t0"], datetime.UTC).day == 24, (
        "the window must start on the previous day, where the session actually opened"
    )


# ── E6 · the rate `bucket_stream` never used ──────────────────────────────────────────────────────
def test_E6_bucket_stream_does_not_take_a_rate_it_cannot_use():
    """`bucket_stream` buckets INTERVALS against a window; the sample rate never entered the
    arithmetic. An accepted-and-ignored parameter is worse than none: every caller had to invent a
    value and every reader had to check whether it mattered. Pinned by signature so it cannot come
    back silently."""
    import inspect

    assert list(inspect.signature(timeline.bucket_stream).parameters) == ["intervals", "t0", "t1", "n"]


def test_bucket_stream_with_ONE_bucket_still_reports_it():
    """Kills `if n <= 0` → `n <= 1`. One bucket is a legal request — the monitor asks for exactly one
    when the window is short — and widening the refusal silently returns an empty timeline."""
    assert timeline.bucket_stream([(0.0, 10.0)], 0.0, 10.0, 1) == ["captured"]


def test_each_bucket_spans_ONE_width_not_two():
    """Kills `t0 + (i + 1) * width` → `(i + 2) * width`. With a double-width bucket 0, coverage that
    belongs to bucket 1 is credited to bucket 0 and the picture shifts left."""
    assert timeline.bucket_stream([(10.0, 20.0)], 0.0, 40.0, 4) == ["idle", "captured", "idle", "idle"]


def test_an_UNCOVERED_bucket_starts_from_zero_coverage():
    """Kills `covered = 0.0` → `1.0`. A single second of phantom coverage turns `idle` into
    `degraded`, and that is the distinction an operator reads as "nothing was recorded" against
    "something was"."""
    assert timeline.bucket_stream([], 0.0, 10.0, 1) == ["idle"]
    assert timeline.bucket_stream([(0.0, 10.0)], 0.0, 20.0, 2) == ["captured", "idle"]


def test_an_interval_that_ENDS_before_a_bucket_does_not_stop_the_scan():
    """Kills `continue` → `break` in the skip-earlier-intervals arm. With `break`, the first interval
    ending before the bucket aborts the whole scan, so every later interval — including the one that
    covers this bucket — is lost and the bucket reads idle."""
    assert timeline.bucket_stream([(0.0, 5.0), (10.0, 20.0)], 0.0, 20.0, 2) == ["degraded", "captured"]


def test_coverage_from_SEVERAL_intervals_in_one_bucket_is_SUMMED():
    """Kills `covered += …` → `covered = …`. Two 4 s fragments in a 10 s bucket are 80 % — captured.
    Keeping only the last is 40 % — degraded. A dropping link writes exactly this shape, so the bug
    would report every reconnecting stream as worse than it was."""
    assert timeline.bucket_stream([(0.0, 4.0), (4.0, 8.0)], 0.0, 10.0, 1) == ["captured"]


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


def test_bucket_stream_does_not_depend_on_the_ORDER_the_intervals_arrive_in():
    """Kills `if s >= b1: continue` → `break`, which is what this line was until #3282 folded in.

    The early exit assumed the intervals arrive sorted by start. Its one production caller does sort
    them (`stream_intervals` returns `sorted(...)`), but the signature accepts any list and the
    assumption was written down nowhere — so the function answered a legal input wrongly and quietly.

    MEASURED, and the direction is what makes it matter: `[(5.0, 10.0), (0.0, 5.0)]` over `[0, 10)` in
    two buckets gave `['idle', 'captured']`, against `['captured', 'captured']` for the identical data
    sorted. A bucket the intervals DO cover reported as `idle` — the one state that reads as a FINDING
    rather than a miss, which is the same failure mode as the ring's `_ACCRAW.txt` being painted idle.

    The assertion is ORDER-INDEPENDENCE rather than a literal strip, because that is the property: the
    answer is a function of the coverage, not of the list's order."""
    iv = [(5.0, 10.0), (0.0, 5.0)]
    assert timeline.bucket_stream(iv, 0.0, 10.0, 2) == timeline.bucket_stream(sorted(iv), 0.0, 10.0, 2)
    assert timeline.bucket_stream(iv, 0.0, 10.0, 2) == ["captured", "captured"], (
        "both buckets are fully covered by these two intervals, whichever order they arrive in"
    )
