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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

/* THE OTHER WAY A LAUNCH DIES ON A DEV BOX (2026-09-26): Playwright's bundled Chromium is not
   downloaded — `browserType.launch: Executable doesn't exist at …/ms-playwright/chromium-…` — and
   the advice it prints (`npx playwright install`) is a network download the no-network rule forbids
   and CI never needs. The box has a system Chrome (memory `browser-lane-runnable-headless`, Aug 12:
   /usr/bin/google-chrome), and the browser lane runs fine on it. So on THAT failure, and only that
   one, relaunch with `executablePath` = the first system Chrome found (or $TEPNA_CHROME), saying so
   once on stderr. Two browser-lane reds shipped tonight (#3119, #3128) that a local run would have
   caught; the lane was "unrunnable" only because this fallback did not exist. */
export const SYSTEM_CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
export function looksLikeMissingBrowser(err) {
  return /Executable doesn't exist|browserType\.launch: .*(not found|does not exist)|playwright install/i.test(String(err && err.message ? err.message : err));
}
export function systemChrome({ env = process.env, exists = existsSync, candidates = SYSTEM_CHROME_CANDIDATES } = {}) {
  if (env.TEPNA_CHROME) return exists(env.TEPNA_CHROME) ? env.TEPNA_CHROME : null;
  for (const c of candidates) if (exists(c)) return c;
  return null;
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
  /* Missing bundled browser ⇒ one relaunch on the system Chrome, then the sandbox logic below applies
     to that attempt as to any other. A missing browser with no system Chrome is rethrown as-is. */
  const withBrowser = async (o) => {
    try {
      return await tryOnce(o);
    } catch (e) {
      if (o.executablePath || !looksLikeMissingBrowser(e)) throw e;
      const sys = (io.systemChrome || systemChrome)();
      if (!sys) throw e;
      log(
        '  pw-launch: bundled Chromium missing (' +
          String(e.message || e)
            .split('\n')[0]
            .slice(0, 60) +
          ') — relaunching on ' +
          sys +
          ' (set TEPNA_CHROME to choose)'
      );
      return tryOnce({ ...o, executablePath: sys });
    }
  };
  try {
    return await withBrowser(first);
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
    return withBrowser({ ...first, args: [...first.args, '--no-sandbox'] });
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
  // missing bundled browser → relaunched once on the system Chrome, logged once, sandbox kept
  ok(looksLikeMissingBrowser(new Error("browserType.launch: Executable doesn't exist at /x/ms-playwright/chromium-1140/chrome-linux/chrome")), 'recognises the missing-browser message');
  ok(!looksLikeMissingBrowser(new Error('browser.newPage: Target page, context or browser has been closed')), 'a sandbox death is not a missing browser');
  ok(systemChrome({ env: {}, exists: (p) => p === '/usr/bin/chromium' }) === '/usr/bin/chromium', 'first existing candidate wins');
  ok(systemChrome({ env: { TEPNA_CHROME: '/opt/c' }, exists: (p) => p === '/opt/c' }) === '/opt/c', 'TEPNA_CHROME overrides');
  ok(systemChrome({ env: { TEPNA_CHROME: '/opt/missing' }, exists: () => false }) === null, 'a TEPNA_CHROME that does not exist is null, not a guess');
  ok(systemChrome({ env: {}, exists: () => false }) === null, 'no system Chrome → null');
  const mcalls = [];
  const mlog = [];
  const b3 = await launch(
    null,
    { args: ['--x'] },
    {
      tryOnce: async (o) => {
        mcalls.push(o);
        if (!o.executablePath) throw new Error("browserType.launch: Executable doesn't exist at /x/chrome");
        return 'B3';
      },
      log: (m) => mlog.push(m),
      systemChrome: () => '/usr/bin/google-chrome',
      sysctlPath: dir + '/on'
    }
  );
  ok(
    b3 === 'B3' && mcalls.length === 2 && mcalls[1].executablePath === '/usr/bin/google-chrome' && !mcalls[1].args.includes('--no-sandbox'),
    'missing browser: relaunched on the system Chrome, sandbox kept'
  );
  ok(mlog.length === 1 && /google-chrome/.test(mlog[0]) && /TEPNA_CHROME/.test(mlog[0]), 'missing browser: says so once and names the override');
  // missing browser and NO system Chrome → rethrown, one attempt
  mcalls.length = 0;
  let thrown2 = null;
  await launch(
    null,
    {},
    {
      tryOnce: async (o) => {
        mcalls.push(o);
        throw new Error("Executable doesn't exist at /x");
      },
      log: () => {},
      systemChrome: () => null
    }
  ).catch((e) => {
    thrown2 = e;
  });
  ok(thrown2 && /Executable doesn't exist/.test(thrown2.message) && mcalls.length === 1, 'missing browser, no system Chrome: rethrown, one attempt');
  for (const f of fails) console.error('  ✗ ' + f);
  console.log(fails.length ? fails.length + ' failed of 19' : 'all 19 selftests passed');
  return fails.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--selftest')) selftest().then((c) => process.exit(c));
