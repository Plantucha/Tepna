# tepna-capture — tools/probe_radioclock_equiv.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""ARE `radioclock.py`'S EIGHT SURVIVING MUTANTS UNKILLABLE? — the probe behind their
`tools/mutate-equivalence.json` entries.

`tools/probe_equivalence.py` is the general Python prober, and its battery is written for
`polar_pmd.decode_frame`: one frame in, one decode out. These eight survivors sit in a BLE framing
parser and in a collector method, so neither the inputs nor the comparison are that shape. This
module is the battery for them, built the way the sibling is: each mutant is compiled as a real
module from patched source, one battery runs through original and mutant, and every return value is
compared.

🔴 IT FAILS CLOSED. Four canary mutations are run through the same battery, and each MUST be seen. A
battery that cannot distinguish a parser ignoring the L2CAP channel id is not reaching the parser at
all, and every equivalence it reports would be vacuous rather than true — the shape
`tools/probe_equivalence.py` names as the reason its own canaries exist.

Run it from anywhere; it reads the module beside it:

    .venv/bin/python tools/probe_radioclock_equiv.py

Exit 0 means every mutant was indistinguishable AND every canary was seen. Exit 1 means one of those
two failed, and the printed line says which."""

import random
import struct
import sys
import types
from pathlib import Path

CH = Path(__file__).resolve().parent.parent  # capture-host/, whose `radioclock.py` is the subject
sys.path.insert(0, str(CH))
SRC = (CH / "radioclock.py").read_text(encoding="utf-8")


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
    "anchors_none": ("self._anchors.get(handle, [])", "self._anchors.get(handle, None)"),
    "anchors_default": ("self._anchors.get(handle, [])", "self._anchors.get(handle)"),
}
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
    return out


if __name__ == "__main__":
    cn = canary()
    print("CANARIES (each must be > 0):", cn)
    pn, pbad = probe_parse()
    print("PARSE: %d inputs" % pn, "mismatches:", pbad)
    an, abad = probe_acl()
    print("ACL: %d collector runs" % an, "mismatches:", abad)
    ok = all(v > 0 for v in cn.values()) and not any(pbad.values()) and not any(abad.values())
    print("PROBE=%s" % ("EQUIVALENT" if ok else "DISTINGUISHED-OR-VACUOUS"))
    sys.exit(0 if ok else 1)
