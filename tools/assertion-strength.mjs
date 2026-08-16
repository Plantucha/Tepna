/*
 * tools/assertion-strength.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── WHICH ASSERTIONS PIN A DIRECTION WHERE THEY COULD PIN A VALUE ───────────────────────────────
 *
 * Level B deleted the ENTIRE least-squares body of `_ckAllanSlope` with the suite still green. The
 * cause was not a missing test — the function was exercised — but the SHAPE of its assertions:
 * `st.slope < -0.5`, `st.slopeSE > 0`. Those pin a DIRECTION, and the slope's whole job is to name a
 * MAGNITUDE (§7: τ⁻¹ jitter · τ⁻¹ᐟ² benign · τ⁰ floor · τ⁺¹ drift). `< -0.5` cannot separate −0.6
 * from −1.0, so it cannot separate benign from jitter — the one distinction the number exists for.
 *
 * That is a CLASS, not an incident, and this tool finds the rest of it.
 *
 * ── ⚠️ MEASURED RESULT: THE MODEL STEP DOES NOT WORK FOR THIS TASK (2026-08-16) ─────────────────
 *
 * This tool is kept for its DETERMINISTIC half and as a record, so the ranking idea is not rebuilt
 * from scratch by someone who has not seen it fail. The model step is disabled by default.
 *
 * Two 15-minute pilots, ~10 minutes of GPU total. The mechanism is fine — 494 assertions judged in
 * 4m44s, resumable, ~1 s each; an overnight run would be affordable. The SIGNAL is not:
 *
 *   • IT FAILED THE POSITIVE CONTROL. Shown `st.slope < -0.5` — the exact assertion that let the
 *     entire least-squares body of `_ckAllanSlope` be deleted with the suite green — it answered
 *     BOUND: "slope is a computed regression coefficient, not a fixed value". The test feeds a
 *     PLANTED power law, where the slope is exactly known.
 *   • CONTEXT DID NOT RESCUE IT. Re-asked with the test setup spelled out AND the theoretical slope
 *     values supplied, it still answered BOUND, now reasoning that "numerical precision likely
 *     prevents pinning an exact theoretical value". The fit is exact on collinear input — that is
 *     how all five mutants were killed. So it is not a thin-prompt problem.
 *   • ITS THREE FLAGS WERE JUNK: `isNaN(...)` (already exact), an `indexOf(...) < 0` presence check,
 *     and `5 - 1.25 > 3`, a tautology over literals. That last one is the entire yield.
 *
 * 0 of 3 flags useful, and it missed the one case known to be weak.
 *
 * 🔴 THE FIRST PILOT'S POOR PRECISION WAS MINE, NOT THE MODEL'S, and that is the more useful half.
 * The pre-filter excluded `Math.abs\([^)]*[-+]`, and a character class cannot cross the inner paren
 * of `Math.abs(K.pearson(a, b) - 1)` — so 59 already-exact assertions reached the model, which
 * correctly reported "an exact value is derivable" for every one. 23 flags, almost all my bug. The
 * model was accurate about what it was shown; it was shown the wrong things.
 *
 * WHAT IS WORTH KEEPING: the deterministic inventory. 718 inequality assertions, of which 123 are
 * tolerances around a named target (already known answers) and 494 are bare bounds. That list is
 * useful without any model, and the positive control below fails loudly if the filter ever stops
 * surfacing the assertion we know was weak.
 *
 * The published answer to this question is CHECKED COVERAGE (Schuler & Zeller, ICST 2011 —
 * "Assessing Oracle Quality with Checked Coverage"): the percentage of executed statements that
 * influence an oracle, via a dynamic slice backwards from the assertion. One instrumented run
 * instead of one suite run per statement. That is the thing to build, and it needs no GPU.
 *
 * ── DIVISION OF LABOUR: THE MODEL RANKS, IT NEVER DECIDES ───────────────────────────────────────
 * A local model is asked ONE fuzzy question — "could this assertion pin an exact value?" — and its
 * answer is never a finding. It orders the queue. Every candidate is then confirmed by hand or by
 * mutation, and the test is the deliverable.
 *
 * ⚠️ THIS ORDERING IS THE ONLY SAFE PLACE FOR IT. Measured 2026-08-16: asked which constructs a
 * statement splitter would miss, the same model returned 10 suggestions — 6 category errors, 3
 * by-design exclusions, 1 real construct with ZERO occurrences here. Net yield: nothing. Counting
 * the constructs directly found 940. So the model is wrong often enough that its output must cost
 * nothing when wrong, and ordering is exactly that: a bad rank wastes review time and cannot enter
 * the suite.
 *
 * The DETERMINISTIC pre-filter does the work it is better at — a tolerance around a named target
 * (`rel(x, 4) < 0.2`, `Math.abs(sum - 1) < 1e-9`) is a known answer already and never reaches the
 * model.
 *
 *   node tools/assertion-strength.mjs --minutes 15
 *   node tools/assertion-strength.mjs --minutes 60 --resume     # escalation continues, not restarts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResumeLedger, fingerprint, fmtDuration, progressLine } from './run-progress.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = process.env.DEX_OLLAMA || 'http://localhost:11434';
const MODEL = process.env.DEX_MODEL || 'qwen3.8:27b';

/* An assertion worth asking about: a T.ok comparing something to a numeric literal, that is NOT
   already a tolerance around a target and NOT a type/presence check. */
export function extractCandidates(src) {
  const out = [];
  const lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/T\.ok\(/.test(l)) continue;
    if (!/[^<>=!]([<>]=?)\s*-?[0-9.]/.test(l)) continue;
    /* ⚠️ ANY `Math.abs(...)` IS A TOLERANCE AROUND SOMETHING, so the whole form is excluded
       rather than matched. The first version wrote `Math.abs\\([^)]*[-+]` and the character class
       cannot cross the INNER paren of `Math.abs(K.pearson(a, b) - 1)` — so every tolerance whose
       target is a CALL slipped through. Measured on the 15-min pilot: 59 already-exact assertions
       reached the model, which correctly reported "an exact value is derivable" for every one of
       them, and they dominated the 23 flagged candidates. The precision looked like a model failure
       and was a filter bug. */
    if (/\brel\s*\(|Math\.abs\s*\(/.test(l)) continue; // tolerance around a target
    if (/<\s*1e-\d/.test(l)) continue; // an epsilon bound IS exactness
    if (/===|!==/.test(l)) continue; // already an equality
    if (/typeof\s/.test(l)) continue; // type / presence
    out.push({ line: i + 1, text: l.trim() });
  }
  return out;
}

export function parseVerdicts(text, n) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*(\d+)\s*[:.)-]\s*(VALUE|BOUND|SKIP)\b\s*(.*)$/i);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (!(idx >= 0 && idx < n)) continue;
    out[idx] = { verdict: m[2].toUpperCase(), why: (m[3] || '').trim().slice(0, 120) };
  }
  return out;
}

async function ask(batch) {
  const numbered = batch.map((c, i) => `${i + 1}. ${c.text.slice(0, 170)}`).join('\n');
  const prompt =
    'Each line is a JavaScript test assertion that compares a computed value to a numeric bound.\n' +
    'For each, answer whether the property being asserted has an EXACT value derivable from theory ' +
    '(so the bound could be replaced by an equality), or whether a bound is genuinely all that can ' +
    'be said.\n\n' +
    'Answer format, one line each, nothing else:\n<number>: VALUE <short reason>   — an exact value is derivable\n' +
    '<number>: BOUND <short reason>   — a bound is all that is available\n' +
    '<number>: SKIP                   — not a numeric property assertion\n\n' +
    numbered;
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, think: false, prompt, options: { temperature: 0.1, num_predict: 700 } })
  });
  const j = await res.json();
  return parseVerdicts(j.response || '', batch.length);
}

const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('assertion-strength.mjs');
if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  const ex = extractCandidates(
    [
      "T.ok('slope', st.slope < -0.5, 'x');",
      "T.ok('tol', rel(r.sigma2, 4) < 0.2);",
      "T.ok('sum', Math.abs(w - 1) < 1e-9);",
      "T.ok('type', typeof q === 'number');",
      "T.ok('count', rec.sentinelRejected > 20);"
    ].join('\n')
  );
  ok(
    'a bare bound is a candidate',
    ex.some((c) => /slope/.test(c.text))
  );
  ok(
    'a bare count is a candidate',
    ex.some((c) => /sentinelRejected/.test(c.text))
  );
  ok('a tolerance around a TARGET is not — the target is the answer', !ex.some((c) => /rel\(/.test(c.text)));
  ok('an epsilon around a sum is not', !ex.some((c) => /Math\.abs/.test(c.text)));
  ok('a type check is not', !ex.some((c) => /typeof/.test(c.text)));
  /* 🔴 POSITIVE CONTROL. `st.slope < -0.5` is the assertion that let the ENTIRE least-squares body
     of _ckAllanSlope be deleted with the suite green. If the filter stops surfacing it, the filter
     has stopped working, and a candidate list that omits the one case we KNOW was weak is worth
     nothing. */
  const ctl = extractCandidates("T.ok('jitter', st.slope < -0.5, 'slope=' + st.slope);");
  ok('the KNOWN-weak Allan slope assertion is surfaced', ctl.length === 1, JSON.stringify(ctl));
  /* And the negative controls the pilot proved were needed — every one of these reached the model. */
  ok('a tolerance whose target is a CALL is excluded', extractCandidates("T.ok('p', Math.abs(K.pearson(a, b) - 1) < 1e-9);").length === 0);
  ok('an epsilon bound is excluded — it is already exact', extractCandidates("T.ok('recon', recon < 1e-9);").length === 0);
  ok('an equality to a literal is excluded', extractCandidates("T.ok('flag', r.corrected[20] === 1);").length === 0);
  const v = parseVerdicts('1: VALUE a power law slope is exactly m\n2: BOUND only a floor is known\n3: SKIP\nnoise line', 3);
  ok('verdicts parse by index', v[0].verdict === 'VALUE' && v[1].verdict === 'BOUND' && v[2].verdict === 'SKIP');
  ok('…and carry the reason', /power law/.test(v[0].why));
  ok('out-of-range indices are ignored', parseVerdicts('9: VALUE x', 2).length === 0);
  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  const opt = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const minutes = Number(opt('--minutes', '15')) || 15;
  const useModel = argv.includes('--model'); // OFF by default — see the measured result above
  const BATCH = Number(opt('--batch', '8')) || 8;
  const src = readFileSync(join(ROOT, 'tests/dex-tests.js'), 'utf8');
  const cands = extractCandidates(src);
  const fp = fingerprint({ tool: 'assertion-strength@1', model: MODEL, n: cands.length });
  const ledger = new ResumeLedger(argv.includes('--resume') ? join(ROOT, '.mutation-sweeps/assertion-strength.jsonl') : null, fp).load();
  if (ledger.stale) process.stderr.write('  ⚠ ledger describes different inputs — starting from zero\n');
  ledger.begin();
  const todo = cands.filter((c) => !ledger.has(c.line));
  process.stderr.write(`  ${cands.length} candidate assertion(s); ${ledger.size} already judged, ${todo.length} to go — budget ${minutes} min\n`);
  const t0 = Date.now();
  const deadline = t0 + minutes * 60000;
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() > deadline) {
      process.stderr.write(`  ⏱ budget reached — stopping cleanly with ${ledger.size} judged\n`);
      break;
    }
    const batch = todo.slice(i, i + BATCH);
    let verdicts = [];
    if (!useModel) {
      batch.forEach((c) => ledger.record(c.line, { line: c.line, text: c.text.slice(0, 190), verdict: 'UNJUDGED', why: 'inventory only — model step disabled' }));
      done += batch.length;
      continue;
    }
    try {
      verdicts = await ask(batch);
    } catch (e) {
      process.stderr.write('  ⚠ model call failed: ' + e.message + '\n');
      break;
    }
    batch.forEach((c, k) => {
      const v = verdicts[k] || { verdict: 'SKIP', why: 'no verdict returned' };
      ledger.record(c.line, { line: c.line, text: c.text.slice(0, 190), verdict: v.verdict, why: v.why });
    });
    done += batch.length;
    const el = (Date.now() - t0) / 1000;
    process.stderr.write(progressLine(ledger.size, cands.length, 1, el / Math.max(1, done), 'judged', el) + '\n');
  }
  const all = ledger.values();
  const value = all.filter((r) => r.verdict === 'VALUE');
  console.log(`\n▸ ASSERTION STRENGTH — ${all.length} judged of ${cands.length} in ${fmtDuration((Date.now() - t0) / 1000)}`);
  console.log(`  VALUE (an exact answer may be derivable): ${value.length}`);
  console.log(`  BOUND (a bound is all there is)         : ${all.filter((r) => r.verdict === 'BOUND').length}`);
  console.log(`  SKIP                                    : ${all.filter((r) => r.verdict === 'SKIP').length}`);
  console.log('\n  ⚠ THESE ARE RANKINGS, NOT FINDINGS. Each must be confirmed by writing the exact');
  console.log('    assertion and re-applying a mutant; the model is wrong often enough that its');
  console.log('    output may only ever decide REVIEW ORDER.\n');
  for (const r of value.slice(0, 25)) console.log(`  L${r.line}  ${r.why}\n      ${r.text.slice(0, 118)}`);
}
