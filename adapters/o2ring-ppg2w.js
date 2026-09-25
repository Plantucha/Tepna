/*
 * adapters/o2ring-ppg2w.js — Tepna vendor adapter: O2Ring RAW DUAL-WAVELENGTH → SignalFrame(spo2)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Wellue / Viatom O2Ring RAW TWO-CHANNEL OPTICAL WAVEFORM (cmd 0x05), captured by
 * the Tepna capture host as `*_PPG2W.txt` (~20 Hz, `channel 0` ≈ IR, `channel 1` ≈ RED).
 *
 * WHY THIS ADAPTER EXISTS — residue `2026-09-25-ppg2w-routes-to-spo2`.
 * `adapters/o2ring-ppg.js`'s header records the §1.4 tie: `oxydex-spo2` matched the
 * vendor token ALONE and claimed the raw waveform at 0.95 alongside the 1 Hz CSV. That
 * was fixed for `_PPG.txt` by declining the suffix there and giving this stream's sibling
 * 0.97 here. `_PPG2W.txt` was left behind, and it is WORSE than the tie it descends from:
 * every `ppg` adapter scores 0 on it (`_PPG\b` / `_PPG\.` do not match `_PPG2W` — a word
 * character follows `PPG`), so `oxydex-spo2` won OUTRIGHT at 0.95 with no runner-up and
 * the router did not even report `ambiguous`. Measured 2026-09-25 by execution.
 *
 * SEVERITY WAS A LOST SIGNAL, NOT A WRONG NUMBER — measured, not assumed.
 * `oxydex-spo2.parse` on a 400-row 20 Hz `_PPG2W.txt` returns
 * `usable:false · "no usable SpO₂ rows parsed (need time + SpO₂ + pulse columns)"`, with the
 * real 1 Hz CSV as the live control (it parsed and refused on its own ≥10 floor). So the
 * hosts failed honestly and the waveform was simply never analyzed — exactly the outcome
 * `o2ring-ppg.js`'s header describes for the pre-§1.4 state, one stream later.
 *
 * NO SECOND PARSER. This REFERENCES `OxyDex.parsePPG2W` and `OxyDex.spo2WaveformTrend`,
 * exactly as `o2ring-ppg.js` references `PpgDex.parsePPG` — one parser, one clock, one
 * set of refusal reasons. A copy here would fork the `_PPG2WRUNS` validity-sidecar
 * handling (SAMPLE-VALIDITY-ENVELOPE §3.2) on the day after it landed.
 *
 * `signalType: 'spo2'` BECAUSE THE HOST IS THE CONSUMER, not because the bytes are SpO₂.
 * `signal-orchestrate.js _HOSTS` maps `spo2 → oxyHost`, and OxyDex is the node that owns
 * `parsePPG2W` — so this is what makes a dropped waveform boot the node that can read it.
 * The FRAME is another matter and is deliberately conservative: the ratio trend is
 * SELF-CALIBRATED against the co-recorded device SpO₂ series, so a waveform ALONE cannot
 * yield an SpO₂ series and this adapter must not pretend otherwise. Without that series it
 * refuses with the trend's OWN reason and reports what it did read (`samplesRead`, span),
 * so a reader can tell "the waveform was read and cannot be calibrated" from "nothing was
 * read at all" — two states §∅ requires be distinguishable.
 *
 * ⚠️ THE UNIFIER CANNOT YET SUPPLY THAT SERIES, AND THAT IS STATED RATHER THAN HIDDEN.
 * `_COMPANION_KINDS` has no `spo2` lane and `data-unifier-app.js` pairs companions only for
 * `ecg`/`ppg`, so in that host this adapter refuses honestly today. Wiring an `_SPO2.csv`
 * companion lane for `spo2` is a separate unit (it touches `streamKind`, `companionKinds`
 * and the host's pairing condition); until it lands, OxyDex's own drop handler remains the
 * only path that produces a trend. Routing to the right node is what this adapter fixes.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Wellue / Viatom';
  var DEVICE = 'O2Ring / O2Ring S / Checkme O2 (raw dual-wavelength, cmd 0x05)';

  /* The vendor mark is the same literal the sibling adapters use; the suffix is this stream's
     own. `_PPG2W` is matched with an EXPLICIT boundary after the `2W` for the reason this whole
     adapter exists: the sibling's `_PPG\b` could not see this file because `\b` does not fire
     between `G` and `2`, so a suffix test here must name the full token rather than a prefix. */
  var O2RING_NAME = /o2ring|wellue|viatom|checkme/i;
  var PPG2W_STREAM = /_PPG2W\b|_PPG2W\./i;

  REG.registerAdapter({
    id: 'o2ring-ppg2w',
    signalType: 'spo2',
    vendor: VENDOR,
    device: DEVICE,
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = (headText || '') + '';
      /* A sidecar is never the waveform (`…_PPG2WRUNS.txt` / `…_PPG2WSEAMS.txt` are derived by
         appending to this very suffix, so they MATCH `PPG2W_STREAM` and must be declined FIRST —
         the same append-defeats-the-boundary trap, now on the other side of it). */
      if (/_PPG2W(RUNS|SEAMS)\b|_PPG2W(RUNS|SEAMS)\./i.test(name)) return 0;
      /* 0.97, the SAME score `o2ring-ppg` uses for this ring's other waveform, and for the same
         reason: it must beat `oxydex-spo2`'s 0.95 vendor-token claim by more than the 0.15
         ambiguity threshold cannot resolve — here it wins outright because that adapter now
         declines this suffix, and the score is kept aligned so the two waveform lanes of one
         device cannot drift into a tie again. */
      if (O2RING_NAME.test(name) && PPG2W_STREAM.test(name)) return 0.97;
      /* HEADER-ONLY, NO NAME MARK: the capture host's own column line is specific enough to
         claim, but only weakly — a re-exported file with a stripped name is the case this covers,
         and it must not outrank a properly named file of another stream. */
      if (/channel\s*0;channel\s*1;motion/i.test(head) && /sensor timestamp \[ns\]/i.test(head)) return 0.6;
      return 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var prov = { adapter: 'o2ring-ppg2w', vendor: VENDOR, device: DEVICE, files: ctx.files || null };
      var oxy = root.OxyDex;
      var parseFn = oxy && typeof oxy.parsePPG2W === 'function' ? oxy.parsePPG2W : null;
      var trendFn = oxy && typeof oxy.spo2WaveformTrend === 'function' ? oxy.spo2WaveformTrend : null;
      if (!parseFn || !trendFn) return root.SignalFrame.toSignalFrame('spo2', { usable: false, reason: 'o2ring-ppg2w: OxyDex not in scope (load oxydex-dsp.js before this adapter)' }, prov);
      /* The `_PPG2WRUNS` validity sidecar rides through when the host paired one — one call, so the
         §3.2 refusal (`blanking-run`) applies here identically to OxyDex's own drop path. */
      var rec = parseFn(text, { runsText: (ctx.companions && ctx.companions.runs) || null });
      if (!rec || !rec.rows.length)
        return root.SignalFrame.toSignalFrame(
          'spo2',
          { usable: false, reason: 'o2ring-ppg2w: no usable dual-wavelength samples parsed (expected the capture host’s `Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion` layout)' },
          prov
        );
      var spo2Rows = ctx.spo2Rows || (ctx.companions && ctx.companions.spo2) || null;
      var res = trendFn(rec, spo2Rows || []);
      var spanS = (rec.rows[rec.rows.length - 1].tMs - rec.rows[0].tMs) / 1000;
      /* WHAT WAS READ travels ON THE REASON, even on a refusal. "the waveform was read and cannot be
         calibrated" and "nothing was read" are different states, and a refusal carrying neither count
         nor span collapses them — §∅ at the report layer, the same denominator rule the sidecar work
         applied to bins. It rides in `reason` rather than a `meta` key BECAUSE `toSignalFrame` has a
         FIXED field set and silently DROPS anything else: the first draft passed `meta` and it arrived
         `null` — the half-wired shape this suite keeps paying for, caught by reading the frame back.
         `reason` is also the field a reader actually sees. */
      var read =
        rec.rows.length +
        ' samples over ' +
        Math.round(spanS * 10) / 10 +
        ' s' +
        (rec.blankSpans.length ? ', ' + rec.blankSpans.length + ' recorded blanking run(s)' : '') +
        (rec.spansUnmapped ? ', ' + rec.spansUnmapped + ' unmapped span(s)' : '');
      if (!res.usable) return root.SignalFrame.toSignalFrame('spo2', { usable: false, reason: 'o2ring-ppg2w: ' + (res.reason || 'the waveform trend is not usable') + ' [read ' + read + ']' }, prov);
      var samples = res.trend.map(function (t) {
        return { tMs: t.tMs, spo2: t.spo2w };
      });
      return root.SignalFrame.toSignalFrame(
        'spo2',
        {
          samples: samples,
          t0Ms: samples.length ? samples[0].tMs : null,
          tsMs: samples.map(function (s) {
            return s.tMs;
          }),
          usable: samples.length >= 10,
          reason: samples.length >= 10 ? null : 'only ' + samples.length + ' calibrated bin' + (samples.length === 1 ? '' : 's') + ' (need ≥10) [read ' + read + ']'
        },
        { adapter: 'o2ring-ppg2w', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: [] }
      );
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
