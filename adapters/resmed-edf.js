/*
 * adapters/resmed-edf.js — Tepna vendor adapter: ResMed SD-card EDF set → SignalFrame(cpap)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * Device / capture: ResMed AirSense-class PAP device, SD card. The card is a day-foldered tree
 * (`YYYYMMDD/`), each night holding several per-stream EDF+ files named
 * `YYYYMMDD_HHMMSS_<TYPE>.edf` — BRP (25 Hz flow waveform), PLD (low-rate pressure/leak/
 * ventilation), EVE (scored respiratory events), CSL (Cheyne–Stokes / periodic-breathing spans),
 * SA2 (oximetry, when an oximeter is attached — usually it is not).
 *
 * Wraps the existing pure parsers BY REFERENCE, never copies them: `CpapEdf.readEDF` (bytes →
 * decoded EDF) and the `CPAPDex` namespace (`chan`). No re-implemented EDF reader lives here.
 *
 * ── Why this adapter is shaped differently from its 8 siblings ──────────────────────────────
 * Every other adapter is `parse(text, ctx)` over a TEXT stream. EDF is BINARY and MULTI-FILE, so
 * the `readAsText` host boundary cannot carry it. This adapter therefore takes its bytes off the
 * established `ctx` escape hatch (the same one `oxydex-spo2` uses for `ctx.parseCSV` and
 * `polar-h10-ecg` for `ctx.companions`) — `ctx.buffers` (raw) or `ctx.edfSets` (pre-decoded).
 * The `text` argument is IGNORED. This supersedes the "there is NO text-stream adapter for cpap"
 * note in `signal-spec.js` / `signal-orchestrate.js`: the CPAPDex app still owns its own binary
 * ingest, but CPAP is no longer the one signal type without a registered adapter.
 *
 * ── THE SESSION-GROUPING RULE (CPAP-REAL-CORPUS §F4) — the whole reason this file exists ────
 * The rule is not obvious, and it has one trap:
 *
 *     cluster files whose stamps are within ±60 s of the set's anchor,
 *     AND — a SECOND file of a TYPE opens a NEW set.
 *
 * Without that second clause, a brief mask-off/on inside a single minute writes a second CSL/EVE
 * pair, and a naive ±60 s cluster OVERWRITES the first — silently DROPPING that set's scored
 * events and under-counting the night. **8 sessions in the ~180-night reference corpus hit exactly
 * this.** It is a silent under-count, not a crash, which is why it survived until a whole SD card
 * was driven through the node. `groupSessionSets()` is exposed on the adapter record so the rule
 * is unit-testable without a filesystem — it is the asset here, not the plumbing.
 *
 * Clock Contract (CLAUDE.md §🔒): the filename stamp is `YYYYMMDD_HHMMSS` local civil time with no
 * zone, so it is read by explicit regex into `Date.UTC(components as written)` — floating wall-clock
 * ms, never `new Date(str)`/`Date.parse`. Grouping compares those floating stamps to each other,
 * which is zone-free by construction. The frame's `t0Ms` comes from the DECODED EDF header
 * (`set.PLD.clock.t0Ms`), i.e. from `CpapEdf`, not from the filename.
 *
 * Frame: `samples` = the 25 Hz BRP `Flow` waveform (the canonical cpap payload, `signal-spec.js`),
 * `fs`, `t0Ms`; the decoded multi-signal sets ride as an `edfSets` SIDECAR (no event carrier exists
 * on a SignalFrame), which `CPAPDex.compute({edfSets})` reconstructs the night from.
 *
 * Detect note: matches on the ResMed filename grammar (`YYYYMMDD_HHMMSS_TYPE.edf`), which no other
 * adapter claims; the EDF magic is a weak fallback. Nothing else in the fleet reads `.edf`.
 *
 * How to collect: see `how-to-collect/cpap-edf.md` — eject the SD card, copy the `YYYYMMDD/` day
 * folders. NOTE: raw EDF+ headers carry a DEVICE SERIAL (`SRN=…`, bytes 88–168). Never commit real
 * recordings; the suite's gated fixture uses a SYNTHESIZED set (`tools/make-synthetic-edf.mjs`).
 * ─────────────────────────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'ResMed';
  var DEVICE = 'AirSense (SD-card EDF)';

  // `YYYYMMDD_HHMMSS_TYPE.edf` — the ResMed per-stream filename grammar.
  var FNAME_RE = /^(\d{8})_(\d{6})_([A-Z0-9]+)\.edf$/i;

  /**
   * Parse a ResMed EDF filename into its floating wall-clock stamp + stream type.
   * Clock Contract: components-as-written → Date.UTC. Never Date.parse.
   * @param {string} name
   * @returns {{ sec:number, type:string, file:string }|null}
   */
  function stampOf(name) {
    var base = String(name || '').split('/').pop();
    var m = FNAME_RE.exec(base);
    if (!m) return null;
    var d = m[1], t = m[2];
    var sec = Date.UTC(
      +d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8),
      +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)
    ) / 1000;
    if (!isFinite(sec)) return null;
    return { sec: sec, type: m[3].toUpperCase(), file: name };
  }

  /**
   * THE session-grouping rule (§F4). Pure: names in, clusters out — no filesystem, no I/O.
   *
   * Cluster files within ±60 s of a set's anchor, AND open a NEW set when a type REPEATS.
   * The `!c.byType[s.type]` clause is the load-bearing one: without it a second EVE/CSL inside
   * the same minute overwrites the first and its scored events vanish silently.
   *
   * @param {string[]} names
   * @returns {{ sec:number, byType:Object<string,{sec:number,type:string,file:string}> }[]}
   */
  function groupSessionSets(names) {
    var stamps = (names || [])
      .map(stampOf)
      .filter(Boolean)
      .sort(function (a, b) { return a.sec - b.sec; });

    var clusters = [];
    for (var i = 0; i < stamps.length; i++) {
      var s = stamps[i], hit = null;
      for (var j = 0; j < clusters.length; j++) {
        var c = clusters[j];
        // ±60 s of the anchor AND this type is not already taken → it joins.
        if (Math.abs(c.sec - s.sec) <= 60 && !c.byType[s.type]) { hit = c; break; }
      }
      if (hit) {
        hit.byType[s.type] = s;
      } else {
        /** @type {Object<string,{sec:number,type:string,file:string}>} */
        var byType = {};
        byType[s.type] = s;
        clusters.push({ sec: s.sec, byType: byType });   // a repeated type lands HERE — a new set
      }
    }
    return clusters;
  }

  REG.registerAdapter({
    id: 'resmed-edf',
    signalType: 'cpap',
    vendor: VENDOR,
    device: DEVICE,

    // The grouping rule rides on the adapter record so it is unit-testable via
    // SignalAdapters.byId('resmed-edf').groupSessionSets([...]) — no filesystem needed.
    groupSessionSets: groupSessionSets,
    stampOf: stampOf,

    // cheap, side-effect-free. The ResMed filename grammar is unique in the fleet — nothing else
    // reads `.edf` — so a name match is decisive; the EDF magic is a weak fallback for a renamed file.
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = (headText || '') + '';
      var base = name.split('/').pop();
      if (FNAME_RE.test(base)) return 0.96;                       // YYYYMMDD_HHMMSS_TYPE.edf
      if (/\.edf$/i.test(base)) return 0.5;                       // some other .edf — still ours
      // EDF+ magic: version field is '0' padded to 8 chars, then an 80-char patient field.
      if (/^0\s{7}/.test(head)) return 0.45;
      return 0;
    },

    // REFERENCE the existing pure parsers — never copy them.
    // `text` is IGNORED: EDF is binary + multi-file (see the header). Bytes arrive on ctx.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var prov = { adapter: 'resmed-edf', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: [] };
      var SF = root.SignalFrame;
      var bad = function (reason) { return SF.toSignalFrame('cpap', { usable: false, reason: reason }, prov); };

      var EDF = root.CpapEdf;
      // `chan()` lives on the FULL CpapDsp api; `CPAPDex` is the narrow namespaced surface
      // (compute/buildNightFromSets/_synthEdfSet) and does NOT carry it. Resolve by capability,
      // not by name, so neither namespace's shape is assumed.
      var CD = (root.CpapDsp && typeof root.CpapDsp.chan === 'function') ? root.CpapDsp
             : (root.CPAPDex && typeof root.CPAPDex.chan === 'function') ? root.CPAPDex
             : null;

      var sets = null;

      // (a) host already decoded the sets (the CPAPDex app's own binary ingest path) → take them.
      if (Array.isArray(ctx.edfSets) && ctx.edfSets.length) {
        sets = ctx.edfSets;

      // (b) raw bytes: ctx.buffers = [{ name, buffer }] — group by the §F4 rule, then decode.
      } else if (Array.isArray(ctx.buffers) && ctx.buffers.length) {
        if (!EDF || typeof EDF.readEDF !== 'function') {
          return bad('resmed-edf: CpapEdf not in scope (load cpapdex-edf.js before this adapter)');
        }
        var byName = {};
        var names = [];
        for (var i = 0; i < ctx.buffers.length; i++) {
          var b = ctx.buffers[i];
          if (!b || !b.name) continue;
          byName[b.name] = b.buffer;
          names.push(b.name);
        }
        var clusters = groupSessionSets(names);
        if (!clusters.length) {
          return bad('resmed-edf: no ResMed EDF filenames (expected YYYYMMDD_HHMMSS_TYPE.edf) among ' + names.length + ' file(s)');
        }
        sets = [];
        for (var k = 0; k < clusters.length; k++) {
          var set = {}, types = Object.keys(clusters[k].byType), any = false;
          for (var t = 0; t < types.length; t++) {
            var s = clusters[k].byType[types[t]];
            try {
              set[types[t]] = EDF.readEDF(byName[s.file]);
              any = true;
            } catch (e) {
              // a corrupt stream is a non-fatal WARNING — the other streams of the set still stand.
              prov.warnings.push('EDF read failed for ' + s.file + ': ' + ((e && e.message) || e));
            }
          }
          if (any) {
            set._fname = clusters[k].byType[types[0]].file;
            sets.push(set);
          }
        }
        if (!sets.length) return bad('resmed-edf: every EDF in the set failed to decode');

      } else {
        return bad('resmed-edf: EDF is binary + multi-file — pass ctx.buffers=[{name,buffer}] (raw) or ctx.edfSets (pre-decoded); the text argument is not used');
      }

      // Canonical cpap payload (signal-spec.js): the 25 Hz BRP `Flow` waveform. The decoded sets
      // ride as the `edfSets` sidecar — CPAPDex.compute({edfSets}) rebuilds the night from them.
      var fl = null, t0 = null;
      var first = sets[0];
      if (CD && typeof CD.chan === 'function' && first && first.BRP) {
        try { fl = CD.chan(first.BRP, 'Flow'); } catch (e2) { prov.warnings.push('Flow channel: ' + ((e2 && e2.message) || e2)); }
      }
      if (first) {
        t0 = (first.PLD && first.PLD.clock && first.PLD.clock.t0Ms) != null ? first.PLD.clock.t0Ms
           : (first.BRP && first.BRP.clock && first.BRP.clock.t0Ms) != null ? first.BRP.clock.t0Ms
           : null;
      }

      var samples = (fl && fl.data) || null;
      var hasFlow = !!(samples && samples.length);
      // `cpap` is a SAMPLES frame (signal-spec.js frameFields: samples/fs/t0Ms), and validateFrame
      // requires the payload when usable — so an EVE-only set (no BRP waveform) cannot ride as a
      // usable samples-frame however analyzable the night is. It comes back usable:false with the
      // reason stated; its decoded sets still ride the `edfSets` sidecar, so a host that wants the
      // events-only path can take them straight to CPAPDex.compute({edfSets}).
      var frame = SF.toSignalFrame('cpap', {
        samples: samples,
        fs: (fl && fl.fs) || 25,
        t0Ms: t0,
        usable: hasFlow,
        reason: hasFlow ? null
          : (CD ? 'resmed-edf: no BRP Flow waveform in the set (events/PLD only) — the decoded sets still ride frame.edfSets'
                : 'resmed-edf: CPAPDex/CpapDsp not in scope (load cpapdex-dsp.js before this adapter)')
      }, prov);

      frame.edfSets = sets;
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
