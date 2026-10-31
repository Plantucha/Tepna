#!/usr/bin/env node
/*
 * tools/plan-slim.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * A SLIM COPY OF THE CLAUDE CODE SESSION LOGS, FOR THE BOARD'S PLAN PRICER.
 *
 * `tools/board.mjs` prices the session logs with ccusage. This module keeps the slim copy that
 * ccusage reads instead of the logs. It reads session logs, not the capture corpus.
 *
 *   node tools/plan-slim.mjs --selftest
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

/* THE PRICER READS A SLIM COPY OF THE TRANSCRIPTS, NEVER THE TRANSCRIPTS. ccusage reads each session
   log whole into memory before it filters by date. Measured 2026-10-31: four live logs held 4.75 GB (the
   largest 1.7 GB), the ccusage child held 4.7 to 6.0 GB on each 10-minute run, and tepna-board.service
   peaked at 6.7 to 8.5 GB while the OOM killer took lab jobs and the desktop app. ccusage prices only
   the records that carry `message.usage`, so the copy keeps those records and only the fields it reads.
   Transcripts are append-only, so each run reads only the bytes added since the last run. A shorter
   file starts again from 0. On 2026-10-31 the slim copy gave ccusage the same 35 blocks and the same
   $3,456.13 as the full logs, with the child at 0.65 GB. */
const SLIM_KEEP = ['type', 'timestamp', 'requestId', 'costUSD', 'isApiErrorMessage', 'sessionId', 'cwd', 'version'];
const USAGE_KEY = Buffer.from('"usage"');
export function slimRecord(line) {
  if (line.indexOf(USAGE_KEY) === -1) return null;
  let o;
  try {
    o = JSON.parse(line.toString('utf-8'));
  } catch {
    return null;
  }
  const m = o?.message;
  if (!m?.usage) return null;
  const out = {};
  for (const k of SLIM_KEEP) if (k in o) out[k] = o[k];
  out.message = { id: m.id, model: m.model, usage: m.usage };
  return JSON.stringify(out);
}
export function slimTranscripts(srcDirs, cacheDir, sinceMs) {
  const statePath = path.join(cacheDir, 'offsets.json');
  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    state = {};
  }
  const seen = new Set();
  let kept = 0;
  const buf = Buffer.alloc(8 << 20);
  srcDirs.forEach((root, ri) => {
    for (const proj of existsSync(root) ? readdirSync(root) : []) {
      let names;
      try {
        names = readdirSync(path.join(root, proj)).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of names) {
        const src = path.join(root, proj, f);
        const st = statSync(src);
        if (st.mtimeMs < sinceMs) continue;
        seen.add(src);
        const dst = path.join(cacheDir, 'projects', `${ri}-${proj}`, f);
        let s = state[src];
        if (!s || s.ino !== st.ino || st.size < s.offset || !existsSync(dst)) {
          s = { ino: st.ino, offset: 0, dst };
          mkdirSync(path.dirname(dst), { recursive: true });
          writeFileSync(dst, '');
        }
        const fd = openSync(src, 'r');
        try {
          let carry = Buffer.alloc(0);
          let pos = s.offset;
          for (let n = readSync(fd, buf, 0, buf.length, pos); n > 0; n = readSync(fd, buf, 0, buf.length, pos)) {
            pos += n;
            const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
            const out = [];
            let start = 0;
            for (let nl = chunk.indexOf(10, start); nl !== -1; nl = chunk.indexOf(10, start)) {
              const rec = slimRecord(chunk.subarray(start, nl));
              if (rec) out.push(rec);
              start = nl + 1;
            }
            carry = Buffer.from(chunk.subarray(start));
            s.offset = pos - carry.length;
            if (out.length) appendFileSync(dst, `${out.join('\n')}\n`);
            kept += out.length;
          }
        } finally {
          closeSync(fd);
        }
        state[src] = s;
      }
    }
  });
  for (const src of Object.keys(state)) {
    if (seen.has(src)) continue;
    rmSync(state[src].dst, { force: true });
    delete state[src];
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
  return { files: seen.size, kept };
}

function runSelftest() {
  const fails = [];
  let ran = 0;
  const ok = (cond, label) => {
    ran++;
    if (!cond) fails.push(label);
  };
  {
    const root = mkdtempSync(path.join(tmpdir(), 'board-slim-'));
    try {
      const src = path.join(root, 'src');
      const cache = path.join(root, 'cache');
      mkdirSync(path.join(src, 'p'), { recursive: true });
      const f = path.join(src, 'p', 's.jsonl');
      const use = (id) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-31T12:00:00Z',
          requestId: `r${id}`,
          message: { id: `m${id}`, model: 'm', content: [{ type: 'text', text: 'x'.repeat(5000) }], usage: { input_tokens: 1, output_tokens: 2 } }
        });
      const prompt = JSON.stringify({ type: 'user', message: { content: 'a prompt that names "usage" in its text' } });
      const second = use(2);
      writeFileSync(f, `${use(1)}\n${prompt}\n${second.slice(0, 40)}`);
      const dst = path.join(cache, 'projects', '0-p', 's.jsonl');
      const lines = () =>
        readFileSync(dst, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      const r1 = slimTranscripts([src], cache, 0);
      ok(r1.kept === 1 && lines().length === 1, 'a usage record is kept, a prompt that names "usage" is not, and a half-written last line waits');
      ok(lines()[0].message.content === undefined && lines()[0].message.usage.output_tokens === 2 && lines()[0].requestId === 'r1', 'the slim record keeps its usage and ids and drops its content');
      appendFileSync(f, `${second.slice(40)}\n`);
      const r2 = slimTranscripts([src], cache, 0);
      ok(r2.kept === 1 && lines().length === 2 && lines()[1].requestId === 'r2', 'the next run reads only the appended bytes and completes the waiting line');
      ok(slimTranscripts([src], cache, 0).kept === 0 && lines().length === 2, 'CONTROL · a run with no new bytes adds nothing');
      writeFileSync(f, `${use(3)}\n`);
      slimTranscripts([src], cache, 0);
      ok(lines().length === 1 && lines()[0].requestId === 'r3', 'a file shorter than its offset starts again from 0');
      slimTranscripts([src], cache, Date.now() + 864e5);
      ok(!existsSync(dst), 'a log older than the window leaves the slim copy');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  console.log(fails.length ? `plan-slim selftest: ${fails.length} FAILED of ${ran}\n  ${fails.join('\n  ')}` : `all ${ran} selftests passed`);
  process.exit(fails.length ? 1 : 0);
}

if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) runSelftest();
  console.error('usage: node tools/plan-slim.mjs --selftest');
  process.exit(2);
}
