/*
 * consensus-dissent-core.mjs — the dissent SHAPE of one optical channel set, single-sourced.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `applyConsensusPolarity` RETURNS THE CHANNELS IT RE-DETECTED, AND TEN CALLERS THREW IT AWAY.
 * #4330 wired the pass into all nine PAT legs and re-measured nothing that was already published, so
 * a reader of a published table cannot tell whether the stream behind a row was corrected — row
 * 2026-11-04-pat-figures-were-published-under-the-overruled-polarity. Measured 2026-11-03 over 126
 * Verity streams: 19 dissent, and pooled over those the kept 3-of-3 beat count rises from 261 to
 * 6,623 while consensus feet rise 78.9 %. The other 107 are unmoved by construction, which is the
 * whole value of printing WHICH stream was corrected rather than a pooled number alone.
 *
 * ∅ A ZERO FROM THIS PASS IS FIVE DIFFERENT FACTS. `applyConsensusPolarity` abstains — returning 0 —
 * on a unanimous set, on a 1–1 tie, on channels that carry no sign, and below two channels. Only the
 * first means the observers agreed. A bare count reports a tie as agreement, so the shape travels
 * beside the count everywhere a leg prints one, and a stream nobody read stays `unread` instead of
 * joining the agreeing majority.
 */

/* The closed set. `alone` is not a degenerate `unanimous`: one channel has nobody to agree with, and
   `consensusSign` abstains below two channels for that reason. */
export const DISSENT_SHAPES = ['majority', 'unanimous', 'tie', 'unsigned', 'alone'];

/* The dissenter set as a caller holds it: each channel detected on its own orientation, the majority
   sign taken across them, and the minority named. A unanimous record has no dissenter and no
   majority, which is `maj: 0` rather than an empty set over a majority of one.

   ∅ UNANIMOUS AND TIED ARE NOT ONE CLASS. Both leave `maj: 0` and no dissenter, and only one of
   them means the observers agreed: a 1–1 split is a record with NO majority to dissent from, where
   `applyConsensusPolarity` also abstains. `shape` keeps them apart so a tally cannot report a tie as
   agreement. */
export function dissentOf(signs) {
  if (!signs || signs.length < 2) return { maj: 0, dissenters: [], shape: 'alone' };
  let neg = 0,
    pos = 0;
  for (const s of signs) {
    if (s === -1) neg++;
    else if (s === 1) pos++;
  }
  if (neg === pos) return { maj: 0, dissenters: [], shape: neg === 0 ? 'unsigned' : 'tie' };
  if (neg === 0 || pos === 0) return { maj: 0, dissenters: [], shape: 'unanimous' };
  const maj = neg > pos ? -1 : 1;
  const dissenters = [];
  for (let i = 0; i < signs.length; i++) if (signs[i] !== maj) dissenters.push(i);
  return { maj, dissenters, shape: 'majority' };
}

/* The signs a detection pass produced, in channel order. A channel the detector could not orient
   carries `null` and stays `null` here — `dissentOf` reads that as `unsigned`, never as a sign. */
export function signsOf(perChannel) {
  if (!perChannel || !perChannel.length) return [];
  return Array.from(perChannel, (pc) => (pc && pc.sign != null ? pc.sign : null));
}

/* The stamp one stream carries beside its own numbers. `signs` are the PRE-pass signs and `corrected`
   is what `applyConsensusPolarity` returned over the same set, so the pair states both the condition
   and what the shipped code did about it. Call it with the signs captured BEFORE the pass: after it
   the dissenter carries the majority sign and the record reads unanimous. */
export function dissentStampOf(signs, corrected) {
  const d = dissentOf(signs);
  return { shape: d.shape, corrected: Number.isFinite(corrected) ? corrected : null, dissenters: d.dissenters, channels: signs ? signs.length : 0 };
}

/* One stream's own line, for a leg that reads a single stream per run — where a pooled tally would
   state `1 of 1` and say less than the shape does. The signs are printed because they are the
   diagnosis: a reader can see the dissenting channel rather than trust the class name. */
export function dissentStampLine(stamp, signs) {
  if (!stamp || !stamp.shape) return '  consensus polarity: not read';
  const acted = stamp.corrected > 0 ? `${stamp.corrected} channel(s) re-detected [${stamp.dissenters.join(',')}]` : 'nothing re-detected';
  const sgn = signs && signs.length ? ` (signs ${signs.map((x) => (x == null ? '∅' : x)).join(',')})` : '';
  return `  consensus polarity: ${stamp.shape} · ${acted}${sgn}`;
}

/* The pooled tally over the streams a run SCORED. A stream that was never read has no stamp, so it
   counts as `unread` and never pads an agreeing class (§∅). `corrected` counts STREAMS the pass acted
   on; `channels` counts the re-detections inside them. */
export function dissentTally(stamps) {
  const t = { streams: 0, corrected: 0, channels: 0, majority: 0, unanimous: 0, tie: 0, unsigned: 0, alone: 0, unread: 0 };
  for (const s of stamps || []) {
    if (!s || !s.shape) {
      t.unread++;
      continue;
    }
    t.streams++;
    if (Object.hasOwn(t, s.shape)) t[s.shape]++;
    if (s.corrected > 0) {
      t.corrected++;
      t.channels += s.corrected;
    }
  }
  return t;
}

/* One line, printed beside the numbers the run publishes. It names every class including the empty
   ones: a measured zero for ties is a fact, and an absent class reads as "nobody looked". */
export function dissentTallyLine(stamps) {
  const t = dissentTally(stamps);
  const parts = [
    `consensus polarity: ${t.corrected} of ${t.streams} scored stream(s) corrected (${t.channels} channel(s) re-detected)`,
    `${t.unanimous} unanimous`,
    `${t.tie} tie (a tie is not agreement)`,
    `${t.unsigned} unsigned`,
    `${t.alone} single-channel`
  ];
  if (t.unread) parts.push(`${t.unread} not read`);
  return '  ' + parts.join(' · ');
}
