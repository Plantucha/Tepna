/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · EDF / EDF+ READER  (cpapdex-edf.js)   — SCAFFOLD / STARTING POINT
   ────────────────────────────────────────────────────────────────────────
   The ONE genuinely new capability in the suite: a pure-JS EDF/EDF+ binary
   decoder. Dependency-free, 100% local, no network. Spec: CPAPDEX-BUILD-BRIEF
   §1 (reader) + §2 (clock mapping). Time obeys CLAUDE.md THE CLOCK CONTRACT:
   EDF carries LOCAL civil time with no zone → floating wall-clock `tMs` via
   Date.UTC(...), read back with getUTC*. offsetMin = null (no zone in EDF).

   This file is a faithful scaffold, not a finished node. It:
     • parses the EDF header + per-signal headers (fixed ASCII offsets)
     • decodes int16 samples → physical units per signal
     • parses EDF+ annotation TALs (EVE/CSL) → {onsetSec,durSec,text,class}
     • maps EDF startdate/starttime → floating t0Ms (Clock Contract §3)
     • tolerates numRecords = -1 and a truncated final record (power-loss)
   It deliberately does NOT compute metrics, emit events, or render — those are
   cpapdex-dsp.js / cpapdex-fusion.js / cpapdex-render.js (clone OxyDex).

   Run the self-test:  node cpapdex-edf.js --selftest
   Exposes: window.CpapEdf = { readEDF, parseEdfClock, parseTAL, classifyAnnotation }
   ════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* ── small ASCII helpers over a DataView ──────────────────────────────────── */
function ascii(buf, start, len) {
  var out = '';
  var b = new Uint8Array(buf, start, len);
  for (var i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}
function asciiTrim(buf, start, len) { return ascii(buf, start, len).replace(/\u0000+$/,'').trim(); }
function asciiInt(buf, start, len)  { var s = asciiTrim(buf, start, len); var n = parseInt(s, 10); return isNaN(n) ? null : n; }
function asciiNum(buf, start, len)  { var s = asciiTrim(buf, start, len); var n = parseFloat(s);    return isNaN(n) ? null : n; }

/* ════════════════════════════════════════════════════════════════════════
   CLOCK — EDF startdate/starttime → floating tMs  (Clock Contract §2/§3)
   startdate "dd.mm.yy", starttime "hh.mm.ss". EDF year clipping: yy in 85..99
   ⇒ 19xx, else 20xx. No zone in EDF ⇒ offsetMin = null. NEVER new Date()/now().
   Returns { t0Ms, dateAnchorMs, offsetMin } | null  (null on unparseable header).
   ════════════════════════════════════════════════════════════════════════ */
function parseEdfClock(startdate, starttime) {
  var d = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(startdate || '').trim());
  var t = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(starttime || '').trim());
  if (!d || !t) return null;
  var yy = +d[3], mo = +d[2], dd = +d[1];
  var hh = +t[1], mi = +t[2], ss = +t[3];
  var year = (yy >= 85) ? 1900 + yy : 2000 + yy;        // EDF clipping rule
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  var t0Ms        = Date.UTC(year, mo - 1, dd, hh, mi, ss);  // FLOATING — not a real instant
  var dateAnchorMs = Date.UTC(year, mo - 1, dd);
  return { t0Ms: t0Ms, dateAnchorMs: dateAnchorMs, offsetMin: null };
}

/* Absolute floating tMs of one sample. recDurMs = record duration in ms. */
function sampleTMs(t0Ms, recordIndex, recDurMs, sampleIndex, fs) {
  return t0Ms + recordIndex * recDurMs + sampleIndex * (1000 / fs);
}

/* ════════════════════════════════════════════════════════════════════════
   EDF+ ANNOTATIONS — TAL parsing  (CPAPDEX-BUILD-BRIEF §1)
   A TAL: +<onset>[\x15<duration>]\x14<text>\x14...\x14\x00
     \x14 = 0x14 (field sep / list end), \x15 = 0x15 (onset|duration sep).
   onset/duration are ASCII floats in SECONDS. The first TAL of each record is
   the timekeeping TAL (text empty) — skip empties.
   ════════════════════════════════════════════════════════════════════════ */
function parseTAL(bytes) {
  // bytes: Uint8Array of one annotation signal's record. Returns [{onsetSec,durSec,text}]
  var out = [];
  var i = 0, n = bytes.length;
  while (i < n) {
    if (bytes[i] === 0x00) { i++; continue; }           // padding between TALs
    // onset starts with '+' or '-'
    if (bytes[i] !== 0x2B && bytes[i] !== 0x2D) { i++; continue; }
    var j = i, onset = '', duration = '', text = '', dur = false;
    // read onset (and optional duration after 0x15) until 0x14
    while (j < n && bytes[j] !== 0x14) {
      if (bytes[j] === 0x15) { dur = true; j++; continue; }
      (dur ? (duration += String.fromCharCode(bytes[j])) : (onset += String.fromCharCode(bytes[j])));
      j++;
    }
    j++; // skip the 0x14 that ends onset/duration
    // texts: one or more, each terminated by 0x14; list ends at 0x14 0x00 / 0x00
    while (j < n && bytes[j] !== 0x00) {
      text = '';
      while (j < n && bytes[j] !== 0x14) { text += String.fromCharCode(bytes[j]); j++; }
      j++; // skip 0x14
      var onsetSec = parseFloat(onset);
      if (text.length && !isNaN(onsetSec)) {
        out.push({ onsetSec: onsetSec, durSec: duration ? parseFloat(duration) : 0, text: text });
      }
      if (j < n && bytes[j] === 0x00) break;            // end of this TAL
    }
    i = j + 1;
  }
  return out;
}

/* Map vendor annotation text → canonical class (ResMed AirSense EVE/CSL). */
function classifyAnnotation(text) {
  var s = String(text || '').toLowerCase();
  if (/central\s*ap|^ca\b|\bca$/.test(s))                 return 'Central Apnea';
  if (/obstructive\s*ap|^oa\b|\boa$/.test(s))             return 'Obstructive Apnea';
  if (/mixed\s*ap/.test(s))                               return 'Mixed Apnea';
  if (/hypop|^h$|\bh\b/.test(s))                          return 'Hypopnea';
  if (/rera|effort.?related/.test(s))                     return 'RERA';
  if (/cheyne|csr|\bcsl\b/.test(s))                       return 'Cheyne-Stokes';
  if (/periodic\s*breath|\bpb\b/.test(s))                 return 'PeriodicBreathing';
  if (/^apnea$|^apnoea$/.test(s))                         return 'Apnea';
  return 'Unclassified';
}

/* ════════════════════════════════════════════════════════════════════════
   readEDF(arrayBuffer) → decoded record
   {
     edfPlus, startDate, startTime, clock:{t0Ms,dateAnchorMs,offsetMin},
     numRecords, recDurSec, ns, truncated, recordsRead,
     signals: { <label>: { data:Float32Array, fs, dim, physMin, physMax } },
     annotations: [ { onsetSec, durSec, text, class, tMs } ]
   }
   ════════════════════════════════════════════════════════════════════════ */
function readEDF(arrayBuffer) {
  var buf = arrayBuffer;
  var total = buf.byteLength;
  if (total < 256) throw new Error('EDF too short: ' + total + ' bytes (need ≥256 header)');

  // ── main header (256 bytes) ──
  var version    = asciiTrim(buf, 0, 8);
  var patient    = asciiTrim(buf, 8, 80);
  var recording  = asciiTrim(buf, 88, 80);
  var startdate  = asciiTrim(buf, 168, 8);     // dd.mm.yy
  var starttime  = asciiTrim(buf, 176, 8);     // hh.mm.ss
  var headerBytes = asciiInt(buf, 184, 8);
  var reserved   = asciiTrim(buf, 192, 44);
  var numRecords = asciiInt(buf, 236, 8);      // may be -1
  var recDurSec  = asciiNum(buf, 244, 8);
  var ns         = asciiInt(buf, 252, 4);
  var edfPlus    = /EDF\+/.test(reserved);

  if (!ns || ns < 1) throw new Error('EDF: bad signal count ns=' + ns);
  if (!headerBytes) headerBytes = 256 + ns * 256;

  // ── per-signal headers (ns × 256 bytes, field-major) ──
  var o = 256;
  var labels = [], dims = [], physMin = [], physMax = [], digMin = [], digMax = [], sampPerRec = [];
  function block(width) { var arr = []; for (var s = 0; s < ns; s++) arr.push(asciiTrim(buf, o + s * width, width)); o += ns * width; return arr; }
  function blockNum(width) { var arr = []; for (var s = 0; s < ns; s++) arr.push(asciiNum(buf, o + s * width, width)); o += ns * width; return arr; }
  function blockInt(width) { var arr = []; for (var s = 0; s < ns; s++) arr.push(asciiInt(buf, o + s * width, width)); o += ns * width; return arr; }
  labels    = block(16);
  /* transducer */ o += ns * 80;
  dims      = block(8);
  physMin   = blockNum(8);
  physMax   = blockNum(8);
  digMin    = blockInt(8);
  digMax    = blockInt(8);
  /* prefilter */ o += ns * 80;
  sampPerRec = blockInt(8);
  /* reserved  */ o += ns * 32;

  // ── derive record geometry ──
  var samplesPerRecTotal = sampPerRec.reduce(function (a, b) { return a + (b || 0); }, 0);
  var bytesPerRecord = samplesPerRecTotal * 2;          // int16
  var dataStart = headerBytes;
  if (numRecords == null || numRecords < 0) {           // -1 ⇒ compute from file size
    numRecords = Math.floor((total - dataStart) / bytesPerRecord);
  }
  // truncated final record (power-loss): clamp to whole records actually present
  var maxWhole = Math.floor((total - dataStart) / bytesPerRecord);
  var truncated = maxWhole < numRecords;
  var recordsRead = Math.min(numRecords, maxWhole);

  // ── identify annotation signals (EDF+) ──
  var annIdx = {};
  for (var s = 0; s < ns; s++) if (labels[s] === 'EDF Annotations') annIdx[s] = true;

  // ── allocate per-signal output buffers ──
  var signals = {};
  for (var s2 = 0; s2 < ns; s2++) {
    if (annIdx[s2]) continue;
    var spr = sampPerRec[s2] || 0;
    signals[labels[s2]] = {
      data: new Float32Array(spr * recordsRead),
      fs: recDurSec ? spr / recDurSec : 0,
      dim: dims[s2], physMin: physMin[s2], physMax: physMax[s2], _spr: spr, _w: 0
    };
  }

  // ── decode records ──
  var dv = new DataView(buf);
  var annotations = [];
  var clock = parseEdfClock(startdate, starttime);
  var recDurMs = (recDurSec || 0) * 1000;

  for (var r = 0; r < recordsRead; r++) {
    var p = dataStart + r * bytesPerRecord;
    for (var sg = 0; sg < ns; sg++) {
      var spr2 = sampPerRec[sg] || 0;
      if (annIdx[sg]) {
        var annBytes = new Uint8Array(buf, p, spr2 * 2);
        var tals = parseTAL(annBytes);
        for (var k = 0; k < tals.length; k++) {
          var cls = classifyAnnotation(tals[k].text);
          annotations.push({
            onsetSec: tals[k].onsetSec, durSec: tals[k].durSec, text: tals[k].text,
            class: cls,
            tMs: clock ? clock.t0Ms + tals[k].onsetSec * 1000 : null
          });
        }
        p += spr2 * 2;
        continue;
      }
      // numeric signal — int16 LE → physical scaling
      var sig = signals[labels[sg]];
      var dMin = digMin[sg], dMax = digMax[sg], pMin = physMin[sg], pMax = physMax[sg];
      var scale = (pMax - pMin) / ((dMax - dMin) || 1);
      for (var i2 = 0; i2 < spr2; i2++) {
        var dig = dv.getInt16(p, true); p += 2;
        sig.data[sig._w++] = (dig - dMin) * scale + pMin;
      }
    }
  }

  // drop the timekeeping-only empty annotations already handled (text-empty skipped in parseTAL)
  return {
    version: version, edfPlus: edfPlus, patient: patient, recording: recording,
    startDate: startdate, startTime: starttime, clock: clock,
    numRecords: numRecords, recordsRead: recordsRead, truncated: truncated,
    recDurSec: recDurSec, ns: ns,
    signals: signals, annotations: annotations
  };
}

/* ════════════════════════════════════════════════════════════════════════
   SELF-TEST — builds a synthetic EDF in memory, round-trips it, asserts:
     • clock: floating t0Ms is viewer-timezone-independent (getUTC* readback)
     • sample scaling exact · sample count = spr×records
     • numRecords = -1 recovered from file size
     • truncated final record tolerated (no throw, recordsRead clamped)
     • EDF+ TAL annotation decoded + classified + absolute tMs reconstructed
   ════════════════════════════════════════════════════════════════════════ */
function _buildSyntheticEDF(opts) {
  opts = opts || {};
  var ns = 2;                                   // 1 numeric (Press) + 1 annotation
  var recDur = 1, records = opts.records || 5;
  var spr = 10;                                 // 10 Hz numeric
  var annSpr = 16;                              // bytes/2 for annotation channel
  var headerBytes = 256 + ns * 256;
  var bytesPerRecord = (spr + annSpr) * 2;
  var totalRecords = records;
  var size = headerBytes + bytesPerRecord * totalRecords;   // FULL size; truncate by slicing at the end
  var buf = new ArrayBuffer(size);
  var u8 = new Uint8Array(buf), dv = new DataView(buf);
  function put(str, start, len) { var s = String(str); for (var i = 0; i < len; i++) u8[start + i] = i < s.length ? s.charCodeAt(i) : 0x20; }

  put('0', 0, 8); put('X X X X', 8, 80); put('Startdate', 88, 80);
  put('13.06.26', 168, 8); put('23.14.33', 176, 8);
  put(String(headerBytes), 184, 8);
  put('EDF+C', 192, 44);
  put(opts.numRecordsField != null ? String(opts.numRecordsField) : String(totalRecords), 236, 8);
  put(String(recDur), 244, 8); put(String(ns), 252, 4);

  // signal headers (field-major)
  var o = 256;
  put('Press.40ms', o, 16); put('EDF Annotations', o + 16, 16); o += ns * 16; // labels
  o += ns * 80;                                                                 // transducer
  put('cmH2O', o, 8); put('', o + 8, 8); o += ns * 8;                           // dims
  put('0', o, 8); put('-1', o + 8, 8); o += ns * 8;                             // physMin
  put('25.5', o, 8); put('1', o + 8, 8); o += ns * 8;                           // physMax
  put('0', o, 8); put('-32768', o + 8, 8); o += ns * 8;                         // digMin
  put('255', o, 8); put('32767', o + 8, 8); o += ns * 8;                        // digMax
  o += ns * 80;                                                                  // prefilter
  put(String(spr), o, 8); put(String(annSpr), o + 8, 8); o += ns * 8;           // samp/rec
  o += ns * 32;                                                                  // reserved

  // data: Press digital 0..255 → phys 0..25.5 (scale 0.1); annotation TAL at rec 2
  var p = headerBytes;
  for (var r = 0; r < totalRecords; r++) {
    for (var i = 0; i < spr; i++) { dv.setInt16(p, (r * spr + i) % 256, true); p += 2; }
    // annotation channel: timekeeping TAL "+<rec>\x14\x14\x00", plus a real event on rec 2
    var ab = new Uint8Array(buf, p, annSpr * 2); var w = 0;
    var tk = '+' + r + '\u0014\u0014\u0000';
    for (var c = 0; c < tk.length; c++) ab[w++] = tk.charCodeAt(c);
    if (r === 2) {
      var ev = '+12.5\u00158\u0014Obstructive Apnea\u0014\u0000';
      for (var c2 = 0; c2 < ev.length && w < ab.length; c2++) ab[w++] = ev.charCodeAt(c2);
    }
    p += annSpr * 2;
  }
  return opts.truncateBytes ? buf.slice(0, size - opts.truncateBytes) : buf;
}

function selfTest() {
  var pass = 0, fail = 0, log = [];
  function ok(name, cond, extra) { (cond ? pass++ : fail++); log.push((cond ? '✓ ' : '✗ ') + name + (extra && !cond ? ' — ' + extra : '')); }

  // 1) clock — floating, viewer-tz-independent
  var c = parseEdfClock('13.06.26', '23.14.33');
  ok('clock parses', !!c);
  ok('t0Ms is floating (getUTC* readback == as-written)',
     c && new Date(c.t0Ms).getUTCHours() === 23 && new Date(c.t0Ms).getUTCFullYear() === 2026 && new Date(c.t0Ms).getUTCDate() === 13);
  ok('offsetMin null (EDF has no zone)', c && c.offsetMin === null);
  ok('year clipping (yy=26 ⇒ 2026)', c && new Date(c.t0Ms).getUTCFullYear() === 2026);
  ok('rejects garbage header', parseEdfClock('99.99.99', 'aa.bb.cc') === null);

  // 2) normal decode
  var rec = readEDF(_buildSyntheticEDF({ records: 5 }));
  ok('signal present', !!rec.signals['Press.40ms']);
  ok('sample count = spr×records', rec.signals['Press.40ms'].data.length === 10 * 5);
  ok('fs = spr/recDur', rec.signals['Press.40ms'].fs === 10);
  ok('scaling exact (dig 10 → 1.0 cmH2O)', Math.abs(rec.signals['Press.40ms'].data[10] - 1.0) < 1e-6);

  // 3) annotation decode + class + absolute tMs
  var ev = rec.annotations.filter(function (a) { return a.class !== 'Unclassified'; });
  ok('EVE annotation decoded', ev.length === 1, 'got ' + ev.length);
  ok('annotation classified', ev[0] && ev[0].class === 'Obstructive Apnea');
  ok('annotation absolute tMs = t0Ms + onset', ev[0] && Math.abs(ev[0].tMs - (rec.clock.t0Ms + 12500)) < 1e-6);

  // 4) numRecords = -1 recovered from file size
  var rec2 = readEDF(_buildSyntheticEDF({ records: 5, numRecordsField: -1 }));
  ok('numRecords=-1 recovered', rec2.recordsRead === 5, 'got ' + rec2.recordsRead);

  // 5) truncated final record tolerated
  var rec3 = readEDF(_buildSyntheticEDF({ records: 5, truncateBytes: 12 }));
  ok('truncated record: no throw + flagged', rec3.truncated === true && rec3.recordsRead === 4, 'read ' + rec3.recordsRead);

  return { pass: pass, fail: fail, log: log };
}

/* ── exports + CLI ──────────────────────────────────────────────────────── */
var api = { readEDF: readEDF, parseEdfClock: parseEdfClock, sampleTMs: sampleTMs, parseTAL: parseTAL, classifyAnnotation: classifyAnnotation, _buildSyntheticEDF: _buildSyntheticEDF, selfTest: selfTest };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.CpapEdf = api;

if (typeof process !== 'undefined' && process.argv && process.argv.indexOf('--selftest') !== -1) {
  var r = selfTest();
  r.log.forEach(function (l) { console.log('  ' + l); });
  console.log('\n  EDF reader self-test: ' + r.pass + ' passed, ' + r.fail + ' failed\n');
  if (typeof process.exitCode !== 'undefined') process.exitCode = r.fail ? 1 : 0;
}

})(typeof window !== 'undefined' ? window : null);
