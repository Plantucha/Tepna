# tepna-capture — devcaps.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Per-UNIT device capability records — BLE-TRANSPORT-REDESIGN §1.3.

"Capability is a per-UNIT runtime fact, discovered and recorded — never asserted per model."

The defect this replaces: the SIG HR parser's docstring read *"Measured 2026-07-19 on an H10 (which
does NOT report contact)"*. One unit, measured once, became a claim about a MODEL — and it was false,
because the H10 on the capture box does report contact. The code was already right (`_has_contact_bit`
is raised from the flags byte per device); the defect lived in the sentence a reader trusts. §1.3's
answer is that no comment should be where the answer lives, so the answer goes here instead.

THE ONE RULE, and everything else is bookkeeping:

    AN UNMEASURED CAPABILITY IS `None`. NEVER `False`.

`False` means "this unit was observed NOT to support it". `None` means "nobody has looked". Collapsing
them is precisely how one unit's measurement became a model's property: a default of `False` is an
assertion about every device that was never probed, and it is indistinguishable from a real negative
at every call site downstream. §1.3's second done-when — "a device whose record is absent is PROBED,
never assumed" — is only expressible if absence has its own value.

⚠️ IDENTITY IS THE ADDRESS, never a name or a model (standing ruling 2026-08-27,
`oxy_presence.is_expected_ring`). Two units of the same model are two records.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading

_LOCK = threading.RLock()
_CAPS: dict[str, dict[str, dict]] = {}     # ADDR -> cap -> {"value": bool, "source": str}
_PATH: str | None = None


def _norm(addr) -> str:
    return str(addr).strip().upper()


def configure(path: str | None) -> None:
    """Point the record at a file and load whatever is already there. Write-through from then on.

    Called once at startup. A record that does not survive a restart is not much of a record — the
    daemon restarts on every deploy (measured 2026-09-15: 4 stop/starts in 6 h), so an in-memory-only
    store would re-probe every device every deploy and never accumulate."""
    global _PATH
    with _LOCK:
        _PATH = path
        _CAPS.clear()
        if not path or not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                for a, caps in loaded.items():
                    if isinstance(caps, dict):
                        _CAPS[_norm(a)] = {k: v for k, v in caps.items() if isinstance(v, dict)}
        except Exception:      # noqa: BLE001 - a corrupt record must not stop a night's capture
            _CAPS.clear()


def _flush() -> None:
    """Atomic write — a half-written record read at the next boot is worse than none."""
    if not _PATH:
        return
    try:
        d = os.path.dirname(_PATH) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".devcaps-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(_CAPS, fh, indent=2, sort_keys=True)
            os.replace(tmp, _PATH)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:    # the tmp file could not be removed (read-only volume); the original
                pass           # record is still intact, which is the property that matters here
            raise
    except Exception:          # noqa: BLE001 - telemetry must never break capture
        pass


def get(addr, cap: str) -> bool | None:
    """The measured capability of THIS unit, or `None` if nobody has measured it.

    ⚠️ CALLERS MUST NOT COERCE. `if devcaps.get(a, "contact_bit"):` silently treats unknown as False
    and reinstates the defect. Test `is None` first and PROBE — that is §1.3's second done-when."""
    with _LOCK:
        rec = _CAPS.get(_norm(addr), {}).get(str(cap))
        return rec.get("value") if isinstance(rec, dict) else None


def source(addr, cap: str) -> str | None:
    """How the value was established. A capability with no provenance is a claim, not a record."""
    with _LOCK:
        rec = _CAPS.get(_norm(addr), {}).get(str(cap))
        return rec.get("source") if isinstance(rec, dict) else None


def record(addr, cap: str, value: bool, *, source: str) -> None:
    """Write what was OBSERVED on this unit. `source` names the observation, never a model."""
    try:
        with _LOCK:
            _CAPS.setdefault(_norm(addr), {})[str(cap)] = {"value": bool(value), "source": str(source)}
            _flush()
    except Exception:          # noqa: BLE001 - a capability note must never end a recording; the
        pass                   # in-memory value still stands, only its persistence was lost


def snapshot() -> dict:
    """A reportable view, read through the accessors so their rules live in one place."""
    with _LOCK:
        return {a: {c: {"value": get(a, c), "source": source(a, c)} for c in caps}
                for a, caps in _CAPS.items()}


def reset() -> None:
    """Tests only."""
    global _PATH
    with _LOCK:
        _CAPS.clear()
        _PATH = None
