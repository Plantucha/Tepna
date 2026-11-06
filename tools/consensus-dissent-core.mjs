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

/* ── the reference pick, named ────────────────────────────────────────────────────────────────── */

/* 🔴 A PICK RULE WRITTEN AS A LOOP IS A RULE NOBODY DECLARED. Row
   2026-11-03-three-pick-rules-disagree-on-the-consensus-reference-on-thirty-seven-nights measured
   three live rules across the 13 `consensusBeats` call sites, disagreeing about which channel is the
   reference on 37 of 54 nights. Eight ported legs each carried their own copy of ONE argmax loop, so
   `consensus-refpick-dissent.mjs` could only INFER each rule from the loop shape, and a figure a leg
   published carried no statement of the rule its feet were derived under. A site that calls
   `refpickOf(per, 'peak-argmax')` states its rule in code, where the census reads a declaration
   instead of guessing from a comparison. Convergence onto the shipped rule is the other half of that
   row: it is a decision about published figures, not a refactor, and this changes no pick.

   The loop it replaces, verbatim in all eight legs: `let refIdx = 0, best = -1;` and then
   `if (p.peaks.length > best)`. The strict `>` keeps the FIRST channel of a tie, which `ties` counts
   rather than hides.

   ∅ A TIE IS A PICK BY CHANNEL ORDER, NOT BY EVIDENCE. Two channels carrying the same peak count
   leave the reference to the order the file happens to list them in. `ties` is how many other
   channels matched the winner, so a leg can report that its reference was arbitrary among equals.

   ∅ A SET WITH NO READABLE SCORE HAS NO ARGMAX. Those loops opened at `best = -1`, so a channel set
   where nothing carries a countable score still left the pick at index 0 — channel 0 chosen having
   measured nothing. `idx` is `null` there, and a caller that indexes the pick throws on the null
   rather than deriving every foot on a channel no pass scored. No live leg reaches it: a detected
   channel carries a `peaks` array, and an empty one scores a real 0. */
export const REFPICK_RULES = ['peak-argmax'];

export function refpickOf(perChannel, rule) {
  if (!REFPICK_RULES.includes(rule)) throw new TypeError(`refpickOf: unknown pick rule ${JSON.stringify(rule)} (known: ${REFPICK_RULES.join(', ')})`);
  const channels = perChannel ? perChannel.length : 0;
  let idx = null;
  let score = null;
  let ties = 0;
  for (let i = 0; i < channels; i++) {
    const pc = perChannel[i];
    const s = pc && pc.peaks ? pc.peaks.length : null;
    if (!Number.isFinite(s)) continue;
    if (score === null || s > score) {
      score = s;
      idx = i;
      ties = 0;
    } else if (s === score) ties++;
  }
  return { rule, idx, score, ties, channels };
}
