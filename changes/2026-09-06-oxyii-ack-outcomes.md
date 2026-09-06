<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Five ack-only O2Ring commands never had their replies read.

`0x10` AUTO_RT_SWITCH, `0xC0` SET_UTC_TIME, `0xF2` READ_FILE_START, `0xF4` READ_FILE_END and `0x01`
SET_CONFIG are all ack-only, and none had a reply parser — so a **rejected** command was
indistinguishable from an accepted one. A ring left on a wrong clock looked exactly like one that took
the update.

The status is the vendor's `pkgType`, which is the `flag` header byte (§2 of O2RING-PROTOCOL, `1` =
success). `decode()` returned only `(op, payload)`, so that byte was destroyed at the decoder and no
caller could see it.

`decode_full()` returns a `Frame(op, flag, seq, payload)` and `decode()` is now a one-line wrapper over
it — one validator, not two, since two drift and a frame one accepts while the other rejects is the
worst outcome available. Existing callers are untouched, per the back-compat rule: new data arrives
through a new method.

`parse_ack(req_op, reply)` returns an **enum, not a boolean**, because five states matter and
collapsing any two loses what a caller needs:

- `NO_REPLY` is not `REJECTED`. For the file path this is the whole point: an `0xF1` reply with an
  empty payload means "no stored files" — a fact about the ring — while no reply means silence, a fact
  about the link. The harvesting state machine must never see them as one value.
- `MISMATCH` is not `OK`. A `flag == 1` on the wrong opcode must not vouch for the command we were
  waiting on.
- `UNKNOWN_STATUS` exists because §2 documents only `1`. Reading "not 1" as "failed" would invent a
  semantics the protocol notes do not support, so the byte is surfaced instead.

Absence is the caller's observation, not the parser's — a parser cannot see a frame that never
arrived, so `reply=None` is passed in by the wait at the call site.

Wired at `ring_config.run_set`, which now reads and reports the SET_CONFIG ack. That **consumes the
same frame the next `ask()` would have drained and discarded**, so the flow is unchanged; the ack was
already being pulled off the queue and thrown away. The read-back remains the verdict — it observes
device state rather than the device's opinion — and no retry or abort is added: that is a behaviour
change owing its own evidence.

⚠️ **Validated against the spec and synthetic frames, not the corpus, and that is measured rather than
assumed.** There are no recorded acks anywhere: `decode()` dropped `flag` before anything could log it,
nothing persists raw device→host frames on the live or pull paths, and `probe_oxyii_opcodes.py --json`
— the one tool that would record them — has no committed output in the repo, in `uploads/`, or under
the corpus root.
