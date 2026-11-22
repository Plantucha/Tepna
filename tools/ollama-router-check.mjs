#!/usr/bin/env node
/*
 * tools/ollama-router-check.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Puts the rig's Ollama router under the tool selftest gate. CI and `npm run test:tools` find
 * selftests by scanning `tools/*.mjs`, so a Python router and a shell watcher would run no check
 * there. This file runs both:
 *   · `python3 tools/ollama-router.py --selftest` (lane choice, prediction, embed-box turn order)
 *   · `bash -n tools/ollama-router-watch.sh` (the watcher parses)
 *
 * The live copies run from ~/bin (see the DEPLOY line in each file). `--drift` compares them with
 * this checkout and exits 1 when a deployed copy differs from the tracked one.
 *
 *   node tools/ollama-router-check.mjs --selftest
 *   node tools/ollama-router-check.mjs --drift
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ['ollama-router.py', 'ollama-router-watch.sh'];

/** @param {string} name @returns {'same' | 'differs' | 'absent'} */
export function driftOf(name, binDir = join(homedir(), 'bin')) {
  const live = join(binDir, name);
  if (!existsSync(live)) return 'absent';
  return readFileSync(live, 'utf8') === readFileSync(join(HERE, name), 'utf8') ? 'same' : 'differs';
}

function selftest() {
  let ok = 0;
  let fail = 0;
  const check = (name, cond) => {
    if (cond) ok++;
    else {
      fail++;
      console.log(`✗ ${name}`);
    }
  };
  const py = spawnSync('python3', [join(HERE, 'ollama-router.py'), '--selftest'], {
    encoding: 'utf8',
    env: { ...process.env, ROUTER_ENV_FILE: '/nonexistent', ROUTER_LOG: '/dev/null' }
  });
  check('router selftest exits 0', py.status === 0);
  check('router selftest prints ok', /selftest ok/.test(py.stdout || ''));
  const sh = spawnSync('bash', ['-n', join(HERE, 'ollama-router-watch.sh')], { encoding: 'utf8' });
  check('watcher parses', sh.status === 0);
  check('driftOf reports an absent live copy', driftOf('ollama-router.py', '/nonexistent') === 'absent');
  check('driftOf reports the tracked copy as same', driftOf('ollama-router.py', HERE) === 'same');
  console.log(fail === 0 ? `all ${ok} selftests passed` : `${ok} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--drift'] }, { tool: 'tools/ollama-router-check.mjs' });
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--drift')) {
    let bad = 0;
    for (const f of FILES) {
      const d = driftOf(f);
      console.log(`${d.padEnd(7)} ~/bin/${f}`);
      if (d !== 'same') bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  console.error('usage: node tools/ollama-router-check.mjs --selftest | --drift');
  process.exit(2);
}
