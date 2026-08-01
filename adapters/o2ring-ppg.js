/*
 * adapters/o2ring-ppg.js — Tepna vendor adapter: raw FINGER-PPG → SignalFrame(ppg)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Wellue / Viatom O2Ring (O2Ring · O2Ring S · Checkme O2) RAW OPTICAL WAVEFORM,
 * captured by the Tepna capture host as `*_PPG.txt` (~125.7 Hz reflectance pleth).
 *
 * WHY THIS ADAPTER EXISTS — ENGINE-VERIFICATION-FINDINGS §1.4.
 * The O2Ring emits TWO completely different things and the router could not tell
 * them apart:
 *   · `O2Ring S 2100_*.csv`      — 1 Hz SpO2/HR/PI summary rows  → `oxydex-spo2`
 *   · `Wellue_O2Ring-S_*_PPG.txt` — 125.7 Hz optical waveform    → THIS adapter
 * `oxydex-spo2` matched the vendor token alone and claimed BOTH at 0.95, while
 * `polar-sense-ppg` claimed the `_PPG` suffix at 0.85. Gap 0.10 < the 0.15
 * ambiguity threshold (`signal-adapters.js`), so the finger pleth routed as
 * `ambiguous` and **was never analyzed as PPG in either host** — the hosts fail
 * honestly (no fabricated numbers), but the signal was simply lost.
 *
 * §1.4 held this behind two blockers, and (i) must not land without (ii):
 *   (i)  the 0.95/0.85 tie — fixed here;
 *   (ii) PpgDex had no single-channel and no finger-site path, so breaking the tie
 *        would route the file into a DSP with no honest model for it — which is
 *        WORSE than the current honest failure.
 * (ii) is now satisfied: `PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` is DONE
 * (2026-07-20) and verified on real hardware — `parsePPG` derives `site` from the
 * column layout (1 channel or replicated → 'finger'), `detectBeats` has a
 * single-channel lane, and the O2Ring sentinel-gap handling is site-gated. That
 * brief's round-trip: O2Ring→PpgDex median HR 56.3 bpm vs the ring's own 1 Hz
 * field 57.0 vs the paired H10 ECG 56.1, over a 96 s overlap.
 *
 * SITE IS NOT PASSED IN, AND MUST NOT BE. `parsePPG` reads it off the layout — a
 * layout FACT, not an inference (ppgdex-dsp.js: "`site` is a layout fact from the
 * parser, NOT an inference"). Consumers grade morphology by site rather than
 * inheriting the wrist's `emerging` tier, so an adapter that asserted 'finger'
 * from the filename would be manufacturing the very thing the tier depends on.
 *
 * NO SECOND PARSER. This REFERENCES `PpgDex.parsePPG` / `PPGDSP.parsePPG`, exactly
 * as `polar-sense-ppg.js` does. A private copy would drift from the node.
 *
 * Clock Contract: `parsePPG` calls PpgDex's node-local `parseTimestamp` (a
 * deliberate strict ISO/epoch subset — CLAUDE.md §✅). Do not alter it here; any
 * vendor quirk belongs at this ingest boundary, in `parse()` only.
 *
 * Companions: the O2Ring has no ACC/GYRO/MAGN sidecars (its motion column rides
 * the 1 Hz CSV, which is OxyDex's lane), so unlike `polar-sense-ppg` there is no
 * companion-bundle ingest here. `analyzeMotion` degrades to `hasData:false`.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Wellue / Viatom';
  var DEVICE = 'O2Ring / O2Ring S / Checkme O2 (finger pleth)';

  /* The vendor mark and the stream suffix, single-sourced so this adapter and the two it
     disambiguates against cannot drift apart. `oxydex-spo2.js` uses the same suffix test to
     DECLINE a waveform stream, and `polar-sense-ppg.js` uses the same vendor test to decline a
     foreign vendor's `_PPG` — three files, one shared pair of facts. */
  var O2RING_NAME = /o2ring|wellue|viatom|checkme/i;
  var PPG_STREAM = /_PPG\b|_PPG\./i;

  REG.registerAdapter({
    id: 'o2ring-ppg',
    signalType: 'ppg',
    vendor: VENDOR,
    device: DEVICE,
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = (headText || '') + '';
      // Vendor mark AND the raw-waveform stream suffix. 0.97 mirrors polar-sense-ppg's
      // vendor+suffix tier, and clears the 0.15 ambiguity gap against every other candidate
      // once oxydex-spo2 stops claiming waveform streams (§1.4 (i)).
      if (O2RING_NAME.test(name) && PPG_STREAM.test(name)) return 0.97;
      // Header-only fallback: the O2Ring pleth carries a SINGLE reflectance column and, unlike
      // the Polar 3-LED layout, NO ambient column. Deliberately below polar-sense-ppg's 0.8
      // three-channel header rule so a Verity file can never land here on header alone.
      if (/channel\s*0/i.test(head) && !/channel\s*1/i.test(head) && !/ambient/i.test(head) && /(sensor\s*timestamp|phone\s*timestamp)/i.test(head)) return 0.75;
      return 0;
    },

    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var prov = { adapter: 'o2ring-ppg', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: /** @type {string[]} */ ([]) };
      var ppg = root.PpgDex || root.PPGDSP;
      var parseFn = ppg && typeof ppg.parsePPG === 'function' ? ppg.parsePPG : typeof root.PPGDSP !== 'undefined' && typeof root.PPGDSP.parsePPG === 'function' ? root.PPGDSP.parsePPG : null;
      if (!parseFn) return root.SignalFrame.toSignalFrame('ppg', { usable: false, reason: 'o2ring-ppg: PpgDex/PPGDSP not in scope (load ppgdex-dsp.js before this adapter)' }, prov);

      var rec;
      try {
        rec = parseFn(text);
      } catch (e) {
        return root.SignalFrame.toSignalFrame('ppg', { usable: false, reason: 'o2ring-ppg: parse error — ' + ((e && e.message) || e) }, prov);
      }

      if (!rec || !rec.ch || !rec.ch.length || !rec.n || rec.n < 10)
        return root.SignalFrame.toSignalFrame(
          'ppg',
          { usable: false, reason: 'o2ring-ppg: no usable PPG samples parsed (expected an O2Ring `*_PPG.txt` waveform: timestamp columns + a single `channel 0` reflectance column)' },
          prov
        );

      var samples = { ch: rec.ch, amb: rec.amb, relSec: rec.relSec, n: rec.n, durSec: rec.durSec, length: rec.n };
      return root.SignalFrame.toSignalFrame(
        'ppg',
        {
          samples: samples,
          fs: rec.fs,
          t0Ms: rec.t0Ms,
          offsetMin: rec.offsetMin,
          usable: rec.n >= 200,
          reason: rec.n >= 200 ? null : 'only ' + rec.n + ' PPG sample' + (rec.n === 1 ? '' : 's') + ' (need ≥200 for beat detection)'
        },
        prov
      );
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
