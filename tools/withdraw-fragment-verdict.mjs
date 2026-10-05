/*
 * tools/withdraw-fragment-verdict.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ── WITHDRAW A VERDICT THAT JUDGED A FRAGMENT, WITH ITS REASON RECORDED ─────────────────────────
 *
 * NIGHT-IS-THE-RECORDING-2026-10-05 §⑥. One recording can land in two night folders — the
 * 2026-10-04 donning continued into 2026-10-05 after a 21-minute outage — and the judge then
 * emits a verdict per FOLDER. The later folder holds only the reconnect tail, so its verdict
 * judges a fragment: 2026-10-05's QC reported `missing stream(s): Wellue O2Ring-S:spo2` for a
 * night on which the ring ran from 22:00 to 04:39.
 *
 * ── NOTHING IS DELETED; THE WITHDRAWAL IS A RECORD ───────────────────────────────────────
 * A verdict written over a fragment is not a verdict on the recording — but removing it would
 * repeat the defect that brief §②(b) names, where six pre-recording verdicts were overwritten
 * and the trail survived only in the journal. So this writes a SIBLING
 * `<NAME>-VERDICT.withdrawn.json` carrying the original object verbatim, the reason, the
 * recording it actually belonged to, and who withdrew it. The original file is left alone:
 * a reader that knows about withdrawals finds the record, and one that does not still sees
 * what it saw before rather than an absence it cannot explain.
 *
 * ── DRY-RUN IS THE DEFAULT ───────────────────────────────────────────────────────────────
 * `--apply` is required to write anything. The box run is OWNER-AUTHORIZED; this is built to
 * be run first on the rig's corpus copy, which is why `--root` exists and has no default.
 *
 * ⚠️ IT REFUSES RATHER THAN GUESSES WHICH FOLDER IS THE FRAGMENT. The caller names the
 * recording's FIRST folder and the fragment folder explicitly. Inferring them would mean
 * re-deriving the recording-grouping rule that is Magpie's lane (`night_band`, clipped
 * chains), and two implementations of one definition is how they drift apart.
 *
 *   node tools/withdraw-fragment-verdict.mjs --root <captures> --keep 2026-10-04 \
 *        --fragment 2026-10-05 [--apply] [--json] [--selftest]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeVerdict } from './verdict-emit.mjs';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';

const TOOL = 'tools/withdraw-fragment-verdict.mjs';

/* A verdict file is `*-VERDICT.json`; a withdrawal record is `*-VERDICT.withdrawn.json`, which is
   NOT itself a verdict file and must never be picked up as one (it would then be withdrawable). */
export function verdictFiles(dir, ls = readdirSync) {
  let names;
  try {
    names = ls(dir);
  } catch {
    return null; // the folder is absent — the caller distinguishes that from "no verdicts in it"
  }
  return names.filter((n) => /-VERDICT\.json$/.test(n)).sort();
}

/* The withdrawal record. The original object travels INSIDE it verbatim: a withdrawal that
   summarised what it withdrew would be a second claim about the night, and the point is to keep
   exactly one. */
export function withdrawalRecord(original, { fragmentNight, keepNight, reason, at, tool = TOOL }) {
  return {
    schema: 'tepna.verdict-withdrawal/1',
    withdrawn: original,
    night: fragmentNight,
    belongs_to: keepNight,
    reason,
    withdrawn_by: tool,
    at: at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  };
}

export function plan(root, keepNight, fragmentNight, { read = readFileSync, ls = readdirSync, exists = existsSync } = {}) {
  const fragDir = join(root, fragmentNight);
  const keepDir = join(root, keepNight);
  if (!exists(keepDir)) return { ok: false, reason: `the recording's first folder ${keepNight} does not exist under ${root} — nothing to belong to` };
  const names = verdictFiles(fragDir, ls);
  if (names === null) return { ok: false, reason: `the fragment folder ${fragmentNight} does not exist under ${root}` };
  if (!names.length) return { ok: false, reason: `${fragmentNight} holds no *-VERDICT.json — nothing to withdraw, which is not a failure` };
  const items = [];
  for (const n of names) {
    const p = join(fragDir, n);
    if (exists(p.replace(/\.json$/, '.withdrawn.json')))
      // ALREADY WITHDRAWN: idempotent by record, not by a flag we keep ourselves.
      items.push({ file: n, skip: 'already withdrawn — a record exists beside it' });
    else {
      let obj = null;
      try {
        obj = JSON.parse(read(p, 'utf8'));
      } catch (e) {
        // ⚠️ UNREADABLE IS NOT WITHDRAWABLE. Writing a record whose `withdrawn` field we could not
        // read would publish a withdrawal of something unknown — §∅, and worse than leaving it.
        items.push({ file: n, skip: `unreadable (${(e && e.message) || e}) — refused rather than withdrawn with an empty body` });
        obj = null;
      }
      if (obj) items.push({ file: n, status: obj.status ?? null, gate: obj.gate ?? null, at: obj.at ?? null });
    }
  }
  return { ok: true, fragDir, keepDir, items };
}

export function run(argv, io = {}) {
  const read = io.read || readFileSync;
  const write = io.write || writeFileSync;
  const ls = io.ls || readdirSync;
  const exists = io.exists || existsSync;
  const root = valued(argv, '--root');
  const keepNight = valued(argv, '--keep');
  const fragmentNight = valued(argv, '--fragment');
  const apply = argv.includes('--apply');
  if (!root || !keepNight || !fragmentNight) return { ok: false, reason: '--root, --keep and --fragment are all required; the fragment folder is never inferred (see the header)' };
  const p = plan(root, keepNight, fragmentNight, { read, ls, exists });
  if (!p.ok) return p;
  const reason =
    `this verdict judged a FRAGMENT of one recording: the recording began in ${keepNight} and continued into ` +
    `${fragmentNight}, so a verdict scoped to ${fragmentNight} alone describes its reconnect tail and not the ` +
    `night. Withdrawn per NIGHT-IS-THE-RECORDING-2026-10-05 §⑥; the recording is judged once, in ${keepNight}.`;
  const written = [];
  for (const it of p.items) {
    if (it.skip) continue;
    const src = join(p.fragDir, it.file);
    const dst = src.replace(/\.json$/, '.withdrawn.json');
    const rec = withdrawalRecord(JSON.parse(read(src, 'utf8')), { fragmentNight, keepNight, reason, at: io.at });
    if (apply) write(dst, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    written.push({ file: it.file, record: dst.replace(`${root}/`, ''), status: it.status, applied: apply });
  }
  const skipped = p.items.filter((i) => i.skip);
  return {
    ok: true,
    apply,
    written,
    skipped,
    verdict: makeVerdict({
      gate: 'fragment-verdict-withdrawal',
      /* ⚠️ A DRY RUN IS `NOT_RUN` WITH `result: null`, AND THE SCHEMA TAUGHT ME THE SECOND HALF.
         My first version reported the would-write list inside a NOT_RUN result and `verdict-emit`
         refused it: "NOT_RUN must carry result: null — nothing was examined, so nothing was
         measured". It is right, and the fix is not cosmetic: the WITHDRAWAL is what this gate
         measures, and a dry run does not attempt it. So the population is `checked: 0` with every
         candidate EXCLUDED by the dry run itself, the result is null, and the list of what would be
         written goes to stdout as prose — where a reader can act on it — rather than into an object
         that claims to have measured something. PASS stays for a criterion that was actually met. */
      status: apply ? (written.length ? 'PASS' : 'NOT_APPLICABLE') : 'NOT_RUN',
      population: apply ? { checked: written.length, eligible: p.items.length, excluded: skipped.length } : { checked: 0, eligible: p.items.length, excluded: p.items.length },
      criterion: { name: 'fragment_verdicts_withdrawn_with_a_reason', threshold: 0, unit: 'verdicts left unrecorded', direction: 'eq' },
      /* …and the same rule binds NOT_APPLICABLE: "the criterion does not bind, so no result exists".
         A second --apply over an already-withdrawn folder measures nothing either, so only the PASS
         case carries a result. The schema is stricter than I assumed TWICE here, both times in the
         same direction: a status that did not measure may not report. */
      result: apply && written.length ? { written: written.map((w) => w.file), skipped: skipped.map((s) => `${s.file}: ${s.skip}`) } : null,
      evidence: [TOOL, `${fragmentNight}/`],
      reason: apply ? (written.length ? null : 'every verdict in the fragment folder was already withdrawn or unreadable') : 'dry run — pass --apply to write the records',
      tool: TOOL
    })
  };
}

function valued(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const eq = (what, got, want) => {
    ran++;
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) fail.push(`${what}\n      got  ${g}\n      want ${w}`);
  };
  const FILES = {
    '/c/2026-10-05/QC-VERDICT.json': '{"gate":"night-qc","status":"SHORTFALL","at":"2026-10-05T09:01:52Z"}',
    '/c/2026-10-05/BACKCHECK-VERDICT.json': '{"gate":"backcheck","status":"UNKNOWN","at":"2026-10-05T09:01:52Z"}'
  };
  const wrote = {};
  const io = {
    read: (p) => {
      if (FILES[p] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return FILES[p];
    },
    write: (p, t) => {
      wrote[p] = t;
    },
    ls: (d) => {
      const pre = `${d}/`;
      const out = Object.keys({ ...FILES, ...wrote })
        .filter((k) => k.startsWith(pre))
        .map((k) => k.slice(pre.length));
      if (!out.length && d !== '/c/2026-10-04') throw new Error('ENOENT');
      return out;
    },
    exists: (p) => FILES[p] !== undefined || wrote[p] !== undefined || p === '/c/2026-10-04',
    at: '2026-10-05T12:00:00Z'
  };
  /* 1 · a DRY RUN writes nothing and says NOT_RUN — not PASS over an untouched folder */
  const dry = run(['--root', '/c', '--keep', '2026-10-04', '--fragment', '2026-10-05'], io);
  eq(
    'a dry run names both verdicts',
    dry.written.map((w) => w.file),
    ['BACKCHECK-VERDICT.json', 'QC-VERDICT.json']
  );
  eq('…writes nothing', Object.keys(wrote).length, 0);
  eq('…and is NOT_RUN, because looking met no criterion', dry.verdict.status, 'NOT_RUN');
  /* The schema's own rule, which my first version broke: NOT_RUN carries result null and checks
     nothing, so the would-write list belongs on stdout and not in the object. */
  eq('…with result null and nothing checked, per the verdict contract', [dry.verdict.result, dry.verdict.population], [null, { checked: 0, eligible: 2, excluded: 2 }]);
  eq('…while the would-write list still reaches the CALLER', dry.written.length, 2);
  /* 2 · --apply writes one record per verdict, carrying the ORIGINAL verbatim */
  const ap = run(['--root', '/c', '--keep', '2026-10-04', '--fragment', '2026-10-05', '--apply'], io);
  eq('--apply is PASS over what it wrote', [ap.verdict.status, ap.verdict.population], ['PASS', { checked: 2, eligible: 2, excluded: 0 }]);
  eq('…one record per verdict', Object.keys(wrote).sort(), ['/c/2026-10-05/BACKCHECK-VERDICT.withdrawn.json', '/c/2026-10-05/QC-VERDICT.withdrawn.json']);
  const rec = JSON.parse(wrote['/c/2026-10-05/QC-VERDICT.withdrawn.json']);
  eq('…the original travels inside it VERBATIM, not summarised', rec.withdrawn, { gate: 'night-qc', status: 'SHORTFALL', at: '2026-10-05T09:01:52Z' });
  eq('…and it names the recording it belonged to', [rec.night, rec.belongs_to], ['2026-10-05', '2026-10-04']);
  eq('…with a reason a reader can act on', /judged a FRAGMENT/.test(rec.reason) && /judged once, in 2026-10-04/.test(rec.reason), true);
  /* 3 · NOTHING IS DELETED — the original is still readable after the apply */
  eq('the original verdict is untouched', JSON.parse(io.read('/c/2026-10-05/QC-VERDICT.json')).status, 'SHORTFALL');
  /* 4 · IDEMPOTENT BY RECORD: a second apply skips what it already withdrew */
  const again = run(['--root', '/c', '--keep', '2026-10-04', '--fragment', '2026-10-05', '--apply'], io);
  eq('a second run withdraws nothing again', again.written.length, 0);
  eq('…skipping both, by the record beside them', again.skipped.length, 2);
  eq('…and reporting NOT_APPLICABLE rather than PASS over zero', again.verdict.status, 'NOT_APPLICABLE');
  eq('…which also carries result null, because it measured nothing', again.verdict.result, null);
  eq(
    '…while the SKIP reasons still reach the caller',
    again.skipped.map((s) => s.skip),
    ['already withdrawn — a record exists beside it', 'already withdrawn — a record exists beside it']
  );
  /* 5 · THE REFUSALS, each naming what it saw */
  eq('a missing fragment folder refuses', run(['--root', '/c', '--keep', '2026-10-04', '--fragment', '2026-10-09'], io).reason, 'the fragment folder 2026-10-09 does not exist under /c');
  eq(
    'a missing FIRST folder refuses — there is nothing for the fragment to belong to',
    run(['--root', '/c', '--keep', '2026-09-01', '--fragment', '2026-10-05'], io).reason,
    "the recording's first folder 2026-09-01 does not exist under /c — nothing to belong to"
  );
  eq('an incomplete invocation refuses rather than inferring the fragment', /never inferred/.test(run(['--root', '/c'], io).reason), true);
  /* 6 · the ADOPTION sample is a real object and reads nothing — the manifest's cmd depends on it */
  const vs = verdictSample();
  eq('the verdict sample is a tepna.verdict/1 for this gate', [vs.schema, vs.gate], ['tepna.verdict/1', 'fragment-verdict-withdrawal']);
  eq('…and is a dry run, so it claims nothing it did not do', [vs.status, vs.result], ['NOT_RUN', null]);

  if (fail.length) {
    console.error(`✗ withdraw-fragment-verdict selftest: ${fail.length} of ${ran} failed`);
    for (const f of fail) console.error(`    ${f}`);
    return 1;
  }
  console.log(`  withdraw-fragment-verdict: all ${ran} selftests passed`);
  return 0;
}

/* A verdict this tool could emit, from the selftest's in-memory fixture — no corpus read, nothing
   written, no code identity claimed. `verdict-adoption`'s manifest needs a command that produces one
   object, and pointing it at a real folder would make the adoption gate depend on the corpus being
   present (the same reason `corpus-census.mjs` carries one). */
export function verdictSample() {
  const FILES = { '/s/2026-10-05/QC-VERDICT.json': '{"gate":"night-qc","status":"SHORTFALL","at":"2026-10-05T09:01:52Z"}' };
  const io = {
    read: (q) => FILES[q],
    write: () => {},
    ls: (dir) => (dir === '/s/2026-10-05' ? ['QC-VERDICT.json'] : []),
    exists: (q) => FILES[q] !== undefined || q === '/s/2026-10-04',
    at: '2026-10-05T12:00:00Z'
  };
  return run(['--root', '/s', '--keep', '2026-10-04', '--fragment', '2026-10-05'], io).verdict;
}

function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--apply', '--json', '--selftest', '--verdict-sample'], valued: ['--root', '--keep', '--fragment'] }, { tool: 'withdraw-fragment-verdict' });
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample()));
    return 0;
  }
  if (argv.includes('--selftest')) return selftest();
  const r = run(argv);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(r.verdict));
    return r.ok ? 0 : 1;
  }
  if (!r.ok) {
    console.error(`✗ ${r.reason}`);
    return 1;
  }
  console.log(`\n  ${r.apply ? 'WITHDREW' : 'would withdraw (dry run)'} ${r.written.length} verdict(s) in the fragment folder:`);
  for (const w of r.written) console.log(`    ${w.file}  (${w.status})  ->  ${w.record}`);
  for (const s of r.skipped) console.log(`    skipped ${s.file}: ${s.skip}`);
  if (!r.apply) console.log('\n  nothing written. Pass --apply to write the records; the BOX run is owner-authorized.');
  console.log(`\n  VERDICT (tepna.verdict/1): ${JSON.stringify(r.verdict)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
