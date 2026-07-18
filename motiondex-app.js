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

  // classify a Polar Sensor Logger filename → which compute() input slot it feeds
  function slotFor(name) {
    var kind = MOTIONDSP.streamKindFromName(name); // 'acc' | 'gyro' | 'mag' | null
    if (!kind) return null;
    var isH10 = /(^|[_\s])H10|Polar_H10/i.test(name);
    if (kind === 'acc') return isH10 ? 'chestAcc' : 'acc';
    return kind; // gyro / mag (Verity only)
  }

  function readText(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result || ''));
      };
      fr.onerror = function () {
        resolve('');
      };
      fr.readAsText(file);
    });
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var input = {},
      names = [];
    Promise.all(
      files.map(function (f) {
        var slot = slotFor(f.name);
        return readText(f).then(function (txt) {
          if (slot && txt) {
            input[slot] = txt;
            names.push(f.name);
          }
        });
      })
    ).then(function () {
      if (!Object.keys(input).length) {
        MOTIONUI.renderSummary(null);
        setStatus('No ACC / GYRO / MAGN streams recognised in the dropped files.');
        return;
      }
      RESULT = MOTIONDSP.compute(input);
      MOTIONUI.renderSummary(RESULT);
      setStatus(names.length + ' file(s): ' + names.join(', '));
      if ($('mxExport')) $('mxExport').disabled = false;
    });
  }

  function runDemo() {
    // deterministic synthetic: a supine, quiet-breathing night (wrist ACC + chest ACC)
    var acc = MOTIONDSP.genSynthetic({ sec: 300, hz: 26, brpm: 15, seed: 7 });
    var chest = MOTIONDSP.genSynthetic({ sec: 300, hz: 26, brpm: 15, seed: 21 });
    RESULT = MOTIONDSP.compute({ acc: acc, chestAcc: chest });
    MOTIONUI.renderSummary(RESULT);
    setStatus('Demo — deterministic synthetic (supine, 15 br/min).');
    if ($('mxExport')) $('mxExport').disabled = false;
  }

  function exportJSON() {
    if (!RESULT) return;
    var env = MOTIONDSP.buildNodeExport(RESULT);
    if (MOTIONDSP && window.MotionDex && typeof window.MotionDex.scrubExport === 'function') env = window.MotionDex.scrubExport(env);
    var blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'MotionDex.node-export.json';
    a.click();
    URL.revokeObjectURL(url);
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
        if ($('mxExport')) $('mxExport').disabled = true;
        if ($('mxInput')) $('mxInput').value = '';
        setStatus('Cleared.');
      });
    if (location.hash === '#demo') setTimeout(runDemo, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
