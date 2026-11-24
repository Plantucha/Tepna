#!/usr/bin/env node
/*
 * tools/gpu-gate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * MAY A LOCAL MODEL USE THE CARD NOW? One answer for every unattended qwen job.
 *
 * `qwen3-coder:30b` runs at about 107 tok/s on a free card and at 2 to 28 tok/s when a GPU job holds
 * 8 GB of it, because the weights spill to the CPU (measured 2026-11-24, beside `finch-p75g`). Such a
 * job also slows the GPU job. So a model that does not fit waits.
 *
 * A LOADED model is not proof: the server reports a spilled load as loaded. The test is how much of
 * the model file sits on the card (`size_vram` against the file size), never the bare name.
 *
 * USAGE
 *   node tools/gpu-gate.mjs --model qwen3-coder:30b [--wait-min 0]   # exit 0 fits · 4 busy
 *   node tools/gpu-gate.mjs --selftest
 */
import { readFileSync } from 'node:fs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { boundedFetch } from './net-bound.mjs';

const VRAM = '/sys/class/drm/card1/device';
export const HEADROOM_B = 0.5e9;
/** The share of the model file that must sit on the card before a loaded model counts as whole. */
export const WHOLE_SHARE = 0.9;
/** The exit code of a job that stopped because the card is busy. Its work is not finished. */
export const EXIT_BUSY = 4;

/** Pure: may the model run now? A whole loaded model may; a spilled one may not; else the card needs its size plus headroom. */
export function vramAllows({ loaded, sizeB, sizeVram = null, total, used }) {
  if (loaded && sizeB && sizeVram != null && sizeVram < WHOLE_SHARE * sizeB)
    return { ok: false, unload: true, why: `the model is loaded but spilled: ${(sizeVram / 1e9).toFixed(1)} of ${(sizeB / 1e9).toFixed(1)} GB on the card` };
  if (loaded) return { ok: true, why: 'model already loaded' };
  if (!sizeB) return { ok: false, why: 'model size unknown (not pulled?)' };
  if (total == null) return { ok: false, why: 'VRAM counters unreadable' };
  const free = total - used;
  return free >= sizeB + HEADROOM_B
    ? { ok: true, why: `free ${(free / 1e9).toFixed(1)} GB ≥ ${(sizeB / 1e9).toFixed(1)} + 0.5` }
    : { ok: false, why: `free ${(free / 1e9).toFixed(1)} GB < ${(sizeB / 1e9).toFixed(1)} + 0.5 GB (a GPU job holds the card)` };
}

/** The live answer for one model. An unreachable server is not a busy card, so it throws. */
export async function gpuState(model, host) {
  const get = async (p) => (await boundedFetch(host + p, {}, { cls: 'model', ms: 10_000, label: `gpu-gate ${p}` })).json();
  const [tags, ps] = [await get('/api/tags'), await get('/api/ps')];
  const row = (ps.models || []).find((m) => m.name === model);
  let v = null;
  try {
    v = { total: +readFileSync(`${VRAM}/mem_info_vram_total`, 'utf8'), used: +readFileSync(`${VRAM}/mem_info_vram_used`, 'utf8') };
  } catch {
    // unreadable counters refuse in vramAllows
  }
  const sizeB = (tags.models || []).find((m) => m.name === model)?.size ?? null;
  return vramAllows({ loaded: Boolean(row), sizeB, sizeVram: row?.size_vram ?? null, total: v?.total ?? null, used: v?.used ?? null });
}

/** Asks the server to unload the model after its current request, so the card goes back to the GPU job. */
export async function unload(model, host) {
  await boundedFetch(`${host}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }, { cls: 'model', ms: 60_000, label: 'gpu-gate unload' });
}

/** Waits until `state()` allows the model, at most `waitMin` minutes. A spilled model is unloaded first. */
export async function waitForGpu({ state, drop, waitMin, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, everyMs = 60_000 }) {
  const end = now() + waitMin * 60_000;
  let said = null;
  for (;;) {
    const g = await state();
    if (g.ok) return g;
    if (g.unload) await drop();
    if (now() >= end) return g;
    if (said === null) log(`  ⏸ GPU gate: ${g.why}; waiting at most ${waitMin} min`);
    said = g.why;
    await sleep(Math.min(everyMs, Math.max(end - now(), 1)));
  }
}

async function selftest() {
  let bad = 0;
  let n = 0;
  const ck = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    n++;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  };
  const m = { sizeB: 18.6e9, total: 21.4e9 };
  ck('a whole loaded model passes', vramAllows({ ...m, loaded: true, sizeVram: 19.1e9, used: 20e9 }).ok, true);
  const sp = vramAllows({ ...m, loaded: true, sizeVram: 10.1e9, used: 19.4e9 });
  ck('a spilled loaded model is refused and unloaded (2026-11-24 figures)', [sp.ok, sp.unload], [false, true]);
  ck('the whole-share bound is inclusive', vramAllows({ ...m, sizeB: 10e9, loaded: true, sizeVram: 9e9, used: 0 }).ok, true);
  ck('a loaded model with no size on record passes, as before', vramAllows({ loaded: true, sizeB: 0, total: null, used: 0 }).ok, true);
  ck('a GPU job refuses the load', vramAllows({ ...m, loaded: false, used: 8e9 }).ok, false);
  ck('a free card allows the load', vramAllows({ ...m, loaded: false, used: 1.5e9 }).ok, true);
  ck('unreadable counters refuse', vramAllows({ loaded: false, sizeB: 1e9, total: null, used: null }).ok, false);
  const run = async (answers, waitMin) => {
    let t = 0;
    let i = 0;
    let drops = 0;
    const g = await waitForGpu({
      state: async () => answers[Math.min(i++, answers.length - 1)],
      drop: async () => {
        drops++;
      },
      waitMin,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t
    });
    return [g.ok, i, drops];
  };
  ck('wait 0 asks once and returns busy', await run([{ ok: false, why: 'x' }], 0), [false, 1, 0]);
  ck(
    'a card that frees ends the wait',
    await run(
      [
        { ok: false, why: 'x' },
        { ok: false, why: 'x' },
        { ok: true, why: 'y' }
      ],
      60
    ),
    [true, 3, 0]
  );
  ck(
    'a spilled model is dropped, then waited for',
    await run(
      [
        { ok: false, unload: true, why: 'x' },
        { ok: true, why: 'y' }
      ],
      60
    ),
    [true, 2, 1]
  );
  ck('the wait ends', (await run([{ ok: false, why: 'x' }], 3)).slice(0, 2), [false, 4]);
  console.log(bad ? `gpu-gate selftest: ${bad} FAILED` : `all ${n} selftests passed`);
  return bad ? 1 : 0;
}

const SPEC = { valued: ['--model', '--wait-min'], boolean: ['--selftest'] };
if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, SPEC, { tool: 'gpu-gate' });
  const val = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  if (argv.includes('--selftest')) process.exit(await selftest());
  const model = val('--model', '');
  if (!model) {
    console.error('usage: node tools/gpu-gate.mjs --model <name> [--wait-min N]');
    process.exit(2);
  }
  const host = process.env.QWEN_FEEDER_OLLAMA || 'http://127.0.0.1:11434';
  const g = await waitForGpu({ state: () => gpuState(model, host), drop: () => unload(model, host), waitMin: Number(val('--wait-min', '0')), log: (s) => console.error(s) });
  console.log(`gpu-gate ${model}: ${g.ok ? 'fits' : 'BUSY'}; ${g.why}`);
  process.exit(g.ok ? 0 : EXIT_BUSY);
}
