#!/usr/bin/env node
/* Tepna — Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════
 * judge-targets.mjs — WHICH TREE EACH PENDING JUDGE ACTUALLY HANDS ITS CHILD.
 *
 * WHY. `briefs/WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md` §6.4 refuses a blanket conversion of the
 * judge arm and asks three questions of every candidate: does the gate judge an artifact of the RUN's
 * work-unit, does it judge a tree it owns by design, or does it compare two checkouts deliberately.
 * All three are questions about ONE expression — the `cwd` the tool hands its child — crossed with
 * what that child ASKS of the tree. A probe over all 53 named judge tools (2026-11-15) found 52 of
 * them pass a root they resolved from `import.meta.url`, so the shape alone separates nothing. This
 * scan states the pair instead, without running anything.
 *
 * WHAT A CLASS HERE IS, AND WHAT IT IS NOT. `work-unit` means the child's `cwd` is built from a
 * constant this tool resolved out of its own location, and the child's argv names a ref, a range, a
 * diff or the index. That is the defect shape of row
 * `2026-11-05-verdict-gates-still-judge-the-checkout-they-live-in`, stated statically. `tracked-tree`
 * is the same `cwd` with a child that reads the tree as it stands. Both owe §6.4's first reading.
 * `own-fixtures`, `two-checkouts` and `inherits` are the honest shapes: a sandbox the tool creates, a
 * tree the caller names, and a child with NO `cwd` option, which already runs where the run runs.
 *
 * THE CONTROL IS THE ADOPTED SET, read one direction only. Every `adopted` row in
 * `tools/write-root-adoption.json` under `arms.judge` claims a wrapper decides the checkout it
 * judges. So no adopted tool may still hold a PROVEN unguarded own-root child `cwd`. The limit is
 * plain: the control cannot catch a tool that adopted the wrapper and judges the wrong tree for a
 * reason this scan never looks at, and it says nothing about the pending rows, which claim nothing.
 *
 * ABSTENTION IS NOT AGREEMENT. `undecidable` carries a named reason and is counted apart, and an
 * adopted row that abstains is EXCLUDED from the control rather than read as agreement.
 *
 * WHAT IT EXAMINES NOTHING ABOUT. The population is the judge arm's own list, and the call set is the
 * five `node:child_process` entry points. A gate that judges a tree through a library call, through
 * its own `readFileSync` walk, or through a shell string it assembles elsewhere reads here as
 * `no-site`, which is absence of a measurement rather than absence of a judgement. The shorthand
 * `{ cwd }` is read as the identifier `cwd`, and a `cwd` the scan cannot resolve abstains by name.
 *
 *   node tools/judge-targets.mjs                  # the table and the counts
 *   node tools/judge-targets.mjs --only <name>    # every child call site of one tool
 *   node tools/judge-targets.mjs --control        # the verdict object alone
 *   node tools/judge-targets.mjs --json           # verdict plus every row
 *   node tools/judge-targets.mjs --selftest       # the plants
 *   node tools/judge-targets.mjs --verdict-sample # a sample object, scans nothing
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';
import { bareSource } from './verdict-adoption.mjs';
import { makeVerdict } from './verdict-emit.mjs';
import { WriteRootRefusal, judgeRoot, verdictRefusalReason } from './write-root.mjs';
import { callArgs, declarations, defaultedRoots, direct, functions, guardedRoots, pathDerived, rootNames, splitTopArgs } from './write-targets.mjs';

const MANIFEST = 'tools/write-root-adoption.json';
const GATE = 'judge-targets';
const SELF = 'tools/judge-targets.mjs';

/** The five `node:child_process` entry points. A member form is the same call. */
export const CALLS = ['execFileSync', 'execSync', 'spawnSync', 'execFile', 'spawn'];

/** Strongest first. An unguarded proof outranks an abstention, which outranks every safe shape. */
export const SITE_CLASSES = ['work-unit', 'tracked-tree', 'undecidable', 'guarded', 'two-checkouts', 'own-commit', 'own-fixtures', 'inherits'];
export const TOOL_CLASSES = [...SITE_CLASSES, 'no-site'];

/** §6.4's triage, one sentence per class. The table prints it so the remedy needs no second read. */
export const READING = {
  'work-unit': 'convert — the child judges a work-unit artifact of the checkout this tool lives in',
  'tracked-tree': 'convert — the child reads the tracked tree of the checkout this tool lives in',
  undecidable: 'read by hand — this scan abstains, and the reason names what it could not resolve',
  guarded: 'adopted — a wrapper decides the tree at this site',
  'two-checkouts': 'leave — the caller names the tree, so reading keeps its reach',
  'own-commit': 'confirm, then exempt — the child asks only for a commit stamp, which names the code that produced the verdict',
  'own-fixtures': 'leave — it judges a sandbox it creates itself',
  inherits: 'already correct — the child carries no cwd, so it runs in the run’s own tree',
  'no-site': 'no child call — this scan measured nothing about how it judges'
};

/* A ref, a range, a diff or the index. `--show-toplevel` is in here on purpose: the answer is WHICH
   checkout, and a tool that asks its own is the defect the brief names. */
const WORK_UNIT_RE =
  /\b(?:diff|log|rev-list|rev-parse|merge-base|stash|describe|blame|cat-file|for-each-ref|ls-files|ls-tree|symbolic-ref|name-rev|worktree|status|show)\b|--cached\b|--staged\b|\bHEAD\b|\borigin\//;

/* THE COMMIT STAMP. `producedBy.commit` names the code that produced the verdict, so a stamp read in
   the tool's OWN checkout is correct by definition — `tools/verdict-emit.mjs` holds the shared one.
   The class is narrow on purpose: `rev-parse --show-toplevel` asks WHICH checkout and is not a stamp,
   so a `HEAD` token must be present and every other subject token must belong to the stamp. */
const STAMP_VERBS = new Set(['rev-parse', 'describe']);
const STAMP_OK = new Set(['rev-parse', 'describe', 'HEAD']);

/* A token that only launches something. A launcher with no verb beside it names no subject. */
const LAUNCHERS = new Set(['git', 'node', 'npm', 'npx', 'sh', 'bash', 'python', 'python3', 'env', 'gh', 'ruff', 'mypy', 'pytest']);

export const CRITERION = { name: 'adopted_judge_tools_still_holding_an_unguarded_own_root_child_cwd', threshold: 0, unit: 'tools', direction: 'lte' };

/* ── the cwd expression ──────────────────────────────────────────────────────────────────────────── */

/**
 * The `cwd` expression of one argument text, or `null` when the argument carries none.
 *
 * The shorthand `{ cwd }` resolves to the identifier `cwd`, which `direct` then judges like any other
 * name. PURE.
 */
export function cwdExpr(argText) {
  /* AN OPTIONS OBJECT ONLY. `bus-conf-provenance.mjs` passes `['-C', cwd, ...args]` as the argv, and a
     shorthand read over every argument took that ARRAY ELEMENT for an options key (measured
     2026-11-15, found by a hand read of the site rather than by a test). */
  if (!/^\s*\{/.test(argText)) return null;
  const m = /(?:^|[{,\s])cwd\s*:/.exec(argText);
  if (!m) return /(?:^|[{,\s])cwd\s*(?=[,}]|$)/.test(argText) ? 'cwd' : null;
  const start = m.index + m[0].length;
  let depth = 0;
  let q = null;
  let i = start;
  for (; i < argText.length; i++) {
    const c = argText[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
  }
  const e = argText.slice(start, i).trim();
  return e || null;
}

/** Every child-process call site in blanked source, with its argument texts. PURE. */
export function childSites(bare) {
  const out = [];
  for (const call of CALLS) {
    const re = new RegExp(`\\b${escapeRe(call)}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(bare))) {
      const open = m.index + m[0].length - 1;
      const args = splitTopArgs(bare, open);
      out.push({ call, line: bare.slice(0, m.index).split('\n').length, args });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The string literals of the command and its argument vector. PURE. */
export function argvTokens(args) {
  const out = [];
  for (const a of (args || []).slice(0, 2)) {
    if (typeof a !== 'string') continue;
    /* ONE LITERAL MAY CARRY THE WHOLE COMMAND LINE. `execSync('git rev-parse --short HEAD', …)` is
       one string, so a literal splits on whitespace before anything reads a verb. */
    for (const m of a.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\$]*)`/g)) out.push(...String(m[1] ?? m[2] ?? m[3]).split(/\s+/));
  }
  return out.filter((s) => s !== '');
}

/**
 * What the child ASKS of the tree it is handed.
 *
 * `unnamed` is an absence of a measurement: the command or its verb is a variable, so this scan reads
 * no subject at all. PURE.
 */
export function asks(tokens) {
  const joined = tokens.join(' ');
  const subject = tokens.filter((t) => !LAUNCHERS.has(t) && !/^-/.test(t));
  if (subject.includes('HEAD') && subject.every((t) => STAMP_OK.has(t)) && subject.some((t) => STAMP_VERBS.has(t))) return 'own-commit';
  if (WORK_UNIT_RE.test(joined)) return 'work-unit';
  return subject.length ? 'tracked-tree' : 'unnamed';
}

/* ── the classification ──────────────────────────────────────────────────────────────────────────── */

/**
 * The tree a `git -C <dir>` argv names, or `null`.
 *
 * `git -C` is the second way a judge names its subject, and 8 of the 53 named tools use it — four of
 * them adopted. A scan that reads only the `cwd` option cannot see the mechanism those four adopted
 * WITH. When both appear, `-C` decides, because git acts on the repository it names. PURE.
 */
export function gitTree(args) {
  const list = args || [];
  if (!/^\s*['"`]git['"`]\s*$/.test(list[0] || '')) return null;
  const a = list[1] || '';
  const open = a.indexOf('[');
  if (open === -1) return null;
  const parts = splitTopArgs(a, open);
  if (parts === null) return null;
  const i = parts.findIndex((x) => /^\s*['"`]-C['"`]\s*$/.test(x));
  if (i === -1 || parts[i + 1] === undefined) return null;
  const e = parts[i + 1].trim();
  return e === '' || e.startsWith('...') ? null : e;
}

/**
 * ONE hop, through the declarations of a bare identifier.
 *
 * Unanimity is the rule, because a name declared twice decides nothing: `tools/write-targets.mjs`
 * measured a real file where one declaration built a temporary fixture and the other built the
 * tracked path. A hop reads ANCHORED, so a value read THROUGH a root never inherits it. PURE.
 */
export function hop(name, ctx) {
  const decls = ctx.decls.get(name) || [];
  if (decls.length === 0) return null;
  const answers = decls.map((init) => (typeof init === 'string' ? direct(init, ctx.roots, ctx.guarded, true, ctx.defaulted) : null));
  if (answers.some((a) => a === null)) return null;
  const first = answers[0].cls;
  if (!answers.every((a) => a.cls === first)) return null;
  return { cls: first, why: `${answers[0].why}, reached through the declaration of \`${name}\`` };
}

/**
 * ONE hop, through the ARGUMENT every caller passes to the function that owns this parameter.
 *
 * Two of the eleven adopted judge tools take the tree as a parameter — `gitAt(root, args)` and
 * `git(cwd, args)` — so a scan with no parameter hop abstains on the very rows the control needs.
 * Unanimity again, and a caller that passes the parameter straight through is dropped rather than
 * read as agreement. PURE.
 */
export function paramHop(name, ctx) {
  /* EVERY function whose FIRST parameter carries this name, not one. `tools/write-root-adoption.mjs`
     passes its `root` parameter straight through four such functions, so a single-owner hop abstained
     on an adopted row; the union of their callers answers it in one step. A caller that passes the
     parameter on by the same name is dropped rather than followed, which is what bounds the hop. */
  const owners = ctx.fns ? [...ctx.fns].filter(([, ps]) => ps[0] === name).map(([n]) => n) : [];
  if (owners.length === 0) return null;
  const raw = owners.flatMap((o) => callArgs(ctx.bare, o));
  const args = raw.filter((a) => a !== name);
  if (args.length === 0) return null;
  const answers = args.map((a) => direct(a, ctx.roots, ctx.guarded, false, ctx.defaulted) || hop(a.trim(), ctx));
  if (answers.some((a) => a === null)) return null;
  const first = answers[0].cls;
  if (!answers.every((a) => a.cls === first)) return null;
  const where = owners.length === 1 ? `\`${owners[0]}\`` : `the ${owners.length} functions taking it`;
  return { cls: first, why: `${answers[0].why}, and every one of the ${args.length} call(s) to ${where} passes such a value` };
}

/**
 * The root set, plus the chain `write-targets.mjs` does not carry: `dirname(<a file root>)`.
 *
 * `tools/trio-batch.mjs` writes `__filename = fileURLToPath(import.meta.url)`, then
 * `__dirname = dirname(__filename)`, then `ROOT = join(__dirname, '..')`. The shared primitive seeds
 * `__filename` and stops, because `dirname(ROOT)` of a DIRECTORY root leaves the checkout and the
 * shape cannot tell the two apart. A file root can: the parent of a file is the directory holding it.
 * PURE.
 */
export function rootsWithFileChain(bare) {
  const roots = rootNames(bare);
  const decls = declarations(bare);
  const fileRoots = new Set();
  for (const [name, inits] of decls) if (inits.some((i) => typeof i === 'string' && /^\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*$/.test(i))) fileRoots.add(name);
  for (let pass = 0; pass < 10; pass++) {
    let grew = false;
    for (const [name, inits] of decls) {
      if (roots.has(name)) continue;
      for (const f of fileRoots)
        if (inits.some((i) => typeof i === 'string' && new RegExp(`^\\s*dirname\\s*\\(\\s*${escapeRe(f)}\\s*\\)\\s*$`).test(i))) {
          roots.add(name);
          fileRoots.add(name);
          grew = true;
          break;
        }
      if (roots.has(name)) continue;
      for (const r of roots)
        if (inits.some((i) => typeof i === 'string' && pathDerived(i, r))) {
          roots.add(name);
          grew = true;
          break;
        }
    }
    if (!grew) break;
  }
  return roots;
}

/**
 * One child call site, classified. `ctx` carries the file's root, guarded and defaulted name sets.
 *
 * The order is the claim. A wrapper at the site is a statement about THIS path, so it wins. A
 * sandbox or a caller-named tree then wins over the own-root pair, because neither touches the
 * checkout this tool lives in. PURE.
 */
export function classifySite(site, ctx) {
  if (site.args === null) return { cls: 'undecidable', why: `the arguments of this \`${site.call}\` call do not balance, so the tree was never read`, cwd: null, via: null, ask: null };
  const named = gitTree(site.args);
  const opts = named === null ? site.args.find((a) => typeof a === 'string' && cwdExpr(a) !== null) : undefined;
  const cwd = named === null ? (opts === undefined ? null : cwdExpr(opts)) : named;
  const via = named === null ? (cwd === null ? null : 'cwd') : 'git -C';
  const ask = asks(argvTokens(site.args));
  if (cwd === null) return { cls: 'inherits', why: 'the call names no tree, so the child runs in the tree the run was started from', cwd: null, via: null, ask };
  const d = direct(cwd, ctx.roots, ctx.guarded, false, ctx.defaulted) || hop(cwd, ctx) || paramHop(cwd, ctx);
  if (d === null) {
    const decls = ctx.decls.get(cwd) || [];
    const lead = decls.find((x) => typeof x === 'string' && x.trim() !== '');
    return {
      cls: 'undecidable',
      why: lead
        ? `the ${decls.length > 1 ? `${decls.length} declarations` : 'declaration'} of \`${cwd}\` reach no checkout this scan names — the first is \`${lead.trim().slice(0, 60)}\``
        : `no declaration in this file decides \`${cwd}\`, so the child's tree stays unread`,
      cwd,
      via,
      ask
    };
  }
  if (d.cls === 'guarded') return { cls: 'guarded', why: d.why, cwd, via, ask };
  if (d.cls === 'outside-repo') return { cls: 'own-fixtures', why: d.why, cwd, via, ask };
  if (d.cls === 'caller-cwd' || d.cls === 'caller-argv') return { cls: 'two-checkouts', why: d.why, cwd, via, ask };
  /* own-root and own-root-default both hand the child THIS tool's checkout. The ask decides the
     reading, and an unread ask abstains rather than borrowing either one. */
  if (ask === 'unnamed') return { cls: 'undecidable', why: `${d.why}, and the child's own subject is a variable, so this scan read no verb`, cwd, via, ask };
  if (ask === 'own-commit') return { cls: 'own-commit', why: `${d.why}, and the child asks only for that checkout's own commit`, cwd, via, ask };
  return { cls: ask === 'work-unit' ? 'work-unit' : 'tracked-tree', why: d.why, cwd, via, ask };
}

/** One tool's source, classified. PURE. */
/* 🔴 A DETECTOR THAT HOLDS ITS OWN FIXTURES READS THEM AS SITES. This file carries one planted child
   call per class, as a template literal and as a quoted argument to the selftest, so the first census
   read 10 sites in THIS tool and abstained on it (measured 2026-11-15). A child call inside a string
   is TEXT, never a call. §👥.4's self-match, moved from a process pattern to a source scan.

   WHAT IS BLANKED, AND WHY NOT MORE. A real site never carries its OWN call name inside its argv, so
   only a string literal whose contents hold a call name and an open bracket loses them. The argv
   literals every class here reads — `'git'`, `['rev-parse', '--short', 'HEAD']` — stay. Blanking every
   string instead would delete the subject this scan reads, and blanking whole templates on a
   file-wide toggle ran away on the first backtick inside an ordinary message: it blanked every later
   line, moved 7 rows and lost 2 real adopted sites (measured the same day). So the walk is LINE-LOCAL
   and an unbalanced quote costs the rest of ONE line. The limit: a fixture written as a MULTI-LINE
   template still reads as a site, because its call line carries no quote of its own. PURE. */
export function litBlanked(text, names = CALLS) {
  const planted = new RegExp(`\\b(?:${names.map(escapeRe).join('|')})\\s*\\(`);
  return text
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const q = line[i];
        if (q !== "'" && q !== '"' && q !== '`') {
          out += q;
          continue;
        }
        let k = i + 1;
        let body = '';
        while (k < line.length && line[k] !== q) {
          if (line[k] === '\\') {
            body += line.slice(k, k + 2);
            k += 2;
            continue;
          }
          body += line[k];
          k++;
        }
        const closed = k < line.length;
        out += q + (planted.test(body) ? ' '.repeat(body.length) : body) + (closed ? q : '');
        i = k;
      }
      return out;
    })
    .join('\n');
}

export function classifyTool(text) {
  const bare = litBlanked(bareSource(text, false));
  const roots = rootsWithFileChain(bare);
  const guarded = guardedRoots(bare, roots);
  const defaulted = defaultedRoots(bare, roots, guarded);
  const ctx = { roots, guarded, defaulted, decls: declarations(bare), fns: functions(bare), bare };
  const sites = childSites(bare).map((s) => ({ call: s.call, line: s.line, ...classifySite(s, ctx) }));
  const present = new Set(sites.map((s) => s.cls));
  const cls = TOOL_CLASSES.find((c) => present.has(c)) || 'no-site';
  return { cls, sites, roots: [...roots], guarded: [...guarded], defaulted: [...defaulted] };
}

/* ── the population and the control ──────────────────────────────────────────────────────────────── */

/** The judge arm's own three sets, read from the manifest. */
export function population(root) {
  const m = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  const arm = m.arms.judge;
  return { pending: [...arm.pending], adopted: Object.keys(arm.adopted), exempt: Object.keys(arm.exempt || {}), readings: arm.adopted };
}

/** Every named judge tool, classified. */
export function scan(root) {
  const pop = population(root);
  const rows = [];
  for (const [set, names] of [
    ['pending', pop.pending],
    ['adopted', pop.adopted],
    ['exempt', pop.exempt]
  ]) {
    for (const name of names) {
      const p = join(root, name);
      if (!existsSync(p)) continue;
      rows.push({ name, set, ...classifyTool(readFileSync(p, 'utf8')) });
    }
  }
  return { pop, rows: rows.sort((a, b) => TOOL_CLASSES.indexOf(a.cls) - TOOL_CLASSES.indexOf(b.cls) || a.name.localeCompare(b.name)) };
}

/**
 * The one direction the control reads: an adopted row claims a wrapper decides the tree it judges, so
 * a PROVEN unguarded own-root child cwd contradicts it. PURE.
 */
export function contradiction(tool) {
  if (tool.cls !== 'work-unit' && tool.cls !== 'tracked-tree') return null;
  const s = tool.sites.find((x) => x.cls === tool.cls);
  return `its adopted row claims a wrapper decides the tree, and line ${s.line} still hands \`${s.cwd}\` to a child that asks for the ${s.ask === 'work-unit' ? 'work unit' : 'tracked tree'}`;
}

export function verdict(rows, pop, opts = {}) {
  const by = new Map(rows.map((r) => [r.name, r]));
  const absent = pop.adopted.filter((n) => !by.has(n));
  const examined = [];
  const excluded = [];
  for (const name of pop.adopted) {
    const row = by.get(name);
    if (!row) continue;
    if (row.cls === 'undecidable') excluded.push(`${name}: this scan abstains on its cwd, so its adopted row stays unchecked`);
    else if (row.cls === 'no-site') excluded.push(`${name}: it calls no child process, so this scan measured nothing about how it judges`);
    else examined.push(row);
  }
  const bad = examined.map((r) => ({ name: r.name, msg: contradiction(r) })).filter((x) => x.msg !== null);
  const eligible = pop.adopted.length;
  const reasons = [...absent.map((n) => `${n}: the manifest names it and this scan never read it`), ...excluded];
  let status = 'PASS';
  let reason = null;
  if (absent.length || examined.length === 0) {
    status = 'NOT_RUN';
    reason = `no adopted judge row was examined — ${reasons.join('; ')}`;
  } else if (bad.length) {
    status = 'FAIL';
    reason = `${bad.length} adopted judge tool(s) still hand a child the checkout they live in: ${bad.map((b) => `${b.name} — ${b.msg}`).join('; ')}`;
  }
  return makeVerdict({
    gate: GATE,
    status,
    population: { checked: examined.length, eligible, excluded: eligible - examined.length },
    criterion: CRITERION,
    result:
      status === 'NOT_RUN'
        ? null
        : {
            contradictions: bad.length,
            contradicting: bad.map((b) => `${b.name}: ${b.msg}`),
            unexaminable: excluded,
            byClass: Object.fromEntries(TOOL_CLASSES.map((c) => [c, rows.filter((r) => r.cls === c).length]).filter(([, n]) => n > 0))
          },
    evidence: [SELF, MANIFEST],
    reason,
    tool: SELF,
    commit: opts.commit
  });
}

/** THIS SCAN IS ITSELF A JUDGE, so a run from outside the tree it judges prints ONE object and stops. */
export function notRun(reason, opts = {}) {
  return makeVerdict({
    gate: GATE,
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: CRITERION,
    result: null,
    evidence: [SELF, MANIFEST],
    reason,
    tool: SELF,
    commit: opts.commit
  });
}

/* ── the views ───────────────────────────────────────────────────────────────────────────────────── */

function table(rows) {
  const w = Math.max(...rows.map((r) => r.name.length), 4);
  console.log(`  ${'tool'.padEnd(w)}  set       class          sites  asks`);
  for (const r of rows) {
    const a = [...new Set(r.sites.map((s) => s.ask).filter(Boolean))].join(',') || '—';
    console.log(`  ${r.name.padEnd(w)}  ${r.set.padEnd(8)}  ${r.cls.padEnd(13)}  ${String(r.sites.length).padStart(5)}  ${a}`);
  }
  const counts = TOOL_CLASSES.map((c) => [c, rows.filter((r) => r.cls === c).length]).filter(([, n]) => n > 0);
  console.log('');
  for (const [c, n] of counts) console.log(`  ${String(n).padStart(3)} ${c.padEnd(13)} ${READING[c]}`);
}

function sites(rows) {
  for (const r of rows) {
    console.log(`▸ ${r.name} — ${r.cls}\n  ${READING[r.cls]}`);
    for (const s of r.sites)
      console.log(
        `  line ${String(s.line).padStart(5)}  ${s.call.padEnd(13)} ${s.cls.padEnd(13)} ask=${s.ask || '—'}  ${s.via || 'inherit'}=${s.cwd === null ? '(none)' : s.cwd}\n                 ${s.why}`
      );
    console.log('');
  }
}

/* ── the plants ──────────────────────────────────────────────────────────────────────────────────── */

const R = "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\n";

export const PLANT = {
  'work-unit.mjs': `${R}const out = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: ROOT, encoding: 'utf8' });\n`,
  'tracked-tree.mjs': `${R}execFileSync('node', ['tools/ste-lint.mjs', 'briefs/X.md'], { cwd: ROOT, stdio: 'inherit' });\n`,
  'guarded.mjs': `const JROOT = judgeRootOrDie(import.meta.url);\nexecFileSync('git', ['status', '--short'], { cwd: JROOT, encoding: 'utf8' });\n`,
  'own-fixtures.mjs': `${R}const tmp = mkdtempSync(join(tmpdir(), 'jt-'));\nexecFileSync('git', ['log', '-1'], { cwd: tmp, encoding: 'utf8' });\n`,
  'two-checkouts.mjs': `${R}const where = process.argv[2];\nexecFileSync('git', ['rev-parse', 'HEAD'], { cwd: where, encoding: 'utf8' });\n`,
  'inherits.mjs': `${R}execFileSync('git', ['diff', '--cached'], { encoding: 'utf8' });\n`,
  'undecidable.mjs': `${R}const where = pick('--repo');\nexecFileSync('git', ['log', '-1'], { cwd: where, encoding: 'utf8' });\n`,
  'unnamed-ask.mjs': `${R}execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });\n`,
  'git-c-root.mjs': `${R}execFileSync('git', ['-C', ROOT, 'diff', '--name-only'], { encoding: 'utf8' });\n`,
  'git-c-argv.mjs': `${R}const where = process.argv[2];\nexecFileSync('git', ['-C', where, 'rev-parse', 'HEAD'], { encoding: 'utf8' });\n`,
  'git-c-param.mjs': `${R}const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });\nconst head = git(process.argv[2], ['rev-parse', 'HEAD']);\n`,
  'param-cwd.mjs': `${R}function gitAt(root, args) {\n  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });\n}\nconst r = gitAt(process.argv[2], ['status']);\n`,
  'file-chain.mjs': `const __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\nconst ROOT = join(__dirname, '..');\nexecSync('git diff --name-only origin/main', { cwd: ROOT });\n`,
  'own-commit.mjs': `${R}const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();\n`,
  'own-commit-line.mjs': `${R}const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();\n`,
  'toplevel.mjs': `${R}const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();\n`,
  'no-site.mjs': `${R}const text = readFileSync(join(ROOT, 'briefs', 'X.md'), 'utf8');\n`,
  'shorthand.mjs': `${R}const cwd = ROOT;\nexecFileSync('git', ['diff'], { cwd, encoding: 'utf8' });\n`
};

function selftest() {
  let pass = 0;
  const fails = [];
  const ok = (c, m) => {
    if (c) pass++;
    else fails.push(m);
  };
  const cls = (k) => classifyTool(PLANT[k]).cls;

  /* THE SEVEN CLASSES, one plant each. */
  ok(cls('work-unit.mjs') === 'work-unit', `a diff of a range in the tool's own root is a work-unit judgement (got ${cls('work-unit.mjs')})`);
  ok(cls('tracked-tree.mjs') === 'tracked-tree', `a repo tool run over the tool's own root reads the tracked tree (got ${cls('tracked-tree.mjs')})`);
  ok(cls('guarded.mjs') === 'guarded', `a wrapper-decided root guards the site (got ${cls('guarded.mjs')})`);
  ok(cls('own-fixtures.mjs') === 'own-fixtures', `a sandbox the tool creates is its own tree (got ${cls('own-fixtures.mjs')})`);
  ok(cls('two-checkouts.mjs') === 'two-checkouts', `a cwd from the command line is the caller's tree (got ${cls('two-checkouts.mjs')})`);
  ok(cls('inherits.mjs') === 'inherits', `a call with no cwd inherits the run's tree (got ${cls('inherits.mjs')})`);
  ok(cls('undecidable.mjs') === 'undecidable', `a cwd this scan cannot resolve abstains (got ${cls('undecidable.mjs')})`);
  ok(cls('no-site.mjs') === 'no-site', `a tool that spawns nothing is measured nowhere (got ${cls('no-site.mjs')})`);

  /* THE ASK IS READ FROM THE ARGV, and an unread ask abstains rather than borrowing a class. */
  ok(classifyTool(PLANT['work-unit.mjs']).sites[0].ask === 'work-unit', 'a range names the work unit');
  ok(classifyTool(PLANT['tracked-tree.mjs']).sites[0].ask === 'tracked-tree', 'a repo tool names the tree');
  ok(cls('unnamed-ask.mjs') === 'undecidable', `a variable command reads no subject (got ${cls('unnamed-ask.mjs')})`);
  ok(/the child's own subject is a variable/.test(classifyTool(PLANT['unnamed-ask.mjs']).sites[0].why), 'and the abstention says which half it could not read');
  ok(asks(['git', 'status', '--short']) === 'work-unit' && asks(['git']) === 'unnamed', 'a launcher with no verb beside it names no subject');
  ok(asks(['npm', 'run', 'check']) === 'tracked-tree', 'a suite over the tree as it stands is a tracked-tree ask');

  /* THE CWD EXPRESSION, including the shorthand the header names as a limit. */
  ok(cwdExpr("{ cwd: ROOT, encoding: 'utf8' }") === 'ROOT', `a plain cwd reads (got ${cwdExpr("{ cwd: ROOT, encoding: 'utf8' }")})`);
  ok(cwdExpr('{ cwd: join(ROOT, "x"), stdio: "inherit" }') === 'join(ROOT, "x")', 'a call-valued cwd keeps its own commas');
  ok(cwdExpr("{ encoding: 'utf8' }") === null, 'an options object with no cwd carries none');
  ok(cwdExpr('{ cwd }') === 'cwd', 'the shorthand resolves to the identifier');
  ok(cls('shorthand.mjs') === 'work-unit', `and a shorthand cwd assigned from the root is still own-root (got ${cls('shorthand.mjs')})`);
  ok(cwdExpr('{ cwdOther: x, cwd: ROOT }') === 'ROOT', 'a longer key that merely starts with the name is not the cwd');

  /* THE SITE SET. A member form is the same call, and a comment is no call. */
  ok(childSites("cp.execFileSync('git', [], { cwd: ROOT });\n").length === 1, 'a namespaced child call is the same site');
  ok(childSites(bareSource("// execFileSync('git', [], { cwd: ROOT });\n", false)).length === 0, 'a commented-out call is not a site');
  ok(classifyTool("const P = `execFileSync('git', ['diff'], { cwd: ROOT });`;\n").cls === 'no-site', 'a planted call inside a template literal is not a site');
  ok(classifyTool("check(\"execFileSync('git', ['diff'], { cwd: ROOT });\");\n").cls === 'no-site', 'and a planted call inside a quoted argument is not a site either');
  ok(litBlanked('const a = `x`;\nconst b = 1;\n').split('\n').length === 3, 'blanking keeps every line');
  ok(/'git'/.test(litBlanked("execFileSync('git', ['rev-parse'], { cwd: ROOT });\n")), 'a real site keeps the argv literals this scan reads');
  ok(/execFileSync/.test(litBlanked("const s = 'see execFileSync(x) below';\n").replace(/ /g, '')) === false, 'a message that merely names a call loses the name, not the line');
  ok(childSites("spawnSync('git', []);\nspawn('git', []);\n").length === 2, 'the sync and async forms are both sites');
  ok(childSites("execFileSync('git', ['diff'\n").length === 1 && classifyTool("execFileSync('git', ['diff'\n").cls === 'undecidable', 'an unbalanced call abstains by name');
  ok(/do not balance/.test(classifyTool("execFileSync('git', ['diff'\n").sites[0].why), 'and says so');

  /* THE ORDER IS THE CLAIM. A proof of a defect outranks an abstention, which outranks every safe shape. */
  ok(classifyTool(PLANT['own-fixtures.mjs'] + PLANT['work-unit.mjs']).cls === 'work-unit', 'one own-root work-unit site outranks a sandbox');
  ok(classifyTool(PLANT['guarded.mjs'] + PLANT['tracked-tree.mjs']).cls === 'tracked-tree', 'a guarded site does not cover an unguarded one');
  ok(classifyTool(PLANT['undecidable.mjs'] + PLANT['guarded.mjs']).cls === 'undecidable', 'an abstention outranks a proof of safety');
  ok(classifyTool(PLANT['inherits.mjs'] + PLANT['two-checkouts.mjs']).cls === 'two-checkouts', 'and the caller-named tree outranks a bare inheritance');

  /* THE SECOND WAY A JUDGE NAMES ITS SUBJECT. `git -C <dir>` decides the repository git acts on. */
  ok(cls('git-c-root.mjs') === 'work-unit', `a \`-C\` pointed at the tool's own root is the same defect as a cwd (got ${cls('git-c-root.mjs')})`);
  ok(classifyTool(PLANT['git-c-root.mjs']).sites[0].via === 'git -C', 'and the row says which mechanism named the tree');
  ok(cls('git-c-argv.mjs') === 'two-checkouts', `a \`-C\` from the command line is the caller's tree (got ${cls('git-c-argv.mjs')})`);
  ok(gitTree(["'git'", "['-C', ROOT, 'diff']"]) === 'ROOT', 'the expression after the flag is the tree');
  ok(gitTree(["'git'", "['-C', ...rest]"]) === null, 'a spread after the flag names nothing');
  ok(gitTree(["'node'", "['-C', ROOT]"]) === null, 'and the flag means this only for git');
  ok(cwdExpr("['-C', cwd, ...args]") === null, 'an array element named cwd is not an options key');
  ok(classifyTool("execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });\n").sites[0].cls === 'undecidable', 'so a bare parameter there abstains rather than reading as inherited');

  /* THE PARAMETER HOP. Two of the eleven adopted tools take the tree as their first parameter. */
  ok(cls('git-c-param.mjs') === 'two-checkouts', `a parameter every caller fills from argv is the caller's tree (got ${cls('git-c-param.mjs')})`);
  ok(cls('param-cwd.mjs') === 'two-checkouts', `and the same holds for a cwd parameter (got ${cls('param-cwd.mjs')})`);
  ok(/every one of the 1 call\(s\) to `gitAt`/.test(classifyTool(PLANT['param-cwd.mjs']).sites[0].why), 'the hop names the owner and counts its callers');
  ok(
    classifyTool(
      `const ROOT = judgeRootOrDie(import.meta.url);\nfunction gitAt(root, args) {\n  return spawnSync('git', args, { cwd: root });\n}\nfunction head(root) {\n  return gitAt(root, ['rev-parse', 'HEAD']);\n}\nconst h = head(ROOT);\n`
    ).sites[0].cls === 'guarded',
    'a parameter passed straight through another function still reaches its callers'
  );
  ok(
    classifyTool(`${R}function gitAt(root, args) {\n  return spawnSync('git', args, { cwd: root });\n}\nconst a = gitAt(process.argv[2], ['status']);\nconst b = gitAt(ROOT, ['status']);\n`).sites[0]
      .cls === 'undecidable',
    'two callers that disagree decide nothing'
  );

  /* THE FILE-ROOT CHAIN the shared primitive does not carry. */
  ok(cls('file-chain.mjs') === 'work-unit', `a root reached through \`dirname(__filename)\` is still this tool's own (got ${cls('file-chain.mjs')})`);
  ok(rootsWithFileChain('const __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\n').has('__dirname'), 'the parent of a file root is a root');
  ok(
    !rootsWithFileChain("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');\nconst UP = dirname(ROOT);\n").has('UP'),
    'and the parent of a DIRECTORY root is not, because it leaves the checkout'
  );

  /* THE COMMIT STAMP IS NOT A JUDGEMENT OF A TREE. It names the code that produced the verdict. */
  ok(cls('own-commit.mjs') === 'own-commit', `a stamp of the tool's own HEAD is its own commit (got ${cls('own-commit.mjs')})`);
  ok(cls('own-commit-line.mjs') === 'own-commit', `and one whole command line reads the same (got ${cls('own-commit-line.mjs')})`);
  ok(argvTokens(["'git rev-parse --short HEAD'"]).length === 4, 'a single literal splits into its four tokens');
  ok(cls('toplevel.mjs') === 'work-unit', `\`--show-toplevel\` asks WHICH checkout, so it is no stamp (got ${cls('toplevel.mjs')})`);
  ok(asks(['git', 'rev-parse', 'HEAD', 'origin/main']) === 'work-unit', 'a second ref beside HEAD is a range, not a stamp');
  ok(asks(['git', 'log', '-1', '--format=%h']) !== 'own-commit', 'and the class stays narrow rather than reading every commit read');
  ok(classifyTool(PLANT['own-commit.mjs'] + PLANT['work-unit.mjs']).cls === 'work-unit', 'a real work-unit site outranks a stamp');
  ok(contradiction(classifyTool(PLANT['own-commit.mjs'])) === null, 'and an adopted tool that still stamps its own HEAD contradicts nothing');

  /* THE CONTROL, both directions. */
  ok(contradiction(classifyTool(PLANT['guarded.mjs'])) === null, 'an adopted tool whose sites are guarded agrees');
  ok(contradiction(classifyTool(PLANT['inherits.mjs'])) === null, 'an adopted tool whose child inherits the run tree agrees');
  ok(contradiction(classifyTool(PLANT['work-unit.mjs'])) !== null, 'an adopted tool still passing its own root contradicts its row');
  ok(/line 2 still hands `ROOT`/.test(contradiction(classifyTool(PLANT['work-unit.mjs']))), 'and the contradiction names the line and the expression');

  /* THE VERDICT ARITHMETIC. */
  const rows = [
    { name: 'a.mjs', set: 'adopted', ...classifyTool(PLANT['guarded.mjs']) },
    { name: 'b.mjs', set: 'adopted', ...classifyTool(PLANT['work-unit.mjs']) },
    { name: 'c.mjs', set: 'adopted', ...classifyTool(PLANT['undecidable.mjs']) }
  ];
  const v1 = verdict(rows, { adopted: ['a.mjs'], readings: {} }, { commit: 'deadbeef' });
  ok(v1.status === 'PASS' && v1.population.checked === 1 && v1.population.excluded === 0, 'one agreeing control passes');
  const v2 = verdict(rows, { adopted: ['a.mjs', 'b.mjs'], readings: {} }, { commit: 'deadbeef' });
  ok(v2.status === 'FAIL' && v2.result.contradictions === 1 && v2.reason !== null, 'one contradicting control fails and says so');
  ok(v2.population.checked + v2.population.excluded === v2.population.eligible, 'the population balances');
  const v3 = verdict(rows, { adopted: ['a.mjs', 'c.mjs'], readings: {} }, { commit: 'deadbeef' });
  ok(v3.status === 'PASS' && v3.population.excluded === 1, 'an abstaining row is excluded, not read as agreement');
  ok(/c\.mjs: this scan abstains/.test(v3.result.unexaminable[0]), 'and the excluded row is named with its reason');
  const v4 = verdict([], { adopted: ['a.mjs'], readings: {} }, { commit: 'deadbeef' });
  ok(v4.status === 'NOT_RUN' && /a\.mjs: the manifest names it/.test(v4.reason) && v4.result === null, 'an adopted row this scan never read examined nothing, and carries no number');
  const v5 = verdict([rows[2]], { adopted: ['c.mjs'], readings: {} }, { commit: 'deadbeef' });
  ok(v5.status === 'NOT_RUN' && v5.population.checked === 0, 'a control set that abstains throughout examined nothing');

  /* THE REFUSAL OBJECT. A run from outside the tree examines nothing and carries no number. */
  const nr = notRun(verdictRefusalReason('cwd-not-a-checkout', { tool: SELF, verb: 'judge' }), { commit: 'deadbeef' });
  ok(nr.status === 'NOT_RUN' && nr.result === null && nr.population.checked === 0, 'the refusal verdict examines nothing');
  ok(/judge/.test(nr.reason) && nr.reason.length > 20, `and it names what it would not judge (got ${nr.reason})`);

  console.log(fails.length ? `✗ judge-targets selftest: ${fails.length} of ${pass + fails.length} failed` : `✓ judge-targets selftest — all ${pass} assertions passed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  return fails.length ? 1 : 0;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--control', '--selftest', '--verdict-sample'], valued: ['--only'] }, { tool: SELF });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* A SAMPLE SCANS NOTHING, so it resolves no tree and runs from anywhere. */
  if (argv.includes('--verdict-sample')) {
    const sample = [{ name: 'x.mjs', set: 'adopted', ...classifyTool(PLANT['guarded.mjs']) }];
    console.log(JSON.stringify(verdict(sample, { pending: [], adopted: ['x.mjs'], exempt: [], readings: {} }), null, 2));
    process.exit(0);
  }
  /* THE TREE THIS SCAN JUDGES IS THE ONE THE RUN NAMED (brief §6.4, the first reading). It reads the
     judge arm's own manifest and the tracked source of every tool that arm names, so a cross-checkout
     run would census another work-unit's tools and call the answer this branch's. */
  let judged;
  try {
    judged = judgeRoot(import.meta.url);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    console.error(e.message);
    console.log(JSON.stringify(notRun(verdictRefusalReason(e.reason, { tool: SELF, verb: 'judge' })), null, 2));
    process.exit(2);
  }
  const { pop, rows } = scan(judged);
  const v = verdict(rows, pop);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const picked = only ? rows.filter((r) => r.name === only || r.name.endsWith(`/${only}`)) : rows;
  if (argv.includes('--json')) console.log(JSON.stringify({ verdict: v, rows: picked }, null, 2));
  else if (argv.includes('--control')) console.log(JSON.stringify(v, null, 2));
  else if (only) sites(picked);
  else {
    console.log(`▸ judge arm: ${rows.length} named tool(s) — ${pop.pending.length} pending, ${pop.adopted.length} adopted, ${pop.exempt.length} exempt\n`);
    table(rows);
    console.log(
      `\n  tepna.verdict/1: ${v.status}  ·  ${v.population.checked} checked / ${v.population.eligible} eligible / ${v.population.excluded} excluded  ·  ${v.result ? `${v.result.contradictions} contradiction(s)` : 'nothing examined'}`
    );
    for (const c of v.result?.contradicting || []) console.log(`    ✗ ${c}`);
    for (const u of v.result?.unexaminable || []) console.log(`    ⊘ ${u}`);
  }
  process.exit(v.status === 'FAIL' ? 1 : 0);
}
