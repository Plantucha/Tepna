/**
 * tools/gemini-review.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * THE SECOND READER, ON EXACTLY THE FORM CODEX WAS GIVEN. Owner ruling 2026-10-05: Codex's free tier is
 * exhausted until 2026-11-03, so try Gemini's. The reader gets a SURVIVOR LIST and returns, per mutant,
 * one distinguishing INPUT or an equivalence ARGUMENT citing lines — never test code. The bird verifies
 * every claim against original and mutant before writing a test; this tool does not write tests and
 * does not decide anything.
 *
 * ⚠️ GEMINI HAS NO CWD, AND THAT IS THE ONE PLACE THIS CANNOT COPY CODEX LITERALLY. Codex ran as
 * `codex exec --sandbox read-only -C <export dir>` and READ THE FILES ITSELF. A REST API cannot, so the
 * source must be SENT. Same information, different delivery — and it moves where the corpus boundary is
 * enforced: not a sandbox, but this tool's refusal to read a single byte from anywhere except an export
 * built by `tools/codex-export.mjs`. `--src` is verified to BE such an export before anything is read
 * (it must carry the export's own marker files and must not carry `uploads/`), because a directory that
 * merely looks like a checkout is how the corpus would leave.
 *
 * THE KEY CONTRACT (owner, via Kestrel 2026-10-05):
 *   · `GEMINI_API_KEY` from the environment, OR from `~/.config/tepna/gemini.env` (`KEY=value`, mode 0600).
 *   · REFUSE with a NAMED reason when neither exists, or when that file is group- or world-readable.
 *   · The value is never logged, printed or echoed, and is STRIPPED FROM EVERY ERROR TEXT — the scrub
 *     lives on the error path, not only the success path, because an exception that interpolates a URL
 *     or headers is the leak. `scrub()` is applied to anything this tool prints, including stack text.
 *
 *   node tools/gemini-review.mjs --src <export dir> --prompt <file> [--model <m>] [--out <jsonl>]
 *   node tools/gemini-review.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_FILE = join(homedir(), '.config', 'tepna', 'gemini.env');
/* Pinned, not an alias. `gemini-flash-latest` cannot satisfy "state the version in the brief", because
   the thing it names changes under the scorecard. Measured 2026-10-05: 3.8-flash and 3.6-flash answer,
   3.7-flash returns 503, so "newest" is not the same as "served". */
const DEFAULT_MODEL = 'gemini-3.8-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Everything this tool prints goes through here. A leak is one interpolated error away. */
export function scrub(text, secret) {
  const s = String(text ?? '');
  if (!secret) return s;
  return s.split(secret).join('<GEMINI_API_KEY REDACTED>');
}

/** `{ key }` or `{ reason }` — PURE over an injected environment and stat, so --selftest can pin every
 *  refusal without a key on the box. The reason NAMES which condition failed; "no key" and "the file is
 *  world-readable" call for opposite responses from a reader. */
export function resolveKey({ env = {}, exists = () => false, mode = () => 0o600, read = () => '' } = {}) {
  if (env.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim())
    return { key: String(env.GEMINI_API_KEY).trim(), from: 'environment' };
  if (!exists(KEY_FILE))
    return { reason: `no GEMINI_API_KEY in the environment and no key file at ${KEY_FILE} — refusing rather than running unauthenticated` };
  const m = mode(KEY_FILE) & 0o777;
  if (m & 0o077)
    return { reason: `the key file ${KEY_FILE} is mode ${m.toString(8)} — group- or world-readable, so it is not a secret; refusing until it is 0600` };
  const line = String(read(KEY_FILE))
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) return { reason: `the key file ${KEY_FILE} carries no GEMINI_API_KEY= line` };
  const v = line.slice('GEMINI_API_KEY='.length).trim();
  if (!v) return { reason: `the key file ${KEY_FILE} has an EMPTY GEMINI_API_KEY value` };
  return { key: v, from: 'key file' };
}

/** An export dir, or a reason. The marker set is what `codex-export.mjs` guarantees it writes and omits;
 *  a plain checkout passes a naive existsSync check and carries the corpus, which is the whole hazard. */
export function verifyExport(dir, { exists = existsSync } = {}) {
  if (!dir) return { reason: '--src is required: the reader may only be shown a codex-export output' };
  if (!exists(dir)) return { reason: `--src ${dir} does not exist` };
  if (!exists(join(dir, 'CLAUDE.md')))
    return { reason: `--src ${dir} carries no CLAUDE.md — it is not a tools/codex-export.mjs output` };
  for (const forbidden of ['uploads', 'provenance', 'audits', 'briefs', 'papers'])
    if (exists(join(dir, forbidden)))
      return { reason: `--src ${dir} carries ${forbidden}/ — that is a checkout, not an export; refusing to read it` };
  return { ok: true };
}

export function buildRequest(promptText, sources, model) {
  /* The survivor list FIRST and the source after it, because the question is what the reader is being
     asked to do and the files are the evidence. Each file is fenced with its repo-relative path, so a
     line-number citation in the answer is checkable against the tree. */
  const body = [promptText.trim(), '', '--- SOURCE (read-only; cite line numbers from these files) ---'];
  for (const [path, text] of sources) body.push('', `### ${path}`, '```python', text.replace(/\s+$/, ''), '```');
  return {
    model,
    contents: [{ parts: [{ text: body.join('\n') }] }],
    /* 65536 is this model class's own output limit, and the budget must be near it because THINKING
       TOKENS COUNT AGAINST IT. Measured 2026-10-05: a 41-id prompt spent 15,739 thought tokens and
       emitted 654 visible ones inside a 16,384 cap, so the answer truncated mid-sentence with
       finishReason MAX_TOKENS — a short answer that reads like a weak model and is a starved one.
       Always read finishReason before scoring; a truncated answer is not a measurement. */
    generationConfig: { temperature: 0, maxOutputTokens: 65536 }
  };
}

function record(outPath, obj) {
  if (outPath) appendFileSync(outPath, JSON.stringify(obj) + '\n', 'utf8');
}

async function main(argv) {
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--selftest')) return selftest();

  const k = resolveKey({ env: process.env, exists: existsSync, mode: (p) => statSync(p).mode, read: (p) => readFileSync(p, 'utf8') });
  if (k.reason) {
    console.error(`gemini-review: REFUSING — ${k.reason}`);
    return 1;
  }
  const key = k.key;
  try {
    const src = val('--src');
    const v = verifyExport(src);
    if (v.reason) {
      console.error(`gemini-review: REFUSING — ${v.reason}`);
      return 1;
    }
    const promptFile = val('--prompt');
    if (!promptFile || !existsSync(promptFile)) {
      console.error('gemini-review: REFUSING — --prompt <file> is required and must exist');
      return 1;
    }
    const model = val('--model') || DEFAULT_MODEL;
    const out = val('--out');
    const promptText = readFileSync(promptFile, 'utf8');

    /* Which files to send: every `module.function` named in the prompt, resolved INSIDE the export. A
       path that escapes the export is a refusal, not a skip — the boundary is the point. */
    const mods = [...new Set([...promptText.matchAll(/^([A-Za-z]\.\s+)?([a-z0-9_]+)\.[a-z0-9_]+\(/gm)].map((m) => m[2]))];
    const sources = [];
    for (const m of mods) {
      const rel = join('capture-host', `${m}.py`);
      const p = join(src, rel);
      if (!p.startsWith(src)) {
        console.error(`gemini-review: REFUSING — ${rel} resolves outside the export`);
        return 1;
      }
      if (existsSync(p)) sources.push([rel, readFileSync(p, 'utf8')]);
    }
    if (!sources.length) {
      console.error('gemini-review: REFUSING — the prompt named no module this export carries; nothing to show the reader');
      return 1;
    }

    const req = buildRequest(promptText, sources, model);
    const meta = await (await fetch(`${API}/${model}`, { headers: { 'x-goog-api-key': key } })).json();
    const version = meta?.version || 'unknown';
    const at = new Date().toISOString();
    record(out, { at, model, version, kind: 'request', sources: sources.map(([p, t]) => ({ path: p, bytes: t.length })), prompt: req.contents[0].parts[0].text });

    const r = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: req.contents, generationConfig: req.generationConfig })
    });
    const raw = await r.text();
    record(out, { at: new Date().toISOString(), model, version, kind: 'response', http: r.status, body: raw });
    if (!r.ok) {
      console.error(scrub(`gemini-review: HTTP ${r.status} — ${raw.slice(0, 400)}`, key));
      return 1;
    }
    const d = JSON.parse(raw);
    const text = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text.trim()) {
      console.error(`gemini-review: EMPTY answer (finishReason ${d?.candidates?.[0]?.finishReason}) — nothing was read`);
      return 1;
    }
    console.log(`# model ${model} version ${version}  ·  ${sources.length} source file(s) sent  ·  jsonl ${out || '(not kept)'}`);
    console.log(text);
    return 0;
  } catch (e) {
    console.error(scrub(`gemini-review: ${e && e.stack ? e.stack : e}`, key));
    return 1;
  }
}

function selftest() {
  let bad = 0;
  const ck = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.log(`  selftest FAIL ${name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      bad++;
    }
  };
  /* THE REFUSAL PATH IS THE ONE THAT RUNS FIRST on a box where the key is absent, so it is pinned
     first. Each reason must NAME its condition: "no key" and "world-readable" are opposite responses. */
  ck('env key wins', resolveKey({ env: { GEMINI_API_KEY: ' k ' } }), { key: 'k', from: 'environment' });
  const noFile = resolveKey({ env: {}, exists: () => false });
  ck('no key anywhere refuses', !!noFile.reason && /no key file at/.test(noFile.reason), true);
  const loose = resolveKey({ env: {}, exists: () => true, mode: () => 0o644 });
  ck('a 0644 key file refuses', !!loose.reason && /group- or world-readable/.test(loose.reason), true);
  ck('0644 names the mode', /mode 644/.test(loose.reason), true);
  const grp = resolveKey({ env: {}, exists: () => true, mode: () => 0o640 });
  ck('a GROUP-readable 0640 refuses too', !!grp.reason && /group- or world-readable/.test(grp.reason), true);
  const noLine = resolveKey({ env: {}, exists: () => true, mode: () => 0o600, read: () => 'OTHER=1\n' });
  ck('a file without the line refuses', /carries no GEMINI_API_KEY= line/.test(noLine.reason), true);
  const empty = resolveKey({ env: {}, exists: () => true, mode: () => 0o600, read: () => 'GEMINI_API_KEY=\n' });
  ck('an EMPTY value refuses', /EMPTY GEMINI_API_KEY value/.test(empty.reason), true);
  ck('a 0600 file is read', resolveKey({ env: {}, exists: () => true, mode: () => 0o600, read: () => 'GEMINI_API_KEY=abc\n' }), { key: 'abc', from: 'key file' });
  /* THE SCRUB. A secret that appears in a stack trace is leaked exactly as hard as one printed. */
  ck('scrub replaces every occurrence', scrub('a SEK b SEK', 'SEK'), 'a <GEMINI_API_KEY REDACTED> b <GEMINI_API_KEY REDACTED>');
  ck('scrub survives no secret', scrub('plain', ''), 'plain');
  ck('scrub survives a null message', scrub(null, 'SEK'), '');
  /* THE EXPORT BOUNDARY: a plain checkout must be refused, and the reason must say which tree betrayed it. */
  const chk = verifyExport('/x', { exists: (p) => p === '/x' || p.endsWith('CLAUDE.md') || p.endsWith('uploads') });
  ck('a dir carrying uploads/ is refused', /carries uploads\/ — that is a checkout/.test(chk.reason), true);
  ck('a dir with no CLAUDE.md is refused', /carries no CLAUDE.md/.test(verifyExport('/x', { exists: (p) => p === '/x' }).reason), true);
  ck('a missing --src is refused', /does not exist/.test(verifyExport('/x', { exists: () => false }).reason), true);
  ck('an absent --src is refused by name', /--src is required/.test(verifyExport('').reason), true);
  ck('a real export passes', verifyExport('/x', { exists: (p) => p === '/x' || p.endsWith('CLAUDE.md') }), { ok: true });
  /* The request carries the question BEFORE the evidence, and fences each file with its path. */
  const req = buildRequest('Q?', [['capture-host/a.py', 'code\n']], 'm');
  ck('the prompt leads', req.contents[0].parts[0].text.startsWith('Q?'), true);
  ck('the source is fenced with its path', /### capture-host\/a\.py\n```python\ncode\n```/.test(req.contents[0].parts[0].text), true);
  ck('temperature is pinned to 0', req.generationConfig.temperature, 0);
  console.log(bad ? `  selftest: ${bad} FAILED` : '  selftest: resolveKey + scrub + verifyExport + buildRequest OK');
  return bad ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
