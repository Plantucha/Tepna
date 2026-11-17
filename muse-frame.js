/*
 * muse-frame.js — the Muse S Athena wire frame: one tokenizer for every node
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * A PORT, NOT A DESIGN. Every rule here is read from `capture-host/muse_athena.py`
 * (Finch's clean-room tokeniser, measured against the probe of 2026-11-14 and
 * recorded in `briefs/MUSE-ATHENA-PROTOCOL-2026-11-14-BRIEF.md`). This file invents
 * no layout, names no tag the Python does not name, and keeps the Python's refusal
 * vocabulary word for word, so the two decoders can be held against one fixture.
 *
 * EEGDex and PpgDex both read the same `<base>_RAW.txt`: EEGDex takes the 0x12
 * records, PpgDex the 0x36 ones. That is why the frame layer lives here and not in
 * either node — one file, one set of constants, one bit reader.
 *
 * §∅ THROUGHOUT: a refused packet yields NOTHING, never a partial record list and
 * never a zero-filled one. An absent device clock and an absent packet counter are
 * `null`, because `0` is in band for both. A counter gap is reported as a COUNT OF
 * LOST PACKETS, and the samples behind it are the caller's absence to place.
 *
 * DOM-free; loadable in node:vm.
 */
(function (global) {
  'use strict';

  /* The notification frame (brief §2.1): `[length u8][packet counter u8][7 bytes]`.
     The seven header bytes are kept verbatim and NOT interpreted — the probe did not
     resolve them, and a guessed field is a fabricated reading. */
  var HEADER_LEN = 9;
  /* Each record: `[tag u8][record index u8][device tick, 24-bit little-endian]`. */
  var RECORD_HEAD = 5;

  var TAG_EEG = 0x12,
    TAG_OPTICS = 0x36,
    TAG_MOTION = 0x47,
    TAG_53 = 0x53, // meaning unresolved
    TAG_BATTERY = 0x88, // battery in the first two data bytes; the other 18 unresolved
    TAG_11 = 0x11, // layout INFERRED from the size only: kept raw
    TAG_34 = 0x34, // layout INFERRED from the size only: kept raw
    TAG_35 = 0x35; // layout INFERRED from the size only: kept raw

  /* Whole record size per tag, head included. Solved from the capture: with these five
     sizes all 58 075 packets of the evidence capture tokenise to their last byte (brief
     §2.2); the last three came from single-record packets of the preset probe (§6.7). */
  var RECORD_SIZE = {};
  RECORD_SIZE[TAG_EEG] = 33;
  RECORD_SIZE[TAG_OPTICS] = 45;
  RECORD_SIZE[TAG_MOTION] = 41;
  RECORD_SIZE[TAG_53] = 29;
  RECORD_SIZE[TAG_BATTERY] = 25;
  RECORD_SIZE[TAG_11] = 33;
  RECORD_SIZE[TAG_34] = 35;
  RECORD_SIZE[TAG_35] = 45;

  var TICK_HZ = 10000000; // device ticks per second (brief §2.4)
  var NS_PER_TICK = 1000000000 / TICK_HZ; // 100 ns per tick
  /* The device clock folds every 2^28 ns (0.268 s), which is 2 684 354.56 ticks: no integer tick
     count. Measured on one 632 s session, 2779 EEG folds: 1567 imply 2 684 355 ticks and 1212 imply
     2 684 354 (share 0.564, the fraction of 2^28/100). In ns the modulus is an exact integer, so
     the unwrap runs in ns. The Python twin is `muse_athena.WRAP_NS`. */
  var WRAP_NS = 268435456;

  var EEG_FIELDS = 16, // 14-bit, LSB-first: 2 samples x 8 channels, sample after sample (§6.5)
    EEG_WIDTH = 14,
    EEG_CHANNELS = 8,
    EEG_SAMPLES = 2;
  /* The four electrodes pinned by the owner's events in the worn capture (§6.5). Channels
     4-7 are NOT identified, so they keep their wire number and no name. */
  var EEG_ELECTRODES = ['left-ear', 'left-forehead', 'right-forehead', 'right-ear'];
  var OPTICS_CHANNELS = 16, // 20-bit, LSB-first, one sample per record
    OPTICS_WIDTH = 20;
  var MOTION_CHANNELS = 6, // int16 little-endian, sample-major
    MOTION_SAMPLES = 3;

  /* ── THE BIT READER ───────────────────────────────────────────────────────────────
     The Python reads `int.from_bytes(data, 'little')` and shifts a 224-bit integer. A
     JS `Number` holds 53 bits and `>>` truncates to 32, so a literal transcription
     would silently return garbage for every field past the fourth. BigInt would be
     exact and allocates one heap integer per record, at 128 records a second.

     So this reads the SAME bits without ever forming the whole integer: field `j` of a
     little-endian integer occupies bits `[j*width, (j+1)*width)`, and bit `k` of that
     integer is bit `k & 7` of byte `k >> 3`. Accumulating low bit first gives the
     Python's value exactly, for any width, with no big number anywhere.

     Trailing bits are DROPPED, as the Python drops them: the field count is the floor
     of `bytes * 8 / width`. */
  function unpackLsb(bytes, width, signed) {
    /* A width over 53 cannot be held exactly by a double, and this returns `null` rather
       than a rounded field. That is a DELIBERATE divergence from the Python, which is
       exact at any width: the three widths this format uses are 14, 16 and 20, so the
       refusal is unreachable through `eegFields`, `optics` and `motion`, and it only
       binds a caller that asks for something a JS number cannot answer. */
    if (!bytes || !(width > 0) || width > 53) return null;
    var n = Math.floor((bytes.length * 8) / width),
      out = new Array(n),
      span = Math.pow(2, width),
      half = span / 2,
      j,
      b,
      k,
      v;
    for (j = 0; j < n; j++) {
      v = 0;
      for (b = 0; b < width; b++) {
        k = j * width + b;
        /* `Math.pow`, not `1 << b`: the two agree only while `b` stays under 31, and the
           sign test below is the same trap. Measured 2026-11-15 against the Python at
           widths 32, 40 and 53 — a shift gave -1 for an all-ones 32-bit field. */
        if ((bytes[k >> 3] >> (k & 7)) & 1) v += Math.pow(2, b);
      }
      out[j] = signed && v >= half ? v - span : v;
    }
    return out;
  }

  /* ── THE FRAME ────────────────────────────────────────────────────────────────────
     Records from `off` to the end of the packet, or a refusal reason. Recursion, not a
     hand-advanced index: a packet holds at most nine records, so the stack is bounded,
     and a wrong size cannot loop. (The capture-host mutation gate TIMES OUT on a
     hand-advanced `while` index rather than failing — CLAUDE.md §🧪 — and the Python
     this ports from gives the same reason for its own recursion.) */
  function records(pkt, off) {
    if (off === pkt.length) return { recs: [], why: null };
    var size = RECORD_SIZE[pkt[off]];
    if (size === undefined) return { recs: [], why: 'unknown-tag' };
    if (off + size > pkt.length) return { recs: [], why: 'truncated-record' };
    var rest = records(pkt, off + size);
    if (rest.why !== null) return { recs: [], why: rest.why };
    var rec = {
      tag: pkt[off],
      index: pkt[off + 1], // per-tag counter, +1 modulo 256 between records of this tag
      tick: pkt[off + 2] | (pkt[off + 3] << 8) | (pkt[off + 4] << 16), // 24-bit LE
      data: pkt.slice(off + RECORD_HEAD, off + size)
    };
    return { recs: [rec].concat(rest.recs), why: null };
  }

  /* One notification → `{ packet, reason: null }`, or `{ packet: null, reason }`. A
     refused packet yields nothing: the five reasons are the Python's own words. */
  function tokenise(pkt) {
    if (!pkt || pkt.length < HEADER_LEN) return { packet: null, reason: 'short' };
    if (pkt[0] !== pkt.length) return { packet: null, reason: 'length-byte' };
    var r = records(pkt, HEADER_LEN);
    if (r.why !== null) return { packet: null, reason: r.why };
    if (!r.recs.length) return { packet: null, reason: 'no-record' };
    return {
      packet: { counter: pkt[1], header: pkt.slice(2, HEADER_LEN), records: r.recs },
      reason: null
    };
  }

  /* The packet counter of a notification whose frame header holds, or `null`. It reads
     the HEADER ONLY, so a packet that `tokenise` refuses for a record fault still keeps
     its place in the counter sequence. A short packet or a wrong length byte has no
     trusted header, and gives `null` rather than a guess. */
  function frameCounter(pkt) {
    if (!pkt || pkt.length < HEADER_LEN || pkt[0] !== pkt.length) return null;
    return pkt[1];
  }

  /* Packets (or records of one tag) lost between two consecutive 8-bit counters. The
     counter is modulo 256, so A LOSS OF EXACTLY 256 READS AS 0 and a repeated counter
     reads as 255. That is the Python's caveat verbatim and it is NOT improved here: the
     caller pairs this with the device tick when the stream has one. `null` for `prev` is
     the start of a chain, which is 0 lost, never an unknown count. */
  function lostBetween(prev, cur) {
    if (prev == null) return 0;
    return (((cur - prev - 1) % 256) + 256) % 256;
  }

  /* Device time from one tick to a later one, in seconds, across at most one 2^28 ns fold. */
  function tickSeconds(prev, cur) {
    return (((((cur - prev) * NS_PER_TICK) % WRAP_NS) + WRAP_NS) % WRAP_NS) / 1e9;
  }

  /* The device tick unwrapped into a running device time in NANOSECONDS. The tick field folds at
     2^28 ns, so the clock works in ns, where the modulus is an exact integer. Each step is read as a
     SIGNED step of less than half the modulus (0.134 s), so a record a little older than the last
     read steps back a little and never forward by a whole fold. A packet can carry a tick one fold
     above the modulus, and the signed step absorbs it. A real silence longer than 0.134 s ALIASES by
     a multiple of 0.268 s — the host stamp beside each row carries the true gap, which is why a node
     reads the rate from `DexClock.hostAxis` and not from this counter. */
  function TickClock() {
    this.nsNow = null;
  }
  /* The unwrapped device time of `tick` in ns, exact to within the 100 ns of one tick. */
  TickClock.prototype.feed = function (tick) {
    var v = tick * NS_PER_TICK;
    if (this.nsNow == null) this.nsNow = v;
    else {
      var step = (((v - this.nsNow) % WRAP_NS) + WRAP_NS) % WRAP_NS;
      if (2 * step >= WRAP_NS) step -= WRAP_NS; // half a fold or more forward reads as a step back
      this.nsNow += step;
    }
    return this.nsNow;
  };
  /* The same read as `feed`, under the name the Python recorder calls. */
  TickClock.prototype.ns = function (tick) {
    return this.feed(tick);
  };

  /* ── THE FIELDS ───────────────────────────────────────────────────────────────────
     Each reader checks the tag AND the data length, and returns `null` on either
     mismatch: a record of the right tag and the wrong size is not a short sample, it is
     a record this code does not understand. */
  function dataLen(tag) {
    return RECORD_SIZE[tag] - RECORD_HEAD;
  }

  /* The 16 raw 14-bit fields of an EEG record, in WIRE ORDER. Not channels. */
  function eegFields(rec) {
    if (!rec || rec.tag !== TAG_EEG || rec.data.length !== dataLen(TAG_EEG)) return null;
    return unpackLsb(rec.data, EEG_WIDTH, false).slice(0, EEG_FIELDS);
  }

  /* The two samples of eight channels in one EEG record, sample after sample (§6.5).
     Channels 0-3 are `EEG_ELECTRODES`; 4-7 are unidentified. Raw 14-bit counts: THE
     SCALE IS NOT MEASURED, so nothing here converts them to volts. */
  function eegSamples(rec) {
    var f = eegFields(rec);
    if (f === null) return null;
    var out = [],
      s;
    for (s = 0; s < EEG_SAMPLES; s++) out.push(f.slice(s * EEG_CHANNELS, (s + 1) * EEG_CHANNELS));
    return out;
  }

  /* The 16 raw 20-bit optical values of one sample, in wire order. */
  function optics(rec) {
    if (!rec || rec.tag !== TAG_OPTICS || rec.data.length !== dataLen(TAG_OPTICS)) return null;
    return unpackLsb(rec.data, OPTICS_WIDTH, false).slice(0, OPTICS_CHANNELS);
  }

  /* Three samples of six signed 16-bit values each, in wire order (sample after sample). */
  function motion(rec) {
    if (!rec || rec.tag !== TAG_MOTION || rec.data.length !== dataLen(TAG_MOTION)) return null;
    var v = unpackLsb(rec.data, 16, true),
      out = [],
      s;
    for (s = 0; s < MOTION_SAMPLES; s++) out.push(v.slice(s * MOTION_CHANNELS, (s + 1) * MOTION_CHANNELS));
    return out;
  }

  /* Battery percent from a 0x88 record: the first two data bytes, little-endian, over
     256. Held against the device's own `bp` reply in 18 presets, largest difference 0.09
     points (brief §6.4). */
  function batteryPct(rec) {
    if (!rec || rec.tag !== TAG_BATTERY || rec.data.length !== dataLen(TAG_BATTERY)) return null;
    return (rec.data[0] | (rec.data[1] << 8)) / 256;
  }

  /* ── THE CAPTURED FILE ────────────────────────────────────────────────────────────
     `writers.StreamWriter.write_muse` writes one row per notification:

         `<host stamp>;<device ns>;<packet counter>;<payload length>;<payload hex>`

     The host stamp is local civil time to the millisecond, zone-free, and THIS FILE
     DOES NOT PARSE IT: the Clock Contract has one parser, so the row carries the stamp
     out as text and the node delegates to `DexClock.parseTimestamp`. The device-ns and
     counter columns are written EMPTY when absent, never as `0`, so an empty column
     becomes `null` here and the caller sees the absence it was given. */
  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2) return null;
    var n = hex.length / 2,
      out = new Array(n),
      i,
      v;
    for (i = 0; i < n; i++) {
      v = parseInt(hex.substr(i * 2, 2), 16);
      if (!isFinite(v)) return null;
      out[i] = v;
    }
    return out;
  }

  function parseRawRow(line) {
    var c = String(line).split(';');
    if (c.length !== 5) return { row: null, reason: 'column-count' };
    var bytes = hexToBytes(c[4].trim());
    if (bytes === null) return { row: null, reason: 'payload-not-hex' };
    var declared = c[3].trim() === '' ? null : Number(c[3]);
    /* The length column is written from the payload the recorder held, so a disagreement
       is a damaged row and not a short packet. It refuses rather than trusting one side. */
    if (declared !== null && declared !== bytes.length) return { row: null, reason: 'length-column' };
    return {
      row: {
        hostRaw: c[0].trim(), // text for `DexClock.parseTimestamp`; never parsed here
        devNs: c[1].trim() === '' ? null : Number(c[1]), // absence written as absence
        counter: c[2].trim() === '' ? null : Number(c[2]), // null breaks the counter chain
        bytes: bytes
      },
      reason: null
    };
  }

  /* Every row of a `<base>_RAW.txt`, with the refused ones counted BY REASON rather than
     dropped quietly. A blank line is not a row and is not a fault. */
  function parseRawRows(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/),
      rows = [],
      refused = {},
      i,
      r;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      r = parseRawRow(lines[i]);
      if (r.row === null) refused[r.reason] = (refused[r.reason] || 0) + 1;
      else rows.push(r.row);
    }
    return { rows: rows, refused: refused };
  }

  global.MuseFrame = {
    HEADER_LEN: HEADER_LEN,
    RECORD_HEAD: RECORD_HEAD,
    RECORD_SIZE: RECORD_SIZE,
    TAG_EEG: TAG_EEG,
    TAG_OPTICS: TAG_OPTICS,
    TAG_MOTION: TAG_MOTION,
    TAG_BATTERY: TAG_BATTERY,
    TICK_HZ: TICK_HZ,
    NS_PER_TICK: NS_PER_TICK,
    WRAP_NS: WRAP_NS,
    EEG_WIDTH: EEG_WIDTH,
    EEG_CHANNELS: EEG_CHANNELS,
    EEG_SAMPLES: EEG_SAMPLES,
    EEG_ELECTRODES: EEG_ELECTRODES,
    OPTICS_CHANNELS: OPTICS_CHANNELS,
    OPTICS_WIDTH: OPTICS_WIDTH,
    MOTION_CHANNELS: MOTION_CHANNELS,
    MOTION_SAMPLES: MOTION_SAMPLES,
    unpackLsb: unpackLsb,
    tokenise: tokenise,
    frameCounter: frameCounter,
    lostBetween: lostBetween,
    tickSeconds: tickSeconds,
    TickClock: TickClock,
    eegFields: eegFields,
    eegSamples: eegSamples,
    optics: optics,
    motion: motion,
    batteryPct: batteryPct,
    hexToBytes: hexToBytes,
    parseRawRow: parseRawRow,
    parseRawRows: parseRawRows
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
