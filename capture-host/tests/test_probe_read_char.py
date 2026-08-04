# tepna-capture — tests/test_probe_read_char.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `probe_pmd_surface._read_char` — CPAP-AUTOHARVEST-FOLLOWUPS-II §2.
#
# Its docstring makes a promise: "A DIS/battery read that reports absence as absence. Every one of these
# is optional on a given firmware, and a missing characteristic must not abort a sweep that has 40 other
# things to collect."
#
# That is a FAIL-OPEN guarantee, and fail-open is the shape that rots silently: if the swallow ever
# narrows — someone replaces `except Exception` with `except BleakError`, or moves the decode outside the
# try — a sweep against unfamiliar firmware stops dead at the first optional characteristic, and the
# symptom is a probe that "found nothing" rather than a crash anyone would chase.
#
# The guarantee sweep (§3) named this as the one function in the family whose promise no test asserted.
# It was skipped on purpose — it is a one-shot BLE developer probe, and the brief routed it to whoever
# landed POLAR-PMD-COMMAND-SURFACE. That brief is now REFERENCE (living), so the routing has passed and
# this is the pickup.
#
# NO HARDWARE. The whole surface is one awaitable, `client.read_gatt_char`, so a fake client covers every
# branch: raising, returning undecodable bytes, and returning ordinary NUL-padded strings.

import asyncio

import pytest

import probe_pmd_surface as P


class FakeClient:
    """Minimal stand-in for a bleak client. `behaviour` maps uuid -> bytes | Exception."""

    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.reads = []

    async def read_gatt_char(self, uuid):
        self.reads.append(uuid)
        v = self.behaviour.get(uuid, b"")
        if isinstance(v, Exception):
            raise v
        return v


def run(coro):
    return asyncio.run(coro)


# ── the promise itself: an absent characteristic is reported, not raised ──────────────────────────
@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("no such characteristic"),
        KeyError("2a29"),
        TimeoutError(),
        OSError(6, "No such device or address"),
    ],
)
def test_a_failing_read_is_absence_not_an_exception(exc):
    c = FakeClient({"u": exc})
    out = run(P._read_char(c, "u"))
    assert out is not None, "a failed read must report absence, not None-by-accident"
    assert "unavailable" in out
    # the exception TYPE is named, so a probe log distinguishes "not present" from "link died"
    assert type(exc).__name__ in out


def test_the_swallow_is_broad_on_purpose():
    """A GATT stack raises whatever it likes. Narrowing this to a bleak-specific error would reintroduce
    the abort the docstring forbids, so a bare custom exception must still be absorbed."""

    class WeirdVendorError(Exception):
        pass

    out = run(P._read_char(FakeClient({"u": WeirdVendorError("nope")}), "u"))
    assert out == "unavailable (WeirdVendorError)"


# ── decoding: text when it decodes, hex when it does not, never a raise ───────────────────────────
def test_decodes_a_normal_string_and_strips_nul_padding():
    assert run(P._read_char(FakeClient({"u": b"Polar Electro Oy\x00\x00"}), "u")) == "Polar Electro Oy"


def test_strips_surrounding_whitespace():
    assert run(P._read_char(FakeClient({"u": b"  1.2.3  "}), "u")) == "1.2.3"


def test_undecodable_bytes_fall_back_to_hex_rather_than_raising():
    raw = b"\xff\xfe\x00\x01"
    assert run(P._read_char(FakeClient({"u": raw}), "u")) == raw.hex()


def test_empty_read_is_an_empty_string_not_an_error():
    assert run(P._read_char(FakeClient({"u": b""}), "u")) == ""


# ── the promise in context: ONE missing characteristic must not cost the other 40 ─────────────────
def test_read_identity_survives_every_characteristic_failing_but_one():
    """The reason the guarantee exists. `read_identity` sweeps six DIS characteristics; five raise. The
    sweep must still return six keys and the one real value — a sweep that aborts on the first optional
    characteristic is the defect this gates."""
    uuids = list(P.DIS.values())
    behaviour = {u: RuntimeError("absent") for u in uuids}
    behaviour[P.DIS["firmware_rev"]] = b"2.1.9\x00"
    behaviour[P.BATTERY] = bytes([77])

    out = run(P.read_identity(FakeClient(behaviour)))

    assert set(out) == set(P.DIS) | {"battery_pct"}, "every field is reported, present or not"
    assert out["firmware_rev"] == "2.1.9", "the one readable characteristic survives its failing siblings"
    assert out["battery_pct"] == 77
    for name in P.DIS:
        if name != "firmware_rev":
            assert "unavailable" in out[name]


def test_read_identity_attempts_every_characteristic_even_after_failures():
    """Not just 'returns a dict' — it must actually still ATTEMPT the later reads. A sweep that returned
    placeholders without trying would pass the assertion above while collecting nothing."""
    behaviour = {u: RuntimeError("absent") for u in P.DIS.values()}
    behaviour[P.BATTERY] = RuntimeError("absent")
    c = FakeClient(behaviour)
    run(P.read_identity(c))
    assert set(c.reads) >= set(P.DIS.values()) | {P.BATTERY}
    assert len(c.reads) == len(P.DIS) + 1


def test_battery_absence_is_also_reported_not_raised():
    behaviour = {u: b"x" for u in P.DIS.values()}
    behaviour[P.BATTERY] = OSError("gone")
    out = run(P.read_identity(FakeClient(behaviour)))
    assert out["battery_pct"] == "unavailable (OSError)"


def test_battery_is_the_first_byte_not_the_whole_payload():
    behaviour = {u: b"x" for u in P.DIS.values()}
    behaviour[P.BATTERY] = bytes([42, 99, 1])
    assert run(P.read_identity(FakeClient(behaviour)))["battery_pct"] == 42
