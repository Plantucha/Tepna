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
import { makeVerdict } from './verdict-emit.mjs';
import { join } from 'node:path';

const KEY_FILE = join(homedir(), '.config', 'tepna', 'gemini.env');
/* Pinned, not an alias. `gemini-flash-latest` cannot satisfy "state the version in the brief", because
   the thing it names changes under the scorecard. Measured 2026-10-05: 3.8-flash and 3.6-flash answer,
   3.7-flash returns 503, so "newest" is not the same as "served". */
const DEFAULT_MODEL = 'gemini-3.8-flash';
/* This model class's own output limit. Thinking tokens count against it — see the finishReason refusal. */
export const REQ_MAX_OUTPUT_TOKENS = 65536;
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
  if (env.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim()) return { key: String(env.GEMINI_API_KEY).trim(), from: 'environment' };
  if (!exists(KEY_FILE)) return { reason: `no GEMINI_API_KEY in the environment and no key file at ${KEY_FILE} — refusing rather than running unauthenticated` };
  const m = mode(KEY_FILE) & 0o777;
  if (m & 0o077) return { reason: `the key file ${KEY_FILE} is mode ${m.toString(8)} — group- or world-readable, so it is not a secret; refusing until it is 0600` };
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
  if (!exists(join(dir, 'CLAUDE.md'))) return { reason: `--src ${dir} carries no CLAUDE.md — it is not a tools/codex-export.mjs output` };
  for (const forbidden of ['uploads', 'provenance', 'audits', 'briefs', 'papers'])
    if (exists(join(dir, forbidden))) return { reason: `--src ${dir} carries ${forbidden}/ — that is a checkout, not an export; refusing to read it` };
  return { ok: true };
}

/** Ids sharing one line, e.g. `36/70/85: …`. OWNER RULING 2026-10-05 adopted the ONE-ID-PER-LINE form
 *  because grouping is most of what a grouped prompt loses: one input per group only distinguishes the
 *  members whose value has enough decimals to survive a rounding change. Measured on the 6a set — the
 *  same ids scored 6/14 grouped and 13/13 one per line. Reported, not refused: a caller re-running
 *  Wren's archived grouped prompts for comparison is doing the right thing deliberately. */
export function groupedIdLines(promptText) {
  return String(promptText || '')
    .split('\n')
    .filter((l) => /^\s*\d+(\s*\/\s*\d+)+\s*:/.test(l))
    .map((l) => l.trim().slice(0, 60));
}

/** ONE tepna.verdict/1 for this tool (§🧾). PURE, so `--verdict-sample` can print one with no key and
 *  no network — the sampling command a gate runs must not cost a request or need a secret.
 *
 *  The criterion is PRE-STATED and is the one thing this tool can actually decide: whether a COMPLETE
 *  answer came back. It does not judge the answer's content — the bird verifies every claim against
 *  the original before a test, and a tool that scored the reader would be deciding what it fetched.
 *  `MAX_TOKENS` is therefore UNKNOWN and never PASS: a truncated reply examined the prompt and settled
 *  nothing, which is exactly the shape §∅ and §🧾 refuse to let read green. */
export function reviewVerdict({ status, reason, model, version, ids = 0, answerBytes = 0, finish = null, at }) {
  const examined = status === 'PASS' || status === 'UNKNOWN' ? 1 : 0;
  return makeVerdict({
    gate: 'gemini-review',
    status,
    tool: 'tools/gemini-review.mjs',
    population: { checked: examined, eligible: 1, excluded: 1 - examined },
    /* NUMERIC by contract — `Verdict.validate` refuses a non-finite threshold, and it was right to:
       "STOP" is a label, not a bound, and a criterion you cannot compare is not pre-stated. The
       comparable quantity is how many replies came back truncated, and the bound is zero. */
    criterion: { name: 'truncated_replies', threshold: 0, unit: 'replies', direction: 'lte' },
    result: { model, version, ids, answerBytes, finishReason: finish, truncated: finish && finish !== 'STOP' ? 1 : 0 },
    evidence: ['tools/gemini-review.mjs'],
    reason: reason ?? null,
    at
  });
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
    generationConfig: { temperature: 0, maxOutputTokens: REQ_MAX_OUTPUT_TOKENS }
  };
}

/** ⚠️ THE TRANSCRIPT IS SCRUBBED TOO, and that was a real gap CodeQL found rather than a precaution.
 *  The first version applied `scrub` only to console output — but the jsonl is the artefact we KEEP and
 *  quote in PR bodies, so it is where a leaked secret would persist rather than scroll away. The
 *  response `body` is recorded verbatim and an API error can echo the request it rejected, so the one
 *  place the key could reach disk was the line meant to be evidence. Scrubbed at the write, where every
 *  record passes, instead of at each call site, where the next one would forget. */
function record(outPath, obj, secret) {
  if (outPath) appendFileSync(outPath, scrub(JSON.stringify(obj), secret) + '\n', 'utf8');
}

async function main(argv) {
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    /* A SYNTHETIC answer through the REAL builder — no key, no request, and the reason says so, so
       nobody reads this as a measurement of anything. */
    console.log(
      JSON.stringify(
        reviewVerdict({
          status: 'PASS',
          reason: null,
          model: DEFAULT_MODEL,
          version: 'sample',
          ids: 41,
          answerBytes: 13229,
          finish: 'STOP',
          at: '2026-10-05T22:00:00Z'
        }),
        null,
        2
      )
    );
    return 0;
  }

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
    const grouped = groupedIdLines(promptText);
    if (grouped.length)
      console.error(
        `gemini-review: ⚠ ${grouped.length} line(s) GROUP several ids. The adopted form is ONE ID PER LINE ` +
          `(owner 2026-10-05): grouped, the 6a set scored 6/14 on these; one per line, 13/13. First: ${grouped[0]}`
      );

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
    record(out, { at, model, version, kind: 'request', sources: sources.map(([p, t]) => ({ path: p, bytes: t.length })), prompt: req.contents[0].parts[0].text }, key);

    const r = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: req.contents, generationConfig: req.generationConfig })
    });
    const raw = await r.text();
    record(out, { at: new Date().toISOString(), model, version, kind: 'response', http: r.status, body: raw }, key);
    if (!r.ok) {
      console.error(scrub(`gemini-review: HTTP ${r.status} — ${raw.slice(0, 400)}`, key));
      return 1;
    }
    const d = JSON.parse(raw);
    const cand = d?.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
    const fin = cand?.finishReason;
    /* ⚠️ A TRUNCATED ANSWER IS NOT AN ANSWER, and it reads like a weak model. Measured 2026-10-05: a
       41-id prompt spent 15,739 THINKING tokens and emitted 654 visible ones inside a 16,384 cap, so
       the reply stopped mid-sentence at 2,204 bytes against 6,743 for an easier prompt — which looks
       exactly like "it does worse when asked per id". Raising the cap to this model's own 65,536
       returned 13,229 bytes and STOP. Refused by NAME so nobody scores a starved reply. */
    if (fin && fin !== 'STOP') {
      console.error(
        `gemini-review: REFUSING — finishReason ${fin}, so this is a TRUNCATED or blocked reply and not an answer. ` +
          `${d?.usageMetadata?.thoughtsTokenCount ?? 0} thinking token(s) and ` +
          `${d?.usageMetadata?.candidatesTokenCount ?? 0} answer token(s) against maxOutputTokens ` +
          `${REQ_MAX_OUTPUT_TOKENS}. Do not score it.`
      );
      return 1;
    }
    if (!text.trim()) {
      console.error(`gemini-review: EMPTY answer (finishReason ${fin}) — nothing was read`);
      return 1;
    }
    console.log(`# model ${model} version ${version}  ·  ${sources.length} source file(s) sent  ·  jsonl ${out || '(not kept)'}`);
    console.log(text);
    if (argv.includes('--json'))
      console.log(
        JSON.stringify(
          reviewVerdict({
            status: 'PASS',
            model,
            version,
            ids: groupedIdLines(promptText).length ? 0 : (promptText.match(/^\s*[A-F][0-9_a-z]*:/gm) || []).length,
            answerBytes: text.length,
            finish: fin
          }),
          null,
          2
        )
      );
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
  /* The TRANSCRIPT path, not just the console one: CodeQL flagged `body: raw` reaching the jsonl
     unscrubbed as clear-text logging of sensitive information, and it was right — an API error can
     echo the request it rejected, and the jsonl is the artefact we keep. */
  ck('a recorded line is scrubbed', scrub(JSON.stringify({ body: 'oops SEK here' }), 'SEK'), '{"body":"oops <GEMINI_API_KEY REDACTED> here"}');
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
  ck('a grouped id line is detected', groupedIdLines(' 36/70/85: a round digit count\n A1: x\n'), ['36/70/85: a round digit count']);
  ck('a one-id-per-line prompt is clean', groupedIdLines(' A1: x\n B2: y\n'), []);
  ck('a bare number line is not a group', groupedIdLines(' 13: s["count"] > 0\n'), []);
  ck('the output budget is the model class limit', REQ_MAX_OUTPUT_TOKENS, 65536);
  console.log(bad ? `  selftest: ${bad} FAILED` : '  selftest: resolveKey + scrub + verifyExport + buildRequest + groupedIdLines OK');
  return bad ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
