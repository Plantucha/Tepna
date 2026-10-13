/*
 * export-schema.js — Tepna shared export ALLOW-LIST (CORE, DOM-free)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THAT SAYS WHAT SURVIVES A SCRUB (EXPORT-SCRUB-ALLOWLIST §3,
 * owner ruling 2026-10-12: the allow-list lives in one shared schema file, and
 * every node export plus the Integrator reads it).
 *
 * WHY A FILE OF ITS OWN, and not another array inside `dex-export.js`:
 *   · `dex-export.js` is the MECHANISM. This is the DECLARATION. A node author
 *     adding a field needs to read the declaration, and asking them to read a
 *     scrub implementation to find it is how the deny-list stayed fail-open.
 *   · Ten bundles carry it — the eight apps that export, the Integrator and
 *     OverDex — so one edit changes every node's scrub at once, the property a
 *     per-node copy could never have.
 *
 * FAIL-CLOSED, which is the whole point. The scrub this declares BUILDS its
 * output from these key sets, so a key nobody declared is ABSENT from a
 * scrubbed export. The deny-list it replaces did the opposite: every fix in
 * `dex-export.js`'s history ADDED a key, and the next identifier a node author
 * invented leaked until somebody noticed (SELF-INGEST-FOLLOWUPS-II §F1 widened
 * the element loop after a leak; #3344 found per-element `inputs[].sha256`
 * surviving; the 07-xx pass missed the per-element `provenance` copy and a real
 * export named `Jane_Smith_O2Ring S 2100_20260612230016.csv` went through a
 * scrub marked ON).
 *
 * AND A DROP IS NEVER SILENT (CLAUDE.md §∅ — an output over absent input
 * reports the absence). The scrub names every key it removed in
 * `schema.scrubDropped`, as dotted block paths, so a node author who adds a
 * field sees it named in the scrubbed export instead of discovering months
 * later that fusion never received it. Fail-closed and visible, never
 * fail-closed and quiet.
 *
 * HOW THE KEY SETS WERE DERIVED — measured, not imagined. Every
 * `ganglior.node-export` envelope in this checkout's committed corpus was read
 * and its keys counted per block (2026-10-12: 100 export files, 50 envelopes,
 * 37 distinct envelope keys, 51 recording keys, 51 element keys). The sets
 * below are those measured keys MINUS the identifier routes the contract names:
 * `recording.{device,serial,model,source}`, the element filename keys and every
 * `provenance.inputs[]` field but the byte count. Nothing was added on a hunch:
 * a key that no export carries is not declared, because declaring it would be a
 * guess dressed as a contract.
 *
 * ⚠ ONE KEY CARRIES A DECLARED VALUE GUARD, and §3 asked for none. `source` is
 * overloaded across the fleet: ECGDex and GlucoDex write a semantic tag there
 * ('file', 'welltory') and PpgDex writes the raw upload filename. §3 proposed
 * retiring the filename-shape regex and letting the declaration decide, but a
 * committed contract assertion decides first — `tests/dex-tests.js` pins
 * `recordings[].recording.source` surviving as 'file', with the reason in its
 * own name: the scrub removes identity, not meaning. 44 of 48 measured
 * envelopes carry `recording.source`, so an undeclared `source` would strip a
 * tag off nearly every export. So the key stays declared and the shape test
 * moves from the scrub's code into GUARDS below, where a reader looking for the
 * rule finds it beside the declaration. The regex did not go away; it stopped
 * being a secret. A node that wants a tag no guard can mistake for a path
 * writes it under a key that means a tag and nothing else, and that key is a
 * one-line addition here.
 *
 * DOM-free; sync; loadable in node:vm. Declares data and one pure projection
 * helper, and reads nothing from its environment.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* The arrays a multi-record envelope carries its per-element blocks in. EVERY known carrier:
     nights[] (OxyDex/CPAPDex), recordings[] (ECGDex/PulseDex), sessions[] (PpgDex). A new carrier
     is a new entry HERE, and until it is one its elements are dropped whole rather than passed
     through unscrubbed — the fail-closed direction, and `scrubDropped` names the array. */
  var ELEMENT_ARRAYS = ['nights', 'recordings', 'sessions'];

  /* ── THE ALLOW-LIST ───────────────────────────────────────────────────────────────────────────
     One entry per BLOCK, each a flat list of surviving keys. A key whose value is itself a
     declared block is listed here AND wired in BLOCK_CHILDREN below, so the projection recurses
     instead of copying an identifier-bearing sub-object wholesale. */
  var ALLOW = {
    /* The envelope's own keys. Node metric bags (`hrv`, `apnea`, `oximetry`, …) are listed by
       name: a node adding a tenth bag adds it here, which is the reviewable decision §3 asks for. */
    envelope: [
      'schema',
      'recording',
      'kernel',
      'measurement',
      'measurements',
      'reserved',
      'quality',
      'timeseries',
      'hrv',
      'hrvStability',
      'personalization',
      'apnea',
      'morphology',
      'cardiorespiratory',
      'sleep',
      'validation',
      'motion',
      'acc',
      'oximetry',
      'glycemic',
      'glucose',
      'variability',
      'patterns',
      'nutrition',
      'fusion',
      'metrics',
      'crossMetrics',
      'crossNode',
      'crossNight',
      'summary',
      'generated',
      'fmtVersion',
      'ganglior_events',
      'recordingCount',
      'nightCount',
      'nights',
      'recordings',
      'sessions'
    ],
    /* `scrubbed` and `scrubDropped` are the scrub's own marks, declared so the projection that
       writes them does not have to make an exception for itself. */
    schema: ['name', 'version', 'node', 'nodeVersion', 'generated', 'doc', 'units', 'bus', 'multiNight', 'multiRecording', 'provenance', 'scrubbed', 'scrubDropped'],
    /* COARSE build stamp kept (integrity, not identity); `inputs[]` recursed to the byte count. */
    provenance: ['buildHash', 'generated', 'scrubbed', 'inputs'],
    /* The byte count is non-identifying integrity. `name`, `sha256` and `lastModifiedMs` are the
       three routes #3344 and the F13 pass found, and none of them is declared. */
    provenanceInput: ['bytes'],
    /* No `device`, no `serial`, no `model`, no `source` — see the file header on `source`.
       `contentId` IS declared: EXPORT-IDENTITY's handle is identity-FREE and deterministic. */
    recording: [
      'source',
      'startEpochMs',
      'endEpochMs',
      'offsetMin',
      'contentId',
      'durationSec',
      'durationMin',
      'durSec',
      'spanMin',
      'spanDays',
      'recordedMin',
      'durationBasis',
      'durationDaysActive',
      'activeMin',
      'sampleRateHz',
      'tier',
      'tierNote',
      'beats',
      'epochs5min',
      'epochsRefused',
      'longRecording',
      'events',
      'mode',
      'modeLabel',
      'modeWhy',
      'ambulatory',
      'activityScore',
      'coverage',
      'coveragePct',
      'channel',
      'site',
      'siteSource',
      'timingSource',
      'hostAxis',
      'deviceEpoch',
      'unit',
      'sourceUnit',
      'cadenceMin',
      'readings',
      'clamp',
      'cpapInUse',
      'dateAnchorMs',
      'therapyHours',
      'sessionCount',
      'sessions',
      'offMaskGaps',
      'measurements',
      'windows',
      'firstTMs',
      'lastTMs'
    ],
    /* A per-element block is a small envelope: its own schema/recording/provenance recurse, and
       its metric bags are listed by name. `file` is NOT here — `nights[].file` carried the upload
       name verbatim and is the route the F13 measurement caught. */
    element: [
      'source',
      'schema',
      'recording',
      'provenance',
      'kernel',
      'reserved',
      'date',
      't0Ms',
      'contentId',
      'quality',
      'ganglior_events',
      'hrv',
      'metrics',
      'crossMetrics',
      'oximetry',
      'crossNode',
      'fmtVersion',
      'personalization',
      'apnea',
      'hrvStability',
      'cardiorespiratory',
      'morphology',
      'sleep',
      'acc',
      'timeseries',
      'stats',
      'summary',
      'odi4',
      'odi3',
      'hypoxicBurden',
      'motionProfile',
      'sleepQuality',
      'desatProfile',
      'hrProfile',
      'crossSignal',
      'spo2Advanced',
      'hrAdvanced',
      'composite',
      'sbii',
      'pred3p',
      'desSev',
      'ctPrecise',
      'sleepStability',
      'artifact',
      'hr_spikes',
      'oscillations',
      'flags',
      'newMetrics',
      'research',
      'ecgFusion',
      /* `hrvScore` carries no corpus count: no committed export has one, and `tests/dex-tests.js`
         plants it as the clinical content a scrub must not touch. It is declared on the strength of
         that committed assertion, and the distinction is worth keeping visible — every key above it
         was read off a real export, this one was read off a test. */
      'ansAge',
      'hrvScore'
    ],
    elementSchema: ['name', 'version', 'node', 'nodeVersion', 'generated', 'doc', 'units', 'provenance', 'scrubbed', 'scrubDropped'],
    elementRecording: [
      'source',
      'startEpochMs',
      'offsetMin',
      'contentId',
      'durSec',
      'durationSec',
      'durationMin',
      'dateAnchorMs',
      'sampleRateHz',
      'tier',
      'tierNote',
      'mode',
      'modeLabel',
      'modeWhy',
      'ambulatory',
      'activityScore',
      'beats',
      'epochs5min',
      'longRecording',
      'therapyHours',
      'sessionCount',
      'sessions',
      'offMaskGaps'
    ]
  };

  /* Which declared key leads into which block. The projection reads ONLY this map, so a block
     reachable by two routes (an element's `schema.provenance` and the envelope's) is projected by
     the same declaration both times — the drift that let the per-element twin leak. */
  var BLOCK_CHILDREN = {
    envelope: { schema: 'schema', recording: 'recording' },
    schema: { provenance: 'provenance' },
    elementSchema: { provenance: 'provenance' },
    element: { schema: 'elementSchema', recording: 'elementRecording', provenance: 'provenance' },
    provenance: {},
    provenanceInput: {},
    recording: {},
    elementRecording: {}
  };

  /* Which declared key holds an ARRAY of blocks rather than one. */
  var BLOCK_CHILD_ARRAYS = {
    envelope: { nights: 'element', recordings: 'element', sessions: 'element' },
    provenance: { inputs: 'provenanceInput' }
  };

  /* A path separator, or a dotted extension of one to five characters at the end. A semantic tag has
     neither — 'file', 'welltory', 'ResMed AirSense 11 (EDF set)', 'firmware 2.1 build' all pass, and
     'PLANT_PATH/x.csv', 'a\\b.edf' and 'Jane_Smith_O2Ring S 2100_20260612230016.csv' all fail. */
  var _FILE_SHAPE_RE = /[\\/]|\.[A-Za-z0-9]{1,5}$/;
  function _tagNotPath(v) {
    return typeof v !== 'string' || !_FILE_SHAPE_RE.test(v);
  }

  /* block → key → predicate. A DECLARED key whose VALUE fails its guard is dropped and named, so a
     guard reads in the report exactly like an undeclared key: one list of what did not survive. */
  var GUARDS = {
    recording: { source: _tagNotPath },
    elementRecording: { source: _tagNotPath },
    element: { source: _tagNotPath }
  };

  var _allowSets = {};
  function allowSet(block) {
    if (!_allowSets[block]) {
      var set = {};
      var keys = ALLOW[block] || [];
      for (var i = 0; i < keys.length; i++) set[keys[i]] = true;
      _allowSets[block] = set;
    }
    return _allowSets[block];
  }

  /** Is `key` declared for `block`? The one question every caller asks. */
  function allows(block, key) {
    return allowSet(block)[key] === true;
  }

  /**
   * Project one block onto its allow-list, recursing into declared child blocks.
   * PURE: reads `obj`, writes nothing, returns a fresh object. Every removed key is pushed onto
   * `dropped` as a dotted path, so the caller can report the absence rather than hide it.
   *
   * @param {string} block  a key of ALLOW
   * @param {*} obj         the block to project (a non-object comes back untouched)
   * @param {string} path   dotted path of `obj` for the drop report ('' for the envelope)
   * @param {string[]} dropped  OUT — collects the dotted path of every dropped key
   */
  function project(block, obj, path, dropped) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var children = BLOCK_CHILDREN[block] || {};
    var childArrays = BLOCK_CHILD_ARRAYS[block] || {};
    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var here = path ? path + '.' + k : k;
      if (!allows(block, k)) {
        if (dropped) dropped.push(here);
        continue;
      }
      var guard = (GUARDS[block] || {})[k];
      if (guard && !guard(obj[k])) {
        if (dropped) dropped.push(here);
        continue;
      }
      if (childArrays[k]) {
        /* A declared array of blocks. A non-array value under an array key is NOT coerced — it is
           dropped and named, because a shape nobody declared is exactly what fail-closed means. */
        if (!Array.isArray(obj[k])) {
          if (dropped) dropped.push(here);
          continue;
        }
        var arr = [];
        for (var j = 0; j < obj[k].length; j++) arr.push(project(childArrays[k], obj[k][j], here + '[]', dropped));
        out[k] = arr;
      } else if (children[k]) {
        out[k] = project(children[k], obj[k], here, dropped);
      } else {
        out[k] = obj[k];
      }
    }
    return out;
  }

  var ExportSchema = {
    ALLOW: ALLOW,
    ELEMENT_ARRAYS: ELEMENT_ARRAYS,
    BLOCK_CHILDREN: BLOCK_CHILDREN,
    BLOCK_CHILD_ARRAYS: BLOCK_CHILD_ARRAYS,
    GUARDS: GUARDS,
    allows: allows,
    project: project
  };
  root.ExportSchema = ExportSchema;
  if (typeof module !== 'undefined' && module.exports) module.exports = ExportSchema;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : /** @type {any} */ (this));
