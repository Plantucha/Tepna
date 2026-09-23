#!/usr/bin/env python3
# tepna-capture — tools/derive_edf_dict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Emit `cpap_edf_dict.py` from a real AirSense 11 SD card. The dictionary's ONLY author.

    python3 tools/derive_edf_dict.py <card_root>                  # report
    python3 tools/derive_edf_dict.py <card_root> --emit PATH      # write the module
    python3 tools/derive_edf_dict.py <card_root> --check PATH     # fail if PATH is stale

🔴 **RAISES on more than one declaration variant per type.** Picking the majority would turn a
conditional layout into a wrong constant, and every test written afterwards would agree with it. If
this exits non-zero the card is saying the layout depends on something — model, mode, firmware — and
that must be understood before anything writes the type. Refusing is the feature.

⚠️ A type's confidence comes from RECORDS, not files. `STR.edf` is ONE rolling file by design, so a
file-count threshold libels the only type that cannot have siblings. `--check` is what keeps the
checked-in module honest: it regenerates and compares, so drift is a test failure rather than a
discovery.

The card is never modified.
"""
from __future__ import annotations

import argparse
import collections
import glob
import os
import sys

MIN_RECORDS_FOR_CONTRACT = 500
MIN_FILES_FOR_CONTRACT = 30


def read_header(path):
    """(header_fields, record_seconds, declaration, n_records) — or (None, None, None, 0)."""
    with open(path, "rb") as f:
        head = f.read(256)
        if len(head) < 256:
            return None, None, None, 0
        try:
            ns = int(head[252:256])
            nrec = int(head[236:244])
        except ValueError:
            return None, None, None, 0
        # ns < 1 is not a signal-less file, it is a malformed one. Without this guard it yields an
        # EMPTY declaration, and two such files would then "agree" on it — the generator would emit
        # a type with no signals and call it a contract. Refuse at the door instead.
        if ns < 1:
            return None, None, None, 0
        g = lambda o, n: head[o:o + n].decode("ascii", "replace").rstrip()
        fields = {"version": g(0, 8), "patient": g(8, 80), "recording": g(88, 80),
                  "header_bytes": g(184, 8), "reserved": g(192, 44)}
        rec = g(244, 8).strip()
        blk = f.read(ns * 256)
    if len(blk) < ns * 256:
        return None, None, None, 0

    def col(off, width):
        base = off * ns
        return [blk[base + i * width:base + (i + 1) * width].decode("ascii", "replace").strip()
                for i in range(ns)]

    decl = tuple(zip(col(0, 16), col(96, 8), col(104, 8), col(112, 8),
                     col(120, 8), col(128, 8), col(216, 8)))
    return fields, rec, decl, nrec


def survey(card_root):
    decls = collections.defaultdict(collections.Counter)
    recs = collections.defaultdict(collections.Counter)
    nrecs = collections.Counter()
    hdr = collections.defaultdict(lambda: collections.defaultdict(set))
    unreadable = collections.Counter()

    paths = sorted(glob.glob(os.path.join(card_root, "DATALOG", "*", "*.edf")))
    root_str = os.path.join(card_root, "STR.edf")
    if os.path.exists(root_str):
        paths.append(root_str)
    if not paths:
        raise SystemExit(f"no EDF files under {card_root!r}")

    for p in paths:
        base = os.path.basename(p)
        kind = "STR" if base == "STR.edf" else base.rsplit("_", 1)[-1][:-4]
        fields, rec, decl, nrec = read_header(p)
        if decl is None:
            unreadable[kind] += 1
            continue
        decls[kind][decl] += 1
        recs[kind][rec] += 1
        nrecs[kind] += nrec
        for k, v in fields.items():
            hdr[kind][k].add(v)

    out, problems = {}, []
    for kind, counter in sorted(decls.items()):
        if len(counter) != 1:
            problems.append(f"{kind}: {len(counter)} declaration sets over {sum(counter.values())} "
                            f"files (sizes {sorted(counter.values(), reverse=True)}) — the layout "
                            f"is conditional; understand it before writing this type")
            continue
        if len(recs[kind]) != 1:
            problems.append(f"{kind}: record duration is not constant: {dict(recs[kind])}")
            continue
        decl, n = counter.most_common(1)[0]
        # Header fields split into "same in every file" and "varies" — never guess at the varying.
        const = {k: next(iter(vs)) for k, vs in hdr[kind].items() if len(vs) == 1}
        varies = {k: len(vs) for k, vs in hdr[kind].items() if len(vs) > 1}
        out[kind] = {"decl": decl, "rec": next(iter(recs[kind])), "files": n,
                     "records": nrecs[kind], "unreadable": unreadable[kind],
                     "header_const": const, "header_varies": varies}
    if problems:
        raise SystemExit("REFUSING to emit a dictionary:\n  " + "\n  ".join(problems))
    return out


def report(found):
    print(f"{'type':<6} {'files':>6} {'records':>9} {'signals':>8} {'rec_s':>10} {'unread':>7}  contract?")
    print("-" * 74)
    for kind, d in found.items():
        strong = d["records"] >= MIN_RECORDS_FOR_CONTRACT or d["files"] >= MIN_FILES_FOR_CONTRACT
        ok = "yes" if strong else f"THIN ({d['files']} files, {d['records']} records)"
        print(f"{kind:<6} {d['files']:>6} {d['records']:>9,} {len(d['decl']):>8} "
              f"{d['rec']:>10} {d['unreadable']:>7}  {ok}")
    print("\nOne declaration set per type is what makes this a table rather than a guess.")
    print("Confidence is counted in RECORDS: STR is one file by design and is not thin for it.")
    for kind, d in found.items():
        if d["header_varies"]:
            print(f"  {kind}: header fields that VARY between files (left out of the table): "
                  + ", ".join(f"{k}×{n}" for k, n in sorted(d["header_varies"].items())))


def render(found, card_root):
    L = ['# GENERATED by tools/derive_edf_dict.py — DO NOT HAND-EDIT.',
         '# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0',
         '"""The AS11 EDF contract, derived from a real card.',
         '',
         'Hand-typing this table would make it a pinned-constant oracle: a wrong value would be',
         'agreed with by every test written against it, and the table would DEFEND the bug instead',
         'of catching it. So it is generated, and `--check` fails when the checked-in copy drifts.',
         '',
         '⚠️ ONE MACHINE. Every row is [HW] for the card it was derived from and UNVERIFIED for any',
         'other model. A type absent here is absent from that card, not from the format.',
         '"""',
         '',
         f'SOURCE_CARD = {os.path.basename(os.path.abspath(card_root))!r}',
         '',
         '# name -> record_seconds, signals, and how much evidence stands behind them.',
         '# signals are (label, unit, phys_min, phys_max, dig_min, dig_max, spr) as ASCII, exactly as',
         '# the card writes them — a float round-trip is where a byte-accurate writer stops being one.',
         'TYPES = {']
    for kind, d in found.items():
        L.append(f'    {kind!r}: {{')
        L.append(f'        "record_seconds": {d["rec"]!r},')
        L.append(f'        "files": {d["files"]}, "records": {d["records"]}, "variants": 1,')
        # no-branch: a type always has at least `version` constant across its own files, so this
        # dict is never empty. Forcing the empty case would need a fixture whose files disagree
        # on EVERY header field, which is not a card — it is two different machines.
        if d["header_const"]:  # pragma: no branch
            L.append(f'        "header_const": {d["header_const"]!r},')
        if d["header_varies"]:
            L.append('        # header fields that differ between files — recorded, never guessed:')
            L.append(f'        "header_varies": {sorted(d["header_varies"])!r},')
        L.append('        "signals": (')
        for row in d["decl"]:
            L.append('            ' + repr(row) + ',')
        L.append('        ),')
        L.append('    },')
    L.append('}')
    L.append('')
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("card_root")
    ap.add_argument("--emit", metavar="PATH")
    ap.add_argument("--check", metavar="PATH")
    a = ap.parse_args()
    found = survey(a.card_root)
    report(found)
    text = render(found, a.card_root)
    if a.emit:
        with open(a.emit, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"\nwrote {a.emit}")
    if a.check:
        cur = open(a.check, encoding="utf-8").read() if os.path.exists(a.check) else ""
        if cur != text:
            print(f"\nSTALE: {a.check} does not match what this card yields. Re-run with --emit.")
            return 1
        print(f"\n{a.check} is current.")
    return 0


if __name__ == "__main__":       # pragma: no cover
    sys.exit(main())

