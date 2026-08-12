# tepna-capture — tests/wire_replay.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# A CONTROL POINT THAT ANSWERS FROM A RECORDING OF REAL HARDWARE.
#
# ── why this exists ─────────────────────────────────────────────────────────────────────────────────
#
# Every fake in this suite was written by reading the parser it feeds, so each one encodes that
# parser's idea of the wire — including where the parser is WRONG. On 2026-08-11 fixing
# `parse_status_response` (it read a control-point ERROR reply as measurement data) immediately
# exposed THREE fakes emitting a truncated envelope — 3 bytes in one, 4 in two others, where real
# hardware always sends at least 5 — and every one of them had passed for as long as it had existed.
# A fourth, `FlexPolarClient`, did `op, meas = cmd[0], cmd[1]` and IndexErrored on any PARAMETERLESS
# op, which silently made SDK-mode status (0x06) and measurement status (0x05) untestable through the
# fake that every runner test uses.
#
# None of that is catchable by more tests of the same kind: the tests and the code agreed with each
# other and both disagreed with the device. Only going to the SDK source broke the circularity, and
# "fix the parser to match its tests" would have made it worse.
#
# So: a fake that CANNOT invent a frame, because it only ever replays bytes a real device sent.
#
# ── the corpus ──────────────────────────────────────────────────────────────────────────────────────
#
# `tests/wire/*.json` are verbatim `probe_pmd_surface.py --json` transcripts — `{sent, reply}` hex
# pairs, recorded off the two devices this project actually runs:
#
#   verity-sense-INW4J-fw0.1.5.json   36 exchanges   Polar Verity Sense 24:AC:AC:0C:30:1E
#   polar-h10-fw5.0.0.json            12 exchanges   Polar H10 02849638
#
# They are committed, so CI has them without hardware. Re-record with the probe when firmware moves;
# do NOT hand-edit one — a transcript that has been edited is a hand-written fake again, with the
# authority of a recording and none of the truth.

from __future__ import annotations

import glob
import json
import os

WIRE_DIR = os.path.join(os.path.dirname(__file__), "wire")


def load_transcript(name: str) -> dict:
    """One recorded probe run, by filename (without the directory)."""
    with open(os.path.join(WIRE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def all_transcripts() -> list[tuple[str, dict]]:
    """Every recording, as (filename, parsed). Sorted so a failure names the same file every run."""
    out = []
    for p in sorted(glob.glob(os.path.join(WIRE_DIR, "*.json"))):
        with open(p, encoding="utf-8") as fh:
            out.append((os.path.basename(p), json.load(fh)))
    return out


def exchanges(doc: dict) -> list[tuple[bytes, bytes]]:
    """(sent, reply) as bytes. Entries with an empty reply are dropped — they record a command the
    device never answered, which is a real observation but not a replayable answer."""
    out = []
    for t in doc.get("transcript") or []:
        rep = t.get("reply") or ""
        if not rep:
            continue
        out.append((bytes.fromhex(t["sent"]), bytes.fromhex(rep)))
    return out


class UnrecordedCommand(KeyError):
    """A test asked the replay fake something the real device was never asked.

    Raised rather than answered, deliberately. Inventing a plausible reply here would reintroduce the
    entire problem this module exists to remove — the point is that every byte a test sees came off a
    device. If you need this command, record it: run `probe_pmd_surface.py --json` against the
    hardware and commit the transcript."""


class ReplayControlPoint:
    """Answers control-point writes from a recording. Signature-compatible with the `ctrl` callable
    `_enter_sdk_mode` / `_exit_sdk_mode` / `probe_verity_offline._Control.send` take.

    The last recorded reply for a command wins, so a transcript that asked the same thing twice
    (before and after a state change) replays its FINAL state — which is what a test asserting a
    settled device wants. Use `only=` to pin an earlier one."""

    def __init__(self, doc: dict, *, only: dict[bytes, bytes] | None = None):
        self.doc = doc
        self.sent: list[bytes] = []
        self._answers: dict[bytes, bytes] = {}
        for cmd, reply in exchanges(doc):
            self._answers[cmd] = reply
        if only:
            self._answers.update(only)

    def knows(self, cmd: bytes) -> bool:
        return bytes(cmd) in self._answers

    async def __call__(self, cmd: bytes, timeout: float | None = None) -> bytes:
        cmd = bytes(cmd)
        self.sent.append(cmd)
        try:
            return self._answers[cmd]
        except KeyError:
            raise UnrecordedCommand(
                f"the replay corpus has no reply for {cmd.hex()} — the real device was never asked "
                f"this. Record it (probe_pmd_surface.py --json) rather than inventing one; "
                f"recorded: {sorted(c.hex() for c in self._answers)}") from None
