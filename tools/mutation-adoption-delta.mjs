// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// mutation-adoption-delta.mjs — did adopting those drafts actually KILL anything?
//
// MUTATION-ACCOUNTING-LOOP §E3, closing §3-G4: "nothing re-runs mutation after adoption to confirm
// the adopted assertions kill their mutants; the only post-adoption re-sweep ever done was an
// untracked 13-line shell loop with a hand-copied journal backup and no delta computation."
//
// Adoption's value has until now been inferred BY CONSTRUCTION — a draft was written to discriminate
// a surviving mutant, therefore adopting it kills that mutant. That inference is reasonable and it is
// not a measurement. This measures it: previously-SURVIVED mutants that are now KILLED, each
// attributed to the group that killed it via the journal's `ks`.
//
// THE VERDICT VOCABULARY HAS FOUR VALUES, NOT TWO, AND THE FOURTH IS WHY THIS FILE IS CAREFUL.
// A journal line is written when a mutant is PLANNED (`{k}`) and rewritten when it is JUDGED
// (`{k,v,ks}`), so a journal must be read LAST-WRITE-WINS PER KEY — see parseJournal.
//
// ⚠️ COUNT KEYS, NOT LINES, AND THIS FILE'S FIRST DRAFT GOT IT WRONG. Across the 30 committed
// journals there are 12990 LINES carrying no `v` at all against 12982 that carry one — which reads
// like half the corpus was never judged, and is a plan-line artifact. Resolved per key: 6818
// SURVIVED, 5987 KILLED, 93 INVALID, and **8 UNJUDGED — 0.06 %**. Nearly every no-`v` line is a plan
// superseded by its own verdict moments later.
//
// The rarity is not a reason to fold UNJUDGED into SURVIVED; it is the reason folding it in would be
// hard to notice. Eight mutants is invisible beside 12906 and material beside a delta of three.
//
//   `v !== 'KILLED'` IS NOT "SURVIVED". It is "survived, or invalid, or never actually ran".
//
// Treating UNJUDGED as surviving would put mutants nobody ever measured into the before-set, and any
// of them that run and die in the after-sweep would then be credited to adoption. The delta would be
// positive because THE SWEEP FINISHED, not because the assertions bite. So UNJUDGED is its own class
// here, is never a delta term, and is REPORTED — a mutant that stopped terminating between two
// sweeps is a finding about the harness, not a rounding error.
//
// ABSENT is the same argument at a different scale, and on a PARTIAL after-sweep it is the LARGE
// class: a mutant the after-sweep never reached is not a survivor either. The delta over a partial
// sweep is therefore a LOWER BOUND over the mutants actually judged, and must be quoted that way.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/* Journal keys are NUL-separated: `line \0 operator \0 before \0 after` (mutate.mjs). Written as an
   ESCAPE, never as a literal NUL byte — a literal one makes this file binary to `grep`, which is the
   exact trap `manifest-gate.js` already sets in this repo and which cost a session a false clean
   search this month. Splitting on a space would also be wrong: the before/after halves are source
   lines full of spaces. */
const NUL = '\u0000';

/** Where the drafts live — machine-local, never committed. Same resolution as verify-drafts.mjs: the
 *  git COMMON dir, so a worktree (which CLAUDE.md §👥.1 mandates for this work) resolves to the
 *  primary checkout's store rather than reporting a silent "no drafts". */
export function draftsDir(root = ROOT, { run = execFileSync } = {}) {
  try {
    const common = String(run('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' })).trim();
    return join(resolve(root, common), 'tepna-mutation');
  } catch {
    return join(root, '.git', 'tepna-mutation');
  }
}

/** One journal line per mutant KEY, LAST write wins — a planned line is later rewritten with its
 *  verdict, and a resumed sweep appends. Reading first-wins would report the plan, not the result. */
export function parseJournal(text) {
  const byKey = new Map();
  for (const line of String(text).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try {
      rec = JSON.parse(s);
    } catch {
      continue; // a torn last line from an interrupted sweep is not a verdict
    }
    if (!rec || typeof rec.k !== 'string') continue;
    byKey.set(rec.k, rec);
  }
  return byKey;
}

/** The four classes, named. `UNJUDGED` is planned-but-never-judged: non-termination, budget stop,
 *  interruption. Deliberately NOT folded into SURVIVED — see this file's header. */
export function classify(rec) {
  if (!rec) return 'ABSENT';
  const v = rec.v;
  if (v === 'KILLED' || v === 'SURVIVED' || v === 'INVALID') return v;
  return 'UNJUDGED';
}

/**
 * The delta core — pure, so the selftest pins it without a sweep.
 *
 * `adopted` is the set of group titles the adoption batch added. A newly-killed mutant is credited to
 * adoption only if the journal names one of those groups in `ks`; a kill by a pre-existing group is a
 * REAL kill and NOT adoption's, and is reported separately rather than quietly absorbed.
 */
export function adoptionDelta({ before, after, adopted = [] }) {
  const adoptedSet = new Set(adopted);
  const out = {
    killedByAdopted: [],
    killedByOther: [],
    killedUnattributed: [],
    stillSurviving: 0,
    regressed: [], // KILLED before, SURVIVED after — an adoption that BROKE a kill
    unjudgedBefore: 0,
    unjudgedAfter: 0,
    newlyUnjudged: [], // terminated before, does not now — a harness finding
    absentAfter: 0,
    beforeTotal: before.size,
    afterTotal: after.size,
  };
  for (const [k, b] of before) {
    const cb = classify(b);
    if (cb === 'UNJUDGED') out.unjudgedBefore++;
    const a = after.get(k);
    const ca = classify(a);
    if (ca === 'UNJUDGED') {
      out.unjudgedAfter++;
      if (cb === 'SURVIVED' || cb === 'KILLED') out.newlyUnjudged.push({ k, was: cb });
      continue; // never a delta term in either direction
    }
    if (ca === 'ABSENT') {
      out.absentAfter++;
      continue;
    }
    if (cb === 'KILLED' && ca === 'SURVIVED') {
      out.regressed.push({ k, wasKilledBy: Array.isArray(b.ks) ? b.ks : [] });
      continue;
    }
    if (cb !== 'SURVIVED') continue; // only a MEASURED survivor can become a measured kill
    if (ca === 'SURVIVED') {
      out.stillSurviving++;
      continue;
    }
    if (ca !== 'KILLED') continue;
    const ks = Array.isArray(a.ks) ? a.ks : [];
    if (!ks.length) out.killedUnattributed.push({ k, ks });
    else if (ks.some((g) => adoptedSet.has(g))) out.killedByAdopted.push({ k, ks: ks.filter((g) => adoptedSet.has(g)) });
    else out.killedByOther.push({ k, ks });
  }
  out.delta = out.killedByAdopted.length;
  return out;
}

/** The metrics row. Dated by the caller — no clock inside a pure function. */
export function metricsRow(file, adopted, d, stamp) {
  return {
    date: stamp,
    file,
    adoptedGroups: adopted.length,
    delta: d.delta,
    killedByOther: d.killedByOther.length,
    killedUnattributed: d.killedUnattributed.length,
    stillSurviving: d.stillSurviving,
    regressed: d.regressed.length,
    unjudgedBefore: d.unjudgedBefore,
    unjudgedAfter: d.unjudgedAfter,
    newlyUnjudged: d.newlyUnjudged.length,
  };
}

const MARK_A = '/* -- ADOPTION DELTA (tools/mutation-adoption-delta.mjs) ------------------------------';
const MARK_B = '-- end ADOPTION DELTA -- */';

/** Render the block that goes beside the drafts. The drafts' own CONTENT is never touched — the same
 *  contract verify-drafts.mjs holds: this reports about drafts, it does not rewrite them. */
export function deltaBlock(file, adopted, d, stamp) {
  const L = [];
  L.push(MARK_A);
  L.push(`   ${file} — measured ${stamp} by re-sweeping under current identity.`);
  L.push('');
  L.push(`   MEASURED DELTA: ${d.delta} previously-SURVIVED mutant(s) are now KILLED by an adopted group.`);
  if (d.killedByOther.length) L.push(`   ${d.killedByOther.length} more became killed by a group this batch did NOT add — real, but not adoption's.`);
  if (d.killedUnattributed.length) L.push(`   ${d.killedUnattributed.length} became killed with no group recorded — unattributable, credited nowhere.`);
  L.push(`   still surviving: ${d.stillSurviving}`);
  if (d.regressed.length) L.push(`   REGRESSED: ${d.regressed.length} mutant(s) were KILLED before and SURVIVE now.`);
  L.push('');
  L.push(`   UNJUDGED (planned, never judged — non-termination, budget, interruption): ${d.unjudgedBefore} -> ${d.unjudgedAfter}.`);
  L.push('   Not a delta term in either direction. `v !== KILLED` is not `SURVIVED`, and counting it');
  L.push('   as such would credit adoption for mutants nobody ever measured.');
  if (d.newlyUnjudged.length) L.push(`   ${d.newlyUnjudged.length} mutant(s) terminated before and do NOT now — a harness finding, not a delta.`);
  L.push('');
  for (const m of d.killedByAdopted.slice(0, 12)) {
    const parts = String(m.k).split(NUL);
    L.push(`     + line ${parts[0]}  ${parts[1] || ''}`);
    L.push(`         killed by: ${String(m.ks[0]).slice(0, 88)}`);
  }
  if (d.killedByAdopted.length > 12) L.push(`     ... and ${d.killedByAdopted.length - 12} more`);
  L.push(MARK_B);
  return L.join('\n');
}

/** Insert or REPLACE the block, idempotently. Anything outside the markers is preserved byte-for-byte. */
export function upsertBlock(existing, block) {
  const s = String(existing);
  const i = s.indexOf(MARK_A);
  if (i < 0) return (s.endsWith('\n') || s === '' ? s : `${s}\n`) + block + '\n';
  const j = s.indexOf(MARK_B, i);
  if (j < 0) return `${s}\n${block}\n`;
  return s.slice(0, i) + block + s.slice(j + MARK_B.length);
}

/** Group titles a drafts-adoption batch added, read from the suite by TAG rather than by name — the
 *  tag `mutation-drafts` is the batch's own marker and survives a title rewrite. */
export function adoptedGroupTitles(suiteText, fileStem) {
  const out = [];
  const re = /group\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([^']*mutation-drafts[^']*)'/g;
  let m = re.exec(String(suiteText));
  while (m) {
    const title = m[1].replace(/\\'/g, "'");
    const tag = m[2];
    if (!fileStem || tag.includes(fileStem)) out.push(title);
    m = re.exec(String(suiteText));
  }
  return out;
}

// -- selftest ------------------------------------------------------------------------------------
function selftest() {
  let pass = 0;
  let fail = 0;
  const ck = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    else {
      fail++;
      console.log(`  x ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    }
  };
  const J = (recs) => parseJournal(recs.map((r) => JSON.stringify(r)).join('\n'));

  ck('journal: the verdict line overrides the earlier plan line', classify(J([{ k: 'a' }, { k: 'a', v: 'KILLED', ks: ['G'] }]).get('a')), 'KILLED');
  ck('journal: a plan line with no verdict is UNJUDGED, not SURVIVED', classify(J([{ k: 'a' }]).get('a')), 'UNJUDGED');
  ck('journal: a torn line is skipped, not guessed', parseJournal('{"k":"b"').size, 0);

  const ADOPTED = ['mutation drafts — cpapdex'];

  // 1 - POSITIVE: a survivor becomes killed BY an adopted group
  const d1 = adoptionDelta({
    before: J([{ k: 'm1', v: 'SURVIVED' }, { k: 'm2', v: 'SURVIVED' }]),
    after: J([{ k: 'm1', v: 'KILLED', ks: ADOPTED }, { k: 'm2', v: 'SURVIVED' }]),
    adopted: ADOPTED,
  });
  ck('positive: one survivor is killed by the adopted group', d1.delta, 1);
  ck('positive: the other is still surviving', d1.stillSurviving, 1);

  /* 2 - THE NULL CONTROL, and it is the assertion this tool must be trusted by. A no-op adoption —
     the after-sweep identical to the before — must measure EXACTLY zero. A delta that cannot produce
     zero on an unchanged pair is not measuring adoption, it is measuring the sweep. */
  const same = [{ k: 'm1', v: 'SURVIVED' }, { k: 'm2', v: 'KILLED', ks: ['pre-existing group'] }];
  const d2 = adoptionDelta({ before: J(same), after: J(same), adopted: ADOPTED });
  ck('NULL CONTROL: a no-op adoption measures zero', d2.delta, 0);
  ck('NULL CONTROL: ...and does not invent a regression', d2.regressed.length, 0);
  ck('NULL CONTROL: ...and does not re-credit the pre-existing kill', d2.killedByOther.length, 0);

  /* 3 - A kill by a group this batch did not add is REAL and is NOT adoption's. Without this the
     delta silently absorbs every other improvement that landed in the same window. */
  const d3 = adoptionDelta({
    before: J([{ k: 'm1', v: 'SURVIVED' }]),
    after: J([{ k: 'm1', v: 'KILLED', ks: ['some other group'] }]),
    adopted: ADOPTED,
  });
  ck('a kill by a non-adopted group is not credited to adoption', d3.delta, 0);
  ck('...but it IS reported, not discarded', d3.killedByOther.length, 1);

  /* 4 - UNJUDGED is not SURVIVED — the header's whole argument, planted in both directions. */
  const d4 = adoptionDelta({ before: J([{ k: 'm1' }]), after: J([{ k: 'm1', v: 'KILLED', ks: ADOPTED }]), adopted: ADOPTED });
  ck('a mutant that never RAN before cannot be a newly-killed survivor', d4.delta, 0);
  const d5 = adoptionDelta({ before: J([{ k: 'm1', v: 'SURVIVED' }]), after: J([{ k: 'm1' }]), adopted: ADOPTED });
  ck('a mutant that stopped terminating is not counted as still-surviving', d5.stillSurviving, 0);
  ck('...it is reported as newly UNJUDGED', d5.newlyUnjudged.length, 1);

  /* 5 - REGRESSION: an adoption that BREAKS an existing kill must be loud. */
  const d6 = adoptionDelta({ before: J([{ k: 'm1', v: 'KILLED', ks: ['G'] }]), after: J([{ k: 'm1', v: 'SURVIVED' }]), adopted: ADOPTED });
  ck('a kill that became a survivor is reported as a REGRESSION', d6.regressed.length, 1);
  ck('...and never as a negative delta', d6.delta, 0);

  // 6 - the block is idempotent: re-running replaces, never accumulates
  const blk = deltaBlock('x.js', ADOPTED, d1, '2026-01-01');
  const once = upsertBlock('body\n', blk);
  ck('block upsert is idempotent', upsertBlock(once, blk) === once, true);
  ck('...and preserves the content outside it', upsertBlock(once, blk).startsWith('body\n'), true);
  const re2 = upsertBlock(once, deltaBlock('x.js', ADOPTED, d3, '2026-01-02'));
  ck('...and a second measurement replaces the first', re2.includes('2026-01-02') && !re2.includes('2026-01-01'), true);

  // 7 - group discovery reads the TAG, so a retitled group is still found
  const suite = "group('mutation drafts — cpapdex: recorded outputs', 'mutation-drafts · cpapdex-dsp · mutation · adopted-draft', function (T) {";
  ck('adopted groups are found by tag', adoptedGroupTitles(suite, 'cpapdex-dsp'), ['mutation drafts — cpapdex: recorded outputs']);
  ck('...and a different file does not match', adoptedGroupTitles(suite, 'oxydex-dsp'), []);

  console.log(`\nmutation-adoption-delta selftest: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// -- CLI -----------------------------------------------------------------------------------------
function main(argv) {
  const has = (f) => argv.includes(f);
  const opt = (f, d = null) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  if (has('--selftest')) return selftest();
  const file = opt('--file');
  const beforeP = opt('--before');
  const afterP = opt('--after');
  if (!file || !beforeP || !afterP) {
    console.log('usage: node tools/mutation-adoption-delta.mjs --file <src.js> --before <journal.jsonl> --after <journal.jsonl> [--write] [--json]');
    console.log('       node tools/mutation-adoption-delta.mjs --selftest');
    console.log('');
    console.log('Produce the after-journal with:  node tools/mutate.mjs --file <src.js> --journal <path>');
    console.log('(--journal keeps the re-sweep OFF the committed journal, so the before-state survives the measurement.)');
    return 2;
  }
  for (const p of [beforeP, afterP]) {
    if (!existsSync(p)) {
      console.error(`refusing: ${p} does not exist. An absent journal is not an empty one.`);
      return 2;
    }
  }
  const suitePath = join(ROOT, 'tests', 'dex-tests.js');
  const stem = file.replace(/\.js$/, '');
  const adopted = existsSync(suitePath) ? adoptedGroupTitles(readFileSync(suitePath, 'utf8'), stem) : [];
  if (!adopted.length) console.error(`warning: no mutation-drafts group tagged "${stem}" — the delta can only be 0 by construction. Read it as "nothing to measure", never as "adoption did nothing".`);
  const d = adoptionDelta({ before: parseJournal(readFileSync(beforeP, 'utf8')), after: parseJournal(readFileSync(afterP, 'utf8')), adopted });
  const stamp = new Date().toISOString().slice(0, 10);
  if (has('--json')) console.log(JSON.stringify({ row: metricsRow(file, adopted, d, stamp), adopted }, null, 2));
  else console.log(deltaBlock(file, adopted, d, stamp));
  if (has('--write')) {
    const dd = draftsDir();
    const df = join(dd, `${file}.drafts.js`);
    if (existsSync(df)) {
      writeFileSync(df, upsertBlock(readFileSync(df, 'utf8'), deltaBlock(file, adopted, d, stamp)));
      console.log(`\nwrote the delta beside the drafts: ${df}`);
    } else {
      console.error(`\nwarning: no drafts file at ${df} — block not written (the measurement above still stands).`);
    }
    appendFileSync(join(dd, 'adoption-delta-metrics.jsonl'), `${JSON.stringify(metricsRow(file, adopted, d, stamp))}\n`);
    console.log(`appended the metrics row: ${join(dd, 'adoption-delta-metrics.jsonl')}`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
