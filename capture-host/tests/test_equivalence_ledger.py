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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _srcscan import HERE  # noqa: E402

LEDGER = os.path.join(str(HERE), "tools", "mutate-equivalence.json")

# THE RATCHET: entries per module, committed. It may only go UP without a reason stated in the commit —
# a drop is either a deliberate removal (say which entry and why it excuses nothing) or the merge defect
# above. Restored 2026-09-29 after #3237; the numbers are the file's own, not a target.
# solid_night_inputs.py went 24 -> 23 on 2026-10-03: #3243 DELETED the entry excusing
# `rstrip("\\n")` -> `lstrip("\\n")` because the gate refuted it — cell 7 is compared as a string
# to "ok", so the surviving newline skips the row. A refuted claim is removed, not softened.
# writers.py went 2 -> 17 and jitterfloor.py entered at 5 on 2026-10-04 (night-0928 row E11). E11 edits
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
# harness it runs on.
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
RATCHET = {
    "acq_evidence_cpap.py": 1,
    "ble_visibility.py": 4,
    "blind_spots.py": 1,
    "clock.js": 3,
    "cpap_edf.py": 1,
    "cpap_edf_writer.py": 4,
    "cpap_record.py": 2,
    "cpap_spool.py": 3,
    "cpap_stream.py": 2,
    "cpapdex-dsp.js": 26,
    "ecgdex-dsp.js": 1,
    "glucodex-dsp.js": 48,
    "hrvdex-dsp.js": 71,
    "jitterfloor.py": 5,
    "loss_audit.py": 20,
    "mmeta.py": 9,
    "motiondex-dsp.js": 100,
    "mutation_diff.py": 37,
    "mutation_pure.py": 5,
    "mutation_triage.py": 2,
    "night_report.py": 8,
    "nightqc.py": 23,
    "nights_index.py": 9,
    "oxy_inventory.py": 6,
    "oxy_transfer.py": 5,
    "oxyii.py": 3,
    "ppg_grid_check.py": 2,
    "ppgdex-dsp.js": 130,
    "probe_oxyii_0x03.py": 1,
    "probe_ring_adv.py": 4,
    "pulsedex-dsp.js": 43,
    "solid_night.py": 1,
    "solid_night_inputs.py": 34,
    "telemetry.py": 1,
    "timeline.py": 1,
    "writers.py": 17,
}


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
    """What the CLASSIFIER matches on, which is coarser than an entry's identity: the JS sibling keys on
    `(line, op, before)` and records `after` "for a reader, not for matching" (this file's `_README`). One
    source line can carry several mutants of one operator — three `>=` on one line are three mutants with
    one matcher key — so a collision here is expected and is NOT a defect; `_identity` above includes
    `after` because that is what distinguishes the entries as DATA."""
    if "key" in e:
        return ("key", e["key"])
    return ("js", e.get("line"), e.get("op"), e.get("before"))


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
            # Completeness is asked of the MATCHER's key only. `after` is optional in the data — 6 of
            # the 596 entries omit it — and it is documentation, so demanding it would red a legitimate
            # entry. `_identity` still includes it because two entries differing only in `after` are two
            # entries; `None` is simply one of its values.
            mk = _matcher_key(e)
            if mk[0] == "js" and any(x is None for x in mk[1:]):
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


# The matcher's key is COARSER than an entry's identity, and that costs something measurable.
COARSE_COLLISIONS = {
    "glucodex-dsp.js": 5,
    "hrvdex-dsp.js": 15,
    "motiondex-dsp.js": 6,
    "ppgdex-dsp.js": 6,
    "pulsedex-dsp.js": 4,
}


def test_the_MATCHER_KEY_collisions_are_counted_and_do_not_grow():
    """⚠️ A PRE-EXISTING COST, measured while restoring the ledger and deliberately not fixed here.

    The classifier matches a JS entry on `(line, op, before)` and `after` is documentation, so where one
    line carries several mutants of one operator the FIRST entry wins and the others' `probe` and `why`
    can never be read — 36 entries across five modules are in that position today. They are not wrong and
    they are not duplicates (every entry is distinct once `after` is included); they are arguments the
    tool cannot reach. Counted here so the number cannot grow unnoticed, and left for whoever decides
    whether the matcher should take `after` into account — that is a change to how every existing entry
    matches, which is not a restore PR's business."""
    led = _load()
    got = {}
    for mod, entries in led.items():
        if mod == "_README":
            continue
        seen = {}
        n = 0
        for e in entries:
            k = _matcher_key(e)
            if k in seen:
                n += 1
            seen[k] = True
        if n:
            got[mod] = n
    assert got == COARSE_COLLISIONS, (
        f"the count of entries the classifier can never reach changed: {got} vs {COARSE_COLLISIONS}. "
        "Growing it hides an argument; shrinking it is good and wants the number lowered here."
    )
