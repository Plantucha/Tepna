/**
 * tools/write-root.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * A TOOL'S OWN LOCATION IS NOT THE CHECKOUT IT WAS ASKED TO WRITE. Residue
 * `2026-11-02-a-tool-run-by-absolute-path-writes-into-its-own-checkout`.
 *
 * MEASURED 2026-11-02 on unit 233: `tools/new-changeset.mjs` resolves its `ROOT` from
 * `import.meta.url`, joins it to `changes/` and writes there. Called by its absolute path from a
 * worktree — `node $HOME/Tepna/tools/new-changeset.mjs …` — the SHARED ROOT's copy wrote the changeset
 * into the SHARED ROOT. Exit 0, no warning, and the tell was `git status --short changes/` printing
 * nothing in the worktree that had just asked for the file. A changeset in the wrong checkout is a lost
 * work-unit: the PR that owed it lands without one, and the root carries a file nobody staged.
 *
 * REACH, measured 2026-11-03 over `tools/*.mjs`: 139 tools resolve a root from `import.meta.url`, and
 * 56 of those write. This module is the route for every one of them; it converts the measured instance
 * and leaves the rest named rather than silently reaching.
 *
 * IT REFUSES, IT NEVER GUESSES. Two checkouts that disagree are two work-units, and choosing either one
 * quietly is how a file lands where nobody looks for it. The refusal carries both paths and the command
 * that would have been right, because a stop a reader cannot act on costs the same turn twice.
 *
 * READING KEEPS ITS REACH. A tool that reads another checkout is doing something legitimate — a gate
 * comparing trees, a search over a peer's branch — so a plain read keeps its own `import.meta.url`
 * root, and that asymmetry is deliberate.
 *
 * READING TO DECIDE IS THE THIRD CATEGORY, and the paragraph above did not anticipate it. Residue
 * `2026-11-04-a-verdict-gate-judges-the-checkout-it-lives-in-not-the-one-it-ran-from`.
 *
 * MEASURED 2026-11-04 on unit 271: `node <shared root>/tools/secret-scan.mjs` run from a worktree
 * answered `NOT_RUN — HEAD adds no commits over origin/main`. The tool runs every `git` call with
 * `cwd: ROOT`, so it judged the checkout it LIVES in, where HEAD does equal `origin/main`. The reason
 * is the dangerous half: it states something true about a tree the reader never asked about. `NOT_RUN`
 * is the only thing that kept it from reading as a pass.
 *
 * REACH, measured the same day over `tools/*.mjs`: of 323 tools, 131 touch a verdict and 232 derive a
 * root from `import.meta.url`; 49 do both AND pass that self-derived root as a `git` cwd. Some of the
 * 49 mean to judge their own tree, so each needs one reading. `judgeRoot` is the route for the ones
 * that do not.
 *
 * ONE DECISION, TWO VERBS. A write and a judgement ask the same question — which checkout does this run
 * belong to — so they share `writeRootDecision`. Only the refusal's wording differs, because a message
 * that says WRITE to a gate reader describes something the tool never does.
 *
 * SYMLINKS: the comparison accepts EITHER form, as-written or realpath'd, which is the lesson
 * `tools/argv-guard.mjs` records against comparing one form alone. A checkout reached through a link is
 * the same checkout, and under `--preserve-symlinks-main` the as-written form is the only correct one.
 *
 * PURE / IMPURE: `writeRootDecision` and `refusalMessage` are pure and carry the selftests.
 * `gitTopLevel`, `writeRoot` and `writeRootOrDie` touch the filesystem and `git`.
 *
 *   node tools/write-root.mjs --selftest
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

/** The closed reason vocabulary. A refusal names one of these, never prose only. */
export const REASONS = ['cwd-not-a-checkout', 'tool-not-a-checkout', 'checkout-mismatch'];

/** The two things a run can do to a checkout. A caller names one; the decision is the same. */
export const ACTIONS = ['write', 'judge'];

/* The wording each action carries. A gate JUDGES and a tool WRITES, and a reader acts on the sentence
   rather than on the reason slug, so the sentence has to be about what the run was doing. */
const PHRASING = {
  write: { subject: 'a tool', verb: 'writes', noun: 'write' },
  judge: { subject: 'a gate', verb: 'judges', noun: 'judge' }
};

/** Both spellings of one directory, for the either-form comparison above. */
function bothForms(dir) {
  const asWritten = path.resolve(dir);
  let real = asWritten;
  try {
    real = realpathSync(asWritten);
  } catch {
    /* A path that cannot be realpath'd still has its as-written form, which is what git printed. */
  }
  return [asWritten, real];
}

/**
 * The git toplevel of a directory, or `null` when it is in no checkout. Realpath'd by git itself, so
 * `bothForms` is what reconciles it with an as-written caller.
 *
 * @param {string} dir a directory to ask about
 * @param {Function} [spawn] injection point for the selftests
 * @returns {string|null} the toplevel path, or null
 */
export function gitTopLevel(dir, spawn = spawnSync) {
  const r = spawn('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (!r || r.status !== 0) return null;
  const out = String(r.stdout || '').trim();
  return out === '' ? null : out;
}

/**
 * PURE. Which checkout a write belongs to, given the caller's cwd root and the tool's own root.
 *
 * A `null` root means "in no checkout", which is its own refusal rather than a mismatch: a caller
 * standing outside every checkout has not named a target at all, and saying `checkout-mismatch` there
 * would describe a disagreement between two things when only one of them exists.
 *
 * @param {{cwdRoot: string|null, selfRoot: string|null}} roots the two roots, each as git printed it
 * @returns {{ok: true, root: string}|{ok: false, reason: string, cwdRoot: string|null, selfRoot: string|null}}
 */
export function writeRootDecision({ cwdRoot, selfRoot }) {
  if (!cwdRoot) return { ok: false, reason: 'cwd-not-a-checkout', cwdRoot: cwdRoot ?? null, selfRoot: selfRoot ?? null };
  if (!selfRoot) return { ok: false, reason: 'tool-not-a-checkout', cwdRoot, selfRoot: selfRoot ?? null };
  const [cw, cr] = bothForms(cwdRoot);
  const [sw, sr] = bothForms(selfRoot);
  const same = cw === sw || cr === sr || cw === sr || cr === sw;
  if (!same) return { ok: false, reason: 'checkout-mismatch', cwdRoot, selfRoot };
  return { ok: true, root: cwdRoot };
}

/**
 * PURE. The sentence a refusal prints. It names both checkouts and the command that would have been
 * right, so the reader does not have to derive it.
 *
 * @param {{reason: string, cwdRoot: string|null, selfRoot: string|null}} d a refusing decision
 * @param {{toolPath?: string, action?: string}} [opts] the tool's own path, and which verb it earns
 * @returns {string} the message
 */
export function refusalMessage(d, { toolPath = null, action = 'write' } = {}) {
  const rel = toolPath ? path.basename(toolPath) : 'that tool';
  const p = PHRASING[action] || PHRASING.write;
  if (d.reason === 'cwd-not-a-checkout') {
    return `write-root: REFUSED — this was run from a directory in no git checkout, so there is no tree to ${p.noun}. Run it from inside the checkout you mean.`;
  }
  if (d.reason === 'tool-not-a-checkout') {
    return `write-root: REFUSED — ${rel} sits in no git checkout, so it cannot tell which tree it belongs to.`;
  }
  const where = d.cwdRoot ? `${d.cwdRoot}/tools/${rel}` : `<your checkout>/tools/${rel}`;
  return [
    `write-root: REFUSED — ${p.subject} ${p.verb} the checkout it was RUN FROM, never the one it lives in.`,
    `  run from : ${d.cwdRoot}`,
    `  tool from: ${d.selfRoot}`,
    `Run that checkout's own copy instead:  node ${where}`
  ].join('\n');
}

/**
 * Thrown by `writeRoot` and `judgeRoot` so a caller can catch the refusal rather than exit. The name
 * stays as it was, because every importer reads it; `action` is what says which verb it carried.
 */
export class WriteRootRefusal extends Error {
  constructor(decision, toolPath, action = 'write') {
    super(refusalMessage(decision, { toolPath, action }));
    this.name = 'WriteRootRefusal';
    this.reason = decision.reason;
    this.action = action;
    this.cwdRoot = decision.cwdRoot;
    this.selfRoot = decision.selfRoot;
  }
}

/**
 * The checkout a tool may write, or a throw. Call it where the WRITE happens, never at module scope:
 * an exported helper that another checkout's test imports must not refuse on import.
 *
 * @param {string} selfUrl the caller's own `import.meta.url`
 * @param {{cwd?: string, topLevel?: Function}} [opts] injection points for the selftests
 * @returns {string} the toplevel of the checkout this run belongs to
 */
export function writeRoot(selfUrl, opts = {}) {
  return rootFor('write', selfUrl, opts);
}

/**
 * The checkout a gate may JUDGE, or a throw. Same decision, different verb: a gate that reads one tree
 * and publishes a verdict about it answers a question the caller asked from somewhere, and the answer
 * has to be about the tree the caller stands in.
 *
 * Call it inside the run, never at module scope, for the same reason `writeRoot` says: a library import
 * from another checkout must not refuse.
 *
 * @param {string} selfUrl the caller's own `import.meta.url`
 * @param {{cwd?: string, topLevel?: Function}} [opts] injection points for the selftests
 * @returns {string} the toplevel of the checkout this run belongs to
 */
export function judgeRoot(selfUrl, opts = {}) {
  return rootFor('judge', selfUrl, opts);
}

/** Both wrappers over one decision, so a verb can never drift away from the comparison it describes. */
function rootFor(action, selfUrl, { cwd = process.cwd(), topLevel = gitTopLevel } = {}) {
  const selfPath = fileURLToPath(selfUrl);
  const selfDir = path.dirname(selfPath);
  const d = writeRootDecision({ cwdRoot: topLevel(cwd), selfRoot: topLevel(selfDir) });
  if (!d.ok) throw new WriteRootRefusal(d, selfPath, action);
  return d.root;
}

/**
 * The CLI form: print the refusal and exit 2, which is this repo's "it refused to look" code rather
 * than a failing check. A tool that cannot tell which tree it writes has decided nothing.
 *
 * @param {string} selfUrl the caller's own `import.meta.url`
 * @param {{cwd?: string, topLevel?: Function, exit?: Function, err?: Function}} [opts] injection points
 * @returns {string} the toplevel of the checkout this run belongs to
 */
export function writeRootOrDie(selfUrl, opts = {}) {
  return orDie('write', selfUrl, opts);
}

/**
 * The CLI form of `judgeRoot`. Exit 2 is this repo's "it refused to look", which is the only honest
 * code here: a gate that cannot tell which tree it judged has examined nothing.
 *
 * @param {string} selfUrl the caller's own `import.meta.url`
 * @param {{cwd?: string, topLevel?: Function, exit?: Function, err?: Function}} [opts] injection points
 * @returns {string} the toplevel of the checkout this run belongs to
 */
export function judgeRootOrDie(selfUrl, opts = {}) {
  return orDie('judge', selfUrl, opts);
}

function orDie(action, selfUrl, { exit = process.exit, err = console.error, ...rest } = {}) {
  try {
    return rootFor(action, selfUrl, rest);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    err(e.message);
    return exit(2);
  }
}

function selftest() {
  let ran = 0;
  const ok = (cond, msg) => {
    if (cond) {
      ran += 1;
      return;
    }
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  };

  /* The measured defect, stated as the question this module answers. The two fixture paths carry
     neutral names on purpose: the source-scan rule in `tests/dex-tests.js` reds any tool whose text
     holds a literal ending in the repo directory name or naming a `wt-` worktree, and a fixture is
     text like any other. The decision reads two toplevels for equality, so the names do not matter. */
  const shared = '/t/tree-main';
  const wt = '/t/tree-unit';
  ok(writeRootDecision({ cwdRoot: wt, selfRoot: shared }).reason === 'checkout-mismatch', 'the shared root called from a worktree is a mismatch');
  ok(writeRootDecision({ cwdRoot: wt, selfRoot: wt }).root === wt, "a worktree's own copy writes that worktree");
  ok(writeRootDecision({ cwdRoot: shared, selfRoot: shared }).root === shared, 'the root called from the root writes the root');

  /* Absence is its own reason, never a mismatch between one thing and nothing (§∅). */
  ok(writeRootDecision({ cwdRoot: null, selfRoot: shared }).reason === 'cwd-not-a-checkout', 'a cwd in no checkout is not a mismatch');
  ok(writeRootDecision({ cwdRoot: shared, selfRoot: null }).reason === 'tool-not-a-checkout', 'a tool in no checkout is not a mismatch');
  ok(writeRootDecision({ cwdRoot: null, selfRoot: null }).reason === 'cwd-not-a-checkout', 'two absences report the caller first');
  ok(REASONS.includes(writeRootDecision({ cwdRoot: wt, selfRoot: shared }).reason), 'every reason sits in the closed vocabulary');
  ok(writeRootDecision({ cwdRoot: wt, selfRoot: shared }).ok === false, 'a refusal carries ok false, never a root');
  ok(writeRootDecision({ cwdRoot: wt, selfRoot: wt }).ok === true, 'an agreement carries ok true');

  /* A trailing separator is the same checkout, not a second one. */
  ok(writeRootDecision({ cwdRoot: `${wt}/`, selfRoot: wt }).ok === true, 'a trailing separator names the same checkout');

  /* The message is the whole remedy: both paths and the command. */
  const msg = refusalMessage(writeRootDecision({ cwdRoot: wt, selfRoot: shared }), { toolPath: `${shared}/tools/new-changeset.mjs` });
  ok(msg.includes(wt) && msg.includes(shared), 'the refusal names both checkouts');
  ok(msg.includes(`node ${wt}/tools/new-changeset.mjs`), 'the refusal names the command that would have been right');
  ok(refusalMessage({ reason: 'cwd-not-a-checkout', cwdRoot: null, selfRoot: shared }).includes('no git checkout'), 'the cwd refusal says what is missing');
  ok(refusalMessage({ reason: 'tool-not-a-checkout', cwdRoot: shared, selfRoot: null }).includes('no git checkout'), 'the tool refusal says what is missing');

  /* `gitTopLevel` reports absence as null, never as an empty path a join would swallow. */
  ok(gitTopLevel('/x', () => ({ status: 128, stdout: '' })) === null, 'a non-zero git exit is absence');
  ok(gitTopLevel('/x', () => ({ status: 0, stdout: '\n' })) === null, 'an empty toplevel is absence');
  ok(gitTopLevel('/x', () => ({ status: 0, stdout: `${wt}\n` })) === wt, 'a toplevel comes back trimmed');
  ok(gitTopLevel('/x', () => null) === null, 'a spawn that returned nothing is absence');

  /* The wrapper throws a catchable refusal and exits 2 in its CLI form. */
  const selfUrl = new URL('file:///home/x/Tepna/tools/new-changeset.mjs').href;
  let threw = null;
  try {
    writeRoot(selfUrl, { cwd: wt, topLevel: (d) => (d.startsWith(wt) ? wt : shared) });
  } catch (e) {
    threw = e;
  }
  ok(threw instanceof WriteRootRefusal && threw.reason === 'checkout-mismatch', 'writeRoot throws a typed refusal');
  ok(writeRoot(selfUrl, { cwd: shared, topLevel: () => shared }) === shared, 'writeRoot returns the agreed root');
  let code = null;
  const lines = [];
  writeRootOrDie(selfUrl, {
    cwd: wt,
    topLevel: (d) => (d.startsWith(wt) ? wt : shared),
    exit: (c) => {
      code = c;
    },
    err: (m) => lines.push(m)
  });
  ok(code === 2, 'the CLI form exits 2, which is a refusal and not a failing check');
  ok(lines.length === 1 && lines[0].includes('REFUSED'), 'the CLI form prints the refusal once');

  /* ── THE JUDGE ARM ─────────────────────────────────────────────────────────────────────────────
     One decision, two verbs. These assertions hold the WORDING apart, because the whole defect was a
     gate reporting on a tree the reader never named, and a message that says WRITE to a gate reader
     describes something the tool never does. */
  ok(ACTIONS.length === 2 && ACTIONS.includes('write') && ACTIONS.includes('judge'), 'the action vocabulary holds exactly the two verbs');
  const mism = writeRootDecision({ cwdRoot: wt, selfRoot: shared });
  const jmsg = refusalMessage(mism, { toolPath: `${shared}/tools/secret-scan.mjs`, action: 'judge' });
  ok(jmsg.includes('a gate judges the checkout it was RUN FROM'), 'the judge refusal says JUDGE');
  ok(!jmsg.includes('writes'), 'the judge refusal never says writes');
  ok(refusalMessage(mism, { action: 'write' }).includes('a tool writes the checkout'), 'the write refusal still says WRITE');
  ok(jmsg.includes(wt) && jmsg.includes(shared), 'the judge refusal names both checkouts too');
  ok(jmsg.includes(`node ${wt}/tools/secret-scan.mjs`), 'the judge refusal names the command that would have been right');
  ok(refusalMessage({ reason: 'cwd-not-a-checkout', cwdRoot: null, selfRoot: shared }, { action: 'judge' }).includes('no tree to judge'), 'a cwd in no checkout has no tree to judge');
  ok(refusalMessage({ reason: 'cwd-not-a-checkout', cwdRoot: null, selfRoot: shared }, { action: 'write' }).includes('no tree to write'), 'and none to write either');
  ok(refusalMessage(mism, { action: 'not-a-verb' }).includes('a tool writes the checkout'), 'an action outside the vocabulary falls back to the write wording');

  const gateUrl = new URL('file:///home/x/Tepna/tools/secret-scan.mjs').href;
  let jthrew = null;
  try {
    judgeRoot(gateUrl, { cwd: wt, topLevel: (d) => (d.startsWith(wt) ? wt : shared) });
  } catch (e) {
    jthrew = e;
  }
  ok(jthrew instanceof WriteRootRefusal && jthrew.reason === 'checkout-mismatch', 'judgeRoot throws a typed refusal');
  ok(jthrew.action === 'judge', 'the thrown refusal records which verb it carried');
  ok(jthrew.message.includes('a gate judges'), 'the thrown message carries the judge wording');
  ok(judgeRoot(gateUrl, { cwd: wt, topLevel: () => wt }) === wt, "judgeRoot returns the run's own checkout");
  let jcode = null;
  const jlines = [];
  judgeRootOrDie(gateUrl, {
    cwd: wt,
    topLevel: (d) => (d.startsWith(wt) ? wt : shared),
    exit: (c) => {
      jcode = c;
    },
    err: (m) => jlines.push(m)
  });
  ok(jcode === 2, 'the judge CLI form exits 2 — a gate that cannot name its tree examined nothing');
  ok(jlines.length === 1 && jlines[0].includes('REFUSED'), 'the judge CLI form prints the refusal once');
  ok(judgeRootOrDie(gateUrl, { cwd: shared, topLevel: () => shared }) === shared, 'an agreeing judge run returns the root and prints nothing');

  console.log(`all ${ran} selftests passed`);
  return ran;
}

if (isCliEntry(import.meta.url)) {
  if (process.argv.slice(2).includes('--selftest')) {
    selftest();
  } else {
    console.log('tools/write-root.mjs — a library. Run with --selftest.');
  }
}
