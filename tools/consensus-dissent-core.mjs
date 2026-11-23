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
/* ── THE SHIPPED RULE IS NOT A LOOP, SO THIS MODULE HOLDS NO COPY OF IT ──────────────────────────

   `CONSENSUS-REFPICK-FOLLOWUPS-2026-11-06-BRIEF.md` §3 asks each cited PAT leg to read the SHIPPED
   rule, and its §5 asks the census to still read every converted site as `named`. A site reads
   `named` only when it calls `refpickOf`, so convergence has to travel through this helper. The
   shipped rule is `pickChannel` (pulse-band SNR over the RAW channels) and then
   `harmonicOutlierRefIdx` (move the reference onto a coherent majority). Neither reads `perChannel`:
   `pickChannel` scores `rec.ch[c]` at `rec.fs`, which this module never sees.

   🔴 SO THE RULE IS DELEGATED, NEVER RE-IMPLEMENTED. A second copy of an SNR pick in `tools/` would
   desync from `ppgdex-dsp.js` with no gate able to see it, which is the defect the row behind this
   brief already measured once. The caller passes the two SHIPPED functions and the parsed record,
   and this helper only names the rule, builds the guard's two inputs the way `analyze` builds them,
   and reports what moved. `consensus-refpick-dissent.mjs --selftest` holds the delegation against
   those same three lines of `analyze`, which is the parity leg §3's fourth box requires.

   🔴 AND IT REFUSES RATHER THAN FALLS BACK. An absent injection, a record it cannot score, or a
   `perChannel` in another index space than `rec.ch` throws. A fallback onto `peak-argmax` would let
   a leg declare the shipped rule and measure the ported one — a figure stating a rule it did not
   run, which is worse than the unnamed loop this helper replaced.

   ∅ THE GUARD'S ZERO IS AN INPUT AND NEVER A SCORE. `analyze` pads an unscored channel with `0` for
   the re-pick, because `harmonicOutlierRefIdx` ranks on that array. This helper reproduces the pad
   so the guard sees what the node sees, and it still returns `score: null` for a channel that
   carries no finite SNR. `scored` is the record-level absence channel: `false` says no channel ever
   chose a reference, while `idx` stays the real position `analyze` derives its feet on. A leg
   annotates that; it must not refuse where the node does not, or it stops measuring the node. */
export const REFPICK_RULES = ['peak-argmax', 'snr-pick-guarded'];

function shippedRefpick(perChannel, opts) {
  const o = opts || {};
  const pick = o.pickChannel;
  const guard = o.harmonicOutlierRefIdx;
  const rec = o.rec;
  if (typeof pick !== 'function' || typeof guard !== 'function') {
    throw new TypeError("refpickOf('snr-pick-guarded'): pass the shipped pickChannel and harmonicOutlierRefIdx — this module holds no copy of either");
  }
  if (!rec || !rec.ch || typeof rec.ch.length !== 'number') {
    throw new TypeError("refpickOf('snr-pick-guarded'): needs the parsed record, because the shipped rule scores the RAW channels");
  }
  const channels = perChannel ? perChannel.length : 0;
  const keepIdx = Array.isArray(o.keepIdx) ? o.keepIdx : null;
  if (keepIdx && keepIdx.length !== channels) {
    throw new TypeError(`refpickOf('snr-pick-guarded'): keepIdx names ${keepIdx.length} raw channel(s) for ${channels} detected one(s)`);
  }
  if (!keepIdx && channels !== rec.ch.length) {
    throw new TypeError(`refpickOf('snr-pick-guarded'): perChannel holds ${channels} channel(s) and rec.ch holds ${rec.ch.length} — a deduping caller passes keepIdx and its own remapped refIdx`);
  }
  if (keepIdx && !Number.isInteger(o.refIdx)) {
    throw new TypeError("refpickOf('snr-pick-guarded'): a deduping caller passes opts.refIdx, because the remap onto the deduped set is the caller's own");
  }
  const sel = pick(rec);
  const map = keepIdx || Array.from({ length: channels }, (_, i) => i);
  const snrIdx = keepIdx ? o.refIdx : sel.idx;
  const durSec = Number.isFinite(o.durSec) ? o.durSec : rec.durSec;
  const snrAt = (i) => {
    const sc = sel.scores && sel.scores[map[i]] ? sel.scores[map[i]].snr : null;
    return Number.isFinite(sc) ? sc : null;
  };
  const rates = [];
  const snr = [];
  for (let i = 0; i < channels; i++) {
    const pc = perChannel[i];
    rates.push(pc && pc.peaks && pc.peaks.length > 10 && durSec > 0 ? (pc.peaks.length / durSec) * 60 : null);
    const s = snrAt(i);
    snr.push(s === null ? 0 : s);
  }
  const guarded = guard(snrIdx, rates, snr);
  const idx = Number.isInteger(guarded) && guarded >= 0 && guarded < channels ? guarded : null;
  const win = Number.isInteger(snrIdx) && snrIdx >= 0 && snrIdx < channels ? snrAt(snrIdx) : null;
  let ties = 0;
  if (win !== null) {
    for (let i = 0; i < channels; i++) {
      if (i === snrIdx) continue;
      if (snrAt(i) === win) ties++;
    }
  }
  return {
    rule: 'snr-pick-guarded',
    idx,
    score: idx === null ? null : snrAt(idx),
    ties,
    channels,
    snrIdx: Number.isInteger(snrIdx) ? snrIdx : null,
    movedByGuard: idx !== null && idx !== snrIdx,
    scored: !!sel.scored
  };
}

export function refpickOf(perChannel, rule, opts) {
  if (!REFPICK_RULES.includes(rule)) throw new TypeError(`refpickOf: unknown pick rule ${JSON.stringify(rule)} (known: ${REFPICK_RULES.join(', ')})`);
  if (rule === 'snr-pick-guarded') return shippedRefpick(perChannel, opts);
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

/* ── the reference pick, PRINTED ──────────────────────────────────────────────────────────────────

   🔴 A FIGURE THAT NAMES NO PICK RULE LETS A READER ASSUME THE SHIPPED ONE.
   `CONSENSUS-REFPICK-FOLLOWUPS-2026-11-06-BRIEF.md` §3 asks each PAT leg to carry the rule behind
   its feet beside the polarity stamp it already carries. Nine ported legs pick the channel with the
   most detected peaks, the shipped node picks on pulse-band SNR, and the two rules name a different
   reference on 37 of 54 Verity nights. Neither published table stated its rule, so a reader
   comparing two of them saw one number against another and no way to tell the rules apart.
   `refpickOf` already returns every field such a line needs, and every leg threw all of them away
   but `idx`. These two printers are option B of that brief: they repair no comparison, and they stop
   a reader assuming one. Convergence onto the shipped rule stays the brief's other half.

   ∅ THREE READS, THREE WORDS, NO BORROWING. A stamp the run never built reads `not read`. A stamp
   whose `idx` is `null` reads as a channel set that carried no readable score. A real pick reads its
   channel, and a tie says so, because a tie picks by file order rather than by evidence. */

/* One stream's own line, for a leg that reads a single stream per run — the shape
   `dissentStampLine` prints the polarity in. */
export function refpickStampLine(stamp) {
  if (!stamp || !stamp.rule) return '  reference pick: not read';
  if (stamp.idx == null) {
    return `  reference pick: none under ${stamp.rule} — no channel of ${stamp.channels} carried a readable score`;
  }
  const tied = stamp.ties > 0 ? `, arbitrary among ${stamp.ties + 1} equals` : '';
  return `  reference pick: channel ${stamp.idx} of ${stamp.channels} under ${stamp.rule} (score ${stamp.score}${tied})`;
}

/* The pooled tally over the streams a run SCORED. A stream the run never read has no stamp, so it
   counts as `unread` and never pads a rule it was never picked under (§∅). */
export function refpickTally(stamps) {
  const t = { streams: 0, picked: 0, tied: 0, unscored: 0, unread: 0, byRule: {} };
  for (const s of stamps || []) {
    if (!s || !s.rule) {
      t.unread++;
      continue;
    }
    t.streams++;
    /* A rule's counter starts at zero the first time that rule appears, which is a real count and
       never a measured value standing in for an absent one. `dissentTally` guards its fixed key set
       the same way, and an `|| 0` here would read as the §∅ fabrication `absence-regression` hunts. */
    if (!Object.hasOwn(t.byRule, s.rule)) t.byRule[s.rule] = 0;
    t.byRule[s.rule]++;
    if (s.idx == null) {
      t.unscored++;
      continue;
    }
    t.picked++;
    if (s.ties > 0) t.tied++;
  }
  return t;
}

/* One line, printed beside `dissentTallyLine`. It names every class including the empty ones: a
   measured zero for ties is a fact, and an absent class reads as "nobody looked". */
export function refpickTallyLine(stamps) {
  const t = refpickTally(stamps);
  const rules = Object.keys(t.byRule).sort();
  const named = rules.length ? rules.map((r) => `${t.byRule[r]} on ${r}`).join(' · ') : 'no rule read';
  const parts = [`reference pick: ${t.picked} of ${t.streams} stamped stream(s) picked`, `rule(s) ${named}`, `${t.tied} arbitrary among equals`, `${t.unscored} with no readable score`];
  if (t.unread) parts.push(`${t.unread} not read`);
  return '  ' + parts.join(' · ');
}
