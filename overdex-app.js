/*
 * overdex-app.js — Tepna OverDex: one-drop folder → route → run → fuse
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ════════════════════════════════════════════════════════════════════════
 * The capstone consumer (brief Phase 10). Point it at a FOLDER of mixed raw
 * exports from any device; it walks the tree, identifies each file, runs the
 * right node(s), and hands every result to the Integrator — one drop, one fused
 * result out. OverDex is a CONSUMER that sits ON TOP, exactly like the
 * Integrator — never a coupler.
 *
 * 🔒 THE INDEPENDENCE INVARIANT (non-negotiable): OverDex makes NO Dex depend on
 * any other Dex. It reuses the SAME public seams everything else does —
 *   · router      = SignalAdapters.route()        (shared, brief §2.4)
 *   · node compute= SignalOrchestrate.emitNodeExport()  (shared, co-loaded namespaced DSPs)
 *   · fusion      = IntegratorDSP (normalizeFile → dedupeRecs → runFusion)
 *   · the bus     = ganglior.node-export JSON  (the only cross-node contract)
 * No node imports OverDex; OverDex imports no node's internals. Delete OverDex
 * and every node + the Integrator work byte-identically.
 *
 * Two ways a file becomes a node-export to fuse:
 *   (a) RAW vendor file an adapter recognizes (Polar/Coospo RR …) → SignalFrame
 *       → run the node's real DSP → ganglior.node-export.
 *   (b) an ALREADY-EXPORTED ganglior.node-export JSON (any node) → pass straight
 *       through to the Integrator (this is how nodes WITHOUT an adapter yet —
 *       OxyDex/GlucoDex — still fuse: drop their *_ganglior.json).
 * Unknown files are SET ASIDE (never guessed); ambiguous routes are surfaced for
 * the user to confirm.
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WALK = window.OverDexWalk,
    REG = window.SignalAdapters,
    SF = window.SignalFrame,
    ORCH = window.SignalOrchestrate,
    D = window.IntegratorDSP;

  // ── file IO ────────────────────────────────────────────────────────────
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(String(r.result || ''));
      };
      r.onerror = function () {
        reject(r.error || new Error('read error'));
      };
      r.readAsText(file);
    });
  }
  /* EXPORT-PATH-UNREACHABLE-FOLLOWUPS-II §1 — OverDex read EVERY file as text, so the one adapter it advertises
     that is BINARY could never be fed. `adapters/resmed-edf.js` documents its own escape hatch —
     "ctx.buffers (raw) or ctx.edfSets (pre-decoded); the text argument is not used" — and OverDex
     supplied neither, so a dropped ResMed night routed correctly and then died as "unusable frame".
     Text is still read for every file (classify's head sniff + the adapter registry need it); the
     bytes are read ALONGSIDE it, only for the files that could plausibly want them. */
  function readBuffer(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result || null);
      };
      r.onerror = function () {
        resolve(null); // a byte read that fails must not fail the text classify
      };
      r.readAsArrayBuffer(file);
    });
  }
  function wantsBytes(file) {
    return /\.edf$/i.test((file && file.name) || '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  // Node-agnostic one-line summary of a computed node-export — delegates to the ONE
  // shared summarizer in signal-orchestrate.js (SIGNAL-ADAPTER-FOLLOWUPS-II §5 / -III §3),
  // so the per-node one-liner is no longer copy-branched here AND in the Data Unifier.
  function _computedDetail(c) {
    return window.SignalOrchestrate && window.SignalOrchestrate.nodeExportSummary ? window.SignalOrchestrate.nodeExportSummary(c) : 'computed';
  }
  function fmtClock(ms) {
    if (ms == null) return '—';
    var d = new Date(ms),
      p = function (n) {
        return (n < 10 ? '0' : '') + n;
      };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  // ── classify one walked file (cheap: route by name + head, then JSON sniff) ──
  // Returns { file, relPath, klass, route?, node?, json?, signalType?, note? }
  // klass ∈ 'raw' (adapter-routed) | 'export' (ready node-export) | 'ambiguous' | 'unknown' | 'error'
  /* EXPORT-PATH-UNREACHABLE §5 — which node OWNS each signal type. This was an inline ternary
     (`spo2 ? OxyDex : hrv ? HRVDex : PulseDex`), so ecg / ppg / cgm / cpap ALL displayed
     "→ PulseDex" in the routing manifest. Display-only — runAndFuse() dispatches on signalType, so
     the 208 MB H10 ECG did run through ECGDex and emit 62 correct events while the manifest said
     PulseDex — but a manifest whose whole job is "tell the user what will run" must not lie. */
  var NODE_FOR_SIGNAL = { spo2: 'OxyDex', hrv: 'HRVDex', rr: 'PulseDex', ecg: 'ECGDex', ppg: 'PpgDex', cgm: 'GlucoDex', cpap: 'CPAPDex' };

  function classify(file, text) {
    var relPath = WALK.relOf(file);
    var head = (text || '').slice(0, 2048);
    /* A ganglior.node-export DECLARES what it is in `schema.name`; a vendor adapter only ever GUESSES
       from a filename and a 2 KB head. The self-describing artifact must therefore be asked FIRST —
       it used to be asked only after every adapter had declined, and `adapters/oxydex-spo2.js` claims
       /oxydex/i on the NAME at 0.95. So `OxyDex_<night>_summary.json` matched the raw-SpO₂ adapter,
       died in the CSV row parser ("no usable SpO₂ rows parsed"), and was never retried as an export:
       OxyDex vanished from every OverDex fusion while the Integrator fused the same file with 57
       events. `adapters/libre-cgm.js` carries the identical /glucodex/i rule.
       Gated on a cheap head sniff so a 208 MB ECG text is never handed to JSON.parse. */
    var sawJSON = false;
    if (/^\s*\{/.test(head)) {
      var early = null;
      try {
        early = JSON.parse(text);
      } catch (e) {
        early = null;
      }
      if (early && typeof early === 'object') {
        sawJSON = true;
        var eres = D.normalizeFile(early, file.name);
        if (eres.recs && eres.recs.length) {
          return { file: file, relPath: relPath, klass: 'export', json: early, node: eres.recs[0].node, nRecs: eres.recs.length, warnings: eres.warnings || [] };
        }
      }
    }
    var r = REG.route({ name: file.name }, head);
    if (r.best) {
      if (r.ambiguous) {
        return {
          file: file,
          relPath: relPath,
          klass: 'ambiguous',
          route: r,
          note: 'best ' + r.best.vendor + ' (' + r.best.confidence.toFixed(2) + ') vs ' + r.runnerUp.vendor + ' (' + r.runnerUp.confidence.toFixed(2) + ')'
        };
      }
      return {
        file: file,
        relPath: relPath,
        klass: 'raw',
        route: r,
        signalType: r.best.signalType,
        node: NODE_FOR_SIGNAL[r.best.signalType] || 'PulseDex',
        adapter: r.best.adapter,
        vendor: r.best.vendor
      };
    }
    // Neither a node-export nor adapter-routable. Keep the two reasons distinct — "JSON we could not
    // fuse" and "nothing recognised it" are different problems for whoever reads the manifest.
    if (sawJSON) return { file: file, relPath: relPath, klass: 'unknown', note: 'JSON, but not a recognized node-export (no fusible records)' };
    return { file: file, relPath: relPath, klass: 'unknown', note: 'no adapter matched and not a node-export JSON — set aside, never guessed' };
  }

  // ════════════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════════════
  var ITEMS = []; // classified files
  var FUSION = null,
    FUSED_EXPORT = null;

  // ── walk + classify a dropped/picked pile ───────────────────────────────
  /* ── SEALED NIGHTS (CAPTURE-NIGHT-SEAL phase C, brief §5) ──────────────────────────────────────
     A `.tepna` in the drop is one self-protecting night. It is opened HERE, before classification:
     read the clear header → recall (or ask for) the card key and pinned fingerprint for its
     (boxId, keyId) → NightSeal.unseal → every `data/` stream becomes a File tagged
     `<boxId>-<night>/<name>` and goes down the SAME path a folder's files take. The outcome is a
     PROVENANCE BADGE on each stream, never a gate: a tampered stream reds by name and the rest of the
     night still opens; a refused seal (wrong card, unknown key, forged header, …) lists the file under
     `error` with the refusal kind — nothing refuses silently and nothing fabricates "verified". Files
     that did not come out of a seal carry `unsealed folder — provenance unknown`. One tepna.verdict/1
     per seal is kept on `SEALS` for the verifier / a machine reader. */
  var SEALS = [];
  var CARD_PROMPT = null; // set by the page: function(header) → Promise<{cardKeyHex, fingerprint}|null>
  function isSeal(f) {
    return /\.tepna$/i.test(WALK.relOf(f) || f.name || '');
  }
  function openSeal(file) {
    var NS = window.NightSeal;
    var rel = WALK.relOf(file);
    var outcome = { file: rel, status: 'NOT_RUN', streams: { opened: 0, verified: 0, tampered: [] } };
    if (!NS) {
      outcome.detail = 'night-seal.js not loaded';
      return Promise.resolve({ files: [], outcome: outcome });
    }
    return readBuffer(file)
      .then(function (buf) {
        var blob = new Uint8Array(buf);
        var header = NS.readHeader(blob); // throws SealRefused on framing — caught below
        outcome.header = header;
        return NS.cards
          .get(header.boxId, header.keyId)
          .catch(function () {
            return null;
          })
          .then(function (card) {
            if (card) return card;
            if (typeof CARD_PROMPT !== 'function') return null;
            return CARD_PROMPT(header).then(function (entered) {
              if (!entered) return null;
              var rec = { cardKeyHex: entered.cardKeyHex, fingerprint: entered.fingerprint, knownRevision: null };
              return NS.cards.put(header.boxId, header.keyId, rec).catch(function () {
                return rec; // no IndexedDB (private window) — use it for this session only
              });
            });
          })
          .then(function (card) {
            if (!card) {
              outcome.status = 'NOT_RUN';
              outcome.detail = 'no card key for box ' + header.boxId + ' (keyId ' + header.keyId + ') — not opened';
              return { files: [], outcome: outcome };
            }
            return NS.unseal(blob, { cardKey: NS.fromHex(card.cardKeyHex), pinnedFingerprint: card.fingerprint, knownRevision: card.knownRevision == null ? null : card.knownRevision }).then(
              function (r) {
                outcome.consent = r.consent;
                var names = Object.keys(r.files);
                outcome.streams.opened = names.length;
                // verify per stream — only what is opened; here every stream in the night is opened
                return Promise.all(
                  names.map(function (name) {
                    return r
                      .verify(name)
                      .then(function () {
                        outcome.streams.verified++;
                        return { name: name, ok: true };
                      })
                      .catch(function (e) {
                        outcome.streams.tampered.push(name);
                        return { name: name, ok: false, kind: e && e.kind, detail: e && e.detail };
                      });
                  })
                ).then(function (checks) {
                  outcome.status = 'PASS';
                  if (outcome.streams.tampered.length) {
                    outcome.status = 'FAIL';
                    outcome.kind = 'manifest:data/' + outcome.streams.tampered[0];
                    outcome.detail = outcome.streams.tampered.length + ' stream(s) do not match manifest-sha256.txt';
                  }
                  // a newer revision seen ⇒ remember it, so a stale re-issue is refused next time
                  if (card.knownRevision == null || r.header.revision > card.knownRevision) {
                    card.knownRevision = r.header.revision;
                    NS.cards.put(header.boxId, header.keyId, card).catch(function () {});
                  }
                  var prefix = header.boxId + '-' + header.night + '/';
                  var files = checks.map(function (c) {
                    var f = new File([r.files[c.name]], c.name);
                    try {
                      Object.defineProperty(f, 'relPath', { value: prefix + c.name, configurable: true });
                    } catch (e) {
                      f._relPath = prefix + c.name;
                    }
                    f.__seal = {
                      boxId: header.boxId,
                      night: header.night,
                      closedAt: header.closedAt,
                      revision: header.revision,
                      consent: r.consent,
                      verified: c.ok,
                      tampered: !c.ok,
                      kind: c.kind || null
                    };
                    return f;
                  });
                  return { files: files, outcome: outcome };
                });
              }
            );
          });
      })
      .catch(function (e) {
        outcome.status = e && e.refused ? 'FAIL' : 'NOT_RUN';
        outcome.kind = e && e.refused ? e.kind : undefined;
        outcome.detail = e && e.refused ? e.detail : String((e && e.message) || e);
        return { files: [], outcome: outcome };
      })
      .then(function (res) {
        res.outcome.verdict = NS ? NS.verdict(res.outcome) : null;
        res.outcome.badge = NS ? NS.badge(res.outcome) : null;
        SEALS.push(res.outcome);
        return res;
      });
  }
  function expandSeals(files) {
    var seals = files.filter(isSeal),
      plain = files.filter(function (f) {
        return !isSeal(f);
      });
    if (!seals.length) return Promise.resolve({ files: plain, refused: [] });
    return Promise.all(seals.map(openSeal)).then(function (results) {
      var out = plain.slice(),
        refused = [];
      results.forEach(function (r, i) {
        out = out.concat(r.files);
        if (!r.files.length) refused.push({ file: seals[i], outcome: r.outcome });
      });
      return { files: out, refused: refused };
    });
  }

  function ingest(files) {
    if (!files || !files.length) return;
    setStatus('reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…', 'run');
    FUSION = null;
    FUSED_EXPORT = null;
    SEALS = [];
    expandSeals(files).then(function (ex) {
      return ingestFiles(ex.files, ex.refused);
    });
  }
  function ingestFiles(files, refused) {
    refused = refused || [];
    if (!files.length && !refused.length) return;
    Promise.all(
      files.map(function (f) {
        return readText(f).then(
          function (t) {
            f.__text = t;
            if (!wantsBytes(f)) return classify(f, t);
            return readBuffer(f).then(function (buf) {
              f.__buffer = buf;
              return classify(f, t);
            });
          },
          function (e) {
            return { file: f, relPath: WALK.relOf(f), klass: 'error', note: 'read error: ' + e.message };
          }
        );
      })
    ).then(function (items) {
      // a refused seal is an item too: listed under `error` with its refusal kind, never dropped silently
      refused.forEach(function (rf) {
        var b = rf.outcome.badge || {};
        items.push({
          file: rf.file,
          relPath: WALK.relOf(rf.file),
          klass: 'error',
          note: b.text || (rf.outcome.kind ? rf.outcome.kind + ': ' + rf.outcome.detail : rf.outcome.detail || 'seal not opened'),
          seal: rf.outcome
        });
      });
      ITEMS = items;
      renderManifest();
      var counts = tally();
      setStatus(counts.raw + ' raw · ' + counts.export + ' node-export · ' + counts.ambiguous + ' ambiguous · ' + counts.unknown + ' set aside', 'idle');
    });
  }

  function tally() {
    var c = { raw: 0, export: 0, ambiguous: 0, unknown: 0, error: 0 };
    ITEMS.forEach(function (it) {
      c[it.klass] = (c[it.klass] || 0) + 1;
    });
    return c;
  }

  // ── RUN & FUSE ──────────────────────────────────────────────────────────
  async function runAndFuse() {
    if (!ITEMS.length) return;
    // DEEP-AUDIT-II §10.1 — this used to be three hand-written needPulse/needOxy/needHrv blocks, so
    // ECG / PPG / CGM / CPAP files reached emitNodeExport() with NO host booted. Their shims existed
    // and were never called; the resulting throw was caught into a per-file 'run error' that blamed a
    // co-load which is demonstrably present in the src.html, and the run continued while the file
    // vanished from exports[]. The needed hosts are now derived from what was actually dropped, so a
    // signal the orchestrator advertises via canEmit() is a signal it has really booted.
    var needTypes = [];
    ITEMS.forEach(function (it) {
      var st = it.klass === 'raw' ? it.signalType : it.klass === 'ambiguous' && it.resolvedTo ? it.resolvedTo.signalType : null;
      if (st && ORCH.canEmit(st) && needTypes.indexOf(st) < 0) needTypes.push(st);
    });
    var hostFail = {},
      wins = {};
    if (needTypes.length) {
      setStatus('loading compute for ' + needTypes.join(', ') + '…', 'run');
      var booted = await ORCH.bootHosts(needTypes);
      booted.forEach(function (b) {
        if (b.ok) wins[b.type] = b.win;
        else hostFail[b.type] = b.error;
      });
      // A failed host is reported against the files that needed it (below), NOT as a whole-run abort:
      // one unavailable node must not discard the other signals in a mixed drop.
      var failed = Object.keys(hostFail);
      if (failed.length === needTypes.length) {
        setStatus(
          'compute host failed: ' +
            failed
              .map(function (t) {
                return t + ' (' + hostFail[t] + ')';
              })
              .join('; '),
          'bad'
        );
        return;
      }
      if (failed.length) setStatus(failed.length + ' host(s) unavailable — continuing with the rest', 'run');
    }
    setStatus('routing → running nodes → fusing…', 'run');

    var exports = []; // { json, label, from }
    var _cpapRan = false; // one night = one EDF set, run once (see the cpap branch below)
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      try {
        if (it.klass === 'export') {
          exports.push({ json: it.json, label: it.relPath, from: 'node-export ' + it.node });
        } else if (it.klass === 'raw' || (it.klass === 'ambiguous' && it.resolvedTo)) {
          var adapter = it.klass === 'raw' ? it.adapter : it.resolvedTo.adapter;
          var sigType = it.klass === 'raw' ? it.signalType : it.resolvedTo.signalType;
          var ctx = { files: [it.relPath] };
          // parse helpers the adapters need, taken from the host actually booted for this signal
          if (sigType === 'rr' && wins.rr) ctx.parseRRInput = wins.rr.parseRRInput;
          if (sigType === 'spo2' && wins.spo2) ctx.parseCSV = wins.spo2.parseCSV;
          if (sigType === 'hrv' && wins.hrv && wins.hrv.HRVDex) ctx.parseRows = wins.hrv.HRVDex.parseRows;
          /* CPAP is BINARY and MULTI-FILE: one night is a set of EDFs (BRP/PLD/SA2 + EVE/CSL) that the
             adapter groups by its own §F4 session rule. So hand it EVERY dropped EDF's bytes at once and
             run it ONCE — running per-file would re-decode the same night N times and emit N duplicate
             exports for the Integrator to dedupe. The remaining EDF items are marked as folded rather
             than left blank: a file that was consumed must say so, never vanish from the manifest. */
          if (sigType === 'cpap') {
            if (_cpapRan) {
              it.runNote = 'folded into the CPAP session run above (one night = one EDF set)';
              continue;
            }
            var _bufs = [];
            for (var bi = 0; bi < ITEMS.length; bi++) {
              var bit = ITEMS[bi];
              var bsig = bit && (bit.klass === 'raw' ? bit.signalType : bit.resolvedTo && bit.resolvedTo.signalType);
              if (bsig === 'cpap' && bit.file && bit.file.__buffer) _bufs.push({ name: bit.file.name, buffer: bit.file.__buffer });
            }
            if (!_bufs.length) {
              it.runNote = 'EDF bytes unavailable (file could not be read as an ArrayBuffer)';
              continue;
            }
            ctx.buffers = _bufs;
            ctx.files = _bufs.map(function (b) {
              return b.name;
            });
            _cpapRan = true;
          }
          // companion-bundle ingest (ECG/PPG multi-file): pair matched device sidecars by filename
          // stamp across the walked drop so the adapter attaches them to the frame (HANDOFF §2(b)).
          /* THE LANE LIST IS THE BUG SURFACE, so it is read from the ONE table rather than repeated: a
             type present in `_COMPANION_KINDS` and absent from this condition pairs nothing, silently, in
             this host only — and the two hosts would then disagree about the same drop. `spo2` joining
             (the O2Ring waveform's 1 Hz calibration partner) is what made that concrete. */
          if (ORCH && typeof ORCH.pairCompanions === 'function' && typeof ORCH.companionKinds === 'function' && ORCH.companionKinds(sigType).length) {
            var _ents = [];
            for (var ci = 0; ci < ITEMS.length; ci++) {
              var cit = ITEMS[ci];
              if (cit && cit.file) _ents.push({ name: cit.file.name, text: cit.file.__text });
            }
            var comps = ORCH.pairCompanions(sigType, it.file.name, _ents);
            if (comps) ctx.companions = comps;
          }
          var frame = REG.runAdapter(adapter, it.file.__text, ctx);
          var valid = SF.validateFrame(frame);
          it.frame = frame;
          it.valid = valid;
          if (frame && frame.usable && valid.ok && ORCH.canEmit(sigType)) {
            var exp = ORCH.emitNodeExport(frame); // signalType-dispatched (rr/spo2/hrv) — §-II 4
            if (exp && exp.schema && exp.schema.ingest) exp.schema.ingest.via = 'OverDex';
            it.computed = exp;
            exports.push({ json: exp, label: it.relPath, from: 'computed ' + frame.provenance.adapter });
          } else {
            it.runNote =
              frame && !frame.usable
                ? 'unusable frame: ' + (frame.reason || '?')
                : valid && !valid.ok
                  ? valid.errors.join('; ')
                  : hostFail[sigType]
                    ? sigType + ' compute host unavailable: ' + hostFail[sigType]
                    : 'no compute path for ' + sigType;
          }
        }
      } catch (e) {
        it.runNote = 'run error: ' + e.message;
      }
    }

    if (!exports.length) {
      setStatus('nothing fusible — drop raw RR / O2Ring files or node-export JSON', 'bad');
      renderManifest();
      renderFusion(null, []);
      return;
    }

    // ── feed the Integrator (the exact public seam integrator-app.js uses) ──
    var RECS = [],
      WARN = [];
    exports.forEach(function (e) {
      var res = D.normalizeFile(e.json, e.label);
      (res.warnings || []).forEach(function (w) {
        WARN.push(w);
      });
      if (res.recs && res.recs.length) {
        var dd = D.dedupeRecs(RECS, res.recs);
        (dd.warns || []).forEach(function (w) {
          WARN.push(w);
        });
        dd.kept.forEach(function (r) {
          RECS.push(r);
        });
      }
    });
    FUSION = D.runFusion(RECS, { toleranceSec: 120 });
    FUSED_EXPORT = D.buildFusionExport(RECS, FUSION);

    renderManifest();
    renderFusion(FUSION, exports, WARN, RECS);
    var ap = FUSION.apnea;
    setStatus('fused ' + RECS.length + ' recording' + (RECS.length === 1 ? '' : 's') + ' · ' + FUSION.findings.length + ' finding' + (FUSION.findings.length === 1 ? '' : 's'), 'done');
  }

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  var manifestEl, fusionEl, statusEl;
  function setStatus(t, cls) {
    if (statusEl) {
      statusEl.textContent = t;
      statusEl.className = 'pill ' + (cls || 'idle');
    }
  }

  var KLASS_META = {
    raw: { dot: 'teal', tag: 'raw → run', desc: 'adapter recognized — node DSP will run live' },
    export: { dot: 'green', tag: 'node-export', desc: 'ready ganglior.node-export — passes straight to fusion' },
    ambiguous: { dot: 'amber', tag: 'ambiguous', desc: 'two adapters tie — confirm which vendor' },
    unknown: { dot: 'red', tag: 'set aside', desc: 'unrecognized — never guessed' },
    error: { dot: 'red', tag: 'read error', desc: '' }
  };

  function renderManifest() {
    if (!ITEMS.length) {
      manifestEl.innerHTML = '';
      return;
    }
    var order = ['raw', 'export', 'ambiguous', 'unknown', 'error'];
    var groups = {};
    ITEMS.forEach(function (it, i) {
      it._idx = i;
      (groups[it.klass] = groups[it.klass] || []).push(it);
    });
    var html = '';
    order.forEach(function (k) {
      var g = groups[k];
      if (!g || !g.length) return;
      var meta = KLASS_META[k];
      html += '<div class="grp">';
      html +=
        '<div class="grphead"><span class="dot ' +
        meta.dot +
        '"></span>' +
        '<span class="grptag">' +
        meta.tag +
        '</span><span class="grpn">' +
        g.length +
        '</span>' +
        '<span class="grpdesc">' +
        esc(meta.desc) +
        '</span></div>';
      g.forEach(function (it) {
        var right = '';
        if (k === 'raw')
          right =
            '<span class="vendor">' +
            esc(it.vendor) +
            '</span> <span class="sig">' +
            esc(it.signalType) +
            '</span> → <b>' +
            esc(it.node) +
            '</b>' +
            (it.runNote ? ' <span class="warn">· ' + esc(it.runNote) + '</span>' : it.computed ? ' <span class="ok">· ' + _computedDetail(it.computed) + '</span>' : '');
        else if (k === 'export') right = '<b>' + esc(it.node) + '</b> <span class="muted">' + (it.nRecs > 1 ? it.nRecs + ' recs' : '1 rec') + '</span>';
        else if (k === 'ambiguous') right = ambiguousControl(it);
        else right = '<span class="muted">' + esc(it.note || '') + '</span>';
        html += '<div class="row">' + sealBadge(it) + '<span class="path">' + esc(it.relPath) + '</span><span class="rt">' + right + '</span></div>';
      });
      html += '</div>';
    });
    manifestEl.innerHTML = html;
  }

  /* The provenance badge — inline, immediately BEFORE the label, the evidence-badge placement
     (CLAUDE.md §🎫 placement 2). Three texts, none fabricated: a verified sealed stream, a tampered
     stream by name, and the honest default for everything that did not come out of a seal. */
  function sealBadge(it) {
    var NS = window.NightSeal;
    var f = it.file || {};
    var s = f.__seal;
    var b;
    if (it.seal) b = it.seal.badge || (NS ? NS.badge(it.seal) : null);
    else if (s)
      b = s.tampered
        ? { cls: 'seal-bad', text: 'TAMPERED: ' + f.name }
        : NS
          ? NS.badge({ status: 'PASS', header: { boxId: s.boxId, closedAt: s.closedAt }, streams: { opened: 1, verified: 1, tampered: [] } })
          : null;
    else b = { cls: 'seal-unknown', text: 'unsealed folder — provenance unknown' };
    if (!b) return '';
    return '<span class="seal ' + esc(b.cls) + '" title="' + esc(b.text) + '">' + esc(b.text) + '</span> ';
  }

  function ambiguousControl(it) {
    var cands = it.route.candidates.slice(0, 4);
    var opts =
      '<option value="">— confirm vendor —</option>' +
      cands
        .map(function (c, ci) {
          return (
            '<option value="' +
            ci +
            '"' +
            (it.resolvedTo && it.resolvedTo.adapter === c.adapter ? ' selected' : '') +
            '>' +
            esc(c.vendor) +
            ' / ' +
            esc(c.signalType) +
            ' (' +
            c.confidence.toFixed(2) +
            ')</option>'
          );
        })
        .join('') +
      '<option value="skip"' +
      (it.skipped ? ' selected' : '') +
      '>skip — set aside</option>';
    return '<select class="ambsel" data-idx="' + it._idx + '">' + opts + '</select> <span class="muted">' + esc(it.note) + '</span>';
  }

  function renderFusion(fusion, exports, warns, recs) {
    if (!fusion) {
      fusionEl.innerHTML = '';
      fusionEl.style.display = 'none';
      return;
    }
    fusionEl.style.display = 'block';
    var ap = fusion.apnea,
      hrv = fusion.hrv,
      w = fusion.window;
    var nodes = fusion.nodes || [];

    // DEEP-AUDIT §21 — OverDex rendered a fused CLINICAL KPI grid while loading no badge engine at
    // all. These are cross-node fusion outputs that belong to no single node's registry, so they are
    // graded the way integrator-render.js grades its own: the fusion layer's epistemic tier on the
    // shared 5-level ladder, rendered through the SAME MetricRegistry.badge so the disc is
    // byte-identical to every node. Counted quantities are `measured`; the corroborated apnea index
    // is `emerging` — the exact tier the Integrator gives the same number.
    var STAT_EV = {
      'recordings fused': { ev: 'measured', cite: 'Count of recordings that routed to a node and produced an export — a counted quantity, not a model.' },
      'overlap (union)': { ev: 'measured', cite: "Union of the recordings' time windows on the shared clock — counted, not modelled." },
      'cross-signal findings': { ev: 'measured', cite: 'Count of coincidences the Integrator confirmed inside the overlap window.' },
      'confirmed apnea idx': {
        ev: 'emerging',
        cite: 'Cross-signal corroboration — O₂ desaturation ⟷ autonomic surge in a directional window (AASM ODI framing; Azarbarzin 2019). A corroboration signal, not a scored AHI.'
      }
    };
    function statBadge(label) {
      var R = window.MetricRegistry,
        e = STAT_EV[label];
      return R && R.badge && e ? R.badge(e.ev, e.cite) : '';
    }
    function stat(label, val, cls) {
      return '<div class="stat">' + '<div class="sv ' + (cls || '') + '">' + val + '</div><div class="sl">' + statBadge(label) + esc(label) + '</div></div>';
    }

    var apIdx = ap && ap.confirmedAHI != null ? ap.confirmedAHI : null;
    var apReportable = ap && ap.confirmedAHIReportable;
    var html =
      '<div class="fhead"><span class="eyebrow">fused result · Ganglior</span>' +
      '<h2>One folder in, one fused picture out</h2>' +
      '<div class="fsub">Every routed file ran through its node and converged on the Integrator via the <code>ganglior.node-export</code> contract — the same seam the Integrator always uses. No node knew OverDex was here.</div></div>';

    html += '<div class="statgrid">';
    html += stat('recordings fused', recs ? recs.length : nodes.length);
    html += stat('overlap (union)', w.overlapUnionMin != null ? w.overlapUnionMin + ' min' : '—');
    html += stat('cross-signal findings', fusion.findings.length, fusion.findings.length ? 'teal' : 'muted');
    html += stat('confirmed apnea idx', apIdx == null ? '—' : apIdx.toFixed(1), apReportable ? 'amber' : 'muted');
    html += '</div>';

    // nodes fused
    html += '<div class="block"><div class="bt">Nodes on the bus</div><div class="chips">';
    nodes.forEach(function (n) {
      var col = D.nodeColor(n.node);
      html +=
        '<span class="chip" style="--c:' +
        col +
        '"><span class="cdot"></span>' +
        esc(n.node) +
        '<span class="cmeta">' +
        (n.date || (n.dateUnknown ? 'date unknown' : '')) +
        ' · ' +
        n.nEvents +
        ' ev</span></span>';
    });
    html += '</div></div>';

    // findings
    if (fusion.findings.length) {
      html += '<div class="block"><div class="bt">Findings</div><div class="findings">';
      fusion.findings.slice(0, 12).forEach(function (f) {
        var conf = f.conf == null ? '—' : f.conf.toFixed(2);
        html +=
          '<div class="finding"><div class="fr1"><span class="ftype">' +
          esc(f.type.replace(/_/g, ' ')) +
          '</span>' +
          '<span class="ftime">' +
          (f.tMs != null ? fmtClock(f.tMs) : '') +
          '</span>' +
          '<span class="fconf">conf ' +
          conf +
          (f.belowChance ? ' <span class="warn">· below chance</span>' : '') +
          '</span></div>' +
          (f.note ? '<div class="fnote">' + esc(f.note) + '</div>' : '') +
          '</div>';
      });
      html += '</div></div>';
    } else {
      html +=
        '<div class="block"><div class="bt">Findings</div><div class="muted small">No cross-signal coincidences in the overlap window — the nodes did not co-witness a fusible event (honest null, not an error). ' +
        (w.nodesExcluded && w.nodesExcluded.length ? 'Excluded (overlap nothing): ' + esc(w.nodesExcluded.join(', ')) + '.' : '') +
        '</div></div>';
    }

    // HRV consensus
    if (hrv && hrv.blocks && hrv.blocks.length) {
      html += '<div class="block"><div class="bt">HRV consensus</div>';
      hrv.blocks.forEach(function (b) {
        html += '<div class="small ' + (b.qc === 'divergent' ? 'warn' : 'ok') + '">' + esc(b.window) + ' · ' + esc(b.nodes.join(' / ')) + ' — ' + esc(b.note) + '</div>';
      });
      html += '</div>';
    }

    // kernel audit + warnings
    if (fusion.kernelAudit && !fusion.kernelAudit.ok) {
      html +=
        '<div class="block warnbox"><b>Kernel drift:</b> ' +
        esc(
          fusion.kernelAudit.mismatches
            .map(function (m) {
              return m.node + ' (' + m.status + ')';
            })
            .join(', ')
        ) +
        ' — built against a different physiology rulebook.</div>';
    }
    if (warns && warns.length) {
      html +=
        '<div class="block"><div class="bt">Ingest notes</div>' +
        warns
          .slice(0, 8)
          .map(function (x) {
            return '<div class="small muted">· ' + esc(x) + '</div>';
          })
          .join('') +
        '</div>';
    }

    html +=
      '<div class="ffoot"><button id="dlFused">download fused ganglior.fusion-export →</button>' +
      '<span class="muted small">100% local · the per-node apps are untouched and still open standalone</span></div>';

    fusionEl.innerHTML = html;
    var dl = document.getElementById('dlFused');
    if (dl)
      dl.addEventListener('click', function () {
        // Name through the shared exportName() — recording-anchored to the fusion window start (getUTC*),
        // span-aware. The old now() fallback stamped an UNDATED export with the date of the click: a
        // Clock-Contract fabrication that integrator-app.js already dropped for exactly this reason.
        // No window start → 'undated' (honest). DEEP-AUDIT §17.
        var ws = FUSION && FUSION.window.startMs != null ? FUSION.window.startMs : null;
        var we = FUSION && FUSION.window.endMs != null ? FUSION.window.endMs : null;
        var span = ws != null && we != null ? Math.round((we - ws) / 864e5) : null;
        download(exportName({ node: 'OverDex', t0Ms: ws, kind: 'summary', ext: 'json', spanDays: span }), FUSED_EXPORT);
      });
  }

  function download(name, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ════════════════════════════════════════════════════════════════════════
  // WIRE
  // ════════════════════════════════════════════════════════════════════════
  function wire() {
    manifestEl = document.getElementById('manifest');
    fusionEl = document.getElementById('fusion');
    statusEl = document.getElementById('status');
    var dropEl = document.getElementById('drop');
    var dirInput = document.getElementById('dir');
    var fileInput = document.getElementById('files');
    var runBtn = document.getElementById('runBtn');

    dropEl.addEventListener('click', function () {
      dirInput.click();
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.remove('over');
      });
    });
    dropEl.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      WALK.fromDataTransfer(e.dataTransfer).then(ingest);
    });
    dirInput.addEventListener('change', function () {
      ingest(WALK.fromInput(dirInput.files));
      dirInput.value = '';
    });
    if (fileInput) {
      // a sealed night is one file — the loose-file picker accepts it beside anything else
      var acc = fileInput.getAttribute('accept');
      if (!acc || acc.indexOf('.tepna') < 0) fileInput.setAttribute('accept', (acc ? acc + ',' : '') + '.tepna,*/*');
      fileInput.addEventListener('change', function () {
        ingest(WALK.fromInput(fileInput.files));
        fileInput.value = '';
      });
    }
    // The card prompt: an inline form (never window.prompt), shown on the FIRST sight of a
    // (boxId, keyId) and remembered in IndexedDB. The verifier bypasses it through OverDex.seals.setCard.
    var cardEl = document.getElementById('cardPrompt');
    CARD_PROMPT = function (header) {
      if (!cardEl) return Promise.resolve(null);
      return new Promise(function (resolve) {
        cardEl.style.display = 'block';
        cardEl.querySelector('.cp-box').textContent = header.boxId + ' · key ' + header.keyId + ' · night ' + header.night;
        var code = cardEl.querySelector('.cp-code'),
          fp = cardEl.querySelector('.cp-fp'),
          err = cardEl.querySelector('.cp-err');
        var done = function (val) {
          cardEl.style.display = 'none';
          ok.onclick = cancel.onclick = null;
          resolve(val);
        };
        var ok = cardEl.querySelector('.cp-ok'),
          cancel = cardEl.querySelector('.cp-cancel');
        ok.onclick = function () {
          try {
            var key = window.NightSeal.decodeCardCode(code.value);
            var f = String(fp.value || '').trim();
            if (!/^sha256\/[0-9a-f]{64}$/.test(f)) throw new Error('the fingerprint is the sha256/… line printed on the card');
            done({ cardKeyHex: window.NightSeal.hex(key), fingerprint: f });
          } catch (e) {
            err.textContent = String((e && e.message) || e);
          }
        };
        cancel.onclick = function () {
          done(null);
        };
      });
    };
    runBtn.addEventListener('click', runAndFuse);

    // ambiguous-route confirmation
    manifestEl.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('select.ambsel');
      if (!sel) return;
      var it = ITEMS[+sel.getAttribute('data-idx')];
      var v = sel.value;
      if (v === '') {
        it.resolvedTo = null;
        it.skipped = false;
      } else if (v === 'skip') {
        it.resolvedTo = null;
        it.skipped = true;
      } else {
        var c = it.route.candidates[+v];
        it.resolvedTo = { adapter: c.adapter, signalType: c.signalType, vendor: c.vendor };
        it.skipped = false;
      }
    });

    // adapter inventory
    var inv = document.getElementById('adapters');
    if (inv && REG) {
      inv.innerHTML = REG.list()
        .map(function (a) {
          return '<span class="adp"><b>' + esc(a.id) + '</b> <span class="muted">' + esc(a.signalType) + '</span> ' + esc(a.vendor) + '</span>';
        })
        .join('');
    }

    // expose for the verifier / programmatic checks
    window.OverDex = {
      ingest: ingest,
      runAndFuse: runAndFuse,
      classify: classify,
      items: function () {
        return ITEMS;
      },
      fusion: function () {
        return FUSION;
      },
      fusedExport: function () {
        return FUSED_EXPORT;
      },
      // CAPTURE-NIGHT-SEAL phase C — what the browser-gates leg reads and drives
      seals: {
        list: function () {
          return SEALS;
        },
        setCard: function (boxId, keyId, card) {
          return window.NightSeal.cards.put(boxId, keyId, card);
        },
        ingestFiles: function (files) {
          return ingest(files);
        }
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
