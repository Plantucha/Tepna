# tepna-capture — adapter_hci.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A radio that stops answering HCI is REPORTED — residue `2026-09-11-dead-adapter-goes-unnoticed`.

On 2026-09-11 the pinned radio wedged at 19:23 and the box said nothing for nineteen minutes: the kernel
flag still read `UP RUNNING`, the watchdog's first sign came at 19:42, and no artifact — no file, no
status key, no verdict — ever said "this radio did not answer". Detection has since been wired for the
PINNED radio (`capture._adapter_responds`, an HCI_Read_Local_Version_Information round trip every watchdog
poll, feeding `classify_adapter_health`), but its result went into a classifier and a log line and
nowhere a reader could find it, and it was asked of one radio on a box that runs four.

This module is the REPORT half, and only that. The watchdog probes EVERY enumerated radio each poll and
appends one row per radio to `ADAPTERHCI.csv` at the capture root (the `WEDGEFIRE.csv` shape: append-only,
never raises); the nightly QC tick turns the night's rows into one `tepna.verdict/1` object
(`ADAPTERHCI-VERDICT.json`, gate `adapter-hci`) beside the other two. Nothing here resets a radio: the
existing recovery ladder acts on the pinned radio as before, and an automatic reset of any OTHER
production radio is a deploy-grade action for the owner, not a code decision.

THE DETECTION RULE, PRE-STATED (2026-09-22, before the journal was measured):

  · one probe = `capture._adapter_responds(hci)` — the HCI round trip, bounded at 6 s. True answered ·
    False did not (a timeout or a non-zero exit against a named radio) · None undeterminable (no
    `hciconfig`, unparseable output) — None is never a verdict, in either direction.
  · a radio is DEAD FOR A POLL iff its probe is False.
  · the night's verdict, per radio, keys on the LONGEST RUN of consecutive False polls:
      run ≥ 2  → FAIL      (a wedge persists; two polls is two minutes at the default interval, the same
                            hysteresis `grace_checks` gives the recovery ladder)
      run == 1 → SHORTFALL (an isolated miss — the headline held, a named radio missed once; reported,
                            not convicted: one slow poll on a loaded box is not a wedge)
      every determinable probe True → PASS
  · population = radios enumerated during the night (eligible); checked = radios with ≥ 1 determinable
    probe; excluded = radios whose every probe was None. eligible > 0 with checked == 0 → UNKNOWN; no
    rows in the night's window → NOT_RUN (the sidecar predates the night, or the watchdog never ran).

MEASURED AFTER STATING IT (vigil, 2026-09-22, read-only): the rule cannot be evaluated on the journal,
because the probe's per-poll result was never journalled — that absence is the defect this file closes.
The proxies: kernel `tx timeout` / `-110` lines for any hci = 0 in the 5 days the kernel journal
retains (2026-09-17 → 09-22; the 09-11 episode predates it); daemon `watchdog: wedge sign` lines = 55
over 2026-08-10 → 09-15, of which 50 are device-side phantom links and 4 carry `pinned adapter
DOWN/not-found` (09-07 22:17, and 09-11 19:42 · 19:43 · 19:44 — the residue's episode, seen 19 min
late). The rate the rule will report is therefore unmeasured until the sidecar has nights in it.
"""

from __future__ import annotations

import os

import verdict as VD

GATE = "adapter-hci"
CRITERION = {"name": "consecutive_unanswered_polls", "threshold": 1, "unit": "polls", "direction": "lte"}
FILE_NAME = "ADAPTERHCI.csv"
VERDICT_NAME = "ADAPTERHCI-VERDICT.json"
HEADER = "probed_ms;hci;mac;pinned;up;responds;probe_ms"
TOOL = "capture-host/adapter_hci.py"


def _tri(v) -> str:
    return "" if v is None else ("1" if v else "0")


def _untri(s: str):
    return None if s == "" else s == "1"


def row(probed_ms: float, hci: str, mac: str, pinned: bool, up, responds, probe_ms: float) -> str:
    """One CSV row. `up` and `responds` are tri-state and an undeterminable one is written EMPTY, never 0
    (§∅ — absence is not a number)."""
    return ";".join(
        [
            str(int(probed_ms)),
            hci,
            (mac or "").upper(),
            "1" if pinned else "0",
            _tri(up),
            _tri(responds),
            str(int(probe_ms)),
        ]
    )


def parse_row(line: str) -> dict | None:
    """The inverse of `row`; None for the header, a blank, or a malformed line (a torn last line on a
    live file must not take the night's verdict down with it)."""
    parts = line.rstrip("\n").split(";")
    if len(parts) != 7 or parts[0] == "probed_ms":
        return None
    try:
        return {
            "probed_ms": int(parts[0]),
            "hci": parts[1],
            "mac": parts[2].upper(),
            "pinned": parts[3] == "1",
            "up": _untri(parts[4]),
            "responds": _untri(parts[5]),
            "probe_ms": int(parts[6]),
        }
    except ValueError:
        return None


def append_rows(root: str, rows: list[str], log=None) -> bool:
    """Append to `<root>/ADAPTERHCI.csv`, header on first write. NEVER raises — a record about a radio
    must not become a second failure while one is wedged. No root, no journal (a relative path would
    land wherever the daemon runs; `_wedge_fire_record` learned the same)."""
    if not root or not rows:
        return False
    try:
        path = os.path.join(root, FILE_NAME)
        new = not os.path.exists(path)
        with open(path, "a", encoding="utf-8") as fh:
            if new:
                fh.write(HEADER + "\n")
            for r in rows:
                fh.write(r + "\n")
        return True
    except OSError:
        if log is not None:
            log.warning("could not append %s — the probe still happened", FILE_NAME, exc_info=True)
        return False


def read_rows(root: str, start_ms: int, end_ms: int) -> list[dict]:
    """The rows probed within [start_ms, end_ms]; [] when the file is absent."""
    path = os.path.join(root, FILE_NAME)
    if not os.path.isfile(path):
        return []
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            r = parse_row(line)
            if r is not None and start_ms <= r["probed_ms"] <= end_ms:
                out.append(r)
    return out


def _runs(flags: list) -> tuple[int, int, int]:
    """Over a radio's probes in time order: (longest run of False, number of isolated single-False runs,
    total False). None is skipped — an undeterminable probe neither extends nor breaks a run."""
    longest = cur = isolated = total = 0
    for f in [x for x in flags if x is not None]:
        if f is False:
            cur += 1
            total += 1
            longest = max(longest, cur)
        else:
            if cur == 1:
                isolated += 1
            cur = 0
    if cur == 1:
        isolated += 1
    return longest, isolated, total


#: THE SNIFFER'S STATE IS PART OF THIS REPORT — residue `2026-09-25-adapterhci-cannot-express-inert-sniffer`.
#: This verdict enumerated four healthy radios and said PASS while being structurally unable to say that
#: NO radio sniffs. A reader had to open `BLE-SNIFFER-DUTY-CYCLE`'s status line, at its END, to learn that
#: the silence is an owner decision rather than a wedge — and a reversal would have changed nothing here
#: either. So the block below travels with the verdict.
#:
#: WHAT THIS SIDECAR CAN AND CANNOT SEE, because the asymmetry decides the fields. The nRF sniffer image
#: presents no HCI controller, so a radio carrying it is invisible to an HCI probe BY CONSTRUCTION: this
#: file can never count sniffer-capable radios, and a field claiming to would read 0 for "none flashed"
#: and 0 for "cannot see". What it CAN say is the converse — every radio it enumerates that answered a
#: probe runs a firmware that presents an HCI controller, which the sniffer image does not. Both nRF
#: dongles were reflashed to the HCI-UART image on 2026-09-09 (Wren, 2026-09-18, recorded in the brief
#: below), so on this box that converse covers every radio, and a re-flash shows up as a radio LEAVING
#: this enumeration rather than as a changed field.
SNIFF_UNIT = "tepna-sniff.timer"

#: The recorded owner decision, cited rather than restated: `briefs/BLE-SNIFFER-DUTY-CYCLE-2026-09-07-BRIEF.md`
#: status line — *"PARKED ON AN OWNER DECISION — D2, 2026-09-19: leave the sniffer INERT. No re-flash, no
#: retirement; the timer stays installed and disabled and the dongles keep the HCI-UART image."*
SNIFF_DECISION = {"id": "D2", "at": "2026-09-19", "doc": "briefs/BLE-SNIFFER-DUTY-CYCLE-2026-09-07-BRIEF.md"}


def sniffer_block(enabled=None, active=None, radios_on_hci=None) -> dict:
    """The sniffer's state beside the radios' health. PURE.

    THE RULE, PRE-STATED. `enabled` and `active` are the timer's two systemd facts, each True, False or
    None for unread:

      · either True            -> `armed`   (something intends to sniff; D2 says nothing should)
      · both False             -> `inert`   (the decision, holding)
      · otherwise              -> `unknown` + a named reason

    `unknown` is never `inert`. An unread timer and a disabled timer are different facts, and only one of
    them is evidence that the decision holds (CLAUDE.md ABSENCE IS NULL). That is why the reader below
    returns None on failure rather than False, unlike `link_guard.daemon_holds_link`, whose False means
    "proceed" rather than "disabled"."""
    if enabled is True or active is True:
        state, why = "armed", None
    elif enabled is False and active is False:
        state, why = "inert", None
    else:
        state = "unknown"
        why = (
            f"the timer's state was not read (enabled={enabled!r}, active={active!r}) — an unread timer "
            f"is not a disabled one, so this says nothing about whether {SNIFF_DECISION['id']} still holds"
        )
    return {
        "unit": SNIFF_UNIT,
        "state": state,
        "enabled": enabled,
        "active": active,
        "radios_on_hci": radios_on_hci,
        "decision": dict(SNIFF_DECISION),
        "why": why,
    }


def sniffer_timer(unit: str = SNIFF_UNIT, run=None) -> tuple:
    """`(enabled, active)` for the sniffer timer, each True, False or None for unread. NOT pure.

    None on any failure — no systemd, no such unit, a timeout, a non-zero exit that is not one of
    systemd's own answers. `is-enabled` exits non-zero for `disabled`, so the exit code is never the
    answer here; the word on stdout is."""
    import subprocess

    runner = run or (lambda argv: subprocess.run(argv, capture_output=True, text=True, timeout=10))
    # Tri-state per verb, and the annotation says so: True, False, or None for a word this function
    # could not read. A `list[bool]` would be the hint's plausible completion and the wrong type.
    out: list[bool | None] = []
    for verb, words in (("is-enabled", ("enabled", "disabled")), ("is-active", ("active", "inactive"))):
        try:
            said = runner(["systemctl", verb, unit]).stdout.strip()
        except Exception:  # noqa: BLE001 — no systemd / not on the box / a timeout
            out.append(None)
            continue
        out.append(True if said == words[0] else (False if said == words[1] else None))
    return (out[0], out[1])


def verdict_object(
    rows: list[dict], *, night: str = "<night>", root: str = "<root>", sniff_enabled=None, sniff_active=None
) -> dict:
    """The pre-stated rule over the night's rows, and the sniffer's state beside it. PURE.

    The sniffer block rides in `result` and NEVER moves `status`: the radios' health is what this gate
    decides, and an inert sniffer is a recorded decision rather than a defect. A night with no rows stays
    NOT_RUN with no `result` at all, so the block appears only where there was something to report."""
    ev = [TOOL, os.path.join(root, FILE_NAME), night]
    by_mac: dict[str, list[dict]] = {}
    for r in sorted(rows, key=lambda r: r["probed_ms"]):
        by_mac.setdefault(r["mac"], []).append(r)
    if not by_mac:
        return VD.make(
            gate=GATE,
            status="NOT_RUN",
            population={"checked": 0, "eligible": 0, "excluded": 0},
            criterion=CRITERION,
            result=None,
            evidence=ev,
            tool=TOOL,
            reason=f"no HCI probe rows fall in the night's window ({FILE_NAME} absent, or the watchdog did not run)",
        )
    per: dict[str, dict] = {}
    for mac, rs in by_mac.items():
        flags = [r["responds"] for r in rs]
        longest, isolated, total = _runs(flags)
        det = [r for r in rs if r["responds"] is not None]
        unanswered = [r for r in rs if r["responds"] is False]
        per[mac] = {
            "hci": rs[-1]["hci"],
            "pinned": any(r["pinned"] for r in rs),
            "polls": len(rs),
            "determinable": len(det),
            "unanswered": total,
            "longest_run": longest,
            "isolated_misses": isolated,
            "first_unanswered_ms": unanswered[0]["probed_ms"] if unanswered else None,
            "last_unanswered_ms": unanswered[-1]["probed_ms"] if unanswered else None,
        }
    checked = sum(1 for p in per.values() if p["determinable"] > 0)
    pop = {"checked": checked, "eligible": len(per), "excluded": len(per) - checked}
    # Radios that ANSWERED at least once, not radios with a determinable probe: an all-False radio is
    # determinable and answered nothing, so counting it here would claim an HCI image it never showed.
    answered = sum(1 for p in per.values() if p["determinable"] > p["unanswered"])
    result = {
        "radios": per,
        "polls": len(rows),
        "sniffer": sniffer_block(sniff_enabled, sniff_active, radios_on_hci=answered),
    }
    if checked == 0:
        return VD.make(
            gate=GATE,
            status="UNKNOWN",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=ev,
            tool=TOOL,
            reason=f"{len(per)} radio(s) probed {len(rows)} time(s) and no probe was determinable — "
            "hciconfig absent or unparseable all night",
        )
    dead = {m: p for m, p in per.items() if p["longest_run"] >= 2}
    missed = {m: p for m, p in per.items() if p["longest_run"] == 1}

    def _name(m, p):
        return f"{p['hci']} {m}{' (pinned)' if p['pinned'] else ''}"

    if dead:
        return VD.make(
            gate=GATE,
            status="FAIL",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=ev,
            tool=TOOL,
            reason="; ".join(
                f"{_name(m, p)}: {p['unanswered']} of {p['determinable']} polls unanswered, "
                f"longest run {p['longest_run']}, first at {p['first_unanswered_ms']} ms, last at "
                f"{p['last_unanswered_ms']} ms"
                for m, p in dead.items()
            ),
        )
    if missed:
        return VD.make(
            gate=GATE,
            status="SHORTFALL",
            population=pop,
            criterion=CRITERION,
            result=result,
            evidence=ev,
            tool=TOOL,
            reason="; ".join(
                f"{_name(m, p)}: {p['isolated_misses']} isolated unanswered poll(s) of {p['determinable']}"
                for m, p in missed.items()
            ),
        )
    return VD.make(
        gate=GATE,
        status="PASS",
        population=pop,
        criterion=CRITERION,
        result=result,
        evidence=ev,
        tool=TOOL,
        reason=None,
    )


def verdict_sample() -> dict:
    """The object the adoption gate reads: a synthetic night on which one radio missed once."""
    rows = [
        parse_row(row(1_700_000_000_000 + i * 60_000, "hci0", "00:01:95:CC:53:02", True, True, i != 7, 12))
        for i in range(10)
    ]
    rows += [
        parse_row(row(1_700_000_000_000 + i * 60_000, "hci1", "28:0C:50:0C:18:FD", False, True, True, 9))
        for i in range(10)
    ]
    return verdict_object([r for r in rows if r], night="<synthetic>", root="<synthetic>")


if __name__ == "__main__":
    import json
    import sys

    if sys.argv[1:] == ["--verdict-sample"]:
        print(json.dumps(verdict_sample(), indent=1))
        sys.exit(0)
    sys.exit(
        "adapter_hci: a library — the watchdog writes the rows, nightqc writes the verdict; --verdict-sample prints a sample"
    )
