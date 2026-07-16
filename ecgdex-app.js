/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · APP  (ecgdex-app.js)
   ────────────────────────────────────────────────────────────────────────
   Glue: streaming ECG ingest (Web Worker, built from a Blob so it bundles),
   synthetic generator, pipeline orchestration, and all UI population/exports.
   Depends on window.ECGDSP and window.ECGUI.
   ════════════════════════════════════════════════════════════════════════ */
// ESM-MIGRATION: real import edges to the DSP + render modules (the DSP↔app coupling P5 targets).
// Importing ecgdex-render.js also runs its factory (publishing window.evBadge) before this body's bare
// `evBadge(...)` calls. ecgdex-morph/-profile/-cross stay classic co-loaded (read off window at call time).
import { ECGDSP } from './ecgdex-dsp.js';
import { ECGUI } from './ecgdex-render.js';
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DSP = ECGDSP,
    UI = ECGUI;
  const ING = window.DexIngest; // §3 (ECG-INGEST-FOLLOWUPS): shared, gate-backed file-ingest classification (dex-ingest.js)
  let RESULT = null,
    SCOPE = null,
    DEVICE_RR = null,
    DEVICE_HR = null,
    DEVICE_ACC = null,
    ACC_FS = null;
  // ── multi-recording retrofit (§1b) — additive; single-recording stays byte-identical ──
  let allRecordings = {}; // key (floating t0Ms string) → result object
  let activeKey = null,
    _recSeq = 0,
    _loadQueue = [],
    _replaceMode = false;

  // ════════════════════════════════════════════════════════════════════════
  //  STREAMING PARSE WORKER  (zero-copy Int16Array transfer + gap list)
  // ════════════════════════════════════════════════════════════════════════
  const WORKER_SRC = `
self.onmessage = async (e) => {
  const files = e.data.files || (e.data.file ? [e.data.file] : []);
  let cap = 1<<20, arr = new Int16Array(cap), n = 0;
  let t0Ms = null, fs = 130, prevMs = null, msStep = null; const gaps = [];
  const push = v => { if(n>=cap){ cap*=2; const na=new Int16Array(cap); na.set(arr); arr=na; } arr[n++]=v; };
  // CLOCK-UNIFY: floating wall-clock parse (inline — workers can't see page scope)
  const _ckPF = (raw) => {
    if(raw==null) return null;
    const s = String(raw).trim().replace(/^["']|["']$/g,'');
    if(!s) return null; let m;
    if(/^\\d{10,13}$/.test(s)){ let x=parseInt(s,10); if(x<1e11)x*=1000; if(x<1e11||x>4e12) return null; return x - new Date(x).getTimezoneOffset()*60000; }
    m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3})\\d*)?)?\\s*(Z|[+-]\\d{2}:?\\d{2})?$/);
    if(m){ return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],m[6]?+m[6]:0, m[7]?+((m[7]+'00').slice(0,3)):0); }
    m = s.match(/^(\\d{1,2}):(\\d{2}):(\\d{2})\\s+(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
    if(m){ let a=+m[4],b=+m[5],d,mo; if(a>12){d=a;mo=b;}else if(b>12){d=b;mo=a;}else{d=a;mo=b;} return Date.UTC(+m[6],mo-1,d,+m[1],+m[2],+m[3]); }
    m = s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$/);
    if(m){ let a=+m[1],b=+m[2],d,mo; if(a>12){d=a;mo=b;}else if(b>12){d=b;mo=a;}else{d=a;mo=b;} return Date.UTC(+m[3],mo-1,d,+m[4],+m[5],m[6]?+m[6]:0); }
    return null;
  };
  const handle = (line) => {
    line = line.trim(); if(!line) return;
    const p = line.split(/[;\\t,]/);
    const v = parseFloat(p[p.length-1]);
    if(!isFinite(v)) return;                       // header / junk row
    push(Math.max(-32768, Math.min(32767, Math.round(v))));
    if(t0Ms===null){ const ms = _ckPF(p[0]); if(ms!=null) t0Ms = ms; }
    if(p.length>=3){
      const ms = parseFloat(p[2]);
      if(isFinite(ms)){
        if(prevMs!==null){ const d = ms-prevMs; if(msStep===null && d>0 && d<50) msStep=d;
          if(msStep && d > msStep*2.5) gaps.push({ idx:n-1, ms:d }); }
        prevMs = ms;
      }
    }
  };
  try {
    // Stream each part in numeric order into ONE accumulation. Repeated header
    // lines auto-drop (non-numeric last column → handle() returns early), and the
    // \`timestamp [ms]\` column stays monotonic across part boundaries so gap
    // detection and t0Ms (from part 1) remain correct.
    for(const file of files){
      const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      while(true){
        const { done, value } = await reader.read();
        if(value){ buf += value; let i;
          while((i = buf.indexOf('\\n')) >= 0){ handle(buf.slice(0,i)); buf = buf.slice(i+1); }
          if(n % 250000 < 50) self.postMessage({ type:'progress', n });
        }
        if(done){ if(buf){ handle(buf); buf = ''; } break; }
      }
    }
  } catch(err){
    // fallback: whole-file text, each part in order
    for(const file of files){
      const txt = await file.text();
      for(const line of txt.split(/\\r?\\n/)) handle(line);
    }
  }
  if(msStep && msStep>0) fs = Math.round(1000/msStep);
  const out = arr.buffer.slice(0, n*2);
  self.postMessage({ type:'done', buffer:out, n, gaps, t0Ms, fs }, [out]);
};`;
  let workerURL = null;
  // CLOCK-UNIFY: main-thread floating wall-clock timestamp parser (mirror of the worker's _ckPF). A
  // missing stamp stays null — the primary loader threads null, never a now() anchor (Clock Contract
  // §2.6). DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01 §1 removed the old wall-clock now()-fallback (dead).
  function parseTSfloat(raw) {
    if (raw == null) return null;
    const s = String(raw)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!s) return null;
    let m;
    if (/^\d{10,13}$/.test(s)) {
      let x = parseInt(s, 10);
      if (x < 1e11) x *= 1000;
      if (x < 1e11 || x > 4e12) return null;
      return x - new Date(x).getTimezoneOffset() * 60000;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
    if (m) {
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? +(m[7] + '00').slice(0, 3) : 0);
    }
    m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      let a = +m[4],
        b = +m[5],
        d,
        mo;
      if (a > 12) {
        d = a;
        mo = b;
      } else if (b > 12) {
        d = b;
        mo = a;
      } else {
        d = a;
        mo = b;
      }
      return Date.UTC(+m[6], mo - 1, d, +m[1], +m[2], +m[3]);
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      let a = +m[1],
        b = +m[2],
        d,
        mo;
      if (a > 12) {
        d = a;
        mo = b;
      } else if (b > 12) {
        d = b;
        mo = a;
      } else {
        d = a;
        mo = b;
      }
      return Date.UTC(+m[3], mo - 1, d, +m[4], +m[5], m[6] ? +m[6] : 0);
    }
    return null;
  }
  function getWorker() {
    if (!workerURL) workerURL = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
    return new Worker(workerURL);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INGEST
  // ════════════════════════════════════════════════════════════════════════
  function loadECGFile(files) {
    files = Array.isArray(files) ? files : [files];
    const pk0 = DSP.partKey ? DSP.partKey(files[0].name) : null;
    const baseName = pk0 ? pk0.base + ' · ' + files.length + ' parts' : files[0].name;
    showChip(baseName);
    const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
    progress(4, 'Streaming ' + (totalSize / 1e6).toFixed(1) + ' MB' + (files.length > 1 ? ' · ' + files.length + ' parts' : '') + '…');
    const big = totalSize > 5e6 || files.length > 1; // multi-part always streams (one continuous record)
    if (big) {
      const w = getWorker();
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === 'progress') {
          progress(Math.min(40, 4 + (d.n / 5e6) * 36), 'Parsed ' + (d.n / 1e6).toFixed(1) + 'M samples…');
        } else if (d.type === 'done') {
          w.terminate();
          const rec = { int16: new Int16Array(d.buffer), fs: d.fs, gaps: d.gaps, t0Ms: d.t0Ms != null ? d.t0Ms : null, source: 'file', durSec: d.n / d.fs };
          // R1 provenance: the streamed primary ECG bypasses the FileReader hook —
          // attest each part explicitly (name/bytes/mtime) so the export records its true inputs.
          if (window.GangliorProvenance) files.forEach((f) => GangliorProvenance.noteInput(f));
          runPipeline(rec, files[0] && files[0].name);
        }
      };
      w.postMessage({ files });
    } else {
      // small single file → inline parse on main thread (instant)
      const file = files[0];
      const fr = new FileReader();
      fr.onload = (e) => {
        const txt = e.target.result;
        const lines = txt.split(/\r?\n/);
        const arr = [];
        let t0Ms = null,
          prevMs = null,
          msStep = null;
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          const p = t.split(/[;\t,]/);
          const v = parseFloat(p[p.length - 1]);
          if (!isFinite(v)) continue;
          arr.push(Math.max(-32768, Math.min(32767, Math.round(v))));
          if (t0Ms === null) {
            const ms = parseTSfloat(p[0]);
            if (ms != null) t0Ms = ms;
          }
          if (p.length >= 3) {
            const ms = parseFloat(p[2]);
            if (isFinite(ms)) {
              if (prevMs !== null && msStep === null) {
                const d = ms - prevMs;
                if (d > 0 && d < 50) msStep = d;
              }
              prevMs = ms;
            }
          }
        }
        const fs = msStep ? Math.round(1000 / msStep) : 130;
        runPipeline({ int16: new Int16Array(arr), fs, gaps: [], t0Ms: t0Ms != null ? t0Ms : null, source: 'file', durSec: arr.length / fs }, file.name);
      };
      fr.readAsText(file);
    }
  }

  function genSynthetic() {
    const scn = $('genScenario').value;
    const map = {
      spot: { durSec: 330, scenario: 'spot' },
      hour: { durSec: 3600, scenario: 'hour' },
      overnight: { durSec: 3 * 3600, scenario: 'overnight' },
      full: { durSec: 7 * 3600, scenario: 'overnight' },
      ambulatory: { durSec: Math.round(2.4 * 3600), scenario: 'ambulatory' }
    };
    const o = map[scn] || map.overnight;
    progress(3, 'Synthesizing ' + (o.durSec / 3600).toFixed(1) + ' h of 130 Hz ECG…');
    showChip('synthetic · ' + (o.durSec >= 3600 ? (o.durSec / 3600).toFixed(1) + ' h' : o.durSec / 60 + ' min'));
    setTimeout(() => {
      const rec = DSP.genSynthetic(o);
      DEVICE_RR = rec.deviceRR; // ground-truth RR for validation
      DEVICE_HR = rec.deviceHR;
      DEVICE_ACC = rec.deviceACC;
      ACC_FS = rec.accFs;
      setLoad('rr', '✅ ground-truth RR (' + rec.deviceRR.length + ' beats)');
      setLoad('hr', '✅ ground-truth HR (' + rec.deviceHR.length + ' s)');
      setLoad('acc', '✅ ground-truth ACC (' + rec.deviceACC.length + ' samples @ ' + rec.accFs + ' Hz)');
      runPipeline(rec);
    }, 30);
  }

  // device cross-check loaders ─────────────────────────────────────────────────
  function setLoad(which, msg) {
    const st = $(which + 'Status'),
      card = $(which + 'Load');
    if (st) {
      st.textContent = msg;
      st.classList.add('ok');
    }
    if (card) {
      card.classList.add('loaded');
    }
  }
  // device cross-check loaders ── DEEP-AUDIT 2026-07-01 Finding 2: parse via the Clock-Contract-
  // faithful DSP twins (ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC — regex parseTimestamp,
  // floating wall-clock, a missing stamp stays null). The old app-local parseRows used a locale
  // Date-parse (viewer-timezone-dependent) and loadDeviceHR fabricated a wall-clock now() for a stampless row, both
  // diverging from the twins the Unifier/OverDex routed path already calls. ONE parser now, no fork.
  function loadDeviceRR(file) {
    const fr = new FileReader();
    fr.onload = (e) => {
      const out = DSP.parseDeviceRR(e.target.result);
      if (!out.length) {
        showErr('No RR values parsed from file.');
        return;
      }
      DEVICE_RR = out;
      setLoad('rr', '✅ ' + out.length.toLocaleString() + ' RR beats loaded');
      if (RESULT) {
        RESULT.deviceRR = DEVICE_RR;
        renderValidation(RESULT);
      }
    };
    fr.readAsText(file);
  }
  function loadDeviceHR(file) {
    const fr = new FileReader();
    fr.onload = (e) => {
      const out = DSP.parseDeviceHR(e.target.result); // stampless rows keep tsMs:null — never a fabricated now()
      if (!out.length) {
        showErr('No HR values parsed from file.');
        return;
      }
      DEVICE_HR = out;
      setLoad('hr', '✅ ' + out.length.toLocaleString() + ' HR samples loaded');
      if (RESULT) {
        RESULT.deviceHR = DEVICE_HR;
        renderHRValidation(RESULT);
      }
    };
    fr.readAsText(file);
  }
  function loadDeviceACC(file) {
    const fr = new FileReader();
    fr.onload = (e) => {
      const parsed = DSP.parseDeviceACC(e.target.result); // { acc:[{tsMs,x,y,z}], accFs } | { acc:null }
      if (!parsed.acc) {
        showErr('Too few ACC samples parsed (need ≥3 numeric columns per row).');
        return;
      }
      const out = parsed.acc,
        fs = parsed.accFs;
      // a STAMPLESS twin result is relative-from-0 (+_relBase); re-base onto the recording's t0Ms
      // here, as the old loader did (Clock Contract §2.6 — never fabricate a now() anchor). Inert
      // when the twin returned absolute stamps (_relBase unset).
      if (out._relBase && RESULT && RESULT.t0Ms != null) {
        out.forEach((o) => {
          o.tsMs += RESULT.t0Ms;
        });
        out._relBase = false;
      }
      DEVICE_ACC = out;
      ACC_FS = fs;
      setLoad('acc', '✅ ' + out.length.toLocaleString() + ' ACC @ ' + fs + ' Hz loaded');
      if (RESULT) {
        RESULT.deviceACC = DEVICE_ACC;
        RESULT.accFs = ACC_FS;
        // late ACC load (after analyze): stamp epoch.position + refresh event meta.position now,
        // so the export carries posture even though the ECG was analyzed ACC-less.
        if (DSP.stampEpochPositions && RESULT.epochs) {
          if (DEVICE_ACC._relBase && RESULT.t0Ms != null) {
            DEVICE_ACC.forEach((o) => {
              o.tsMs += RESULT.t0Ms;
            });
            DEVICE_ACC._relBase = false;
          }
          const ep = DSP.stampEpochPositions(RESULT.epochs, DEVICE_ACC, ACC_FS, RESULT.t0Ms, RESULT.durSec);
          const posAt = (sec) => {
            const m = sec / 60;
            for (const p of ep) {
              if (m >= p.tMin && m < p.tMin + 5) return p.position;
            }
            return ep.length ? ep[ep.length - 1].position : null;
          };
          (RESULT.events || []).forEach((ev) => {
            if (ev.impulse === 'autonomic_surge' && ev.meta && ev._sec != null) ev.meta.position = posAt(ev._sec);
          });
        }
        renderACCComparison(RESULT);
      }
    };
    fr.readAsText(file);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PIPELINE
  // ════════════════════════════════════════════════════════════════════════
  function runPipeline(rec, primaryName) {
    try {
      if (DEVICE_RR && !rec.deviceRR) rec.deviceRR = DEVICE_RR;
      if (DEVICE_HR && !rec.deviceHR) rec.deviceHR = DEVICE_HR;
      if (DEVICE_ACC && !rec.deviceACC) {
        // stampless ACC loaded before the ECG finished → re-base its relative clock onto this recording
        if (DEVICE_ACC._relBase && rec.t0Ms != null) {
          DEVICE_ACC.forEach((o) => {
            o.tsMs += rec.t0Ms;
          });
          DEVICE_ACC._relBase = false;
        }
        rec.deviceACC = DEVICE_ACC;
        rec.accFs = ACC_FS;
      }
      clearAlerts();
      setTimeout(() => {
        let r;
        try {
          r = DSP.analyze(rec, progress);
        } catch (err) {
          showErr(err.message || String(err));
          progress(0, '');
          $('prog').classList.remove('show');
          return;
        }
        RESULT = r;
        // store into the multi-recording map (key by floating t0Ms; dedupe identical)
        const key = r.t0Ms != null ? String(r.t0Ms) : 'rec_' + ++_recSeq;
        r._key = key;
        allRecordings[key] = r;
        activeKey = key;
        // §4 (ECG-INGEST-FOLLOWUPS): stash the recording's device key so a later companions-ONLY drop
        // can tell whether an incoming `_RR/_HR/_ACC` belongs to THIS recording (cross-drop awareness).
        r.deviceKey = primaryName ? ecgDeviceKey(primaryName) : rec.deviceKey || null;
        renderAll(r);
        renderRecSwitcher();
        renderCrossNight();
        document.body.classList.add('has-data');
        $('exportBar').classList.add('show');
        showOK(
          'Analyzed ' + r.nBeats + ' beats from ' + (r.durSec >= 3600 ? (r.durSec / 3600).toFixed(1) + ' h' : (r.durSec / 60).toFixed(0) + ' min') + ' of ECG · ' + r.analyzablePct + '% analyzable'
        );
        setTimeout(() => {
          $('prog').classList.remove('show');
          $('proc').textContent = '';
        }, 700);
        // advance the multi-file load queue (if any)
        if (_loadQueue.length) {
          _loadQueue.shift();
          if (_loadQueue.length) setTimeout(_processQueue, 40);
        }
      }, 20);
    } catch (err) {
      showErr(err.message || String(err));
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════
  function renderAll(r) {
    // scope
    $('scopeSection').style.display = 'block';
    if (!SCOPE) {
      SCOPE = new UI.ECGScope($('ecgCanvas'), $('ecgMini'));
      SCOPE.onView = updateScopeReadout;
    }
    SCOPE.setData(r);
    updateScopeReadout(SCOPE.view, r.fs, r.int16.length);

    if (window.ECGProfile) window.ECGProfile.render(r); // personalises r + hero + profile (before KPI/table use it)
    renderContext(r);
    renderKPI(r);
    renderQuality(r);
    renderCharts(r);
    renderCRC(r);
    renderMorph(r);
    renderSleep(r);
    renderValidation(r);
    renderHRValidation(r);
    renderACCComparison(r);
    renderGanglior(r);
    renderTable(r);

    // sidebar
    $('sidebarDataCard').style.display = 'block';
    $('sidebarDataInfo').innerHTML =
      (r.source === 'synthetic' ? 'Synthetic ECG' : 'Raw ECG file') +
      '<br>' +
      r.nBeats.toLocaleString() +
      ' beats · ' +
      r.hr +
      ' bpm · ' +
      (r.durSec >= 3600 ? (r.durSec / 3600).toFixed(1) + ' h' : (r.durSec / 60).toFixed(0) + ' min') +
      '<br>' +
      r.analyzablePct +
      '% analyzable';
  }

  function updateScopeReadout(view, fs, N) {
    const s0 = view.start / fs,
      s1 = (view.start + view.span) / fs,
      span = view.span / fs;
    const fmt = (s) => {
      const m = Math.floor(s / 60),
        sec = s % 60;
      return (m > 0 ? m + 'm ' : '') + sec.toFixed(span < 8 ? 2 : 0) + 's';
    };
    $('scopeReadout').innerHTML =
      `<span>window <b>${fmt(s0)} – ${fmt(s1)}</b></span><span>span ${span < 60 ? span.toFixed(span < 8 ? 2 : 0) + ' s' : (span / 60).toFixed(1) + ' min'}</span><span>${(N / fs / 3600).toFixed(2)} h total</span>`;
  }

  const sc = (v, ok, warn) => (v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad');
  const hrStat = (v) => (v < 35 ? 'bad' : v <= 80 ? 'ok' : v <= 95 ? 'warn' : 'bad');

  function renderContext(r) {
    const tierColor = { insufficient: 'bad', 'ultra-short': 'warn', short: 'ok', overnight: 'ok' }[r.tier] || 'neutral';
    let notes = '';
    if (r.ambulatory)
      notes =
        '<div class="ctx-note">🚶 <b>Ambulatory / awake-active</b> — ' +
        r.modeWhy.replace('ambulatory: ', '').replace(' — overnight veto', '') +
        '. The duration heuristic is overridden by activity: <b>sleep staging and the CVHR apnea screen are suppressed</b> (invalid under exercise). Heart-rate, HRV-under-activity and gait still compute.</div>';
    else if (r.tier === 'ultra-short')
      notes = '<div class="ctx-note">⚠ Ultra-short recording — SDNN, LF, VLF and LF:HF need ≥5 min and are withheld/flagged. rMSSD, pNN50, SD1 and HF remain valid.</div>';
    else if (r.tier === 'overnight')
      notes = '<div class="ctx-note">Per-epoch medians are the representative value; whole-night spread feeds SDANN / SDNN-index. CVHR & sleep staging unlocked at this length.</div>';
    else if (r.tier === 'short')
      notes = '<div class="ctx-note">5-min standard window — full short-term suite valid (Task Force 1996). Overnight metrics (VLF, DFA α1, CVHR, staging) need ≥90 min.</div>';
    const modeName = r.modeLabel || { insufficient: 'Insufficient', ['ultra-short']: 'Ultra-short', short: '5-min standard', overnight: 'Overnight' }[r.tier];
    $('ctxBanner').innerHTML = `<div class="ctx-main">
      <div><div class="ctx-mode">${modeName}</div>
      <div class="ctx-why">${r.durMin} min · ${r.nBeats.toLocaleString()} beats · ${r.fs} Hz · ${r.epochs.length} × 5-min epochs</div></div>
      <div class="ctx-conf ${r.ambulatory ? 'warn' : tierColor}">${r.ambulatory ? 'Ambulatory — sleep/apnea suppressed' : r.tierMsg}</div>
    </div>${notes}`;
    $('ctxBanner').style.display = 'flex';
  }

  function renderKPI(r) {
    const p = r.profile || {};
    /* ANS Age KPI tile REMOVED 2026-06-23 (BADGE-COVERAGE-AUDIT-FOLLOWUPS R9, external-review WP-A):
     discredited population-regression-as-age, already nulled in the node-export + deleted from the
     other nodes (OxyDex 2026-06-21, PulseDex R1). ECGDex UI had missed the removal. Do not reinstate. */
    const personalized = [
      { l: 'HRV Score', v: r.hrvScore != null ? r.hrvScore : '—', sub: 'autonomic readiness', s: r.hrvScore == null ? 'neutral' : r.hrvScore >= 45 ? 'ok' : r.hrvScore >= 33 ? 'warn' : 'bad' },
      {
        l: 'Rest HR',
        v: r.rhrEff ? r.rhrEff + 'bpm' : '—',
        sub: r.expRHR ? 'age norm ~' + r.expRHR : 'awake est',
        s: !r.rhrEff ? 'neutral' : r.rhrEff <= (r.expRHR || 62) ? 'ok' : r.rhrEff <= (r.expRHR || 62) + 8 ? 'warn' : 'bad'
      },
      { l: 'VO₂max Est', v: r.vo2adj != null ? r.vo2adj : '—', sub: 'ml/kg/min · HR-ratio', s: r.vo2adj == null ? 'neutral' : r.vo2adj >= 45 ? 'ok' : r.vo2adj >= 38 ? 'warn' : 'bad' }
    ];
    if (r.longRec && !r.ambulatory && r.apneaRisk) personalized.push({ l: 'Apnea Risk', v: r.apneaRisk.cat, sub: r.apneaRisk.note, s: r.apneaRisk.sev });
    if (r.estAHI) personalized.push({ l: 'Est. AHI', v: '≈' + r.estAHI.value, sub: '/h · ' + r.estAHI.band + ' · ECG-only', s: r.apneaRisk ? r.apneaRisk.sev : 'neutral' });
    if (r.morph) {
      personalized.push({
        l: 'Ectopy',
        v: r.morph.nPVC + r.morph.nPAC,
        sub: r.morph.ectopyBurden + '% · ' + r.morph.nPVC + 'V/' + r.morph.nPAC + 'S',
        s: r.morph.ectopyBurden < 0.5 ? 'ok' : r.morph.ectopyBurden < 3 ? 'warn' : 'bad'
      });
      const qtc = r.morph.delin.valid ? r.morph.delin.qtcBazett : null;
      personalized.push({ l: 'QTc', v: qtc == null ? '—' : qtc, sub: r.morph.delin.valid ? 'ms · Bazett' : 'withheld', s: qtc == null ? 'neutral' : qtc > 470 ? 'bad' : qtc > 450 ? 'warn' : 'ok' });
      const af = r.morph.af.verdict;
      personalized.push({
        l: 'AF Screen',
        v: { 'no-af': 'Clear', 'occasional-irregular': 'Watch', 'possible-af': 'Flag', insufficient: '—' }[af],
        sub: r.morph.af.suspiciousPct + '% irregular',
        s: { 'no-af': 'ok', 'occasional-irregular': 'warn', 'possible-af': 'bad', insufficient: 'neutral' }[af]
      });
    }
    if (r.hrvStab) {
      const hs = r.hrvStab;
      personalized.push({
        l: 'HRV Stability',
        v: (hs.sigma_lnRMSSD_slope > 0 ? '+' : '') + hs.sigma_lnRMSSD_slope,
        sub: hs.severity === 'good' ? 'stabilizing/h' : hs.severity === 'bad' ? 'rising/h' : 'flat/h',
        s: hs.severity
      });
    }
    const items = personalized.concat([
      { l: 'Mean HR', v: r.dispHr, sub: r.longRec ? 'bpm · median' : 'bpm', s: hrStat(r.dispHr) },
      {
        l: 'rMSSD' + (r.longRec ? ' (med)' : ''),
        v: r.dispRm + 'ms',
        sub: r.expRmssd ? 'age norm ~' + r.expRmssd : '≥30 good',
        s: r.expRmssd ? (r.dispRm >= r.expRmssd ? 'ok' : r.dispRm > r.expRmssd * 0.7 ? 'warn' : 'bad') : sc(r.dispRm, 30, 20)
      },
      { l: 'SDNN' + (r.longRec ? ' (med)' : ''), v: r.dispSd + 'ms', sub: r.tier === 'ultra-short' ? 'needs ≥5min' : '≥50 good', s: r.tier === 'ultra-short' ? 'neutral' : sc(r.dispSd, 50, 30) },
      {
        l: '% Analyzable',
        v: r.analyzablePct + '%',
        sub: r.coveragePct != null && r.coveragePct < 99 ? r.coveragePct + '% covered · ' + r.cleanBeatPct + '% clean' : 'night usable',
        s: r.analyzablePct >= 90 ? 'ok' : r.analyzablePct >= 75 ? 'warn' : 'bad'
      },
      ...(r.lowCoverage ? [{ l: 'Coverage', v: r.coveragePct + '%', sub: r.gapMin + ' min off-body · ' + r.nGaps + ' gap' + (r.nGaps === 1 ? '' : 's'), s: 'bad' }] : []),
      { l: 'Correction', v: r.correctionRate + '%', sub: 'beats fixed', s: r.correctionRate < 3 ? 'ok' : r.correctionRate < 8 ? 'warn' : 'bad' },
      {
        l: 'CVHR Index',
        v: r.longRec && !r.ambulatory ? r.cvhr.index : '—',
        sub: r.ambulatory ? 'suppressed · ambulatory' : r.longRec && r.profile && r.profile.cpap ? 'surges/h · on CPAP' : 'surges/h (apnea)',
        s: !r.longRec || r.ambulatory ? 'neutral' : r.cvhr.index < 5 ? 'ok' : r.cvhr.index < 15 ? 'warn' : 'bad'
      },
      { l: 'DFA α1', v: r.dfa1 == null ? '—' : r.dfa1, sub: '0.9–1.2', s: r.dfa1 == null ? 'neutral' : r.dfa1 >= 0.9 && r.dfa1 <= 1.2 ? 'ok' : r.dfa1 < 0.75 || r.dfa1 > 1.5 ? 'bad' : 'warn' },
      { l: 'Resp Rate', v: r.respRate || '—', sub: 'br/min · EDR', s: 'neutral' },
      ...(r.crc
        ? [
            { l: 'RSA Efficiency', v: r.crc.rsaEfficiencyRatio, sub: 'insp:exp HR', s: r.crc.rsaEfficiencyRatio >= 1.08 ? 'ok' : r.crc.rsaEfficiencyRatio >= 1.04 ? 'warn' : 'neutral' },
            { l: 'CR Coupling', v: r.crc.crcPLV, sub: 'PLV · RR↔resp', s: r.crc.crcPLV >= 0.5 ? 'ok' : r.crc.crcPLV >= 0.3 ? 'warn' : 'bad' }
          ]
        : []),
      { l: 'LF/HF', v: r.lfhf, sub: '0.5–2.0', s: 'neutral' },
      { l: 'Mean SQI', v: r.meanSQI, sub: '0–1 · conf', s: r.meanSQI >= 0.7 ? 'ok' : r.meanSQI >= 0.5 ? 'warn' : 'bad' }
    ]);
    $('kpiGrid').innerHTML = items
      .map(
        (k) => `<div class="kpi ${k.s}">
    <div class="kpi-label">${evBadge(k.l)}${k.l}</div><div class="kpi-val ${k.s}">${k.v}</div><div class="kpi-sub">${k.sub}</div></div>`
      )
      .join('');
    $('kpiGrid').classList.add('show');
    $('slKPI').style.display = 'flex';
  }

  function renderQuality(r) {
    const exReason = [];
    $('qualityCard').innerHTML = `
    <div class="q-grid">
      <div class="q-stat">${evBadge('Analyzable')}<div class="q-val ${r.analyzablePct >= 90 ? 'ok' : r.analyzablePct >= 75 ? 'warn' : 'bad'}">${r.analyzablePct}%</div><div class="q-lbl">Analyzable</div><div class="q-sub">clean-beat × coverage</div></div>
      <div class="q-stat">${evBadge('Beat coverage')}<div class="q-val ${r.coveragePct >= 90 ? 'ok' : r.coveragePct >= 75 ? 'warn' : 'bad'}">${r.coveragePct == null ? '—' : r.coveragePct + '%'}</div><div class="q-lbl">Beat coverage</div><div class="q-sub">${r.activeMin} of ${r.spanMin} min span${r.nGaps ? ` · ${r.nGaps} gap${r.nGaps === 1 ? '' : 's'}` : ''}</div></div>
      <div class="q-stat">${evBadge('Correction rate')}<div class="q-val ${r.correctionRate < 3 ? 'ok' : r.correctionRate < 8 ? 'warn' : 'bad'}">${r.correctionRate}%</div><div class="q-lbl">Correction rate</div><div class="q-sub">${r.nCorrected.toLocaleString()} of ${r.nBeats.toLocaleString()}${r.nEctopyCorrected ? ' · ' + r.nEctopyCorrected + ' ectopic' : ''}</div></div>
      <div class="q-stat">${evBadge('Mean SQI')}<div class="q-val ${r.meanSQI >= 0.7 ? 'ok' : r.meanSQI >= 0.5 ? 'warn' : 'bad'}">${r.meanSQI}</div><div class="q-lbl">Mean SQI</div><div class="q-sub">→ Ganglior conf</div></div>
    </div>
    ${r.lowCoverage ? `<div class="q-note" style="color:var(--amber);border:1px solid rgba(255,184,77,.25);background:rgba(255,184,77,.06);border-radius:8px;padding:10px 12px;margin-bottom:10px">⚠ <b>Low coverage:</b> beats span ${r.spanMin} min but only ${r.activeMin} min is continuously covered — ${r.gapMin} min of off-body / dropout across ${r.nGaps} gap${r.nGaps === 1 ? '' : 's'}. All metrics describe the usable signal only; duration and tier use active time, not the raw span.</div>` : ''}
    <div class="q-note">Per-beat SQI = kurtosis (kSQI) · two-detector agreement (bSQI ±50 ms) · RR plausibility (300–2000 ms) · flatline/rail · amplitude range. Coverage = active (beat-covered) time ÷ raw span — stray beats in noise after the strap comes off no longer inflate duration. Excluded spans are greyed on the waveform; SQI feeds the <b>conf</b> of every Ganglior event. <span style="opacity:.7">ACC motion-gating deferred to the Integrator (v1 is ECG-only).</span></div>`;
    $('qualitySection').style.display = 'block';
  }

  function _chartCardBadge(bodyId, label) {
    if (typeof evBadge !== 'function') return;
    const b = document.getElementById(bodyId);
    if (!b) return;
    const card = b.closest('.card,.section-card');
    if (!card) return;
    const h = card.querySelector('.card-h,.section-card-title');
    if (!h || h.querySelector('.ev')) return;
    const disc = evBadge(label);
    if (disc) h.insertAdjacentHTML('afterbegin', disc + ' ');
  }

  function renderCharts(r) {
    // tachogram (downsample NN for display)
    const stepT = Math.max(1, Math.floor(r.nn.length / 1600));
    const tach = [];
    for (let i = 0; i < r.nn.length; i += stepT) tach.push({ x: r.tt[i] / 60, y: r.nn[i] });
    $('tachoBody').innerHTML = UI.lineChart(tach, UI.COLORS.teal, { W: 680, H: 170, med: r.medianRR, xfmt: (x) => x.toFixed(0) + 'm' });
    // poincaré — plot the exact array SD1/SD2 were computed from (ellipse matches cloud)
    $('poincareBody').innerHTML = UI.poincare(r.poincareNN || r.nn, r.sd1, r.sd2);
    $('poincareStats').innerHTML =
      `SD1 <b>${r.sd1}</b> ms · SD2 <b>${r.sd2}</b> ms · SD1/SD2 <b>${r.sd1sd2}</b> · area <b>${r.ellArea.toLocaleString()}</b> ms²` +
      (r.poincareRep ? ` <span style="opacity:.6">· representative 5-min window</span>` : '');
    // rMSSD trend (epochs)
    if (r.epochs.length >= 3) {
      const rmPts = r.epochs.map((e) => ({ x: e.tMin, y: e.rmssd }));
      const hrPts = r.epochs.map((e) => ({ x: e.tMin, y: e.hr }));
      $('trendBody').innerHTML =
        `<div class="mini-h">${evBadge('rMSSD')}rMSSD per 5-min epoch <span class="mini-sub">median ${r.dispRm} ms</span></div>` +
        UI.lineChart(rmPts, UI.COLORS.teal, { W: 680, H: 140, med: r.dispRm, xfmt: (x) => (x / 60).toFixed(1) + 'h' }) +
        `<div class="mini-h" style="margin-top:10px">${evBadge('Mean HR')}Heart rate per epoch <span class="mini-sub">median ${r.dispHr} bpm</span></div>` +
        UI.lineChart(hrPts, UI.COLORS.blue, { W: 680, H: 140, med: r.dispHr, xfmt: (x) => (x / 60).toFixed(1) + 'h' });
      $('trendCard').style.display = 'block';
    } else $('trendCard').style.display = 'none';
    // CVHR
    if (r.longRec && !r.ambulatory && r.cvhr.hrSeries && r.cvhr.hrSeries.length > 30) {
      const hs = r.cvhr.hrSeries;
      const stepC = Math.max(1, Math.floor(hs.length / 1400));
      const pts = [];
      for (let i = 0; i < hs.length; i += stepC) pts.push({ x: i / 60, y: hs[i] });
      const marks = r.cvhr.events.map((e) => e.sec / 60);
      $('cvhrBody').innerHTML =
        `<div class="mini-h">Smoothed HR with cyclic-variation events <span class="mini-sub">${r.cvhr.events.length} surges · index ${r.cvhr.index}/h</span></div>` +
        UI.lineChart(pts, UI.COLORS.amber, { W: 680, H: 150, marks, xfmt: (x) => (x / 60).toFixed(1) + 'h' }) +
        (r.estAHI
          ? `<div class="gang-summary" style="margin-top:10px">
         <div class="gang-pill" style="border-color:var(--${r.apneaRisk.sev === 'good' ? 'green' : r.apneaRisk.sev === 'warn' ? 'amber' : 'red'});color:var(--${r.apneaRisk.sev === 'good' ? 'green' : r.apneaRisk.sev === 'warn' ? 'amber' : 'red'})"><b>Est. AHI ≈ ${r.estAHI.value}</b>/h (${r.estAHI.lo}–${r.estAHI.hi}) · ${r.estAHI.band}${r.estAHI.onCPAP ? ' · residual on CPAP' : ''}</div>
         <div class="gang-pill">from ECG alone · no SpO₂</div>
         <div class="gang-pill">osaLabel <b>null</b> · transformer Phase 2</div>
       </div>`
          : '') +
        `<div class="q-note" style="margin-top:8px">Red ticks mark detected <b>cyclic variation of heart rate</b> — the bradycardia→rebound autonomic signature of sleep-disordered breathing. Each becomes an <code>autonomic_surge</code> event on the Ganglior bus. <b>Estimated AHI</b> maps the CVHR index to the clinical apnea–hypopnea scale (cardiopulmonary-coupling proxy, Hilmisson 2019) — screen-only, confirm with PSG or an SpO₂ node. Per-second transformer OSA labels (Almarshad 2026) are the Phase-2 upgrade; the bus <code>osaLabel</code>/<code>osaConf</code> fields are reserved and currently null.</div>`;
      $('cvhrCard').style.display = 'block';
    } else $('cvhrCard').style.display = 'none';
    $('chartsSection').style.display = 'block';
    _chartCardBadge('tachoBody', 'Mean RR');
    _chartCardBadge('poincareBody', 'SD1');
    _chartCardBadge('cvhrBody', 'CVHR index');
  }

  function renderCRC(r) {
    const c = r.crc;
    if (!c) {
      $('crcCard').style.display = 'none';
      return;
    }
    const NB = c.nbins || 16;
    // phase-averaged HR across the respiratory cycle (RSA shape) — plot one-and-a-bit cycles
    const curve = c.phaseCurve || [];
    const pts = [];
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < curve.length; i++) {
        if (curve[i] == null) continue;
        pts.push({ x: ((rep * NB + i) / NB) * 360, y: curve[i] });
      }
    }
    const ratioSev = c.rsaEfficiencyRatio >= 1.08 ? 'good' : c.rsaEfficiencyRatio >= 1.04 ? 'warn' : 'neutral';
    const plvSev = c.crcPLV >= 0.5 ? 'good' : c.crcPLV >= 0.3 ? 'warn' : 'bad';
    const ratioCol = { good: UI.COLORS.green, warn: UI.COLORS.amber, bad: UI.COLORS.red, neutral: UI.COLORS.dim }[ratioSev];
    const plvCol = { good: UI.COLORS.green, warn: UI.COLORS.amber, bad: UI.COLORS.red }[plvSev];

    // per-epoch PLV trend (overnight)
    let epochChart = '';
    if (c.epochCRC && c.epochCRC.length >= 4) {
      const ep = c.epochCRC.map((e) => ({ x: e.tMin, y: e.plv }));
      const surgeMarks = r.longRec && r.cvhr && r.cvhr.events ? r.cvhr.events.map((e) => e.sec / 60) : [];
      epochChart =
        `<div class="mini-h" style="margin-top:14px">Coupling strength (PLV) across the night <span class="mini-sub">red ticks = CVHR surges</span></div>` +
        UI.lineChart(ep, UI.COLORS.blue, { W: 680, H: 140, ymn: 0, ymx: 1, marks: surgeMarks, xfmt: (x) => (x / 60).toFixed(1) + 'h' });
    }

    // CVHR-confidence cross-reference
    let confNote = '';
    if (c.plvDuringSurges != null && c.plvBaseline != null) {
      const drop = c.plvBaseline > 0 ? Math.round((1 - c.plvDuringSurges / c.plvBaseline) * 100) : 0;
      confNote =
        drop > 8
          ? `Coupling falls <b>${drop}%</b> during CVHR clusters (PLV ${c.plvDuringSurges} vs ${c.plvBaseline} baseline) — the expected autonomic–respiratory de-coupling of sleep-disordered breathing, which <b>raises confidence</b> in those surge calls.`
          : `Coupling is roughly stable across surge vs baseline windows (PLV ${c.plvDuringSurges} vs ${c.plvBaseline}) — surges here are less clearly breathing-driven.`;
    }

    $('crcBody').innerHTML =
      `<div class="mini-h">Phase-averaged HR over the respiratory cycle <span class="mini-sub">RSA — inspiratory rise vs expiratory fall</span></div>` +
      (pts.length > 4
        ? UI.lineChart(pts, ratioCol, { W: 680, H: 150, xfmt: (x) => x.toFixed(0) + '°' })
        : `<div class="q-note" style="padding:18px 8px;text-align:center">RSA phase curve unavailable — too few clean respiratory cycles.</div>`) +
      `<div class="gang-summary" style="margin-top:10px">
         <div class="gang-pill" style="border-color:${ratioCol};color:${ratioCol}"><b>RSA efficiency ${c.rsaEfficiencyRatio}</b> insp:exp HR · higher = stronger</div>
         <div class="gang-pill">RSA swing <b>${c.rsaAmplitudeBpm}</b> bpm</div>
         <div class="gang-pill" style="border-color:${plvCol};color:${plvCol}"><b>CRC PLV ${c.crcPLV}</b> · phase-lock</div>
         <div class="gang-pill">coupling strength <b>${c.couplingStrength}</b>/1</div>
         <div class="gang-pill">EDR resp ${c.respFromEDR} br/min</div>
       </div>` +
      epochChart +
      `<div class="q-note" style="margin-top:8px"><b>All three from the ECG alone — no airflow, no PPG.</b> EDR (R-peak amplitude modulation) gives respiration; locking it to the RR oscillation yields cardiorespiratory coupling. <b>RSA efficiency</b> is the inspiratory:expiratory HR ratio — efficient hearts raise HR on inspiration to minimise cardiac power (Border et al. 2025). <b>PLV</b> is the model-free RR↔respiration phase-lock (arXiv:2508.00773); <b>coupling strength</b> is a CSI-style single-number sync index (arXiv:2605.18802). ${confNote} <span style="opacity:.7">Informational — zero new sensors, computed from existing pipeline outputs.</span></div>`;
    $('crcCard').style.display = 'block';
    _chartCardBadge('crcBody', 'CRC PLV');
  }

  function renderMorph(r) {
    const m = r.morph;
    if (!m) {
      $('morphSection').style.display = 'none';
      return;
    }
    const d = m.delin,
      af = m.af;
    const delinOK = d && d.valid;
    // median beat + delineation (only if a valid beat was built)
    if (delinOK && m.medianBeat && m.medianBeat.valid) {
      $('medianBeatBody').innerHTML = UI.medianBeatChart(m.medianBeat, d);
      $('medianBeatStats').innerHTML =
        `median of <b>${m.medianBeat.nUsed}</b> normal beats · R <b>${d.Ramp}</b>µV · T <b>${d.Tamp}</b>µV${d.pPresent ? ` · P <b>${d.Pamp}</b>µV` : ' · P not resolved'}`;
    } else {
      $('medianBeatBody').innerHTML =
        `<div class="q-note" style="padding:24px 8px;text-align:center">⚠ Median beat could not be built — too few clean, well-aligned normal beats in this recording. Interval delineation (QRS/QT/QTc/PR/ST) is withheld rather than reported as unreliable values.</div>`;
      $('medianBeatStats').innerHTML = '';
    }

    // ectopy / rhythm summary cards
    const eb = (label, val, sub, sev) =>
      `<div class="q-stat">${typeof evBadge === 'function' ? evBadge(label) : ''}<div class="q-val ${sev}">${val}</div><div class="q-lbl">${label}</div><div class="q-sub">${sub}</div></div>`;
    const pvcSev = m.pvcBurden < 0.5 ? 'ok' : m.pvcBurden < 3 ? 'warn' : 'bad';
    const pacSev = m.pacBurden < 0.5 ? 'ok' : m.pacBurden < 3 ? 'warn' : 'bad';
    $('ectopyBody').innerHTML = `<div class="q-grid">
      ${eb('PVCs (V)', m.nPVC, m.pvcBurden + '% burden', pvcSev)}
      ${eb('PACs (S)', m.nPAC, m.pacBurden + '% burden', pacSev)}
      ${eb('Couplets', m.couplets, m.runsGE3 + ' run(s) ≥3', m.runsGE3 > 0 ? 'bad' : m.couplets > 0 ? 'warn' : 'ok')}
      ${eb('Bigeminy', m.bigeminyCycles, 'N-V cycles', m.bigeminyCycles > 3 ? 'warn' : 'ok')}
    </div>
    <div class="q-note">Beats classified <b>N / PVC / PAC</b> from prematurity, QRS width (median ${m.medW} ms) &amp; template correlation; ectopic beats are tagged on the waveform above (PVC purple, PAC blue). ${m.runsGE3 > 0 ? '<b style="color:var(--red)">⚠ Ventricular run(s) ≥3 beats detected — review.</b>' : 'No ventricular runs ≥3.'}</div>`;

    // intervals + AF
    const cell = (l, v, u, nr, sev, note) =>
      `<tr><td style="color:var(--text2);font-weight:600;font-family:Inter,sans-serif">${typeof evBadge === 'function' ? evBadge(l) : ''}${l}</td><td class="${sev}">${v == null ? '—' : v}</td><td style="color:var(--text3)">${u}</td><td style="color:var(--text3)">${nr}</td><td style="color:var(--text3);font-family:Inter,sans-serif;font-size:11px">${note}</td></tr>`;
    const qtcSev = !delinOK || d.qtcBazett == null ? 'neutral' : d.qtcBazett > 470 ? 'bad' : d.qtcBazett > 450 ? 'warn' : 'ok';
    const qrsSev = !delinOK || d.qrsDur == null ? 'neutral' : d.qrsDur > 120 ? 'bad' : d.qrsDur > 110 ? 'warn' : 'ok';
    const prSev = !delinOK || d.pr == null ? 'neutral' : d.pr > 220 ? 'warn' : d.pr < 120 ? 'warn' : 'ok';
    const afColor = { 'no-af': 'ok', 'occasional-irregular': 'warn', 'possible-af': 'bad', insufficient: 'neutral' }[af.verdict];
    const afLabel = { 'no-af': 'No AF pattern', 'occasional-irregular': 'Occasional irregularity', 'possible-af': '⚠ Possible AF — confirm 12-lead', insufficient: 'Insufficient' }[af.verdict];
    const intervalsRows = delinOK
      ? `
      ${cell('QRS duration', d.qrsDur, 'ms', '&lt;110', qrsSev, 'Ventricular depolarisation width')}
      ${cell('QT', d.qt, 'ms', '—', 'neutral', 'Q-onset → T-end (tangent)')}
      ${cell('QTc (Bazett)', d.qtcBazett, 'ms', '&lt;450 M / &lt;460 F', qtcSev, 'Rate-corrected QT')}
      ${cell('QTc (Fridericia)', d.qtcFrid, 'ms', '&lt;450', !delinOK || d.qtcFrid == null ? 'neutral' : d.qtcFrid > 460 ? 'warn' : 'ok', 'Less rate-biased')}
      ${cell('PR', d.pr, 'ms', '120–200', prSev, d.pPresent ? 'P-onset → QRS-onset' : 'P-wave not resolved @130 Hz')}
      ${cell('ST level', d.st, 'µV', '±100', 'neutral', 'At J+60 ms vs baseline')}`
      : `<tr><td colspan="5" style="color:var(--text3);font-family:Inter,sans-serif;padding:14px">Intervals withheld — no valid median beat (insufficient clean, aligned normal beats).</td></tr>`;
    $('morphIntervals').innerHTML = `
    <table><thead><tr><th>Interval</th><th>Value</th><th>Unit</th><th>Normal</th><th>Notes</th></tr></thead><tbody>
      ${intervalsRows}
    </tbody></table>
    ${(() => {
      const qt = m.qtcTrend,
        tw = m.twa;
      const twaPill = tw
        ? `<div class="gang-pill" style="border-color:var(--${tw.abnormal ? 'red' : 'green'});color:var(--${tw.abnormal ? 'red' : 'green'})"><b>T-wave alternans:</b> ${tw.uv} µV${tw.abnormal ? ' · abnormal (≥47)' : ' · normal'}</div>`
        : '';
      let chart = '';
      if (qt && qt.length >= 2 && UI && UI.lineChart) {
        const pts = qt.map((p) => ({ x: p.tMin, y: p.qtc }));
        const lo = Math.min(...qt.map((p) => p.qtc)),
          hi = Math.max(...qt.map((p) => p.qtc));
        chart =
          `<div class="mini-h" style="margin-top:14px">Nocturnal QTc trend <span class="mini-sub">${qt.length} × 15-min windowed median beats · ${lo}–${hi} ms · the GlucoDex cross-node feed</span></div>` +
          UI.lineChart(pts, '#FFB84D', { W: 680, H: 140, ymn: Math.max(300, lo - 15), ymx: hi + 15, xfmt: (x) => (x / 60).toFixed(1) + 'h' });
      }
      if (!qt && !tw) return '';
      return `<div class="gang-summary" style="margin-top:12px">${twaPill}${qt ? `<div class="gang-pill">QTc trend: <b>${qt.length}</b> windows → export</div>` : `<div class="gang-pill" style="opacity:.7">QTc trend: too short for windows</div>`}</div>${chart}
      <div class="q-note" style="margin-top:8px"><b>New in 1.2 — exported to the bus.</b> The <b>QTc trend</b> is per-15-min windowed median-beat QTc; GlucoDex lines it up against overnight glucose so a QTc that rises as glucose falls surfaces the beat-level hypoglycemia⟷repolarisation link. <b>T-wave alternans</b> (MMA, ST-T) is a repolarisation-instability screen — ≥47 µV is the MTWA abnormal cutoff. Both single-lead, directional.</div>`;
    })()}
    <div class="gang-summary" style="margin-top:12px">
      <div class="gang-pill" style="border-color:var(--${afColor === 'ok' ? 'green' : afColor === 'warn' ? 'amber' : afColor === 'bad' ? 'red' : 'blue'});color:var(--${afColor === 'ok' ? 'green' : afColor === 'warn' ? 'amber' : afColor === 'bad' ? 'red' : 'blue'})"><b>AF screen:</b> ${afLabel}</div>
      <div class="gang-pill">irregularity ${af.irregIndex}</div>
      <div class="gang-pill">ΔRR entropy ${af.shannon}</div>
      <div class="gang-pill">${af.suspiciousPct}% windows flagged</div>
    </div>
    <div class="q-note" style="margin-top:10px"><b>Directional, not diagnostic.</b> A single lead at 130 Hz resolves QRS/QT/PR/ST as <b>within-subject overnight trends</b>, not 12-lead clinical measurements. AF screen is RR-irregularity-based — P-wave morphology is weak at this rate, so it screens only and never diagnoses.</div>`;
    $('morphSection').style.display = 'block';
    _chartCardBadge('medianBeatBody', 'QRS duration');
    _chartCardBadge('ectopyBody', 'PVC burden');
    _chartCardBadge('morphIntervals', 'QTc');
  }

  function renderSleep(r) {
    if (r.longRec && r.ambulatory) {
      $('hypnoBody').innerHTML =
        '<div class="q-note" style="margin:6px 0"><span class="pill pill-gray">Suppressed</span> Sleep staging withheld — ' +
        r.modeWhy +
        '. A hypnogram is not published for an ambulatory recording (a walk is not a sleep study).</div>';
      $('sleepStats').innerHTML = '';
      $('hypnoCard').style.display = 'block';
    } else if (r.longRec && r.stages.length) {
      $('hypnoBody').innerHTML = UI.hypnogram(r.stages);
      const sm = r.stageMin;
      $('sleepStats').innerHTML = ['Deep', 'Light', 'REM', 'Wake']
        .map((st) => {
          const col = { Deep: UI.COLORS.blue, Light: UI.COLORS.teal, REM: UI.COLORS.purple, Wake: UI.COLORS.amber }[st];
          const pct = r.totSleep ? (st === 'Wake' ? '' : ' · ' + ((sm[st] / r.totSleep) * 100).toFixed(0) + '%') : '';
          return `<div class="sl-stat"><span class="sl-dot" style="background:${col}"></span>${st} <b>${sm[st].toFixed(0)}m</b><span class="sl-pct">${pct}</span></div>`;
        })
        .join('');
      $('hypnoCard').style.display = 'block';
    } else $('hypnoCard').style.display = 'none';

    // Dynamic HRV stability (Li & Kiyono 2026)
    const hs = r.hrvStab;
    if (hs) {
      const sevColor = { good: UI.COLORS.green, warn: UI.COLORS.amber, bad: UI.COLORS.red }[hs.severity];
      const pts = hs.series.map((p) => ({ x: p.tMin / 60, y: p.lnSD }));
      const slopeArrow = hs.sigma_lnRMSSD_slope > 0.015 ? '↗' : hs.sigma_lnRMSSD_slope < -0.015 ? '↘' : '→';
      const esc = r.surgeEsc;
      $('stabilityBody').innerHTML =
        `<div class="mini-h">bσ(ln RMSSD) — within-window instability across the night <span class="mini-sub">slope ${slopeArrow} ${hs.sigma_lnRMSSD_slope}/h over ${hs.nWindows} windows</span></div>` +
        UI.lineChart(pts, sevColor, { W: 680, H: 150, xfmt: (x) => x.toFixed(1) + 'h' }) +
        `<div class="gang-summary" style="margin-top:10px">
           <div class="gang-pill" style="border-color:${sevColor};color:${sevColor}"><b>${hs.classification}</b></div>
           <div class="gang-pill">bσ slope <b>${hs.sigma_lnRMSSD_slope}</b>/h</div>
           <div class="gang-pill">bs² slope <b>${hs.var_lnRMSSD_slope}</b>/h</div>
           ${esc ? `<div class="gang-pill">surge density ${esc.escalationPct > 0 ? '+' : ''}${esc.escalationPct}% late-night</div>` : ''}
         </div>
         <div class="q-note" style="margin-top:8px">The within-night <b>trend</b> of ln(RMSSD) instability — not its mean — tracks glucose metabolism (Cohen's |d| &gt; 1.1). <b>Decreasing</b> overnight = progressive autonomic stabilization (favourable); <b>increasing</b> = persistent instability, a glycemic-risk signal. ${esc ? esc.label + '.' : ''} Informational — feeds the future GlucoDex node, not a diagnosis. <span style="opacity:.7">Li &amp; Kiyono 2026, Sensors 26(4):1118 [CC BY 4.0]</span></div>`;
      $('stabilityCard').style.display = 'block';
    } else $('stabilityCard').style.display = 'none';
  }

  function renderValidation(r) {
    const v = DSP.validateRR(r.nn, r.deviceRR);
    if (!v) {
      $('valCard').style.display = 'none';
      return;
    }
    const cell = (a, b, d, unit) => `<td class="mono">${a}</td><td class="mono">${b}</td><td class="mono ${d < 5 ? 'ok' : d < 12 ? 'warn' : 'bad'}">${d}%</td>`;
    $('valBody').innerHTML = `
    <table><thead><tr><th>Metric</th><th>Self (ECG)</th><th>Device RR</th><th>Δ</th><th>Verdict</th></tr></thead><tbody>
    <tr><td>Beats</td><td class="mono">${v.nSelf.toLocaleString()}</td><td class="mono">${v.nDev.toLocaleString()}</td><td class="mono">${Math.abs(v.nSelf - v.nDev)}</td><td>${Math.abs(v.nSelf - v.nDev) / v.nDev < 0.03 ? '<span class="pill pill-green">match</span>' : '<span class="pill pill-yellow">check</span>'}</td></tr>
    <tr><td>Mean RR</td>${cell(v.selfMean, v.devMean, v.dMean)}<td>${v.dMean < 2 ? '<span class="pill pill-green">match</span>' : '<span class="pill pill-yellow">drift</span>'}</td></tr>
    <tr><td>RMSSD</td>${cell(v.selfRMSSD, v.devRMSSD, v.dRMSSD)}<td>${v.dRMSSD < 5 ? '<span class="pill pill-green">within %</span>' : v.dRMSSD < 12 ? '<span class="pill pill-yellow">close</span>' : '<span class="pill pill-red">off</span>'}</td></tr>
    <tr><td>SDNN</td>${cell(v.selfSDNN, v.devSDNN, v.dSDNN)}<td>${v.dSDNN < 5 ? '<span class="pill pill-green">within %</span>' : v.dSDNN < 12 ? '<span class="pill pill-yellow">close</span>' : '<span class="pill pill-red">off</span>'}</td></tr>
    </tbody></table>
    <div class="q-note">One-time offline check (§3a): self-computed RR (sub-sample-refined Pan-Tompkins R-peaks) vs the device's firmware RR — <b>both Malik-corrected</b> so the comparison is artifact-free on each side. Clean signal should agree within a few %. ${r.source === 'synthetic' ? '<b>Device RR here is the synthetic ground truth.</b>' : ''} ${v.dRMSSD < 5 && v.dSDNN < 8 ? '<b style="color:var(--green)">✓ Self-RR validated — Plan A (full HRV from ECG) is sound.</b>' : 'Larger gaps would trigger the Plan-B fallback: export computed RR for PulseDex.'}${v.devEctopyCorrected ? ` <span style="opacity:.8">· ${v.devEctopyCorrected} ectopic/artifact beat${v.devEctopyCorrected > 1 ? 's' : ''} corrected in the device RR (raw device rMSSD ${v.devRawRMSSD} → ${v.devRMSSD} ms; ectopy, or a strap-missed beat, inflates the uncorrected value).</span>` : ''}</div>`;
    $('valCard').style.display = 'block';
  }

  // dual-line overlay (two series on a shared y-scale) — for HR/breathing cross-checks
  function dualLineSVG(pts, opts) {
    opts = opts || {};
    const W = opts.W || 680,
      H = opts.H || 160,
      P = { l: 46, r: 14, t: 14, b: 24 };
    const ca = opts.ca || UI.COLORS.teal,
      cb = opts.cb || UI.COLORS.amber;
    let ymn = Infinity,
      ymx = -Infinity,
      xmn = Infinity,
      xmx = -Infinity;
    for (const p of pts) {
      for (const v of [p.a, p.b]) {
        if (v != null && isFinite(v)) {
          if (v < ymn) ymn = v;
          if (v > ymx) ymx = v;
        }
      }
      if (p.x < xmn) xmn = p.x;
      if (p.x > xmx) xmx = p.x;
    }
    if (!isFinite(ymn)) return '';
    if (ymx === ymn) ymx = ymn + 1;
    if (xmx === xmn) xmx = xmn + 1;
    const pad = (ymx - ymn) * 0.08;
    ymn -= pad;
    ymx += pad;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const path = (key) => {
      let d = '',
        pen = false;
      for (const p of pts) {
        const v = p[key];
        if (v == null || !isFinite(v)) {
          pen = false;
          continue;
        }
        d += (pen ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(v).toFixed(1) + ' ';
        pen = true;
      }
      return d;
    };
    const xt = [];
    for (let i = 0; i <= 5; i++) xt.push(xmn + (i * (xmx - xmn)) / 5);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${UI.COLORS.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${UI.COLORS.axis}"/>
    <text x="${P.l - 6}" y="${(sy(ymx) + 4).toFixed(1)}" fill="${UI.COLORS.dim}" font-size="9" text-anchor="end" font-family="monospace">${ymx.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 4).toFixed(1)}" fill="${UI.COLORS.dim}" font-size="9" text-anchor="end" font-family="monospace">${ymn.toFixed(0)}</text>
    ${xt.map((x) => `<text x="${sx(x).toFixed(1)}" y="${H - 7}" fill="${UI.COLORS.dim}" font-size="9" text-anchor="middle" font-family="monospace">${opts.xfmt ? opts.xfmt(x) : x.toFixed(0)}</text>`).join('')}
    <path d="${path('b')}" fill="none" stroke="${cb}" stroke-width="1.4" opacity=".82"/>
    <path d="${path('a')}" fill="none" stroke="${ca}" stroke-width="1.6"/>
  </svg>`;
  }

  function renderHRValidation(r) {
    const v = DSP.validateHR(r.cvhr && r.cvhr.hrSeries, r.deviceHR, r.t0Ms);
    if (!v) {
      $('hrCard').style.display = 'none';
      return;
    }
    const overlay = v.overlay.map((o) => ({ x: o.t, a: o.ecg, b: o.dev }));
    // x-axis adapts to recording length — minutes for a short spot, hours overnight (a fixed
    // '/3600 h' rendered a 6-min clip as a useless row of "0.0h").
    const spanSec = overlay.length > 1 ? overlay[overlay.length - 1].x - overlay[0].x : 0;
    const xfmt = spanSec >= 5400 ? (x) => (x / 3600).toFixed(1) + 'h' : (x) => Math.round(x / 60) + 'm';
    // r only MEANS agreement when HR actually varied over a long-enough window; flat/short → noise.
    const rPill = !v.rMeaningful
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,255,255,.07);color:var(--text3)">flat · n/a</span>'
      : v.r >= 0.95
        ? '<span class="pill pill-green">excellent</span>'
        : v.r >= 0.85
          ? '<span class="pill pill-yellow">good</span>'
          : '<span class="pill pill-red">weak</span>';
    $('hrBody').innerHTML = `
    <table><thead><tr><th>Metric</th><th>ECG-derived</th><th>Device HR</th><th>Δ / verdict</th></tr></thead><tbody>
    <tr><td>Mean HR</td><td class="mono">${v.ecgMean}</td><td class="mono">${v.devMean}</td><td class="mono ${v.dMean < 2 ? 'ok' : v.dMean < 5 ? 'warn' : 'bad'}">Δ ${v.dMean} bpm</td></tr>
    <tr><td>Range (bpm)</td><td class="mono">${v.ecgMin}–${v.ecgMax}</td><td class="mono">${v.devMin}–${v.devMax}</td><td>—</td></tr>
    <tr><td>Mean abs error</td><td class="mono" colspan="2" style="text-align:center">${v.mae} bpm <span style="color:var(--text3)">(max ${v.maxErr})</span></td><td>${v.mae < 2 ? '<span class="pill pill-green">tight</span>' : v.mae < 5 ? '<span class="pill pill-yellow">close</span>' : '<span class="pill pill-red">off</span>'}</td></tr>
    <tr><td>Correlation r</td><td class="mono" colspan="2" style="text-align:center">${v.rMeaningful ? v.r : '—'}</td><td>${rPill}</td></tr>
    </tbody></table>
    <div class="mini-h" style="margin-top:12px">HR across the recording <span class="mini-sub"><span style="color:${UI.COLORS.teal}">●</span> ECG-derived&nbsp;&nbsp;<span style="color:${UI.COLORS.amber}">●</span> device</span></div>
    ${dualLineSVG(overlay, { ca: UI.COLORS.teal, cb: UI.COLORS.amber, xfmt })}
    <div class="q-note" style="margin-top:8px"><b>Secondary check.</b> The <a href="#valCard" style="color:${UI.COLORS.teal}">Device RR validation</a> above — beat-to-beat paired intervals — is the authoritative agreement test; this is a smoothed-HR trend overlay. Device HR (bpm) over HR from sub-sample-refined R-peaks on the shared timeline. ${r.source === 'synthetic' ? '<b>Device HR here is the synthetic ground truth.</b> ' : ''}${!v.rMeaningful ? 'HR stayed near-constant over this window (spread ' + v.spreadE + '/' + v.spreadD + " bpm), so the correlation isn't meaningful — judge agreement by the mean Δ and the RR card." : v.r >= 0.9 && v.mae < 3 ? '<b style="color:var(--green)">✓ Beat detection tracks the device firmware.</b>' : 'A low r alongside a tight mean Δ usually means a flat HR stretch, not a detection miss — confirm against the RR card.'}</div>`;
    $('hrCard').style.display = 'block';
  }

  function renderACCComparison(r) {
    const a = DSP.accAnalyze(r.deviceACC, r.accFs, r.t0Ms, r.durSec, r.epochs);
    if (!a) {
      $('accCard').style.display = 'none';
      return;
    }
    // breathing tie: ACC-derived resp vs ECG-derived (EDR / Lomb) respiration
    const edrResp = r.crc && r.crc.respFromEDR ? r.crc.respFromEDR : r.respRate || null;
    const accResp = a.respConfident ? a.respRate : null;
    const dResp = edrResp != null && accResp != null ? +Math.abs(accResp - edrResp).toFixed(1) : null;
    const respPill =
      dResp == null ? '' : dResp < 2 ? '<span class="pill pill-green">agree</span>' : dResp < 4 ? '<span class="pill pill-yellow">close</span>' : '<span class="pill pill-red">diverge</span>';
    // posture
    const postureIcon = { Supine: '🛏️', Prone: '🛌', Upright: '🧍', Inverted: '🙃', 'Left side': '↩️', 'Right side': '↪️', 'Head-down': '🙃' }[a.posture] || '🧭';
    const longPosture = a.postureBreakdown && a.postureBreakdown.length > 1;
    const posturePills = longPosture ? a.postureBreakdown.map((p) => `<div class="gang-pill">${p.label} <b>${p.pct}%</b></div>`).join('') : '';
    // motion tie: how many high-motion epochs fall in Wake/REM (vs deep/light)
    const stageAt = {};
    (r.stages || []).forEach((s) => (stageAt[s.tMin.toFixed(1)] = s.stage));
    const hi = a.highMotionEpochs;
    const inWakeREM = hi.filter((t) => ['Wake', 'REM'].includes(stageAt[t.toFixed(1)])).length;
    const stagePct = hi.length ? Math.round((inWakeREM / hi.length) * 100) : 0;
    const surgeMin = r.cvhr && r.cvhr.events ? r.cvhr.events.map((e) => e.sec / 60) : [];
    const nearSurge = hi.filter((t) => surgeMin.some((m) => Math.abs(m - t) < 5)).length;

    // motion graph — always rendered when ACC present (fixed-bin, works for short spots too)
    let motionChart = '';
    if (a.motionSeries && a.motionSeries.length >= 3) {
      const span = a.durMin;
      motionChart =
        `<div class="mini-h" style="margin-top:14px">Motion / movement trace <span class="mini-sub">de-gravitated accel · ${a.nSamples.toLocaleString()} samples @ ${a.accFs} Hz${surgeMin.length ? ' · red ticks = CVHR clusters' : ''}</span></div>` +
        UI.lineChart(a.motionSeries, UI.COLORS.purple, {
          W: 680,
          H: 140,
          ymn: 0,
          med: a.motionMedian,
          marks: surgeMin.map((m) => m),
          xfmt: (x) => (span > 90 ? (x / 60).toFixed(1) + 'h' : x.toFixed(0) + 'm')
        });
    } else {
      motionChart = `<div class="q-note" style="margin-top:10px">Motion trace needs a longer recording to plot — current sample is too short.</div>`;
    }

    const quiet = hi.length === 0;
    $('accBody').innerHTML =
      `
    <div class="acc-posture">
      <div class="acc-posture-main">
        <span class="acc-posture-icon">${postureIcon}</span>
        <div>
          <div class="acc-posture-label">${a.posture}</div>
          <div class="acc-posture-sub">body position · tilt ${a.tiltDeg}° from horizontal${a.postureTransitions ? ` · ${a.postureTransitions} position change${a.postureTransitions > 1 ? 's' : ''}` : ''}</div>
        </div>
      </div>
      ${longPosture ? `<div class="gang-summary" style="margin:0">${posturePills}</div>` : ''}
    </div>
    <div class="gang-summary">
      <div class="gang-pill"><b>ACC breathing ${accResp != null ? accResp + ' br/min' : '—'}</b>${accResp != null ? ' · axis ' + a.respAxis : ' (motion-limited)'}</div>
      ${edrResp != null ? `<div class="gang-pill">ECG/EDR breathing <b>${edrResp}</b> br/min</div>` : ''}
      ${dResp != null ? `<div class="gang-pill" style="border-color:${dResp < 2 ? UI.COLORS.green : dResp < 4 ? UI.COLORS.amber : UI.COLORS.red}">Δ ${dResp} br/min ${respPill}</div>` : ''}
    </div>
    ${motionChart}
    <div class="q-note" style="margin-top:8px"><b>Three ties to the ECG, no extra interpretation needed.</b>
      <b>Posture:</b> body position from the accelerometer gravity vector (tilt ${a.tiltDeg}° → ${a.posture}) — context the ECG can't give on its own (e.g. orthostatic vs supine HRV).
      <b>Breathing:</b> respiration from chest-axis ACC movement vs the ECG-derived (EDR) respiration${dResp != null ? ` — they ${dResp < 2 ? 'agree to within ' + dResp + ' br/min, cross-validating both' : 'differ by ' + dResp + ' br/min'}` : ''}.
      ${quiet ? '<b>Motion:</b> little movement in this recording — consistent with a still, ' + a.posture.toLowerCase() + ' measurement.' : `<b>Motion:</b> ${hi.length} high-motion epoch${hi.length > 1 ? 's' : ''} — <b>${stagePct}%</b> in Wake/REM (where movement is expected, corroborating the ECG-only sleep staging)${nearSurge ? `, ${nearSurge} coinciding with CVHR clusters` : ''}.`}
      <span style="opacity:.7">${r.source === 'synthetic' ? 'ACC here is synthetic ground truth. ' : ''}Posture labelling depends on sensor mounting; tilt angle is mount-independent. Informational.</span></div>` +
      accExtraCards(r);
    $('accCard').style.display = 'block';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ACC FULL PIPELINE SUB-CARDS — RRacc · EDR agreement · sleep-stage
  //  consensus · step count & gait. Appended inside #accBody, below the
  //  posture/breathing/motion block. Tier-gated per the build brief.
  // ════════════════════════════════════════════════════════════════════════
  function accExtraCards(r) {
    const ex = r._accEx || DSP.accExtras(r.deviceACC, r.accFs, r.t0Ms, r.durSec, r.epochs, r.stages);
    if (!ex) return '';
    r._accEx = ex; // cache for the JSON export (avoid a 2nd heavy pass over a large ACC)
    window.accRRacc = ex.rracc;
    window.accSteps = ex.gait;
    window.accAgreement = ex.agreement;
    window.accConsensus = ex.consensus;
    return _accCardRR(ex) + _accCardAgreement(ex, r) + _accCardConsensus(ex, r) + _accCardGait(ex, r);
  }
  function _fmtAxisMin(m, durMin) {
    return durMin > 90 ? (m / 60).toFixed(1) + 'h' : m.toFixed(0) + 'm';
  }
  function _fmtEpochClock(r, tMin) {
    if (r && r.t0Ms != null) {
      const d = new Date(r.t0Ms + tMin * 60 * 1000),
        p = (x) => String(x).padStart(2, '0');
      return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }
    return tMin.toFixed(0) + 'm';
  }
  function _zoneColor(c) {
    return { gray: '#6F8096', blue: UI.COLORS.blue, green: UI.COLORS.green, amber: UI.COLORS.amber, red: UI.COLORS.red }[c] || '#6F8096';
  }

  // Feature 1 card
  function _accCardRR(ex) {
    const s = ex.rraccSummary;
    const chart = ex.rracc.length >= 3 ? _accRRChart(ex) : '<div class="q-note">Recording too short to plot per-epoch RRacc.</div>';
    const summary = s
      ? `<div class="gang-summary" style="margin-top:10px">
      <div class="gang-pill">Mean <b>${s.mean != null ? s.mean : '—'}${s.sd != null ? ' ± ' + s.sd : ''}</b> br/min</div>
      <div class="gang-pill">High-confidence <b>${s.highPct}%</b> of ${s.nEpochs} epochs</div>
      <div class="gang-pill">30-s epochs · band <b>0.15–0.45 Hz</b></div>
    </div>`
      : '';
    return `<section class="section-card" data-tier="secondary" id="accRRCard">
    <div class="section-card-title">${evBadge('ACC Respiratory Rate (RRacc)')}ACC Respiratory Rate (RRacc)</div>
    ${chart}${summary}
    <div class="q-note" style="margin-top:8px">Independent breathing rate from chest-axis accelerometer magnitude — detrended, the dominant FFT frequency in 0.15–0.45 Hz per 30-s epoch. Low-confidence epochs (resp-band SNR &lt; 3 dB, usually motion) are greyed and excluded from the line &amp; summary.</div>
  </section>`;
  }
  function _accRRChart(ex) {
    const C = UI.COLORS,
      W = 600,
      H = 120,
      P = { l: 42, r: 12, t: 12, b: 22 },
      pts = ex.rracc;
    const xs = pts.map((p) => p.tStartMin),
      xmn = Math.min.apply(null, xs),
      xmx = Math.max.apply(null, xs) || xmn + 1,
      ymn = 6,
      ymx = 30;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn || 1)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((Math.max(ymn, Math.min(ymx, y)) - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const hiPts = pts.filter((p) => p.conf === 'high');
    const line = hiPts.length ? hiPts.map((p, k) => (k ? 'L' : 'M') + sx(p.tStartMin).toFixed(1) + ' ' + sy(p.rr).toFixed(1)).join(' ') : '';
    const dots = pts
      .map(
        (p) =>
          `<circle cx="${sx(p.tStartMin).toFixed(1)}" cy="${sy(p.rr).toFixed(1)}" r="${p.conf === 'high' ? 1.7 : 1.4}" fill="${p.conf === 'high' ? C.teal : C.dim}" opacity="${p.conf === 'high' ? 0.9 : 0.45}"/>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="width:100%;height:auto">
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${C.axis}"/>
    ${[10, 20, 30].map((t) => `<text x="${P.l - 6}" y="${(sy(t) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${t}</text>`).join('')}
    ${line ? `<path d="${line}" fill="none" stroke="${C.teal}" stroke-width="1.4" stroke-linejoin="round"/>` : ''}
    ${dots}
    <text x="${sx(xmn).toFixed(1)}" y="${H - 6}" fill="${C.dim}" font-size="9" text-anchor="start" font-family="IBM Plex Mono,monospace">${_fmtAxisMin(xmn, ex.durMin)}</text>
    <text x="${(W - P.r).toFixed(1)}" y="${H - 6}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${_fmtAxisMin(xmx, ex.durMin)}</text>
  </svg>`;
  }
  // Feature 2 card
  function _accCardAgreement(ex) {
    const ag = ex.agreement;
    let body;
    if (!ag) {
      body = `<div class="q-note"><span class="pill pill-gray">No EDR available</span> Needs both ECG-derived respiration (EDR) epochs and confident RRacc epochs to compare.</div>`;
    } else {
      const strong = ag.r >= 0.85 || (ag.mae <= 1.5 && Math.abs(ag.meanDelta) <= 1.5);
      const moderate = !strong && (ag.r >= 0.65 || ag.mae <= 3.0);
      const pill = strong
        ? '<span class="pill pill-green">Strong agreement</span>'
        : moderate
          ? '<span class="pill pill-yellow">Moderate</span>'
          : '<span class="pill pill-red">Poor — check sensor contact</span>';
      const narrowNote =
        ag.r < 0.65 && ag.mae <= 2.0
          ? `<div class="q-note" style="margin-top:6px;color:var(--text2)">Low Pearson r here reflects the <b>narrow EDR range</b> across the night, not poor tracking — MAE ${ag.mae.toFixed(1)} br/min and tight limits of agreement (${ag.loa[0]} … +${ag.loa[1]}) show the two methods agree closely (Bland–Altman governs over correlation when the spread is small).</div>`
          : '';
      const evg = (lbl) => {
        const b = evBadge(lbl);
        return b ? '<span style="margin-right:5px">' + b + '</span>' : '';
      };
      body = `<div class="acc-stat-row">
        <div class="acc-stat"><div class="acc-stat-v">${ag.r.toFixed(2)}</div><div class="acc-stat-l">${evg('Pearson r')}Pearson r</div></div>
        <div class="acc-stat"><div class="acc-stat-v">${ag.mae.toFixed(1)}</div><div class="acc-stat-l">${evg('MAE br/min')}MAE br/min</div></div>
        <div class="acc-stat"><div class="acc-stat-v">${ag.disagreeRate}%</div><div class="acc-stat-l">${evg('Disagreement')}Disagreement</div></div>
        <div class="acc-stat"><div class="acc-stat-v">${ag.meanDelta > 0 ? '+' : ''}${ag.meanDelta.toFixed(1)}</div><div class="acc-stat-l">${evg('Mean Δ (bias)')}Mean Δ (bias)</div></div>
      </div>
      <div style="margin:8px 0 2px">${pill} <span class="acc-pill-note">${ag.n} paired 5-min epochs · |Δ| &gt; 3 br/min flagged as disagreement</span></div>
      ${narrowNote}
      ${_blandAltman(ag)}`;
    }
    return `<section class="section-card" data-tier="secondary" id="accAgreementCard">
    <div class="section-card-title">${evBadge('RRacc vs EDR Agreement')}RRacc vs EDR Agreement</div>
    ${body}
    <div class="q-note" style="margin-top:8px">Disagreement may reflect body-movement artifact in the ACC or ECG motion noise — cross-reference with the motion trace above. Bland–Altman: x = mean of the pair, y = RRacc − EDR; dashed lines = bias (blue) and ± 1.96 SD limits of agreement (grey). The dots stack into near-vertical columns because RRacc comes off a 30-s FFT quantised to ~1.9 br/min bins (8 Hz grid ÷ 256-pt FFT) and dominates the pair-mean on x: every epoch sharing an RRacc bin lands at nearly the same x while its Δ spreads on y — the accelerometer's frequency resolution, not a plotting artifact.</div>
  </section>`;
  }
  function _blandAltman(ag) {
    const C = UI.COLORS,
      W = 420,
      H = 190,
      P = { l: 44, r: 14, t: 14, b: 28 };
    const ms = ag.ba.map((p) => p.mean),
      ds = ag.ba.map((p) => p.diff);
    const xmn = Math.min.apply(null, ms) - 1,
      xmx = Math.max.apply(null, ms) + 1;
    const dmax = Math.max(3, Math.ceil(Math.max(Math.abs(Math.min.apply(null, ds)), Math.abs(Math.max.apply(null, ds)), Math.abs(ag.loa[0]), Math.abs(ag.loa[1])) + 0.5));
    const ymn = -dmax,
      ymx = dmax;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn || 1)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn || 1)) * (H - P.t - P.b);
    const dots = ag.ba.map((p) => `<circle cx="${sx(p.mean).toFixed(1)}" cy="${sy(p.diff).toFixed(1)}" r="2.4" fill="${C.teal}" opacity=".8"/>`).join('');
    const loaL = ag.loa
      .map(
        (l) =>
          `<line x1="${P.l}" y1="${sy(l).toFixed(1)}" x2="${W - P.r}" y2="${sy(l).toFixed(1)}" stroke="${C.dim}" stroke-dasharray="3 4" opacity=".6"/><text x="${W - P.r}" y="${(sy(l) - 3).toFixed(1)}" fill="${C.dim}" font-size="8" text-anchor="end" font-family="IBM Plex Mono,monospace">${l > 0 ? '+' : ''}${l}</text>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;max-width:440px;height:auto;margin-top:6px">
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="${C.axis}"/>
    <line x1="${P.l}" y1="${sy(0).toFixed(1)}" x2="${W - P.r}" y2="${sy(0).toFixed(1)}" stroke="${C.axis}"/>
    ${loaL}
    <line x1="${P.l}" y1="${sy(ag.meanDelta).toFixed(1)}" x2="${W - P.r}" y2="${sy(ag.meanDelta).toFixed(1)}" stroke="${C.blue}" stroke-dasharray="5 4" opacity=".75"/>
    ${dots}
    <text x="${P.l - 6}" y="${(sy(ymx) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">+${dmax}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">−${dmax}</text>
    <text x="${P.l - 6}" y="${(sy(0) + 3).toFixed(1)}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">0</text>
    <text x="${((P.l + W - P.r) / 2).toFixed(0)}" y="${H - 7}" fill="${C.dim}" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">mean of RRacc &amp; EDR (br/min) · Δ on y</text>
  </svg>`;
  }
  // Feature 3 card
  function _accCardConsensus(ex, r) {
    const co = ex.consensus;
    let body;
    if (!co) {
      body = `<div class="q-note"><span class="pill pill-gray">No HRV staging available</span> Sleep-stage consensus needs the HRV + EDR hypnogram, which unlocks on overnight (≥ 90 min) recordings.</div>`;
    } else {
      const pill =
        co.rate >= 85
          ? '<span class="pill pill-green">Strong consensus</span>'
          : co.rate >= 70
            ? '<span class="pill pill-yellow">Moderate</span>'
            : '<span class="pill pill-red">Weak — review staging</span>';
      const conflictBlock = co.nConflict
        ? `<details class="acc-details"><summary>${co.nConflict} conflict${co.nConflict > 1 ? 's' : ''} — show timestamps &amp; direction</summary>
          <div class="acc-conflict-list">${co.conflicts.map((c) => `<div class="acc-conflict-row"><span class="ge-t">${_fmtEpochClock(r, c.tMin)}</span><span>${c.dir}</span></div>`).join('')}</div></details>`
        : `<div class="q-note" style="margin-top:6px">No epochs where the motion vote contradicts the HRV stage.</div>`;
      body = `<div class="acc-consensus-hero">
        <div class="acc-consensus-val">${co.rate}%</div>
        <div><div class="acc-consensus-lbl">staging consensus</div><div class="acc-consensus-sub">${co.n} stage epochs · ${co.nConflict} conflict${co.nConflict === 1 ? '' : 's'}</div></div>
        ${pill}
      </div>${conflictBlock}`;
    }
    return `<section class="section-card" data-tier="secondary" id="accStagingCard">
    <div class="section-card-title">${evBadge('Sleep-Stage Consensus (ACC Motion Vote)')}Sleep-Stage Consensus (ACC Motion Vote)</div>
    ${body}
    <div class="q-note" style="margin-top:8px">Per-epoch ACC motion (vector-magnitude SD, normalised 0–100) votes Wake (&gt; 20) / Ambiguous (5–20) / Sleep (&lt; 5) and is cross-checked against the HRV + EDR stage. Conflicts may indicate PLMS, brief arousals without a sustained HR change, or sensor shift.</div>
  </section>`;
  }
  // Feature 4 card
  function _accCardGait(ex, r) {
    const g = ex.gait;
    if (!g || !g.walking) {
      const reason = g && g.reason === 'lowfs' ? `ACC sampled at ${g.accFs} Hz — gait needs ≥ 7 Hz to resolve the 0.5–3.5 Hz step band. ` : '';
      const tail = g && g.totalSteps ? `${g.totalSteps} candidate steps (&lt; 50 threshold).` : 'Consistent with a still / sleep recording.';
      return `<section class="section-card" data-tier="primary" id="accGaitCard">
      <div class="section-card-title">Step Count &amp; Gait</div>
      <div class="q-note"><span class="pill pill-gray">No walking detected</span> ${reason}${tail}</div>
    </section>`;
    }
    const zoneBar = `<div class="acc-zonebar">${g.zonePct
      .filter((z) => z.pct > 0)
      .map((z) => `<div class="acc-zone-seg" style="width:${z.pct}%;background:${_zoneColor(z.col)}" title="${z.zone} ${z.pct}%">${z.pct >= 10 ? z.pct + '%' : ''}</div>`)
      .join('')}</div>
    <div class="acc-zone-legend">${g.zonePct.map((z) => `<span><i style="background:${_zoneColor(z.col)}"></i>${z.zone} ${z.pct}%</span>`).join('')}</div>`;
    const cad =
      g.cadEpochs.length >= 3
        ? `<div class="mini-h" style="margin-top:14px">Cadence <span class="mini-sub">steps / min · per 60-s epoch</span></div>${UI.lineChart(
            g.cadEpochs.map((c) => ({ x: c.tMin, y: c.cadence })),
            UI.COLORS.amber,
            { W: 600, H: 120, ymn: 0, xfmt: (x) => (ex.durMin > 90 ? (x / 60).toFixed(1) + 'h' : x.toFixed(0) + 'm') }
          )}`
        : '';
    const bouts = g.bouts.length
      ? `<details class="acc-details"><summary>${g.bouts.length} walking bout${g.bouts.length > 1 ? 's' : ''} — show table</summary>
        <table class="acc-bout-tbl"><thead><tr><th>Start</th><th>Duration</th><th>Steps</th><th>Mean cadence</th><th>Cadence CV%</th></tr></thead>
        <tbody>${g.bouts.map((b) => `<tr><td>${_fmtEpochClock(r, b.startMin)}</td><td>${b.durSec}s</td><td>${b.steps}</td><td>${b.cadence}/min</td><td>${b.cadenceCV}%</td></tr>`).join('')}</tbody></table></details>`
      : '';
    return `<section class="section-card" data-tier="primary" id="accGaitCard">
    <div class="section-card-title">Step Count &amp; Gait</div>
    <div class="metric-hero" style="margin-bottom:14px"><div class="m-label">${evBadge('Total steps')}Total steps</div><div class="m-val" style="color:${UI.COLORS.amber}">${g.totalSteps.toLocaleString()}</div><div class="m-unit">${g.bouts.length} bout${g.bouts.length === 1 ? '' : 's'} · ACC @ ${g.accFs} Hz</div></div>
    ${zoneBar}
    ${cad}
    ${bouts}
    <div class="q-note" style="margin-top:8px">Steps from the de-gravitated vertical magnitude band-passed 0.5–3.5 Hz with an adaptive-threshold peak detector (≥ 250 ms between steps). A single chest sensor cannot distinguish left/right, so no asymmetry index is reported. Cadence CV% is a gait-regularity proxy.</div>
  </section>`;
  }

  function renderGanglior(r) {
    const ev = r.events;
    $('gangCount').textContent = ev.length;
    const surges = ev.filter((e) => e.impulse === 'autonomic_surge');
    $('gangBody').innerHTML = `
    <div class="gang-summary">
      <div class="gang-pill"><b>${surges.length}</b> autonomic_surge</div>
      <div class="gang-pill"><b>${ev.length - surges.length}</b> stage transitions</div>
      <div class="gang-pill">node <b>ECGDex</b></div>
    </div>
    <div class="gang-stream">${ev
      .slice(0, 160)
      .map((e) => {
        const isS = e.impulse === 'autonomic_surge';
        return `<div class="gang-ev ${isS ? 'surge' : ''}"><span class="ge-t">${e.t}</span><span class="ge-imp">${e.impulse}</span><span class="ge-meta">${e.meta && e.meta.ampBpm ? 'Δ' + e.meta.ampBpm + ' bpm / ' + e.meta.periodSec + 's' + (e.meta.position && e.meta.position !== 'unknown' ? ' · ' + e.meta.position : '') : ''}</span><span class="ge-conf" title="signal quality">conf ${e.conf}</span></div>`;
      })
      .join('')}${ev.length > 160 ? `<div class="gang-more">+ ${ev.length - 160} more in JSON export</div>` : ''}</div>
    <div class="q-note">Canonical bus shape: <code>{ "t":"${ev[0] ? ev[0].t : '02:14:31'}", "impulse":"autonomic_surge", "node":"ECGDex", "conf":${surges[0] ? surges[0].conf : 0.82} }</code>. The fusion layer (Ganglior) correlates these against OxyDex desaturation events on the shared timeline to confirm sleep-apnea — neither node can claim it alone.</div>`;
    $('gangSection').style.display = 'block';
  }

  function renderTable(r) {
    const insuf = (st) => (r.tier === 'ultra-short' ? 'neutral' : st);
    const D = r.morph ? r.morph.delin : null;
    const rows = [
      ['Source', r.source === 'synthetic' ? 'Synthetic ECG (demo)' : 'Raw ECG file', '—', '—', 'neutral', 'Single signal in — RR computed from ECG'],
      ['Tier', r.tier, '—', '—', 'neutral', r.tierMsg],
      ['Duration', r.durMin, 'min', '—', 'neutral', r.epochs.length + ' × 5-min epochs'],
      ['Sample rate', r.fs, 'Hz', '130', 'neutral', 'Polar-H10-style chest sensor'],
      ['Beats (NN)', r.nBeats, 'beats', '—', 'neutral', 'After SQI gate + interpolation'],
      ['Analyzable', r.analyzablePct, '%', '≥90', r.analyzablePct >= 90 ? 'ok' : r.analyzablePct >= 75 ? 'warn' : 'bad', '% night above SQI threshold'],
      ['Correction', r.correctionRate, '%', '<3', r.correctionRate < 3 ? 'ok' : r.correctionRate < 8 ? 'warn' : 'bad', 'Beats interpolated'],
      ['Mean SQI', r.meanSQI, '0–1', '≥0.7', r.meanSQI >= 0.7 ? 'ok' : r.meanSQI >= 0.5 ? 'warn' : 'bad', '→ Ganglior conf'],
      ['— Personalised —', '', '', '', 'neutral', 'derived against your profile (age ' + (r.profile ? r.profile.age : '—') + ')'],
      [
        'HRV Score',
        r.hrvScore == null ? '—' : r.hrvScore,
        '0–100',
        '≥45',
        r.hrvScore == null ? 'neutral' : r.hrvScore >= 45 ? 'ok' : r.hrvScore >= 33 ? 'warn' : 'bad',
        'Autonomic readiness (rMSSD-calibrated)'
      ],
      /* ANS Age table row REMOVED 2026-06-23 (BADGE-COVERAGE-AUDIT-FOLLOWUPS R9, WP-A) — see renderKPI note. */
      [
        'Resting HR',
        r.rhrEff || '—',
        'bpm',
        r.expRHR ? '~' + r.expRHR : '—',
        !r.rhrEff ? 'neutral' : r.rhrEff <= (r.expRHR || 62) ? 'ok' : r.rhrEff <= (r.expRHR || 62) + 8 ? 'warn' : 'bad',
        r.longRec ? 'Nocturnal floor + 8 (awake est)' : 'Measured'
      ],
      ['Expected rMSSD', r.expRmssd || '—', 'ms', 'age norm', 'neutral', 'Age-typical rMSSD for comparison'],
      ['VO₂max base', r.vo2base == null ? '—' : r.vo2base, 'ml/kg/min', '—', 'neutral', 'Uth–Sørensen HRmax/HRrest' + (r.altFactor && r.altFactor < 1 ? ' · alt ×' + r.altFactor : '')],
      ['VO₂max adj', r.vo2adj == null ? '—' : r.vo2adj, 'ml/kg/min', '≥40', r.vo2adj == null ? 'neutral' : r.vo2adj >= 45 ? 'ok' : r.vo2adj >= 38 ? 'warn' : 'bad', 'HRV-adjusted estimate'],
      ...(r.vo2gt ? [['VO₂max GT', r.vo2gt, 'ml/kg/min', 'lab', 'neutral', 'Your entered ground truth']] : []),
      ...(r.longRec && r.apneaRisk ? [['Apnea risk', r.apneaRisk.cat, '—', 'Minimal', r.apneaRisk.sev, r.apneaRisk.note]] : []),
      ...(r.estAHI
        ? [
            [
              'Est. AHI',
              '≈' + r.estAHI.value,
              '/h',
              '<5',
              r.apneaRisk ? r.apneaRisk.sev : 'neutral',
              r.estAHI.band + ' · CVHR/CPC proxy from ECG alone (' + r.estAHI.lo + '–' + r.estAHI.hi + ') · screen-only'
            ]
          ]
        : []),
      ...(r.morph
        ? [
            ['— Morphology / Rhythm —', '', '', '', 'neutral', 'single lead @130 Hz · directional trends, not 12-lead'],
            ['PVCs (V)', r.morph.nPVC, 'beats', '—', r.morph.pvcBurden < 0.5 ? 'ok' : r.morph.pvcBurden < 3 ? 'warn' : 'bad', r.morph.pvcBurden + '% burden · wide/early + compensatory pause'],
            ['PACs (S)', r.morph.nPAC, 'beats', '—', r.morph.pacBurden < 0.5 ? 'ok' : r.morph.pacBurden < 3 ? 'warn' : 'bad', r.morph.pacBurden + '% burden · narrow/early'],
            ['Couplets', r.morph.couplets, 'count', '0', r.morph.couplets > 0 ? 'warn' : 'ok', 'Consecutive PVC pairs'],
            ['Ventr. runs ≥3', r.morph.runsGE3, 'count', '0', r.morph.runsGE3 > 0 ? 'bad' : 'ok', 'NSVT flag — review if >0'],
            ['Bigeminy', r.morph.bigeminyCycles, 'cycles', '—', 'neutral', 'N-V alternation'],
            ...(D.valid
              ? [
                  ['QRS duration', D.qrsDur, 'ms', '<110', D.qrsDur > 120 ? 'bad' : D.qrsDur > 110 ? 'warn' : 'ok', 'Ventricular depolarisation width'],
                  ['QT', D.qt, 'ms', '—', 'neutral', 'Q-onset → T-end (tangent)'],
                  [
                    'QTc (Bazett)',
                    D.qtcBazett == null ? '—' : D.qtcBazett,
                    'ms',
                    '<450M/460F',
                    D.qtcBazett == null ? 'neutral' : D.qtcBazett > 470 ? 'bad' : D.qtcBazett > 450 ? 'warn' : 'ok',
                    'Rate-corrected QT'
                  ],
                  ['QTc (Fridericia)', D.qtcFrid == null ? '—' : D.qtcFrid, 'ms', '<450', D.qtcFrid == null ? 'neutral' : D.qtcFrid > 460 ? 'warn' : 'ok', 'Less rate-biased'],
                  [
                    'PR interval',
                    D.pr == null ? '—' : D.pr,
                    'ms',
                    '120–200',
                    D.pr == null ? 'neutral' : D.pr > 220 || D.pr < 120 ? 'warn' : 'ok',
                    D.pPresent ? 'P-onset → QRS-onset' : 'P not resolved @130 Hz'
                  ],
                  ['ST level', D.st, 'µV', '±100', 'neutral', 'At J+60 ms vs baseline'],
                  ['R amplitude', D.Ramp, 'µV', '—', 'neutral', 'Median-beat R height'],
                  ['T amplitude', D.Tamp, 'µV', '—', 'neutral', 'Median-beat T height']
                ]
              : [['Intervals (QRS/QT/PR)', 'withheld', '—', '—', 'neutral', 'No valid median beat — insufficient clean aligned beats']]),
            [
              'AF screen',
              { 'no-af': 'Clear', 'occasional-irregular': 'Watch', 'possible-af': 'Flag', insufficient: '—' }[r.morph.af.verdict],
              '—',
              'Clear',
              { 'no-af': 'ok', 'occasional-irregular': 'warn', 'possible-af': 'bad', insufficient: 'neutral' }[r.morph.af.verdict],
              r.morph.af.suspiciousPct + '% windows irregular · ΔRR entropy ' + r.morph.af.shannon + ' · screen only'
            ]
          ]
        : []),
      ['— Cardiac / HRV —', '', '', '', 'neutral', 'full suite below'],
      ['Mean HR', r.hr, 'bpm', '40–80', hrStat(r.hr), 'Whole-record mean'],
      ['Mean RR', r.meanRR, 'ms', '700–1100', 'neutral', 'Average NN interval'],
      ['Median RR', r.medianRR, 'ms', '—', 'neutral', '50th percentile'],
      ['SDNN', r.sdnn, 'ms', r.longRec ? 'long-rec' : '≥50', r.longRec ? 'neutral' : insuf(sc(r.sdnn, 50, 30)), r.longRec ? 'Whole-night — use SDANN/SDNN-index' : 'Total HRV spread'],
      ['rMSSD', r.rmssd, 'ms', '≥30', sc(r.rmssd, 30, 20), 'Parasympathetic HRV'],
      ['pNN50', r.pnn50, '%', '≥15', sc(r.pnn50, 15, 5), 'Beat-to-beat variability'],
      ['NN50', r.nn50, 'count', '—', 'neutral', 'Pairs |Δ|>50 ms'],
      ...(r.longRec
        ? [
            ['SDANN', r.sdann == null ? '—' : r.sdann, 'ms', '≥50', r.sdann == null ? 'neutral' : sc(r.sdann, 50, 30), 'SD of 5-min mean-RR'],
            ['SDNN index', r.sdnnIdx == null ? '—' : r.sdnnIdx, 'ms', '≥40', r.sdnnIdx == null ? 'neutral' : sc(r.sdnnIdx, 40, 25), 'Mean of 5-min SDNNs']
          ]
        : []),
      ['CV', r.cv, '%', '5–12', 'neutral', 'SDNN/MeanRR×100'],
      ['Min RR', r.minRR, 'ms', '—', 'neutral', 'Shortest (post-clean)'],
      ['Max RR', r.maxRR, 'ms', '—', 'neutral', 'Longest (post-clean)'],
      ['SD1', r.sd1, 'ms', '≥20', sc(r.sd1, 20, 10), 'Poincaré short axis'],
      ['SD2', r.sd2, 'ms', '≥50', sc(r.sd2, 50, 30), 'Poincaré long axis'],
      ['SD1/SD2', r.sd1sd2, 'ratio', '0.25–0.5', 'neutral', 'Short vs long balance'],
      ['Ellipse area', r.ellArea, 'ms²', '—', 'neutral', 'π·SD1·SD2'],
      ['Total power', r.tp, 'ms²', '—', 'neutral', 'Lomb–Scargle ∫PSD'],
      ['HF power', r.hf, 'ms²', '≥100', r.tier === 'ultra-short' ? 'neutral' : sc(r.hf, 100, 50), 'Parasympathetic band'],
      ['LF power', r.lf, 'ms²', r.tier === 'ultra-short' ? '≥5min' : '—', r.tier === 'ultra-short' ? 'neutral' : 'neutral', r.tier === 'ultra-short' ? 'Needs ≥5 min' : '0.04–0.15 Hz'],
      ['VLF power', r.vlf, 'ms²', r.longRec ? '—' : '≥5min', 'neutral', r.longRec ? 'Resolvable overnight' : 'Needs long record'],
      ['LF/HF', r.lfhf, 'ratio', '0.5–2.0', 'neutral', 'Sympathovagal balance'],
      ['HF nu', r.hfnu, 'nu', '40–60', 'neutral', 'HF normalized'],
      ['LF nu', r.lfnu, 'nu', '40–60', 'neutral', 'LF normalized'],
      ['Resp rate', r.respRate, 'br/min', '12–20', r.respRate >= 10 && r.respRate <= 22 ? 'ok' : 'neutral', 'EDR — HF spectral peak'],
      ['ln(rMSSD)', r.lnrmssd, '—', '≥3.5', r.lnrmssd >= 3.5 ? 'ok' : r.lnrmssd >= 3.1 ? 'warn' : 'bad', 'Log-RMSSD readiness'],
      ['Tri index', r.triIdx, '—', '≥15', r.triIdx >= 15 ? 'ok' : r.triIdx >= 9 ? 'warn' : 'bad', 'HRV triangular index'],
      [
        'DFA α1',
        r.dfa1 == null ? '—' : r.dfa1,
        '—',
        '0.9–1.2',
        r.dfa1 == null ? 'neutral' : r.dfa1 >= 0.9 && r.dfa1 <= 1.2 ? 'ok' : r.dfa1 < 0.75 || r.dfa1 > 1.5 ? 'bad' : 'warn',
        'Short-term fractal scaling'
      ],
      ['SampEn', r.sampen == null ? '—' : r.sampen, '—', '1.0–2.2', r.sampen == null ? 'neutral' : r.sampen >= 1.0 ? 'ok' : r.sampen >= 0.6 ? 'warn' : 'bad', 'Sample entropy (m=2)'],
      ['Decel cap', r.dc == null ? '—' : r.dc, 'ms', '>4.5', r.dc == null ? 'neutral' : r.dc >= 4.5 ? 'ok' : r.dc >= 2.5 ? 'warn' : 'bad', 'PRSA vagal (mortality marker)'],
      ['Accel cap', r.ac == null ? '—' : r.ac, 'ms', '<−4.5', 'neutral', 'PRSA sympathetic'],
      ['PIP', r.pip == null ? '—' : r.pip, '%', '<55', r.pip == null ? 'neutral' : r.pip < 55 ? 'ok' : r.pip < 69 ? 'warn' : 'bad', 'Fragmentation: % inflection pts'],
      ...(r.longRec && !r.ambulatory
        ? [
            ['CVHR index', r.cvhr.index, '/h', '<5', r.cvhr.index < 5 ? 'ok' : r.cvhr.index < 15 ? 'warn' : 'bad', 'Cyclic HR variation — apnea autonomic signature'],
            ['CVHR events', r.cvhr.events.length, 'count', '—', 'neutral', 'autonomic_surge events emitted'],
            ['Total sleep', r.totSleep, 'min', '—', 'neutral', 'Light+Deep+REM (cardioresp staging)'],
            ['Deep', r.stageMin.Deep.toFixed(0), 'min', '—', 'neutral', 'High vagal tone epochs'],
            ['REM', r.stageMin.REM.toFixed(0), 'min', '—', 'neutral', 'High LF/HF, irregular']
          ]
        : []),
      ...(r.hrvStab
        ? [
            ['— Dynamic HRV (Li/Kiyono) —', '', '', '', 'neutral', 'nocturnal ln(RMSSD) trend → glycemic-risk signal'],
            ['bσ(ln RMSSD)', r.hrvStab.sigma_lnRMSSD_slope, '/h', '≤0', r.hrvStab.severity, 'Within-window instability trend (key metric, |d|>1.1)'],
            ['bs²(ln RMSSD)', r.hrvStab.var_lnRMSSD_slope, '/h', '≤0', r.hrvStab.severity, 'Within-window variance trend (same finding)'],
            ['HRV stability', r.hrvStab.classification, '—', 'stabilizing', r.hrvStab.severity, 'Decreasing=favourable · increasing=risk'],
            ...(r.surgeEsc ? [['Surge escalation', r.surgeEsc.escalationPct, '%', '≤0', r.surgeEsc.escalationPct > 40 ? 'bad' : r.surgeEsc.escalationPct < -20 ? 'ok' : 'warn', r.surgeEsc.label]] : [])
          ]
        : []),
      ...(r.crc
        ? [
            ['— Cardiorespiratory coupling —', '', '', '', 'neutral', 'EDR ⟷ RR · zero new sensors · from raw ECG'],
            [
              'RSA efficiency',
              r.crc.rsaEfficiencyRatio,
              'ratio',
              '≥1.05',
              r.crc.rsaEfficiencyRatio >= 1.08 ? 'ok' : r.crc.rsaEfficiencyRatio >= 1.04 ? 'warn' : 'neutral',
              'Insp:exp HR ratio — higher = stronger RSA (Border 2025; 1.5 = theoretical optimum)'
            ],
            ['RSA amplitude', r.crc.rsaAmplitudeBpm, 'bpm', '—', 'neutral', 'Peak-to-trough HR swing across the respiratory cycle'],
            ['CRC PLV', r.crc.crcPLV, '0–1', '≥0.5', r.crc.crcPLV >= 0.5 ? 'ok' : r.crc.crcPLV >= 0.3 ? 'warn' : 'bad', 'RR↔respiration phase-lock (arXiv:2508.00773)'],
            [
              'Coupling strength',
              r.crc.couplingStrength,
              '0–1',
              '≥0.5',
              r.crc.couplingStrength >= 0.5 ? 'ok' : r.crc.couplingStrength >= 0.3 ? 'warn' : 'bad',
              'CSI-style sync index (arXiv:2605.18802)'
            ],
            ['EDR resp rate', r.crc.respFromEDR, 'br/min', '12–20', 'neutral', 'Respiration from R-peak amplitude modulation'],
            ...(r.crc.plvDuringSurges != null && r.crc.plvBaseline != null
              ? [['PLV surge vs base', r.crc.plvDuringSurges + ' / ' + r.crc.plvBaseline, '0–1', 'drop', 'neutral', 'Coupling drop during CVHR clusters → surge confidence']]
              : [])
          ]
        : [])
    ];
    window.__summaryRows = rows; // structured source for the tidy CSV export (not a DOM scrape)
    $('tblBody').innerHTML = rows
      .map(
        ([m, v, u, nr, s, n]) => `<tr>
    <td class="ecg-tbl-m" style="color:var(--text2);font-weight:600;font-family:Inter,sans-serif">${evBadge(m)}${m}</td>
    <td class="${s}">${v}</td><td style="color:var(--text3)">${u}</td><td style="color:var(--text3)">${nr}</td>
    <td class="${s}">${{ ok: '✅ Good', warn: '⚠️ Watch', bad: '❌ Concern', neutral: '—' }[s] || s}</td>
    <td style="color:var(--text3);font-family:Inter,sans-serif;font-size:10px">${n}</td></tr>`
      )
      .join('');
    $('tblWrap').classList.add('show');
    $('slTbl').style.display = 'flex';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EXPORTS
  // ════════════════════════════════════════════════════════════════════════
  function dl(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  // Export download FILENAMES come from the shared dex-export.js exportName() — recording-anchored
  // (RESULT.t0Ms read via getUTC*), viewer-TZ-independent, controlled-vocab (EXPORT-HYGIENE §2). The old
  // local-clock _exportTs() (new Date()+LOCAL getters = export-click wall-clock, TZ-dependent) is DELETED
  // (EXPORT-HYGIENE-FOLLOWUPS §1).
  // ── CSV toolkit (mirrored; null≠0, RFC-4180, Excel-safe) ──
  // missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · formula-injection guarded.
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    v = String(v);
    if (v && '=+-@\t\r'.indexOf(v[0]) !== -1) v = '\t' + v;
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csvDoc(rows) {
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  // strip trend glyphs + map UI placeholders → blank (for table-scrape exports)
  function csvClean(t) {
    const s = String(t == null ? '' : t)
      .replace(/[\u2191\u2193\u2192\u2197\u2198\u2B06\u2B07]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s === '' || s === '—' || s === '–' || /^n\/?a$/i.test(s) ? '' : s;
  }
  // Unified summary CSV: serialize the rendered Full Metrics Table as clean data (no glyphs, no over-quoting).
  function _tblCSV() {
    const rows = document.querySelectorAll('#tblWrap table tr');
    return csvDoc([...rows].map((r) => [...r.cells].map((c) => csvClean(c.textContent))));
  }
  // Tidy summary CSV from the structured table rows: pure-number Value column, separate Unit (no
  // fusing), plain-text Status (no emoji), section dividers marked, missing→blank — AI/processing-friendly.
  function _summaryCSV() {
    const rows = window.__summaryRows || [];
    const STAT = { ok: 'Good', warn: 'Watch', bad: 'Concern', neutral: '' };
    const dash = (x) => (x === '—' || x === '–' || x == null ? '' : x);
    const tier = (label) => {
      try {
        const R = window.EcgRegistry;
        if (!R || !R.idForLabel) return '';
        const id = R.idForLabel(label);
        return (id && R.REGISTRY[id] && R.REGISTRY[id].evidence) || '';
      } catch (e) {
        return '';
      }
    };
    const out = [['Metric', 'Value', 'Unit', 'Normal Range', 'Status', 'Evidence', 'Notes']];
    rows.forEach((row) => {
      const metric = String(row[0] == null ? '' : row[0])
        .replace(/^[\s—–]+|[\s—–]+$/g, '')
        .trim();
      const isSection = (row[1] === '' || row[1] == null) && (row[2] === '' || row[2] == null);
      out.push(
        isSection ? [metric, '', '', '', '(section)', '', ''] : [metric, dash(row[1]), dash(row[2]), dash(row[3]), STAT[row[4]] !== undefined ? STAT[row[4]] : dash(row[4]), tier(row[0]), dash(row[5])]
      );
    });
    return csvDoc(out);
  }
  function exportCSV() {
    if (!RESULT) return;
    dl(_summaryCSV(), exportName({ node: 'ECGDex', t0Ms: RESULT.t0Ms, kind: 'summary', ext: 'csv' }), 'text/csv');
    showOK('Summary CSV exported (tidy: metric · value · unit · range · status · notes).');
  }
  // HRVDex / Welltory-style per-session CSV (one row per recording), consumable by HRVDex.parseCSV.
  // With ≥2 recordings loaded it emits ALL sessions (N rows) → a whole multi-day history in one
  // import; HRVDex appends them and dedups. Single recording stays a 1-row file as before.
  // Baevsky geometric inputs (Mode, AMo50, MxDMn) from the NN series — 50-ms bins.
  // ONE source of truth shared by the Welltory CSV row AND the ganglior envelope, so
  // CSV-path and JSON-path imports into HRVDex populate the SAME Baevsky-SI inputs
  // (FOLLOWUP-FINDINGS P4 — previously the envelope omitted these, leaving every
  // SI-derived HRVDex metric NaN on the JSON path but populated on the CSV path).
  // Units match the Welltory convention: mode = modal RR in ms, amo50 = amplitude of
  // the mode in %, mxDMn = variation range in SECONDS. Empty NN → nulls (honest-null).
  function _baevskyGeom(nn) {
    nn = nn || [];
    if (!nn.length) return { mode: null, amo50: null, mxDMn: null };
    let mn = Infinity,
      mx = -Infinity;
    const bins = {};
    for (const v of nn) {
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      const b = Math.round(v / 50) * 50;
      bins[b] = (bins[b] || 0) + 1;
    }
    let modeBin = 0,
      modeCnt = 0;
    for (const b in bins) {
      if (bins[b] > modeCnt) {
        modeCnt = bins[b];
        modeBin = +b;
      }
    }
    return {
      mode: modeBin, // modal RR, ms
      amo50: +((modeCnt / nn.length) * 100).toFixed(1), // amplitude of mode, %
      mxDMn: +((mx - mn) / 1000).toFixed(3) // variation range, SECONDS (Welltory convention)
    };
  }
  function _welltoryRowFor(r) {
    const g = _baevskyGeom(r.nn);
    const mode = g.mode == null ? '' : g.mode,
      amo50 = g.amo50 == null ? '' : g.amo50,
      mxdmn = g.mxDMn == null ? '' : g.mxDMn;
    const t0 = r.t0Ms != null ? r.t0Ms : 0; // §1 (FOLLOWUPS): undated recording → relative-from-0 (1970 epoch, deterministic), NEVER now()
    const d = new Date(t0),
      p = (x) => String(x).padStart(2, '0');
    // CLOCK-UNIFY: floating wall-clock → ISO (no zone) via getUTC*; HRVDex.parseTimestamp reads it verbatim.
    const ts = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    const num = (v) => (v == null || v === '' || !isFinite(v) ? '' : v);
    return [ts, num(r.hr), num(r.meanRR), num(r.sdnn), num(r.rmssd), num(r.pnn50), num(amo50), num(mode), num(r.tp), num(r.hf), num(r.lf), num(r.vlf), num(mxdmn)];
  }
  function exportWelltoryCSV() {
    const list = recordingsSorted();
    const recs = list.length ? list : RESULT ? [RESULT] : [];
    if (!recs.length) return;
    const headers = ['Date', 'Measurement HR', 'Mean RR', 'SDNN', 'rMSSD', 'pNN50', 'AMo50', 'Mode', 'Total power', 'HF', 'LF', 'VLF', 'MxDMn'];
    const rows = [headers].concat(recs.map(_welltoryRowFor));
    const multi = recs.length > 1;
    // INTEROP file (Welltory / HRVDex-format CSV consumed by HRVDex.parseCSV) — stays OFF the
    // <Node>_<date>_<kind> scheme (EXPORT-HYGIENE-FOLLOWUPS §4 interop precedent, like PulseDex's
    // welltory exports); but the Clock-Contract-violating _exportTs() is gone — anchored to the first
    // session's recording date (getUTC* via toISOString), 'undated' when unknown (never now()).
    const _wd = recs[0] && recs[0].t0Ms != null ? new Date(recs[0].t0Ms).toISOString().slice(0, 10) : 'undated';
    dl(csvDoc(rows), 'ECGDex_' + _wd + (multi ? '_hrvdex_' + recs.length + 'sessions' : '_hrvdex') + '.csv', 'text/csv');
    showOK(
      multi ? 'HRVDex / Welltory-style CSV exported — ' + recs.length + ' session rows → load in HRVDex (they accumulate).' : 'HRVDex / Welltory-style CSV exported (1 session row → load in HRVDex).'
    );
  }
  // Computed RR export for PulseDex (Plan-B handoff): timestamp;RR-interval [ms]
  function exportRR() {
    if (!RESULT) return;
    const r = RESULT;
    const t0 = r.t0Ms != null ? r.t0Ms : 0; // §1 (FOLLOWUPS): undated → relative-from-0, never now()
    const lines = ['Phone timestamp;RR-interval [ms]'];
    for (let i = 0; i < r.nn.length; i++) {
      const ts = new Date(t0 + r.tt[i] * 1000).toISOString().replace('Z', '');
      lines.push(ts + ';' + Math.round(r.nn[i]));
    }
    dl(lines.join('\n'), 'ecgdex_computed_RR_' + (r.t0Ms != null ? new Date(r.t0Ms).toISOString().slice(0, 10) : 'undated') + '.txt', 'text/plain');
    showOK('Computed RR exported (' + r.nn.length + ' beats) — drop this into PulseDex for precise HRV (Plan-B handoff).');
  }
  // ════════════════════════════════════════════════════════════════════════
  //  MULTI-RECORDING (§1b) — append loader · switcher · cross-night · arrayed export
  //  Additive: the switcher + cross-night card appear ONLY at ≥2 recordings;
  //  with one file ECGDex looks and exports byte-identical to before.
  // ════════════════════════════════════════════════════════════════════════
  // filename classification — lets ONE selector accept ECG + companions together
  // (like PpgDex). Companions route to their cross-check loaders; ECG files queue.
  // §3 (ECG-INGEST-FOLLOWUPS): the pure file-ingest classifiers live in dex-ingest.js (DexIngest), the
  // ONE testable, gate-backed source shared with PpgDex (routing-table test in tests/dex-tests.js).
  // §4 (ECG-INGEST-FOLLOWUPS-II): the loadFiles ORCHESTRATION (bucket → device-anchor companion filter →
  // _RR-over-_PPI → de-dupe → part-group) is now DexIngest.planIngest too — stampMs/foreignKind are read
  // INSIDE it, so the app keeps only the two aliases its remaining call sites use (the sniff-loop
  // bucketing + the per-recording device-key stash). DexIngest.ecgKind/deviceKey ARE the former bodies.
  const classifyECG = ING.ecgKind; // 'ecg' | 'rr' | 'hr' | 'acc' | 'skip' (sniff-loop bucketing)
  const ecgDeviceKey = ING.deviceKey; // POLAR_<model>_<id> | null — the per-recording device-key stash (§4 cross-drop)
  // Header-line content sniff (defence in depth): a file fed as ECG (ECG-ish or suffix-less name) whose
  // FIRST LINE positively names a non-ECG stream must not enter the QRS pipeline. DexIngest.sniffFirstLine
  // is node-neutral (null on a header-less / bare-numeric / matching line) — for ECG, null OR 'ecg' PASSES;
  // any other recognised stream is the foreign verdict (byte-identical to the former inline mapping).
  // slice(0,600) reads a few hundred bytes, never the whole (GB-sized) overnight file.
  function sniffEcgKind(file) {
    try {
      return file
        .slice(0, 600)
        .text()
        .then((head) => {
          const k = ING.sniffFirstLine(String(head).split(/\r?\n/)[0]);
          return k === null || k === 'ecg' ? 'ecg' : k;
        })
        .catch(() => 'ecg');
    } catch (_) {
      return Promise.resolve('ecg');
    }
  }
  const _FOREIGN_LABEL = {
    ppg: 'optical PPG',
    magn: 'magnetometer',
    gyro: 'gyroscope',
    acc: 'accelerometer',
    spo2: 'SpO₂ pulse-ox (→ OxyDex)',
    cgm: 'glucose CGM (→ GlucoDex)',
    otherdevice: 'other-device sensor',
    duplicate: 'duplicate ECG',
    skip: 'non-ECG stream'
  };
  function _deviceName(key) {
    if (!key) return 'other device';
    if (/SENSE/.test(key)) return 'Verity Sense';
    if (/H10/.test(key)) return 'H10';
    if (/H9/.test(key)) return 'H9';
    if (/OH1|VERITY/.test(key)) return 'OH1';
    return key.replace(/^POLAR_/, '').replace(/_/g, ' ');
  }
  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    // SELF-INGEST: a dropped ECGDex ganglior.node-export → review mode (a faithful VIEW of the stored
    // hrv/quality summary, no recompute); a foreign export shows the redirect message.
    try {
      if (typeof ecgClearReview === 'function') ecgClearReview();
    } catch (_ec) {}
    for (const _f of files) {
      if (!/\.json$/i.test(_f.name)) continue;
      let _j = null;
      try {
        _j = JSON.parse(await _f.text());
      } catch (_pe) {}
      if (_j && _j.schema && _j.schema.name === 'ganglior.node-export') {
        const _res = window.ECGDex && typeof window.ECGDex.loadOwnExport === 'function' ? window.ECGDex.loadOwnExport(_j) : null;
        if (_res && _res.ok) {
          if (typeof ecgRenderReview === 'function') ecgRenderReview(_res);
          if (typeof showOK === 'function') showOK('Loaded ECGDex export \u2014 review mode (not recomputed).');
          return;
        }
        if (_res && _res.reason === 'foreign-node') {
          if (typeof showErr === 'function') showErr(_res.message);
          return;
        }
      }
    }
    // Async header content-sniff (the ONE byte-reading step): pull any file NAMED like ECG (or
    // suffix-less, so it defaulted to ecg) but whose first line names a different stream back out of
    // the ECG lane. DexIngest.planIngest is pure + NAME-only + DOM-free, so the byte-reading sniff
    // stays HERE and feeds its verdicts in via sniffedForeign; everything else — bucketing, the
    // device-anchor companion filter, _RR-over-_PPI, de-dupe, part-grouping — is now the gate-backed
    // DexIngest.planIngest (§4 ECG-INGEST-FOLLOWUPS-II), the SAME source the routing/plan tests cover.
    const sniffedForeign = new Map();
    for (const f of files) {
      if (classifyECG(f.name) !== 'ecg') continue;
      const k = await sniffEcgKind(f);
      if (k !== 'ecg') sniffedForeign.set(f.name, k);
    }
    const plan = ING.planIngest(files, {
      activeDeviceKey: (RESULT && RESULT.deviceKey) || null, // §4: a companions-ONLY drop anchors on the active recording's device
      sniffedForeign,
      partKey: DSP.partKey
    });
    // Companions (RR/HR/ACC): each lane is deduped part-groups — a single file loads directly, a
    // multi-part stream is concatenated first (header from part 1 only) into one File the loader takes.
    [
      ['rr', loadDeviceRR],
      ['hr', loadDeviceHR],
      ['acc', loadDeviceACC]
    ].forEach(([kind, loader]) => {
      plan.companionLanes[kind].forEach((parts) => {
        if (parts.length === 1)
          loader(parts[0]); // unchanged single-file path
        else mergeFileParts(parts).then(loader); // concatenated multi-part stream
      });
    });
    const ecgGroups = plan.ecgGroups; // ordered part-groups, dup-night already set aside by planIngest
    if (plan.skipped.length) reportSkipped(plan.skipped, ecgGroups.length);
    if (!ecgGroups.length) return; // companions only — applied to current/next ECG
    if (_replaceMode && activeKey) {
      delete allRecordings[activeKey];
      activeKey = null;
      _replaceMode = false;
    }
    const wasDraining = _loadQueue.length > 0;
    _loadQueue = _loadQueue.concat(ecgGroups);
    if (!wasDraining) _processQueue(); // not already draining
  }
  // Tell the user what was set aside and why. A strong (red) error when the drop held
  // NO ECG at all — otherwise the app would silently do nothing and look frozen.
  // ═══════════════════════════════════════════════════════════════════════════
  //  SELF-INGEST review mode (SELF-INGEST-FOLLOWUPS · ECGDex pass, export-inert)
  //  Renders ECGDex's OWN reloaded export as a faithful clinical VIEW from the
  //  stored hrv/quality summary + events. No recompute, no re-stamp; the ECG
  //  waveform + per-beat morphology are greyed (raw not carried in the export).
  // ═══════════════════════════════════════════════════════════════════════════
  function _eesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function _ecgFmtGen(g) {
    if (!g) return '';
    try {
      return String(g).replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ' UTC');
    } catch (e) {
      return String(g);
    }
  }
  function _ecgInjectReviewCSS() {
    if (typeof document === 'undefined' || document.getElementById('ecg-selfingest-css')) return;
    var css =
      '' +
      '#ecgReviewCard{margin:0 0 22px}' +
      '.erv-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 18px;padding:13px 18px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}' +
      '.erv-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}' +
      '.erv-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}' +
      '.erv-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}' +
      '.erv-spacer{flex:1 1 auto}' +
      '.erv-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}' +
      '.erv-card{padding:24px 26px;border-radius:14px;background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}' +
      '.erv-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}' +
      '.erv-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}' +
      '.erv-sub{font-size:13px;color:var(--text3,#5E7187)}' +
      '.erv-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5E7187);margin:18px 0 9px}' +
      '.erv-imp{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}' +
      '.erv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}' +
      '.erv-kpi{padding:12px 14px;border-radius:10px;background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}' +
      '.erv-kpi .k-lab{font-size:11px;color:var(--text3,#5E7187);margin-bottom:5px}' +
      '.erv-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}' +
      '.erv-kpi .k-sub{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}' +
      '.erv-tl{display:flex;flex-direction:column;border:1px solid var(--border,#1f2e45);border-radius:10px;overflow:hidden}' +
      '.erv-tlrow{display:grid;grid-template-columns:84px 1fr auto;align-items:center;gap:10px;padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}' +
      '.erv-tlrow:first-child{border-top:none}' +
      '.erv-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}' +
      '.erv-tlrow .tl-conf{color:var(--text3,#5E7187);font-family:ui-monospace,monospace;font-size:11.5px;text-align:right}' +
      '.erv-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic;padding:6px 2px}' +
      '.erv-greyed{border:1px dashed var(--border,#1f2e45);border-radius:12px;padding:20px;margin-top:4px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 10px,transparent 10px 20px);color:var(--text3,#5E7187);font-size:12.5px;text-align:center}' +
      '.erv-greyed strong{display:block;color:var(--text2,#9FB0C3);font-size:13px;margin-bottom:4px}' +
      '.erv-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}' +
      '.erv-disc .dxl{font-weight:700;color:var(--text2,#9FB0C3)}' +
      '@media print{body > *:not(#ecgReviewCard){display:none !important} #ecgReviewCard .erv-print{display:none !important}}';
    var st = document.createElement('style');
    st.id = 'ecg-selfingest-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function ecgReviewTimeline(events) {
    var evs = Array.isArray(events) ? events.slice() : [];
    if (!evs.length) return '<div class="erv-none">No scored events in this export.</div>';
    evs.sort(function (a, b) {
      return (a.tMs || 0) - (b.tMs || 0);
    });
    var CAP = 40,
      shown = evs.slice(0, CAP);
    var nm = function (e) {
      var i = e.impulse || 'event';
      if (i === 'autonomic_surge') return 'Autonomic surge';
      if (i.indexOf('stage_') === 0) return 'Sleep stage · ' + i.slice(6);
      return i;
    };
    var h =
      '<div class="erv-tl">' +
      shown
        .map(function (e) {
          var when = e.t || '\u2014';
          return (
            '<div class="erv-tlrow"><span class="tl-t">' + _eesc(when) + '</span><span>' + _eesc(nm(e)) + '</span><span class="tl-conf">conf ' + (e.conf != null ? e.conf : '\u2014') + '</span></div>'
          );
        })
        .join('') +
      '</div>';
    if (evs.length > CAP) h += '<div class="erv-none">+ ' + (evs.length - CAP) + ' more events</div>';
    return h;
  }
  function ecgReviewView(review) {
    var rec = review.recording || {},
      hrv = review.hrv || {},
      t = hrv.time || {},
      fq = hrv.frequency || {},
      q = review.quality || {};
    var prov = review.provenance || {},
      bh = prov.buildHash || (review.derivedFrom && review.derivedFrom.buildHash) || null,
      gen = _ecgFmtGen(prov.generated || review.generated);
    var nv = function (v, d) {
      return v == null || Number.isNaN(v) ? d || '\u2014' : v;
    };
    var h =
      '<div class="erv-banner" role="status">' +
      '<span class="erv-tag"><span class="erv-dot"></span>Review mode</span>' +
      '<span>Loaded from export \u00b7 <strong>not recomputed</strong>' +
      (review.scrubbed ? ' \u00b7 <strong>scrubbed for sharing</strong>' : '') +
      '</span>' +
      '<span class="erv-meta">' +
      (bh ? 'built <code>' + _eesc(bh) + '</code>' : 'build unknown') +
      (gen ? ' on <code>' + _eesc(gen) + '</code>' : '') +
      '</span>' +
      '<span class="erv-spacer"></span>' +
      '<button class="erv-print" type="button" data-act="print">\ud83d\udda8 Save clinical PDF</button></div>';
    h += '<div class="erv-card">';
    h +=
      '<div class="erv-head"><span class="erv-title">ECGDex \u2014 ECG review</span>' +
      '<span class="erv-sub">' +
      _eesc(rec.tier || rec.mode || rec.source || 'recording') +
      (rec.durationMin != null ? ' \u00b7 ' + Math.round(rec.durationMin) + ' min' : '') +
      (rec.beats != null ? ' \u00b7 ' + rec.beats + ' beats' : '') +
      '</span></div>';
    h += '<div class="erv-sec">Impression</div>';
    h +=
      '<div class="erv-imp">Mean HR ' +
      nv(t.hr) +
      ' bpm \u00b7 SDNN ' +
      nv(t.sdnn) +
      ' ms \u00b7 rMSSD ' +
      nv(t.rmssd) +
      ' ms' +
      (q.analyzablePct != null ? ' \u00b7 analyzable ' + q.analyzablePct + '%' : '') +
      '. Rendered from the export\u2019s stored values \u2014 no waveform recomputation.</div>';
    var kpis = [
      ['Mean HR', nv(t.hr), 'bpm'],
      ['SDNN', nv(t.sdnn), 'ms'],
      ['rMSSD', nv(t.rmssd), 'ms'],
      ['pNN50', nv(t.pnn50), '%'],
      ['LF/HF', nv(fq.lfhf), 'ratio'],
      ['Analyzable', nv(q.analyzablePct), '%'],
      ['Mean SQI', nv(q.meanSQI), '0\u20131'],
      ['Beats', nv(rec.beats), 'count']
    ];
    h +=
      '<div class="erv-sec">Key metrics</div><div class="erv-kpis">' +
      kpis
        .map(function (k) {
          return (
            '<div class="erv-kpi"><div class="k-lab">' +
            (typeof evBadge === 'function' ? evBadge(k[0]) : '') +
            _eesc(k[0]) +
            '</div><div class="k-val">' +
            _eesc(k[1]) +
            '</div><div class="k-sub">' +
            _eesc(k[2]) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>';
    h += '<div class="erv-sec">Event timeline</div>' + ecgReviewTimeline(review.events);
    h +=
      '<div class="erv-sec">Raw signal</div>' +
      '<div class="erv-greyed"><strong>ECG waveform &amp; per-beat morphology not included</strong>Raw ECG samples are not carried in the export \u2014 review mode shows the derived HRV/quality layer only. Re-run the original *_ECG.txt for the waveform + morphology charts.</div>';
    h +=
      '<div class="erv-disc">' +
      (bh ? 'Provenance \u00b7 build <code>' + _eesc(bh) + '</code>' + (gen ? ' \u00b7 generated ' + _eesc(gen) : '') : 'Provenance \u00b7 build unknown') +
      '<br><span class="dxl">Tepna \u00b7 not a medical device.</span> Computes ECG/HRV patterns for personal self-quantification; does not diagnose, treat, or monitor any condition.' +
      '</div></div>';
    return h;
  }
  function ecgRenderReview(review) {
    if (typeof document === 'undefined' || !review) return;
    _ecgInjectReviewCSS();
    var host = document.getElementById('ecgReviewCard');
    if (!host) {
      host = document.createElement('section');
      host.id = 'ecgReviewCard';
      var m = document.querySelector('main') || document.body;
      m.insertBefore(host, m.firstChild);
    }
    host.innerHTML = ecgReviewView(review);
    host.style.display = '';
  }
  function ecgClearReview() {
    var h = document.getElementById('ecgReviewCard');
    if (h) {
      h.innerHTML = '';
      h.style.display = 'none';
    }
  }
  // F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — the review renderer is reachable via the node
  // namespace (<Node>.reviewView / .renderReview) so the suite's live review probe (and any global
  // caller) can drive it; the bare names stay IIFE-local.
  try {
    if (typeof window !== 'undefined' && window.ECGDex) {
      window.ECGDex.reviewView = ecgReviewView;
      window.ECGDex.renderReview = ecgRenderReview;
    }
  } catch (_rvx) {}

  function reportSkipped(foreign, nEcg) {
    const counts = {};
    foreign.forEach((f) => {
      let l = _FOREIGN_LABEL[f.kind] || 'non-ECG';
      if (f.kind === 'otherdevice') l = 'other-device sensor (' + _deviceName(f.device) + ')';
      counts[l] = (counts[l] || 0) + 1;
    });
    const summary = Object.keys(counts)
      .map((l) => counts[l] + '× ' + l)
      .join(', ');
    if (nEcg > 0) {
      showOK('Loaded ' + nEcg + ' ECG recording' + (nEcg > 1 ? 's' : '') + ' · ignored ' + foreign.length + ' other file' + (foreign.length > 1 ? 's' : '') + ' (' + summary + ').');
      return;
    }
    // §4: a companions-ONLY drop whose sidecars were ALL set aside as foreign-device — they don't belong
    // to the loaded recording. Report specifically (not the generic "no ECG → use PulseDex / OxyDex").
    if (RESULT && RESULT.deviceKey && foreign.length && foreign.every((f) => f.kind === 'otherdevice')) {
      showErr(
        'Set aside ' +
          summary +
          ' — ' +
          (foreign.length > 1 ? 'they don’t' : 'it doesn’t') +
          ' match the loaded ' +
          _deviceName(RESULT.deviceKey) +
          ' recording. Drop the matching ' +
          _deviceName(RESULT.deviceKey) +
          ' sidecar, or load that device’s ECG first.'
      );
      return;
    }
    if (foreign.some((f) => f.kind === 'ppg')) {
      showErr(
        'No chest-strap ECG in this drop — these look like Polar Verity Sense optical files (' +
          summary +
          '). ECGDex needs a Polar H10 “…_ECG.txt” (last column “ecg [uV]”). For optical PPG / HRV, use PulseDex.'
      );
    } else if (foreign.some((f) => f.kind === 'spo2')) {
      showErr(
        'No raw ECG in this drop — set aside ' + summary + '. That looks like a pulse-oximeter SpO₂ file → load it in OxyDex. ECGDex reads a Polar “…_ECG.txt” waveform (last column “ecg [uV]”).'
      );
    } else {
      showErr('No raw ECG file in this drop — set aside ' + summary + '. ECGDex reads a Polar “…_ECG.txt” waveform (last column “ecg [uV]”); add the matching ECG file and drop again.');
    }
  }
  // §5 (ECG-INGEST-FOLLOWUPS): the per-app part-grouping + companion de-dupe now live in the shared,
  // gate-backed DexIngest.planIngest (§4 ECG-INGEST-FOLLOWUPS-II) — loadFiles consults it. The byte-
  // reading helper stays app-side: mergeFileParts reads a multi-part group's text and concatenates it.
  // small companion streams: read + concat in part order (header from part 1 only),
  // returning a single File the existing loader can consume unchanged.
  function mergeFileParts(parts) {
    return Promise.all(parts.map((f) => f.text())).then((texts) => {
      let text = texts[0];
      for (let i = 1; i < texts.length; i++) {
        const lines = texts[i].split(/\r?\n/);
        lines.shift();
        text += (text.endsWith('\n') ? '' : '\n') + lines.join('\n');
      }
      const pk = DSP.partKey && DSP.partKey(parts[0].name);
      return new File([text], pk ? pk.base : parts[0].name, { type: 'text/plain' });
    });
  }
  function _processQueue() {
    if (_loadQueue.length) loadECGFile(_loadQueue[0]);
  }
  function recordingsSorted() {
    return Object.values(allRecordings).sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
  }

  function renderRecSwitcher() {
    const list = recordingsSorted(),
      wrap = $('recSwitcher');
    if (!wrap) return;
    if (list.length <= 1) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    wrap.style.display = 'block';
    const fmt = window.ECGCross ? window.ECGCross.fmtDateTimeUTC : (ms) => String(ms);
    wrap.innerHTML =
      '<div class="sec-label" style="margin-top:10px">Recordings · ' +
      list.length +
      '</div>' +
      list
        .map((s) => {
          const k = s._key,
            active = k === activeKey,
            q = s.analyzablePct >= 90 ? 'ok' : s.analyzablePct >= 75 ? 'warn' : 'bad';
          return (
            '<button class="rec-item ' +
            (active ? 'active' : '') +
            '" data-key="' +
            k +
            '">' +
            '<div class="ri-top"><span class="ri-date">' +
            (s.t0Ms != null ? fmt(s.t0Ms) : 'undated') +
            '</span><span class="ri-q ' +
            q +
            '">' +
            s.analyzablePct +
            '%</span></div>' +
            '<div class="ri-sub">' +
            (s.durSec >= 3600 ? (s.durSec / 3600).toFixed(1) + ' h' : (s.durSec / 60).toFixed(0) + ' min') +
            ' · ' +
            s.dispHr +
            ' bpm · rMSSD ' +
            s.dispRm +
            '</div></button>'
          );
        })
        .join('');
    wrap.querySelectorAll('.rec-item').forEach((b) => b.addEventListener('click', () => selectRecording(b.getAttribute('data-key'))));
  }
  function selectRecording(key) {
    const r = allRecordings[key];
    if (!r) return;
    activeKey = key;
    RESULT = r;
    // restore this recording's own device-lane attachments (per-recording, not global)
    DEVICE_RR = r.deviceRR || null;
    DEVICE_HR = r.deviceHR || null;
    DEVICE_ACC = r.deviceACC || null;
    ACC_FS = r.accFs || null;
    renderAll(r);
    renderRecSwitcher();
    renderCrossNight();
  }

  function renderCrossNight() {
    const sec = $('crossNightSection');
    if (!sec) return;
    const list = recordingsSorted();
    if (list.length < 2 || !window.ECGCross) {
      sec.style.display = 'none';
      return;
    }
    sec.style.display = 'block';
    const CN = window.ECGCross,
      UI2 = window.ECGUI;
    const qtcOf = (s) => (s.morph && s.morph.delin && s.morph.delin.valid ? s.morph.delin.qtcBazett : null);
    const metrics = [
      { label: 'rMSSD', unit: 'ms', good: 'up', get: (s) => s.dispRm },
      { label: 'SDNN', unit: 'ms', good: 'up', get: (s) => s.dispSd },
      { label: 'Mean HR', unit: 'bpm', good: 'down', get: (s) => s.dispHr },
      { label: 'DFA α1', unit: '', good: 'up', get: (s) => s.dfa1 },
      { label: 'QTc', unit: 'ms', good: 'down', get: qtcOf },
      { label: 'CVHR', unit: '/h', good: 'down', get: (s) => (s.longRec && !s.ambulatory ? s.cvhr.index : null) },
      { label: 'Decel. cap.', unit: 'ms', good: 'up', get: (s) => s.dc }
    ];
    const cov = list.map((s) => Math.max(0.05, (s.analyzablePct || 0) / 100));
    const tCol = (lbl) => (lbl === 'improving' ? 'ok' : lbl === 'declining' ? 'bad' : 'neutral');
    let rows = '',
      headline = [];
    metrics.forEach((m) => {
      const series = list.map((s, i) => ({ x: i, t: s.t0Ms, v: m.get(s), w: cov[i] })).filter((p) => p.v != null && isFinite(p.v));
      if (series.length < 2) return;
      const st = CN.crossNight(series, { good: m.good });
      const col = st.trendLabel === 'improving' ? UI2.COLORS.green : st.trendLabel === 'declining' ? UI2.COLORS.red : UI2.COLORS.blue;
      const spark = UI2.lineChart(
        series.map((p) => ({ x: p.x, y: p.v })),
        col,
        { W: 200, H: 52, med: st.mean }
      );
      const zCol = st.zLatest == null ? 'neutral' : Math.abs(st.zLatest) >= DexKernel.K.Z_BAD ? 'bad' : Math.abs(st.zLatest) >= DexKernel.K.Z_WARN ? 'warn' : 'ok';
      rows +=
        '<tr><td class="cn-metric fmt-m">' +
        evBadge(m.label) +
        m.label +
        '<span style="opacity:.5"> ' +
        m.unit +
        '</span></td>' +
        '<td class="cn-spark">' +
        spark +
        '</td>' +
        '<td class="mono">' +
        st.mean +
        '<span style="opacity:.5"> ±' +
        st.sd +
        '</span></td>' +
        '<td class="mono">' +
        st.cv +
        '%</td>' +
        '<td class="mono">' +
        (st.slopePerDay == null ? '—' : (st.slopePerDay > 0 ? '+' : '') + st.slopePerDay) +
        '<span style="opacity:.5">/d</span></td>' +
        '<td class="mono">' +
        (st.tau == null ? '—' : st.tau) +
        ' <span style="opacity:.5">p' +
        (st.p == null ? '—' : st.p) +
        '</span></td>' +
        '<td><span class="cn-trend ' +
        tCol(st.trendLabel) +
        '">' +
        st.trendLabel +
        '</span></td>' +
        '<td class="mono"><span class="cn-z ' +
        zCol +
        '">' +
        (st.zLatest == null ? '—' : (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ') +
        '</span></td></tr>';
      if (st.zLatest != null && Math.abs(st.zLatest) >= DexKernel.K.Z_HEADLINE) headline.push(m.label + ' ' + (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ vs your ' + st.n + '-night baseline');
      if (st.ci && (st.ci[0] > 0 || st.ci[1] < 0) && st.n >= 7) headline.push(m.label + ' shifted ' + (st.deltaHalves > 0 ? '+' : '') + st.deltaHalves + m.unit + ' (95% CI excludes 0)');
    });
    $('crossNightTable').innerHTML =
      '<table class="cn-table" style="width:100%;border-collapse:collapse"><thead><tr>' +
      '<th style="text-align:left">Metric</th><th style="text-align:left">Trend</th><th style="text-align:left">Mean</th><th style="text-align:left">CV</th><th style="text-align:left">Slope</th><th style="text-align:left">Mann–Kendall</th><th style="text-align:left">Direction</th><th style="text-align:left">Latest z</th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table>';
    $('crossNightHeadline').innerHTML =
      '<div class="cn-head-label">Newest recording vs baseline</div>' +
      (headline.length
        ? headline
            .slice(0, 3)
            .map((h) => '<div class="cn-head-item">' + h + '</div>')
            .join('')
        : '<div class="cn-head-item dim">No metric is beyond ±1σ of its personal baseline — a consistent night.</div>');
    $('crossNightNote').innerHTML =
      list.length +
      " recordings · OLS slope vs date + non-parametric <b>Mann–Kendall</b> (τ, p) for short noisy series · personal-baseline <b>z-scores</b> · coverage-weighted by each night's analyzable %. The same <code>crossNight()</code> engine powers PpgDex &amp; OxyDex trends.";
  }

  function buildV2(r) {
    const p = r.profile || {};
    const round = (v, d = 2) => (v == null ? null : typeof v === 'number' ? +v.toFixed(d) : v);
    // ACC full-pipeline (reuse the render-time computation when present; else compute once)
    const accEx = r._accEx || (r.deviceACC && r.deviceACC.length && DSP.accExtras ? DSP.accExtras(r.deviceACC, r.accFs, r.t0Ms, r.durSec, r.epochs, r.stages) : null);
    // per-5-min RRacc (median of high-confidence 30-s epochs) for timeseries alignment
    const accRespAt = {};
    if (accEx && accEx.rracc) {
      r.epochs.forEach((e) => {
        const w = accEx.rracc.filter((x) => x.conf === 'high' && x.tStartMin >= e.tMin && x.tStartMin < e.tMin + 5).map((x) => x.rr);
        if (w.length) {
          w.sort((a, b) => a - b);
          accRespAt[e.tMin.toFixed(1)] = +w[w.length >> 1].toFixed(1);
        }
      });
    }
    const _geom = _baevskyGeom(r.nn); // Baevsky-SI inputs for the envelope (FOLLOWUP P4)
    const out = {
      kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
      schema: {
        name: 'ganglior.node-export',
        version: '2.0',
        node: 'ECGDex',
        nodeVersion: '1.1',
        generated: new Date().toISOString(),
        provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null, // R1: build + input fingerprints
        doc: 'Single-signal ECG analyzer export. All metrics computed from raw ECG only. nulls = not computed at this recording length/quality. Time-series under `timeseries` are the cross-node currency (GlucoDex/CPAPDex/Ganglior consume these).',
        units: {
          rr: 'ms',
          hr: 'bpm',
          power: 'ms^2',
          sd: 'ms',
          time: 's',
          tMin: 'min',
          amplitude: 'uV',
          interval: 'ms',
          vo2: 'ml/kg/min',
          age: 'yr',
          ahi: 'events/h',
          cvhr: 'events/h',
          slope: 'ln-units/h',
          burden: '%',
          conf: '0..1'
        }
      },
      recording: {
        source: r.source,
        sampleRateHz: r.fs,
        durationSec: round(r.durSec, 1),
        durationMin: r.durMin,
        tier: r.tier,
        tierNote: r.tierMsg,
        mode: r.mode,
        modeLabel: r.modeLabel,
        modeWhy: r.modeWhy,
        ambulatory: !!r.ambulatory,
        activityScore: r.activityScore,
        startEpochMs: r.t0Ms || null,
        beats: r.nBeats,
        epochs5min: r.epochs.length,
        longRecording: r.longRec
      },
      quality: {
        analyzablePct: r.analyzablePct,
        cleanBeatPct: r.cleanBeatPct,
        coveragePct: r.coveragePct,
        activeMin: r.activeMin,
        spanMin: r.spanMin,
        gapMin: r.gapMin,
        gaps: r.nGaps,
        lowCoverage: !!r.lowCoverage,
        correctionRatePct: r.correctionRate,
        beatsCorrected: r.nCorrected,
        ectopicBeatsCorrected: r.nEctopyCorrected,
        correctionNote:
          'beats replaced by local median: low-SQI + out-of-range + ectopic (>20% from local median, Malik/Kubios). ectopicBeatsCorrected isolates the ectopy-only fixes — these clean rMSSD/pNN50 of PAC/PVC spikes so the HRV agrees with PulseDex/Kubios.',
        meanSQI: r.meanSQI,
        sqiNote:
          'kSQI · bSQI(±50ms) · RR-plausibility · flatline/rail · amplitude. Per-surge SQI rides on each Ganglior event as `sqi` (separate from `conf`, which now scales to CVHR surge magnitude).',
        meanSQICaveat:
          r.meanSQI != null && r.meanSQI < 0.6
            ? 'Mean SQI ' +
              r.meanSQI +
              ' is borderline (<0.6) — derived HRV/morphology are usable but lower-confidence; treat intervals & frequency metrics as directional and weight cross-node consensus accordingly.'
            : null,
        coverageNote: 'analyzablePct = cleanBeatPct × coverage. coverage = active(beat-covered) time ÷ raw span; stray beats after strap-off do not inflate duration.'
      },
      hrv: {
        time: {
          hr: r.dispHr,
          meanRR: r.meanRR,
          medianRR: r.medianRR,
          sdnn: r.dispSd,
          rmssd: r.dispRm,
          pnn50: r.dispPn,
          nn50: r.nn50,
          cv: r.cv,
          minRR: r.minRR,
          maxRR: r.maxRR,
          q25RR: r.q25,
          q75RR: r.q75,
          sdann: r.sdann,
          sdnnIndex: r.sdnnIdx,
          lnRMSSD: r.lnrmssd,
          triangularIndex: r.triIdx,
          wholeRecordHR: r.hr,
          wholeRecordSDNN: r.sdnn,
          wholeRecordRMSSD: r.rmssd,
          amo50: _geom.amo50,
          mode: _geom.mode,
          mxDMn: _geom.mxDMn,
          units: 'ms',
          geometricNote:
            'Baevsky-SI inputs (Brennan/Welltory convention): amo50 = amplitude of the modal RR (%), mode = modal RR (ms), mxDMn = RR variation range (SECONDS). Same values as the ⬇ HRVDex CSV columns; null when the NN series is empty.',
          windowNote:
            'sdnn/rmssd/pnn50 here are DISPLAY values = representative 5-min epoch median on overnight recordings (short recs: whole-record). For CROSS-NODE comparison use wholeRecordSDNN/wholeRecordRMSSD (whole-record) or sdnnIndex (mean of per-5-min SDNN).'
        },
        poincare: {
          sd1: r.sd1,
          sd2: r.sd2,
          sd1sd2: r.sd1sd2,
          ellipseArea: r.ellArea,
          representativeWindow: r.poincareRep,
          representativeEpochIndex: r.poincareRepIdx ?? null,
          representativeEpochTMin: r.poincareRepTMin ?? null,
          representativeWindowNote: r.poincareRep ? 'SD1/SD2 from the rep 5-min epoch (index/tMin given) so another node can reconstruct which window was plotted' : 'whole-record NN'
        },
        frequency: {
          totalPower: r.tp,
          vlf: r.vlf,
          lf: r.lf,
          hf: r.hf,
          lfhf: r.lfhf,
          lfnu: r.lfnu,
          hfnu: r.hfnu,
          respRate: r.respRate,
          respRateEpochStats: r.respStats || null,
          method: 'Lomb–Scargle',
          respRateNote: 'respRate = whole-night scalar; respRateEpochStats = per-5-min EDR spread (min/max/median/sd) for resp-rate-instability screening (CPAPDex)'
        },
        nonlinear: {
          dfaAlpha1: r.dfa1,
          sampleEntropy: r.sampen,
          decelCapacity: r.dc,
          accelCapacity: r.ac,
          fragmentationPIP: r.pip,
          fragmentationIALS: r.ials,
          fragmentationPSS: r.pss,
          thresholds: {
            fragmentationPIPflagPct: 55,
            decelCapacityLowMs: 4.5,
            decelCapacityNote: 'DC<4.5 ms = elevated all-cause mortality marker (PRSA, Bauer 2006)',
            pipNote: 'PIP>55% = fragmented (Costa 2017)',
            ialsNote: 'inverse avg run length — higher=more fragmented',
            pssNote: '% NN in short (<3-beat) segments'
          }
        }
      },
      personalization: {
        // DEEP-AUDIT §19 — the note below was FALSE for age/sex/weight/height/elevation/cpap: those six
        // could never be null, because the population default (42 y · M · 80 kg · 178 cm) was written as
        // if the user had entered it. A profile nobody filled in shipped as personal identity data.
        // `_ent()` writes a field ONLY when the cascade says the user actually set it ('you'), or a
        // recording detected it ('detected') — exactly the discipline hrMax/restingHR/vo2 already used.
        // What COMPUTE actually ran on is not lost: it moves to `assumedDefaults` below, labelled.
        profile: (function () {
          var o = p._origins || null;
          var ent = function (field, val) {
            return o && (o[field] === 'you' || o[field] === 'detected') ? val : null;
          };
          return {
            age: ent('age', p.age),
            sex: ent('sex', p.sex),
            weightKg: ent('weight', p.weight),
            heightCm: ent('height', p.height),
            elevationM: ent('elevation', p.elev),
            cpapBipap: ent('cpap', p.cpap ? 'yes-in-use' : 'not-used'),
            onCPAP: ent('cpap', !!p.cpap),
            hrMaxEntered: p.hrmax && p.hrmax > 0 ? p.hrmax : null,
            restingHREntered: p.rhr && p.rhr > 0 ? p.rhr : null,
            vo2maxGroundTruthEntered: p.vo2gt && p.vo2gt > 0 ? p.vo2gt : null,
            note: 'All fields the user entered/selected in the profile panel. null = left on auto/default.'
          };
        })(),
        // The population priors COMPUTE actually used where the user entered nothing. NOT personal data —
        // recorded so the derived numbers stay reproducible without pretending they describe this person.
        assumedDefaults: (function () {
          var o = p._origins || null;
          var asm = function (field, val) {
            return o && (o[field] === 'you' || o[field] === 'detected') ? null : val;
          };
          return {
            age: asm('age', p.age),
            sex: asm('sex', p.sex),
            weightKg: asm('weight', p.weight),
            heightCm: asm('height', p.height),
            elevationM: asm('elevation', p.elev),
            onCPAP: asm('cpap', !!p.cpap),
            source: 'population norm (NHANES age×sex; Tanaka HRmax) — the value the analysis ran on',
            note: 'null = the user supplied this field, so no default was needed. A non-null value here is NOT a measurement of this person.'
          };
        })(),
        ansReadinessScore: r.hrvScore ?? null,
        ansAge: null /* ANS Age REMOVED 2026-06-21 (external-review WP-A); key kept null for node-export back-compat (consumers tolerate null). */,
        restingHR: r.rhrEff ?? null,
        restingHRNocturnalFloor: r.hrFloor ?? null,
        hrMax: r.hrmaxEff ?? null,
        hrMaxSource: r.hrmaxRejected ? 'tanaka(entry-rejected)' : p.hrmax > 0 ? 'user' : 'tanaka',
        vo2maxBase: r.vo2base ?? null,
        vo2maxAdjusted: r.vo2adj ?? null,
        vo2maxGroundTruth: r.vo2gt ?? null,
        altitudeFactor: r.altFactor ?? null,
        altitudeFactorFormula: 'elev≤1500m → 1; else 1 − 0.0033·(elev−1500)/100',
        vo2maxFormula: 'Uth–Sørensen 15.3·HRmax/HRrest, ×altitudeFactor, then ×(1 + clamp(±0.08, 0.10·(lnRMSSD−3.4)))',
        expectedRMSSDForAge: r.expRmssd ?? null,
        expectedRestHRForAge: r.expRHR ?? null
      },
      apnea: r.ambulatory
        ? {
            reportable: false,
            suppressedReason: (r.apneaSuppressed && r.apneaSuppressed.suppressedReason) || 'ambulatory — CVHR invalid under exercise',
            cvhrIndex: null,
            estimatedAHI: null,
            riskCategory: null,
            onCPAP: !!p.cpap,
            method:
              'CVHR/cardiopulmonary-coupling proxy (Hilmisson 2019) — WITHHELD: recording is ambulatory/awake-active, exercise HR dynamics read as cardiogenic oscillation. Mirrors the R5 null-model pattern (index withheld with a reason, never fabricated).'
          }
        : r.longRec
          ? {
              cvhrIndex: r.cvhr.index,
              cvhrEvents: r.cvhr.events.length,
              estimatedAHI: r.estAHI ? { value: r.estAHI.value, range: [r.estAHI.lo, r.estAHI.hi], band: r.estAHI.band } : null,
              riskCategory: r.apneaRisk ? r.apneaRisk.cat : null,
              onCPAP: !!p.cpap,
              method: 'CVHR/cardiopulmonary-coupling proxy (Hilmisson 2019) — ECG-only, screen not diagnosis',
              surgeEscalationPct: r.surgeEsc ? r.surgeEsc.escalationPct : null
            }
          : null,
      hrvStability: r.hrvStab
        ? {
            sigma_lnRMSSD_slope: r.hrvStab.sigma_lnRMSSD_slope,
            var_lnRMSSD_slope: r.hrvStab.var_lnRMSSD_slope,
            mean_lnRMSSD_slope: r.hrvStab.mean_lnRMSSD_slope,
            classification: r.hrvStab.classification,
            windows: r.hrvStab.nWindows,
            ref: 'Li & Kiyono 2026 Sensors 26(4):1118 [CC BY 4.0]',
            interpretation: 'slope<0 stabilizing (favourable) · slope>0 rising instability (glycemic-risk signal)',
            series: r.hrvStab.series
          }
        : null,
      cardiorespiratory: r.crc
        ? {
            edrRespRate: r.crc.respFromEDR,
            rsaEfficiencyRatio: r.crc.rsaEfficiencyRatio,
            rsaAmplitudeBpm: r.crc.rsaAmplitudeBpm,
            crcPLV: r.crc.crcPLV,
            couplingStrength: r.crc.couplingStrength,
            plvDuringSurges: r.crc.plvDuringSurges,
            plvBaseline: r.crc.plvBaseline,
            perEpochPLV: r.crc.epochCRC,
            method: 'EDR (R-peak amplitude modulation) ⟷ RR coupling — ECG-only, no airflow/PPG',
            refs: {
              rsaEfficiency: 'Border et al. 2025 arXiv:2507.00597 (RSA minimises cardiac power; ~1.5× insp HR optimum)',
              crcPLV: 'arXiv:2508.00773 (model-free CRC via phase-locking value)',
              couplingStrength: 'arXiv:2605.18802 (CSI cardiorespiratory-coupling index)'
            },
            interpretation:
              'rsaEfficiencyRatio = insp:exp HR ratio (higher = stronger RSA). crcPLV & couplingStrength ∈ [0,1]; both drop during CVHR/apnea clusters (plvDuringSurges < plvBaseline) → a CVHR confidence channel. All derived from existing pipeline outputs — zero new sensors.'
          }
        : null,
      morphology: r.morph
        ? {
            ectopy: {
              pvc: r.morph.nPVC,
              pac: r.morph.nPAC,
              pvcBurdenPct: r.morph.pvcBurden,
              pacBurdenPct: r.morph.pacBurden,
              couplets: r.morph.couplets,
              ventricularRunsGE3: r.morph.runsGE3,
              bigeminyCycles: r.morph.bigeminyCycles,
              medianQRSWidthMs: r.morph.medW
            },
            intervals: r.morph.delin.valid
              ? (function () {
                  var dq = r.morph.delin.qrsDur,
                    mw = r.morph.medW,
                    sat = !!r.morph.delin.qrsSaturated;
                  var qt = r.morph.qtcTrend || [];
                  var nSat = qt.filter(function (w) {
                    return w.qrsSaturated;
                  }).length;
                  var satFrac = qt.length ? +(nSat / qt.length).toFixed(2) : null;
                  // Canonical QRS width = the validated beat-template energy median (== ectopy.medianQRSWidthMs).
                  // Delineation value kept for transparency; if it disagrees (>15 ms) or saturated, the template
                  // value is authoritative — never publish two different QRS widths (was 123 vs 62).
                  var reconciled = sat || (dq != null && mw != null && Math.abs(dq - mw) > 15);
                  var sampleMs = +(1000 / (r.fs || 130)).toFixed(2);
                  return {
                    qrsDur: mw != null ? mw : dq,
                    qrsDurDelineated: dq,
                    qrsDurSaturated: sat,
                    qrsSaturatedWindowFraction: satFrac,
                    qrsDurMethod: 'beat-template energy median' + (reconciled ? ' (delineation disagreed/saturated → template authoritative)' : ' (delineation agrees)'),
                    qt: r.morph.delin.qt,
                    qtcBazett: r.morph.delin.qtcBazett,
                    qtcFridericia: r.morph.delin.qtcFrid,
                    pr: r.morph.delin.pr,
                    stLevel: r.morph.delin.st,
                    rAmplitude: r.morph.delin.Ramp,
                    tAmplitude: r.morph.delin.Tamp,
                    pWaveResolved: r.morph.delin.pPresent,
                    sampleGridMs: sampleMs,
                    precisionNote:
                      'Intervals reported in ms but resolved on a ' +
                      sampleMs +
                      ' ms sample grid (' +
                      (r.fs || 130) +
                      ' Hz) → ±1 sample (~' +
                      sampleMs +
                      ' ms) uncertainty. Clinical QT analysis wants ≥250 Hz; treat as a within-subject directional trend, single lead ≠ 12-lead.'
                  };
                })()
              : { withheld: true, reason: 'no valid median beat (insufficient clean aligned normal beats)' },
            qtcTrend: r.morph.qtcTrend ? r.morph.qtcTrend : null,
            qtcTrendNote: r.morph.qtcTrend
              ? 'Per-15-min windowed median-beat QTc (Bazett). The cross-node feed GlucoDex lines up against overnight glucose — rising QTc as glucose falls is the beat-level hypoglycemia⟷repolarisation link. Within-subject trend, single lead ≠ 12-lead. Windows flagged `unstable:true` deviate >60 ms from the trend median — a delineation / QRS-saturation artifact (lead-vector or T-end flip), NOT physiology; exclude them before reading a QTc trend or correlating against glucose.'
              : 'Withheld — recording too short / too few clean windows for a QTc trend (single summary QTc in `intervals` only).',
            twa: r.morph.twa ? r.morph.twa.uv : null,
            tWaveAlternans: r.morph.twa
              ? {
                  uv: r.morph.twa.uv,
                  abnormal: r.morph.twa.abnormal,
                  nBeats: r.morph.twa.nBeats,
                  method: r.morph.twa.method,
                  thresholdUv: 47,
                  note: 'MTWA ≥47 µV flags repolarisation instability; co-travels with hypoglycemic QTc stress. Single-lead MMA screen, not the spectral clinical test.'
                }
              : null,
            afScreen: { verdict: r.morph.af.verdict, flaggedWindowsPct: r.morph.af.suspiciousPct, deltaRREntropy: r.morph.af.shannon, note: 'RR-irregularity screen only — P-wave weak at 130 Hz' }
          }
        : null,
      sleep: r.ambulatory
        ? {
            suppressed: true,
            suppressedReason: (r.sleepSuppressed && r.sleepSuppressed.suppressedReason) || 'high-activity / ambulatory',
            stages: null,
            method:
              'Cardiorespiratory staging WITHHELD — ambulatory/awake-active recording (a walk is not a sleep study). Field kept present + explicitly suppressed so consumers never hit a missing key.'
          }
        : r.longRec
          ? (function () {
              var sm = r.stageMin || {},
                tot = r.totSleep || 0;
              var remF = tot > 0 && sm.REM != null ? sm.REM / tot : null,
                deepF = tot > 0 && sm.Deep != null ? sm.Deep / tot : null;
              // Physiological norms (adult): REM ~0.20–0.25, Deep ~0.13–0.23. Flag out-of-range
              // single-signal estimates rather than presenting them as measured truth.
              var flags = [];
              if (remF != null && (remF < 0.1 || remF > 0.35)) flags.push('REM ' + (remF * 100).toFixed(0) + '% outside plausible 13–25%');
              if (deepF != null && (deepF < 0.05 || deepF > 0.3)) flags.push('Deep ' + (deepF * 100).toFixed(0) + '% outside plausible 13–23%');
              return {
                totalSleepMin: tot,
                stageMinutes: r.stageMin,
                method: 'Cardiorespiratory staging from HRV (LF/HF, rMSSD) + ECG-derived respiration — a single-signal ESTIMATE, not a validated PSG hypnogram.',
                confidence: 'low',
                confidenceNote:
                  'Single autonomic channel cannot resolve true sleep stages reliably; minute counts are directional. Reconcile against another node (see Integrator staging_disagreement) or PSG.',
                plausibility: flags.length ? { ok: false, issues: flags } : { ok: true }
              };
            })()
          : null,
      acc: accEx
        ? {
            sampleRateHz: accEx.accFs,
            durationMin: accEx.durMin,
            respiratoryRate: accEx.rraccSummary
              ? {
                  mean: accEx.rraccSummary.mean,
                  sd: accEx.rraccSummary.sd,
                  highConfidencePct: accEx.rraccSummary.highPct,
                  nEpochs30s: accEx.rraccSummary.nEpochs,
                  method: 'chest-axis ACC magnitude → detrend → FFT dominant 0.15–0.45 Hz per 30-s epoch; resp-band SNR ≥ 3 dB = high-confidence',
                  note: 'Independent of the ECG-derived EDR (see edrAgreement for cross-validation). Per-5-min values ride on timeseries.epochs[].accResp.'
                }
              : null,
            edrAgreement: accEx.agreement
              ? {
                  pairedEpochs: accEx.agreement.n,
                  pearsonR: accEx.agreement.r,
                  mae: accEx.agreement.mae,
                  meanDelta: accEx.agreement.meanDelta,
                  sdDelta: accEx.agreement.sdDelta,
                  limitsOfAgreement: accEx.agreement.loa,
                  disagreementRatePct: accEx.agreement.disagreeRate,
                  verdict:
                    accEx.agreement.r >= 0.85 || (accEx.agreement.mae <= 1.5 && Math.abs(accEx.agreement.meanDelta) <= 1.5)
                      ? 'strong'
                      : accEx.agreement.r >= 0.65 || accEx.agreement.mae <= 3.0
                        ? 'moderate'
                        : 'poor',
                  note: 'RRacc vs ECG-derived respiration (EDR), paired at the 5-min epoch cadence. Verdict is MAE/bias-aware (Bland–Altman) because a narrow EDR range deflates Pearson r.'
                }
              : null,
            sleepStageConsensus: accEx.consensus
              ? {
                  consensusRatePct: accEx.consensus.rate,
                  epochs: accEx.consensus.n,
                  conflicts: accEx.consensus.nConflict,
                  conflictEpochs: accEx.consensus.conflicts.map((c) => ({ tMin: c.tMin, hrvStage: c.hrv, accVote: c.vote, direction: c.dir })),
                  method: 'gross-motion vote (jerk mean|ΔVM|, normalised 0–100): Wake>20 / Ambiguous 5–20 / Sleep<5, cross-checked vs the HRV+EDR stage',
                  note: 'Conflicts may indicate PLMS, brief arousals without a sustained HR change, or sensor shift.'
                }
              : null,
            gait: accEx.gait
              ? accEx.gait.walking
                ? {
                    totalSteps: accEx.gait.totalSteps,
                    bouts: accEx.gait.bouts.length,
                    boutDetail: accEx.gait.bouts,
                    activityZones: accEx.gait.zonePct,
                    cadenceEpochs: accEx.gait.cadEpochs,
                    method: 'De-gravitated vertical magnitude band-passed 0.5–3.5 Hz, adaptive-threshold peak detection (≥ 250 ms inter-step). Single chest sensor → no left/right asymmetry.'
                  }
                : {
                    walking: false,
                    totalSteps: accEx.gait.totalSteps || 0,
                    reason:
                      accEx.gait.reason === 'lowfs'
                        ? 'ACC sample rate ' + accEx.gait.accFs + ' Hz < 7 Hz needed to resolve the 0.5–3.5 Hz step band'
                        : 'fewer than 50 steps detected (sleep / still recording)'
                  }
              : null,
            doc: 'Companion-accelerometer cross-checks computed in-node: independent respiratory rate, its agreement with ECG-derived respiration, sleep-stage motion consensus, and step/gait. ACC-derived, informational.'
          }
        : null,
      timeseries: {
        doc: 'Per-5-min-epoch aggregates — the primary cross-node feed. GlucoDex regresses epochRMSSD/epochHR for nocturnal autonomic-instability → IR-risk; epoch.qtc (when present, nearest 15-min windowed QTc) lets it line QTc up against overnight glucose.',
        epochs: r.epochs.map((e) => {
          const o = {
            tMin: e.tMin,
            beats: e.n,
            hr: e.hr,
            meanRR: e.meanRR,
            rmssd: e.rmssd,
            sdnn: e.sdnn,
            pnn50: e.pnn,
            lf: e.lf,
            hf: e.hf,
            lfhf: e.lfhf,
            respRate: e.resp,
            position: e.position || 'unknown'
          };
          if (r.morph && r.morph.qtcTrend) {
            let best = null,
              bd = 1e9;
            for (const q of r.morph.qtcTrend) {
              const dd = Math.abs(q.tMin - e.tMin);
              if (dd < bd && dd <= 15) {
                bd = dd;
                best = q;
              }
            }
            if (best) o.qtc = best.qtc;
          }
          const ar = accRespAt[e.tMin.toFixed(1)];
          if (ar != null) o.accResp = ar;
          return o;
        }),
        sleepStages: r.longRec && !r.ambulatory ? r.stages.map((s) => ({ tMin: s.tMin, stage: s.stage })) : null
      },
      ganglior_events: r.events.map((ev) => {
        const { _sec, ...clean } = ev;
        return clean;
      }),
      reserved: {
        doc: 'Fields awaiting other fleet nodes/models; null until available.',
        osaTransformerLabels: null,
        osaTransformerRef: 'Almarshad 2026 Front.AI 9:1727091 (Phase 2 model)',
        deltaSBP: null,
        deltaSBPSource: 'BioZDex',
        glucoseCorrelation: null,
        glucoseSource: 'GlucoDex'
      }
    };
    return out;
  }
  function exportJSON() {
    const list = recordingsSorted();
    if (list.length <= 1) {
      const r = list[0] || RESULT;
      if (!r) return;
      dl(JSON.stringify(buildV2(r), null, 2), exportName({ node: 'ECGDex', t0Ms: r.t0Ms, kind: 'summary', ext: 'json' }), 'application/json;charset=utf-8');
      showOK('Exported full AI-readable JSON (' + r.epochs.length + ' epoch records + all metrics + schema/units).');
    } else {
      // span-aware series filename: anchor = earliest recording, span = first→last (days).
      const _ts = list.map((x) => x.t0Ms).filter((v) => v != null);
      const _aT0 = _ts.length ? Math.min.apply(null, _ts) : null;
      const _aSpan = _ts.length > 1 ? Math.round((Math.max.apply(null, _ts) - Math.min.apply(null, _ts)) / 864e5) : null;
      const payload = {
        kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
        schema: {
          name: 'ganglior.node-export',
          version: '2.0',
          node: 'ECGDex',
          nodeVersion: '1.1',
          multiRecording: true,
          generated: new Date().toISOString(),
          provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null,
          doc: 'Array of per-recording v2.0 envelopes (each element is Integrator-readable unchanged) + a crossNight aggregate header.'
        },
        generated: new Date().toISOString(),
        recordingCount: list.length,
        crossNight: window.ECGCross.crossNightBlock(list),
        recordings: list.map(buildV2)
      };
      dl(JSON.stringify(payload, null, 2), exportName({ node: 'ECGDex', t0Ms: _aT0, kind: 'series', ext: 'json', spanDays: _aSpan }), 'application/json;charset=utf-8');
      showOK('Exported ' + list.length + ' recordings (array of v2.0 envelopes + crossNight aggregates).');
    }
  }
  function exportGanglior() {
    if (!RESULT) return;
    const r = RESULT;
    // SIGNAL-ADAPTER-PHASE9 (ECGDex leg, node 3/4 · brief §1B): delegate to the SHARED
    // ecgBuildNodeExport in the DSP so this app's Ganglior stream is byte-identical to the
    // headless ECGDex.compute() the Data Unifier / OverDex emit. ONE event source
    // (analyze→r.events), ONE envelope builder; kernel/provenance ride in via opts.
    const build = (window.ECGDSP && ECGDSP.buildNodeExport) || (window.ECGDex && ECGDex.buildNodeExport) || null;
    const out = build
      ? build(r, {
          kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
          provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null,
          offsetMin: r.offsetMin ?? null
        })
      : null;
    if (!out) {
      showErr('Ganglior export unavailable — ECGDSP.buildNodeExport not loaded.');
      return;
    }
    dl(JSON.stringify(out, null, 2), exportName({ node: 'ECGDex', t0Ms: r.t0Ms, kind: 'ganglior', ext: 'json' }), 'application/json;charset=utf-8');
    showOK('Ganglior event stream exported (' + (out.ganglior_events ? out.ganglior_events.length : 0) + ' events).');
  }
  function copyTable() {
    const rows = document.querySelectorAll('#tblWrap table tr');
    const txt = [...rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join('\t')).join('\n');
    navigator.clipboard.writeText(txt).then(() => showOK('Metrics table copied.'));
  }

  function resetAll() {
    document.body.classList.remove('has-data');
    RESULT = null;
    DEVICE_RR = null;
    DEVICE_HR = null;
    DEVICE_ACC = null;
    ACC_FS = null;
    allRecordings = {};
    activeKey = null;
    _loadQueue = [];
    _replaceMode = false;
    {
      const w = $('recSwitcher');
      if (w) {
        w.style.display = 'none';
        w.innerHTML = '';
      }
    }
    {
      const c = $('crossNightSection');
      if (c) c.style.display = 'none';
    }
    ['scopeSection', 'qualitySection', 'chartsSection', 'morphSection', 'hypnoCard', 'stabilityCard', 'cvhrCard', 'crcCard', 'trendCard', 'valCard', 'hrCard', 'accCard', 'gangSection'].forEach(
      (id) => {
        const e = $(id);
        if (e) e.style.display = 'none';
      }
    );
    ['slKPI', 'slTbl'].forEach((id) => ($(id).style.display = 'none'));
    $('kpiGrid').classList.remove('show');
    $('kpiGrid').innerHTML = '';
    $('tblWrap').classList.remove('show');
    $('tblBody').innerHTML = '';
    $('ctxBanner').style.display = 'none';
    $('exportBar').classList.remove('show');
    $('sidebarDataCard').style.display = 'none';
    $('ecgChip').classList.remove('show');
    ['rr', 'hr', 'acc'].forEach((w) => {
      const st = $(w + 'Status'),
        card = $(w + 'Load');
      if (st) {
        st.textContent = 'No ' + w.toUpperCase() + ' file';
        st.classList.remove('ok');
      }
      if (card) {
        card.classList.remove('loaded');
      }
    });
    if (window.ECGProfile) window.ECGProfile.hide();
    $('aInfo').classList.add('show');
    clearAlertsExceptInfo();
  }

  // re-run only the personalisation-dependent renders when the user edits a profile field
  function reRenderProfile() {
    if (!RESULT) return;
    if (window.ECGProfile) window.ECGProfile.render(RESULT);
    renderKPI(RESULT);
    renderTable(RESULT);
  }

  // ─── alerts / progress ───────────────────────────────────────────────────────
  function progress(pct, msg) {
    $('prog').classList.add('show');
    $('progBar').style.width = pct + '%';
    $('proc').textContent = msg || '';
  }
  function clearAlerts() {
    ['aInfo', 'aOK', 'aErr'].forEach((id) => $(id).classList.remove('show'));
  }
  function clearAlertsExceptInfo() {
    ['aOK', 'aErr'].forEach((id) => $(id).classList.remove('show'));
  }
  function showOK(m) {
    $('aOKmsg').textContent = m;
    $('aOK').classList.add('show');
    setTimeout(() => $('aOK').classList.remove('show'), 6500);
  }
  function showErr(m) {
    $('aErrmsg').textContent = m;
    $('aErr').classList.add('show');
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WIRE UP
  // ════════════════════════════════════════════════════════════════════════
  function init() {
    // profile (loads from localStorage, wires re-render on edit)
    if (window.ECGProfile) window.ECGProfile.init(reRenderProfile);

    // theme
    const tb = $('themeBtn');
    tb.addEventListener('click', () => {
      document.body.classList.toggle('light');
      tb.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
      if (SCOPE && RESULT) {
        SCOPE.draw();
        SCOPE.drawMini();
      }
    });

    // ecg input
    const zone = $('ecgZone'),
      input = $('ecgInput');
    // skip clicks on interactive children (the Choose-File button is now data-act="clickEl";
    // the zone must not also fire input.click() — CSP-strict handler migration).
    zone.addEventListener('click', (e) => {
      if (e.target.closest('button,a,label,select,input')) return;
      input.click();
    });
    input.addEventListener('change', (e) => {
      const fs = e.target.files;
      if (fs && fs.length) loadFiles(fs);
      e.target.value = '';
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const fs = e.dataTransfer.files;
      if (fs && fs.length) loadFiles(fs);
    });
    $('genBtn').addEventListener('click', genSynthetic);
    $('replaceBtn').addEventListener('click', () => {
      _replaceMode = true;
      input.click();
    });
    {
      const ab = $('addRecBtn');
      if (ab)
        ab.addEventListener('click', () => {
          _replaceMode = false;
          input.click();
        });
    }

    // device cross-check loaders
    $('rrInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadDeviceRR(f);
    });
    $('hrInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadDeviceHR(f);
    });
    $('accInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadDeviceACC(f);
    });

    // scope controls
    $('zoomIn').addEventListener('click', () => SCOPE && SCOPE.zoom(0.7));
    $('zoomOut').addEventListener('click', () => SCOPE && SCOPE.zoom(1.4));
    $('zoomFit').addEventListener('click', () => SCOPE && SCOPE.fitAll());
    $('spanSel').addEventListener('change', (e) => {
      if (SCOPE) SCOPE.setSpanSec(parseFloat(e.target.value));
    });

    // exports
    $('btnRR').addEventListener('click', exportRR);
    $('btnHRV').addEventListener('click', exportWelltoryCSV);
    $('btnJSON').addEventListener('click', exportJSON);
    if ($('btnCSV')) $('btnCSV').addEventListener('click', exportCSV);
    $('btnClear').addEventListener('click', resetAll);

    // depth-tier mode bar (Core / Advanced / Research) — shared suite mechanism.
    // First run in this node defaults to Research (full disclosure) so the whole
    // pipeline — including the ACC research cards — is visible out of the box.
    if (window.MetricRegistry) {
      let stored = null;
      try {
        stored = localStorage.getItem('dex_depth_tier');
      } catch (e) {}
      MetricRegistry.mountDepthSelector($('modeBar'));
      if (!stored) MetricRegistry.setTier('research');
    }

    // sidebar scroll-spy
    const navItems = [...document.querySelectorAll('.sb-nav .sb-item')];
    function setActive(id) {
      navItems.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    }
    navItems.forEach((a) => a.addEventListener('click', () => setActive(a.getAttribute('href').slice(1))));
    const spy = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-18% 0px -72% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    ['sec-input', 'heroTop', 'scopeSection', 'sec-profile', 'slKPI', 'qualitySection', 'chartsSection', 'morphSection', 'hypnoCard', 'valCard', 'hrCard', 'accCard', 'gangSection', 'slTbl'].forEach(
      (id) => {
        const e = $(id);
        if (e) spy.observe(e);
      }
    );
    if (navItems[0]) navItems[0].classList.add('active');
  }
  // Event-delegation actions (CSP strict script-src — dex-actions.js). print/clickEl are DexActions
  // builtins; the profile toggle is an ECGDex global (ecgdex-profile.js).
  if (window.DexActions)
    DexActions.registerAll({
      ecgProfileToggle: function () {
        ecgProfileToggle();
      }
    });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── PDF/print: render a clean, light, chrome-free page. Leverages the shipped
   light theme (a user-facing feature) + a print-only stylesheet. JS-injected so
   the .src.html skeleton — and thus buildHash + provenance fixtures — stays put.
   Mirrored verbatim across nodes (like the Clock Contract). ── */
(function () {
  if (window.__dexPrintWired) return;
  window.__dexPrintWired = true;
  var st = document.createElement('style');
  st.textContent =
    '@media print{' +
    '@page{margin:12mm}' +
    'html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff!important;color:#0a0e12!important}' +
    '.sidebar,#exportBar,#exportBar.show,#backToTop,#themeToggle,#themeToggleBtn,.theme-toggle,#themeBtn,.mob-bar,#mobBar,.mobile-nav,.mobile-sticky-header,.mode-bar{display:none!important}' +
    '.app-shell{grid-template-columns:1fr!important}' +
    '.main-wrap,.content,.main,main,.app-main,.main-content{margin-left:0!important;max-width:100%!important}' +
    '.kpi,.metric,.chart-wrap,.chart-card,canvas,svg,figure,tr,td,th{break-inside:avoid}' +
    'table{break-inside:auto}thead{display:table-header-group}tfoot{display:table-footer-group}' +
    '}';
  (document.head || document.documentElement).appendChild(st);
  var _added = false;
  function pre() {
    _added = !document.body.classList.contains('light');
    if (_added) document.body.classList.add('light');
  }
  function post() {
    if (_added) {
      document.body.classList.remove('light');
      _added = false;
    }
  }
  window.addEventListener('beforeprint', pre);
  window.addEventListener('afterprint', post);
  if (window.matchMedia) {
    try {
      window.matchMedia('print').addEventListener('change', function (e) {
        e.matches ? pre() : post();
      });
    } catch (_) {}
  }
})();
