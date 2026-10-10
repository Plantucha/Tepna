// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ONE DEFINITION OF THE RECOVERY, imported by `mutate.mjs` AND `mutation-crawl.mjs`.
   It lived inside mutate.mjs, which means it ran when mutate.mjs ran — one layer too deep. The
   SCHEDULED entry point is the crawl, so after a crawl exited leaving a mutant the tree stayed dirty
   until something happened to invoke mutate.mjs again. Measured 2026-10-10: `pulsedex-dsp.js` carried
   `for (let i2 = 0; i2 <= N; i2++)` with its `.mutate-backup` beside it for ~2 h, and
   `tepna-sync-main.timer` correctly SKIPped the dirty root for that whole window.
   ⚠️ A SECOND COPY WAS THE OBVIOUS FIX AND THE WRONG ONE. Two recovery routines drift on the next
   change to the backup format, and the one that drifts is the one nobody runs by hand. Extracted
   instead — mutate.mjs now imports what it used to define, so there is still exactly one.
   It is also why this is a module and not an import from mutate.mjs: mutate.mjs ACTS ON IMPORT
   (its own note at :1405 — importing it starts a multi-hour run), so nothing may import it. */
import { readdirSync, readFileSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

/* RECOVER FIRST, ALWAYS. A previous run killed mid-mutation leaves `<file>.mutate-backup` beside a
   mutated source. Restore it before doing anything, so the damage window closes on the next
   invocation instead of waiting to be noticed in a diff — or worse, committed. */
export function recoverStale(ROOT) {
  let out = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) continue;
      if (!e.name.endsWith('.mutate-backup')) continue;
      const bak = join(dir, e.name),
        target = bak.replace(/\.mutate-backup$/, '');
      try {
        writeFileSync(target, readFileSync(bak, 'utf8'));
        rmSync(bak, { force: true });
        out.push(target.replace(ROOT + '/', ''));
      } catch {}
    }
  };
  scan(ROOT);
  /* Orphaned worker worktrees from a killed sweep. `dropPool()` cannot run when the process is
     SIGKILLed or reaped by `timeout`, and each tree is a FULL checkout — 34 of them survived one
     killed run here, ~2.4 GB. Reap any that no live process owns before starting. */
  try {
    for (const e of readdirSync(join(ROOT, '..'), { withFileTypes: true })) {
      const m = e.name.match(/^\.mutate-w\d+-(\d+)$/);
      if (!m) continue;
      let alive = false;
      try {
        process.kill(+m[1], 0);
        alive = true;
      } catch {}
      if (alive) continue;
      const dir = join(ROOT, '..', e.name);
      /* rmSync alone — workers are hard links now, so there is no worktree registration to remove
         and removing a link cannot touch the repo's copy. `git worktree remove` is deliberately NOT
         attempted first: it is the call that went D-state here, and reaching for it during RECOVERY
         would wedge the very run trying to clean up after the last wedge.
         A leftover from an OLD run predating this change is still a registered worktree; `git
         worktree prune` below reaps that registration once the directory is gone. */
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      out.push(e.name + ' (orphaned worker tree)');
    }
    /* Cheap, touches no working tree, and clears registrations left by pre-2026-08-13 runs. */
    execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' });
  } catch {}
  try {
    scan(join(ROOT, 'tools'));
  } catch {}
  if (out.length) console.error('  ⚠ recovered ' + out.length + ' file(s) from a killed run: ' + out.join(', '));
}
/* The REFUSAL's evidence: what is pending before anything is restored, so a caller can name the
   files in its reason rather than saying "something was dirty". Read-only. */
export function pendingBackups(ROOT) {
  const out = [];
  try {
    for (const e of readdirSync(ROOT, { withFileTypes: true })) {
      if (!e.isDirectory() && e.name.endsWith('.mutate-backup')) out.push(e.name.replace(/\.mutate-backup$/, ''));
    }
  } catch {}
  return out.sort();
}
