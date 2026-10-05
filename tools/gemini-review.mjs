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

/* ── THE PROVIDER TABLE ────────────────────────────────────────────────────────────────────────────
   ONE reader with adapters, not a tool per provider (owner 2026-10-05; mistral, cerebras, groq,
   openrouter and nvidia are expected to follow). Everything a provider differs in lives in one row;
   everything the RULES require lives in the shared path, so a new provider cannot arrive without the
   key contract, the export boundary, the scrub, the finish-reason refusal or the jsonl record.

   Key convention: `~/.config/tepna/<provider>.env`, mode 0600, one `<VAR>=value` line. The VAR is per
   row because GitHub's is a fine-grained TOKEN rather than an api key, and pretending otherwise would
   mean a refusal naming a variable the owner never wrote.

   `stop` is the provider's own word for "it finished". Gemini says STOP, OpenAI-compatible APIs say
   stop — and the one that matters is the OTHER value: `length`/`MAX_TOKENS` means truncated, which is
   not an answer. */
const PROVIDERS = {
  gemini: {
    keyVar: 'GEMINI_API_KEY',
    /* Pinned, not an alias. `gemini-flash-latest` cannot satisfy "state the version in the brief",
       because the thing it names changes under the scorecard. Measured 2026-10-05: 3.8-flash and
       3.6-flash answer, 3.7-flash returns 503 — "newest" is not the same as "served". */
    defaultModel: 'gemini-3.8-flash',
    url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    metaUrl: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
    headers: (key) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' }),
    body: (prompt, model, maxTokens) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
    }),
    stop: 'STOP',
    read: (d) => ({
      text: d?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || '',
      finish: d?.candidates?.[0]?.finishReason,
      thinking: d?.usageMetadata?.thoughtsTokenCount ?? 0,
      answerTokens: d?.usageMetadata?.candidatesTokenCount ?? 0
    })
  },
  openrouter: {
    keyVar: 'OPENROUTER_API_KEY',
    /* ONLY `:free` ids — the account holds no credit, so a paid id would simply fail, and picking one
       by accident is how a "free tier trial" quietly becomes a bill. 16 of OpenRouter's 464 models
       carry the suffix (read from /models, not from memory). The strongest reasoning-capable one by
       scale is the 550B Nemotron at a 1M context; `cohere/north-mini-code` and `poolside/laguna-*` are
       code-specialised but an order of magnitude smaller. */
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
    metaUrl: null,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    body: (prompt, model, maxTokens) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens
    }),
    stop: 'stop',
    read: (d) => ({
      text: d?.choices?.[0]?.message?.content || '',
      finish: d?.choices?.[0]?.finish_reason,
      thinking: d?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      answerTokens: d?.usage?.completion_tokens ?? 0
    })
  },
  groq: {
    keyVar: 'GROQ_API_KEY',
    /* The largest reasoning-capable model the free tier SERVES, read from /models rather than from
       memory: 120B at a 131,072-token context. The rest of the catalogue is 27B or smaller, or audio
       (whisper), guard (prompt-guard) and TTS (orpheus) models. ⚠️ Context is not the binding limit —
       the free tier's `x-ratelimit-limit-tokens` is 8,000, which is why a 35k-token prompt must be
       batched per module here and need not be for Gemini. */
    defaultModel: 'openai/gpt-oss-120b',
    url: () => 'https://api.groq.com/openai/v1/chat/completions',
    metaUrl: null,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    body: (prompt, model, maxTokens) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      /* Both `max_tokens` and `max_completion_tokens` were accepted by this model (verified, not
         assumed); the completion form is the one reasoning models document. */
      max_completion_tokens: maxTokens
    }),
    stop: 'stop',
    read: (d) => ({
      text: d?.choices?.[0]?.message?.content || '',
      finish: d?.choices?.[0]?.finish_reason,
      thinking: d?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      answerTokens: d?.usage?.completion_tokens ?? 0
    })
  },
  'github-models': {
    keyVar: 'GITHUB_MODELS_TOKEN',
    defaultModel: 'openai/gpt-4.1',
    url: () => 'https://models.github.ai/inference/chat/completions',
    metaUrl: null, // OpenAI-compatible APIs carry no per-model metadata endpoint here
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    body: (prompt, model, maxTokens) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens
    }),
    stop: 'stop',
    read: (d) => ({
      text: d?.choices?.[0]?.message?.content || '',
      finish: d?.choices?.[0]?.finish_reason,
      thinking: d?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      answerTokens: d?.usage?.completion_tokens ?? 0
    })
  }
};

export function keyFileFor(provider) {
  return join(homedir(), '.config', 'tepna', `${provider}.env`);
}
/* This model class's own output limit. Thinking tokens count against it — see the finishReason refusal. */
/* ⚠️ THINKING TOKENS COUNT AGAINST THE OUTPUT BUDGET, so the budget must sit near the model's own
   limit rather than at a comfortable-looking number. Measured 2026-10-05: a 41-id prompt spent 15,739
   thought tokens and emitted 654 visible ones inside a 16,384 cap, truncating mid-sentence with
   finishReason MAX_TOKENS — 2,204 bytes against 13,229 for the same prompt at 65,536. A starved answer
   reads exactly like a weak model, which is why the finish reason is a REFUSAL and not a note. */
export const REQ_MAX_OUTPUT_TOKENS = 65536;

/** Everything this tool prints goes through here. A leak is one interpolated error away. */
export function scrub(text, secret) {
  const s = String(text ?? '');
  if (!secret) return s;
  return s.split(secret).join('<API KEY REDACTED>');
}

/** `{ key }` or `{ reason }` — PURE over an injected environment and stat, so --selftest can pin every
 *  refusal without a key on the box. The reason NAMES which condition failed; "no key" and "the file is
 *  world-readable" call for opposite responses from a reader. */
export function resolveKey({ keyVar = 'GEMINI_API_KEY', keyFile = '', env = {}, exists = () => false, mode = () => 0o600, read = () => '' } = {}) {
  if (env[keyVar] && String(env[keyVar]).trim()) return { key: String(env[keyVar]).trim(), from: 'environment' };
  if (!exists(keyFile)) return { reason: `no ${keyVar} in the environment and no key file at ${keyFile} — refusing rather than running unauthenticated` };
  const m = mode(keyFile) & 0o777;
  if (m & 0o077) return { reason: `the key file ${keyFile} is mode ${m.toString(8)} — group- or world-readable, so it is not a secret; refusing until it is 0600` };
  const line = String(read(keyFile))
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${keyVar}=`));
  if (!line) return { reason: `the key file ${keyFile} carries no ${keyVar}= line` };
  const v = line.slice(`${keyVar}=`.length).trim();
  if (!v) return { reason: `the key file ${keyFile} has an EMPTY ${keyVar} value` };
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

export function buildPrompt(promptText, sources) {
  /* The survivor list FIRST and the source after it, because the question is what the reader is being
     asked to do and the files are the evidence. Each file is fenced with its repo-relative path, so a
     line-number citation in the answer is checkable against the tree. */
  const body = [promptText.trim(), '', '--- SOURCE (read-only; cite line numbers from these files) ---'];
  for (const [path, text] of sources) body.push('', `### ${path}`, '```python', text.replace(/\s+$/, ''), '```');
  return body.join('\n');
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
          model: PROVIDERS.gemini.defaultModel,
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

  const providerName = val('--provider') || 'gemini';
  const P = PROVIDERS[providerName];
  if (!P) {
    console.error(`gemini-review: REFUSING — unknown --provider ${providerName}; known: ${Object.keys(PROVIDERS).join(', ')}`);
    return 1;
  }
  const keyFile = keyFileFor(providerName);
  const k = resolveKey({
    keyVar: P.keyVar,
    keyFile,
    env: process.env,
    exists: existsSync,
    mode: (f) => statSync(f).mode,
    read: (f) => readFileSync(f, 'utf8')
  });
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
    const model = val('--model') || P.defaultModel;
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

    const prompt = buildPrompt(promptText, sources);
    const at = new Date().toISOString();
    /* Per-model metadata where the provider has it; an OpenAI-compatible endpoint does not, and the
       MODEL ID is the thing that must appear in every record either way. */
    let version = 'n/a';
    if (P.metaUrl) {
      try {
        version = (await (await fetch(P.metaUrl(model), { headers: P.headers(key) })).json())?.version || 'unknown';
      } catch {
        version = 'unknown';
      }
    }
    record(out, { at, provider: providerName, model, version, kind: 'request', sources: sources.map(([pp, tt]) => ({ path: pp, bytes: tt.length })), prompt }, key);

    const r = await fetch(P.url(model), {
      method: 'POST',
      headers: P.headers(key),
      body: JSON.stringify(P.body(prompt, model, REQ_MAX_OUTPUT_TOKENS))
    });
    const raw = await r.text();
    /* RATE-LIMIT HEADERS ARE RECORDED, not inferred from a 429. A free tier's real ceiling is the one
       it tells you about before you hit it, and a transcript without them cannot answer "what did the
       cap turn out to be" after the fact. */
    const limits = {};
    for (const [h, v] of r.headers) if (/ratelimit|retry-after|x-request-id/i.test(h)) limits[h] = v;
    record(out, { at: new Date().toISOString(), provider: providerName, model, version, kind: 'response', http: r.status, limits, body: raw }, key);
    if (!r.ok) {
      console.error(scrub(`gemini-review: HTTP ${r.status} — ${raw.slice(0, 400)}`, key));
      return 1;
    }
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      /* A 200 that is not JSON is not an answer. Measured 2026-10-05: every request to
         models.github.ai from this sandbox returned a 4-byte `OK` as text/plain with no server
         header — an interceptor, not the API — so "200" alone would have read as success. */
      console.error(
        `gemini-review: REFUSING — HTTP ${r.status} but the body is not JSON (${raw.length} byte(s), content-type ` +
          `${r.headers.get('content-type')}): ${JSON.stringify(raw.slice(0, 60))}. A 200 is not an answer.`
      );
      return 1;
    }
    const { text, finish, thinking, answerTokens } = P.read(d);
    if (finish && finish !== P.stop) {
      console.error(
        `gemini-review: REFUSING — finish reason ${finish} (provider's completed value is ${P.stop}), so this is a ` +
          `TRUNCATED or blocked reply and not an answer. ${thinking} thinking token(s) and ${answerTokens} answer ` +
          `token(s) against a budget of ${REQ_MAX_OUTPUT_TOKENS}. Do not score it.`
      );
      return 1;
    }
    if (!text.trim()) {
      console.error(`gemini-review: EMPTY answer (finish ${finish}) — nothing was read`);
      return 1;
    }
    console.log(`# provider ${providerName}  ·  model ${model} version ${version}  ·  ${sources.length} source file(s) sent  ·  jsonl ${out || '(not kept)'}`);
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
  ck('scrub replaces every occurrence', scrub('a SEK b SEK', 'SEK'), 'a <API KEY REDACTED> b <API KEY REDACTED>');
  ck('scrub survives no secret', scrub('plain', ''), 'plain');
  ck('scrub survives a null message', scrub(null, 'SEK'), '');
  /* The TRANSCRIPT path, not just the console one: CodeQL flagged `body: raw` reaching the jsonl
     unscrubbed as clear-text logging of sensitive information, and it was right — an API error can
     echo the request it rejected, and the jsonl is the artefact we keep. */
  ck('a recorded line is scrubbed', scrub(JSON.stringify({ body: 'oops SEK here' }), 'SEK'), '{"body":"oops <API KEY REDACTED> here"}');
  /* THE EXPORT BOUNDARY: a plain checkout must be refused, and the reason must say which tree betrayed it. */
  const chk = verifyExport('/x', { exists: (p) => p === '/x' || p.endsWith('CLAUDE.md') || p.endsWith('uploads') });
  ck('a dir carrying uploads/ is refused', /carries uploads\/ — that is a checkout/.test(chk.reason), true);
  ck('a dir with no CLAUDE.md is refused', /carries no CLAUDE.md/.test(verifyExport('/x', { exists: (p) => p === '/x' }).reason), true);
  ck('a missing --src is refused', /does not exist/.test(verifyExport('/x', { exists: () => false }).reason), true);
  ck('an absent --src is refused by name', /--src is required/.test(verifyExport('').reason), true);
  ck('a real export passes', verifyExport('/x', { exists: (p) => p === '/x' || p.endsWith('CLAUDE.md') }), { ok: true });
  /* The request carries the question BEFORE the evidence, and fences each file with its path. */
  const prompt = buildPrompt('Q?', [['capture-host/a.py', 'code\n']]);
  ck('the prompt leads', prompt.startsWith('Q?'), true);
  ck('the source is fenced with its path', /### capture-host\/a\.py\n```python\ncode\n```/.test(prompt), true);
  /* EVERY provider row, so a new adapter cannot arrive without temperature 0, a stop word, a key var
     and a default model — the four things the rules depend on and the one place they could be forgotten. */
  for (const [name, P] of Object.entries(PROVIDERS)) {
    const b = P.body('Q?', P.defaultModel, 123);
    ck(`${name}: temperature pinned to 0`, JSON.stringify(b).includes('"temperature":0'), true);
    ck(`${name}: the budget reaches the body`, JSON.stringify(b).includes('123'), true);
    ck(`${name}: names its stop word`, typeof P.stop === 'string' && P.stop.length > 0, true);
    ck(`${name}: names its key variable`, /^[A-Z][A-Z0-9_]+$/.test(P.keyVar), true);
    ck(`${name}: key file is ~/.config/tepna/<provider>.env`, keyFileFor(name).endsWith(`/.config/tepna/${name}.env`), true);
    ck(`${name}: reads an empty response without throwing`, typeof P.read({}).text, 'string');
  }
  ck('an unknown provider is not silently defaulted', PROVIDERS['nope'] === undefined, true);
  ck('a grouped id line is detected', groupedIdLines(' 36/70/85: a round digit count\n A1: x\n'), ['36/70/85: a round digit count']);
  ck('a one-id-per-line prompt is clean', groupedIdLines(' A1: x\n B2: y\n'), []);
  ck('a bare number line is not a group', groupedIdLines(' 13: s["count"] > 0\n'), []);
  ck('the output budget is the model class limit', REQ_MAX_OUTPUT_TOKENS, 65536);
  console.log(bad ? `  selftest: ${bad} FAILED` : '  selftest: resolveKey + scrub + verifyExport + buildRequest + groupedIdLines OK');
  return bad ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
