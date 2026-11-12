/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   MotionDex · APP  (motiondex-app.js)
   ────────────────────────────────────────────────────────────────────────
   Wiring: ingest Polar Sensor Logger IMU files (multi-select / drag-drop),
   classify each stream by filename (Verity ACC/GYRO/MAGN → wrist; H10 ACC →
   chest effort), MOTIONDSP.compute() → MOTIONUI.renderSummary(). Demo button
   runs the deterministic synthetic. Export → scrubbed ganglior.node-export.
   ESM-from-birth: imports the DSP + render exports (no window reads).
   ════════════════════════════════════════════════════════════════════════ */
import { MOTIONDSP } from './motiondex-dsp.js';
import { MOTIONUI } from './motiondex-render.js';

(function () {
  'use strict';
  var $ = function (id) {
    return document.getElementById(id);
  };
  var RESULT = null;
  /* MULTI-SESSION STORE — the MotionDex leg of residue
     `2026-11-08-three-nodes-emit-no-crossnight-export`. MotionDex replaced its one RESULT on every
     load, so no realm ever held two sessions and `motiondex-cross.js` would have had nothing to fold.
     Each computed session is KEPT here instead. The KEY is the session's own floating `t0Ms`, so
     re-dropping one night replaces that night rather than counting it twice; a session whose stamp is
     absent gets a sequence key, because `null` is not an identity and two undated sessions are two
     sessions (CLAUDE.md §∅). RESULT still points at the session on screen, so every render path and
     the single-session export are unchanged. */
  var SESSIONS = {};
  var _mxSeq = 0;
  function keepSession(summary) {
    if (!summary) return;
    var k = summary.t0Ms != null && isFinite(summary.t0Ms) ? 't' + summary.t0Ms : 'u' + ++_mxSeq;
    SESSIONS[k] = summary;
  }
  // ascending by t0Ms — an undated session sorts first and the engine drops its stamp, never places
  // it at the epoch. Same ordering the five sibling cross files read.
  function sessionsSorted() {
    return Object.keys(SESSIONS)
      .map(function (k) {
        return SESSIONS[k];
      })
      .sort(function (a, b) {
        return (a.t0Ms || 0) - (b.t0Ms || 0);
      });
  }

  // classify a Polar Sensor Logger filename → which compute() input slot it feeds
  function slotFor(name) {
    var isH10 = /(^|[_\s])H10|Polar_H10/i.test(name);
    /* SAMPLE-VALIDITY-ENVELOPE §3.2 — the `…_ACCRUNS.txt` validity sidecar feeds the RUNS slot of the
       ACC it belongs to. Claimed BEFORE streamKindFromName, which returns null for it (it is not a
       waveform and must never become one), so without this line the file is silently dropped. */
    if (/_ACCRUNS\b|_ACCRUNS\./i.test(name)) return isH10 ? 'chestAccRuns' : 'accRuns';
    /* SEAM-SIDECAR-CONSUMPTION §4 — the `…_ACCSEAMS.txt` clock-seam sidecar feeds the SEAMS slot of
       the ACC it belongs to. Claimed here for the same reason: `streamKindFromName` returns null for
       it (`_(ACC|GYRO|MAGN?)\b` cannot match `_ACCSEAMS` — no boundary before SEAMS), so without
       this line the box's seam record is silently dropped and this node reads the night as clean. */
    if (/_ACCSEAMS\b|_ACCSEAMS\./i.test(name)) return isH10 ? 'chestAccSeams' : 'accSeams';
    var kind = MOTIONDSP.streamKindFromName(name); // 'acc' | 'gyro' | 'mag' | null
    if (!kind) return null;
    if (kind === 'acc') return isH10 ? 'chestAcc' : 'acc';
    return kind; // gyro / mag (Verity only)
  }

  /* `onerror` resolves `null`, never `''` — an unreadable file and an empty one are DIFFERENT
     absences, and the status line names each by its own reason rather than a borrowed one (§∅). */
  function readText(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result || ''));
      };
      fr.onerror = function () {
        resolve(null);
      };
      fr.readAsText(file);
    });
  }

  /* RESIDUE `2026-11-11-motiondex-drops-accraw-silently` — a dropped file this node could not place
     left the status line with no word: the vigil audit of night 2026-11-04 handed MotionDex 4 files
     and read `3 file(s)`. The O2Ring's `_ACCRAW.txt` is the measured case — `streamKindFromName` nulls
     it (`_(ACC|GYRO|MAGN?|MAG)\b` cannot match `_ACCRAW`: no boundary before RAW) and it IS a different
     stream from the Polar IMU this node reads. §∅ binds the REPORT as well as the value, so every file
     that fed no slot is named with its own reason, in the `set aside` vocabulary ECGDex and PpgDex
     already use. */
  function asideReason(name, slot, txt) {
    if (!slot) {
      if (/_ACCRAW\b|_ACCRAW\./i.test(name)) return 'the O2Ring `_ACCRAW` raw accelerometer stream — no Dex node reads it yet';
      return 'no ACC / GYRO / MAGN stream in the name';
    }
    if (txt === null) return 'the file could not be read';
    return 'the file holds no bytes';
  }

  function asideList(aside) {
    return aside
      .map(function (a) {
        return a.name + ' (' + a.why + ')';
      })
      .join('; ');
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var input = {},
      names = [],
      aside = [];
    Promise.all(
      files.map(function (f) {
        var slot = slotFor(f.name);
        return readText(f).then(function (txt) {
          return { name: f.name, slot: slot, txt: txt };
        });
      })
    ).then(function (read) {
      /* Placed in DROP order, which `Promise.all` preserves in its resolved array. Each per-file
         `.then` used to place its own slot in READ-COMPLETION order, so two parts for one slot
         overwrote each other by whichever read finished last, and the loser stayed counted in the
         status line. The first file in the drop wins the slot now, and a later one is set aside. */
      read.forEach(function (r) {
        if (!r.slot || !r.txt) {
          aside.push({ name: r.name, why: asideReason(r.name, r.slot, r.txt) });
          return;
        }
        if (Object.prototype.hasOwnProperty.call(input, r.slot)) {
          aside.push({ name: r.name, why: 'a second file for the `' + r.slot + '` slot — the first one in the drop is read' });
          return;
        }
        input[r.slot] = r.txt;
        names.push(r.name);
      });
      var asideNote = aside.length ? ' · set aside ' + aside.length + ': ' + asideList(aside) : '';
      if (!Object.keys(input).length) {
        MOTIONUI.renderSummary(null);
        setStatus('No ACC / GYRO / MAGN stream read from ' + files.length + ' dropped file(s) — set aside ' + asideList(aside));
        return;
      }
      RESULT = MOTIONDSP.compute(input);
      keepSession(RESULT);
      MOTIONUI.renderSummary(RESULT);
      setStatus(names.length + ' of ' + files.length + ' file(s): ' + names.join(', ') + asideNote + sessionNote());
      setExportReady(true);
    });
  }

  function runDemo() {
    // deterministic synthetic: a supine, quiet-breathing night (wrist ACC + chest ACC)
    var acc = MOTIONDSP.genSynthetic({ sec: 300, hz: 26, brpm: 15, seed: 7 });
    var chest = MOTIONDSP.genSynthetic({ sec: 300, hz: 26, brpm: 15, seed: 21 });
    RESULT = MOTIONDSP.compute({ acc: acc, chestAcc: chest });
    keepSession(RESULT);
    MOTIONUI.renderSummary(RESULT);
    setStatus('Demo — deterministic synthetic (supine, 15 br/min).' + sessionNote());
    setExportReady(true);
  }

  /* EXPORT-PATH-UNREACHABLE §2 — `ans-design.css` ships `#exportBar{display:none}` and reveals it with
     `#exportBar.show`. MotionDex is the one node whose bar is STATIC markup in its .src.html rather than
     written by JS, so it never inherited the `.show` call every other node makes in the same statement
     that writes its buttons: `#mxExport` was being enabled inside a container with a 0x0 rect, and a real
     click was rejected "Element is not visible". Enabling the button and revealing its bar are one act. */
  function setExportReady(on) {
    var btn = $('mxExport'),
      bar = $('exportBar');
    if (btn) btn.disabled = !on;
    if (bar) bar.classList.toggle('show', !!on);
  }

  // one session -> one envelope, scrubbed exactly as the single-session export has always scrubbed it
  function buildEnv(summary) {
    var env = MOTIONDSP.buildNodeExport(summary, { kernel: window.DexKernel || null });
    if (MOTIONDSP && window.MotionDex && typeof window.MotionDex.scrubExport === 'function') env = window.MotionDex.scrubExport(env);
    return env;
  }
  function dlJSON(text, name) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  // how many sessions the store holds, stated beside the status so the count is never silent
  function sessionNote() {
    var n = Object.keys(SESSIONS).length;
    return n > 1 ? ' · ' + n + ' sessions held' : '';
  }

  function exportJSON() {
    if (!RESULT) return;
    var list = sessionsSorted();
    if (list.length <= 1) {
      // UNCHANGED: one session exports the same bytes under the same name as before this store existed
      dlJSON(JSON.stringify(buildEnv(RESULT), null, 2), 'MotionDex.node-export.json');
      return;
    }
    /* >=2 sessions -> wrapper: an array of per-session v2.0 envelopes + a standardized
       `ganglior.crossnight` v1.0 aggregate header. The ECGDex shape (`ecgdex-app.js` exportJSON), so
       the Integrator reads one wrapper vocabulary across the nodes that emit from the app. The
       envelopes are the ITEMS the cross engine folds — see `motiondex-cross.js` for why the fold reads
       the envelope and not the raw summary. */
    var envs = list.map(buildEnv);
    var first = list[0] && list[0].t0Ms,
      last = list[list.length - 1] && list[list.length - 1].t0Ms;
    var spanDays = first != null && last != null && isFinite(first) && isFinite(last) ? Math.round((last - first) / 86400000) : null;
    var payload = {
      kernel: window.DexKernel ? { version: window.DexKernel.VERSION, hash: window.DexKernel.HASH } : null,
      schema: {
        name: 'ganglior.node-export',
        version: '2.0',
        node: 'MotionDex',
        nodeVersion: '1.0',
        multiRecording: true,
        generated: new Date().toISOString(),
        provenance: window.GangliorProvenance ? window.GangliorProvenance.stamp() : null,
        doc: 'Array of per-session v2.0 envelopes (each element is Integrator-readable unchanged) + a ganglior.crossnight v1.0 aggregate header.'
      },
      generated: new Date().toISOString(),
      recordingCount: envs.length,
      // null, never {} — a realm without the cross module states the absence rather than publishing an
      // empty aggregate that reads as "measured and found nothing" (CLAUDE.md §∅).
      crossNight: window.MotionCross ? window.MotionCross.crossNightBlock(envs) : null,
      recordings: envs
    };
    var name = typeof window.exportName === 'function' ? window.exportName({ node: 'MotionDex', t0Ms: first, kind: 'series', ext: 'json', spanDays: spanDays }) : 'MotionDex.series.node-export.json';
    dlJSON(JSON.stringify(payload, null, 2), name);
    setStatus('Exported ' + envs.length + ' sessions (array + crossNight envelope).');
  }

  function setStatus(msg) {
    if ($('mxStatus')) $('mxStatus').textContent = msg;
  }

  function wire() {
    var input = $('mxInput'),
      zone = $('mxZone');
    if (input)
      input.addEventListener('change', function (e) {
        ingestFiles(e.target.files);
      });
    if (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('mx-over');
      });
      zone.addEventListener('dragleave', function () {
        zone.classList.remove('mx-over');
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('mx-over');
        ingestFiles(e.dataTransfer.files);
      });
    }
    if ($('mxDemo')) $('mxDemo').addEventListener('click', runDemo);
    if ($('mxExport')) $('mxExport').addEventListener('click', exportJSON);
    // theme toggle — the shared fleet control (wired here, NOT via an inline script, so the
    // strict script-src CSP keeps an empty hash list). Mirrors ecgdex-app.js.
    var tb = $('themeBtn');
    if (tb)
      tb.addEventListener('click', function () {
        document.body.classList.toggle('light');
        tb.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
      });
    // clear-all — drop the result + collapse every section back to its empty state
    if ($('mxClear'))
      $('mxClear').addEventListener('click', function () {
        RESULT = null;
        SESSIONS = {};
        _mxSeq = 0;
        ['mxKpiGrid', 'mxPositionCard', 'mxEffortCard', 'mxActivityCard', 'mxQualityCard'].forEach(function (id) {
          var el = $(id);
          if (el) {
            el.innerHTML = '';
            if (id !== 'mxKpiGrid') el.style.display = 'none';
          }
        });
        ['mxKPI', 'mxPosition', 'mxEffort', 'mxActivity', 'mxQuality'].forEach(function (id) {
          var el = $(id);
          if (el) el.style.display = 'none';
        });
        setExportReady(false);
        if ($('mxInput')) $('mxInput').value = '';
        setStatus('Cleared.');
      });
    if (location.hash === '#demo') setTimeout(runDemo, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
