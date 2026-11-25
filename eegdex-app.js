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
  /* THE SECOND STAGE SOURCE'S STATE, and it is OFF until the reader turns it on (@kestrel, #8464
     rule 3). `FRAME` is the last ingested frame, held because the formula is a SECOND pass over the
     same samples: a switch flip or a model file must be able to score the night already on screen
     without asking for the file again. `MODEL` is the reader's model file, and no coefficient of it
     is in this page. */
  var FRAME = null;
  var MODEL = null;

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

  function readText(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result || null);
      };
      fr.onerror = function () {
        resolve(null);
      };
      fr.readAsText(file);
    });
  }

  /* THE MODEL IS RECOGNISED BY ITS OWN SCHEMA, never by its name. A filename is a claim about the
     writer, so `.json` only makes a file a CANDIDATE here; the `schema` field inside it decides. A
     JSON that is not a stage formula is reported and dropped, and it never reaches the EDF reader. */
  function takeModel(file) {
    return readText(file).then(function (txt) {
      var m = null;
      try {
        m = JSON.parse(txt);
      } catch (e) {
        return { ok: false, why: file.name + ' — not readable JSON: ' + ((e && e.message) || String(e)) };
      }
      if (!m || m.schema !== 'tepna.stage-formula/1') {
        return { ok: false, why: file.name + ' — reads schema ' + (m && m.schema ? m.schema : 'none') + ', not tepna.stage-formula/1' };
      }
      MODEL = m;
      return { ok: true, why: file.name + ' — stage formula ' + (m.id || 'unnamed') + ' loaded' };
    });
  }

  /* The formula section, drawn from the frame already on screen. The switch decides whether this
     node runs a second stage source at all, and nothing here touches `RESULT` or the strip above. */
  function renderFormula() {
    var on = $('egFormulaOn') && $('egFormulaOn').checked,
      card = $('egFormulaCard'),
      title = $('egFormula');
    EEGUI.renderFormula(card, title, !on || !FRAME ? null : EEGDSP.formulaStages(FRAME, MODEL));
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    /* One EEG recording per analysis. A second file is named rather than merged: two EDFs are two
       recordings until something proves they share a clock. */
    /* A model file travels in the SAME drop, because the formula needs the night and the
       coefficients together and a second drop zone would be a second thing to explain. */
    var models = files.filter(function (f) {
      return /\.json$/i.test(f.name);
    });
    files = files.filter(function (f) {
      return !/\.json$/i.test(f.name);
    });
    if (models.length) {
      takeModel(models[0]).then(function (r) {
        setStatus(r.why);
        renderFormula();
      });
      if (!files.length) return;
    }
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
        FRAME = null;
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
      FRAME = frame;
      RESULT = EEGDSP.compute(frame);
      EEGUI.renderSummary(RESULT);
      renderFormula();
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
    /* THE OVERNIGHT SIMULATOR (owner order 2026-11-14, board #6256), not a recording. Eight hours of
       authored arithmetic: about 90 min per cycle, one spectrum per stage, spindles and K-complexes
       in N2, blinks in wake, movement bursts, electrode pops and two absent spans. It proves the
       wiring, the units and the refusals, and it says nothing about the stager's accuracy.

       THE ANCHOR IS DECLARED HERE, never in the DSP. A synthetic run has no file, so the generator
       returns `t0Ms: null` and the reason beside it (§🔒.4). The demo wants a clock on its
       hypnogram, so the DEMO states the anchor it wants and owns that choice.

       `genSynthetic` stays the five-block fixture for the render-coverage rig and for the
       known-answer band test, which pin its numbers. */
    var frame = EEGDSP.genOvernight({ durSec: 8 * 3600, scenario: 'artefactual', t0Ms: Date.UTC(2026, 0, 1, 23, 0, 0) });
    RESULT = EEGDSP.compute(frame);
    /* The render reads `summary.source`, which `compute` carries from the frame, so the label needs
       no second argument and an EDF run cannot accidentally claim it.

       THE PLAN IS THE SECOND ARGUMENT, AND ONLY THE DEMO HOLDS IT. `compute` never returns the
       generator's truth, so the hypnogram's planned strip and the raster's planted row exist on this
       path alone; the EDF path above calls `renderSummary(RESULT)` and those two rows are absent by
       construction rather than by a flag. */
    FRAME = frame;
    EEGUI.renderSummary(RESULT, frame.truth);
    renderFormula();
    setStatus('Demo — synthetic, not a recording: an 8 h simulated night, authored arithmetic.');
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
    /* THE SWITCH. Its markup carries no `checked`, so the page loads with the formula OFF and the
       band-power stager is this node's answer until the reader decides otherwise. */
    if ($('egFormulaOn')) $('egFormulaOn').addEventListener('change', renderFormula);
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
        FRAME = null;
        MODEL = null;
        if ($('egFormulaOn')) $('egFormulaOn').checked = false;
        ['egKpiGrid', 'egHypnoCard', 'egBandsCard', 'egQualityCard', 'egFormulaCard'].forEach(function (id) {
          var el = $(id);
          if (el) {
            el.innerHTML = '';
            if (id !== 'egKpiGrid') el.style.display = 'none';
          }
        });
        ['egKPI', 'egHypno', 'egBands', 'egQuality', 'egFormula'].forEach(function (id) {
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
