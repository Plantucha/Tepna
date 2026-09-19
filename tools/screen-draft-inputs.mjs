#!/usr/bin/env node
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* screen-draft-inputs.mjs — ADVISORY screen over drafted assertion INPUTS.
 *
 * WHY THIS EXISTS. Every other check on a draft inspects its VALUE: does the projection reproduce
 * (verify-drafts), does it discriminate the mutant (the kill check). Two `ecgdex-cross` drafts passed
 * BOTH and were still unadoptable, because the defect was in the ARGUMENT:
 *
 *     ECGCross.mannKendall("mannKendall([1,2,1])")
 *
 * — a 21-character string where an array belongs. The drafting model fed its own prompt text in as the
 * input. It "works" only because `mannKendall` reads `y.length` and then subtracts characters, so `d`
 * is NaN and S stays 0. Adopting it would pin the accidental duck-typing of a string as an array, so a
 * later `Array.isArray` guard — a strict improvement — would red the suite. No amount of strengthening
 * the value-side rails would ever have caught it. See QWEN-ENGINEERING-PROGRAM §7-ter.1.
 *
 * ⚠️ IT SCREENS, IT DOES NOT DECIDE. It flags candidates for a human read and exits 0 even when it
 * flags. A screen that decides is a second oracle with the same failure modes as the first — and this
 * repo's own scar tissue is a screen ("0 of 9 alleging a defect") that pattern-matched instead of
 * reading and was then relayed onward as established. `--strict` exits 1 for anyone who wants it in a
 * pipeline; that is opt-in, and it is still not a verdict on adoptability.
 *
 * 🔴 FALSE-NEGATIVE SURFACE — stated plainly, because a scoping sentence that claims more than the
 * code inspects is this repo's recurring defect:
 *   · Only STRING literals in the call are inspected. Prompt text arriving as a number, an array, an
 *     object or an identifier is INVISIBLE to every check here.
 *   · Check 3 is the only one that can see a type contradiction, and only when the SAME callee appears
 *     elsewhere in the pile with a different argument type. A callee drafted exactly once is unscreened
 *     for type by construction.
 *   · The call is read as TEXT, not parsed as an AST. A string literal inside a nested call is
 *     attributed to the outer callee.
 *   · It says nothing about values, discrimination, or whether the PROPERTY line is true. Those are
 *     verify-drafts, the kill check, and a human read respectively. This replaces none of them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDrafts } from './verify-drafts.mjs';

/** Split an argument list on top-level commas, respecting nesting and string literals. */
export function splitArgs(src) {
  const out = [];
  let depth = 0,
    q = null,
    cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      cur += c;
      if (c === '\\') {
        cur += src[++i] ?? '';
        continue;
      }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `Obj.method(a, b)` → { callee:'Obj.method', method:'method', args:[...] }; null if not a plain call. */
export function parseCall(call) {
  const m = String(call).match(/^([A-Za-z_$][\w$.]*)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  const callee = m[1];
  return { callee, method: callee.split('.').pop(), args: splitArgs(m[2]) };
}

const isStringLit = (a) => /^(['"])[\s\S]*\1$/.test(a);
const litText = (a) => a.slice(1, -1);
/* Code-shaped: `foo(` … or a bracketed array literal. Deliberately NOT a general "looks like JS"
   test — a loose one would flag ordinary sentences and turn the screen into noise, which is how a
   screen stops being read at all. */
const CODE_SHAPED = /^[A-Za-z_$][\w$.]*\s*\(|^\[[\s\S]*\]$/;

/** Screen one pile. `drafts` is [{file, call, mutant}]. Returns flags; never throws. */
export function screen(drafts) {
  /* Check 3 needs the whole pile first: which arg TYPES has each callee been drafted with, PER
     POSITION? ⚠️ Keying on the callee alone was the first version and it was wrong in the way that
     kills a screen: a `badgeForLabel(label, id)` taking a STRING then a NUMBER pooled both types, so every
     legitimate string label tripped the check. It flagged 11 correct calls out of 24 — and an
     over-flagging screen stops being read, which is the same end state as no screen. Position-aware,
     the same pile yields only genuine type contradictions. */
  const typesAt = new Map();
  const key = (callee, i) => callee + '#' + i;
  const typeOf = (a) => (isStringLit(a) ? 'string' : /^\[/.test(a) ? 'array' : /^-?[\d.]+$/.test(a) ? 'number' : 'other');
  for (const d of drafts) {
    const p = parseCall(d.call);
    if (!p) continue;
    p.args.forEach((a, i) => {
      const t = typesAt.get(key(p.callee, i)) || new Set();
      t.add(typeOf(a));
      typesAt.set(key(p.callee, i), t);
    });
  }
  const flags = [];
  for (const d of drafts) {
    const p = parseCall(d.call);
    if (!p) continue;
    p.args.forEach((a, i) => {
      if (!isStringLit(a)) return;
      const text = litText(a);
      if (text.includes(p.method)) flags.push({ ...d, check: 'SELF-REFERENTIAL', why: `string argument contains the callee's own name "${p.method}" — the hallmark of prompt text passed as input` });
      else if (CODE_SHAPED.test(text)) flags.push({ ...d, check: 'CODE-SHAPED', why: 'string argument is shaped like a call or array literal, not like data' });
      const t = typesAt.get(key(p.callee, i));
      const conflicting = t ? [...t].filter((x) => x === 'array' || x === 'number') : [];
      if (conflicting.length) flags.push({ ...d, check: 'TYPE-DISAGREEMENT', why: `${p.callee} argument ${i} is drafted elsewhere as ${conflicting.join('/')} — a string here contradicts that use` });
    });
  }
  /* One row per (call, check): the same call can trip a check through two arguments. */
  const seen = new Set();
  return flags.filter((f) => {
    const k = f.file + '|' + f.call + '|' + f.check;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function collect(dir, { read = readFileSync, list = readdirSync } = {}) {
  const out = [];
  for (const f of list(dir).filter((x) => x.endsWith('.drafts.js'))) for (const d of parseDrafts(read(join(dir, f), 'utf8'))) out.push({ ...d, file: f });
  return out;
}

export function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (n, c, detail) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (detail ? ' — ' + detail : ''));
    }
  };

  /* 🔴 KNOWN POSITIVE FIRST. An instrument unproven against a case known to be true has told you
     nothing — this is the real ecgdex-cross draft that motivated the tool. */
  const real = [{ file: 'x', call: 'ECGCross.mannKendall("mannKendall([1,2,1])")', mutant: 'm' }];
  const fr = screen(real);
  ok('🔴 the real mannKendall prompt-text draft is FLAGGED', fr.length > 0, JSON.stringify(fr));
  ok(
    '…and it is flagged SELF-REFERENTIAL, the specific reason',
    fr.some((f) => f.check === 'SELF-REFERENTIAL'),
    fr.map((f) => f.check).join(',')
  );

  /* KNOWN NEGATIVES — the 15 adopted in batch 2 must not be flagged, or the screen is noise. */
  const clean = [
    { file: 'y', call: 'ECGCross.mannKendall([1,2,3])', mutant: 'm' },
    { file: 'y', call: 'ECGDSP.accExtras([],[])', mutant: 'm' },
    { file: 'y', call: 'ECGCross.ols([1,2,1],[3,4,1])', mutant: 'm' },
    { file: 'y', call: 'ECGDSP.planCompanionGraft(null)', mutant: 'm' },
    { file: 'y', call: 'ECGCross.crossNight([{"v":null,"t":1609459200000}],null)', mutant: 'm' }
  ];
  ok('the five representative ADOPTED calls are not flagged', screen(clean).length === 0, JSON.stringify(screen(clean)));

  /* Check 3 in isolation: a string that is neither self-naming nor code-shaped is caught ONLY by the
     cross-draft type disagreement. This is the case checks 1 and 2 both miss. */
  const mixed = [
    { file: 'z', call: 'ECGCross.mannKendall("hello world")', mutant: 'm' },
    { file: 'z', call: 'ECGCross.mannKendall([1,2,3])', mutant: 'm' }
  ];
  const fm = screen(mixed);
  ok(
    'a plain string is caught by TYPE-DISAGREEMENT when the callee is drafted with an array too',
    fm.some((f) => f.check === 'TYPE-DISAGREEMENT'),
    fm.map((f) => f.check).join(',')
  );

  /* ⚠️ THE DOCUMENTED BLIND SPOT, ASSERTED so the false-negative note cannot rot into a claim the
     code does not honour: a callee drafted ONCE with a plain string is NOT flagged. */
  const blind = [{ file: 'z', call: 'ECGCross.mannKendall("hello world")', mutant: 'm' }];
  ok('⚠️ DOCUMENTED BLIND SPOT · a singly-drafted plain-string arg is NOT flagged', screen(blind).length === 0, JSON.stringify(screen(blind)));

  /* 🔴 REGRESSION for the pooled-type bug. A signature that is CONSISTENTLY (string, number) must not
     flag its own string: the first version pooled both types under the callee and flagged it. */
  const sig = [
    { file: 'w', call: 'Reg.badgeForLabel("perfusion idx",1)', mutant: 'm' },
    { file: 'w', call: 'Reg.badgeForLabel("spo2 mean",3)', mutant: 'm' }
  ];
  ok('🔴 a consistently (string, number) signature does NOT flag its own legitimate string label', !screen(sig).some((f) => f.check === 'TYPE-DISAGREEMENT'), JSON.stringify(screen(sig)));

  /* …and the position-aware check still FIRES when one POSITION genuinely holds both types. These are
     the real `oxydex-registry` drafts; argument 1 is a number in one and a string in the other, so one
     of the two is wrong and both are worth a read. Without this leg the regression above could be
     satisfied by a check that never fires at all. */
  const realMixed = [
    { file: 'w', call: 'OxyRegistry.badgeForLabel(null,1)', mutant: 'm' },
    { file: 'w', call: 'OxyRegistry.badgeForLabel("perfusioN iDx","meanPi")', mutant: 'm' }
  ];
  const rm = screen(realMixed).filter((f) => f.check === 'TYPE-DISAGREEMENT');
  ok('a genuinely mixed POSITION still flags, and the reason names that argument index', rm.length === 1 && /argument 1 /.test(rm[0].why), JSON.stringify(rm));

  ok('splitArgs respects nesting and does not split inside a string', splitArgs('[1,2],"a,b",{k:1}').length === 3, String(splitArgs('[1,2],"a,b",{k:1}').length));
  ok('parseCall returns null for a non-call expression', parseCall('1 + 2') === null);

  console.log(fail === 0 ? `\n✓ all ${pass} selftests passed` : `\n✗ selftest — ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

export function main(argv = []) {
  if (argv.includes('--selftest')) return selftest();
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice(6) : join(process.cwd(), '.git', 'tepna-mutation');
  const drafts = collect(dir);
  const flags = screen(drafts);
  console.log(`screened ${drafts.length} drafted calls from ${dir}`);
  if (!flags.length) console.log('no input-shaped concerns found — NOT a statement that the drafts are adoptable');
  for (const f of flags) console.log(`  ⚑ ${f.check.padEnd(18)} ${f.file}\n      ${f.call}\n      ${f.why}`);
  console.log(`\n${flags.length} flagged for a HUMAN READ. This screen does not decide adoptability.`);
  return argv.includes('--strict') && flags.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('screen-draft-inputs.mjs')) process.exit(main(process.argv.slice(2)));
