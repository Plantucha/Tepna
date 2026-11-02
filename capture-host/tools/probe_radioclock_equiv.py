# tepna-capture — tools/probe_radioclock_equiv.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ARE `radioclock.py`'S SIX SURVIVING MUTANTS UNKILLABLE? — the probe behind their
`tools/mutate-equivalence.json` entries.

`tools/probe_equivalence.py` is the general Python prober, and its battery is written for
`polar_pmd.decode_frame`: one frame in, one decode out. These six survivors sit in a BLE framing
parser and in a collector method, so neither the inputs nor the comparison are that shape. This
module is the battery for them, built the way the sibling is: each mutant is compiled as a real
module from patched source, one battery runs through original and mutant, and every return value is
compared.

🔴 IT FAILS CLOSED. Six canary mutations are run through the same battery, and each MUST be seen. A
battery that cannot distinguish a parser ignoring the L2CAP channel id is not reaching the parser at
all, and every equivalence it reports would be vacuous rather than true — the shape
`tools/probe_equivalence.py` names as the reason its own canaries exist.

Run it from anywhere; it reads the module beside it:

    .venv/bin/python tools/probe_radioclock_equiv.py

Exit 0 means every mutant was indistinguishable AND every canary was seen. Exit 1 means one of those
two failed, and the printed line says which. One `tepna.verdict/1` object follows the prose and
carries the same decision: the prose explains, and the object is what a machine reads."""

import json
import random
import struct
import sys
import types
from pathlib import Path

CH = Path(__file__).resolve().parent.parent  # capture-host/, whose `radioclock.py` is the subject
sys.path.insert(0, str(CH))
SRC = (CH / "radioclock.py").read_text(encoding="utf-8")

import verdict as VD  # noqa: E402  — the path above is what makes this importable

# ── tepna.verdict/1 — the decision this probe already prints, as ONE object ───────────────────────
# The criterion is the probe's own rule, pre-stated: every declared mutant runs through the battery
# and NONE may be distinguished, because each one stands behind an equivalence entry that excuses it
# from the mutation gate. PASS every mutant indistinguishable with every canary seen · FAIL at least
# one mutant distinguished, so the entries keyed on it do not hold · UNKNOWN a canary went unseen,
# which means the battery never reached the code and every equivalence it reports would be vacuous
# rather than true. The population is the declared mutants; a blind canary excludes all of them,
# because a battery that cannot see a mutation it must see has examined nothing.
VERDICT_GATE = "probe-radioclock-equiv"
VERDICT_CRITERION = {
    "name": "mutants_distinguished_by_the_battery",
    "threshold": 0,
    "unit": "mutants",
    "direction": "lte",
}
VERDICT_EVIDENCE = [
    "capture-host/tools/probe_radioclock_equiv.py",
    "capture-host/radioclock.py",
    "capture-host/tools/mutate-equivalence.json",
]


def build(name, old, new):
    assert SRC.count(old) == 1, (name, SRC.count(old))
    mod = types.ModuleType("rc_" + name)
    mod.__file__ = str(CH / "radioclock.py")
    exec(compile(SRC.replace(old, new, 1), "radioclock[%s].py" % name, "exec"), mod.__dict__)
    return mod


BASE = build("base", "import os", "import os")

MUTANTS = {
    "payload_le4": ("if len(payload) < 4:", "if len(payload) <= 4:"),
    "payload_lt5": ("if len(payload) < 4:", "if len(payload) < 5:"),
    "payload_unpack_default": ('struct.unpack_from("<HH", payload, 0)', 'struct.unpack_from("<HH", payload)'),
    "body_le4": ("if len(body) < 4:", "if len(body) <= 4:"),
    "body_lt5": ("if len(body) < 4:", "if len(body) < 5:"),
    "body_unpack_default": ('struct.unpack_from("<HH", body, 0)', 'struct.unpack_from("<HH", body)'),
}

# 🔴 THE TWO `anchors_*` MUTANTS MOVED OUT OF THIS DICT AND INTO `canary()` ON 2026-11-02, because
# the code answered the question for them. `self._anchors.get(handle, [])` used to be an argument to
# `associate`, which reads `not anchors` and so could not tell `[]` from `None`. The series now also
# feeds a list comprehension and `anchor_rx_ns`, and both of those ITERATE it, so each mutant raises
# `TypeError: 'NoneType' object is not iterable` on the first ACL packet of a handle with no anchor
# table. A mutant the tests kill needs no excuse, and the two ledger entries that excused them are
# gone. They stay in this file as canaries the battery MUST see: that way a later change that makes
# the default unread again cannot pass this probe in silence.
MODS = {k: build(k, *v) for k, v in MUTANTS.items()}

PARSE = [k for k in MUTANTS if not k.startswith("anchors")]
ACLK = [k for k in MUTANTS if k.startswith("anchors")]


def pmd_acl(handle, meas, last_ns, n_samples=3, pb=0x02):
    frame = bytes([meas]) + struct.pack("<Q", last_ns) + b"\x00" + b"\x01\x02\x03" * n_samples
    att = bytes([BASE.ATT_HANDLE_VALUE_NOTIFICATION]) + struct.pack("<H", 0x0025) + frame
    l2cap = struct.pack("<HH", len(att), BASE.L2CAP_CID_ATT) + att
    return struct.pack("<HH", (pb << 12) | handle, len(l2cap)) + l2cap


def battery():
    """Every payload the probe runs through the structural parser."""
    # 1 · the whole FOUR-byte space by behaviour class: the decision reads bytes 0..3 only, as
    #     handle (12 bits, unreachable on this path), pb_flag (2 bits) and data_len (16 bits).
    for handle in (0x000, 0x001, 0x07FF, 0x0FFF):
        for pb in (0, 1, 2, 3):
            hf = (pb << 12) | handle
            for dl in range(0x10000):
                yield struct.pack("<HH", hf, dl)
    # 2 · every prefix of a well-formed frame, so both length guards see their boundary from above
    for pb in (0, 1, 2):
        full = pmd_acl(0x0040, 0x00, 819_000_000_000_000, pb=pb)
        for n in range(len(full) + 1):
            yield full[:n]
        for n in range(len(full) + 1):  # and with a data_len that LIES about the body
            yield struct.pack("<HH", (pb << 12) | 0x40, n) + full[4:]
    # 3 · random payloads across the lengths the guards live at
    rnd = random.Random(20260907)
    for n in range(0, 48):
        for _ in range(4000):
            yield bytes(rnd.getrandbits(8) for _ in range(n))
    # 4 · a valid frame whose L2CAP cid, opcode or l2_len is off by one, at full length
    for i, byte in ((4, 0), (5, 0), (6, 0), (6, 0xFF), (7, 0), (8, 0x1A), (8, 0xFF)):
        full = bytearray(pmd_acl(0x0040, 0x00, 819_000_000_000_000))
        full[i] = byte
        yield bytes(full)


def probe_parse():
    n = 0
    bad = {k: 0 for k in PARSE}
    for payload in battery():
        n += 1
        want = BASE.parse_acl_att_notification(payload)
        for k in PARSE:
            if MODS[k].parse_acl_att_notification(payload) != want:
                bad[k] += 1
                if bad[k] == 1:
                    print(
                        "DISTINGUISHED %s: %r → %r vs %r"
                        % (k, payload, MODS[k].parse_acl_att_notification(payload), want)
                    )
    return n, bad


def conn_complete(handle, address):
    """One LE connection complete event, the shape `tests/test_radioclock.py` builds."""
    addr = bytes(int(b, 16) for b in reversed(address.split(":")))
    params = bytes([BASE.LE_CONNECTION_COMPLETE, 0x00]) + struct.pack("<H", handle) + b"\x00"
    params += b"\x00" + addr + b"\x18\x00\x00\x00\x2a\x00\x00"
    return bytes([BASE.HCI_EVT_LE_META, len(params)]) + params


def anchor_event(handle, counter, anchor_us):
    params = bytes([BASE.VS_SUBEVENT_CONN_ANCHOR_POINT_UPDATE]) + struct.pack("<HHQ", handle, counter, anchor_us)
    return bytes([BASE.HCI_EVT_VENDOR, len(params)]) + params


H10 = "E4:22:F1:C2:23:2B"


def acl_rows(mod, anchors, offsets):
    """Every row the collector returns for a battery of ACL packets under one anchor table.

    The offsets are FORCED, because `associate` answers None for any anchor list while the offset is
    unmeasured — so without forcing them the mutated argument could not matter and the probe would
    be vacuous."""
    out = []

    class _Forced(mod.OffsetTracker):
        """The tracker computes its offset from the samples it was given, so the probe cannot assign
        one. It overrides the two properties `_acl` reads and inherits everything the event path
        calls, which keeps the forcing out of the code under probe."""

        @property
        def offset(self):
            return offsets[0]

        @property
        def jitter(self):
            return offsets[1]

    for handle in (0x0040, 0x0041, 0x0FFF):
        c = mod.Collector(1, {H10: "Polar"})
        c.offsets = _Forced(mod.OFFSET_WINDOW)
        c.feed(mod.MONITOR_OPCODE_EVENT, 1, conn_complete(handle, H10), 1)
        for h, lst in anchors.items():
            for counter, us in lst:
                c.feed(mod.MONITOR_OPCODE_EVENT, 1, anchor_event(h, counter, us), (us + 300) * 1000)
        for host_ns in (1_051_300_000, 1_000_000_000, 1_100_000_000, 999, 2_000_000_000):
            out.append(c.feed(mod.MONITOR_OPCODE_ACL_RX, 1, pmd_acl(handle, 0x00, 819_000_000_000_000), host_ns))
        out.append((dict(c.no_device_clock), dict(c.not_a_pmd_frame), c.rows, c.missed_anchors))
    return out


TABLES: tuple[dict[int, list[tuple[int, int]]], ...] = (
    {},
    {0x0040: [(10, 1_000_000), (11, 1_050_000)]},
    {0x0041: [(10, 1_000_000)]},
    {0x0040: [(10, 1_000_000)], 0x0041: [(12, 1_100_000)]},
)
OFFS = ((None, None), (300.0, 100.0), (300.0, None), (None, 100.0), (0.0, 0.0), (-5.0, 1e9), (300.0, 0.0))


def acl_rows_or_raise(mod, anchors, offsets):
    """The rows, or the name of the exception that replaced them.

    A mutant that CRASHES differs from one that answers, and a canary has to be able to say so
    without ending the run. The returned shape can never equal a real row list, so a raise reads as
    a difference and never as agreement."""
    try:
        return acl_rows(mod, anchors, offsets)
    except Exception as exc:  # noqa: BLE001 — any raise is a difference, and its type is the evidence
        return ("RAISED", type(exc).__name__)


def probe_acl():
    n = 0
    bad = {k: 0 for k in ACLK}
    for t in TABLES:
        for o in OFFS:
            n += 1
            want = acl_rows(BASE, t, o)
            for k in ACLK:
                if acl_rows(MODS[k], t, o) != want:
                    bad[k] += 1
                    if bad[k] == 1:
                        print("DISTINGUISHED %s: table=%r offsets=%r" % (k, t, o))
    return n, bad


def canary():
    """FAIL CLOSED: a mutation the battery MUST distinguish. If the battery cannot see this one, it
    is not reaching the parser at all and every equivalence above is vacuous."""
    probes = {
        "cid_ignored": ("if cid != L2CAP_CID_ATT:", "if False:"),
        "opcode_ignored": (
            "if len(att) < 3 or att[0] != ATT_HANDLE_VALUE_NOTIFICATION:",
            "if len(att) < 3:",
        ),
        "continuation_read": ("if pb_flag not in (0x00, 0x02):", "if pb_flag not in (0x00, 0x01, 0x02):"),
    }
    out = {}
    for name, (old, new) in probes.items():
        mod = build(name, old, new)
        seen = 0
        for payload in battery():
            if mod.parse_acl_att_notification(payload) != BASE.parse_acl_att_notification(payload):
                seen += 1
                if seen > 3:
                    break
        out[name] = seen
    # and one for the ACL side: the anchor table ALWAYS empty. If the battery cannot see that, it
    # never reaches the association with anchors to lose.
    mod = build("anchors_ignored", "self._anchors.get(handle, [])", "[]")
    seen = 0
    for t in TABLES:
        for o in OFFS:
            if acl_rows(mod, t, o) != acl_rows(BASE, t, o):
                seen += 1
    out["anchors_ignored"] = seen
    # ...and the two defaults this file once held equivalent. Both now reach an iteration, so each
    # one RAISES rather than answering, which `acl_rows_or_raise` reports as the difference it is.
    for name, new_text in (
        ("anchors_none", "self._anchors.get(handle, None)"),
        ("anchors_default", "self._anchors.get(handle)"),
    ):
        mod = build(name, "self._anchors.get(handle, [])", new_text)
        out[name] = sum(
            1 for t in TABLES for o in OFFS if acl_rows_or_raise(mod, t, o) != acl_rows_or_raise(BASE, t, o)
        )
    return out


# The counts a clean hand run prints, so the canned sample and the selftest cannot drift from the
# battery. Measured 2026-11-02 on `87569847b`: the three parser canaries are capped at 4 by the loop
# that counts them, `anchors_ignored` differs in 11 of the 28 collector runs, and the two defaults
# RAISE in all 28 — a handle with no anchor table appears in every table the probe runs.
CLEAN_CANARIES = {
    "cid_ignored": 2,
    "opcode_ignored": 2,
    "continuation_read": 2,
    "anchors_ignored": 11,
    "anchors_none": 28,
    "anchors_default": 28,
}


def verdict_object(
    canaries: dict[str, int],
    parse_n: int,
    parse_bad: dict[str, int],
    acl_n: int,
    acl_bad: dict[str, int],
) -> dict:
    """PURE over the four counts the run prints, so the prose and the object cannot disagree."""
    blind = sorted(k for k, v in canaries.items() if v == 0)
    seen = {**parse_bad, **acl_bad}
    distinguished = sorted(k for k, v in seen.items() if v)
    declared = len(seen)
    result = {
        "canaries": dict(canaries),
        "parseInputs": parse_n,
        "aclRuns": acl_n,
        "parse": dict(parse_bad),
        "acl": dict(acl_bad),
        "distinguished": distinguished,
    }

    def mk(status: str, population: dict, reason: str | None) -> dict:
        return VD.make(
            gate=VERDICT_GATE,
            status=status,
            population=population,
            criterion=VERDICT_CRITERION,
            result=result,
            evidence=VERDICT_EVIDENCE,
            reason=reason,
            tool="capture-host/tools/probe_radioclock_equiv.py",
        )

    if blind:
        return mk(
            "UNKNOWN",
            {"checked": 0, "eligible": declared, "excluded": declared},
            "the battery never saw %s, a mutation it MUST see, so it reached neither the parser nor the "
            "collector and every equivalence here would be vacuous rather than true" % ", ".join(blind),
        )
    pop = {"checked": declared, "eligible": declared, "excluded": 0}
    if distinguished:
        return mk(
            "FAIL",
            pop,
            "%d of %d declared mutant(s) changed an output — %s. The equivalence entries keyed on them "
            "excuse nothing and the mutation gate owes a test instead"
            % (len(distinguished), declared, ", ".join(distinguished)),
        )
    return mk("PASS", pop, None)


def verdict_sample() -> dict:
    """The object the adoption gate reads (`--verdict-sample`): canned counts, no battery."""
    return verdict_object(
        CLEAN_CANARIES,
        1_240_769,
        dict.fromkeys(PARSE, 0),
        28,
        dict.fromkeys(ACLK, 0),
    )


def selftest() -> int:
    """The decision logic checked WITHOUT the battery, by the flag the adoption gate names.

    It cannot be a pytest test, for the reason `coverage_scope.py` already pins this file on: the
    module rebuilds each mutant from `radioclock.py`'s source at IMPORT, against an anchor it asserts
    occurs exactly once, and under the mutation gate that source on disk is already rewritten. A test
    that imported this module would therefore raise at import under every mutant and report eight
    kills that no test earned. So the three branches are checked here, where nothing imports them
    except a hand run and this flag.
    """
    clean_c = dict(CLEAN_CANARIES)
    clean_p, clean_a = dict.fromkeys(PARSE, 0), dict.fromkeys(ACLK, 0)
    declared = len(PARSE) + len(ACLK)
    bad_p = {**clean_p, "body_le4": 3}
    blind_c = {**clean_c, "anchors_ignored": 0}
    ok = verdict_object(clean_c, 10, clean_p, 4, clean_a)
    bad = verdict_object(clean_c, 10, bad_p, 4, clean_a)
    vac = verdict_object(blind_c, 10, clean_p, 4, clean_a)
    sample = verdict_sample()
    cases = [
        (ok["status"] == "PASS" and ok["reason"] is None, "clean counts state PASS with no reason"),
        (
            ok["population"] == {"checked": declared, "eligible": declared, "excluded": 0},
            "a PASS checked every declared mutant",
        ),
        (
            bad["status"] == "FAIL" and "body_le4" in (bad["reason"] or ""),
            "a distinguished mutant states FAIL and is NAMED",
        ),
        (
            bad["result"]["distinguished"] == ["body_le4"],
            "the distinguished mutant is in the result, not only the prose",
        ),
        (vac["status"] == "UNKNOWN" and vac["population"]["checked"] == 0, "a blind canary examined NOTHING"),
        (
            vac["population"]["excluded"] == declared,
            "a blind canary excludes the WHOLE population — no equivalence here is true, only unexamined",
        ),
        (
            sample["status"] == "PASS" and sample["gate"] == VERDICT_GATE,
            "the sample the gate reads carries this gate's own name",
        ),
        (
            sample["criterion"] == VERDICT_CRITERION,
            "the criterion is the pre-stated constant, not one derived from a run",
        ),
    ]
    bad_cases = [label for held, label in cases if not held]
    for label in bad_cases:
        print("SELFTEST ✗ %s" % label)
    print("SELFTEST=%s (%d/%d)" % ("PASS" if not bad_cases else "FAIL", len(cases) - len(bad_cases), len(cases)))
    return 1 if bad_cases else 0


def only_flag(name: str) -> bool:
    """True when `name` is the whole argument list."""
    return sys.argv[1:] == [name]


if __name__ == "__main__":
    if only_flag("--verdict-sample"):  # the adoption gate's cmd — canned counts, no battery
        print(json.dumps(verdict_sample(), indent=1))
        sys.exit(0)
    if only_flag("--selftest"):  # the decision logic alone — see selftest()'s own docstring
        sys.exit(selftest())
    cn = canary()
    print("CANARIES (each must be > 0):", cn)
    pn, pbad = probe_parse()
    print("PARSE: %d inputs" % pn, "mismatches:", pbad)
    an, abad = probe_acl()
    print("ACL: %d collector runs" % an, "mismatches:", abad)
    # ONE rule decides the word, the object and the exit code: the status the builder stamped.
    obj = verdict_object(cn, pn, pbad, an, abad)
    print("PROBE=%s" % ("EQUIVALENT" if obj["status"] == "PASS" else "DISTINGUISHED-OR-VACUOUS"))
    print(json.dumps(obj))
    sys.exit(0 if obj["status"] == "PASS" else 1)
