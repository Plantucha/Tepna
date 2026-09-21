/*
 * tools/pw-launch.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ONE PLACE THAT KNOWS WHY CHROMIUM CANNOT START ON THIS BOX — the Playwright launch arguments every
 * headless tool and gate shares, with the AppArmor user-namespace case detected and named.
 *
 * Residue `2026-09-05-playwright-blocked-by-apparmor-userns`: on Ubuntu 23.10+ with
 * `kernel.apparmor_restrict_unprivileged_userns = 1`, `chromium.launch()` RESOLVES and the first
 * `newPage()` then fails with "Target page, context or browser has been closed" — a message that names
 * neither the cause nor the remedy. Chromium itself says it when run by hand ("No usable sandbox!").
 * Five launch sites carried five private arg lists and none of them knew this; `tests/csp-harness.mjs`
 * hard-codes `--no-sandbox` unconditionally, which is the remedy applied without the reason.
 *
 * `launch(chromium, opts)` launches WITH the sandbox, proves it with one `newPage()`, and only on that
 * specific failure relaunches `--no-sandbox` — printing one line to stderr that names the failure AND
 * what the sysctl reads. Never silently, and never on a box where the sandbox works: on 2026-09-21 the
 * rig's sysctl still read 1 and the sandboxed launch WORKED (the 09-05 failure did not reproduce, and
 * why it stopped is not established), so keying the remedy on the sysctl alone would have dropped a
 * working sandbox on a guess. CI runners do not carry the policy, so CI is unchanged by construction.
 *
 *   node tools/pw-launch.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYSCTL_PATH = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';

/* `1` ⇒ restricted. Absent (non-Ubuntu, non-Linux, no AppArmor) ⇒ null, which is "not restricted"
   for the launch decision but is reported as unknown rather than as a measured 0. */
export function apparmorRestrictsUserns(path = SYSCTL_PATH) {
  try {
    return readFileSync(path, 'utf8').trim() === '1';
  } catch {
    return null;
  }
}

/* Base args every site shares. `--disable-dev-shm-usage`: a container's /dev/shm is small and the
   flag costs nothing elsewhere. */
export function launchArgs(extra = []) {
  return ['--disable-dev-shm-usage', ...extra];
}

/* The failure the row records: `launch()` resolves, the first `newPage()` rejects. */
export function looksLikeSandboxDeath(err) {
  return /Target page, context or browser has been closed|No usable sandbox|zygote/i.test(String(err && err.message ? err.message : err));
}

/* Launch WITH the sandbox, prove it with one `newPage()`, and only on the row's specific failure
   relaunch `--no-sandbox` — saying so, and saying what the sysctl reads, on stderr. The sandbox is a
   real protection where it works, and on 2026-09-21 it DID work on the rig with the sysctl still at
   1 (the 09-05 failure did not reproduce; cause of its disappearance not established — no sudo for
   `aa-status`), so an unconditional `--no-sandbox` keyed on the sysctl would have removed a working
   sandbox on a guess. `launcher` is the Playwright browser type (`chromium`); `opts` its launch options. */
export async function launch(launcher, opts = {}, io = {}) {
  const log = io.log || ((m) => process.stderr.write(m + '\n'));
  const tryOnce =
    io.tryOnce ||
    (async (o) => {
      const b = await launcher.launch(o);
      try {
        const p = await b.newPage();
        await p.close();
      } catch (e) {
        await b.close().catch(() => {});
        throw e;
      }
      return b;
    });
  const first = { ...opts, args: launchArgs(opts.args || []) };
  try {
    return await tryOnce(first);
  } catch (e) {
    if (!looksLikeSandboxDeath(e)) throw e;
    const r = apparmorRestrictsUserns(io.sysctlPath);
    log(
      '  pw-launch: sandboxed launch died at newPage (' +
        String(e.message || e)
          .split('\n')[0]
          .slice(0, 60) +
        ') — ' +
        'kernel.apparmor_restrict_unprivileged_userns = ' +
        (r === null ? 'absent' : r ? '1' : '0') +
        '; relaunching --no-sandbox (residue 2026-09-05-playwright-blocked-by-apparmor-userns)'
    );
    return tryOnce({ ...first, args: [...first.args, '--no-sandbox'] });
  }
}

async function selftest() {
  const fails = [];
  const ok = (c, m) => (c ? null : fails.push(m));
  const dir = mkdtempSync(join(tmpdir(), 'pw-launch-'));
  writeFileSync(dir + '/on', '1\n');
  writeFileSync(dir + '/off', '0\n');
  ok(apparmorRestrictsUserns(dir + '/on') === true, 'sysctl 1 → restricted');
  ok(apparmorRestrictsUserns(dir + '/off') === false, 'sysctl 0 → not restricted');
  ok(apparmorRestrictsUserns(dir + '/absent') === null, 'absent sysctl → null, not false');
  ok(launchArgs(['--x']).includes('--disable-dev-shm-usage') && launchArgs(['--x']).includes('--x'), 'base args + extras');
  ok(looksLikeSandboxDeath(new Error('browser.newPage: Target page, context or browser has been closed')), "recognises the row's message");
  ok(!looksLikeSandboxDeath(new Error('ECONNREFUSED')), 'an unrelated error is not a sandbox death');
  // sandbox works → one attempt, no --no-sandbox, silent
  const calls = [];
  const logged = [];
  const b1 = await launch(null, { args: ['--x'] }, { tryOnce: async (o) => (calls.push(o.args), 'B'), log: (m) => logged.push(m), sysctlPath: dir + '/on' });
  ok(b1 === 'B' && calls.length === 1 && !calls[0].includes('--no-sandbox') && logged.length === 0, 'sandbox OK: one attempt, sandbox kept, silent');
  // sandbox dies with the row's message → second attempt with --no-sandbox, logged with the sysctl
  calls.length = 0;
  const b2 = await launch(
    null,
    { args: ['--x'] },
    {
      tryOnce: async (o) => {
        calls.push(o.args);
        if (!o.args.includes('--no-sandbox')) throw new Error('browser.newPage: Target page, context or browser has been closed');
        return 'B2';
      },
      log: (m) => logged.push(m),
      sysctlPath: dir + '/on'
    }
  );
  ok(b2 === 'B2' && calls.length === 2 && calls[1].includes('--no-sandbox') && calls[1].includes('--x'), 'sandbox death: relaunched --no-sandbox with extras kept');
  ok(logged.length === 1 && /= 1;/.test(logged[0]) && /no-sandbox/.test(logged[0]), 'sandbox death: says so once, with the sysctl');
  // an unrelated failure is NOT retried without the sandbox
  calls.length = 0;
  let thrown = null;
  await launch(
    null,
    {},
    {
      tryOnce: async (o) => {
        calls.push(o.args);
        throw new Error('ECONNREFUSED');
      },
      log: () => {}
    }
  ).catch((e) => {
    thrown = e;
  });
  ok(thrown && /ECONNREFUSED/.test(thrown.message) && calls.length === 1, 'unrelated failure: rethrown, never retried unsandboxed');
  for (const f of fails) console.error('  ✗ ' + f);
  console.log(fails.length ? fails.length + ' failed of 10' : 'all 10 selftests passed');
  return fails.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--selftest')) selftest().then((c) => process.exit(c));
