#!/usr/bin/env node
/*
 * tools/zotero-fill.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ZOTERO FILL — the citation ledger, pushed into the owner's reference library as first-class records.
 *
 *     node tools/zotero-fill.mjs --dry-run          # what would be created, from the cached metadata; writes nothing
 *     node tools/zotero-fill.mjs                    # create every ledger DOI not yet in the library (idempotent by DOI)
 *     node tools/zotero-fill.mjs --json             # the tepna.verdict/1 object alone
 *     node tools/zotero-fill.mjs --selftest
 *
 * WHY. The owner's Zotero library had never been connected to anything (2026-10-11: 0 items, 0 attachments,
 * no client ever synced) while the repo's citation ledger holds every DOI the papers and guides cite,
 * each verified against Crossref. The ledger is the source of truth and stays so; the library becomes
 * its readable, searchable mirror — one record per DOI, tagged `tepna-ledger`, in one collection — so
 * the owner can read, annotate and attach PDFs there, and a later diff can report drift both ways.
 *
 * WHAT IS WRITTEN, FROM WHERE. For each DOI in `audits/CITATION-VERIFICATION-2026-08-05.json` the
 * Crossref record is fetched (polite: one request per second, a named user agent) and cached beside
 * the local literature store as `crossref.json`, then mapped to a Zotero item: type from Crossref's
 * `type`, title, every author with given/family names, the container title, date, volume, issue,
 * pages, DOI, URL, ISSN, abstract (JATS tags stripped), and an `extra` line naming the ledger's own
 * first-author/year so a reader can see what the citation gate matched. A field Crossref does not carry
 * is left EMPTY — never a placeholder (§∅ applies to bibliographies too). No attachment is uploaded:
 * the free plan caps attachment storage, and which PDFs go up is the owner's choice.
 *
 * KEY HANDLING. `~/.config/tepna/zotero.env` (0600) holds ZOTERO_API_KEY and ZOTERO_USER_ID, read by
 * name, never printed; every error string is scrubbed of the key before it reaches a log. The only
 * writes are item creation and one collection; nothing is ever updated or deleted here.
 *
 * THE VERDICT (gate `zotero-fill`): population = the ledger's DOIs; checked = created + already
 * present; excluded = DOIs that could not be resolved or written, each with its reason; PASS only when
 * excluded is 0, else SHORTFALL naming them. `--dry-run` reads the library but writes nothing and
 * reports NOT_RUN. `--verdict-sample` enumerates nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';
import { producedByOf } from './corpus-scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const IS_MAIN = (() => {
  try {
    return isCliEntry(import.meta.url);
  } catch {
    return false;
  }
})();

export const LEDGER = join(ROOT, 'audits', 'CITATION-VERIFICATION-2026-08-05.json');
export const LIT_DIR = process.env.TEPNA_LITERATURE_DIR || join(homedir(), 'tepna-literature');
export const COLLECTION_NAME = 'Tepna citation ledger';
export const TAG = 'tepna-ledger';
export const UA = 'Tepna-zotero-fill/1 (+https://github.com/Plantucha/Tepna; mailto via repo)';
const ZOTERO = 'https://api.zotero.org';

/* ── pure: Crossref type → Zotero item type ──────────────────────────────────────────────────────── */
export function zoteroType(crType) {
  switch (String(crType || '')) {
    case 'journal-article':
      return 'journalArticle';
    case 'proceedings-article':
      return 'conferencePaper';
    case 'book-chapter':
      return 'bookSection';
    case 'book':
    case 'monograph':
    case 'edited-book':
      return 'book';
    case 'report':
      return 'report';
    case 'posted-content':
      return 'preprint';
    default:
      return 'document';
  }
}
export function stripJats(s) {
  return String(s || '')
    .replace(/<jats:title>[^<]*<\/jats:title>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function crossrefDate(msg) {
  const parts = msg?.issued?.['date-parts']?.[0] || msg?.published?.['date-parts']?.[0] || msg?.created?.['date-parts']?.[0];
  if (!Array.isArray(parts) || !parts.length) return '';
  return parts
    .slice(0, 3)
    .map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, '0')))
    .join('-');
}
/* ── pure: a Crossref `message` + the ledger entry → one Zotero item (fields absent stay empty) ─── */
export function toZoteroItem(msg, doi, ledgerEntry, collectionKey) {
  const t = zoteroType(msg?.type);
  const creators = (msg?.author || []).map((a) =>
    a.family || a.given ? { creatorType: 'author', firstName: a.given || '', lastName: a.family || '' } : { creatorType: 'author', name: a.name || '' }
  );
  const item = {
    itemType: t,
    title: stripJats(Array.isArray(msg?.title) ? msg.title[0] : msg?.title),
    creators,
    abstractNote: stripJats(msg?.abstract),
    date: crossrefDate(msg),
    DOI: doi,
    url: msg?.URL || '',
    language: msg?.language || '',
    extra: ledgerEntry ? `Tepna ledger: ${ledgerEntry.firstAuthor || '?'} ${ledgerEntry.year || '?'} (citation gate match)` : 'Tepna ledger',
    tags: [{ tag: TAG }],
    collections: collectionKey ? [collectionKey] : []
  };
  const container = Array.isArray(msg?.['container-title']) ? msg['container-title'][0] : msg?.['container-title'];
  if (t === 'journalArticle' || t === 'conferencePaper' || t === 'bookSection') {
    if (t === 'journalArticle') item.publicationTitle = container || '';
    if (t === 'conferencePaper') item.proceedingsTitle = container || '';
    if (t === 'bookSection') item.bookTitle = container || '';
    item.volume = msg?.volume || '';
    item.issue = msg?.issue || '';
    item.pages = msg?.page || '';
  }
  if (t === 'journalArticle') item.ISSN = Array.isArray(msg?.ISSN) ? msg.ISSN[0] : msg?.ISSN || '';
  if (msg?.publisher && (t === 'book' || t === 'bookSection' || t === 'report' || t === 'document')) item.publisher = msg.publisher;
  return item;
}
export function litSlug(doi) {
  return String(doi).replace(/\//g, '_');
}
export function readLedger(path = LEDGER) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const dois = d.dois || {};
  return Object.keys(dois).map((doi) => ({ doi, entry: dois[doi] }));
}

/* ── IO: credentials, scrub, HTTP ───────────────────────────────────────────────────────────────── */
function creds() {
  const f = join(homedir(), '.config', 'tepna', 'zotero.env');
  const txt = readFileSync(f, 'utf8');
  const key = (txt.match(/^ZOTERO_API_KEY=(.+)$/m) || [])[1]?.trim();
  const uid = (txt.match(/^ZOTERO_USER_ID=(\d+)$/m) || [])[1];
  if (!key || !uid) throw new Error('zotero.env lacks ZOTERO_API_KEY or a numeric ZOTERO_USER_ID');
  return { key, uid };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function zfetch(c, path, init = {}) {
  const r = await fetch(`${ZOTERO}${path}`, { ...init, headers: { 'Zotero-API-Key': c.key, 'Zotero-API-Version': '3', 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  const scrub = (s) => String(s).split(c.key).join('<KEY>');
  if (!r.ok) throw new Error(`zotero ${init.method || 'GET'} ${path} → ${r.status}: ${scrub(text).slice(0, 200)}`);
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}
async function crossref(doi) {
  const dir = join(LIT_DIR, litSlug(doi));
  const cache = join(dir, 'crossref.json');
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  await sleep(1000);
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`crossref ${doi} → ${r.status}`);
  const j = await r.json();
  const msg = j.message;
  mkdirSync(dir, { recursive: true });
  writeFileSync(cache, JSON.stringify(msg));
  return msg;
}
async function ensureCollection(c, dry) {
  const r = await zfetch(c, `/users/${c.uid}/collections?limit=100`);
  const hit = (r.body || []).find((x) => x.data?.name === COLLECTION_NAME);
  if (hit) return hit.key;
  if (dry) return null;
  const w = await zfetch(c, `/users/${c.uid}/collections`, { method: 'POST', body: JSON.stringify([{ name: COLLECTION_NAME }]) });
  const key = w.body?.successful?.['0']?.key;
  if (!key) throw new Error('collection creation returned no key');
  return key;
}
async function existingDois(c) {
  const out = new Map();
  let start = 0;
  for (;;) {
    const r = await zfetch(c, `/users/${c.uid}/items?limit=100&start=${start}&itemType=-attachment%20%7C%7C%20note`);
    const rows = r.body || [];
    for (const it of rows) {
      const d = (it.data?.DOI || '').toLowerCase();
      if (d) out.set(d, it.key);
    }
    const total = Number(r.headers.get('total-results') || 0);
    start += rows.length;
    if (!rows.length || start >= total) break;
  }
  return out;
}

export async function run({ dry = false } = {}) {
  const ledger = readLedger();
  const c = creds();
  const existing = await existingDois(c);
  const collectionKey = await ensureCollection(c, dry);
  const created = [];
  const already = [];
  const failed = [];
  const batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const w = await zfetch(c, `/users/${c.uid}/items`, { method: 'POST', body: JSON.stringify(batch.map((b) => b.item)) });
    const ok = w.body?.successful || {};
    const bad = w.body?.failed || {};
    batch.forEach((b, i) => {
      if (ok[String(i)]) created.push(b.doi);
      else failed.push({ doi: b.doi, reason: `zotero rejected: ${JSON.stringify(bad[String(i)] || 'unknown').slice(0, 160)}` });
    });
    batch.length = 0;
  };
  for (const { doi, entry } of ledger) {
    if (existing.has(doi.toLowerCase())) {
      already.push(doi);
      continue;
    }
    let msg;
    try {
      msg = await crossref(doi);
    } catch (e) {
      failed.push({ doi, reason: e.message });
      continue;
    }
    const item = toZoteroItem(msg, doi, entry, collectionKey);
    if (dry) {
      created.push(doi);
      continue;
    }
    batch.push({ doi, item });
    if (batch.length === 50) await flush();
  }
  if (!dry) await flush();
  const status = dry ? 'NOT_RUN' : failed.length ? 'SHORTFALL' : 'PASS';
  const verdict = Verdict.make({
    gate: 'zotero-fill',
    status,
    scope: 'internal',
    population: { checked: created.length + already.length, eligible: ledger.length, excluded: failed.length },
    criterion: { name: 'ledger_dois_present_in_library', threshold: ledger.length, unit: 'dois', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { created: created.length, alreadyPresent: already.length, failed, collection: collectionKey },
    evidence: ['tools/zotero-fill.mjs', 'audits/CITATION-VERIFICATION-2026-08-05.json'],
    reason: dry
      ? `--dry-run: ${created.length} would be created, ${already.length} already present, ${failed.length} unresolvable — nothing written`
      : failed.length
        ? `${failed.length} of ${ledger.length} DOIs not written: ${failed.map((f) => f.doi).join(', ')}`
        : null,
    producedBy: producedByOf('tools/zotero-fill.mjs', null)
  });
  return { verdict, created, already, failed };
}

export function selftest() {
  let pass = 0;
  const fail = [];
  const ok = (l, c, d) => {
    if (c) pass++;
    else fail.push(d ? `${l} — ${d}` : l);
  };
  ok('journal-article → journalArticle', zoteroType('journal-article') === 'journalArticle');
  ok(
    'proceedings-article → conferencePaper; book-chapter → bookSection; unknown → document',
    zoteroType('proceedings-article') === 'conferencePaper' && zoteroType('book-chapter') === 'bookSection' && zoteroType('weird') === 'document'
  );
  ok('JATS tags are stripped and whitespace collapsed', stripJats('<jats:p>Sleep <i>apnea</i>\n  index</jats:p>') === 'Sleep apnea index');
  ok(
    'a date is built from issued date-parts, zero-padded',
    crossrefDate({ issued: { 'date-parts': [[2022, 3, 7]] } }) === '2022-03-07' && crossrefDate({ issued: { 'date-parts': [[1996]] } }) === '1996'
  );
  ok('no date-parts ⇒ empty, never a fabricated year', crossrefDate({}) === '');
  const msg = {
    type: 'journal-article',
    title: ['Clinical calorimetry'],
    author: [{ given: 'Eugene', family: 'Du Bois' }, { name: 'Consortium X' }],
    'container-title': ['Archives of Internal Medicine'],
    issued: { 'date-parts': [[1916, 11]] },
    volume: '17',
    issue: '5',
    page: '863-871',
    URL: 'https://doi.org/10.1/x',
    ISSN: ['0003-9926'],
    abstract: '<jats:p>Heat.</jats:p>'
  };
  const it = toZoteroItem(msg, '10.1/x', { firstAuthor: 'Du BOIS', year: '1916' }, 'COLL');
  ok(
    'a journal article maps every carried field',
    it.itemType === 'journalArticle' &&
      it.title === 'Clinical calorimetry' &&
      it.publicationTitle === 'Archives of Internal Medicine' &&
      it.date === '1916-11' &&
      it.volume === '17' &&
      it.issue === '5' &&
      it.pages === '863-871' &&
      it.DOI === '10.1/x' &&
      it.ISSN === '0003-9926' &&
      it.abstractNote === 'Heat.',
    JSON.stringify(it)
  );
  ok(
    'creators keep given/family, and a corporate author becomes a single-field name',
    it.creators[0].lastName === 'Du Bois' && it.creators[0].firstName === 'Eugene' && it.creators[1].name === 'Consortium X'
  );
  ok('the ledger match rides in extra, the tag and collection are set', /Tepna ledger: Du BOIS 1916/.test(it.extra) && it.tags[0].tag === TAG && it.collections[0] === 'COLL');
  const sparse = toZoteroItem({ type: 'journal-article', title: ['T'] }, '10.1/y', null, null);
  ok(
    'fields Crossref does not carry stay EMPTY — never a placeholder',
    sparse.date === '' && sparse.volume === '' && sparse.pages === '' && sparse.ISSN === '' && sparse.creators.length === 0 && sparse.collections.length === 0
  );
  ok('litSlug matches the literature store folder names', litSlug('10.1001/archinte.1916.00080130010002') === '10.1001_archinte.1916.00080130010002');
  const v = Verdict.make({
    gate: 'zotero-fill',
    status: 'NOT_RUN',
    scope: 'internal',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'ledger_dois_present_in_library', threshold: 0, unit: 'dois', direction: 'eq' },
    result: null,
    evidence: ['tools/zotero-fill.mjs'],
    reason: 'sample',
    producedBy: { tool: 'tools/zotero-fill.mjs', commit: null, commitReason: 'selftest' }
  });
  ok('the sample verdict validates', Verdict.validate(v).ok === true, JSON.stringify(Verdict.validate(v)));
  return { pass, fail, ok: fail.length === 0, line: fail.length ? `✗ ${fail.length} failed, ${pass} passed` : `✓ all ${pass} selftests passed` };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  if (argv.includes('--verdict-sample')) {
    const v = Verdict.make({
      gate: 'zotero-fill',
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'ledger_dois_present_in_library', threshold: 0, unit: 'dois', direction: 'eq' },
      result: null,
      evidence: ['tools/zotero-fill.mjs'],
      reason: '--verdict-sample reads no ledger and touches no library — nothing was examined',
      producedBy: producedByOf('tools/zotero-fill.mjs', null)
    });
    process.stdout.write(`${JSON.stringify(v)}\n`);
    process.exit(0);
  }
  const dry = argv.includes('--dry-run');
  const { verdict, created, already, failed } = await run({ dry });
  if (!argv.includes('--json')) {
    process.stdout.write(`▸ zotero-fill · ${verdict.status} · ${dry ? 'would create' : 'created'} ${created.length} · already present ${already.length} · failed ${failed.length}\n`);
    for (const f of failed) process.stdout.write(`  ✕ ${f.doi}: ${f.reason}\n`);
  }
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(verdict.status === 'PASS' || verdict.status === 'NOT_RUN' ? 0 : 1);
}
if (IS_MAIN)
  main().catch((e) => {
    console.error(`zotero-fill: ${e.message}`);
    process.exit(2);
  });
