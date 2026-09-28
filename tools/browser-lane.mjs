#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * browser-lane.mjs — ONE COMMAND for the local browser lane: `npm run gates:browser:local`.
 *
 * WHY THIS EXISTS. `tests/browser-gates.mjs` has always been runnable locally, and never with one
 * command: it needs an http origin (the suite is same-origin, `file://` will not do) and takes it
 * from `BASE_URL`, so every session hand-rolled "start a server, guess a port, export BASE_URL,
 * remember to kill the server". Measured cost on 2026-09-27 alone: two re-runs in one session, one
 * of them from a scratch script still pointing at `node_modules` inside a worktree that had been
 * reclaimed hours earlier — it raised ERR_MODULE_NOT_FOUND where a verdict should have been, and a
 * reader glancing at the JS gate's EXIT=0 beside it would have recorded a lane that never ran. The
 * failure mode is not the browser; it is that the invocation lives in scratch files with absolute
 * paths, so it goes stale silently. An entry point in the repo cannot.
 *
 * WHAT IT DOES NOT DO. It is NOT part of `npm run check`. The lane needs a browser, and `check` must
 * stay runnable on a box that has none; CI runs the browser lane as its own job. Keeping it out is
 * deliberate, not an omission.
 *
 * THREE THINGS IT REFUSES TO GET WRONG
 *   · THE SERVER IS IN-PROCESS. Nothing to kill, so nothing to leak: no child `http.server`, no PID
 *     to hunt, no `pkill -f` (which matches its own command line — CLAUDE.md §👥.4, exit 144). It
 *     listens on port 0 and asks the OS which port it got, so two sessions can run it at once.
 *   · THE EXIT CODE IS THE LANE'S. The child's code is this process's code. Never a pipe's, never
 *     tail's (§4b: a truncated result is not the verdict).
 *   · `--label <text>` IS FORWARDED, and the gate fails if that assertion name never appeared. That
 *     is the "did my assertions actually execute" check sessions kept re-deriving by reopening the
 *     page in a scratch script; it belongs in the gate that already has the page open.
 *
 * USAGE
 *   npm run gates:browser:local
 *   npm run gates:browser:local -- --label "the brief's 09-26 classic row" --label "…"
 *   node tools/browser-lane.mjs --selftest        # no browser, no server
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.edf': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

/* PURE, so the traversal refusal is testable without a socket. Returns an absolute path inside ROOT,
   or null. A served tree is the whole checkout, so `..` must not walk out of it: the suite only ever
   asks for paths it was built with, and a handler that trusts the URL is how a local dev server
   becomes a file-read primitive. */
export function resolveServedPath(urlPath, root = ROOT) {
  let p;
  try {
    p = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (!p || p === '/') p = '/Dex-Test-Suite.html';
  if (p.indexOf('\0') >= 0) return null;
  const abs = normalize(join(root, p));
  if (abs !== root && !abs.startsWith(root + sep)) return null; // escaped the checkout
  return abs;
}

export function contentTypeFor(abs, types = TYPES) {
  const dot = abs.lastIndexOf('.');
  return (dot >= 0 && types[abs.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

if (process.argv.slice(2).includes('--selftest')) {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const R = '/repo';
  ok(resolveServedPath('/', R) === join(R, 'Dex-Test-Suite.html'), 'bare / serves the suite');
  ok(resolveServedPath('/Dex-Test-Suite.html?full', R) === join(R, 'Dex-Test-Suite.html'), 'a query string is stripped, not served as part of the name');
  ok(resolveServedPath('/tools/pw-launch.mjs', R) === join(R, 'tools/pw-launch.mjs'), 'a nested path resolves');
  ok(resolveServedPath('/PAT%20Classic%20vs%20Fused.html', R) === join(R, 'PAT Classic vs Fused.html'), 'a percent-encoded space decodes — the analysis tools have spaces in their names');
  /* TRAVERSAL: every shape that walks out of the checkout is refused, including the encoded one. */
  ok(resolveServedPath('/../etc/passwd', R) === null, 'a ../ escape is refused');
  ok(resolveServedPath('/a/../../etc/passwd', R) === null, 'a nested ../ escape is refused');
  ok(resolveServedPath('/%2e%2e/etc/passwd', R) === null, 'an ENCODED ../ escape is refused (decode happens before the check)');
  ok(resolveServedPath('/x\0.html', R) === null, 'a NUL byte is refused');
  ok(resolveServedPath('/%ZZ', R) === null, 'an undecodable path is refused rather than guessed');
  /* …and a sibling directory that merely SHARES THE PREFIX is not inside the checkout. */
  ok(resolveServedPath('/../repo-evil/x', R) === null, 'a sibling with the same prefix is outside (the sep test, not a startsWith on the bare root)');
  ok(contentTypeFor('/x/a.html') === 'text/html; charset=utf-8', 'html type');
  ok(contentTypeFor('/x/a.MJS') === 'text/javascript; charset=utf-8', 'extension match is case-insensitive');
  ok(contentTypeFor('/x/a.unknown') === 'application/octet-stream', 'an unknown extension falls back to octet-stream rather than guessing text');
  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'all 13 selftests passed');
  process.exit(fails.length ? 1 : 0);
}

const server = createServer((req, res) => {
  const abs = resolveServedPath(req.url);
  if (!abs) {
    res.writeHead(403).end('refused');
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentTypeFor(abs), 'Cache-Control': 'no-store' });
  createReadStream(abs).pipe(res);
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address(); // ASK the OS which port it gave — never assume one is free
  const base = `http://127.0.0.1:${port}`;
  console.log(`browser-lane: serving ${ROOT} at ${base}`);
  const child = spawn(process.execPath, [join(ROOT, 'tests/browser-gates.mjs'), ...process.argv.slice(2)], {
    cwd: ROOT,
    env: { ...process.env, BASE_URL: base },
    stdio: 'inherit'
  });
  /* THE LANE'S VERDICT IS THIS PROCESS'S VERDICT. A signal death is not a pass: it becomes 1, never 0. */
  child.on('exit', (code, signal) => {
    server.close();
    if (signal) {
      console.error(`browser-lane: the gate died on ${signal} — no verdict was reached`);
      process.exit(1);
    }
    process.exit(code == null ? 1 : code);
  });
  child.on('error', (e) => {
    server.close();
    console.error('browser-lane: could not start the gate — ' + e.message);
    process.exit(1);
  });
});
