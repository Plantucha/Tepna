<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-08 · **Created:** 2026-08-08

# Harvest of `nglessner/o2ring-s-protocol` into our OxyII implementation

The upstream reference we have cited since `O2RING-PROTOCOL-2026-07-17` (`nglessner/o2ring-s-protocol`)
was read in full — README + `oxyii_protocol.py` + `example_pull.py` + `example_config.py`. This records
what was harvested, what was already ours, what we hold that upstream does not, and what was deliberately
left out.

## 1 · The anchor: their protocol IS ours, proven at the byte level

Their documented GET_INFO frame is `A5 E1 1E 00 02 00 00` + CRC `BF`. Our `encode(0xE1, b"", seq=2)`
produces **`a5e11e00020000bf`** — byte-identical including the CRC. So the CRC-8 (poly 0x07), the frame
envelope, and the auth derivation are the same implementation on both sides, and the rest of their
document applies to our device. This is now a committed known-answer test (`test_crc_fixture_from_upstream_doc`).

## 2 · Harvested — new read-only capability (all pure, all tested)

Added to `capture-host/oxyii.py`, read-only frame builders + parsers:

| opcode | added | value |
|---|---|---|
| `0xE1` GET_INFO | `info_frame` + `parse_get_info` → firmware, serial | firmware string matters — device behaviour is firmware-dependent (the F2 MTU gate differs across 2D010001/2/3), so a capture should record which produced it |
| `0x00` GET_CONFIG | `config_frame` + `parse_config` → 20-field settings struct | read `storage_interval`, alarm thresholds, brightness without the vendor app |
| `0xE4` GET_BATTERY | `battery_frame` + `parse_battery` → {state, level} | byte[1] matches the live header's battery |

### 2.1 · The Format-A session-stats trailer — the highest-value piece

A finalised Format-A OXY recording ends with a 48-byte trailer carrying the ring's **own** session
summary. `parse_oxy_trailer` + `oxy_is_finalized` decode it, and `pull_session.py` now writes it into
each `.meta.json` as `device_summary` (+ a `finalized` flag).

Two payoffs:

1. **An independent cross-check on OxyDex.** The ring computes avg/min SpO₂ and desat counts from the
   same bytes OxyDex does. **Validated against a real `.dat` (`uploads/20260618214109.dat`, 95 161 B):**

   | field | trailer | body-derived | |
   |---|---|---|---|
   | total_seconds | 31701 | 31701 | exact |
   | min_spo2 | 81 | 81 | exact |
   | avg_spo2 | 96 | 96.4 | rounds |
   | avg_hr | 49 | 50.0 | rounds |

   Plus O₂ score 9.4, 17 desats ≥3 %, 12 ≥4 %, 48 s below 90 %, 3 episodes. (The committed CI test uses a
   synthetic trailer — the real `.dat` is corpus, gitignored — but the cross-check above is the evidence
   the offsets are right, and the offsets are mutation-checked.)

2. **A reliable finalisation predicate.** The ring can report a file's full size via `cmd=0xF2` **before**
   the trailer flushes, so size-equality is not "complete". The `48 12 5a da` sub-magic at `trailer[4:8]`
   is. `parse_oxy_trailer` returns `None` on an unfinalised file, so a caller re-pulls rather than trusting
   a half-written summary. This directly strengthens `VIGIL-O2RING-AUTOPULL`.

## 3 · Already ours (confirmed, not duplicated)

Frame codec, CRC-8, `auth_payload`/`derive_session_key`, `0x10` setup, `0xC0` SET_UTC_TIME, the file
transfer (`0xF1`–`0xF4`, `pull_session.py`), Format-A body layout, and the `parse_live` header
(`0x04`: contact/spo2/hr/battery). CCCD `0x0100` is handled in the capture path. **On MTU:** we do NOT force 517 — bleak-on-BlueZ auto-negotiates 247, which upstream confirms is sufficient (the 517 in their examples is a Bumble artifact: Bumble does not auto-negotiate). §6.1 adds a guard for the one risk this leaves.

## 4 · What WE hold that upstream does NOT — a reverse contribution is owed

Upstream lists `0x05` as *"922 bytes, u8 count + 102 × 9-byte records … Purpose unknown"*. We got much
further (this session + #994/#995): it is a **two-channel signed 24-bit optical stream, ~153 Hz, not a
plethysmogram** (proven by a positive control against `0x03`), with the `156` marker mechanism and the
AFE44xx register-format inference. Upstream's issue tracker is the right venue; a PR correcting the `0x05`
entry — offset/count, **signed** fields, and "not a pleth" — is the natural next step, gated on the owner
(publishing is outward-facing; see the standing rule).

Note one tension to resolve before contributing: upstream says each `0x05` record "starts `03 00`", which
does **not** match our little-endian decode (our ch0 low bytes are not `03 00`). Either a firmware-variant
difference or a different record framing — worth checking our raw `0x05` bytes against that claim before
asserting a correction.

## 5 · Deliberately NOT harvested — writes to persistent state

`0x01` SET_CONFIG, `0xE3` FACTORY_RESET, `0xEE` FACTORY_RESET_ALL. The opcode constants are documented in
`oxyii.py` so they are not reused, but **no frame builder ships for any of them** — they modify or destroy
persistent device state, the class this project gates (cf. the Verity trigger writes,
`POLAR-PMD-COMMAND-SURFACE §5`, and the probe allowlists). `0xEE` powers the ring off and needs USB to
wake; the upstream doc marks it "do not issue" and so do we.

The AES-128/ECB path is likewise not implemented: on this firmware `cmd=0xFF` returns no session key, so
the vendor SDK's plaintext fallback is what goes on the wire, and every command we exercise is plaintext.
Documented, not built.

## 6 · MTU — 247 not 517, plus a loud-failure guard

Upstream's most-emphasised gotcha is that a too-small ATT MTU makes `cmd=0xF2` fail **silently** (zero bytes, no error). We don't hit it — BlueZ auto-negotiates 247 and our real `.dat` pulls prove it sufficient — but our `_acquire_mtu()` was *reporting only*. Added a WARN in `pull_session.py` when the acquired MTU is < 200, so a phantom-23 (if BlueZ ever failed to raise it) fails loud and named instead of as a mystery `0xF2` timeout. A warn, not a block: `_acquire_mtu` is best-effort and may leave the placeholder 23, and refusing on that would break a pull BlueZ would otherwise complete.

## 6.1 · The F1 wedge

Upstream documents that after the ring writes its own overnight recording it leaves a file handle open,
and `cmd=0xF1 GET_FILE_LIST` is then silently dropped until an explicit `cmd=0xF4`. `pull_session.py`
already sends `file_end_frame()` in its loop; a follow-up should confirm it sends one **unconditionally
before the first `0xF1`** (the wedge survives reconnect), and the state is observable in `parse_live`'s
header offset [5] (`0x03` = handle open) if a belt-and-braces check is wanted.

## 7 · Verification

capture-host **2933 tests, coverage 100.00 %** statement and branch. Trailer offsets and the sub-magic
mutation-checked (offset shift, sub-magic byte, N/A-score guard, firmware slice — all four killed). Real
`.dat` cross-check byte-exact on total-seconds and min-SpO₂. `docs-ledger` + `release-ledger` green.
