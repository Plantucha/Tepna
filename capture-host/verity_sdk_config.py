# tepna-capture — verity_sdk_config.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE DECISIONS behind `tools/verity_sdk_trial.py` — one night of Verity Sense SDK mode at 176 Hz PPG.

WHAT THE TRIAL CHANGES. Two keys on the Verity device block of `/opt/tepna/capture-host/config.yaml`:
`sdk_mode` to `true`, and `rates.ppg` to 176. Either one alone does nothing visible. SDK mode only
WIDENS the rate menu to 28/44/55/135/176 Hz, and `ppg: 176` without it falls back to 55 Hz by design
(`polar_pmd.chosen_rate` picks the highest rate the device offers at or under the request). A capture
that silently ran at 55 Hz would read exactly like a 176 Hz night that disproved the hypothesis.

WHY A TEXT EDIT AND NOT A YAML ROUND-TRIP. `config.yaml` carries measured findings in its comments,
and a PyYAML dump drops every one of them. So the edit writes two values in place, and the proof
(`only_two_keys_moved`) parses BOTH versions and restores the two values to show the rest compares
equal. A diff can be read; an equality over the parsed tree cannot be talked around.

WHY THIS FILE IS SEPARATE FROM THE CLI. `tools/` is outside the coverage floor by construction
(`coverage_scope.py`'s header holds the measurement), so the logic that can return a WRONG answer —
which block is the Verity, which keys moved, what the operator is warned about — lives here, inside
the floor, and the argparse/IO/subprocess half lives in `tools/verity_sdk_trial.py` with a pin. Same
split as `blind_spots.py` / `tools/find_blindspots.py`, for the same reason.

REFUSALS ARE AN EXCEPTION, NOT AN EXIT. Every refusal here raises `Refusal`. The CLI turns it into a
`SystemExit`, so a caller that is not a CLI (a test, a future gate) can still read the reason.
"""

from __future__ import annotations

import copy
import difflib
import re
from typing import Any, Callable

WANT_PPG = 176
BAK_TAG = "verity-sdk-trial"
RESTART = "sudo /usr/local/lib/tepna/tepna-restart.sh restart"
SDK_RATES = (28, 44, 55, 135, 176)

_MAC = re.compile(r"([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}")


class Refusal(Exception):
    """The edit cannot be made safely, and the reason says why. Never a partial write."""


def redact(s: str) -> str:
    """No MAC address leaves this script's output."""
    return _MAC.sub("<MAC>", s)


def device_blocks(lines: list[str]) -> list[tuple[int, int, str]]:
    """Every `- name:` item under `devices:`, as (start, end, name). End is exclusive."""
    out: list[tuple[int, int, str]] = []
    in_devices = False
    start = None
    name = ""
    for i, ln in enumerate(lines):
        if re.match(r"^devices:\s*$", ln):
            in_devices = True
            continue
        if in_devices and re.match(r"^[A-Za-z_]", ln):  # a new top-level key ends the list
            if start is not None:
                out.append((start, i, name))
                start = None
            in_devices = False
            continue
        if not in_devices:
            continue
        m = re.match(r"^(\s*)-\s+name:\s*(.+?)\s*$", ln)
        if m:
            if start is not None:
                out.append((start, i, name))
            start, name = i, m.group(2)
    if start is not None:
        out.append((start, len(lines), name))
    return out


def find_verity(lines: list[str]) -> tuple[int, int, str]:
    """The ONE device block whose name holds `verity`. Zero and two are both refusals."""
    hits = [b for b in device_blocks(lines) if "verity" in b[2].lower()]
    if not hits:
        raise Refusal("no device block whose name contains 'Verity'")
    if len(hits) > 1:
        raise Refusal(f"{len(hits)} Verity device blocks — this edit touches exactly one")
    return hits[0]


def key_line(lines: list[str], lo: int, hi: int, key: str) -> int | None:
    """The index of `<key>:` inside [lo, hi), or `None`. The absence is a value here, not a zero."""
    for i in range(lo, hi):
        if re.match(rf"^\s*{re.escape(key)}:\s*(.*)$", lines[i]):
            return i
    return None


def split_comment(text: str) -> tuple[str, str]:
    """The text before an inline comment, and the comment with the whitespace that introduces it.

    `config.yaml` carries measured findings as trailing comments on the very lines this edit rewrites,
    so a value read must not include one and a line rewritten must not drop one. YAML requires
    whitespace before a `#` that opens a comment, which is what this splits on.
    """
    m = re.search(r"\s+#.*$", text)
    if m is None:
        return text, ""
    return text[: m.start()], m.group(0)


def value_of(line: str) -> str:
    """The text after the first colon, with any trailing comment and newline removed."""
    return split_comment(line.split(":", 1)[1].rstrip("\n"))[0].strip()


def comment_of(line: str) -> str:
    """The line's own trailing comment, so a rewritten line carries it forward. Empty when none."""
    return split_comment(line.rstrip("\n"))[1]


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def rates_span(lines: list[str], lo: int, hi: int) -> tuple[int, int] | None:
    """The `rates:` key and the end of its block, or `None` when the key is absent."""
    i = key_line(lines, lo, hi, "rates")
    if i is None:
        return None
    base = indent_of(lines[i])
    j = i + 1
    while j < hi and (not lines[j].strip() or indent_of(lines[j]) > base):
        j += 1
    return i, j


def body_indent_of(lines: list[str], lo: int, hi: int) -> int:
    """The indent the block's own keys sit at, so an inserted key lines up with them."""
    # The regex wants a lowercase key as the first non-space character, so the `- name:` item line
    # cannot match it and needs no second guard.
    for i in range(lo, hi):
        if re.match(r"^\s+[a-z_]+:", lines[i]):
            return indent_of(lines[i])
    raise Refusal("the Verity block has no body keys to match indentation against")


def edit(lines: list[str], ppg: int) -> tuple[list[str], list[str]]:
    """Return (new lines, what changed). Only `sdk_mode` and `rates.ppg` may move."""
    lo, hi, _ = find_verity(lines)
    out = list(lines)
    notes: list[str] = []
    pad = " " * body_indent_of(out, lo, hi)

    sdk_at = key_line(out, lo, hi, "sdk_mode")
    if sdk_at is None:
        # An absent key has no line to overwrite, so it goes after the most specific anchor present.
        # `None` is the absence here and `0` is a real index, so each fallback tests `is None`.
        anchor = key_line(out, lo, hi, "streams")
        if anchor is None:
            anchor = key_line(out, lo, hi, "address")
        if anchor is None:
            anchor = lo
        sdk_at = anchor + 1
        out.insert(sdk_at, f"{pad}sdk_mode: true\n")
        notes.append("sdk_mode: ABSENT -> true (inserted)")
        hi += 1
    elif value_of(out[sdk_at]) == "true":
        notes.append("sdk_mode: already true (unchanged)")
    else:
        notes.append(f"sdk_mode: {value_of(out[sdk_at])} -> true")
        out[sdk_at] = f"{pad}sdk_mode: true{comment_of(out[sdk_at])}\n"

    span = rates_span(out, lo, hi)
    if span is None:
        out.insert(sdk_at + 1, f"{pad}rates:\n")
        out.insert(sdk_at + 2, f"{pad}  ppg: {ppg}\n")
        notes.append(f"rates: ABSENT -> rates.ppg = {ppg} (inserted)")
        return out, notes

    r0, r1 = span
    j = key_line(out, r0 + 1, r1, "ppg")
    if j is None:
        out.insert(r0 + 1, f"{pad}  ppg: {ppg}\n")
        notes.append(f"rates.ppg: ABSENT -> {ppg} (inserted)")
    elif value_of(out[j]) == str(ppg):
        notes.append(f"rates.ppg: already {ppg} (unchanged)")
    else:
        notes.append(f"rates.ppg: {value_of(out[j])} -> {ppg}")
        out[j] = f"{' ' * indent_of(out[j])}ppg: {ppg}{comment_of(out[j])}\n"
    return out, notes


def _verity_devices(doc: Any) -> list[dict]:
    """Every parsed device whose name holds `verity`. A missing `devices:` key is an empty list."""
    devices = (doc or {}).get("devices") or []
    return [d for d in devices if "verity" in str(d.get("name", "")).lower()]


def only_two_keys_moved(before: str, after: str, ppg: int, load: Callable[[str], Any]) -> list[str]:
    """Parse BOTH and prove the diff is exactly `sdk_mode` + `rates.ppg` on the Verity device.

    `load` is the YAML loader the caller supplies, so this module imports no parser. Returns one
    line per problem, and an empty list only when the parsed trees agree everywhere else.
    """
    was, now = load(before), load(after)
    new_devs = _verity_devices(now)
    if len(new_devs) != 1:
        return [f"the written file holds {len(new_devs)} Verity devices"]
    old_devs = _verity_devices(was)
    if not old_devs:
        return ["the file on disk holds no Verity device, so there is nothing to compare against"]

    dev, old = new_devs[0], old_devs[0]
    problems = []
    if dev.get("sdk_mode") is not True:
        problems.append(f"sdk_mode reads {dev.get('sdk_mode')!r}, not True")
    if (dev.get("rates") or {}).get("ppg") != ppg:
        problems.append(f"rates.ppg reads {(dev.get('rates') or {}).get('ppg')!r}, not {ppg}")

    # Put the two values back as they were on disk: everything else must now compare EQUAL.
    probe = copy.deepcopy(now)
    pd = _verity_devices(probe)[0]
    if "sdk_mode" in old:
        pd["sdk_mode"] = old["sdk_mode"]
    else:
        pd.pop("sdk_mode", None)
    old_rates = old.get("rates") or {}
    if not old_rates:
        pd.pop("rates", None)
    elif "ppg" in old_rates:
        pd["rates"]["ppg"] = old_rates["ppg"]
    else:
        pd["rates"].pop("ppg", None)
    if probe != was:
        problems.append("a third value moved — the write changes more than the two keys")
    return problems


def warn_about(lines: list[str]) -> list[str]:
    """What the operator reads before writing. Measured costs first, then the recommendation."""
    lo, hi, _ = find_verity(lines)
    w: list[str] = []
    i = key_line(lines, lo, hi, "streams")
    streams: list[str] = []
    if i is not None:
        streams = re.findall(r"[a-z_]+", value_of(lines[i]))
    silenced = [s for s in streams if s in ("ppi", "hr")]
    if silenced:
        w.append(
            f"SDK mode disables {' + '.join(silenced)} on a Verity. Those streams go silently absent "
            "for the night. The fleet derives Verity HR from raw PPG, so this costs nothing it uses."
        )
    for k in ("gyro", "mag"):
        if k in streams:
            w.append(
                f"`{k}` is in `streams`: DEVICE-RATE-TRUTH §5 decides it off, and it is part of the "
                "98.4 MB of a 254.4 MB night."
            )
    w.append(
        "Battery: 176 Hz measured 8.60 %/h against 4.74, i.e. ~11.6 h of runtime instead of 21.1. "
        "One night per charge instead of two, so charge the armband to full before the trial."
    )
    w.append(
        "The rate is fixed at PMD START, i.e. at connect, and SDK mode does not survive a power "
        f"cycle. So the daemon must restart for the trial to begin: {RESTART}"
    )
    w.append(
        "On the evidence alone the recommendation is 44-55 Hz: rMSSD, per-epoch HR error and PAT "
        "residIQR all read FLAT from 44 Hz up. 176 Hz is an operational call, not a technical result."
    )
    return w


def show_block(lines: list[str]) -> str:
    """The Verity block as it stands, redacted."""
    lo, hi, _ = find_verity(lines)
    return redact("".join(lines[lo:hi]).rstrip())


def config_root(lines: list[str]) -> str:
    """The capture root the config names, or `/` when it names none."""
    i = key_line(lines, 0, len(lines), "root")
    if i is None:
        return "/"
    return value_of(lines[i])


def diff_text(before: list[str], after: list[str]) -> str:
    """The unified diff, redacted. Empty when the two agree."""
    d = difflib.unified_diff(before, after, "config.yaml", "config.yaml (trial)")
    return redact("".join(d).rstrip())
