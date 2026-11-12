// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/bus-conf-provenance.mjs — every published bus `conf` site, and whether a source stands above it

       node tools/bus-conf-provenance.mjs --base origin/main   # the gate: a site this branch ADDS
       node tools/bus-conf-provenance.mjs --census             # the measured sets, deciding nothing
       node tools/bus-conf-provenance.mjs --strict             # exit 1 over any tuned bare site (human)
       node tools/bus-conf-provenance.mjs --json               # the verdict object alone on stdout
       node tools/bus-conf-provenance.mjs --selftest

   THE DEFECT (row 2026-11-12-bus-confidence-constants-carry-no-source, found by Magpie at board
   #5736). Eleven sites decide a `conf` an export publishes, and no citation stands above any of
   them. Each number decides what a consumer trusts.

   WHY A JUDGE AND NOT THE ELEVEN COMMENTS. I measured the carriers of the five files that hold
   those sites: a comment above each number moves `manifestHash` on ten built pages, and a DSP edit
   moves `computeHash`, so five nodes then owe fixture re-verification. That declaration is its own
   unit (board #5969 splits the row). This half stops the class GROWING and names the population by
   identifier, so the next holder re-measures nothing.

   WHAT IT READS. Every root `*-dsp.js`, comment-blanked through `bareSource`, for each `conf:` in
   CODE. The value decides the class, and the four lines above decide provenance.

   THE KEY IS AN ANCHOR, NEVER A LINE. Magpie's parked note held four citations and three had
   rotted, because a citation rots when the code under it moves. So a site keys on the nearest
   `impulse` / `type` / `kind` name, else the nearest declaration above it, plus its own normalized
   value. The row says it in one line: cite the identifier, never the line.

   A ZERO OVER A WHOLE FILE SET IS A TELL, NOT A RESULT (Magpie, #5736). Their first pass read 0 of
   53 sites, because the pattern wanted a bare literal and the real sites are clamped expressions.
   So a selftest leg runs this census over the REAL tree and refuses a zero.

   THE CRITERION JUDGES WHAT A BRANCH ADDS, AND NOTHING ELSE. The history already holds bare sites,
   and a whole-tree gate would red forever over work nobody has done. A baseline FILE is the shape
   the owner banned on 2026-11-07, because a shared append-only path puts every open PR in conflict.
   So the gate reads the base ref's own copy, which needs no file and no author's write.

   DEGENERATE VALUES ARE REPORTED AND NEVER JUDGED. `conf: 0` and `conf: 1` are bounds rather than
   tuned numbers — `motiondex-dsp.js` answers `conf: 0` for a window it never scored, which is the
   §∅ shape and not this defect. They count in `bare`, they stay out of `bareTuned`, and the
   criterion reads the tuned set.

   PRECISION IS NOT A CONSTANT. `+conf.toFixed(2)` and `Math.round(c * 100) / 100` publish a derived
   number, and the 2 and the 100 set decimal places. `stripPrecision` removes those two idioms before
   the class is read, which is what makes this census agree with Magpie's own count at #5736.

   PERMISSIVE BY CHOICE. The provenance markers are a short declared set, so a loose comment that
   merely says "source" counts as provenance. That misses a site rather than reding an honest one,
   and a false red on an append-time gate costs an author a round trip for nothing.

   A NOT_RUN CARRIES NO RESULT. The contract refuses one, because a run that examined nothing measured
   nothing. So a census that reaches no site reports the file count in its prose and nothing in `result`.

   ABSENCE IS NULL (§∅). A file this tool cannot read is `unreadable` with a reason, never a file
   with zero sites; it leaves `eligible` and the verdict says so.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { bareSource } from './verdict-adoption.mjs';
import { judgeRootOrDie } from './write-root.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const SELF = 'tools/bus-conf-provenance.mjs';
const GATE = 'bus-conf-provenance';

/** A comment line above a site counts as provenance when it matches one of these. Declared, short. */
export const PROVENANCE_MARKERS = [/PROVENANCE/, /SOURCE/i, /\bDOI\b/i, /\bdoi:/i, /\bet al\b/i, /CLAIM /];
/** How many lines above a site this tool reads. Magpie's filter used four, so the sets compare. */
export const LOOKBACK = 4;
/** The classes a site falls in. `literal` is the only one the criterion can judge. */
export const CLASSES = ['literal', 'named', 'dynamic'];

// ── PURE ─────────────────────────────────────────────────────────────────────────────────────────

/** The value expression that follows one `conf:` — to the comma at depth 0, or the line's end. PURE. */
export function valueAfter(line, from) {
  let depth = 0;
  let out = '';
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/**
 * A value with its PRECISION numbers removed. PURE.
 * `+conf.toFixed(2)` and `Math.round(c * 100) / 100` carry numbers that set decimal places and
 * decide no confidence, so they must not read as tuned. Two declared idioms: a `toFixed` argument,
 * and a multiply then divide by the same power of ten. The result can hold an unbalanced bracket,
 * which costs nothing: only the numbers in it are read.
 */
export function stripPrecision(value) {
  return value
    .replace(/\.toFixed\(\s*\d+\s*\)/g, '')
    .replace(/\*\s*(\d+)\s*\)?\s*\/\s*(\d+)/g, (m, a, b) => (a === b && /^10+$/.test(a) ? '' : m))
    .trim();
}

/** Does this value hold a tuned number, a name, or neither? PURE. */
export function classifyValue(raw) {
  const value = stripPrecision(raw);
  const nums = value.match(/(?:^|[^\w.$])(\d+(?:\.\d+)?|\.\d+)/g);
  if (nums && nums.length) {
    const bare = nums.map((s) => s.replace(/[^\d.]/g, ''));
    const degenerate = bare.every((s) => s === '0' || s === '1' || s === '0.0' || s === '1.0');
    return { class: 'literal', degenerate };
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return { class: 'named', degenerate: false };
  return { class: 'dynamic', degenerate: false };
}

/** Is a marker in this RAW line inside a comment? It is, when blanking the line removes it. PURE. */
export function markerIsComment(rawLine, bareLine) {
  const hit = PROVENANCE_MARKERS.find((re) => re.test(rawLine));
  if (!hit) return false;
  return !hit.test(bareLine);
}

/** The anchor a site keys on: the nearest named impulse, else the nearest declaration above. PURE. */
export function anchorFor(bareLines, idx) {
  for (let i = idx; i >= 0 && i > idx - 12; i--) {
    const m = bareLines[i].match(/\b(?:impulse|type|kind)\s*:\s*'([^']+)'/);
    if (m) return m[1];
  }
  for (let i = idx; i >= 0; i--) {
    const m = bareLines[i].match(/\b(?:function|const|let)\s+([A-Za-z_$][\w$]*)/);
    if (m) return m[1];
  }
  return 'top-level';
}

/**
 * Every `conf:` site in one file, as rows. PURE — the caller supplies the text.
 * `text == null` answers one `unreadable` row with a reason, never an empty set (§∅).
 */
export function censusText(file, text) {
  if (text == null) return [{ file, key: `${file}#unreadable`, class: null, provenance: null, why: 'the file could not be read, so no site in it was examined' }];
  const raw = text.split('\n');
  const bareLines = bareSource(text, false).split('\n');
  const rows = [];
  for (let i = 0; i < raw.length; i++) {
    const rawHits = (raw[i].match(/\bconf\s*:/g) || []).length;
    const bare = bareLines[i] ?? '';
    const codeHits = [...bare.matchAll(/\bconf\s*:/g)];
    for (let k = 0; k < rawHits - codeHits.length; k++)
      rows.push({ file, key: `${file}#comment:${i}:${k}`, class: 'comment', provenance: null, why: 'the site sits in a comment, so it publishes nothing' });
    for (const m of codeHits) {
      const value = valueAfter(bare, m.index + m[0].length);
      const { class: cls, degenerate } = classifyValue(value);
      let provenance = false;
      for (let j = i - 1; j >= 0 && j >= i - LOOKBACK; j--) if (markerIsComment(raw[j] ?? '', bareLines[j] ?? '')) provenance = true;
      rows.push({ file, key: `${file}#${anchorFor(bareLines, i)}:${value.replace(/\s+/g, '')}`, class: cls, degenerate, provenance, value, anchor: anchorFor(bareLines, i), line: i + 1 });
    }
  }
  return rows;
}

/** The population arithmetic over a census, plus the sets the verdict names. PURE. */
export function tally(rows) {
  const code = rows.filter((r) => r.class && r.class !== 'comment');
  const literal = code.filter((r) => r.class === 'literal');
  const tuned = literal.filter((r) => !r.degenerate);
  return {
    eligible: rows.length,
    comments: rows.filter((r) => r.class === 'comment').length,
    unreadable: rows.filter((r) => r.class === null).length,
    code: code.length,
    literal: literal.length,
    named: code.filter((r) => r.class === 'named').length,
    dynamic: code.filter((r) => r.class === 'dynamic').length,
    tuned: tuned.length,
    bare: literal.filter((r) => !r.provenance).length,
    bareTuned: tuned.filter((r) => !r.provenance),
    cited: literal.filter((r) => r.provenance).length
  };
}

/**
 * ONE `tepna.verdict/1` over the census. PURE.
 * Order: NOT_RUN (it examined nothing) → SHORTFALL (no base, so addition is unjudged) → FAIL
 * (a branch added a tuned bare site) → PASS.
 */
export function provenanceVerdict(headRows, baseKeys, { base = null, commit = null, at = null, files = 0 } = {}) {
  const t = headRows == null ? null : tally(headRows);
  const historical = t ? t.bareTuned.map((r) => `${r.file}#${r.anchor} = ${r.value}`) : [];
  const added = t && baseKeys ? t.bareTuned.filter((r) => !baseKeys.has(r.key)) : [];
  const result = {
    files,
    sites: t ? t.eligible : null,
    commentSites: t ? t.comments : null,
    unreadableFiles: t ? t.unreadable : null,
    codeSites: t ? t.code : null,
    literal: t ? t.literal : null,
    named: t ? t.named : null,
    dynamic: t ? t.dynamic : null,
    tuned: t ? t.tuned : null,
    cited: t ? t.cited : null,
    bare: t ? t.bare : null,
    bareTuned: t ? t.bareTuned.length : null,
    addedBareTuned: baseKeys ? added.length : null,
    added: added.map((r) => `${r.file}#${r.anchor} = ${r.value}`),
    historical,
    base
  };
  const base_ = {
    schema: 'tepna.verdict/1',
    gate: GATE,
    scope: 'internal',
    criterion: { name: 'added_bus_conf_sites_without_provenance', threshold: 0, unit: 'sites', direction: 'lte' },
    evidence: [SELF, 'every root *-dsp.js, comment-blanked, plus the same files at the base ref'],
    producedBy: { tool: SELF, ...(commit ? { commit } : { commit: null, commitReason: 'git could not name HEAD in the judged checkout, so this verdict names no commit' }), host: null },
    at: at || new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };
  if (t == null || t.code === 0)
    return {
      ...base_,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: t ? t.eligible : 0, excluded: t ? t.eligible : 0 },
      result: null,
      reason: 'no `conf:` site in any root *-dsp.js was read, so this gate examined nothing'
    };
  const population = { checked: t.tuned, eligible: t.eligible, excluded: t.eligible - t.tuned };
  if (!baseKeys)
    return {
      ...base_,
      status: 'SHORTFALL',
      population,
      result,
      reason: `the base ref ${base || '(none given)'} could not be read, so no site could be judged as ADDED; the census above still stands`
    };
  if (added.length) return { ...base_, status: 'FAIL', population, result, reason: `${added.length} tuned bus conf site(s) this branch adds carry no provenance line in the ${LOOKBACK} lines above` };
  return { ...base_, status: 'PASS', population, result, reason: null };
}

// ── IMPURE ───────────────────────────────────────────────────────────────────────────────────────

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** The root `*-dsp.js` files of one checkout, sorted. */
export function dspFiles(root) {
  return readdirSync(root)
    .filter((f) => /-dsp\.js$/.test(f))
    .sort();
}

/** One file's text, or `null` when it cannot be read — never an empty string standing in for absence. */
function textOf(root, file) {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return null;
  }
}

/** The same file at a ref, or `null`. A ref that does not resolve answers `null` for every file. */
function textAtRef(root, ref, file) {
  try {
    return git(root, ['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function refResolves(root, ref) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function headCommit(root) {
  try {
    return git(root, ['rev-parse', '--short=9', 'HEAD']).trim();
  } catch {
    return null;
  }
}

/** The census over one checkout. */
export function surveyCheckout(root) {
  const files = dspFiles(root);
  return { files, rows: files.flatMap((f) => censusText(f, textOf(root, f))) };
}

/** Every key the base ref's own copies hold, or `null` when the ref does not resolve. */
export function baseKeysAt(root, ref, files) {
  if (!refResolves(root, ref)) return null;
  const keys = new Set();
  for (const f of files) {
    const text = textAtRef(root, ref, f);
    if (text == null) continue;
    for (const r of censusText(f, text)) keys.add(r.key);
  }
  return keys;
}

// ── SELFTEST ─────────────────────────────────────────────────────────────────────────────────────

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (msg, cond) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  ✗ ${msg}`);
    }
  };
  const V = Verdict;

  // the value scanner
  // precision is not a tuned number
  ok('a toFixed argument is precision, not a constant', stripPrecision('+conf.toFixed(2)') === '+conf');
  ok('a round-to-two-places idiom is precision', stripPrecision('Math.round(conf * 100) / 100') === 'Math.round(conf');
  ok('a clamp keeps its own constants through the strip', stripPrecision('+Math.min(0.97, conf + 0.1).toFixed(2)') === '+Math.min(0.97, conf + 0.1)');
  ok('a divide that is no rounding pair stays', stripPrecision('(20 - r.rmssd) / 20') === '(20 - r.rmssd) / 20');
  ok('a rounded derived value is dynamic, never tuned', classifyValue('+conf.toFixed(2)').class === 'dynamic');
  ok('a rounded SQI is dynamic too', classifyValue('Math.round(conf * 100) / 100').class === 'dynamic');

  ok('a plain literal reads to the comma', valueAfter('x = { conf: 0.7, sqi: null }', 'x = { conf:'.length) === '0.7');
  ok('a clamped expression keeps its parentheses', valueAfter('{ conf: +Math.min(0.97, c + 0.1).toFixed(2), meta: {} }', '{ conf:'.length) === '+Math.min(0.97, c + 0.1).toFixed(2)');
  ok('a ternary over a bound reads whole', valueAfter("push({ snrDb: 3, conf: snrDb >= 3 ? 'high' : 'low' })", 'push({ snrDb: 3, conf:'.length) === "snrDb >= 3 ? 'high' : 'low'");
  ok('a closing brace ends the value', valueAfter('{ conf: 0.55 }', '{ conf:'.length) === '0.55');

  // the classifier
  ok('a tuned number is literal and not degenerate', classifyValue('0.7').class === 'literal' && classifyValue('0.7').degenerate === false);
  ok('a clamp is literal through its numbers', classifyValue('+Math.min(0.97, c + 0.1).toFixed(2)').class === 'literal');
  ok('a dB cut inside a ternary is literal', classifyValue("snrDb >= 3 ? 'high' : 'low'").class === 'literal');
  ok('zero is literal and DEGENERATE', classifyValue('0').class === 'literal' && classifyValue('0').degenerate === true);
  ok('one is degenerate too', classifyValue('1').degenerate === true);
  ok('a screaming-snake name is named', classifyValue('EC_STAGE_CONF').class === 'named');
  ok('a plain variable is dynamic', classifyValue('sqiConf').class === 'dynamic');
  ok('a property read is dynamic', classifyValue('r.conf').class === 'dynamic');

  // the comment test
  ok('a marker inside a comment reads as a comment', markerIsComment('// PROVENANCE: chosen in #1', '') === true);
  ok('a marker on a code line is no provenance', markerIsComment("const s = 'SOURCE';", "const s = 'SOURCE';") === false);
  ok('a line with no marker is no provenance', markerIsComment('// nothing here', '') === false);

  // the census
  const plain = ['const ev = [];', "ev.push({ impulse: 'hrv_low', node: 'HRVDex', conf: 0.4 });"].join('\n');
  const rowsPlain = censusText('hrvdex-dsp.js', plain);
  ok('one code site is one row', rowsPlain.length === 1);
  ok('the row keys on the impulse name, not the line', rowsPlain[0].key === 'hrvdex-dsp.js#hrv_low:0.4');
  ok('the row reads bare', rowsPlain[0].provenance === false);
  const cited = ['/* PROVENANCE: the tier is heuristic and no paper sets it. */', "ev.push({ impulse: 'hrv_low', conf: 0.4 });"].join('\n');
  ok('a marker one line above is provenance', censusText('hrvdex-dsp.js', cited)[0].provenance === true);
  const far = ['// PROVENANCE: too far above', '', '', '', '', "ev.push({ impulse: 'hrv_low', conf: 0.4 });"].join('\n');
  ok('a marker beyond the lookback is not provenance', censusText('hrvdex-dsp.js', far)[0].provenance === false);
  const commented = ['/* the `conf: 0` this window never scored */', "ev.push({ impulse: 'x', conf: 0.5 });"].join('\n');
  const rowsC = censusText('ppgdex-dsp.js', commented);
  ok('a commented site is counted and excluded', rowsC.filter((r) => r.class === 'comment').length === 1);
  ok('the code site beside it still reads', rowsC.filter((r) => r.class === 'literal').length === 1);
  ok(
    'two sites under one anchor key apart by value',
    censusText('f-dsp.js', ["ev.push({ impulse: 'a', conf: 0.4 });", "ev.push({ impulse: 'a', conf: 0.9 });"].join('\n'))
      .map((r) => r.key)
      .join('|') === 'f-dsp.js#a:0.4|f-dsp.js#a:0.9'
  );
  ok('a site with no impulse keys on the declaration above', censusText('f-dsp.js', ['function fuse() {', '  return { conf: 0.6 };'].join('\n'))[0].anchor === 'fuse');

  // §∅ — an unreadable file is null, never zero sites
  const un = censusText('gone-dsp.js', null);
  ok('an unreadable file answers one row', un.length === 1);
  ok('its class is null, never a count', un[0].class === null && un[0].provenance === null);
  ok('it carries a reason', typeof un[0].why === 'string' && un[0].why.length > 10);

  // the verdict
  const headRows = censusText('hrvdex-dsp.js', plain);
  const vAdded = provenanceVerdict(headRows, new Set(), { base: 'origin/main', commit: 'abc123def', at: '2026-11-12T19:00:00Z', files: 1 });
  ok('a tuned bare site a branch adds FAILS', vAdded.status === 'FAIL');
  ok('the FAIL names the site by anchor', vAdded.result.added[0] === 'hrvdex-dsp.js#hrv_low = 0.4');
  ok('the FAIL validates', V.validate(vAdded).ok);
  const vHeld = provenanceVerdict(headRows, new Set(headRows.map((r) => r.key)), { base: 'origin/main', commit: 'abc123def', at: '2026-11-12T19:00:00Z', files: 1 });
  ok('a bare site the base already holds PASSES', vHeld.status === 'PASS');
  ok('a PASS carries no reason', vHeld.reason === null);
  ok('the PASS still names the history', vHeld.result.historical.length === 1);
  ok('the PASS validates', V.validate(vHeld).ok);
  const vNoBase = provenanceVerdict(headRows, null, { base: 'nosuchref', commit: 'abc123def', at: '2026-11-12T19:00:00Z', files: 1 });
  ok('an unreadable base is SHORTFALL, never a PASS', vNoBase.status === 'SHORTFALL');
  ok('the SHORTFALL names the ref it could not read', /nosuchref/.test(vNoBase.reason));
  ok('the SHORTFALL validates', V.validate(vNoBase).ok);
  const vNone = provenanceVerdict([], new Set(), { base: 'origin/main', commit: 'abc123def', at: '2026-11-12T19:00:00Z', files: 0 });
  ok('an empty census examines nothing', vNone.status === 'NOT_RUN');
  ok('the NOT_RUN validates', V.validate(vNone).ok);
  ok('the NOT_RUN carries a null result, because it measured nothing', vNone.result === null);
  const vNull = provenanceVerdict(null, new Set(), { at: '2026-11-12T19:00:00Z' });
  ok('a null census examines nothing', vNull.status === 'NOT_RUN');
  ok('the null census validates too', V.validate(vNull).ok);
  ok('an unknown commit says WHY it is null, never drops the field', vNull.producedBy.commit === null && typeof vNull.producedBy.commitReason === 'string');
  ok('a known commit carries no reason', vHeld.producedBy.commit === 'abc123def' && !('commitReason' in vHeld.producedBy));
  const degen = censusText('motiondex-dsp.js', ["if (!rows) return { conf: 0, flags: ['no-data'] };"].join('\n'));
  const vDeg = provenanceVerdict(degen, new Set(), { base: 'origin/main', commit: 'abc123def', at: '2026-11-12T19:00:00Z', files: 1 });
  ok('a degenerate bound a branch adds does not FAIL', vDeg.status === 'PASS');
  ok('the degenerate site is still reported', vDeg.result.bare === 1 && vDeg.result.bareTuned === 0);
  for (const v of [vAdded, vHeld, vNoBase, vNone, vNull, vDeg]) ok(`${v.status} keeps the population arithmetic`, v.population.checked + v.population.excluded === v.population.eligible);

  // THE ANTI-VACUITY CONTROL — a zero over a whole file set is a tell, not a result (#5736)
  let real = null;
  try {
    real = surveyCheckout(join(import.meta.dirname, '..'));
  } catch {
    real = null;
  }
  if (real) {
    const t = tally(real.rows);
    ok('the census reaches the real tree: nine or more dsp files', real.files.length >= 9);
    ok('the real tree holds code sites, so the pattern is not vacuous', t.code >= 20);
    ok('the real tree holds tuned sites, which is the defect class', t.tuned >= 8);
    ok(
      'every real row carries a key',
      real.rows.every((r) => typeof r.key === 'string' && r.key.includes('#'))
    );
  } else {
    ok('the real-tree control could not read the checkout, and says so', false);
  }

  console.log(`${SELF} selftest: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--census', '--strict', '--selftest', '--verdict-sample'], valued: ['--base'] }, { tool: 'bus-conf-provenance.mjs' });
  if (argv.includes('--selftest')) process.exit(selftest());

  if (argv.includes('--verdict-sample')) {
    const rows = censusText('hrvdex-dsp.js', ["ev.push({ impulse: 'hrv_low', conf: 0.4 });"].join('\n'));
    const v = provenanceVerdict(rows, new Set(rows.map((r) => r.key)), { base: 'origin/main', commit: null, at: '2026-11-12T19:00:00Z', files: 1 });
    console.log(JSON.stringify(v));
    process.exit(0);
  }

  const root = judgeRootOrDie(import.meta.url);
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
  const { files, rows } = surveyCheckout(root);
  const keys = base ? baseKeysAt(root, base, files) : null;
  const v = provenanceVerdict(rows, keys, { base, commit: headCommit(root), files: files.length });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(v));
  } else if (v.result === null) {
    console.log(`▸ ${GATE} — ${files.length} dsp file(s), and it examined no site`);
    console.log(`  ${v.status}: ${v.reason}`);
    console.log(JSON.stringify(v));
  } else {
    console.log(`▸ ${GATE} — ${files.length} dsp file(s), ${v.result.sites} \`conf:\` site(s), ${v.result.tuned} tuned`);
    console.log(`  cited ${v.result.cited} · bare ${v.result.bare} (tuned ${v.result.bareTuned}) · named ${v.result.named} · dynamic ${v.result.dynamic} · in a comment ${v.result.commentSites}`);
    if (v.result.added.length) for (const s of v.result.added) console.log(`  ✕ ADDED with no provenance: ${s}`);
    if (argv.includes('--census')) for (const s of v.result.historical) console.log(`    · ${s}`);
    console.log(`  ${v.status}: ${v.reason || 'this branch adds no tuned bus conf site without provenance'}`);
    console.log(JSON.stringify(v));
  }
  if (v.status === 'NOT_RUN') process.exit(2);
  if (v.status === 'FAIL') process.exit(1);
  if (argv.includes('--strict') && v.result.bareTuned > 0) process.exit(1);
  process.exit(0);
}

if (isCliEntry(import.meta.url)) main();
