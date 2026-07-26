<!--
  VIGIL-HARDENING-III-2026-07-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-25 · **Created:** 2026-07-25 · **Method-parent:** `AUDIT-PROMPT.md` · **Siblings:** `VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF.md` (I), `VIGIL-HARDENING-II-2026-07-25-BRIEF.md` (II)

# Vigil hardening pass III — the decode and control surfaces

> **Scope:** out-of-suite (`capture-host/`). No Dex bundle, no `manifestHash`, no provenance impact.
> **Gate:** capture-host pytest **984 green at baseline → 992 after** (+8 net, 0 regressions);
> Node lane 3899 assertions green; `build.mjs --check` clean.
> **Coverage:** closes the four modules passes I and II named as unaudited — `polar_pmd` framing
> internals, `bonding`, `oxyii` decode below the live-frame mapping, and the remaining `webmon`
> endpoints.

---

## 0. The one-paragraph story

One real defect and one latent one. `polar_pmd`'s delta decoder has five guards that abandon a corrupt
frame **part-way**, and `decode_frame` back-times from `last_ns` — the stamp of the frame's **last**
sample, which a truncated frame never decoded. The survivors were therefore stamped as if they were the
frame's tail: measured **96.2 ms late** on a 10-sample ACC frame truncated to 5, scaling with how much
was lost. Right values, fabricated times — the thing the Clock Contract forbids outright, and the third
instance of that same class in three passes. Separately, `_valid_mac` used `.match()` on an anchored
pattern, and Python's `$` also matches *before* a trailing newline, so `AA:BB:CC:DD:EE:FF\n` validated —
not a command injection, but enough to persist an address that can never match a real BLE device again.

---

## 1. A part-decoded PMD delta frame was stamped as the frame's tail — FIXED

### 1.1 Mechanism

`_decode_delta` stops on five conditions — a truncated reference sample, a zero/oversized `deltaSize`,
a zero `count`, a block declaring more bits than remain, and a running sample outside its own ADC range.
All exist because real corruption was observed (0.41 % of MAG rows, 2026-07-18). Each returns the
samples decoded **so far**, i.e. the frame's **first** k of an unknown n.

`decode_frame` then places every sample with `back = n - 1 - i` against `last_ns`, which the PMD header
defines as *the timestamp of the last sample in the frame*. With k < n, sample k−1 is stamped **at**
`last_ns` — a time belonging to a sample that was never decoded — and all k survivors shift late by
`(n − k)` intervals.

### 1.2 Reproduction

A synthetic 10-sample ACC delta frame (reference + one 9-sample block), then the same frame with a
second block whose `deltaSize` is 99 (> `ref_bits` 16, so the guard fires):

```
CLEAN     -> 10 samples; last.sensor_ns == LAST; first at LAST - 9 steps
TRUNCATED ->  5 samples; last surviving sample ALSO stamped at LAST
             but it is really sample #5 of 10  =>  every survivor placed 96.2 ms LATE  (52 Hz)
```

### 1.3 Fix — a truncated frame is a GAP

The frame's true sample count is **not recoverable** once a block header is corrupt, so the survivors
cannot be placed in time at all. `_decode_delta_ex` now reports `(samples, truncated)` and
`decode_frame` **raises** on a truncated frame, which `on_pmd` already catches — recording it in
`last_error` and dropping the frame. That is the established visible channel and yields an honest gap
rather than a skewed timeline. `_decode_delta` remains as a bare-list wrapper, so every known-answer
test on real Verity frames is untouched.

`truncated` is true **only** when samples were decoded *and* the frame ended early: a frame that yields
nothing is already a gap and needs no special handling.

### 1.4 Two tests changed deliberately

`test_decode_delta_stops_on_a_zero_size_block` and `..._on_a_truncated_block` asserted `len(s) == 1` —
"only the reference sample survived". They pinned the **value** protection (no fabricated deltas) while
blessing a **time** fabrication, and in the worst form: a lone surviving reference sample is the frame's
*first*, stamped at the frame's *end*, so the error is a whole frame's span. Both now assert the
decode-level guarantee directly on `_decode_delta_ex` (where it belongs) **and** that `decode_frame`
drops the frame.

---

## 2. `_valid_mac` accepted a trailing newline — FIXED

`_MAC_RE.match(a)` with `^…$`. Python's `$` matches at end-of-string **or just before a trailing
newline**, so `"AA:BB:CC:DD:EE:FF\n"` validated.

**Not a command injection.** The value is f-string-interpolated into a newline-delimited `bluetoothctl`
script (a hazard `webmon.py`'s own header already flags), but `$` permits only a *lone* trailing
newline with nothing after it — `"…\nquit"` and `"…\n\n"` are both correctly rejected — so the worst it
could add was a blank line.

**The real consequence is data loss by silence.** `/api/remember` persists the address to
`config.yaml`, and an address carrying a newline never equals a real BLE address again. That is exactly
the failure `writers.IDENTITY_FIELDS` exists to prevent, in that module's own words: saved to
`config.yaml`, reported "remembered ✓", *and then silently never captured, for the rest of the box's
life*. Now `.fullmatch()`.

---

## 3. Checked and found clean — do NOT re-file

- **`oxyii` frame reassembly.** The classic length-header attack is already handled: `ln > MAX_FRAME_LEN`
  (2048) is treated as loss of sync and resyncs on the next `0xA5` rather than parking the reassembler
  waiting for bytes that never come; a buffer with no lead byte is cleared; the buffer is bounded at
  ~2056 bytes. `decode()` validates magic, the `~cmd` complement, the declared length **and** CRC-8.
- **`webmon` path handling.** `polar_pull` builds an output directory from a user-supplied `session`,
  but `session.strip('/').replace('/', '_')` leaves no separator, so `../..` becomes part of a filename
  and cannot traverse. Verified rather than assumed.
- **`webmon` device endpoints are allowlisted.** `timesync`, `polar_recordings` and `polar_pull` resolve
  the address against `cfg["devices"]` and 400 on an unknown one, so an arbitrary address never reaches
  the BLE layer.
- **`bonding`'s `bluetoothctl` invocation.** `create_subprocess_exec` with no shell, so there is no
  shell-injection surface; the script-injection surface is guarded by §2's validator on all three entry
  points (`/api/bond`, `/api/forget`, `/api/remember`).
- **PMD `axis_scale`.** GYRO 2000 dps / 2¹⁵ and MAG 50 G / 2¹⁵; ACC and ECG deliberately pass through at
  1.0 because Polar already delivers them in physical units. Confirmed against pass II's real-data
  measurements (|acc| 998 mg, MAG sphere radius 0.448 G).
- **`session_restarted`.** Reads `[0:4]` as session duration, not a frame counter — the premise the old
  `frame_gap()` got wrong. Matches the vendor parser and the observed 2736 idle frames reading 0.

---

## 4. What shipped

| file | change |
|---|---|
| `capture-host/polar_pmd.py` | §1 `_decode_delta_ex` reports truncation; `decode_frame` drops such a frame |
| `capture-host/webmon.py` | §2 `_valid_mac` uses `fullmatch` |
| `capture-host/tests/test_pmd_delta.py` | 5 tests incl. the 10→5 truncation repro and the back-compat wrapper |
| `capture-host/tests/test_coverage_small_modules.py` | 2 tests re-pointed at `_decode_delta_ex` + drop assertion |
| `capture-host/tests/test_webmon_api.py` | 3 MAC-validation tests incl. the end-to-end remember refusal |

---

## 5. Residue

1. **Not audited, and now the only untouched surface:** `polar_psftp` (the PS-FTP offline-pull protocol),
   `clockcfg`, `alerts`, `pull_session`, `settings_schema`, `helper_path`, `offline_lock`, `sdnotify`.
   None sit on the live capture path; `polar_psftp` is the largest and the one worth a pass IV.
2. **Three passes, three instances of the same bug class** — fabricated *time* attached to real samples
   (pass I: rectified jitter inflating the O2Ring grid; pass III: truncated PMD frames stamped as their
   own tail). Both were invisible to the existing tests because those tests asserted on *values* and
   *counts*, never on *placement*. A standing check for any future decode work: **assert where a sample
   lands, not just what it contains.**
3. Carried unchanged: the O2Ring link thrashing, the unmounted backup volume (retention is now held and
   visible), and OxyDex discarding a whole row over an unreadable pulse rate.
