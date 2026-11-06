/*
 * consensus-dissent.js — Tepna · the dissent SHAPE of one optical channel set, browser lane
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * ∅ A ZERO FROM `applyConsensusPolarity` IS FIVE DIFFERENT FACTS. The pass abstains — returning 0 —
 * on a unanimous set, on a 1-1 tie, on channels that carry no sign, and below two channels. Only the
 * first means the channels agreed, so a bare count reports a tie as agreement. The nine analysis
 * legs in `tools/` print the shape beside their figures through `tools/consensus-dissent-core.mjs`;
 * the workers publish into SURFACES rather than tables and threw the return away entirely
 * (row 2026-11-05-the-two-bundle-workers-still-discard-the-polarity-return). This file is the
 * labelling those workers reach: a classic script, so `importScripts` loads it served and
 * `build-analysis.mjs` inlines it into the blob as a sibling `.js` literal.
 *
 * 🔴 THE MAJORITY RULE IS NOT HERE, AND THAT IS THE POINT. Who wins a split is
 * `PPGDSP.consensusSign`, which `applyConsensusPolarity` itself calls, and the caller passes that
 * result in as `maj`. A second copy of the rule would be free to drift from the pass it describes,
 * which is the defect class this repo keeps logging. What this file adds is the NAME for an
 * abstention, and `tests/dex-tests.js` holds those names equal to `dissentOf` in the node core over
 * a planted sign table — the two lanes label the same condition or the suite reds.
 *
 * EACH PORTED FUNCTION DECLARES ITS OWN SOURCE, below, rather than this header declaring the file.
 * `tools/port-parity.mjs` reads `@port-from <path>#<symbol>`, so a file-level declaration naming no
 * symbol matches nothing and the gate never counts it. This file carried that shape first, and the
 * gate's population read 6 where it should have read 10 — a claim nobody can evaluate.
 */
(function (root) {
  'use strict';

  /* The closed set, in the core's order. `alone` is not a degenerate `unanimous`: one channel has
     nobody to agree with, and `consensusSign` abstains below two channels for that reason. */
  var SHAPES = ['majority', 'unanimous', 'tie', 'unsigned', 'alone'];

  /* The class of one channel set. `signs` are the PRE-pass signs in channel order, a channel the
     detector could not orient carrying `null`; `maj` is `PPGDSP.consensusSign(signs)` over the same
     set. A caller that cannot supply `maj` must not guess one — pass the pass's own value. */
  /* ── @port-from tools/consensus-dissent-core.mjs#dissentOf
     @port-sha 5178d33ba489
     The core takes the signs and derives the majority itself; this takes `maj` from the caller,
     who got it from `PPGDSP.consensusSign` — the same rule, read from the pass that applies it. */
  function shapeOf(signs, maj) {
    if (!signs || signs.length < 2) return 'alone';
    if (maj === 1 || maj === -1) return 'majority';
    var neg = 0,
      pos = 0;
    for (var i = 0; i < signs.length; i++) {
      if (signs[i] === -1) neg++;
      else if (signs[i] === 1) pos++;
    }
    if (neg === 0 && pos === 0) return 'unsigned';
    if (neg === pos) return 'tie';
    return 'unanimous';
  }

  /* The signs a detection pass produced, in channel order. A channel the detector could not orient
     stays `null` here — `shapeOf` reads that as `unsigned`, never as a sign. */
  /* ── @port-from tools/consensus-dissent-core.mjs#signsOf
     @port-sha 73fb07687a73
     Null-preserving on both sides: a channel with no sign is absent, never a 0 (§∅). */
  function signsOf(perChannel) {
    var out = [];
    if (!perChannel || !perChannel.length) return out;
    for (var i = 0; i < perChannel.length; i++) {
      var pc = perChannel[i];
      out.push(pc && pc.sign != null ? pc.sign : null);
    }
    return out;
  }

  /* The stamp one stream carries beside its own numbers, shaped as the core's `dissentStampOf`.
     Call it with the signs captured BEFORE the pass: after it the dissenter carries the majority
     sign and the stream reads unanimous. `corrected` is what `applyConsensusPolarity` returned over
     the same set, so the pair states both the condition and what the shipped code did about it.
     ∅ A `corrected` that is not a finite number is `null`, never 0 — an absent return is not a
     measured abstention. */
  /* ── @port-from tools/consensus-dissent-core.mjs#dissentStampOf
     @port-sha 5cc2efde15ca
     Same four fields in the same order. `corrected` is `null` when the pass reported no number,
     which is not the same fact as a reported 0 (§∅). */
  function stampOf(signs, maj, corrected) {
    var shape = shapeOf(signs, maj);
    var dissenters = [];
    if (maj === 1 || maj === -1) {
      for (var i = 0; i < signs.length; i++) if (signs[i] !== maj) dissenters.push(i);
    }
    return {
      shape: shape,
      corrected: typeof corrected === 'number' && isFinite(corrected) ? corrected : null,
      dissenters: dissenters,
      channels: signs ? signs.length : 0
    };
  }

  /* One stream's own line, for a surface that reads a single stream. The signs are the diagnosis: a
     reader sees the dissenting channel rather than trusting the class name. */
  /* ── @port-from tools/consensus-dissent-core.mjs#dissentStampLine
     @port-sha d73980df770b
     One prose line per shape, held equal to the core's by nothing but review: the suite pins the
     SHAPE both lanes derive, and the wording is this lane's own surface. */
  function stampLine(stamp, signs) {
    if (!stamp || !stamp.shape) return 'consensus polarity: not read';
    var acted = stamp.corrected > 0 ? stamp.corrected + ' channel(s) re-detected [' + stamp.dissenters.join(',') + ']' : 'nothing re-detected';
    var sgn = '';
    if (signs && signs.length) {
      var parts = [];
      for (var i = 0; i < signs.length; i++) parts.push(signs[i] == null ? '∅' : signs[i]);
      sgn = ' (signs ' + parts.join(',') + ')';
    }
    return 'consensus polarity: ' + stamp.shape + ' · ' + acted + sgn;
  }

  root.ConsensusDissent = {
    SHAPES: SHAPES,
    shapeOf: shapeOf,
    signsOf: signsOf,
    stampOf: stampOf,
    stampLine: stampLine,
    VERSION: '1.0.0'
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
