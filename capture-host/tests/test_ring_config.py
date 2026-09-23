# tepna-capture — tests/test_ring_config.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `ring_config` — the gated SET_CONFIG operator tool. The contract under test is the READ-BACK PROOF:
# a write is reported applied only if the expected byte moved to the expected value and nothing else
# moved. The fake ring below is the DEVICE model — it holds a 40-byte config struct and applies each
# whitelisted write at the read-side offset — so the tests exercise the real oxyii encode/decode path
# end to end, including the write-field→read-offset remapping (write 9 → byte 7 for brightness).

import asyncio

import oxyii
import ring_config as rc
from ring_config import judge_write, struct_diff


def _run(coro):
    return asyncio.run(coro)


# write-field index → read-side byte offset, the mapping a REAL ring implements in firmware
_APPLY = {2: 1, 4: 2, 5: 3, 6: 4, 8: 6, 9: 7, 10: 8}


class _Ring:
    """A 40-byte settings struct; GET_CONFIG returns it, SET_CONFIG mutates it (unless `ignores`)."""

    def __init__(self, ignores=False, collateral=None, switch_byte=None):
        self.cfg = bytearray(40)
        self.cfg[1], self.cfg[2], self.cfg[3] = 88, 50, 120
        self.cfg[4], self.cfg[7], self.cfg[8] = 60, 0, 1
        self.ignores = ignores
        self.collateral = collateral          # an extra offset the (buggy) ring also moves
        self.switch_byte = switch_byte        # where a switch write lands (bitfield model)
        self.notify = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        self.notify = cb

    async def write_gatt_char(self, _c, frame, response=False):
        op = frame[1]
        if op == oxyii.OP_GET_CONFIG and self.notify is not None:
            await self.notify(0, oxyii.encode(op, bytes(self.cfg), frame[4]))
        elif op == oxyii.OP_SET_CONFIG and not self.ignores:
            field_idx, value = frame[7], frame[11]
            if field_idx in _APPLY:
                self.cfg[_APPLY[field_idx]] = value
            elif self.switch_byte is not None:
                self.cfg[self.switch_byte] ^= 0x01
            if self.collateral is not None:
                self.cfg[self.collateral] ^= 0xFF


def _install(monkeypatch, ring):
    monkeypatch.setattr(rc, "BleakClient", lambda addr, **kw: ring)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(rc.asyncio, "sleep", no_sleep)


# ── the pure judges ─────────────────────────────────────────────────────────────────────────────────
def test_struct_diff_lists_every_moved_byte():
    assert struct_diff(b"\x00\x01\x02", b"\x00\xff\x02") == [(1, 1, 255)]
    assert struct_diff(b"abc", b"abc") == []


def test_judge_accepts_exactly_the_asked_change():
    before = bytes(40)
    after = bytearray(40)
    after[7] = 2                                        # brightness read-offset
    ok, detail = judge_write("brightness", 2, before, bytes(after))
    assert ok and "byte[7]" in detail


def test_judge_rejects_a_write_that_did_not_land():
    ok, detail = judge_write("brightness", 2, bytes(40), bytes(40))
    assert not ok and "did not land" in detail


def test_judge_rejects_collateral_byte_movement():
    """The whole reason for the full-struct diff: a 'successful' write that ALSO moved another byte is
    not a success — it is an undocumented side effect and must be surfaced, not absorbed."""
    before = bytes(40)
    after = bytearray(40)
    after[7] = 2
    after[13] = 9                                       # collateral
    ok, detail = judge_write("brightness", 2, before, bytes(after))
    assert not ok and "2 bytes moved" in detail


def test_judge_switch_fields_accept_only_alarm_bitfield_bytes():
    before = bytes(40)
    inb = bytearray(40)
    inb[0] = 1                                          # alarm_flags — allowed for a switch
    ok, _ = judge_write("spo2_switch", 1, before, bytes(inb))
    assert ok
    out = bytearray(40)
    out[13] = 1                                         # not an alarm byte
    ok, detail = judge_write("spo2_switch", 1, before, bytes(out))
    assert not ok and "outside" in detail
    ok, detail = judge_write("spo2_switch", 1, before, before)
    assert not ok and "ignored" in detail


# ── end to end against the fake ring ────────────────────────────────────────────────────────────────
def test_set_brightness_round_trips(monkeypatch, capsys):
    ring = _Ring()
    _install(monkeypatch, ring)
    assert _run(rc.run_set("MAC", "brightness", 1)) == 0
    out = capsys.readouterr().out
    assert "✓ brightness = 1" in out
    assert "restore with: --set brightness 0" in out   # the before-value is the undo
    assert ring.cfg[7] == 1


def test_set_motor_round_trips(monkeypatch, capsys):
    ring = _Ring()
    _install(monkeypatch, ring)
    assert _run(rc.run_set("MAC", "motor", 80)) == 0
    assert "restore with: --set motor 60" in capsys.readouterr().out
    assert ring.cfg[4] == 80


def test_a_ring_that_ignores_the_write_exits_nonzero(monkeypatch, capsys):
    _install(monkeypatch, _Ring(ignores=True))
    assert _run(rc.run_set("MAC", "brightness", 1)) == 1
    assert "NOT verified" in capsys.readouterr().out


def test_a_ring_with_a_side_effect_exits_nonzero(monkeypatch, capsys):
    _install(monkeypatch, _Ring(collateral=20))
    assert _run(rc.run_set("MAC", "brightness", 1)) == 1
    assert "NOT verified" in capsys.readouterr().out


def test_a_bad_field_raises_before_any_radio_work(monkeypatch):
    """The ValueError must fire BEFORE connect — a bad request never touches the device."""
    import pytest

    class _Boom:
        def __init__(self, *a, **k):
            raise AssertionError("radio touched")
    monkeypatch.setattr(rc, "BleakClient", _Boom)
    with pytest.raises(ValueError):
        _run(rc.run_set("MAC", "factory_reset", 1))


def test_get_dumps_the_struct(monkeypatch, capsys):
    _install(monkeypatch, _Ring())
    assert _run(rc.run_get("MAC")) == 0
    out = capsys.readouterr().out
    assert "spo2_low" in out and "88" in out and "raw:" in out


def test_get_no_reply_exits_nonzero(monkeypatch, capsys):
    class _Dead(_Ring):
        async def write_gatt_char(self, _c, frame, response=False):
            return None                     # never answers anything
    _install(monkeypatch, _Dead())

    _real_wait_for = asyncio.wait_for

    async def quick(coro, _t):
        return await _real_wait_for(coro, 0.02)
    monkeypatch.setattr(rc.asyncio, "wait_for", quick)
    assert _run(rc.run_get("MAC")) == 1
    assert "NO REPLY" in capsys.readouterr().out


def test_set_refuses_to_write_blind(monkeypatch, capsys):
    """No before-read → no write. Writing blind would make the read-back diff meaningless."""
    class _Deaf(_Ring):
        async def write_gatt_char(self, _c, frame, response=False):
            if frame[1] == oxyii.OP_SET_CONFIG:
                raise AssertionError("wrote despite no before-read")
    _install(monkeypatch, _Deaf(ignores=True))

    _real_wait_for = asyncio.wait_for

    async def quick(coro, _t):
        return await _real_wait_for(coro, 0.02)
    monkeypatch.setattr(rc.asyncio, "wait_for", quick)
    # _Deaf answers nothing (its GET_CONFIG branch is unreachable: parent method overridden entirely)
    assert _run(rc.run_set("MAC", "brightness", 1)) == 1
    assert "refusing to write blind" in capsys.readouterr().out


def test_module_has_a_cli_guard():
    src = open(rc.__file__).read()
    assert 'if __name__ == "__main__":' in src
    assert "require_free_link()" in src


# ── the remaining arcs, each a real behaviour ───────────────────────────────────────────────────────
def test_judge_unparseable_readback_is_a_failure():
    """A truncated after-buffer must fail as 'unparseable', not crash or pass."""
    ok, detail = judge_write("brightness", 2, bytes(40), bytes(10))
    assert not ok and "unparseable" in detail


def test_show_handles_an_unparseable_struct(capsys):
    rc.show(None, None)
    assert "(unparseable)" in capsys.readouterr().out


def test_ask_skips_a_decoy_frame(monkeypatch, capsys):
    """A stray reply for a different opcode must not satisfy the config read."""
    class _Noisy(_Ring):
        async def write_gatt_char(self, _c, frame, response=False):
            if frame[1] == oxyii.OP_GET_CONFIG and self.notify is not None:
                await self.notify(0, oxyii.encode(oxyii.OP_LIVE, b"\x00", frame[4]))   # decoy first
            await super().write_gatt_char(_c, frame, response)
    _install(monkeypatch, _Noisy())
    assert _run(rc.run_get("MAC")) == 0
    assert "spo2_low" in capsys.readouterr().out


def test_after_read_silence_reports_unknown_state(monkeypatch, capsys):
    """The write went out but the read-back never came: the state is UNKNOWN, and saying so (exit 1)
    beats claiming either success or failure."""
    class _DiesAfterWrite(_Ring):
        async def write_gatt_char(self, _c, frame, response=False):
            if frame[1] == oxyii.OP_SET_CONFIG:
                self.replies_left = 0
                return
            if getattr(self, "replies_left", 1) == 0:
                return
            await super().write_gatt_char(_c, frame, response)
    _install(monkeypatch, _DiesAfterWrite())

    _real_wait_for = asyncio.wait_for

    async def quick(coro, _t):
        return await _real_wait_for(coro, 0.02)
    monkeypatch.setattr(rc.asyncio, "wait_for", quick)
    assert _run(rc.run_set("MAC", "brightness", 1)) == 1
    assert "UNKNOWN" in capsys.readouterr().out


def test_switch_field_happy_path_has_no_restore_hint(monkeypatch, capsys):
    """A switch write lands in a bitfield (readback None): verified via the alarm-byte rule, and no
    single restore value can be printed — the operator eyeballs the reported bit change instead."""
    _install(monkeypatch, _Ring(switch_byte=0))
    assert _run(rc.run_set("MAC", "spo2_switch", 1)) == 0
    out = capsys.readouterr().out
    assert "bitfield change" in out
    assert "restore with" not in out


# ── ask_ack: the SET_CONFIG ack is read instead of silently drained ────────────────────────────────
# Residue `2026-09-02-oxyii-acks-unparsed`. `0x01` SET_CONFIG is ack-only and its reply was never read,
# so a REJECTED write looked exactly like an accepted one.


def test_ask_ack_reads_a_success_ack():
    ch = rc.Chan(None)
    ch.q.put_nowait(oxyii.encode(oxyii.OP_SET_CONFIG, b"", flag=1))
    assert _run(ch.ask_ack(oxyii.OP_SET_CONFIG)) is oxyii.AckResult.OK


def test_ask_ack_reads_a_rejection_as_REJECTED_not_as_silence():
    """The distinction the row exists for: a rejected write must not read like an accepted one, and
    must not read like a missing one either."""
    ch = rc.Chan(None)
    ch.q.put_nowait(oxyii.encode(oxyii.OP_SET_CONFIG, b"", flag=0))
    got = _run(ch.ask_ack(oxyii.OP_SET_CONFIG))
    assert got is oxyii.AckResult.REJECTED
    assert got is not oxyii.AckResult.NO_REPLY


def test_ask_ack_times_out_to_NO_REPLY():
    """Absence is observed HERE, at the wait — `parse_ack` cannot see a frame that never arrived. The
    timeout is short so the test costs nothing; the production default is 2 s."""
    ch = rc.Chan(None)
    assert _run(ch.ask_ack(oxyii.OP_SET_CONFIG, timeout=0.01)) is oxyii.AckResult.NO_REPLY


def test_ask_ack_skips_frames_for_other_opcodes_until_its_own():
    """It drains the same frames the following `ask()` would have drained, so the flow is unchanged —
    but it must not mistake another opcode's success for its own."""
    ch = rc.Chan(None)
    ch.q.put_nowait(oxyii.encode(oxyii.OP_GET_CONFIG, b"\x00" * 4, flag=1))
    ch.q.put_nowait(oxyii.encode(oxyii.OP_SET_CONFIG, b"", flag=0))
    assert _run(ch.ask_ack(oxyii.OP_SET_CONFIG, timeout=0.2)) is oxyii.AckResult.REJECTED


def test_ask_ack_ignores_a_corrupt_frame_and_keeps_waiting():
    """A frame failing CRC/magic decodes to None and must not be read as an ack of any kind."""
    ch = rc.Chan(None)
    ch.q.put_nowait(b"\xa5\x01\xfe\x00\x00\x00\x00\x00")  # bad CRC
    ch.q.put_nowait(oxyii.encode(oxyii.OP_SET_CONFIG, b"", flag=1))
    assert _run(ch.ask_ack(oxyii.OP_SET_CONFIG, timeout=0.2)) is oxyii.AckResult.OK
