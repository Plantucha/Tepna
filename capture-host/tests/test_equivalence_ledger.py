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
# solid_night_inputs.py went 23 -> 34 on 2026-10-03 (#3245) and that NET RISE hides a second deletion
# the count cannot show: the SIBLING entry excusing `cols = header.rstrip("\\n")` -> `lstrip` in
# `residual_scan` was refuted the same way and removed — `_SENSOR_NS_COL not in cols` is a STRING
# membership test, which `float`'s whitespace tolerance never touches, so with `lstrip` a two-clock
# stream reports no device clock at all. Twelve §A5 entries were added. The third sibling, for
# `recorded_seams`, was re-measured (5,040 sidecars, 0 distinguishing) and KEPT with a reason about
# that site's own two consumers rather than the one that had now been refuted twice.
RATCHET = {
    "acq_evidence_cpap.py": 1,
    "ble_visibility.py": 4,
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
    "ppgdex-dsp.js": 130,
    "probe_oxyii_0x03.py": 1,
    "probe_ring_adv.py": 4,
    "pulsedex-dsp.js": 43,
    "solid_night.py": 1,
    "solid_night_inputs.py": 34,
    "telemetry.py": 1,
    "writers.py": 2,
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
