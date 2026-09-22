#!/usr/bin/env node
// tepna — tools/verify-seals.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
//
// VERIFY A `tepna-seal/1` FILE — the Node twin of capture-host/unseal.py (CAPTURE-NIGHT-SEAL §5, §6).
//
// WebCrypto primitives ONLY (`node:crypto`'s webcrypto): ECDSA P-256/SHA-256 with raw r‖s, HKDF-SHA-256,
// AES-KW unwrap, AES-256-GCM, SHA-256. No vendored crypto or zip libraries — the ~40-line central-directory
// parser below plus raw deflate is the whole recipe, so phase C's browser reader (DecompressionStream
// "deflate-raw" + crypto.subtle) reuses it verbatim. Nothing here may drift from unseal.py: both are
// verified against the same committed vectors, and the Python plant runner judges THIS verifier on the
// same seven plants it judges its own.
//
//   node tools/verify-seals.mjs --vectors                       # the committed vector, must be ok
//   node tools/verify-seals.mjs <file.tepna> --card-key <hex> --pin <sha256/…> [--known-revision N] [--json]
//
// Exit 0 = verified · 2 = REFUSED (kind printed, same vocabulary as unseal.KINDS) · 1 = usage / crash.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// THE contract's only definition (VERDICT-CONTRACT §2): every object this tool emits is validated by it
// before it is printed, so a hand-written shape reds here, not in a reader's regex.
const Verdict = require('../verdict.js');
const HERE = dirname(fileURLToPath(import.meta.url));

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

// ── constants: echo sealfmt.py exactly ──────────────────────────────────────────────────────────────
const FORMAT = 'tepna-seal/1';
const MAGIC = enc.encode('TEPNASEAL');
const VERSION = 1;
const KEK_INFO = enc.encode('tepna-seal/1 card-kek');
const GCM_NONCE_BYTES = 12;
const P256_SIG_BYTES = 64;
export const KINDS = ['magic', 'version', 'header', 'fingerprint', 'signature', 'revision', 'card-key', 'payload', 'zip', 'oxum', 'manifest', 'consent'];

export class SealRefused extends Error {
  constructor(kind, detail) {
    super(`${kind}: ${detail}`);
    if (!KINDS.includes(kind.split(':')[0])) throw new Error(`unknown refusal kind ${kind}`);
    this.kind = kind;
    this.detail = detail;
  }
}

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const sha256 = async (u8) => new Uint8Array(await subtle.digest('SHA-256', u8));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── framing ─────────────────────────────────────────────────────────────────────────────────────────
function split(blob) {
  if (!eq(blob.subarray(0, MAGIC.length), MAGIC)) throw new SealRefused('magic', 'not a tepna seal');
  let p = MAGIC.length;
  if (blob[p] !== VERSION) throw new SealRefused('version', `seal version ${blob[p]}; this reader knows ${VERSION}`);
  p += 1;
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let header, headerBytes, sig, payload;
  try {
    const hlen = dv.getUint32(p);
    p += 4;
    headerBytes = blob.subarray(p, p + hlen);
    p += hlen;
    if (headerBytes.length !== hlen) throw new SealRefused('header', `header truncated: ${headerBytes.length} of ${hlen} bytes`);
    header = JSON.parse(dec.decode(headerBytes));
    const slen = dv.getUint16(p);
    p += 2;
    sig = blob.subarray(p, p + slen);
    p += slen;
    if (sig.length !== P256_SIG_BYTES) throw new SealRefused('signature', `signature is ${sig.length} bytes, not ${P256_SIG_BYTES}`);
    const plen = Number(dv.getBigUint64(p));
    p += 8;
    payload = blob.subarray(p, p + plen);
    if (payload.length !== plen) throw new SealRefused('payload', `payload truncated: ${payload.length} of ${plen} bytes`);
  } catch (e) {
    if (e instanceof SealRefused) throw e;
    throw new SealRefused('header', `cannot parse the clear header: ${e.message}`);
  }
  if (!header || typeof header !== 'object' || header.format !== FORMAT) throw new SealRefused('header', `format is ${JSON.stringify(header?.format)}, not ${FORMAT}`);
  return { header, headerBytes, sig, payload };
}

export function readHeader(blob) {
  return split(blob).header;
}

// ── a zip's central directory, no library ───────────────────────────────────────────────────────────
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SealRefused('zip', 'no end-of-central-directory record');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new SealRefused('zip', 'bad central-directory entry');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true),
      xlen = dv.getUint16(p + 30, true),
      clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (dv.getUint32(off, true) !== 0x04034b50) throw new SealRefused('zip', `bad local header for ${name}`);
    const lnlen = dv.getUint16(off + 26, true),
      lxlen = dv.getUint16(off + 28, true);
    const start = off + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8)
      data = new Uint8Array(inflateRawSync(raw)); // browser: DecompressionStream("deflate-raw")
    else throw new SealRefused('zip', `unsupported compression ${method} for ${name}`);
    if (data.length !== usize) throw new SealRefused('zip', `${name}: inflated ${data.length}, expected ${usize}`);
    entries[name] = data;
  }
  return entries;
}

function bagInfo(entries) {
  if (!entries['bag-info.txt']) throw new SealRefused('zip', 'bag-info.txt missing');
  let text;
  try {
    text = dec.decode(entries['bag-info.txt']);
  } catch {
    // fatal decoder: not UTF-8 is a refusal, not a crash
    throw new SealRefused('zip', 'bag-info.txt is not UTF-8');
  }
  const info = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(': ');
    if (i > 0) info[line.slice(0, i)] = line.slice(i + 2);
  }
  return info;
}

async function checkManifest(entries, name) {
  if (!entries[name]) throw new SealRefused('zip', `${name} missing`);
  let text;
  try {
    text = dec.decode(entries[name]);
  } catch {
    throw new SealRefused('zip', `${name} is not UTF-8`);
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('  ');
    if (i < 0) throw new SealRefused('zip', `${name}: unparseable line`);
    const want = line.slice(0, i),
      path = line.slice(i + 2);
    if (!entries[path]) throw new SealRefused(`manifest:${path}`, `listed in ${name} but absent from the bag`);
    const got = hex(await sha256(entries[path]));
    if (got !== want) throw new SealRefused(`manifest:${path}`, `SHA-256 ${got.slice(0, 12)}… does not match ${want.slice(0, 12)}…`);
  }
}

// ── the verifier ───────────────────────────────────────────────────────────────────────────────────
export async function unseal(blob, { cardKey, pinnedFingerprint, knownRevision = null }) {
  const { header, headerBytes, sig, payload } = split(blob);

  const rawPub = b64(header.boxKey ?? '');
  const fp = 'sha256/' + hex(await sha256(rawPub));
  if (header.boxKeyFingerprint !== pinnedFingerprint || fp !== pinnedFingerprint) throw new SealRefused('fingerprint', `box key ${header.boxKeyFingerprint} is not the pinned ${pinnedFingerprint}`);

  let pub;
  try {
    pub = await subtle.importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch (e) {
    throw new SealRefused('header', `boxKey is not a P-256 point: ${e.message}`);
  }
  const msg = new Uint8Array(headerBytes.length + 32);
  msg.set(headerBytes, 0);
  msg.set(await sha256(payload), headerBytes.length);
  if (!(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg))) throw new SealRefused('signature', 'ECDSA over header ‖ SHA-256(payload) does not verify');

  const rev = header.revision;
  if (!Number.isInteger(rev) || rev < 1) throw new SealRefused('header', `revision is ${JSON.stringify(rev)}`);
  if (knownRevision !== null && rev < knownRevision) throw new SealRefused('revision', `revision ${rev} presented after revision ${knownRevision} was already seen`);

  const recip = (header.recipients ?? []).find((r) => r.kind === 'card' && r.keyId === header.keyId);
  if (!recip || recip.wrap !== 'AES-KW') throw new SealRefused('header', `no AES-KW card recipient for keyId ${header.keyId}`);
  const salt = enc.encode(String(header.boxId) + String(header.keyId));
  const ikm = await subtle.importKey('raw', cardKey, 'HKDF', false, ['deriveKey']);
  const kek = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: KEK_INFO }, ikm, { name: 'AES-KW', length: 256 }, false, ['unwrapKey']);
  let dataKey;
  try {
    dataKey = await subtle.unwrapKey('raw', b64(recip.wrapped), kek, 'AES-KW', { name: 'AES-GCM' }, false, ['decrypt']);
  } catch {
    throw new SealRefused('card-key', `the card key does not unwrap this seal's data key (keyId ${header.keyId})`);
  }
  let plain;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, GCM_NONCE_BYTES), additionalData: headerBytes }, dataKey, payload.subarray(GCM_NONCE_BYTES)));
  } catch {
    throw new SealRefused('payload', 'AES-GCM tag does not verify');
  }
  const entries = unzip(plain);
  const info = bagInfo(entries);
  const files = {};
  for (const [k, v] of Object.entries(entries)) if (k.startsWith('data/')) files[k.slice(5)] = v;
  const got = `${Object.values(files).reduce((n, v) => n + v.length, 0)}.${Object.keys(files).length}`;
  if ((info['Payload-Oxum'] ?? '') !== got) throw new SealRefused('oxum', `Payload-Oxum says ${info['Payload-Oxum']}, data/ holds ${got} — checked before any hashing`);
  await checkManifest(entries, 'tagmanifest-sha256.txt');
  await checkManifest(entries, 'manifest-sha256.txt');
  const consent = header.consent === 'yes' || header.consent === 'no' ? header.consent : null; // absent ⇒ null, never "no"
  // The header MIRRORS bag-info's consent (format §2). Two answers to one question is a seal that was
  // assembled wrong, and a reader must not pick either: refuse by name (plant 8).
  const inBag = info['Tepna-Research-Consent'] === 'yes' || info['Tepna-Research-Consent'] === 'no' ? info['Tepna-Research-Consent'] : null;
  if (inBag !== consent) throw new SealRefused('consent', `clear header says ${JSON.stringify(consent)} but bag-info.txt says ${JSON.stringify(inBag)}`);
  return { header, consent, bagInfo: info, files };
}

// ── tepna.verdict/1 — the object a consumer reads; the prose is for a human (VERDICT-CONTRACT §1) ──
import { execFileSync } from 'node:child_process';

function commitShort() {
  try {
    // `cwd: HERE` — the tree the TOOL lives in, not whatever directory the caller happened to be in
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  } // absence is null — and the caller must SAY WHY; see producedBy below (§∅)
}

/* ⚠️ AN IMPLICIT REASON IS NOT A STATED REASON. `commitShort()` returns null exactly when git cannot
   be read, and the comment above used to call that reason "implicit" — but `tepna.verdict/1` requires
   `producedBy.commitReason` whenever `commit` is null, and the validator below refuses the object
   without it. So the tool KNEW why and declined to write it down, and every run outside a git tree
   threw `verify-seals produced an invalid verdict: producedBy.commit is null without
   producedBy.commitReason (∅: say why)` instead of emitting a verdict.

   Measured 2026-09-22 on main @ f5db655a: inside a mutation scratch — a copied tree with no `.git` —
   this is **22 of the 31 failures**, carried by `tests/test_check_script.py` and `tests/test_seal.py`.
   It is a §∅ violation in a shipped tool, not a scratch artifact: the field exists for precisely the
   case that triggers it.

   ⚠️ THE REASON IS NOT SHARED WITH THE PYTHON SIDE, DELIBERATELY. `capture-host/verdict.py` has
   `NO_GIT_REASON = "the tree this ran in is not a git checkout (build_id.probe found no sha)"` and a
   helper that returns this same shape. Reusing that constant here would be the obvious tidy-up and
   would make this tool's reason FALSE: `build_id.probe` is the Python probe and this tool never runs
   it. The contract asks each producer to say why ITS OWN attempt failed, so two accurate reasons are
   correct and one shared inaccurate one is not. */
function producedBy() {
  const commit = commitShort();
  return commit ? { tool: 'tools/verify-seals.mjs', commit } : { tool: 'tools/verify-seals.mjs', commit: null, commitReason: 'git rev-parse --short HEAD failed in the tool\u2019s own directory (no checkout there)' };
}

export function verdict({ status, result, reason, evidence }) {
  if (status === 'PASS' && reason !== null) throw new Error('PASS carries no reason');
  if (status !== 'PASS' && !reason) throw new Error(`${status} requires a reason`);
  const notRun = status === 'NOT_RUN';
  const v = {
    schema: 'tepna.verdict/1',
    gate: 'verify-seals',
    status,
    scope: 'internal', // P5: nothing this tool says is quotable outside the repo until a producer WRITES publishable
    population: { checked: notRun ? 0 : 1, eligible: 1, excluded: notRun ? 1 : 0 },
    criterion: { name: 'tepna-seal/1 verifies end to end', threshold: 0, unit: 'refusals', direction: 'eq' },
    result,
    evidence,
    reason,
    producedBy: producedBy(),
    at: new Date().toISOString()
  };
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`verify-seals produced an invalid verdict: ${check.errors.join('; ')}`); // a producer bug, never emitted
  return v;
}

export async function judge(file, opts) {
  let blob;
  try {
    blob = new Uint8Array(readFileSync(file));
  } catch (e) {
    return verdict({ status: 'NOT_RUN', result: null, reason: `cannot read ${file}: ${e.message}`, evidence: ['tools/verify-seals.mjs'] });
  }
  try {
    const r = await unseal(blob, opts);
    return verdict({
      status: 'PASS',
      reason: null,
      evidence: ['tools/verify-seals.mjs', file],
      result: { kind: null, files: Object.keys(r.files).sort(), consent: r.consent, revision: r.header.revision, boxId: r.header.boxId, night: r.header.night }
    });
  } catch (e) {
    if (e instanceof SealRefused)
      return verdict({ status: 'FAIL', reason: `${e.kind}: ${e.detail}`, evidence: ['tools/verify-seals.mjs', file], result: { kind: e.kind, files: null, consent: null, revision: null } });
    // A crash is not a verdict. Anything that is not a named refusal — a bug here, an OS error mid-read —
    // is UNKNOWN with the error as the reason, so a consumer never mistakes an exception for green.
    return verdict({ status: 'UNKNOWN', reason: `reader failed: ${e && e.message ? e.message : String(e)}`, evidence: ['tools/verify-seals.mjs', file], result: null });
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  if (argv[0] === '--vectors') {
    const dir = join(HERE, '..', 'capture-host', 'tests', 'vectors', 'tepna-seal-1');
    const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf-8'));
    const v = await judge(join(dir, exp.seal), { cardKey: fromHex(exp.cardKeyHex), pinnedFingerprint: exp.boxKeyFingerprint });
    const drift = v.status === 'PASS' && (JSON.stringify(v.result.files) !== JSON.stringify([...exp.inputs].sort()) || v.result.consent !== null);
    if (drift) {
      v.status = 'FAIL';
      v.reason = `vector content drifted: ${JSON.stringify(v.result)} vs ${JSON.stringify(exp.inputs)}`;
    }
    console.log(JSON.stringify(v)); // the object IS the verdict
    console.error(v.status === 'PASS' ? `verify-seals: vector ${exp.seal} ok — ${v.result.files.length} file(s), consent ${v.result.consent}` : `verify-seals: ${v.status} — ${v.reason}`);
    return v.status === 'PASS' ? 0 : 2;
  }
  const file = argv[0];
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i > 0 ? argv[i + 1] : undefined;
  };
  if (!file || !opt('--card-key') || !opt('--pin')) {
    console.error('usage: verify-seals.mjs --vectors | <file.tepna> --card-key <hex> --pin <sha256/…> [--known-revision N] [--json]');
    return 1;
  }
  const json = argv.includes('--json');
  const v = await judge(file, {
    cardKey: fromHex(opt('--card-key')),
    pinnedFingerprint: opt('--pin'),
    knownRevision: opt('--known-revision') !== undefined ? Number(opt('--known-revision')) : null
  });
  if (json) console.log(JSON.stringify(v));
  else console.log(v.status === 'PASS' ? `ok — ${v.result.files.length} file(s), consent ${v.result.consent}, revision ${v.result.revision}` : `${v.status} — ${v.reason}`);
  return v.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
