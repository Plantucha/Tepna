# tepna-capture — tests/test_equivalence_ledger.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tools/mutate-equivalence.json` — the ledger's own structural invariants.

🔴 WHY THIS FILE EXISTS. On 2026-09-29 a three-way merge of this ledger (#3237, mine) destroyed **413 of
595 entries** and nothing noticed: the merge keyed every entry on `(e["key"], e["class"])`, and the
JS-SIDE ENTRIES HAVE NO `key` — they are `{line, op, before, after, class, probe, why}` — so all of them
collapsed to one entry per distinct class per module. `ppgdex-dsp.js` went 130 → 2, `motiondex-dsp.js`
100 → 1, `hrvdex-dsp.js` 71 → 2. The survivor count per module was exactly its number of classes, which
is the signature of the bug.

⚠️ THE POST-CONDITION I DID WRITE COULD NOT SEE IT. It asserted "every entry either side has is present
in the result", implemented as `identity(e) not in have` — and the single collapsed survivor satisfies
that membership test for all 130 of them. **A COUNT would have caught it instantly**, which is why the
ratchet below is a count and not a property. An entry is data nobody re-derives: a lost `probe` is a
measurement someone ran and nobody will run again, so the cheap guard is worth having.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_diff  # noqa: E402

from _srcscan import HERE  # noqa: E402

LEDGER = os.path.join(str(HERE), "tools", "mutate-equivalence.json")

# solid_night_inputs.py went 35 -> 32 on 2026-10-05 (#3297, the recording as the verdict's scope). FOUR
# entries DELETED because the gate REFUTED them in as many words — "the mutant was killed, so the
# recorded claim is wrong" — and this file's own rule is that a refuted claim is removed, not softened.
# All four claimed `no-distinguishing-input` for the encoding keywords on the two sidecar readers in
# `clocks`: `open(seams, encoding="utf-8", errors="replace")` and the same on `rtc`, each in its
# `encoding=None` and dropped-keyword form. They were true when written, and #3297 made them false: the
# unit put those readers in a DATE-named folder for the first time (the suite's other `clocks` cases use
# a bare `tmp_path`, where `band_of` is None and nothing filters), and the tests it added read each
# sidecar under `-X warn_default_encoding -W error::EncodingWarning` and with a raw \xff\xfe mid-file.
# Both of those distinguish the original from every variant, so the claim no longer holds. ⚠️ The entries
# were not wrong when made — coverage grew past them, which is the good outcome and still obliges the
# deletion. ONE entry was ADDED in the same unit, so the arithmetic is 35 + 1 - 4 = 32 and the ratchet
# is set to exactly that — a floor below the real count does not ratchet, it only looks like it does.
# The addition: the `rstrip("\n")` -> `lstrip`
# direction flip on `p = line.rstrip("\n").split(";")` in the RTC row scan, probed over 1080 candidate
# rows (3 timestamps x 5 event spellings x 9 offset fields x 4 line endings x 2 leading-newline variants)
# with 0 disagreements in the scan's decision, because the stripped text is consumed only by `float()`,
# which tolerates surrounding whitespace, while `p[1] == "read"` compares an interior field no
# end-of-line strip can reach. Its `rstrip(None)` twin was already in the file. ⚠️ And per the note above
# about #3243: that deletion was for `cells = line.rstrip(...)` in a different reader, where the cell is
# string-compared to "ok" — a different key and a different call site, so it does not transfer here.
# solid_night_inputs.py went 32 -> 34 on 2026-10-05 (#3324, the `rtc` band): TWO entries ADDED for the
# `c = line.rstrip("\\n")` pair in `rtc_events`, probed over 4,536 candidate RTCLOG rows with 0
# disagreements in the reader's decision. ⚠️ PROBED AT THIS CALL SITE rather than transferred from the
# identical mutation text in `clocks`: there the stripped text feeds `float(p[2])` alone, here it also
# feeds an exact membership test on `c[1]`, and this file's own history is explicit that a claim does not
# carry between call sites because the mutation matches. The band's 28 arithmetic survivors were NOT
# excused — the drift formula was extracted as `rtc_drift` and pinned to exact floats, because inside
# `rtc_band` those numbers only ever reached a reader as `f"{ppm:+.0f}"` and a test could assert the
# sentence while missing an index substitution worth less than half a ppm.
# THE RATCHET: entries per module, committed. It may only go UP without a reason stated in the commit —
# a drop is either a deliberate removal (say which entry and why it excuses nothing) or the merge defect
# above. Restored 2026-09-29 after #3237; the numbers are the file's own, not a target.
# solid_night_inputs.py went 24 -> 23 on 2026-10-03: #3243 DELETED the entry excusing
# `rstrip("\\n")` -> `lstrip("\\n")` because the gate refuted it — cell 7 is compared as a string
# to "ok", so the surviving newline skips the row. A refuted claim is removed, not softened.
# writers.py went 2 -> 19 and jitterfloor.py entered at 5 on 2026-10-04 (night-0928 row E11). E11 edits
# PmdArrivalLogWriter.__init__, which put that whole function in the gate's scope: 41 survivors, of which
# only 13 were the new header-width read. Six more were killed with real tests (a file of exactly "\n" is
# the only input separating `getsize > 0` from `> 1`; `rfind` returning 0 separates `_c >= 0` from `>= 1`;
# `_c + 2` keeps a one-byte stump; `seek(2)` reads the third byte instead of the last; strict decoding
# raises on one bad byte; `dev_ms` resolves the 2026-11-01 DST fold). The rest are declared with probes
# that were RUN: the open()/read_text() keyword family (1 << 17 and 2 << 16 are the same number;
# newline=None translates to os.linesep, "\n" here; LC_ALL=C still read 7 columns), the torn-tail probes
# that are equivalent BY POSITION (one byte remains after seek(-1, 2)), and `_c + 1 if (_c >= 0) or True`
# (the false arm computes the same number, -1 + 1 == 0). One is `knife-edge-only`, not equivalence, and
# one is `untestable-by-design`: freezing _time.monotonic to pin the flush boundary crashed both writer
# globs and cost 132 verdicts, the second time this suite has had to retire a test that reaches into the
# harness it runs on. Two carry a structural proof rather than a sampling: the `rstrip("\\n")` ->
# `lstrip`/`rstrip(None)` pair on the width line, whose stripped string is consumed ONLY by
# `count(";")`. ⚠️ #3243 DELETED that identical mutation's entry for solid_night_inputs.py because
# there the cell is string-compared to "ok" — a refutation does not transfer between call sites just
# because the mutation looks the same, and both entries now say so beside their keys.
# nightqc.py went 38 -> 46 on 2026-10-05 (residue 2026-09-28-writer-records-no-utc-offset, #3286):
# `recorded_writer_offset` is new, so the gate scoped the whole function — 19 survivors, of which the
# killable ones were killed (`continue` not `break`, with the unusable row FIRST so a `break` cannot
# pass by having already got the answer; the `len(cells) <= col` bound on a row carrying exactly `col`
# cells; and the DST-seam log, whose arguments are the only trace a seam leaves, now asserted through
# caplog for both its count and its values). The 8 declared here are the open()/strip keyword family
# this ledger already carries for ble_visibility.py and writers.py, with the LC_ALL=C probe re-run.
# ⚠️ One of them differs from its writers.py twin and the entry says so: dropping `errors="replace"` is
# NOT killable on STARTS.csv (ASCII fields only) where it IS killable on the arrival sidecar's header
# (device bytes) — the same keyword, two files, two answers.
# solid_night_inputs.py went 23 -> 34 on 2026-10-03 (#3245) and that NET RISE hides a second deletion
# the count cannot show: the SIBLING entry excusing `cols = header.rstrip("\\n")` -> `lstrip` in
# `residual_scan` was refuted the same way and removed — `_SENSOR_NS_COL not in cols` is a STRING
# membership test, which `float`'s whitespace tolerance never touches, so with `lstrip` a two-clock
# stream reports no device clock at all. Twelve §A5 entries were added. The third sibling, for
# `recorded_seams`, was re-measured (5,040 sidecars, 0 distinguishing) and KEPT with a reason about
# that site's own two consumers rather than the one that had now been refuted twice.
# blind_spots.py (1) and ppg_grid_check.py (2) are NEW on 2026-10-04: the mypy-drift PR narrowed types
# inside `analyze`, `_is_double` and `grid_inflation`, which put those whole functions in the gate's
# scope for the first time and surfaced 21 survivors. 18 were killed outright — 13 by fixtures that
# could actually distinguish the mutant, 5 by collapsing `_is_double`'s dead parameters, which is a
# refactor the unkillable mutants themselves argued for. These 3 are the residue, each with a
# COMMITTED battery whose canaries are asserted first.
# solid_night_inputs.py stays at 34 on 2026-10-04 (#3263) and the number hides a SWAP, which is why it
# is written here: the `len(anchors) < TB_MIN_ANCHORS` entry was REFUTED and DELETED, and one for the
# clock-stream tag replaced it. ⚠️ THE REFUTATION IS A MATCHER FACT, NOT A WRONG ARGUMENT. `classify`
# matches an entry on its KEY ALONE, and that line appears in BOTH `unrecorded_shift` and `timebase`
# (solid_night_inputs.py:847 and :1004). The claim was written for the first, where it holds; #3263 put
# the second in scope, where the mutant IS killable and WAS killed — so one entry spoke for two
# functions and the gate reported the collision as a refutation, correctly by its own rule. Residue
# 2026-10-04-an-equivalence-key-cannot-name-its-function.
# solid_night_inputs.py 34 -> 35 on 2026-10-04 (#3261): one entry for `span[0] is None` ->
# `span[1] is None` in `continuity`. `first_last` sets both members or neither and every `spans`
# value comes from it, so the two are the SAME predicate for every span the function can receive —
# the mutant asks the same question, not a different one. (My own earlier note said 23 -> 24; #3245
# landed first and took the count to 34, so this is the rebase that re-bases the claim on it.)
# solid_night.py 1 -> 2 on 2026-10-04 (#3241): `settled=False` -> `settled=None` at the compose call,
# where the receiver tests the argument for FALSINESS — the same input to the only code that reads it.
# #3245 landed first with this module's other entry (the sample fixture's device offset), so this is
# the rebase that raises the count, exactly as that PR's note predicted.
# nightqc.py 23 -> 38 on 2026-10-04 BANKS #3266 (merged): 15 survivors of the unreadable-file fix recorded
# equivalent with probes that were RUN (an 8-night original-vs-mutant summarize battery, a 50-file chunk probe).
# diskguard.py is NEW at 2 on 2026-10-04 (absence drain group 2a): one extra step of a walk-up loop bounded by
# path depth (13 paths, identical disk_usage arguments) and `>= 0` on the low-space floor (free bytes are never
# negative; a 36-case grid).
# writers.py 19 -> 35 on 2026-10-04 (absence drain 2b): the ECG relative-ms anchor fix sits in StreamWriter.__init__,
# which put the whole constructor in scope: 49 survivors, 33 killed by tests/test_writers_resume_edges.py (9 of them
# sized by Codex — the 1 MiB buffer, the /dev/full flush log, the gyro seam seed, an unknown stream resuming — each
# verified by applying the mutant), 16 recorded here with a 29-session original-vs-mutant battery. ⚠️ That battery
# compares FINAL bytes, so it called the buffer-size mutants identical; they differ only BEFORE the first flush.
# 2026-10-04 (absence drain 4a): cpap_edf_writer.py 4 -> 6 (three EdfSink.__init__ initial values
# read only by truthiness, never before assignment, or never at all — one key was already present); cpap_live.py ENTERS at
# 1 and o2ring.py at 3 (detector_age_s `or`->`and` falls into the same except; pull_session's
# default offset and two loop-boundary variants, on a 224-pull battery that REFUTED a fourth claim, now a test).
# mutation_diff.py 38 -> 41 on 2026-10-12 (#3511): the floor trailed the file by one, and two `.get` defaults
# feeding `function_of_mutant` in `classify` are equivalent by proof — that function opens `if not name:
# return ""`, so `""` and `None` are one argument. A canary test retires both the day that guard narrows.
# pull_session.py ENTERS at 1 on 2026-10-22 (#3855, survivor batch pull-once-part-3-of-6): the
# explicit `0` offset of `file_start_frame(ts, 0)` in `_pull_once` equals the parameter's default.
# pull_session.py 1 -> 2 on 2026-10-22 (#3855, survivor batch pull-once-r2-of-6): `resumed_from = 0`
# -> `None` in `_pull_once`, whose only read is the truth test `if complete and resumed_from:`.
# pull_session.py 2 -> 6 on 2026-10-22 (#3855, survivor batch pull-once-r3-of-6): the unanswered-seek
# fallback `Resume(RESTART, 0, ...)` with its mode set to None or its offset to None or 1 (only the second
# resume guard reads them, and its first operand is False for RESTART and None alike), and
# `data += fh.read(...)` -> `data = fh.read(...)`, where `data` is still the empty buffer bound above.
# pull_session.py 6 -> 11 on 2026-10-22 (#3855, survivor batch pull-once-r6-of-6): four rewrites of the
# `n_samples` guard, each equal to the original over the whole domain (a proof by cases), and the dropped
# explicit `clock_status=acq_evidence.UNKNOWN`, which equals the default of `assemble_dat` (a canary pins it).
# pull_session.py 11 -> 13 on 2026-10-22 (#3855, survivor batch pull-once-r1-of-6): `identity = None`
# -> `""` (every reader tests its truth only), and the `.part` size in `part_files` -> None (`oxy_restart.plan`
# reads the keys of that map, never its values).
# pull_session.py 13 -> 12 on 2026-10-24 (residue 2026-10-21-the-ring-stored-path-declares-an-unknown-clock-
# it-could-name): the entry excusing the dropped `clock_status=acq_evidence.UNKNOWN` is DELETED, because its
# own reason expired. It held only while the argument repeated the default of `assemble_dat`; the call site
# now derives the word from the trailer it already parsed, so a trailer carrying the ring's `start_t_ms`
# distinguishes the two calls. `test_pull_session.py::test_a_written_start_stamp_makes_the_real_pull_name_
# the_DEVICE_clock` kills that mutant, and the canary states the live fact instead of the retired one.
# alerts.py and battery_history.py ENTER at 1 each on 2026-10-25 (claude/batt-alert-wrn, alert emails and the
# Batteries card): `domain.strip(".")` -> `domain.strip(None)` in validate_email's `"." not in` clause (strip
# never removes a dot, and a dotted edge is refused by the next clause either way; 11.4M inputs, 0 differed),
# and `pct < per[hour]` -> `<=` in read_link (a tie re-stores an equal int; 3,000 random trees, 0 differed).
# mutation_diff.py 39 -> 41 on 2026-10-25 (#3920, residue 2026-10-25-the-mutation-stager-drops-the-one-dotted-read-the-manifest-declares):
# `manifest_reads` reads the traced manifest, and the two maxsplit variants of `rel.split("/", 1)[0]` compute the
# first segment identically for every string — `split("/")` and `split("/", 2)`. 0 of 211 declared-path cases
# differed, and the argument is over the whole domain, not the battery. The right-split variant IS killed by a test.
# verity_sdk_config.py ENTERED at 5 on 2026-10-26 with the module itself. The gate kept FULL scope
# for a new file (no base version to narrow against), so all 25 survivors were required; 19 were
# killed with real assertions and the remaining 6 are these 5 entries, one key naming two sites.
# Every one is a falsy-default substitution read only for truth, and every probe is a RUN of
# tools/probe_verity_equivalence.py over a generated corpus — 41,111 line-sets, 320 lines and 37
# documents, zero differing inputs. The probe ships beside the module so the claims can be
# re-tested; it is not a test, because rebuilding a mutant by line number would read the wrong
# lines under the gate's own rewrite.
# allan.py ENTERED at 3 and as11_link.py at 1 on 2026-10-28 (#4040, row
# 2026-10-21-sixteen-literal-defaults-are-taken-by-no-production-call). Deleting a signature-only default put
# `adev_pooled` and `get_date_time` in the gate's scope whole. `adev_pooled` keeps three: the start index of the
# no-segmentation fallback tuple, which the next statement never reads because it returns the whole-series curve,
# and the two threshold moves of the division guard `v[1] > 0` to `>= 0` and `> 1`. Every entry in `acc` sums
# per-tau term counts from `adev()`, and `adev` publishes a tau only at `terms >= _MIN_TERMS` (8), so every
# threshold in [0, 8) admits the same set; the probe is 400 randomized pooled runs, 399 segmented, minimum
# published `n` of 24. `get_date_time` keeps one: dropping its explicit `None` passes `rpc`'s own `params=None`
# and builds a byte-identical envelope. The other 16 survivors of those two functions are killed by new tests.
# nightarchive.py ENTERS at 1 on 2026-11-01 (residue 2026-10-29-one-live-writer-holds-a-settled-night-
# active-and-blocks-every-offload). The diff-scoped gate judged the two new functions and reported 8
# survivors; 7 were real gaps and each is killed by a named test. The one entry is the MAXIMUM fold in
# `_newest_any_mtime`, where `>=` differs from `>` only on a tie and a tie assigns the value already held.
RATCHET = {
    "acq_evidence_cpap.py": 1,
    "acq_evidence_o2ring.py": 1,
    "alerts.py": 1,
    "allan.py": 3,
    "as11_link.py": 1,
    "battery_history.py": 1,
    "ble_visibility.py": 4,
    "blind_spots.py": 1,
    "bonding.py": 4,
    "clock.js": 0,
    "cpap_continuity.py": 1,
    "cpap_edf.py": 0,
    "cpap_edf_writer.py": 6,
    "cpap_live.py": 1,
    "cpap_record.py": 2,
    "cpap_spool.py": 3,
    "cpap_spool_decode.py": 1,
    "cpap_stream.py": 4,
    "cpapdex-dsp.js": 25,
    "diskguard.py": 2,
    "ecgdex-dsp.js": 1,
    "glucodex-dsp.js": 48,
    "hrvdex-dsp.js": 62,
    "jitterfloor.py": 5,
    "loss_audit.py": 19,
    "mmeta.py": 9,
    "motiondex-dsp.js": 100,
    "mutation_diff.py": 41,
    "mutation_pure.py": 5,
    "mutation_triage.py": 2,
    "night_report.py": 8,
    "nightarchive.py": 1,
    "nightqc.py": 52,
    "nights_index.py": 6,
    "oxy_inventory.py": 4,
    "oxy_transfer.py": 1,
    "o2ring.py": 3,
    "oxyii.py": 3,
    "polar_psftp.py": 1,
    "ppg_grid_check.py": 2,
    "ppgdex-dsp.js": 126,
    "probe_oxyii_0x03.py": 3,
    "probe_pmd_opcodes.py": 6,
    "probe_pmd_surface.py": 2,
    "probe_ring_adv.py": 4,
    "proc_util.py": 3,
    "pull_session.py": 12,
    "pulsedex-dsp.js": 43,
    "qc_child.py": 2,
    "solid_night.py": 2,
    "solid_night_inputs.py": 33,
    "stallsampler.py": 2,
    "storage_targets.py": 2,
    "telemetry.py": 1,
    "timeline.py": 1,
    "verity_sdk_config.py": 5,
    "writers.py": 35,
}


def _js_ledger_path():
    """The JS lane's `tools/mutate-equivalence.json`, or `None` where that path answers with THIS lane's file.

    🔴 A mutmut sandbox is this lane FLATTENED. Under the mutants geometry `os.path.dirname(HERE)` is the
    scratch's `work/`, which is the tree copy itself, so the JS lane's path there answers with a byte copy
    of this lane's own ledger. `mutation_diff.tree_shadowed` stages a shadowed root read one level up
    alone, on purpose, so that the tree's own file survives inside the tree. That staging rule is #3256's
    fix for `2026-10-03-root-read-staging-clobbers-a-samename-file`, which measured the same collision in
    the opposite direction. One path carries two meanings, and the decision serves the clean baseline. Measured 2026-10-26 inside the gate's own
    scratch `/tmp/mut-writers-5c9a3fbfbcb9/work/mutants`: three legs below failed there against none in
    the checkout, 12 globs of that run reported 0 tested mutants, and every mutant the gate generated
    read as unmeasured rather than killed.

    ⚠️ THE MARKER IS THE FILE'S IDENTITY AND NEVER A SECOND PATH. A marker file named here would enter
    the root-read set `mutation_diff.root_reads` derives from these sources, the stager would copy it into
    the scratch, and it would then be present in the very tree it is meant to rule out. §∅: the absence is
    `None`, never the path of a different file answering to the same name.
    """
    path = os.path.join(os.path.dirname(str(HERE)), "tools", "mutate-equivalence.json")
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        there = fh.read()
    with open(LEDGER, "rb") as fh:
        here = fh.read()
    return None if there == here else path


def _require_js_ledger():
    """The JS ledger path for a test that has nothing to examine without it, skipping with a named reason
    rather than passing over a population of 0 (§∅: a measurement nobody took is not a green one)."""
    path = _js_ledger_path()
    if path is None:
        pytest.skip("no JS lane in this tree — its ledger path answers with this lane's own file")
    return path


def _both_ledgers():
    """BOTH ledgers that carry the four-field key: this lane's and the JS lane's `tools/` one. `_load()`
    reads only this lane's, so a test about a field the JS lane holds and this one does not would pass
    while examining nothing — measured 2026-10-26, when the two qualifier invariants below were first
    written against `_load()` and reported green over 0 qualified entries."""
    for path in (LEDGER, _js_ledger_path()):
        if path is None:
            continue
        with open(path, encoding="utf-8") as fh:
            yield path, json.load(fh)


def _load():
    with open(LEDGER, encoding="utf-8") as fh:
        return json.load(fh)


def _identity(e):
    """An entry's identity UNDER ITS OWN SHAPE. Python-side entries are matched on the whitespace-
    normalised diff (`mutation_diff.diff_key`) and carry `key`; JS-side entries are matched by
    `tools/mutate.mjs` on `(line, op, before)` and carry no `key` at all. Reading one shape's field off
    the other is the whole defect this file was written for."""
    if "key" in e:
        return ("key", e["key"])
    return ("js", e.get("line"), e.get("op"), e.get("before"), e.get("after"))


def _matcher_key(e):
    """What the CLASSIFIER matches on — the Python model of `survivorKey` in `tools/mutate.mjs`, which is
    `line, op, before, after` (NUL-joined, `after ?? ''`) and is used by BOTH JS consumers: the classifier
    and the recorded-selection path. `after` is IN the key because one source line can carry several mutants
    of one operator — three `>=` on one line are three mutants — and `(line, op, before)` alone would
    collapse them into one entry. So the matcher key and `_identity` coincide, and an entry is reachable
    unless it duplicates another's whole quadruple. `after` absent reads as `""`, exactly as the JS does.
    ⚠️ Residue 2026-10-12-equivalence-matcher-coarseness-is-in-the-python-model-not-the-js-matcher: this
    function used to model the sibling as keying on the triple, and a green test asserted a cost the real
    matcher does not have. `test_the_MODEL_reads_the_same_key_as_the_JS_matcher` now reads the sibling's
    source rather than trusting this model."""
    if "key" in e:
        return ("key", e["key"])
    after = e.get("after")
    return ("js", e.get("line"), e.get("op"), e.get("before"), "" if after is None else after)


def _triple(e):
    """The COARSER `(line, op, before)` triple an earlier reading of the matcher assumed. Kept only to count
    what the real key resolves — see COARSE_TRIPLE_COLLISIONS."""
    return (e.get("line"), e.get("op"), e.get("before"))


def test_every_entry_carries_an_IDENTITY_under_its_own_shape():
    """An entry with neither `key` nor a full `(line, op, before)` triple can never match a mutant, so it
    excuses nothing and is indistinguishable from a typo. `mutate_diff.py` already tolerates a missing
    `key` at classification time (it reads `.get("key", "")` and reports the entry orphaned) — this makes
    the malformed entry loud at commit time instead of silent until someone touches that module."""
    led = _load()
    bad = []
    for mod, entries in led.items():
        if mod == "_README":
            continue
        for i, e in enumerate(entries):
            # Completeness is asked of `(line, op, before)` only. `after` is optional in the data — 6 of
            # the 596 entries omit it — and the matcher reads an absent one as "" (`m.after ?? ''`), so
            # demanding it would red a legitimate entry. `_identity` includes it because two entries
            # differing only in `after` are two entries; `None` is simply one of its values.
            mk = _matcher_key(e)
            if mk[0] == "js" and any(x is None for x in mk[1:4]):
                bad.append(f"{mod}[{i}]: no `key` and an incomplete (line, op, before): {sorted(e)}")
            if not e.get("class"):
                bad.append(f"{mod}[{i}]: no `class` — nothing says whether it excuses anything")
    assert not bad, "entries with no usable identity:\n  " + "\n  ".join(bad)


def test_an_identity_is_UNIQUE_within_its_module():
    """Two entries with one identity are the same entry twice — one of them is dead weight, and it is the
    shape a merge leaves when it re-adds an entry it already kept. Measured 2026-09-29 on the restored
    file: 0 across all 596 entries, so this is an invariant and not an aspiration."""
    led = _load()
    dupes = []
    for mod, entries in led.items():
        if mod == "_README":
            continue
        seen = {}
        for i, e in enumerate(entries):
            ident = _identity(e)
            if ident in seen:
                dupes.append(f"{mod}: entries [{seen[ident]}] and [{i}] share one identity {str(ident)[:90]}")
            seen[ident] = i
    assert not dupes, "duplicated identities:\n  " + "\n  ".join(dupes)


def test_the_ENTRY_COUNT_per_module_never_silently_DROPS():
    """🔴 THE CHECK THAT WOULD HAVE CAUGHT #3237. A membership post-condition passes while 130 entries
    collapse into 1; a count does not. Raising a number here is ordinary (a new entry); LOWERING one is a
    claim that those entries should not exist, and it belongs in a commit message with the reason."""
    led = _load()
    counts = {k: len(v) for k, v in led.items() if k != "_README" and isinstance(v, list)}
    lost = {k: (RATCHET[k], counts.get(k, 0)) for k in RATCHET if counts.get(k, 0) < RATCHET[k]}
    assert not lost, (
        "entries DISAPPEARED (ratchet → now); restore them or lower the ratchet with a reason:\n  "
        + "\n  ".join(f"{k}: {was} → {now}" for k, (was, now) in sorted(lost.items()))
    )
    gone = [k for k in RATCHET if k not in counts]
    assert not gone, f"whole modules dropped out of the ledger: {gone}"


def test_the_RATCHET_names_every_module_the_ledger_carries():
    """A module absent from the ratchet is unguarded, and a new module is exactly when a guard is worth
    having. Fails on an addition too, which is the point: adding the line is the same edit as adding the
    module."""
    led = _load()
    mods = {k for k in led if k != "_README" and isinstance(led[k], list)}
    assert mods == set(RATCHET), (
        f"ratchet and ledger disagree about which modules exist — only in ledger: "
        f"{sorted(mods - set(RATCHET))}; only in ratchet: {sorted(set(RATCHET) - mods)}"
    )


# The `(line, op, before)` TRIPLE is coarser than the matcher's key, and the matcher resolves the difference.
# Census (2026-10-12, 427 JS-side entries): 36 entries repeat an earlier entry's triple, across these five
# modules, and ZERO repeat a whole `(line, op, before, after)` quadruple. These are NOT entries the
# classifier cannot reach: `survivorKey` includes `after`, so every one of them is matched. The count is kept
# so the ledger's shape stays measured; it no longer prices anything.
COARSE_TRIPLE_COLLISIONS = {
    "glucodex-dsp.js": 5,
    "hrvdex-dsp.js": 13,
    "motiondex-dsp.js": 6,
    "ppgdex-dsp.js": 6,
    "pulsedex-dsp.js": 4,
}


def _collisions(keyfn):
    got = {}
    for mod, entries in _load().items():
        if mod == "_README":
            continue
        seen = set()
        n = 0
        for e in entries:
            k = keyfn(e)
            if k in seen:
                n += 1
            seen.add(k)
        if n:
            got[mod] = n
    return got


def test_the_COARSE_TRIPLE_collisions_are_counted_and_the_MATCHER_KEY_resolves_every_one():
    """Where one line carries several mutants of one operator, their entries share a `(line, op, before)`
    triple. The real matcher keys on `after` as well (`survivorKey`), so none of them shadows another: the
    triple collisions are counted (a census, pinned so it cannot drift unnoticed) and the matcher-key
    collisions must be EMPTY — a non-empty result is two entries the classifier cannot tell apart."""
    assert _collisions(_triple_of_js) == COARSE_TRIPLE_COLLISIONS, (
        f"the count of coarse-triple collisions changed: {_collisions(_triple_of_js)} vs {COARSE_TRIPLE_COLLISIONS}"
    )
    assert _collisions(_matcher_key) == {}, (
        f"entries the classifier cannot tell apart (same line, op, before AND after): {_collisions(_matcher_key)}"
    )


def _triple_of_js(e):
    return ("key", e["key"]) if "key" in e else _triple(e)


def test_the_MODEL_reads_the_same_key_as_the_JS_matcher():
    """The model above is only as true as the sibling it mirrors, and it was wrong for a while because it
    described the sibling rather than reading it. So read it: `survivorKey` in `tools/mutate.mjs` must name
    `after`, and the Python key must separate two entries that differ ONLY in `after`."""
    with open(os.path.join(os.path.dirname(str(HERE)), "tools", "mutate.mjs"), encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("export function survivorKey(")
    body = src[start : src.index("\n}\n", start)]
    assert "m.after" in body, f"the JS matcher key no longer includes `after`:\n{body}"
    a = {"line": 7, "op": ">=", "before": "x >= 1", "after": "x > 1", "class": "equivalent"}
    b = dict(a, after="x != 1")
    assert _matcher_key(a) != _matcher_key(b), "two mutants of one operator on one line must stay two keys"
    assert _matcher_key(dict(a, after=None)) == _matcher_key({k: v for k, v in a.items() if k != "after"}), (
        "an absent `after` and a null one are the same key, as `m.after ?? ''` reads them"
    )


def test_the_README_does_not_tell_authors_that_after_is_not_matched_on():
    """`tools/mutate-equivalence.json`'s `_README` instructed authors that `after` is "for a reader, not for
    matching". It is part of the key, so an author who believed it would rewrite `after` and orphan the
    entry. The README must say the key has four fields — in BOTH ledgers that carry it (the JS lane's
    `tools/` one, which `mutate.mjs` reads, and this lane's)."""
    for path, led in _both_ledgers():
        text = " ".join(led["_README"])
        assert "not for matching" not in text, f"{path}: the README still says `after` is not matched on"
        assert "(line, op, before, after)" in text, f"{path}: the README must name the real four-field matcher key"


def test_every_KEYED_entry_s_BEFORE_TEXT_is_still_in_its_MODULE():
    """🔴 Row `2026-09-28-equivalence-keys-holding-prose-can-never-match`, met as a check.

    An entry whose before text is absent from its module excuses nothing, and it excuses nothing
    FOREVER: `classify` matches a key against the mutants a run GENERATED, and no generator emits text
    the file does not hold. Two entries were keyed in English on 2026-09-28 (`- inside_old body: a <
    old_end and | + a < old_end or`), and `mutate_diff.py` reported them ORPHANED and excluded them
    from every count — so nothing red, nothing shrank, and the file still read like an answer.

    ⚠️ IT IS NOT A PARSE CHECK, which is what that row proposed. A prose key parses as a
    minus-plus pair perfectly well, and a pair-parse flags 1 of the 306 keyed entries. Presence in the
    module is the property that separates a live excuse from a dead one, and `entry_before_in_source`
    is the reader `mutate_diff.py` already uses for it. Measured 2026-10-20: 306 of 306 present, and
    the two prose keys are gone. A failure here is not a style finding — name the entry and re-verify
    it, or delete it and say what it stopped excusing."""
    led = _load()
    root = os.path.dirname(str(HERE))
    absent = []
    for mod, entries in led.items():
        if mod == "_README":
            continue
        # A JS module sits at the repo root, a Python one beside this suite. An absent file RAISES
        # rather than skipping: a ledger naming a module nobody can read is its own defect, and a
        # `continue` here would hide it behind a green check.
        with open(os.path.join(root if mod.endswith(".js") else str(HERE), mod), encoding="utf-8") as fh:
            src = fh.read()
        for i, e in enumerate(entries):
            if isinstance(e.get("key"), str) and not mutation_diff.entry_before_in_source(e["key"], src):
                absent.append(f"{mod}[{i}]: {e['key'][:100]}")
    assert not absent, (
        "equivalence entries whose BEFORE text is absent from their module — each one excuses nothing "
        "until re-verified:\n  " + "\n  ".join(absent)
    )


def test_the_JS_LEDGER_is_ABSENT_in_a_FLATTENED_tree_rather_than_IMPERSONATED(tmp_path, monkeypatch):
    """🔴 Row `2026-10-26-a-flattened-sandbox-root-answers-with-the-wrong-equivalence-ledger`.

    `os.path.dirname(HERE)` is the repo root in a checkout and the SANDBOX root under the mutation gate,
    where it holds a copy of this lane's ledger under the JS lane's name. A path that resolves is not the
    file its reader meant.

    The two arms below differ in the BYTES at that path and in nothing else, which is what makes the
    identity the thing the assertions read."""
    (tmp_path / "tools").mkdir()
    (tmp_path / "capture-host").mkdir()
    monkeypatch.setitem(globals(), "HERE", str(tmp_path / "capture-host"))
    at_root = tmp_path / "tools" / "mutate-equivalence.json"
    with open(LEDGER, "rb") as fh:
        ours = fh.read()

    # FLATTENED: a ledger sits at the path and it is ours.
    at_root.write_bytes(ours)
    assert _js_ledger_path() is None, "this lane's own ledger was reported as the JS lane's"
    assert [p for p, _ in _both_ledgers()] == [LEDGER], "the impersonating ledger was read anyway"
    with pytest.raises(pytest.skip.Exception) as skipped:
        _require_js_ledger()
    assert "no JS lane" in str(skipped.value), "the skip must name why the ledger is absent"

    # A CHECKOUT: a different ledger at the same path, and nothing else changed.
    at_root.write_bytes(json.dumps({"_README": ["(line, op, before, after)"]}).encode("utf-8"))
    want = str(at_root)
    assert _js_ledger_path() == want
    assert _require_js_ledger() == want
    assert [p for p, _ in _both_ledgers()] == [LEDGER, want]

    # ABSENT ALTOGETHER is the same answer, by the same rule.
    at_root.unlink()
    assert _js_ledger_path() is None


def test_a_FUNCTION_QUALIFIER_is_unique_within_its_module():
    """Residue 2026-10-26-a-line-keyed-equivalence-entry-that-drifts-ambiguously-cannot-be-placed. An entry
    may carry `fn`, the enclosing named function, and an entry that carries one is matched on
    `(fn, op, before, after)` with the LINE IGNORED — which is what lets it survive an edit above it. That
    makes the qualified identity the reachable one, so two qualified entries sharing it are one excuse
    standing for two mutants: the widening `tools/reanchor-equivalence.mjs --qualify` refuses to write and
    nothing else would catch if a qualifier were added by hand. Measured 2026-10-26 over the 261 qualified
    entries: 0 collisions, which is why this is an invariant and not a target. Re-measured 2026-10-27
    over 320, after #3995 probed and qualified 59 more: still 0.

    🔴 WHAT THIS TEST CANNOT SEE, AND WHERE THAT IS ANSWERED. It compares qualified entries TO EACH
    OTHER, so it fires on a PAIR sharing one identity. The condition the writer applies is stronger:
    exactly ONE GENERATED MUTANT may carry the identity, which also catches a LONE entry sitting over
    two sibling mutants — the shape an edit above the site produces, with no second entry anywhere.
    Measured 2026-10-28 over the 13 entries the settle pass re-addressed: this invariant named 3
    pairs over 6 entries, and the generator named 11. Residue
    2026-10-28-the-qualifier-uniqueness-test-compares-entries-to-each-other-not-to-the-generator.

    The generator is a node process, so no test here can ask it — this suite runs on a capture box
    with no node, and inside a mutmut sandbox. The answer therefore lives where the generator does:
    `qualifyPlan` re-decides every already-written qualifier against its identity histogram and the
    `reanchor-equivalence-qualify` verdict FAILS on a non-zero `ambiguousWritten`. The test below
    reads that condition out of the sibling's source rather than restating it, which is the same move
    `test_the_MODEL_reads_the_same_key_as_the_JS_matcher` makes for the matcher key. This test stays
    as the cheap half: it needs no generator, and a pair is the one case it decides on its own."""
    _require_js_ledger()
    dupes = []
    qualified = 0
    for path, led in _both_ledgers():
        for mod, entries in led.items():
            if mod == "_README" or not isinstance(entries, list):
                continue
            seen = {}
            for i, e in enumerate(entries):
                if not e.get("fn"):
                    continue
                qualified += 1
                ident = (e["fn"], e.get("op"), e.get("before"), e.get("after"))
                if ident in seen:
                    dupes.append(
                        f"{path}:{mod}: qualified entries [{seen[ident]}] and [{i}] "
                        f"share one line-free identity {str(ident)[:90]}"
                    )
                seen[ident] = i
    assert not dupes, "a function qualifier that excuses more than one mutant:\n  " + "\n  ".join(dupes)
    # A pass over 0 qualified entries is a pass about nothing; the JS ledger carries 320 of them.
    assert qualified > 0, "no ledger entry carries a qualifier — this test examined nothing"


def test_the_WRITER_re_decides_an_ALREADY_WRITTEN_qualifier_against_the_GENERATOR():
    """🔴 Residue 2026-10-28-the-qualifier-uniqueness-test-compares-entries-to-each-other-not-to-the-generator.

    The invariant above is a proxy, and this is the thing it proxies for. `qualifyPlan` must look an
    already-qualified entry's identity up in the generator's histogram instead of accepting the field
    on sight, and the pass's verdict must FAIL on the result. Read, not asserted: for most of this
    ledger's life the branch read `out.already.push(e)` and `ambiguousWritten` was the tally's own
    initialiser read back out, so the FAIL arm could not be reached by any ledger — a quantity
    nobody measured, reported as a 0 (§4b).

    A text pin, deliberately. Executing the condition needs the generator, which needs node, which
    this lane does not have; and a Python re-implementation of the histogram would be a second copy
    of the rule, free to drift from the one that runs. So this asserts the shape of the real
    condition at the one site that applies it, and names what it does not prove: that the branch is
    reached. The JS selftest does that (`a LONE already-qualified entry over two sibling mutants is
    WIDE`), and `--qualify` reports the count per file."""
    root = os.path.dirname(str(HERE))
    with open(os.path.join(root, "tools", "reanchor-equivalence.mjs"), encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("export function qualifyPlan(")
    body = src[start : src.index("\n}\n", start)]
    head = body[: body.index("const plan = planEntry(")]  # the already-carries-one branch, before the rest
    assert "cnt.get(idKey(e))" in head, (
        "`qualifyPlan` no longer re-decides an already-written qualifier against the generator's "
        f"identity histogram — the branch reads:\n{head[-400:]}"
    )
    assert "out.alreadyWide.push" in head and "out.alreadyGone.push" in head, (
        "the two outcomes must stay apart: a WIDE qualifier is a false excuse, a DEAD one orphans its "
        "entry and excuses nothing (§∅)"
    )
    # The verdict must FAIL on the wide count — a measured quantity nothing judges is no guard at all.
    vq = src[src.index("export function makeQualifyVerdict(") :]
    vq = vq[: vq.index("\n}\n")]
    assert "tq.ambiguousWritten ? 'FAIL'" in vq, f"a wide qualifier no longer FAILS the qualify verdict:\n{vq[:400]}"
    assert "tq.ambiguousWritten += q.alreadyWide.length" in src, (
        "nothing increments `ambiguousWritten`, so the FAIL arm is unreachable and the 0 it reports is "
        "an initialiser rather than a measurement"
    )


def test_a_QUALIFIED_entry_still_records_the_after_it_is_matched_on():
    """A qualifier replaces the LINE in the key, never `after`. An entry carrying `fn` but no `after` would
    be matched on (fn, op, before) alone, which is looser than the key it replaced — a widening dressed as a
    durability fix. `--qualify` routes an entry with no recorded `after` to its own refusal bucket for this
    reason; this is the agent-neutral half of that refusal."""
    _require_js_ledger()
    bad = []
    qualified = 0
    for path, led in _both_ledgers():
        for mod, entries in led.items():
            if mod == "_README" or not isinstance(entries, list):
                continue
            for i, e in enumerate(entries):
                if not e.get("fn"):
                    continue
                qualified += 1
                if e.get("after") is None:
                    bad.append(f"{path}:{mod}[{i}]: carries fn={e['fn']!r} but records no `after`")
    assert not bad, "a qualifier written onto an entry with no `after`:\n  " + "\n  ".join(bad)
    assert qualified > 0, "no ledger entry carries a qualifier — this test examined nothing"


def test_the_README_documents_the_OPTIONAL_qualifier():
    """An author reading the README must learn that `fn` exists, that it is optional, and that it is
    generated rather than hand-written — the three facts that keep a hand-added qualifier from widening an
    excuse. Asked of the ledger that CARRIES qualifiers, not of both: this lane keys on the diff and the
    enclosing function already, so the JS qualifier is not its vocabulary. The four-field key wording stays
    alongside it — the qualifier replaces the line for entries that carry one, it does not retire the key
    for entries that do not."""
    with open(_require_js_ledger(), encoding="utf-8") as fh:
        text = " ".join(json.load(fh)["_README"])
    assert "`fn`" in text, "the README never mentions the qualifier"
    assert "OPTIONAL" in text, "the README must say the qualifier is optional"
    assert "Never hand-write `fn`" in text, "the README must say the qualifier is generated, not hand-written"
    assert "(line, op, before, after)" in text, "the README must still name the four-field matcher key"
