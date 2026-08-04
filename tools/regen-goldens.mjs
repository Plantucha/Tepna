#!/usr/bin/env node
/*
 * tools/regen-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Unified entry for the per-node golden regenerators (CPAP-REAL-CORPUS-FOLLOWUPS-III §3). Dispatches
 * to the node's recipe (regen-<node>-goldens.mjs), which shares all scaffolding via regen-goldens-core.mjs.
 * The per-node names remain valid entry points (referenced by CLAUDE.md / docs); this is the one-command
 * front door that replaces "remember which node's tool is called what".
 *
 *   node tools/regen-goldens.mjs --node CPAPDex            # regenerate + re-record + report what moved
 *   node tools/regen-goldens.mjs --node GlucoDex --check   # report only, write nothing (CI-safe)
 *   node tools/regen-goldens.mjs --all --check             # every node, ONE combined summary
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
const NODES = {
  CPAPDex: './regen-cpap-goldens.mjs',
  GlucoDex: './regen-glucodex-goldens.mjs',
  PulseDex: './regen-pulsedex-goldens.mjs',
  MotionDex: './regen-motiondex-goldens.mjs',
  OxyDex: './regen-oxydex-goldens.mjs',
  PpgDex: './regen-ppgdex-goldens.mjs',
  HRVDex: './regen-hrvdex-goldens.mjs',
  ECGDex: './regen-ecgdex-goldens.mjs',
  // §F1.5 — the Integrator is a consumer-on-top rather than a node, which is why it was missed; but it
  // carries a code-gated fixture with a live equiv leg, so it needs a sanctioned regen path like any node.
  Integrator: './regen-integrator-goldens.mjs'
};

const i = process.argv.indexOf('--node');
const name = i !== -1 ? process.argv[i + 1] : null;
const ALL = process.argv.includes('--all');

if (!ALL && (!name || !NODES[name])) {
  console.error(`usage: node tools/regen-goldens.mjs (--node <${Object.keys(NODES).join('|')}> | --all) [--check]`);
  process.exit(2);
}

if (!ALL) {
  // The recipe reads process.argv for --check itself; importing it runs the regeneration.
  await import(NODES[name]);
} else {
  /* REGEN-CORPUS-PATH-FOLLOWUPS-II §3 — "regenerate everything" used to be a hand-written nine-node
     shell loop, which is a step nobody repeats and nobody reviews. It also printed nine separate
     summaries, and reading nine `0 skipped` lines is exactly the conflation the parent brief removed:
     a HOLE in one node disappears into a wall of per-node output. One combined summary, with
     `NOT REACHED` kept distinct from `skipped`, is the whole point of having the flag.
     A CHILD PROCESS PER NODE, not nine imports into one realm: each recipe co-loads the real modules
     into its own realm and several define the same globals, so sharing a process would let one node's
     modules answer another node's regeneration — silently, and in the tool whose job is to be the
     trustworthy way to move an output byte. */
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const passthru = process.argv.slice(2).filter((a) => a !== '--all' && a !== '--node' && !NODES[a]);
  const tot = { moved: 0, minted: 0, skipped: 0, absent: 0 };
  const failed = [];
  const perNode = [];
  for (const [node, rel] of Object.entries(NODES)) {
    console.log(`\n\u25b8 ${node}`);
    const r = spawnSync(process.execPath, [path.join(HERE, rel), ...passthru], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out);
    if (r.status !== 0 && r.status !== 1) {
      failed.push(node + ' (exit ' + r.status + ')');
      continue;
    }
    const m = /^(?:regen|check): (\d+) fixture\(s\) moved, (\d+) minted, (\d+) skipped(?:, (\d+) NOT REACHED)?/m.exec(out);
    if (!m) {
      // A node that printed no summary did not report — never fold that into a zero.
      failed.push(node + ' (no summary line)');
      continue;
    }
    const one = { node, moved: +m[1], minted: +m[2], skipped: +m[3], absent: m[4] ? +m[4] : 0 };
    perNode.push(one);
    tot.moved += one.moved;
    tot.minted += one.minted;
    tot.skipped += one.skipped;
    tot.absent += one.absent;
  }
  const CHECK = process.argv.includes('--check');
  console.log('\n' + '\u2500'.repeat(78));
  console.log(
    `${CHECK ? 'check' : 'regen'} --all: ${tot.moved} moved, ${tot.minted} minted, ${tot.skipped} skipped, ${tot.absent} NOT REACHED across ${perNode.length}/${Object.keys(NODES).length} node(s)`
  );
  for (const n of perNode) {
    if (n.moved || n.minted || n.absent) console.log(`   ${n.node.padEnd(11)} ${n.moved} moved, ${n.minted} minted, ${n.absent} NOT REACHED`);
  }
  if (tot.absent) console.log(`   \u26a0 ${tot.absent} fixture(s) NOT REACHED — an input was absent, so this run did NOT cover them. Point DEX_UPLOADS at the corpus.`);
  if (failed.length) console.log(`   \u2717 ${failed.length} node(s) did not report: ${failed.join(', ')}`);
  // A node that failed to report is not a pass, in either mode.
  process.exit(failed.length || (CHECK && (tot.moved || tot.minted)) ? 1 : 0);
}
