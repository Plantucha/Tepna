/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   EEGDex · APP  (eegdex-app.js)
   ────────────────────────────────────────────────────────────────────────
   Wiring: one EDF file in (picker or drag-drop) → EEGDSP.ingestEDF reads its
   EEG channel through the shared EDF reader → EEGDSP.compute →
   EEGUI.renderSummary. The Demo button runs the deterministic synthetic.
   Export → scrubbed ganglior.node-export.

   A REFUSED INGEST IS LOUD. `ingestEDF` returns a named reason and, when it
   read the header, the channel labels it found; both reach the status line.
   A file this node cannot use must never look like a file with no EEG in it.
   ESM-from-birth: imports the DSP + render exports (no window reads).
   ════════════════════════════════════════════════════════════════════════ */
import { EEGDSP } from './eegdex-dsp.js';
import { EEGUI } from './eegdex-render.js';

(function () {
  'use strict';
  var $ = function (id) {
    return document.getElementById(id);
  };
  var RESULT = null;

  /* EDF is BINARY. A text read would corrupt every sample it decoded, so this node reads the buffer
     and never a string. */
  function readBuffer(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result || null);
      };
      fr.onerror = function () {
        resolve(null);
      };
      fr.readAsArrayBuffer(file);
    });
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    /* One EEG recording per analysis. A second file is named rather than merged: two EDFs are two
       recordings until something proves they share a clock. */
    if (files.length > 1) setStatus('Reading ' + files[0].name + ' only — ' + (files.length - 1) + ' other file(s) ignored.');
    var file = files[0];
    readBuffer(file).then(function (buf) {
      if (!buf) {
        EEGUI.renderSummary(null);
        setStatus('Could not read ' + file.name + '.');
        return;
      }
      /* `readEDF` REFUSES AN UNKNOWN RECORD GEOMETRY BY THROWING — samples-per-record is the stride
         of every signal after it, so absorbing it as 0 reads the whole file from the wrong offsets.
         `ingestEDF` does not catch that, and without this the rejection would be swallowed by the
         promise: the surface would keep the previous file's status and the reader's message would
         reach nobody. The message shown is the reader's own, never a rewritten one. */
      var frame;
      try {
        frame = EEGDSP.ingestEDF(buf);
      } catch (e) {
        frame = { ok: false, reason: 'edf-header-refused — ' + ((e && e.message) || String(e)) };
      }
      if (!frame || !frame.ok) {
        RESULT = null;
        setExportReady(false);
        EEGUI.renderSummary(null);
        setStatus(
          file.name +
            ' — no EEG analyzed: ' +
            ((frame && frame.reason) || 'edf-unreadable') +
            (frame && frame.channels && frame.channels.length ? '. Channels in the header: ' + frame.channels.join(', ') : '')
        );
        return;
      }
      RESULT = EEGDSP.compute(frame);
      EEGUI.renderSummary(RESULT);
      if (RESULT && RESULT.err) {
        setExportReady(false);
        setStatus(file.name + ' — ' + RESULT.err + (RESULT.reason ? ' (' + RESULT.reason + ')' : ''));
        return;
      }
      setStatus(file.name + ' · channel ' + frame.channel + (frame.truncated ? ' · the last data record is truncated' : ''));
      setExportReady(true);
    });
  }

  function runDemo() {
    /* The deterministic synthetic: five authored blocks, one per branch of the stager. It proves the
       wiring, the units and the refusals, and it says nothing about the stager's accuracy. */
    var frame = EEGDSP.genSynthetic({});
    RESULT = EEGDSP.compute(frame);
    EEGUI.renderSummary(RESULT);
    setStatus('Demo — deterministic synthetic, authored arithmetic and not a recording.');
    setExportReady(true);
  }

  /* Enabling the button and revealing its bar are ONE act: `ans-design.css` ships
     `#exportBar{display:none}` and reveals it with `#exportBar.show`, so a button enabled inside the
     hidden bar sits in a 0x0 rect and rejects a real click (EXPORT-PATH-UNREACHABLE §2). */
  function setExportReady(on) {
    var btn = $('egExport'),
      bar = $('exportBar');
    if (btn) btn.disabled = !on;
    if (bar) bar.classList.toggle('show', !!on);
  }

  function exportJSON() {
    if (!RESULT || RESULT.err) return;
    var env = EEGDSP.buildNodeExport(RESULT, { kernel: window.DexKernel || null });
    /* The shared scrub, reached through the bare global dex-export.js publishes for every node's app.
       An absent scrub does NOT fall through to an unscrubbed download: the export is the surface that
       leaves this machine, so a missing allow-list refuses the write. */
    if (typeof window.dexScrubExport !== 'function') {
      setStatus('Export refused — the shared export allow-list did not load.');
      return;
    }
    env = window.dexScrubExport(env);
    var blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'EEGDex.node-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function setStatus(msg) {
    if ($('egStatus')) $('egStatus').textContent = msg;
  }

  function wire() {
    var input = $('egInput'),
      zone = $('egZone');
    if (input)
      input.addEventListener('change', function (e) {
        ingestFiles(e.target.files);
      });
    if (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('eg-over');
      });
      zone.addEventListener('dragleave', function () {
        zone.classList.remove('eg-over');
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('eg-over');
        ingestFiles(e.dataTransfer.files);
      });
    }
    if ($('egDemo')) $('egDemo').addEventListener('click', runDemo);
    if ($('egExport')) $('egExport').addEventListener('click', exportJSON);
    // theme toggle — the shared fleet control, wired here and NOT in an inline script, so the strict
    // script-src CSP keeps an empty hash list. Mirrors motiondex-app.js.
    var tb = $('themeBtn');
    if (tb)
      tb.addEventListener('click', function () {
        document.body.classList.toggle('light');
        tb.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
      });
    // clear-all — drop the result and collapse every section back to its empty state
    if ($('egClear'))
      $('egClear').addEventListener('click', function () {
        RESULT = null;
        ['egKpiGrid', 'egHypnoCard', 'egBandsCard', 'egQualityCard'].forEach(function (id) {
          var el = $(id);
          if (el) {
            el.innerHTML = '';
            if (id !== 'egKpiGrid') el.style.display = 'none';
          }
        });
        ['egKPI', 'egHypno', 'egBands', 'egQuality'].forEach(function (id) {
          var el = $(id);
          if (el) el.style.display = 'none';
        });
        setExportReady(false);
        if ($('egInput')) $('egInput').value = '';
        setStatus('Cleared.');
      });
    if (location.hash === '#demo') setTimeout(runDemo, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
