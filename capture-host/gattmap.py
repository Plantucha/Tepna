# tepna-capture — gattmap.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Per-UNIT expected GATT attribute table, keyed on the peripheral's Database Hash.

BLE-TRANSPORT-REDESIGN §1.1, ruled BUILD by the owner 2026-09-17, executed per
`GATT-HANDLE-MAP-2026-09-17-BRIEF.md`.

WHAT THIS IS FOR, and it is NOT what §1.1 originally proposed. That section said *"thereafter address
characteristics by handle"*. Measured 2026-09-17 before building: bleak's `read_gatt_char` accepts an
`int` handle, but its first line is `_resolve_characteristic(char_specifier, self.services)` →
`services.get_characteristic(...)`, and `self.services` IS the D-Bus snapshot — it raises
`BleakError("Service Discovery has not been performed yet")` when empty. So addressing by handle routes
through the very mirror this exists to stop trusting, and the parent's §3 refuses the raw-ATT
alternative. Handles are EXPOSED (`capture.py` logs `c.uuid}@{c.handle:#06x}`); that never made them
ADDRESSABLE.

So the map is a COMPLETENESS ORACLE instead, which is what §1.1's done-when actually asked for — *"a
planted mid-publish object tree cannot produce a wrong handle; it produces a refusal"*. Today
`_settle_gatt_chars` waits for TWO hardcoded UUIDs and calls the tree settled when they appear, which
cannot see a tree missing anything else. This states the FULL table observed for a peripheral, so a
partial snapshot is detectable as partial rather than merely lacking two named characteristics.

THE MEASURED PROBLEM IT SERVES (vigil journal, 14 days to 2026-09-17): 109 `no service snapshot`
failures, all on Sep 09 and none since — and **466** `BlueZ had not published` events across Sep 10→17,
EVERY day (10·138·102·39·41·40·79·17). The race did not stop; it stopped failing.

THE RULES, and the rest is bookkeeping:

    AN UNRECORDED TABLE IS `None`. NEVER AN EMPTY DICT.

An empty table asserts *"this peripheral has no characteristics"*, under which EVERY snapshot is
complete — the oracle would answer "fine" for a tree that is still entirely in flight, which is the
exact failure it is built to catch. `record()` therefore REFUSES an empty table rather than storing a
claim nobody made. Same shape as `devcaps.py`'s unmeasured-is-`None` rule, one level over.

    A DIFFERENT DATABASE HASH IS A DIFFERENT TABLE.

The hash is the staleness signal the peripheral itself publishes; when it moves, the stored table
describes an attribute layout that no longer exists. `expected()` returns `None` in that case, which
routes the caller back to discovery. That is §1.1's *"a forced Database-Hash change re-discovers"*.

⚠️ IDENTITY IS THE ADDRESS, never a name or model (standing ruling 2026-08-27). Two units of one model
are two records — and two units can legitimately carry different tables at different firmware levels.

⚠️ A peripheral that publishes NO Database Hash is not a failure and not an error: it is a device this
oracle cannot cover. It records under a `None` hash and `expected()` answers only for `None`, so such a
device is checkable against itself but never against a hash it does not have.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading

_LOCK = threading.RLock()
# ADDR -> {"db_hash": str|None, "chars": {uuid: handle}, "source": str}
_MAPS: dict[str, dict] = {}
_PATH: str | None = None


def _norm(addr) -> str:
    return str(addr).strip().upper()


def _norm_uuid(u) -> str:
    return str(u).strip().lower()


def _norm_hash(h) -> str | None:
    """A Database Hash is compared, never interpreted. `None` stays `None` — see the module note: a
    device without one is coverable against itself, not against a hash it never published."""
    if h is None:
        return None
    if isinstance(h, (bytes, bytearray)):
        return bytes(h).hex()
    s = str(h).strip().lower()
    return s or None


def configure(path: str | None) -> None:
    """Point the record at a file and load what is there. Write-through from then on.

    The daemon restarts on every deploy, so an in-memory-only map would re-discover every device every
    deploy and never accumulate — the same reasoning `devcaps.configure` records."""
    global _PATH
    with _LOCK:
        _PATH = path
        _MAPS.clear()
        if not path or not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                for a, rec in loaded.items():
                    if not isinstance(rec, dict):
                        continue
                    chars = rec.get("chars")
                    if not isinstance(chars, dict) or not chars:
                        continue          # an empty table on disk is the claim this module refuses
                    _MAPS[_norm(a)] = {
                        "db_hash": _norm_hash(rec.get("db_hash")),
                        "chars": {_norm_uuid(u): h for u, h in chars.items()},
                        "source": str(rec.get("source") or "loaded"),
                    }
        except Exception:      # noqa: BLE001 - a corrupt record must not stop a night's capture
            _MAPS.clear()


def _flush() -> None:
    """Atomic write — a half-written map read at the next boot is worse than none."""
    if not _PATH:
        return
    try:
        d = os.path.dirname(_PATH) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".gattmap-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(_MAPS, fh, indent=2, sort_keys=True)
            os.replace(tmp, _PATH)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:    # read-only volume; the original record is intact, which is what matters
                pass
            raise
    except Exception:          # noqa: BLE001 - telemetry must never break capture
        pass


def record(addr, db_hash, chars, *, source: str) -> bool:
    """Store the table OBSERVED on this unit. Returns whether it was stored.

    REFUSES an empty table (see the module note — it would make every snapshot look complete), and says
    so by returning False rather than raising, because this runs beside a live link."""
    try:
        table = {_norm_uuid(u): h for u, h in dict(chars or {}).items()}
    except (TypeError, ValueError):
        return False
    if not table:
        return False
    try:
        with _LOCK:
            _MAPS[_norm(addr)] = {
                "db_hash": _norm_hash(db_hash),
                "chars": table,
                "source": str(source),
            }
            _flush()
        return True
    except Exception:          # noqa: BLE001 - a map note must never end a recording
        return False


def expected(addr, db_hash) -> dict | None:
    """The table recorded for this unit AT THIS Database Hash, or `None`.

    `None` means "do not check" — nobody has recorded one, or the hash moved and the stored table
    describes a layout that no longer exists. Both route the caller back to discovery, which is the
    honest answer in each case. It NEVER returns `{}`."""
    with _LOCK:
        rec = _MAPS.get(_norm(addr))
        if not isinstance(rec, dict):
            return None
        if rec.get("db_hash") != _norm_hash(db_hash):
            return None
        chars = rec.get("chars")
        return dict(chars) if isinstance(chars, dict) and chars else None


def missing(addr, db_hash, observed) -> list | None:
    """Which recorded characteristics are ABSENT from `observed`, or `None` when there is no table.

    ⚠️ `None` and `[]` mean different things and callers must not collapse them: `None` is "no oracle
    for this device" (fall back), `[]` is "the oracle ran and the snapshot is complete". Collapsing
    them reinstates exactly the ambiguity `devcaps` was built to remove one level down."""
    table = expected(addr, db_hash)
    if table is None:
        return None
    try:
        seen = {_norm_uuid(u) for u in observed or ()}
    except TypeError:
        seen = set()
    return sorted(u for u in table if u not in seen)


def snapshot() -> dict:
    """A reportable view, read through `expected` so its rules live in one place."""
    with _LOCK:
        out = {}
        for a, rec in _MAPS.items():
            h = rec.get("db_hash")
            table = expected(a, h) or {}
            out[a] = {"db_hash": h, "chars": len(table), "source": rec.get("source")}
        return out


def reset() -> None:
    """Tests only."""
    global _PATH
    with _LOCK:
        _MAPS.clear()
        _PATH = None
