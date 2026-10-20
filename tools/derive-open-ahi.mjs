#!/usr/bin/env node
/*
 * tools/derive-open-ahi.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DERIVE AN AHI PER RECORDING OVER THE TWO ANNOTATED OPEN SETS — ISRUC and iSleeps.
 *
 * Brief: `briefs/OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md` (§5 the requirements, §6 the
 * pre-stated criterion, §7 acceptance). Residue: `2026-10-12-isruc-second-scorer-zero-reads-as-an-
 * ahi-of-zero`.
 *
 * ── WHY A TOOL AND NOT A QUERY ───────────────────────────────────────────────────────────────
 * The ISRUC mirror ships TWO scorings per recording as `<id>_1.xlsx` and `<id>_2.xlsx`. Only scorer 1
 * scored respiration: 120 of 126 scorer-1 workbooks carry a respiratory token, against 5 of 126 for
 * scorer 2. A consumer that pools or averages the two scorings therefore halves every derived index,
 * and reads an unscored column as zero events. That is §∅ at the parser layer — the second scorer's
 * silence is ABSENCE, never a zero — so this tool names one scorer in every row it emits.
 *
 * ── THE TWO SHAPES ───────────────────────────────────────────────────────────────────────────
 * ISRUC (`<root>/isruc/subgroup{I,II,III}/…/<id>_1.xlsx`): one row per 30 s epoch, no header row.
 * Column A the epoch number, B the stage, E the event cell, F the body position. The `.txt` beside
 * each workbook holds the stage column ALONE, so the events live only in the `.xlsx`.
 * Two traps, both measured on 2026-10-12: an event cell may carry an epoch prefix (`66 AR`), and it
 * may carry several events at once, separated by a comma OR a semicolon.
 *
 * iSleeps (`<root>/isleeps/SN<n>.xlsx`): a multi-sheet export. `Sleep profile` holds the hypnogram
 * under a `Rate [s]` header, and `Flow Events` holds one row per event with `Time start`, `Time end`,
 * `Value`, `Event name` and `Sleep stage`. The stage column is what makes an event placeable, and
 * `SN28` has no column E at all — 26 scored events that no stage can place, which is a `null`.
 *
 * ── REFUSALS, NEVER DEFAULTS (§∅) ────────────────────────────────────────────────────────────
 * Four named reasons, in this precedence:
 *   1 `no-scorer-1-workbook`   — the recording ships no scorer-1 workbook, so no scorer can be named.
 *   2 `no-respiratory-scoring` — the workbook carries no respiratory token anywhere.
 *   3 `no-event-stage-column`  — events exist and no column places them in sleep.
 *   4 `no-sleep-epoch`         — a hypnogram with no sleep epoch gives no denominator.
 * The precedence is deliberate: the token test runs FIRST, because an unscored column is the defect
 * this tool exists for, and a workbook that is unscored AND stage-less must read as unscored.
 *
 * ── PRIVACY, AND WHAT THIS TOOL REFUSES TO PRINT ─────────────────────────────────────────────
 * One ISRUC directory holds a workbook whose filename is a person's name. This tool identifies a
 * recording by its directory and the scorer suffix, and NEVER by a basename it did not derive, so a
 * name-bearing file reports as `<dir>#unsuffixed`. The clinical indices themselves stay out of the
 * repository: §0 of the brief withholds them until the owner rules, so the tool prints them to the
 * operator and the committed expectation holds COUNTS alone.
 *
 * ── NO XLSX DEPENDENCY ───────────────────────────────────────────────────────────────────────
 * No xlsx reader exists in this repository or in `node_modules`, and a bundle may carry no network
 * asset. So this file carries a reader over Node's own `zlib`: a zip central-directory walk with a
 * CRC check, then a cell walk over the sheet XML. The selftest builds synthetic workbooks of both
 * shapes IN MEMORY through the same reader, which is why no corpus byte is committed as a fixture.
 *
 * Usage:
 *   node tools/derive-open-ahi.mjs                      # both sets, the operator view
 *   node tools/derive-open-ahi.mjs --set isruc --json    # the verdict plus every row
 *   node tools/derive-open-ahi.mjs --expect <file.json>  # add the private distribution comparison
 *   node tools/derive-open-ahi.mjs --selftest
 *   node tools/derive-open-ahi.mjs --verdict-sample
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const Verdict = createRequire(import.meta.url)('../verdict.js');

export const DEFAULT_ROOT = '/mnt/nas/nsrr/open-datasets';
export const EPOCH_SEC = 30;

/* ISRUC's respiratory vocabulary, measured over both scorings on 2026-10-12. */
export const ISRUC_APNEA = ['OA', 'CA', 'MA'];
export const ISRUC_HYPOPNEA = ['OH', 'CH', 'MH'];
export const ISRUC_RESP = [...ISRUC_APNEA, ...ISRUC_HYPOPNEA];
export const ISRUC_SLEEP = new Set(['N1', 'N2', 'N3', 'N', 'R']);

/* iSleeps names its events in full, and `RERA` is NOT an apnea or a hypopnea (§5.5). */
export const ISLEEPS_APNEA = ['Obstructive Apnea', 'Central Apnea', 'Mixed Apnea'];
export const ISLEEPS_HYPOPNEA = ['Hypopnea'];
export const ISLEEPS_AHI_EVENTS = [...ISLEEPS_APNEA, ...ISLEEPS_HYPOPNEA];
export const ISLEEPS_RERA = 'RERA';
export const ISLEEPS_SLEEP = new Set(['N1', 'N2', 'N3', 'N4', 'REM']);

export const NULL_REASONS = ['no-scorer-1-workbook', 'no-respiratory-scoring', 'no-event-stage-column', 'no-sleep-epoch'];

/* ── THE COMMITTED EXPECTATION — COUNTS ONLY ───────────────────────────────────────────────────
   §6 pre-stated the criterion on 2026-10-12, before this tool existed: the derivation must land on
   the counts the survey measured by hand. These are the publishable half. The per-record indices and
   the derived distributions live in the private note §0 names, and `--expect` compares against them. */
/* ⚠️ These are the HAND survey's figures, and three of the ISRUC four do not survive the instrument.
   §6a of the brief carries the reconciliation, record by record. They stay here unedited, because a
   pre-stated criterion that moves to meet its data decides nothing. */
export const SURVEY = {
  isruc: { eligible: 127, derived: 115, nullsByReason: { 'no-respiratory-scoring': 11, 'no-scorer-1-workbook': 1 } },
  isleeps: { eligible: 40, derived: 39, nullsByReason: { 'no-event-stage-column': 1 } }
};

/* ── zip ──────────────────────────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* Reads a zip into a Map of name → Buffer. It REFUSES rather than guesses: an unknown compression
   method, an encrypted entry, a zip64 directory and a CRC mismatch each throw by name, because a
   silently truncated sheet reads exactly like a recording with fewer events. */
export function readZip(buf) {
  let p = buf.length - 22;
  for (; p >= 0; p--) if (buf.readUInt32LE(p) === 0x06054b50) break;
  if (p < 0) throw new Error('zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(p + 10);
  const cdOff = buf.readUInt32LE(p + 16);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error('zip: a zip64 directory is not supported');
  const out = new Map();
  let q = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(q) !== 0x02014b50) throw new Error('zip: bad central-directory signature');
    const flags = buf.readUInt16LE(q + 8);
    const method = buf.readUInt16LE(q + 10);
    const crc = buf.readUInt32LE(q + 16);
    const csize = buf.readUInt32LE(q + 20);
    const nlen = buf.readUInt16LE(q + 28);
    const elen = buf.readUInt16LE(q + 30);
    const clen = buf.readUInt16LE(q + 32);
    const lho = buf.readUInt32LE(q + 42);
    const name = buf.toString('utf8', q + 46, q + 46 + nlen);
    if (flags & 0x1) throw new Error(`zip: ${name} is encrypted`);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`zip: ${name} has a bad local header`);
    const dstart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(dstart, dstart + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip: ${name} uses compression method ${method}`);
    if (crc32(data) !== crc) throw new Error(`zip: ${name} fails its CRC`);
    out.set(name, data);
    q += 46 + nlen + elen + clen;
  }
  return out;
}

/* The writer the selftest uses, stored (method 0), so the fixtures travel through readZip. */
export function buildZip(entries) {
  const body = [];
  const dir = [];
  let off = 0;
  for (const [name, dataIn] of entries) {
    const data = Buffer.isBuffer(dataIn) ? dataIn : Buffer.from(String(dataIn), 'utf8');
    const n = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    body.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(off, 42);
    dir.push(ch, n);
    off += lh.length + n.length + data.length;
  }
  const cd = Buffer.concat(dir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(body), cd, eocd]);
}

/* ── xlsx ─────────────────────────────────────────────────────────────────────────────────────── */

function unesc(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function sharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += unesc(t[1]);
    out.push(s);
  }
  return out;
}

/* A sheet's cells as an array of { <column letter>: <string> } objects, one per row that carries a
   cell. The row's spreadsheet number rides along as `__row`, because an ISRUC epoch IS a row index. */
export function sheetRows(xml, sst) {
  const rows = [];
  let seq = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rattr = rm[1] || '';
    const rn = /\br="(\d+)"/.exec(rattr);
    seq = rn ? Number(rn[1]) : seq + 1;
    const cells = { __row: seq };
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs);
      let val = '';
      if (type && type[1] === 'inlineStr') {
        let s = '';
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += unesc(t[1]);
        val = s;
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        val = v ? unesc(v[1]) : '';
        if (type && type[1] === 's' && val !== '') val = sst[Number(val)] ?? '';
      }
      cells[ref[1]] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/* A workbook reader over the zip: sheet NAMES resolved through the relationship ids, never through
   the sheet filename. iSleeps names `Flow Events` sheetId 5 and stores it as `sheet21.xml`, so a
   reader that trusts the filename reads the wrong sheet without erring. */
export function openWorkbook(buf) {
  const zip = readZip(buf);
  const get = (n) => (zip.has(n) ? zip.get(n).toString('utf8') : null);
  const wbXml = get('xl/workbook.xml');
  if (!wbXml) throw new Error('xlsx: no xl/workbook.xml');
  const relsXml = get('xl/_rels/workbook.xml.rels') || '';
  const rels = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels.set(m[1], m[2].replace(/^\/?xl\//, ''));
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) if (!rels.has(m[2])) rels.set(m[2], m[1].replace(/^\/?xl\//, ''));
  const sst = sharedStrings(get('xl/sharedStrings.xml') || '');
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = m[1];
    const name = /\bname="([^"]*)"/.exec(a);
    const rid = /\br:id="([^"]+)"/.exec(a);
    if (!name) continue;
    const target = rid && rels.has(rid[1]) ? rels.get(rid[1]) : null;
    sheets.push({ name: unesc(name[1]), path: target ? `xl/${target}` : null });
  }
  const cache = new Map();
  return {
    sheetNames: sheets.map((s) => s.name),
    /* `null` when the workbook has no such sheet — the caller turns that into a named reason. */
    rows(name) {
      if (cache.has(name)) return cache.get(name);
      const s = sheets.find((x) => x.name === name) || (typeof name === 'number' ? sheets[name] : null);
      const xml = s && s.path ? get(s.path) : null;
      const r = xml === null ? null : sheetRows(xml, sst);
      cache.set(name, r);
      return r;
    }
  };
}

/* ── the two traps (§2 of the brief) ──────────────────────────────────────────────────────────── */

/* `66 AR` is one event carrying its own epoch number. Strip the prefix, never the digits inside a
   token, and never a bare number — a cell that is only a number carries no event name. */
export function stripEpochPrefix(cell) {
  return String(cell ?? '').replace(/^\s*\d+\s+/, '');
}

/* An event cell may hold several events, separated by a comma OR a semicolon. */
export function splitEventCell(cell) {
  const s = stripEpochPrefix(cell);
  if (!s.trim()) return [];
  return s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

function ahiOf(events, sleepEpochs, epochSec) {
  const hours = (sleepEpochs * epochSec) / 3600;
  if (!(hours > 0)) return null;
  return Math.round((events / hours) * 10) / 10;
}

/* An Excel owner file (`~$SN1.xlsx`) is a lock, not a recording. It is 165 bytes of OLE and has no
   zip directory, so a glob over `*.xlsx` adds two UNREADABLE records to iSleeps and reports 42 of a
   population of 40. Measured 2026-10-20. */
export function isLockFile(name) {
  return /^~\$/.test(String(name));
}

/* ── ISRUC ────────────────────────────────────────────────────────────────────────────────────── */

export function deriveIsrucWorkbook(wb, recordId) {
  const rows = wb.rows(0) || [];
  const counts = Object.fromEntries(ISRUC_RESP.map((t) => [t, 0]));
  let epochsWithStage = 0;
  let sleepEpochs = 0;
  let respAnywhere = 0;
  let respInSleep = 0;
  for (const r of rows) {
    const stage = String(r.B ?? '').trim();
    const inSleep = ISRUC_SLEEP.has(stage);
    if (stage) epochsWithStage++;
    if (inSleep) sleepEpochs++;
    for (const tok of splitEventCell(r.E)) {
      if (!(tok in counts)) continue;
      respAnywhere++;
      if (inSleep) {
        counts[tok]++;
        respInSleep++;
      }
    }
  }
  const row = {
    set: 'isruc',
    recordId,
    scorer: 1,
    epochSec: EPOCH_SEC,
    epochsWithStage,
    sleepEpochs,
    tstHours: Math.round(((sleepEpochs * EPOCH_SEC) / 3600) * 100) / 100,
    counts,
    apneas: ISRUC_APNEA.reduce((a, t) => a + counts[t], 0),
    hypopneas: ISRUC_HYPOPNEA.reduce((a, t) => a + counts[t], 0),
    rera: null,
    respAnywhere,
    ahi: null,
    nullReason: null
  };
  if (respAnywhere === 0) row.nullReason = 'no-respiratory-scoring';
  else if (epochsWithStage === 0) row.nullReason = 'no-event-stage-column';
  else if (sleepEpochs === 0) row.nullReason = 'no-sleep-epoch';
  else row.ahi = ahiOf(respInSleep, sleepEpochs, EPOCH_SEC);
  return row;
}

/* Every ISRUC recording directory, plus every workbook that carries NO scorer suffix. The second
   kind is a recording this tool cannot attribute to a scorer, and one of them is name-bearing, so it
   reports as `<dir>#unsuffixed` and its basename never leaves this process. */
export function enumerateIsruc(root) {
  const base = join(root, 'isruc');
  const out = [];
  const walk = (dir, rel) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const xlsx = names.filter((n) => n.toLowerCase().endsWith('.xlsx') && !isLockFile(n));
    const scorer1 = xlsx.filter((n) => /_1\.xlsx$/i.test(n));
    const unsuffixed = xlsx.filter((n) => !/_[12]\.xlsx$/i.test(n));
    for (const n of scorer1) out.push({ recordId: `${rel}/${basename(n, '.xlsx').replace(/_1$/, '')}`, file: join(dir, n), kind: 'scorer1' });
    for (const _ of unsuffixed) out.push({ recordId: `${rel}#unsuffixed`, file: null, kind: 'unsuffixed' });
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, rel ? `${rel}/${n}` : n);
    }
  };
  walk(base, '');
  return out.sort((a, b) => a.recordId.localeCompare(b.recordId));
}

/* ── iSleeps ──────────────────────────────────────────────────────────────────────────────────── */

function headerIndex(rows, label) {
  for (const r of rows) {
    for (const [col, v] of Object.entries(r)) {
      if (col !== '__row' && String(v).trim() === label) return { row: r.__row, col };
    }
  }
  return null;
}

export function deriveIsleepsWorkbook(wb, recordId) {
  const profile = wb.rows('Sleep profile');
  const flow = wb.rows('Flow Events');
  const counts = Object.fromEntries([...ISLEEPS_AHI_EVENTS, ISLEEPS_RERA].map((t) => [t, 0]));
  const row = {
    set: 'isleeps',
    recordId,
    scorer: 1,
    epochSec: EPOCH_SEC,
    epochsWithStage: 0,
    sleepEpochs: 0,
    tstHours: 0,
    counts,
    apneas: 0,
    hypopneas: 0,
    rera: 0,
    respAnywhere: 0,
    ahi: null,
    nullReason: null
  };
  /* the hypnogram: `Rate [s]` is the epoch length this export used, never an assumed 30 */
  let rate = EPOCH_SEC;
  if (profile) {
    const rateCell = headerIndex(profile, 'Rate [s]');
    if (rateCell) {
      const r = profile.find((x) => x.__row === rateCell.row);
      const n = Number(String(r.B ?? '').trim());
      if (Number.isFinite(n) && n > 0) rate = n;
    }
    const hdr = headerIndex(profile, 'Value');
    const from = hdr ? hdr.row : 0;
    for (const r of profile) {
      if (r.__row <= from) continue;
      const stage = String(r.B ?? '').trim();
      if (stage) row.epochsWithStage++;
      if (ISLEEPS_SLEEP.has(stage)) row.sleepEpochs++;
    }
  }
  row.epochSec = rate;
  row.tstHours = Math.round(((row.sleepEpochs * rate) / 3600) * 100) / 100;
  if (!flow) {
    row.nullReason = 'no-respiratory-scoring';
    return row;
  }
  const nameHdr = headerIndex(flow, 'Event name');
  const stageHdr = headerIndex(flow, 'Sleep stage');
  let respAnywhere = 0;
  let respInSleep = 0;
  if (nameHdr) {
    for (const r of flow) {
      if (r.__row <= nameHdr.row) continue;
      const name = String(r[nameHdr.col] ?? '').trim();
      if (!(name in counts)) continue;
      if (name === ISLEEPS_RERA) {
        counts[name]++;
        continue;
      }
      respAnywhere++;
      const stage = stageHdr ? String(r[stageHdr.col] ?? '').trim() : '';
      if (ISLEEPS_SLEEP.has(stage)) {
        counts[name]++;
        respInSleep++;
      }
    }
  }
  row.respAnywhere = respAnywhere;
  row.apneas = ISLEEPS_APNEA.reduce((a, t) => a + counts[t], 0);
  row.hypopneas = ISLEEPS_HYPOPNEA.reduce((a, t) => a + counts[t], 0);
  row.rera = counts[ISLEEPS_RERA];
  if (respAnywhere === 0) row.nullReason = 'no-respiratory-scoring';
  else if (!stageHdr) row.nullReason = 'no-event-stage-column';
  else if (row.sleepEpochs === 0) row.nullReason = 'no-sleep-epoch';
  else row.ahi = ahiOf(respInSleep, row.sleepEpochs, rate);
  return row;
}

export function enumerateIsleeps(root) {
  const base = join(root, 'isleeps');
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.toLowerCase().endsWith('.xlsx') && !isLockFile(n))
    .map((n) => ({ recordId: basename(n, '.xlsx'), file: join(base, n), kind: 'isleeps' }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId, 'en', { numeric: true }));
}

/* ── the population ───────────────────────────────────────────────────────────────────────────── */

export function deriveRecord(rec) {
  if (rec.kind === 'unsuffixed') {
    return {
      set: 'isruc',
      recordId: rec.recordId,
      scorer: null,
      epochSec: EPOCH_SEC,
      epochsWithStage: 0,
      sleepEpochs: 0,
      tstHours: 0,
      counts: {},
      apneas: 0,
      hypopneas: 0,
      rera: null,
      respAnywhere: 0,
      ahi: null,
      nullReason: 'no-scorer-1-workbook'
    };
  }
  const buf = readFileSync(rec.file);
  const wb = openWorkbook(buf);
  const row = rec.kind === 'isleeps' ? deriveIsleepsWorkbook(wb, rec.recordId) : deriveIsrucWorkbook(wb, rec.recordId);
  /* ── THE MIRROR DUPLICATES RECORDINGS, AND A TREE WALK POOLS THEM TWICE ──────────────────────
     Three ISRUC scorer-1 workbooks are BYTE-IDENTICAL across subgroups: 126 files, 123 distinct
     (measured 2026-10-20). A cohort built by walking the tree therefore double-weights three
     subjects, and nothing in the file names says so. The content hash rides every row so a consumer
     can refuse the second copy; the derivation itself still runs, because the data is valid — it is
     the INDEPENDENCE that is absent, not the measurement. */
  row.contentHash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  row.duplicateOf = null;
  return row;
}

/* The FIRST occurrence in enumeration order keeps the record; a later copy names it. The order is
   the sorted record id, so the answer does not depend on the directory walk. */
export function markDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (!r.contentHash) continue;
    const first = seen.get(r.contentHash);
    if (first) r.duplicateOf = first;
    else seen.set(r.contentHash, r.recordId);
  }
  return rows;
}

export function summarize(rows) {
  const derived = rows.filter((r) => r.ahi !== null);
  const byReason = {};
  for (const r of rows) if (r.nullReason) byReason[r.nullReason] = (byReason[r.nullReason] || 0) + 1;
  const vals = derived.map((r) => r.ahi).sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1) + 0.5))] : null);
  const dupes = rows.filter((r) => r.duplicateOf);
  return {
    records: rows.length,
    derived: derived.length,
    nulls: rows.length - derived.length,
    duplicates: dupes.length,
    distinctDerived: derived.filter((r) => !r.duplicateOf).length,
    byReason,
    distribution: vals.length
      ? {
          min: vals[0],
          p25: q(0.25),
          median: q(0.5),
          p75: q(0.75),
          max: vals[vals.length - 1],
          mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        }
      : null,
    bands: {
      under5: derived.filter((r) => r.ahi < 5).length,
      from5to15: derived.filter((r) => r.ahi >= 5 && r.ahi < 15).length,
      from15to30: derived.filter((r) => r.ahi >= 15 && r.ahi < 30).length,
      over30: derived.filter((r) => r.ahi >= 30).length
    }
  };
}

/* The disagreement count the criterion names. The committed half compares COUNTS. A private
   expectation file adds the per-set distribution, which is the half §0 withholds from the repo. */
export function disagreements(bySet, expect) {
  const out = [];
  for (const [set, sum] of Object.entries(bySet)) {
    const want = SURVEY[set];
    if (!want) continue;
    if (sum.records !== want.eligible) out.push(`${set}: ${sum.records} record(s) enumerated, survey says ${want.eligible}`);
    if (sum.derived !== want.derived) out.push(`${set}: ${sum.derived} derived, survey says ${want.derived}`);
    const reasons = new Set([...Object.keys(want.nullsByReason), ...Object.keys(sum.byReason)]);
    for (const r of [...reasons].sort()) {
      const a = sum.byReason[r] || 0;
      const b = want.nullsByReason[r] || 0;
      if (a !== b) out.push(`${set}: ${a} null(s) with reason ${r}, survey says ${b}`);
    }
    const e = expect && expect[set];
    if (e && e.distribution && sum.distribution) {
      for (const k of ['min', 'p25', 'median', 'p75', 'max', 'mean']) {
        if (e.distribution[k] !== undefined && e.distribution[k] !== sum.distribution[k]) out.push(`${set}: ${k} ${sum.distribution[k]}, the private note says ${e.distribution[k]}`);
      }
    }
    if (e && e.bands && sum.bands) {
      for (const k of Object.keys(sum.bands)) {
        if (e.bands[k] !== undefined && e.bands[k] !== sum.bands[k]) out.push(`${set}: band ${k} ${sum.bands[k]}, the private note says ${e.bands[k]}`);
      }
    }
  }
  return out;
}

/* ⚠️ `eligible` is the population this run ENUMERATED, never the survey's total. The survey said 167
   and the mirror holds 168, which is one of the four disagreements this tool exists to report — and a
   verdict that borrowed the survey's figure for its own population would have had to choose between
   an invalid object (`checked + excluded ≠ eligible`) and hiding the extra record. */
export function verdictFor({ bySet, rows, expect, commit, scopeNote, enumerated, partial }) {
  const checked = rows.length;
  const eligible = Number.isFinite(enumerated) ? enumerated : checked;
  const diffs = checked ? disagreements(bySet, expect) : [];
  let status = 'PASS';
  let reason = null;
  if (checked === 0) {
    status = 'NOT_RUN';
    reason = 'no record was examined — the corpus mount is absent (--root names it)';
  } else if (partial || checked !== eligible) {
    status = 'SHORTFALL';
    reason = `${checked} of ${eligible} enumerated record(s) examined${partial ? ' and the scope is narrower than the population (--set or --limit)' : ''} — the criterion needs both sets whole`;
  } else if (diffs.length) {
    status = 'FAIL';
    reason = `${diffs.length} disagreement(s) with the survey: ${diffs.slice(0, 3).join('; ')}`;
  }
  const v = Verdict.make({
    gate: 'derive-open-ahi',
    status,
    population: { checked, eligible, excluded: Math.max(0, eligible - checked) },
    criterion: { name: 'survey_count_match', threshold: 0, unit: 'records', direction: 'lte' },
    result:
      checked === 0
        ? null
        : {
            disagreements: diffs.length,
            detail: diffs,
            compared: expect ? 'counts+distribution' : 'counts',
            surveyEligible: Object.values(SURVEY).reduce((a, x) => a + x.eligible, 0),
            note: scopeNote || null
          },
    evidence: ['tools/derive-open-ahi.mjs', 'briefs/OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md'],
    reason,
    producedBy: { tool: 'tools/derive-open-ahi.mjs', commit: commit || null, commitReason: commit ? undefined : 'run from a working tree, no commit stamped' }
  });
  const ck = Verdict.validate(v);
  if (!ck.ok) throw new Error(`verdict invalid: ${ck.errors.join('; ')}`);
  return v;
}

/* ── CLI ──────────────────────────────────────────────────────────────────────────────────────── */

export function parseArgs(argv) {
  const opt = { set: 'both', root: process.env.TEPNA_OPEN_ROOT || DEFAULT_ROOT, json: false, expect: null, limit: 0, selftest: false, sample: false };
  /* the flag is read in a CALL position too, because that is the predicate both
     `tools/selftest-all.mjs` and `tools/verdict-adoption.mjs` discover a gated tool by. */
  if (argv.includes('--selftest')) opt.selftest = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opt.selftest = true;
    else if (a === '--verdict-sample') opt.sample = true;
    else if (a === '--json') opt.json = true;
    else if (a === '--set') opt.set = argv[++i];
    else if (a === '--root') opt.root = argv[++i];
    else if (a === '--expect') opt.expect = argv[++i];
    else if (a === '--limit') opt.limit = Number(argv[++i]);
    /* §🧾: an unread token is a REFUSAL, never a shrug. A silent skip is how a run reports a figure
       for a population the operator did not ask for. */ else throw new Error(`unread argv token: ${a}`);
  }
  if (!['both', 'isruc', 'isleeps'].includes(opt.set)) throw new Error(`--set must be both, isruc or isleeps, not ${opt.set}`);
  if (!Number.isFinite(opt.limit) || opt.limit < 0) throw new Error('--limit must be a non-negative number');
  return opt;
}

function headCommit() {
  try {
    return createRequire(import.meta.url)('node:child_process')
      .execSync('git rev-parse --short=9 HEAD', { encoding: 'utf8' })
      .trim();
  } catch {
    return null;
  }
}

function run(opt) {
  const sets = opt.set === 'both' ? ['isruc', 'isleeps'] : [opt.set];
  const expect = opt.expect ? JSON.parse(readFileSync(opt.expect, 'utf8')) : null;
  const rows = [];
  const bySet = {};
  let enumerated = 0;
  for (const set of sets) {
    const recs = set === 'isruc' ? enumerateIsruc(opt.root) : enumerateIsleeps(opt.root);
    enumerated += recs.length;
    const take = opt.limit ? recs.slice(0, opt.limit) : recs;
    const setRows = [];
    for (const rec of take) {
      /* one workbook in memory at a time — the 8 GB rule */
      let row;
      try {
        row = deriveRecord(rec);
      } catch (err) {
        row = { set, recordId: rec.recordId, scorer: null, ahi: null, nullReason: 'unreadable', error: String(err.message || err) };
      }
      setRows.push(row);
      rows.push(row);
    }
    bySet[set] = summarize(markDuplicates(setRows));
  }
  const partial = opt.limit > 0 || sets.length < 2;
  const v = verdictFor({
    bySet,
    rows,
    expect,
    commit: headCommit(),
    enumerated,
    partial,
    scopeNote: partial ? 'a partial run: --set or --limit narrowed the population' : null
  });
  return { rows, bySet, verdict: v };
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────── */

function xlsxOf(sheets, { shared = false } = {}) {
  const strings = [];
  const idx = (s) => {
    let i = strings.indexOf(s);
    if (i < 0) {
      strings.push(s);
      i = strings.length - 1;
    }
    return i;
  };
  const files = [];
  const relEntries = [];
  const sheetTags = [];
  sheets.forEach((sh, n) => {
    const rid = `rId${n + 1}`;
    /* the stored filename deliberately does NOT match the sheet order, which is the iSleeps shape */
    const file = `sheet${90 - n}.xml`;
    sheetTags.push(`<sheet name="${sh.name}" sheetId="${n + 1}" r:id="${rid}"/>`);
    relEntries.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${file}"/>`);
    const body = sh.rows
      .map((cells, r) => {
        const cs = Object.entries(cells)
          .map(([col, val]) => {
            if (val === null || val === undefined) return `<c r="${col}${r + 1}"/>`;
            if (typeof val === 'number') return `<c r="${col}${r + 1}"><v>${val}</v></c>`;
            const esc = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;');
            return shared ? `<c r="${col}${r + 1}" t="s"><v>${idx(String(val))}</v></c>` : `<c r="${col}${r + 1}" t="inlineStr"><is><t>${esc}</t></is></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cs}</row>`;
      })
      .join('');
    files.push([`xl/worksheets/${file}`, `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`]);
  });
  files.push(['xl/workbook.xml', `<?xml version="1.0"?><workbook><sheets>${sheetTags.join('')}</sheets></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships>${relEntries.join('')}</Relationships>`]);
  if (shared) files.push(['xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`]);
  return buildZip(files);
}

function isrucSheet(rows) {
  return xlsxOf([{ name: 'Sheet1', rows }]);
}

function selftest() {
  let n = 0;
  const fails = [];
  const ok = (label, got, want) => {
    n++;
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) fails.push(`${label}: got ${a}, want ${b}`);
  };
  const throws = (label, fn, re) => {
    n++;
    try {
      fn();
      fails.push(`${label}: did not throw`);
    } catch (err) {
      if (!re.test(String(err.message || err))) fails.push(`${label}: threw ${err.message}`);
    }
  };

  /* the zip layer */
  ok('crc32 of the empty buffer', crc32(Buffer.alloc(0)), 0);
  ok('crc32 of the check vector', crc32(Buffer.from('123456789')), 0xcbf43926);
  const z = buildZip([
    ['a.txt', 'hello'],
    ['b/c.txt', 'world']
  ]);
  const read = readZip(z);
  ok('a stored zip round-trips its entry names', [...read.keys()], ['a.txt', 'b/c.txt']);
  ok('…and its bytes', read.get('b/c.txt').toString(), 'world');
  throws('a truncated zip refuses by name', () => readZip(z.subarray(0, 12)), /end-of-central-directory/);
  const cdOff = z.readUInt32LE(z.length - 22 + 16);
  const bad = Buffer.from(z);
  bad[30 + 5] = bad[30 + 5] ^ 0xff; /* the first payload byte, past the 30-byte header and the name */
  throws('a corrupt payload fails its CRC', () => readZip(bad), /fails its CRC/);
  const method = Buffer.from(z);
  method.writeUInt16LE(99, cdOff + 10); /* the first central-directory record's method field */
  throws('an unknown compression method refuses', () => readZip(method), /compression method/);

  /* the sheet layer */
  const rowsXml = '<row r="2"><c r="A2" t="inlineStr"><is><t>66 AR</t></is></c><c r="B2"/><c r="C2"><v>7</v></c></row><row><c r="A3" t="s"><v>0</v></c></row>';
  const parsed = sheetRows(rowsXml, ['N2']);
  ok('a row keeps its spreadsheet number', parsed[0].__row, 2);
  ok('an inline string reads through', parsed[0].A, '66 AR');
  ok('a self-closing cell reads as empty, never as absent', parsed[0].B, '');
  ok('a numeric cell reads as its text', parsed[0].C, '7');
  ok('a row with no r continues the count', parsed[1].__row, 3);
  ok('a shared string resolves through the table', parsed[1].A, 'N2');
  ok('an escaped entity is decoded once', sheetRows('<row r="1"><c r="A1" t="inlineStr"><is><t>a&amp;amp;b</t></is></c></row>', [])[0].A, 'a&amp;b');

  /* the workbook layer — the name, never the filename */
  const wbMulti = openWorkbook(
    xlsxOf([
      { name: 'Sleep profile', rows: [{ A: 'x' }] },
      { name: 'Flow Events', rows: [{ A: 'y' }] }
    ])
  );
  ok('a workbook lists its sheet names in order', wbMulti.sheetNames, ['Sleep profile', 'Flow Events']);
  ok('a sheet is found by NAME although the stored filename disagrees', wbMulti.rows('Flow Events')[0].A, 'y');
  ok('an absent sheet reads null, never an empty sheet', wbMulti.rows('Obstruction'), null);
  ok('a shared-string workbook reads the same', openWorkbook(xlsxOf([{ name: 'Sheet1', rows: [{ A: 'OH' }] }], { shared: true })).rows(0)[0].A, 'OH');

  /* the two traps */
  ok('an epoch prefix is stripped', stripEpochPrefix('66 AR'), 'AR');
  ok('a bare token keeps its text', stripEpochPrefix('AR'), 'AR');
  ok('a numeric-only cell is not emptied', stripEpochPrefix('66'), '66');
  ok('an interior digit survives', stripEpochPrefix('12 N3 OH'), 'N3 OH');
  ok('a comma splits a cell', splitEventCell('OH, AR'), ['OH', 'AR']);
  ok('a semicolon splits it too', splitEventCell('OA; MChg'), ['OA', 'MChg']);
  ok('both separators in one cell', splitEventCell('7 OH, AR; MChg'), ['OH', 'AR', 'MChg']);
  ok('an empty cell yields no token', splitEventCell(''), []);
  ok('a whitespace cell yields no token', splitEventCell('   '), []);
  ok('an absent cell yields no token', splitEventCell(undefined), []);

  /* ISRUC: 120 sleep epochs is one hour, so a count IS the index */
  const sleepEpochs = (k, ev) => {
    const rows = [];
    for (let i = 0; i < 120; i++) rows.push({ A: String(i + 1), B: 'N2', E: i < k ? ev : '' });
    return rows;
  };
  const r1 = deriveIsrucWorkbook(openWorkbook(isrucSheet(sleepEpochs(6, 'OH'))), 'sub/1');
  ok('an hour of sleep reads as one hour', r1.tstHours, 1);
  ok('six hypopneas in that hour read as an AHI of 6', r1.ahi, 6);
  ok('…and the subtype count is kept', r1.counts.OH, 6);
  ok('…with the apnea count separate', r1.apneas, 0);
  ok('…and no RERA concept in ISRUC', r1.rera, null);
  ok('the scorer is named in every row', r1.scorer, 1);
  const r2 = deriveIsrucWorkbook(openWorkbook(isrucSheet(sleepEpochs(4, '66 OA, AR'))), 'sub/2');
  ok('a prefixed multi-event cell counts one apnea', r2.counts.OA, 4);
  ok('…and the arousal token is not an apnea', r2.apneas, 4);
  const wake = [{ A: '1', B: 'W', E: 'OH' }, ...sleepEpochs(0, '')];
  const r3 = deriveIsrucWorkbook(openWorkbook(isrucSheet(wake)), 'sub/3');
  ok('an event scored in wake stays out of the numerator', r3.ahi, 0);
  ok('…and still counts as respiratory scoring present', r3.respAnywhere, 1);
  const r4 = deriveIsrucWorkbook(openWorkbook(isrucSheet(sleepEpochs(0, ''))), 'sub/4');
  ok('a workbook with no respiratory token is null', r4.ahi, null);
  ok('…with the reason named', r4.nullReason, 'no-respiratory-scoring');
  const r5 = deriveIsrucWorkbook(
    openWorkbook(
      isrucSheet([
        { A: '1', E: 'OH' },
        { A: '2', E: 'OA' }
      ])
    ),
    'sub/5'
  );
  ok('events with no stage column are null', r5.ahi, null);
  ok('…with the reason named', r5.nullReason, 'no-event-stage-column');
  const r6 = deriveIsrucWorkbook(
    openWorkbook(
      isrucSheet([
        { A: '1', B: 'W', E: 'OH' },
        { A: '2', B: 'W', E: 'OA' }
      ])
    ),
    'sub/6'
  );
  ok('a hypnogram with no sleep epoch is null, never a zero index', r6.ahi, null);
  ok('…with the reason named', r6.nullReason, 'no-sleep-epoch');
  ok('…and the denominator reports itself as zero hours', r6.tstHours, 0);

  /* iSleeps */
  const profile = (k, stage = 'N2') => {
    const rows = [
      { A: 'Signal ID', B: 'SchlafProfil' },
      { A: 'Rate [s]', B: '30' },
      { A: 'Time', B: 'Value' }
    ];
    for (let i = 0; i < k; i++) rows.push({ A: String(i), B: stage });
    return rows;
  };
  const flow = (events, { stageCol = true } = {}) => {
    const rows = [
      { A: 'Signal ID', B: 'FlowD' },
      stageCol ? { A: 'Time start', B: 'Time end', C: 'Value', D: 'Event name', E: 'Sleep stage' } : { A: 'Time start', B: 'Time end', C: 'Value', D: 'Event name' }
    ];
    for (const [name, stage] of events) rows.push(stageCol ? { A: '1', B: '2', C: '30', D: name, E: stage } : { A: '1', B: '2', C: '30', D: name });
    return rows;
  };
  const mk = (prof, fl, opts) => openWorkbook(xlsxOf([{ name: 'Sleep profile', rows: prof }, ...(fl ? [{ name: 'Flow Events', rows: fl }] : [])], opts));
  const s1 = deriveIsleepsWorkbook(
    mk(
      profile(240),
      flow([
        ['Hypopnea', 'N2'],
        ['Obstructive Apnea', 'N1'],
        ['Central Apnea', 'REM'],
        ['Mixed Apnea', 'N3'],
        ['RERA', 'N2']
      ])
    ),
    'SN1'
  );
  ok('two hours of sleep read as two hours', s1.tstHours, 2);
  ok('four apnea and hypopnea events over two hours read as an AHI of 2', s1.ahi, 2);
  ok('RERA is reported beside the index', s1.rera, 1);
  ok('…and stays out of the numerator', s1.apneas + s1.hypopneas, 4);
  ok('the AASM subtypes are kept separately', [s1.counts['Obstructive Apnea'], s1.counts['Central Apnea'], s1.counts['Mixed Apnea']], [1, 1, 1]);
  const s2 = deriveIsleepsWorkbook(
    mk(
      profile(240),
      flow([
        ['Hypopnea', 'Wake'],
        ['Hypopnea', 'N2']
      ])
    ),
    'SN2'
  );
  ok('an event scored in wake stays out of the iSleeps numerator', s2.ahi, 0.5);
  /* the SN28 shape: scored events, no column E */
  const s3 = deriveIsleepsWorkbook(
    mk(
      profile(240),
      flow(
        [
          ['Hypopnea', null],
          ['Obstructive Apnea', null]
        ],
        { stageCol: false }
      )
    ),
    'SN28'
  );
  ok('the SN28 shape is null', s3.ahi, null);
  ok('…with the reason named', s3.nullReason, 'no-event-stage-column');
  ok('…and its unplaceable events are still counted', s3.respAnywhere, 2);
  const s4 = deriveIsleepsWorkbook(mk(profile(240), null), 'SN3');
  ok('a workbook with no Flow Events sheet is null', s4.nullReason, 'no-respiratory-scoring');
  const s5 = deriveIsleepsWorkbook(mk(profile(240, 'Wake'), flow([['Hypopnea', 'Wake']])), 'SN4');
  ok('a hypnogram with no sleep epoch is null here too', s5.nullReason, 'no-sleep-epoch');
  const rate20 = profile(180).map((r) => (r.A === 'Rate [s]' ? { A: 'Rate [s]', B: '20' } : r));
  const s6 = deriveIsleepsWorkbook(mk(rate20, flow([['Hypopnea', 'N2']])), 'SN5');
  ok('the hypnogram rate is read, never assumed', s6.epochSec, 20);
  ok('…so the denominator follows it', s6.tstHours, 1);

  /* the unsuffixed ISRUC workbook — a named refusal, and no basename leaves the process */
  const u = deriveRecord({ kind: 'unsuffixed', recordId: 'subgroupII/65#unsuffixed' });
  ok('an unsuffixed workbook names no scorer', u.scorer, null);
  ok('…and refuses with its own reason', u.nullReason, 'no-scorer-1-workbook');
  ok('…and its id carries no basename', /#unsuffixed$/.test(u.recordId), true);

  /* the lock file and the duplicate pair */
  ok('an Excel owner file is not a recording', isLockFile('~$SN1.xlsx'), true);
  ok('…and a real workbook is', isLockFile('SN1.xlsx'), false);
  const pair = markDuplicates([
    { recordId: 'subgroupII/17', contentHash: 'aaaaaaaaaaaa', ahi: 48.3, nullReason: null, duplicateOf: null },
    { recordId: 'subgroupIII/2/1', contentHash: 'aaaaaaaaaaaa', ahi: 48.3, nullReason: null, duplicateOf: null },
    { recordId: 'subgroupII/18', contentHash: 'bbbbbbbbbbbb', ahi: 7, nullReason: null, duplicateOf: null }
  ]);
  ok('the first copy of a workbook keeps the record', pair[0].duplicateOf, null);
  ok('…and the second names it', pair[1].duplicateOf, 'subgroupII/17');
  ok('…while a different workbook is untouched', pair[2].duplicateOf, null);
  const dupSum = summarize(pair);
  ok('a duplicate still derives its index', dupSum.derived, 3);
  ok('…and the distinct population is reported beside it', [dupSum.duplicates, dupSum.distinctDerived], [1, 2]);
  ok('a row with no hash is never a duplicate', markDuplicates([{ recordId: 'x', ahi: null, nullReason: 'no-scorer-1-workbook', duplicateOf: null }])[0].duplicateOf, null);

  /* the summary and the criterion */
  const sum = summarize([
    { ahi: 1, nullReason: null },
    { ahi: 9, nullReason: null },
    { ahi: 40, nullReason: null },
    { ahi: null, nullReason: 'no-respiratory-scoring' }
  ]);
  ok('the summary counts the derived records', [sum.records, sum.derived, sum.nulls], [4, 3, 1]);
  ok('…and the nulls by reason', sum.byReason, { 'no-respiratory-scoring': 1 });
  ok('…and the severity bands', [sum.bands.under5, sum.bands.from5to15, sum.bands.from15to30, sum.bands.over30], [1, 1, 0, 1]);
  ok('…and the distribution ends', [sum.distribution.min, sum.distribution.max], [1, 40]);
  const full = {
    isruc: { records: 127, derived: 115, byReason: { 'no-respiratory-scoring': 11, 'no-scorer-1-workbook': 1 }, distribution: { median: 8 }, bands: { under5: 35 } },
    isleeps: { records: 40, derived: 39, byReason: { 'no-event-stage-column': 1 } }
  };
  ok('the survey counts agree with themselves', disagreements(full, null), []);
  const short = JSON.parse(JSON.stringify(full));
  short.isruc.derived = 116;
  ok('one derived record too many is a disagreement', disagreements(short, null).length, 1);
  const pooled = JSON.parse(JSON.stringify(full));
  pooled.isruc.byReason['no-respiratory-scoring'] = 0;
  ok('a reason that stops appearing is a disagreement', disagreements(pooled, null).length, 1);
  ok('a private expectation adds the distribution comparison', disagreements(full, { isruc: { distribution: { median: 99 } } }).length, 1);
  ok('…and a band of the distribution too', disagreements(full, { isruc: { bands: { under5: 34 } } }).length, 1);
  ok('…while the committed counts alone compare nothing clinical', disagreements(full, null), []);

  /* the verdict */
  const vFull = verdictFor({ bySet: full, rows: new Array(167).fill({}), expect: null, commit: 'abc1234', enumerated: 167 });
  ok('the whole population with no disagreement is PASS', vFull.status, 'PASS');
  ok('…over the pre-stated criterion', [vFull.criterion.name, vFull.criterion.threshold, vFull.criterion.direction], ['survey_count_match', 0, 'lte']);
  ok('…and the population adds up', vFull.population.checked + vFull.population.excluded, vFull.population.eligible);
  ok('…and it names what it compared', vFull.result.compared, 'counts');
  const vNone = verdictFor({ bySet: {}, rows: [], expect: null, commit: 'abc1234' });
  ok('examining nothing is NOT_RUN, never PASS', vNone.status, 'NOT_RUN');
  ok('…with a null result (§∅)', vNone.result, null);
  ok('…and a reason', /mount is absent/.test(vNone.reason), true);
  const vPart = verdictFor({ bySet: { isleeps: full.isleeps }, rows: new Array(40).fill({}), expect: null, commit: 'abc1234', enumerated: 40, partial: true });
  ok('a narrower scope is SHORTFALL, never PASS', vPart.status, 'SHORTFALL');
  const vMore = verdictFor({ bySet: full, rows: new Array(168).fill({}), expect: null, commit: 'abc1234', enumerated: 168 });
  ok('a population one record larger than the survey stays a valid object', vMore.population, { checked: 168, eligible: 168, excluded: 0 });
  ok('…and the survey total rides the result rather than the population', vMore.result.surveyEligible, 167);
  ok('…and an unexamined enumerated record is EXCLUDED, never absent', verdictFor({ bySet: full, rows: new Array(100).fill({}), expect: null, commit: 'abc1234', enumerated: 168 }).population, {
    checked: 100,
    eligible: 168,
    excluded: 68
  });
  const vBad = verdictFor({ bySet: short, rows: new Array(167).fill({}), expect: null, commit: 'abc1234', enumerated: 167 });
  ok('a disagreement is FAIL', vBad.status, 'FAIL');
  ok('…and the reason names the count', /1 disagreement/.test(vBad.reason), true);
  ok('every verdict validates', Verdict.validate(vBad).ok, true);

  /* argv */
  ok('the default set is both', parseArgs([]).set, 'both');
  ok('a root is read', parseArgs(['--root', '/x']).root, '/x');
  throws('an unread token refuses', () => parseArgs(['--sett', 'isruc']), /unread argv token/);
  throws('an unknown set refuses', () => parseArgs(['--set', 'shhs']), /--set must be/);
  throws('a negative limit refuses', () => parseArgs(['--limit', '-1']), /--limit must be/);

  if (fails.length) {
    for (const f of fails) console.error(`  ✗ ${f}`);
    console.error(`${fails.length} of ${n} selftests FAILED`);
    process.exit(1);
  }
  console.log(`all ${n} selftests passed`);
}

/* ── entry ────────────────────────────────────────────────────────────────────────────────────── */

const DIRECT = process.argv[1] && process.argv[1].endsWith('derive-open-ahi.mjs');
if (DIRECT) {
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`derive-open-ahi: ${err.message}`);
    process.exit(2);
  }
  if (opt.selftest) {
    selftest();
  } else if (opt.sample) {
    console.log(JSON.stringify(verdictFor({ bySet: {}, rows: [], expect: null, commit: null }), null, 1));
  } else if (!existsSync(opt.root)) {
    const v = verdictFor({ bySet: {}, rows: [], expect: null, commit: headCommit() });
    console.error(`derive-open-ahi: the corpus root ${opt.root} is absent — nothing examined`);
    console.log(JSON.stringify(v, null, 1));
    process.exit(0);
  } else {
    const { rows, bySet, verdict } = run(opt);
    if (opt.json) {
      console.log(JSON.stringify({ verdict, bySet, rows }, null, 1));
    } else {
      for (const [set, s] of Object.entries(bySet)) {
        console.log(`\n${set}: ${s.derived} derived, ${s.nulls} null of ${s.records} record(s)`);
        for (const [r, k] of Object.entries(s.byReason).sort()) console.log(`  null ${r}: ${k}`);
        if (s.distribution)
          console.log(
            `  AHI min ${s.distribution.min} · p25 ${s.distribution.p25} · median ${s.distribution.median} · p75 ${s.distribution.p75} · max ${s.distribution.max} · mean ${s.distribution.mean}`
          );
        if (s.duplicates) console.log(`  duplicates: ${s.duplicates} record(s) repeat an earlier workbook byte for byte — ${s.distinctDerived} distinct derived`);
        console.log(`  bands: ${s.bands.under5} under 5 · ${s.bands.from5to15} from 5 to 15 · ${s.bands.from15to30} from 15 to 30 · ${s.bands.over30} at 30 or above`);
      }
      const unread = rows.filter((r) => r.nullReason === 'unreadable');
      for (const r of unread) console.log(`  unreadable ${r.recordId}: ${r.error}`);
      console.log(`\n${verdict.status} — ${verdict.reason || 'the derivation reproduces the survey counts'}`);
      console.log(JSON.stringify(verdict, null, 1));
    }
    process.exit(verdict.status === 'PASS' ? 0 : 1);
  }
}
