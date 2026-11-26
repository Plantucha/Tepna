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
  /* THE STAGE MODEL'S STATE. There is no switch left to read: the fitted model is the ONE stage
     source (owner order 2026-11-25, board #8966).

     `FRAME` is the last ingested frame, held because a model file dropped after the recording must
     be able to re-score the night already on screen without asking for the recording again.

     TWO MODELS, AND THE READER'S WINS. `BUILTIN` is the one-pass model the page carries as data in
     its own JSON block; `MODEL` is a file the reader dropped. `activeModel()` prefers the drop, for
     that night, and the hypnogram names whichever one scored it. */
  var FRAME = null;
  var MODEL = null;
  var BUILTIN = null;
  var BUILTIN_WHY = null;

  /* THE PAGE'S OWN MODEL, READ FROM A DATA BLOCK AND NEVER FROM CODE. The element's type is not
     JavaScript, so nothing in it was ever evaluated; this function is the only thing that parses
     it, and a block that is absent or unparseable leaves `BUILTIN` null with a stated reason rather
     than a half-read model.

     IN THE DEVELOPMENT `.src.html` FORM THE BLOCK IS EMPTY. A `type="application/json"` script's
     `src` is not fetched by the browser, and this node's CSP sets `connect-src 'none'`, so the
     unbundled page carries no built-in model and says so. The bundler inlines the file's bytes, so
     the built page and the served copy carry it. */
  function loadBuiltin() {
    var el = $('egBuiltinModel'),
      txt = el ? String(el.textContent || '').trim() : '';
    if (!el) {
      BUILTIN_WHY = 'this page carries no built-in model block';
      return;
    }
    if (!txt) {
      BUILTIN_WHY = 'the built-in model block is empty — this is the unbundled development page, so drop a model file';
      return;
    }
    var m = null;
    try {
      m = JSON.parse(txt);
    } catch (e) {
      BUILTIN_WHY = 'the built-in model block is not readable JSON: ' + ((e && e.message) || String(e));
      return;
    }
    if (!m || m.schema !== 'tepna.stage-formula/1') {
      BUILTIN_WHY = 'the built-in model block reads schema ' + ((m && m.schema) || 'none') + ', not tepna.stage-formula/1';
      return;
    }
    BUILTIN = m;
  }

  function activeModel() {
    return MODEL || BUILTIN;
  }

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
      return { ok: true, why: file.name + ' — stage model ' + (m.id || 'unnamed') + ' loaded, and it scores this night in place of the built-in model' };
    });
  }

  /* A MODEL FILE ARRIVING AFTER THE RECORDING RE-SCORES THE NIGHT ON SCREEN. The stage series is
     part of the one summary now, so a new model is a new `compute` over the held frame and not a
     second card beside the first. With no frame yet there is nothing to re-score and the status
     line is the whole answer. */
  function rescore() {
    if (!FRAME) return;
    RESULT = EEGDSP.compute(FRAME, { model: activeModel() });
    EEGUI.renderSummary(RESULT, FRAME.truth || null);
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    /* One EEG recording per analysis. A second file is named rather than merged: two EDFs are two
       recordings until something proves they share a clock. */
    /* A model file travels in the SAME drop, because a reader who wants their own model wants it
       for the night they are dropping, and a second drop zone would be a second thing to explain. */
    var models = files.filter(function (f) {
      return /\.json$/i.test(f.name);
    });
    files = files.filter(function (f) {
      return !/\.json$/i.test(f.name);
    });
    if (models.length) {
      takeModel(models[0]).then(function (r) {
        setStatus(r.why);
        rescore();
      });
      if (!files.length) return;
    }
    /* A MUSE NIGHT IS SEVERAL FILES OF ONE RECORDING. The capture-host recorder starts a new
       `<base>_RAW.txt` at each reconnect, so every frame file in the drop is read, in name order
       (the name carries the start stamp), and the ingest measures each seam from the host stamps.
       The `RAWRUNS` and `RAWSEAMS` sidecars do not match the pattern and stay out. */
    var raws = files
      .filter(function (f) {
        return /_RAW\.txt$/i.test(f.name);
      })
      .sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
    if (raws.length) {
      ingestMuseFiles(raws);
      return;
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
      showFrame(frame, file.name, 'edf-unreadable', frame && frame.truncated ? ' · the last data record is truncated' : '');
    });
  }

  /* One path from a frame to the screen, for the EDF and the Muse reader alike. A refusal names the
     reader's own reason, and a frame never reaches `compute` unless the reader said ok. */
  function showFrame(frame, label, fallbackReason, note) {
    if (!frame || !frame.ok) {
      FRAME = null;
      RESULT = null;
      setExportReady(false);
      EEGUI.renderSummary(null);
      setStatus(
        label +
          ' — no EEG analyzed: ' +
          ((frame && frame.reason) || fallbackReason) +
          (frame && frame.channels && frame.channels.length ? '. Channels in the header: ' + frame.channels.join(', ') : '')
      );
      return;
    }
    FRAME = frame;
    RESULT = EEGDSP.compute(frame, { model: activeModel() });
    EEGUI.renderSummary(RESULT);
    if (RESULT && RESULT.err) {
      setExportReady(false);
      setStatus(label + ' — ' + RESULT.err + (RESULT.reason ? ' (' + RESULT.reason + ')' : ''));
      return;
    }
    setStatus(label + ' · channel ' + frame.channel + note);
    setExportReady(true);
  }

  /* The Muse frame files of one night, read one after another and handed to the ingest as one array.
     A file that cannot be read refuses the night by name: a night with a hole nobody measured is
     not a night this node may stage. */
  function ingestMuseFiles(raws) {
    var label = raws.length === 1 ? raws[0].name : raws[0].name + ' + ' + (raws.length - 1) + ' more';
    setStatus('Reading ' + label + '…');
    var texts = [],
      k = 0;
    function next() {
      if (k === raws.length) {
        var frame = EEGDSP.ingestMuseRaw(texts);
        texts = null;
        var fr = frame && frame.frames,
          note = fr && fr.gapCount ? ' · ' + fr.gapCount + ' gap(s), ' + fr.lostRecords + ' records absent' + (fr.restarts ? ', ' + fr.restarts + ' reconnect(s)' : '') : '';
        showFrame(frame, label, 'muse-unreadable', note);
        return;
      }
      var file = raws[k++];
      readText(file).then(function (txt) {
        if (txt == null) {
          showFrame({ ok: false, reason: 'file-unreadable: ' + file.name }, label, 'muse-unreadable', '');
          return;
        }
        texts.push(txt);
        next();
      });
    }
    next();
  }

  function runDemo() {
    /* THE OVERNIGHT SIMULATOR (owner order 2026-11-14, board #6256), not a recording. Eight hours of
       authored arithmetic: about 90 min per cycle, one spectrum per segment, spindles and
       K-complexes in spindle-rich light sleep, blinks in wake, movement bursts, electrode pops and
       two absent spans. It proves the wiring, the units and the refusals, and it says nothing about
       the model's accuracy against people.

       THE ANCHOR IS DECLARED HERE, never in the DSP. A synthetic run has no file, so the generator
       returns `t0Ms: null` and the reason beside it (§🔒.4). The demo wants a clock on its
       hypnogram, so the DEMO states the anchor it wants and owns that choice.

       `genSynthetic` stays the five-block fixture for the render-coverage rig and for the
       known-answer band test, which pin its numbers. */
    var frame = EEGDSP.genOvernight({ durSec: 8 * 3600, scenario: 'artefactual', t0Ms: Date.UTC(2026, 0, 1, 23, 0, 0) });
    RESULT = EEGDSP.compute(frame, { model: activeModel() });
    /* The render reads `summary.source`, which `compute` carries from the frame, so the label needs
       no second argument and an EDF run cannot accidentally claim it.

       THE PLAN IS THE SECOND ARGUMENT, AND ONLY THE DEMO HOLDS IT. `compute` never returns the
       generator's truth, so the hypnogram's planned strip and the raster's planted row exist on this
       path alone; the EDF path above calls `renderSummary(RESULT)` and those two rows are absent by
       construction rather than by a flag. */
    FRAME = frame;
    EEGUI.renderSummary(RESULT, frame.truth);
    setStatus(
      'Demo — synthetic, not a recording: an 8 h simulated night, authored arithmetic.' +
        (activeModel() ? '' : ' No model reached this page, so no epoch carries a class: ' + (BUILTIN_WHY || 'no reason given') + '.')
    );
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
    loadBuiltin();
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
        FRAME = null;
        MODEL = null;
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
        /* The READER's model is dropped by a clear, and the page's own model is not: it is part of
           the page rather than part of the night. */
        setStatus('Cleared.');
      });
    if (location.hash === '#demo') setTimeout(runDemo, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
