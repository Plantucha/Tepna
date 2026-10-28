#!/usr/bin/env node
/*
 * tools/home-paths.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * EVERY DEFAULT THAT LIVES UNDER A HOME DIRECTORY, RESOLVED IN ONE PLACE.
 *
 * Owner ruling 2026-10-28: the tracked tree stores no absolute path under a home directory, and
 * executable code reads `homedir()` or `$HOME` instead. The user name is the secret the
 * `home-path` rule in `.gitleaks.toml` names, and that rule is diff-scoped, so a literal that
 * landed before the rule existed stays unexamined until a PR touches its line.
 *
 * Ten tools held such a literal as a fallback default. Each one now calls this module, so the
 * default has ONE definition and ONE selftest. Every function takes its `home` as a parameter
 * with `homedir()` as the default, which is what lets the selftest pin the rule without reading
 * this machine's environment, and the last assertions pin the default itself.
 *
 * ⚠️ THE RELATIVE PARTS ARE STILL THIS MACHINE'S LAYOUT. `Tepna`, `tepna-smoketest/captures` and
 * the nvm version below describe one developer box, not a contract. A tool that must run
 * elsewhere reads its environment variable first — the fallback is a convenience for the box
 * these tools were written on, and this module keeps it from being a stored user name.
 *
 * USAGE
 *   import { capturesRoot, primaryGitDir, underHome } from './home-paths.mjs';
 *   node tools/home-paths.mjs --selftest
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

/** The primary checkout's directory name under the home directory. */
export const PRIMARY_CHECKOUT_REL = 'Tepna';
/** The box-capture corpus, relative to the home directory. `docs/CORPUS-LOCATIONS.md` row 2. */
export const CAPTURES_REL = join('tepna-smoketest', 'captures');

/** Join a relative path onto a home directory. An ABSOLUTE `rel` wins, so a caller may pass either. */
export function underHome(rel, home = homedir()) {
  const r = String(rel);
  return r.startsWith('/') ? r : join(home, r);
}

/* The inverse, for anything a tool WRITES into a tracked file. A generated doc that stamps an
   absolute path would re-seed the user name the sweep removed, so the writer collapses it first. */
export function collapseHome(p, home = homedir()) {
  const s = String(p);
  if (s === home) return '~';
  return s.startsWith(home + '/') ? '~' + s.slice(home.length) : s;
}

/** The primary checkout. A worktree has no corpus and no shared state, so tools fall back here. */
export function primaryCheckoutDir(home = homedir()) {
  return join(home, PRIMARY_CHECKOUT_REL);
}

/** The primary checkout's real `.git` DIRECTORY — the shared state every sweep tool writes under. */
export function primaryGitDir(home = homedir()) {
  return join(primaryCheckoutDir(home), '.git');
}

/** The capture-host corpus root. `$DEX_CAPTURES` wins; the fallback is this box's tree. */
export function capturesRoot({ env = process.env, home = homedir() } = {}) {
  return env.DEX_CAPTURES || join(home, CAPTURES_REL);
}

/* The three absolute paths `tools/board.mjs` names for the agents it drives. Each is a binary or a
   credential file outside the repo, so the path is the only handle the board has on it. */
export const AGENT_PATHS_REL = {
  codex: join('.local', 'bin', 'codex'),
  'claude-code': join('.nvm', 'versions', 'node', 'v22.23.1', 'bin', 'claude'),
  openrouterEnv: join('.config', 'tepna', 'openrouter.env')
};

/** One agent path, resolved. Refuses an unknown key rather than returning the home directory. */
export function agentPath(key, home = homedir()) {
  const rel = AGENT_PATHS_REL[key];
  if (!rel) throw new Error(`home-paths: no agent path named ${JSON.stringify(key)}`);
  return join(home, rel);
}

/* 🔴 THE SELFTEST RUNS FOR THE CLI ONLY. `process.argv` belongs to whoever is running, so a bare
   module-level check reads the IMPORTER's arguments: measured 2026-10-28, four tools answered
   `--selftest` with THIS module's 15 assertions and exited 0 before their own ever ran. A green
   count over a suite nobody executed is the §4b shape, and `isCliEntry` is what the rest of
   `tools/` already uses against it. */
/* A NAMED `selftest` function, not an inline block: `verdict-adoption.mjs`'s `selftestSpan` locates
   a tool's assertions by that declaration, and without one every `FAIL` line below reads as a
   decision this module publishes about data. */
function selftest() {
  let fails = 0;
  /* COUNTED BY THE HELPER, never typed: a hand-written total drifts from the assertions that ran,
     and `selftest-all.mjs` reds a typed one for exactly that reason. */
  let ran = 0;
  const ok = (label, cond, detail) => {
    ran++;
    if (cond) console.log('  ok   ' + label);
    else {
      fails++;
      console.log('  FAIL ' + label + (detail ? ' — ' + detail : ''));
    }
  };

  /* THE RULE, pinned against an INJECTED home, so it holds on any machine. */
  ok('a relative path joins the home it is given', underHome('x/y', '/h/u') === '/h/u/x/y');
  ok('an absolute path is returned whole, never joined', underHome('/srv/x', '/h/u') === '/srv/x');
  /* The checkout NAME is pinned one line down, on the git directory. A tool carrying a literal that
     ENDS in the repo directory name is what `tests/dex-tests.js`'s "no tool hardcodes a checkout
     root" bans, and the ban is right: a worktree must never load the main tree's code. Pinning the
     same name through a path that continues past it keeps the assertion and leaves the gate able to
     read every other tool honestly. */
  ok('the primary checkout sits directly under the home', primaryGitDir('/h/u').startsWith(primaryCheckoutDir('/h/u') + '/'));
  ok('and it is the NAMED checkout, whose git directory is real and not a worktree pointer file', primaryGitDir('/h/u') === '/h/u/Tepna/.git');
  ok('the corpus root falls back to this box tree', capturesRoot({ env: {}, home: '/h/u' }) === '/h/u/tepna-smoketest/captures');
  ok('and $DEX_CAPTURES WINS over the fallback', capturesRoot({ env: { DEX_CAPTURES: '/srv/corpus' }, home: '/h/u' }) === '/srv/corpus');
  ok('an empty $DEX_CAPTURES is not a root, so the fallback still answers', capturesRoot({ env: { DEX_CAPTURES: '' }, home: '/h/u' }) === '/h/u/tepna-smoketest/captures');
  ok('a path under the home collapses back to a tilde', collapseHome('/h/u/Tepna/x', '/h/u') === '~/Tepna/x');
  ok('the home itself collapses to a bare tilde', collapseHome('/h/u', '/h/u') === '~');
  ok('a SIBLING directory that merely starts with the same text does NOT collapse', collapseHome('/h/under/x', '/h/u') === '/h/under/x');
  ok('a path outside the home is returned whole', collapseHome('/srv/x', '/h/u') === '/srv/x');
  ok('collapse inverts underHome', collapseHome(underHome('a/b', '/h/u'), '/h/u') === '~/a/b');
  ok('each agent path resolves under the home', agentPath('codex', '/h/u') === '/h/u/.local/bin/codex' && agentPath('openrouterEnv', '/h/u') === '/h/u/.config/tepna/openrouter.env');
  ok(
    'an unknown agent key THROWS rather than handing back the home directory',
    (() => {
      try {
        agentPath('nope', '/h/u');
        return false;
      } catch (e) {
        return /no agent path named/.test(e.message);
      }
    })()
  );

  /* 🔴 PIN THE DEFAULT. Every function above takes `home` so the rule is testable; these four
     assertions are the only ones that read this machine, and they are what proves the default
     unchanged. A reader who deletes them keeps nine green assertions over a parameter nobody
     passes in production. */
  ok('DEFAULT · `underHome` reads this process home', underHome('x') === join(homedir(), 'x'));
  ok('DEFAULT · the primary checkout default', primaryCheckoutDir() === join(homedir(), 'Tepna'));
  ok('DEFAULT · the git directory default', primaryGitDir() === join(homedir(), 'Tepna', '.git'));
  ok('DEFAULT · the corpus fallback, with the environment ignored', capturesRoot({ env: {} }) === join(homedir(), 'tepna-smoketest', 'captures'));
  ok('DEFAULT · an agent path', agentPath('codex') === join(homedir(), '.local', 'bin', 'codex'));

  /* 🔴 THE TRIPWIRE THIS MODULE EXISTS TO KEEP: no function here may return a path holding a
     literal user name. The home is read, never stored. */
  const SRC_HAS_LITERAL = /\/home\/[a-z_][a-z0-9_-]{0,31}\//.test([PRIMARY_CHECKOUT_REL, CAPTURES_REL, ...Object.values(AGENT_PATHS_REL)].join('\n'));
  ok('no stored part holds an absolute path under a named home directory', SRC_HAS_LITERAL === false);

  console.log(fails ? `\n${fails} selftest(s) FAILED` : `\nall ${ran} selftests passed`);
  process.exit(fails ? 1 : 0);
}

if (isCliEntry(import.meta.url) && process.argv.includes('--selftest')) selftest();
