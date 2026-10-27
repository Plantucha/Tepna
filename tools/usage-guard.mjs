#!/usr/bin/env node
/*
 * tools/usage-guard.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * USAGE GUARD — what the fleet has SPENT, measured, and what nobody can measure, said so.
 *
 *     node tools/usage-guard.mjs                       # the fleet view: every local session + API reader run
 *     node tools/usage-guard.mjs --since 7d            # window (default 24h): 90m · 24h · 7d · an ISO instant
 *     node tools/usage-guard.mjs --session <id|name>   # one session (a herder name resolves to its id)
 *     node tools/usage-guard.mjs --budget fleet=40000000 --budget kestrel=8000000
 *                                                      # CONFIGURED budgets; the 25 % / 10 % warnings bind on these only
 *     node tools/usage-guard.mjs --api-log <file.jsonl>…   # the API reader's records (gemini-review --out)
 *     node tools/usage-guard.mjs --remote <host>…      # a second host's transcripts, folded ON that host over ssh
 *     node tools/usage-guard.mjs --ma-log <dir>…       # Managed Agents run logs (*.jsonl, read recursively)
 *     node tools/usage-guard.mjs --status-line         # one line for Claude Code's statusLine (reads its stdin JSON)
 *     node tools/usage-guard.mjs --json                # the tepna.verdict/1 object alone
 *     node tools/usage-guard.mjs --selftest
 *
 * WHY IT EXISTS. The owner's 2026-08-31 directive schedules fleet work against the weekly allowance,
 * and the only instrument was the owner reading a percentage off a web page and typing it into chat
 * ("97 % usage, let everyone idle", 2026-09-29). Nothing in the repo could say what a session had spent,
 * how full a context was, or whether an API reader run cost more than the last one — so every budget
 * decision was made on a number somebody remembered.
 *
 * WHAT IS MEASURED, AND FROM WHERE (every number carries its source and timestamp):
 *   · Claude Code sessions — the per-message `usage` block in the local transcript
 *     (`~/.claude/projects/<cwd-slug>/<session>.jsonl`, streamed line by line, never loaded whole):
 *     input, cache-creation, cache-read, output and thinking tokens, first/last timestamp, model(s);
 *     the headline is FRESH tokens (input + cache-creation + output) with cache reads shown beside it,
 *     because summing them published a figure 100× the work done on the first live run;
 *     and the LAST message's prompt size as the context-utilisation proxy. The herder maps a session id
 *     to a bird's name when it is running (`herdr agent list`); otherwise the id is the name.
 *   · API reader runs — `tools/gemini-review.mjs --out <jsonl>` records; the provider's own usage
 *     object inside each `response` body (Gemini `usageMetadata`, OpenAI-shaped `usage`, Anthropic
 *     `usage`) is read per request. A record without one is COUNTED as "no usage field", never as 0.
 *   · Sessions on a second host (`--remote <host>`) — the same per-message fold, run ON that host by a
 *     read-only Python script over `ssh -o BatchMode=yes`, so only one JSON summary crosses the link and
 *     no transcript leaves the box. Names come from that host's own herder. An unreachable host is a
 *     `remotes[]` entry with a reason, never a zero row.
 *   · Managed Agents runs (`--ma-log <dir>`) — each run log records every API call; the LAST
 *     `GET /v1/sessions/<id>` body carries the session's cumulative `usage`, including `list_cost`.
 *     One row per model, summed over sessions whose last record falls in the window. `list_cost.amount`
 *     is read as US cents: on 2026-10-11 nine batches summed 596 and the console showed $5.96.
 *   · Claude Code's statusLine stdin JSON (`--status-line`): `context_window` and `cost` when the
 *     running version sends them; the transcript is the fallback, labelled as such.
 *
 * WHAT IS NOT MEASURED, AND IS SAID SO. The PLAN allowance (the percentage the owner reads on the web
 * page), its reset time, and a provider's remaining spend are not exposed to a program on this machine.
 * They are reported as UNKNOWN with the supported manual check named (`/usage` in a Claude Code
 * session, `/status` in a Codex session, the provider's console) — never estimated from tokens, because
 * a token count is a fact about a SESSION and a percentage is a fact about an ACCOUNT, and the two are
 * never the same number. The 25 % and 10 % warnings therefore bind on a CONFIGURED budget (`--budget`)
 * and say "of the configured budget" every time they fire. ∅: an absent measurement is null + a reason.
 *
 * THE VERDICT (tepna.verdict/1, gate `usage-guard`) judges the configured budgets: PASS while every one
 * keeps > 10 % remaining (warnings at ≤ 25 % ride in `result`), FAIL at ≤ 10 % (stop optional work,
 * hand off), NOT_APPLICABLE when no budget is configured (sessions were examined; the rule does not
 * bind), NOT_RUN when no transcript directory could be read. `--verdict-sample` enumerates nothing.
 */
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isCliEntry } from './argv-guard.mjs';
import { producedByOf } from './corpus-scope-core.mjs';

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

/* ── pre-stated thresholds: shares of a CONFIGURED budget, never of an unknown allowance ────────── */
export const WARN_REMAINING = 0.25;
export const STOP_REMAINING = 0.1;
export const GATE = 'usage-guard';

/* ── the manual checks for what no program here can read ────────────────────────────────────────── */
export const MANUAL_CHECKS = Object.freeze({
  'claude-code': 'type /usage (plan allowance + reset) or /cost (this session) in the Claude Code session',
  codex: 'type /status in the Codex session; quota and reset are shown there',
  'api-provider': "the provider's console shows spend and limits; nothing here reads it"
});

/* ── pure: parse the window flag ────────────────────────────────────────────────────────────────── */
export function parseSince(spec, nowMs = Date.now()) {
  const s = String(spec ?? '24h').trim();
  const m = /^(\d+)([mhd])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const unit = { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
    return nowMs - n * unit;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  throw new Error(`--since: "${spec}" is neither <n>m|h|d nor an ISO instant`);
}

/* ── pure: fold one transcript line into a session total ────────────────────────────────────────── */
export function emptySession(id) {
  return {
    id,
    name: null,
    input: 0,
    cacheCreate: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    messages: 0,
    messagesWithoutUsage: 0,
    first: null,
    last: null,
    models: {},
    lastContext: null, // the LAST assistant message's prompt size: input + cache-create + cache-read
    lastContextAt: null
  };
}
export function foldLine(sess, line, sinceMs) {
  if (!line || line.indexOf('"type":"assistant"') < 0) return sess;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return sess;
  }
  if (o?.type !== 'assistant') return sess;
  const ts = Date.parse(o.timestamp ?? '');
  if (!Number.isFinite(ts) || ts < sinceMs) return sess;
  const u = o.message?.usage;
  sess.messages++;
  if (!u || typeof u !== 'object') {
    sess.messagesWithoutUsage++;
    return sess;
  }
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const inp = n(u.input_tokens);
  const cc = n(u.cache_creation_input_tokens);
  const cr = n(u.cache_read_input_tokens);
  sess.input += inp;
  sess.cacheCreate += cc;
  sess.cacheRead += cr;
  sess.output += n(u.output_tokens);
  sess.thinking += n(u.output_tokens_details?.thinking_tokens);
  const model = o.message?.model ?? 'unknown';
  sess.models[model] = (sess.models[model] ?? 0) + 1;
  if (sess.first === null || ts < sess.first) sess.first = ts;
  if (sess.last === null || ts >= sess.last) {
    sess.last = ts;
    sess.lastContext = inp + cc + cr;
    sess.lastContextAt = ts;
  }
  return sess;
}
/* FRESH tokens: what the model actually processed anew — input + cache-creation + output. Cache READS
   are reported beside it, never summed into it: measured on the first live run (2026-10-11, 24 h), cache
   reads were 2,660M of a 2,684M "total", so a sum would have published a fleet figure 100× the work done
   and a budget that reads it would have tripped on cached prefixes. The split is the finding; `cacheRead`
   stays a first-class field. */
export function totalTokens(s) {
  return s.input + s.cacheCreate + s.output;
}

/* ── pure: a provider's usage object → {prompt, answer, thinking} or null when the body has none ─ */
export function usageFromBody(body) {
  let d = body;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object') return null;
  const um = d.usageMetadata;
  if (um && typeof um === 'object') {
    return {
      prompt: um.promptTokenCount ?? null,
      answer: um.candidatesTokenCount ?? null,
      thinking: um.thoughtsTokenCount ?? null
    };
  }
  const u = d.usage;
  if (u && typeof u === 'object') {
    if ('input_tokens' in u || 'output_tokens' in u) {
      return { prompt: u.input_tokens ?? null, answer: u.output_tokens ?? null, thinking: u.thinking_tokens ?? null };
    }
    return {
      prompt: u.prompt_tokens ?? null,
      answer: u.completion_tokens ?? null,
      thinking: u.completion_tokens_details?.reasoning_tokens ?? null
    };
  }
  return null;
}
export function foldApiRecord(acc, rec, sinceMs) {
  if (!rec || rec.kind !== 'response') return acc;
  const ts = Date.parse(rec.at ?? '');
  if (!Number.isFinite(ts) || ts < sinceMs) return acc;
  const key = `${rec.provider ?? 'unknown'} · ${rec.model ?? 'unknown'}`;
  const row = acc[key] ?? { provider: rec.provider ?? 'unknown', model: rec.model ?? 'unknown', requests: 0, withoutUsage: 0, prompt: 0, answer: 0, thinking: 0, nonOk: 0, first: null, last: null };
  row.requests++;
  if (rec.http != null && (rec.http < 200 || rec.http >= 300)) row.nonOk++;
  const u = usageFromBody(rec.body);
  if (!u) row.withoutUsage++;
  else {
    row.prompt += Number.isFinite(u.prompt) ? u.prompt : 0;
    row.answer += Number.isFinite(u.answer) ? u.answer : 0;
    row.thinking += Number.isFinite(u.thinking) ? u.thinking : 0;
  }
  if (row.first === null || ts < row.first) row.first = ts;
  if (row.last === null || ts > row.last) row.last = ts;
  acc[key] = row;
  return acc;
}

/* ── pure: a configured budget against a measured spend ─────────────────────────────────────────── */
export function budgetState(used, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return { remaining: null, level: 'unconfigured' };
  const remaining = Math.max(0, 1 - used / budget);
  const level = remaining <= STOP_REMAINING ? 'stop' : remaining <= WARN_REMAINING ? 'warn' : 'ok';
  return { remaining, level };
}
export function parseBudgets(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--budget') continue;
    const spec = argv[i + 1] ?? '';
    const m = /^([A-Za-z0-9._-]+)=(\d+)$/.exec(spec);
    if (!m) throw new Error(`--budget: "${spec}" is not <name>=<tokens>`);
    out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}
export function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
export function flagValues(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}

/* ── where Claude Code keeps this checkout's transcripts: the cwd with every non-word char → '-' ── */
export function projectSlug(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}
export function transcriptDir(cwd = primaryCheckout(), home = homedir()) {
  return join(home, '.claude', 'projects', projectSlug(cwd));
}
/* Sessions are started in the PRIMARY checkout, so a worktree's own slug holds nothing (measured: the
   first live run from a worktree looked under the worktree's slug, found no directory and reported
   NOT_RUN). The git common dir's parent is the primary checkout for a worktree and the checkout itself
   for the root; `--project <path>` overrides it for a session started elsewhere. */
export function primaryCheckout(root = ROOT, exec = execFileSync) {
  try {
    const common = exec('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(resolve(root, common));
  } catch {
    return root;
  }
}

/* ── IO: stream one transcript (never loaded whole — a long session is hundreds of MB) ───────────── */
export async function readTranscript(file, sinceMs, tailBytes = 0) {
  const id = basename(file, '.jsonl');
  const sess = emptySession(id);
  let start = 0;
  if (tailBytes > 0) {
    const size = statSync(file).size;
    start = Math.max(0, size - tailBytes);
    sess.tailOnly = start > 0;
  }
  const rl = createInterface({ input: createReadStream(file, { start }), crlfDelay: Infinity });
  let firstLine = start > 0;
  for await (const line of rl) {
    if (firstLine) {
      firstLine = false; // a tail start lands mid-line; the fragment is not a record
      continue;
    }
    foldLine(sess, line, sinceMs);
  }
  sess.file = file;
  sess.fileBytes = statSync(file).size;
  return sess;
}

/* ── IO: a second host's transcripts, folded ON that host (only the summary crosses the link) ─────
   The fold mirrors foldLine field for field; the selftest runs this script against a planted
   transcript and compares it with foldLine's sums, so the two cannot drift silently. */
export const REMOTE_FOLD_PY = String.raw`import json, os, sys, glob, subprocess
from datetime import datetime
since = int(sys.argv[1]) / 1000.0
root = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/projects')
def ts(s):
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()
    except Exception:
        return None
def n(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0
out = []
for f in sorted(glob.glob(os.path.join(root, '*', '*.jsonl'))):
    try:
        if os.path.getmtime(f) < since:
            continue
        size = os.path.getsize(f)
    except OSError:
        continue
    s = dict(id=os.path.basename(f)[:-6], input=0, cacheCreate=0, cacheRead=0, output=0, thinking=0,
             messages=0, messagesWithoutUsage=0, first=None, last=None, models={}, lastContext=None,
             lastContextAt=None, file=f, fileBytes=size)
    with open(f, 'rb') as fh:
        for line in fh:
            if b'"type":"assistant"' not in line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if not isinstance(o, dict) or o.get('type') != 'assistant':
                continue
            t = ts(o.get('timestamp') or '')
            if t is None or t < since:
                continue
            m = o.get('message') if isinstance(o.get('message'), dict) else {}
            u = m.get('usage')
            s['messages'] += 1
            if not isinstance(u, dict):
                s['messagesWithoutUsage'] += 1
                continue
            inp, cc, cr = n(u.get('input_tokens')), n(u.get('cache_creation_input_tokens')), n(u.get('cache_read_input_tokens'))
            s['input'] += inp; s['cacheCreate'] += cc; s['cacheRead'] += cr
            s['output'] += n(u.get('output_tokens'))
            d = u.get('output_tokens_details')
            s['thinking'] += n(d.get('thinking_tokens')) if isinstance(d, dict) else 0
            model = m.get('model') or 'unknown'
            s['models'][model] = s['models'].get(model, 0) + 1
            tm = round(t * 1000)
            if s['first'] is None or tm < s['first']:
                s['first'] = tm
            if s['last'] is None or tm >= s['last']:
                s['last'] = tm; s['lastContext'] = inp + cc + cr; s['lastContextAt'] = tm
    if s['messages'] > 0:
        out.append(s)
names = None
try:
    r = subprocess.run([os.path.expanduser('~/.local/bin/herdr'), '--session', 'birds', 'agent', 'list'],
                       capture_output=True, text=True, timeout=5)
    names = {}
    for a in json.loads(r.stdout)['result']['agents']:
        sid = (a.get('agent_session') or {}).get('value')
        if sid and a.get('name'):
            names[sid] = a['name']
except Exception:
    names = None
print(json.dumps({'sessions': out, 'names': names}))
`;
export function parseRemoteFold(raw, host) {
  const j = JSON.parse(raw);
  const names = j && typeof j.names === 'object' && j.names !== null ? j.names : null;
  const sessions = (Array.isArray(j?.sessions) ? j.sessions : []).map((s) => ({
    ...emptySession(s.id),
    ...s,
    name: names?.[s.id] ?? null,
    host,
    file: `${host}:${s.file}`
  }));
  return { host, ok: true, sessions, herder: names ? "names from that host's herdr agent list" : "that host's herder not readable" };
}
export function sshConfigArgs(home = homedir()) {
  /* -F ~/.ssh/config. Without it ssh also reads /etc/ssh/ssh_config.d/*. A systemd user service with
     ProtectHome= runs in a user namespace where root maps to nobody; ssh then refuses the root-owned
     system config ("Bad owner or permissions") and exits 255. Measured 2026-10-17 on the board timer:
     the table read "vigil not read (255)" for 18 h while the same command from a shell read the host.
     The board's other vigil readers already pass -F; this is the one that did not. */
  const cfg = join(home, '.ssh', 'config');
  return existsSync(cfg) ? ['-F', cfg] : [];
}
export function remoteSessions(host, sinceMs, exec = execFileSync, home = homedir()) {
  try {
    const raw = exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', ...sshConfigArgs(home), host, 'python3', '-', String(Math.floor(sinceMs))], {
      input: REMOTE_FOLD_PY,
      encoding: 'utf8',
      timeout: 90000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return parseRemoteFold(raw, host);
  } catch (e) {
    return { host, ok: false, sessions: [], reason: `${host} not read (${e.code ?? e.status ?? 'error'})` };
  }
}

/* ── pure: a Managed Agents run-log record → the session's latest cumulative usage ──────────────── */
export const MA_SESSION_PATH = /^\/v1\/sessions\/([^/?]+)$/;
export function foldMaRecord(acc, rec) {
  if (!rec || rec.method !== 'GET' || typeof rec.path !== 'string') return acc;
  const m = MA_SESSION_PATH.exec(rec.path);
  const u = rec.body?.usage;
  if (!m || !u || typeof u !== 'object') return acc;
  const ts = Date.parse(rec.at ?? '');
  if (!Number.isFinite(ts)) return acc;
  const prev = acc[m[1]];
  if (!prev || ts >= prev.at) acc[m[1]] = { at: ts, usage: u, model: rec.body?.agent?.model?.id ?? rec.body?.agent?.model ?? 'unknown' };
  return acc;
}
/* One row per model over the sessions whose last record falls in the window. A session without a
   list_cost counts in costWithout, never as $0. */
export function maRows(acc, sinceMs) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const rows = {};
  for (const s of Object.values(acc)) {
    if (s.at < sinceMs) continue;
    const model = typeof s.model === 'string' ? s.model : 'unknown';
    if (!rows[model]) rows[model] = { model, sessions: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, tokens: 0, listCostUsd: null, costWithout: 0, activeSeconds: 0, first: null, last: null };
    const r = rows[model];
    const u = s.usage;
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? Object.values(u.cache_creation).reduce((a, v) => a + n(v), 0) : n(u.cache_creation_input_tokens);
    r.sessions++;
    r.input += n(u.input_tokens);
    r.cacheCreate += cc;
    r.cacheRead += n(u.cache_read_input_tokens);
    r.output += n(u.output_tokens);
    r.tokens = r.input + r.cacheCreate + r.output;
    r.activeSeconds += n(u.active_seconds);
    const amt = Number(u.list_cost?.amount);
    if (u.list_cost?.currency === 'USD' && Number.isFinite(amt)) r.listCostUsd = Number(((r.listCostUsd ?? 0) + amt / 100).toFixed(2));
    else r.costWithout++;
    if (r.first === null || s.at < r.first) r.first = s.at;
    if (r.last === null || s.at > r.last) r.last = s.at;
  }
  return Object.values(rows).map((r) => ({ ...r, first: r.first === null ? null : new Date(r.first).toISOString(), last: r.last === null ? null : new Date(r.last).toISOString() }));
}
function jsonlFiles(dir) {
  const out = [];
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
export async function collectMa(dirs, sinceMs) {
  const acc = {};
  const read = [];
  let malformed = 0;
  for (const d of dirs) {
    if (!existsSync(d)) {
      read.push({ dir: d, ok: false, reason: 'missing' });
      continue;
    }
    let files = 0;
    for (const f of jsonlFiles(d)) {
      if (statSync(f).mtimeMs < sinceMs) continue;
      files++;
      const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.indexOf('/v1/sessions/') < 0) continue;
        try {
          foldMaRecord(acc, JSON.parse(line));
        } catch {
          malformed++;
        }
      }
    }
    read.push({ dir: d, ok: true, files });
  }
  return { rows: maRows(acc, sinceMs), read, malformed };
}

/* ── IO: the herder's name ↔ session map, when it is running; absent otherwise (never guessed) ──── */
export function herderNames(exec = execFileSync) {
  try {
    const raw = exec(join(homedir(), '.local', 'bin', 'herdr'), ['--session', 'birds', 'agent', 'list'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(raw);
    const out = {};
    for (const a of j?.result?.agents ?? []) {
      const id = a?.agent_session?.value;
      if (id && a.name) out[id] = { name: a.name, status: a.agent_status ?? null };
    }
    return { ok: true, map: out };
  } catch (e) {
    return { ok: false, map: {}, reason: `herder not readable (${e.code ?? e.message})` };
  }
}

export async function collect({ cwd = ROOT, sinceMs, onlySession = null, apiLogs = [], remotes = [], maLogs = [], tailBytes = 0, exec = execFileSync } = {}) {
  const dir = transcriptDir(cwd);
  const names = herderNames(exec);
  const sessions = [];
  let dirReadable = existsSync(dir);
  if (dirReadable) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      dirReadable = false;
    }
    for (const f of files) {
      const id = basename(f, '.jsonl');
      const nm = names.map[id]?.name ?? null;
      if (onlySession && onlySession !== id && onlySession.toLowerCase() !== (nm ?? '').toLowerCase()) continue;
      const full = join(dir, f);
      if (statSync(full).mtimeMs < sinceMs) continue; // untouched since the window opened: nothing inside it
      const s = await readTranscript(full, sinceMs, tailBytes);
      s.name = nm;
      s.herderStatus = names.map[id]?.status ?? null;
      if (s.messages > 0) sessions.push(s);
    }
  }
  const api = {};
  const apiFiles = [];
  for (const p of apiLogs) {
    if (!existsSync(p)) {
      apiFiles.push({ file: p, ok: false, reason: 'missing' });
      continue;
    }
    let n = 0;
    const rl = createInterface({ input: createReadStream(p), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        foldApiRecord(api, JSON.parse(line), sinceMs);
        n++;
      } catch {
        /* a malformed line is counted below, not skipped silently */
        api.__malformed = (api.__malformed ?? 0) + 1;
      }
    }
    apiFiles.push({ file: p, ok: true, lines: n });
  }
  const malformed = api.__malformed ?? 0;
  delete api.__malformed;
  const remoteRead = [];
  for (const host of remotes) {
    const r = remoteSessions(host, sinceMs, exec);
    for (const s of r.sessions) if (!onlySession || onlySession === s.id || onlySession.toLowerCase() === (s.name ?? '').toLowerCase()) sessions.push(s);
    remoteRead.push({ host, ok: r.ok, sessions: r.sessions.length, ...(r.ok ? { herder: r.herder } : { reason: r.reason }) });
  }
  const ma = maLogs.length ? await collectMa(maLogs, sinceMs) : { rows: [], read: [], malformed: 0 };
  return { dir, dirReadable, herder: names, sessions, api: Object.values(api), apiFiles, apiMalformed: malformed, remotes: remoteRead, managedAgents: ma };
}

/* ── the verdict over the CONFIGURED budgets ────────────────────────────────────────────────────── */
export function evaluate(collected, budgets, { sinceMs, nowMs = Date.now() } = {}) {
  const byName = {};
  let fleet = 0;
  for (const s of collected.sessions) {
    const t = totalTokens(s);
    fleet += t;
    byName[(s.name ?? s.id).toLowerCase()] = t;
  }
  const budgetRows = [];
  for (const [name, budget] of Object.entries(budgets)) {
    /* ∅: a directory that could not be read yields NO spend figure — not a 0 that reads as "100 % remains". */
    const used = !collected.dirReadable ? null : name === 'fleet' ? fleet : (byName[name] ?? null);
    if (used === null) {
      budgetRows.push({ name, budget, used: null, remaining: null, level: collected.dirReadable ? 'no-session-in-window' : 'not-run' });
      continue;
    }
    const st = budgetState(used, budget);
    budgetRows.push({ name, budget, used, remaining: st.remaining === null ? null : Number(st.remaining.toFixed(4)), level: st.level });
  }
  const stops = budgetRows.filter((r) => r.level === 'stop');
  const warns = budgetRows.filter((r) => r.level === 'warn');
  let status;
  let reason = null;
  if (!collected.dirReadable) {
    status = 'NOT_RUN';
    reason = `no transcript directory at ${collected.dir} — nothing was examined`;
  } else if (!budgetRows.length) {
    status = 'NOT_APPLICABLE';
    reason = `${collected.sessions.length} session(s) examined; no --budget configured, so the 25 %/10 % rule does not bind. Plan allowance: UNKNOWN (${MANUAL_CHECKS['claude-code']})`;
  } else if (stops.length) {
    status = 'FAIL';
    reason = `${stops.map((r) => `${r.name}: ${(r.remaining * 100).toFixed(1)} % of the CONFIGURED budget remains`).join('; ')} — stop optional work, save progress, hand off`;
  } else {
    status = 'PASS';
  }
  /* THE MEASUREMENT IS NOT THE DECISION. The verdict object judges the configured budgets and obeys
     the contract (NOT_APPLICABLE / NOT_RUN carry `result: null` — nothing was decided). The measured
     spend travels beside it as its own object, so a caller with no budget still gets every number. */
  const usage = {
    schema: 'tepna.usage/1',
    window: { since: new Date(sinceMs).toISOString(), until: new Date(nowMs).toISOString() },
    fleetTokens: fleet,
    fleetCacheRead: collected.sessions.reduce((a, s) => a + s.cacheRead, 0),
    sessions: collected.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      tokens: totalTokens(s),
      input: s.input,
      cacheCreate: s.cacheCreate,
      cacheRead: s.cacheRead,
      output: s.output,
      thinking: s.thinking,
      messages: s.messages,
      /* THE MODEL SPLIT, emitted at last. `models` has been counted per session since this tool was
         written (one entry per message, keyed by `message.model`) and simply never left the function —
         so a consumer wanting it had to re-parse the transcripts and would have become a second source
         of truth for the same number. Raw message counts, not percentages: a reader can divide, and a
         percentage would flatter a session with three messages. */
      models: s.models,
      messagesWithoutUsage: s.messagesWithoutUsage,
      lastContextTokens: s.lastContext,
      lastContextAt: s.lastContextAt ? new Date(s.lastContextAt).toISOString() : null,
      tailOnly: !!s.tailOnly,
      host: s.host ?? null,
      source: `transcript ${s.file}`
    })),
    remotes: collected.remotes ?? [],
    managedAgents: collected.managedAgents ?? { rows: [], read: [], malformed: 0 },
    api: collected.api,
    apiMalformedLines: collected.apiMalformed,
    budgets: budgetRows,
    warnings: warns.map((r) => `${r.name}: ${(r.remaining * 100).toFixed(1)} % of the CONFIGURED budget remains (≤ ${WARN_REMAINING * 100} %)`),
    allowance: { status: 'UNKNOWN', reason: 'the plan allowance, its reset time and provider spend are not exposed to a program on this machine', manual: MANUAL_CHECKS },
    herder: collected.herder.ok ? 'names from herdr agent list' : collected.herder.reason
  };
  const decided = status === 'PASS' || status === 'FAIL';
  const verdict = Verdict.make({
    gate: GATE,
    status,
    scope: 'internal',
    population: { checked: collected.sessions.length, eligible: collected.sessions.length, excluded: 0 },
    criterion: { name: 'remaining_share_of_configured_budget', threshold: STOP_REMAINING, unit: 'share', direction: 'gte' },
    result: decided ? { budgets: budgetRows, warnings: usage.warnings, fleetTokens: fleet } : null,
    evidence: ['tools/usage-guard.mjs', collected.dir, ...collected.apiFiles.filter((f) => f.ok).map((f) => f.file)],
    reason,
    producedBy: producedByOf('tools/usage-guard.mjs', null)
  });
  return { verdict, usage };
}

/* ── rendering ──────────────────────────────────────────────────────────────────────────────────── */
export function fmtK(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
export function renderTable(v, r) {
  const L = [`▸ usage-guard · ${v.status} · window ${r.window.since} → ${r.window.until}`, ''];
  L.push('  SESSIONS (measured from each transcript; tokens = FRESH: input + cache-create + output; cache reads shown beside, not summed)');
  if (!r.sessions.length) L.push('    (none active in the window)');
  for (const s of [...r.sessions].sort((a, b) => b.tokens - a.tokens)) {
    const nm = s.name ? `${s.name}` : s.id.slice(0, 8);
    L.push(
      `    ${nm.padEnd(10)} ${fmtK(s.tokens).padStart(8)}  in ${fmtK(s.input)} · cache+ ${fmtK(s.cacheCreate)} · cache← ${fmtK(s.cacheRead)} · out ${fmtK(s.output)} (thinking ${fmtK(s.thinking)}) · ${s.messages} msgs${s.messagesWithoutUsage ? ` (${s.messagesWithoutUsage} without usage)` : ''}`
    );
    L.push(`               last context ≈ ${fmtK(s.lastContextTokens)} tokens at ${s.lastContextAt ?? '—'}${s.tailOnly ? ' · TAIL ONLY' : ''}`);
  }
  L.push(`    fleet      ${fmtK(r.fleetTokens).padStart(8)}  fresh · cache← ${fmtK(r.fleetCacheRead)} served from cache  (${r.sessions.length} session(s))`);
  L.push('', "  API READER RUNS (the provider's own usage object per response)");
  if (!r.api.length) L.push('    (no --api-log given, or none in the window)');
  for (const a of r.api)
    L.push(
      `    ${a.provider} · ${a.model}: ${a.requests} request(s), prompt ${fmtK(a.prompt)} · answer ${fmtK(a.answer)} · thinking ${fmtK(a.thinking)}${a.withoutUsage ? ` · ${a.withoutUsage} without a usage field` : ''}${a.nonOk ? ` · ${a.nonOk} non-2xx` : ''}`
    );
  if (r.apiMalformedLines) L.push(`    ⚠ ${r.apiMalformedLines} malformed line(s) in the API logs (counted, not read)`);
  L.push('', '  CONFIGURED BUDGETS (the 25 % / 10 % rule binds here and nowhere else)');
  if (!r.budgets.length) L.push('    (none — pass --budget <name>=<tokens>; the plan allowance is NOT a budget this tool can read)');
  for (const b of r.budgets)
    L.push(`    ${b.name}: ${b.used === null ? 'no session in the window' : `${fmtK(b.used)} of ${fmtK(b.budget)} used · ${(b.remaining * 100).toFixed(1)} % remains · ${b.level.toUpperCase()}`}`);
  for (const w of r.warnings) L.push(`    ⚠ ${w}`);
  L.push('', `  PLAN ALLOWANCE: ${r.allowance.status} — ${r.allowance.reason}.`);
  for (const [k, how] of Object.entries(r.allowance.manual)) L.push(`    ${k}: ${how}`);
  if (v.reason) L.push('', `  reason: ${v.reason}`);
  L.push('', `  herder: ${r.herder}`);
  return L.join('\n');
}

/* ── the statusLine form: one line, reading Claude Code's stdin JSON when it is given ───────────── */
export function statusLineFrom(input, sess, names) {
  const nm = input?.session_id && names?.[input.session_id]?.name ? names[input.session_id].name : (sess?.name ?? (input?.session_id ?? sess?.id ?? '?').slice(0, 8));
  const parts = [nm];
  const cw = input?.context_window;
  if (cw?.current_usage) {
    const cu = cw.current_usage;
    const ctx = (cu.input_tokens ?? 0) + (cu.cache_creation_input_tokens ?? 0) + (cu.cache_read_input_tokens ?? 0);
    parts.push(cw.context_window_size ? `ctx ${fmtK(ctx)}/${fmtK(cw.context_window_size)} (${((ctx / cw.context_window_size) * 100).toFixed(0)} %)` : `ctx ${fmtK(ctx)}`);
    parts.push('[statusline]');
  } else if (sess) {
    parts.push(`ctx ≈ ${fmtK(sess.lastContext)}${sess.tailOnly ? ' (tail)' : ''}`);
    parts.push(`${fmtK(totalTokens(sess))} tok in window`);
    parts.push('[transcript]');
  }
  if (input?.cost?.total_cost_usd != null) parts.push(`$${Number(input.cost.total_cost_usd).toFixed(2)} session`);
  parts.push('allowance UNKNOWN → /usage');
  return parts.join(' · ');
}
async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ── selftest: planted records, no IO ───────────────────────────────────────────────────────────── */
export function selftest() {
  let pass = 0;
  const fail = [];
  const ok = (label, cond, detail) => {
    if (cond) pass++;
    else fail.push(detail ? `${label} — ${detail}` : label);
  };
  const t0 = Date.parse('2026-10-11T00:00:00Z');
  ok('parseSince 24h is a day back', parseSince('24h', t0) === t0 - 86400e3);
  ok('parseSince 90m is ninety minutes back', parseSince('90m', t0) === t0 - 5400e3);
  ok('parseSince takes an ISO instant verbatim', parseSince('2026-10-10T12:00:00Z', t0) === Date.parse('2026-10-10T12:00:00Z'));
  let threw = false;
  try {
    parseSince('yesterday', t0);
  } catch {
    threw = true;
  }
  ok('parseSince refuses prose', threw);

  const line = (ts, usage, model = 'claude-fable-5-1') => JSON.stringify({ type: 'assistant', timestamp: ts, message: { model, usage } });
  const s = emptySession('abc');
  foldLine(
    s,
    line('2026-10-11T01:00:00Z', { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50, output_tokens_details: { thinking_tokens: 20 } }),
    t0
  );
  foldLine(s, line('2026-10-11T02:00:00Z', { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 1200, output_tokens: 30 }), t0);
  ok('two assistant messages fold to their sums', s.input === 15 && s.cacheCreate === 100 && s.cacheRead === 2200 && s.output === 80 && s.thinking === 20, JSON.stringify(s));
  ok('totalTokens is FRESH: in + cache-create + out — cache reads are NOT summed in', totalTokens(s) === 15 + 100 + 80 && s.cacheRead === 2200);
  ok('the LAST message sets the context proxy (input + both caches)', s.lastContext === 5 + 0 + 1200 && s.lastContextAt === Date.parse('2026-10-11T02:00:00Z'));
  ok('models are counted by message', s.models['claude-fable-5-1'] === 2);
  foldLine(s, line('2026-10-10T20:00:00Z', { input_tokens: 999 }), t0);
  ok('a message before the window is not folded', s.input === 15);
  foldLine(s, JSON.stringify({ type: 'assistant', timestamp: '2026-10-11T03:00:00Z', message: { model: 'm' } }), t0);
  ok('a message WITHOUT a usage block is counted as such, never as zero tokens', s.messages === 3 && s.messagesWithoutUsage === 1);
  foldLine(s, JSON.stringify({ type: 'user', timestamp: '2026-10-11T03:30:00Z', message: { usage: { input_tokens: 7 } } }), t0);
  ok('a non-assistant line is ignored even when it carries a usage block', s.input === 15 && s.messages === 3);
  foldLine(s, '{not json "type":"assistant"', t0);
  ok('a malformed line is ignored, not fatal', s.messages === 3);

  ok(
    'usageFromBody reads Gemini usageMetadata',
    JSON.stringify(usageFromBody({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 } })) === JSON.stringify({ prompt: 10, answer: 3, thinking: 2 })
  );
  ok(
    'usageFromBody reads OpenAI-shaped usage',
    JSON.stringify(usageFromBody({ usage: { prompt_tokens: 11, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 1 } } })) === JSON.stringify({ prompt: 11, answer: 4, thinking: 1 })
  );
  ok('usageFromBody reads Anthropic usage', JSON.stringify(usageFromBody({ usage: { input_tokens: 12, output_tokens: 5 } })) === JSON.stringify({ prompt: 12, answer: 5, thinking: null }));
  ok('usageFromBody takes the body as the recorded STRING too', usageFromBody('{"usage":{"input_tokens":1,"output_tokens":2}}')?.answer === 2);
  ok('usageFromBody returns null, not zeros, when no usage object exists', usageFromBody({ candidates: [] }) === null && usageFromBody('not json') === null);
  const api = {};
  foldApiRecord(api, { kind: 'response', at: '2026-10-11T01:00:00Z', provider: 'gemini', model: 'g', http: 200, body: '{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":10}}' }, t0);
  foldApiRecord(api, { kind: 'response', at: '2026-10-11T01:01:00Z', provider: 'gemini', model: 'g', http: 429, body: '{"error":"rate"}' }, t0);
  foldApiRecord(api, { kind: 'request', at: '2026-10-11T01:00:00Z', provider: 'gemini', model: 'g' }, t0);
  const row = api['gemini · g'];
  ok(
    'api records fold per provider·model: 2 responses, 1 without usage, 1 non-2xx; requests are not responses',
    row && row.requests === 2 && row.withoutUsage === 1 && row.nonOk === 1 && row.prompt === 100 && row.answer === 10,
    JSON.stringify(row)
  );

  ok('budgetState: 30 % remaining is ok', budgetState(70, 100).level === 'ok');
  ok('budgetState: exactly 25 % remaining WARNS', budgetState(75, 100).level === 'warn');
  ok('budgetState: exactly 10 % remaining STOPS', budgetState(90, 100).level === 'stop');
  ok('budgetState: over budget is 0 % remaining, stop', budgetState(150, 100).remaining === 0 && budgetState(150, 100).level === 'stop');
  ok('budgetState: an unconfigured budget is unconfigured, never a percentage', budgetState(5, 0).level === 'unconfigured' && budgetState(5, NaN).remaining === null);
  ok(
    'parseBudgets reads repeated --budget name=tokens, lower-casing the name',
    JSON.stringify(parseBudgets(['--budget', 'Fleet=1000', 'x', '--budget', 'kestrel=50'])) === JSON.stringify({ fleet: 1000, kestrel: 50 })
  );
  threw = false;
  try {
    parseBudgets(['--budget', 'fleet=lots']);
  } catch {
    threw = true;
  }
  ok('parseBudgets refuses a non-numeric budget', threw);
  ok("primaryCheckout resolves a worktree to the common dir's parent", primaryCheckout('/home/x/branch-a', () => '/home/x/Repo/.git\n') === '/home/x/Repo');
  ok('primaryCheckout resolves the root checkout to itself', primaryCheckout('/home/x/Repo', () => '.git\n') === '/home/x/Repo');
  ok(
    'primaryCheckout falls back to the given root when git is unavailable',
    primaryCheckout('/home/x/none', () => {
      throw new Error('no git');
    }) === '/home/x/none'
  );
  ok('projectSlug turns every non-alphanumeric character into a dash, as the transcript directory names do', projectSlug('/srv/u/Repo Name.v2') === '-srv-u-Repo-Name-v2');

  const names = { 'sid-1': { name: 'kestrel', status: 'working' } };
  const collected = {
    dir: '/x',
    dirReadable: true,
    herder: { ok: true, map: names },
    sessions: [Object.assign(emptySession('sid-1'), { name: 'kestrel', input: 10, cacheCreate: 0, cacheRead: 80, output: 10, messages: 1, file: '/x/sid-1.jsonl' })],
    api: [],
    apiFiles: [],
    apiMalformed: 0
  };
  const ev = (b, now = t0 + 3600e3, c = collected) => evaluate(c, b, { sinceMs: t0, nowMs: now });
  const { verdict: vNA, usage: uNA } = ev({});
  ok(
    'no budget configured ⇒ NOT_APPLICABLE with a reason naming the manual check; result null; allowance UNKNOWN beside it',
    vNA.status === 'NOT_APPLICABLE' && /UNKNOWN/.test(vNA.reason) && vNA.result === null && uNA.allowance.status === 'UNKNOWN',
    vNA.reason
  );
  ok('the measurement travels as its own object with every session in it', uNA.schema === 'tepna.usage/1' && uNA.sessions.length === 1 && uNA.sessions[0].tokens === 20 && uNA.fleetTokens === 20);
  ok('the NOT_APPLICABLE verdict validates against tepna.verdict/1', Verdict.validate(vNA).ok === true, JSON.stringify(Verdict.validate(vNA)));
  ok(
    'the fixture session is 20 fresh tokens with 80 served from cache, reported apart',
    uNA.sessions[0].tokens === 20 && uNA.sessions[0].cacheRead === 80 && uNA.fleetTokens === 20 && uNA.fleetCacheRead === 80
  );
  const { verdict: vOk, usage: uOk } = ev({ kestrel: 1000 });
  ok('a budget with 90 % remaining ⇒ PASS, no warning', vOk.status === 'PASS' && uOk.warnings.length === 0 && vOk.result.budgets[0].level === 'ok', vOk.status);
  ok('the PASS verdict validates against tepna.verdict/1', Verdict.validate(vOk).ok === true, JSON.stringify(Verdict.validate(vOk)));
  const { verdict: vWarn, usage: uWarn } = ev({ kestrel: 25 });
  ok(
    'a budget with 20 % remaining ⇒ PASS with a warning that says "CONFIGURED budget"',
    vWarn.status === 'PASS' && uWarn.warnings.length === 1 && /CONFIGURED budget/.test(uWarn.warnings[0]) && vWarn.result.warnings.length === 1,
    JSON.stringify(uWarn.warnings)
  );
  const { verdict: vStop } = ev({ fleet: 21 });
  ok('a fleet budget with ≤ 10 % remaining ⇒ FAIL with a hand-off reason', vStop.status === 'FAIL' && /hand off/.test(vStop.reason), vStop.reason);
  ok('the FAIL verdict validates against tepna.verdict/1', Verdict.validate(vStop).ok === true, JSON.stringify(Verdict.validate(vStop)));
  const { usage: uNone } = ev({ osprey: 100 });
  ok('a budget for a name with no session in the window is reported as such, not as 0 % used', uNone.budgets[0].level === 'no-session-in-window' && uNone.budgets[0].used === null);
  const { verdict: vNR, usage: uNR } = ev({ fleet: 1 }, t0 + 1, { ...collected, dirReadable: false, sessions: [] });
  ok(
    'an unreadable transcript directory ⇒ NOT_RUN (nothing examined), result null, never PASS',
    vNR.status === 'NOT_RUN' && vNR.population.checked === 0 && vNR.result === null && Verdict.validate(vNR).ok === true
  );
  ok(
    '…and its budget row says not-run with no spend figure, never "0 used · 100 % remains"',
    uNR.budgets[0].level === 'not-run' && uNR.budgets[0].used === null && uNR.budgets[0].remaining === null,
    JSON.stringify(uNR.budgets)
  );
  ok(
    'every status used here is one of the seven',
    [vNA, vOk, vWarn, vStop, vNR].every((v) => Verdict.STATUSES.includes(v.status))
  );

  const sl = statusLineFrom(
    { session_id: 'sid-1', context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000, cache_read_input_tokens: 99000 } }, cost: { total_cost_usd: 1.234 } },
    null,
    names
  );
  ok(
    "statusLine reads Claude Code's stdin JSON when it carries context_window, labelled [statusline]",
    /kestrel/.test(sl) && /ctx 100k\/200k \(50 %\)/.test(sl) && /\[statusline\]/.test(sl) && /\$1\.23 session/.test(sl),
    sl
  );
  const sl2 = statusLineFrom({ session_id: 'sid-9' }, Object.assign(emptySession('sid-9'), { lastContext: 123456, input: 1, cacheCreate: 2, cacheRead: 3, output: 4 }), {});
  ok('statusLine falls back to the transcript and labels it [transcript]', /ctx ≈ 123k/.test(sl2) && /\[transcript\]/.test(sl2), sl2);
  ok('statusLine never prints a plan percentage: allowance is UNKNOWN with the manual check', /allowance UNKNOWN → \/usage/.test(sl) && /allowance UNKNOWN → \/usage/.test(sl2));
  const table = renderTable(vWarn, uWarn);
  ok(
    'the table names the warning and the manual checks',
    /⚠ kestrel: 20\.0 % of the CONFIGURED budget remains/.test(table) && /PLAN ALLOWANCE: UNKNOWN/.test(table) && /\/status in the Codex session/.test(table)
  );

  /* REMOTE FOLD PARITY: the Python fold that runs on a second host must give foldLine's sums on the
     same lines, or the two hosts' rows mean different things. */
  const rdir = mkdtempSync(join(tmpdir(), 'usage-remote-'));
  try {
    mkdirSync(join(rdir, 'proj'));
    const lines = [
      line('2026-10-11T01:00:00.000Z', { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 30, output_tokens_details: { thinking_tokens: 7 } }),
      line('2026-10-11T02:00:00.500Z', { input_tokens: 10, cache_read_input_tokens: 1200, output_tokens: 50 }, 'claude-opus-5-5'),
      line('2026-10-10T23:00:00.000Z', { input_tokens: 999, output_tokens: 999 }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-11T03:00:00Z', message: { model: 'm' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-11T03:30:00Z', message: { usage: { input_tokens: 7 } } })
    ];
    writeFileSync(join(rdir, 'proj', 'sid-r.jsonl'), `${lines.join('\n')}\n`);
    const js = emptySession('sid-r');
    for (const l of lines) foldLine(js, l, t0);
    let py = null;
    try {
      py = parseRemoteFold(execFileSync('python3', ['-', String(t0), rdir], { input: REMOTE_FOLD_PY, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }), 'box');
    } catch (e) {
      ok('the remote fold script runs under python3', false, e.message);
    }
    if (py) {
      const r = py.sessions[0] ?? {};
      const keys = ['input', 'cacheCreate', 'cacheRead', 'output', 'thinking', 'messages', 'messagesWithoutUsage', 'first', 'last', 'lastContext', 'lastContextAt'];
      const diff = keys.filter((k) => r[k] !== js[k]);
      ok(
        'the remote fold equals foldLine on the same lines',
        py.sessions.length === 1 && diff.length === 0 && JSON.stringify(r.models) === JSON.stringify(js.models),
        `${diff.join(',')} ${JSON.stringify(r)}`
      );
      ok('a remote session carries its host and a host-qualified source', r.host === 'box' && r.file.startsWith('box:'));
    }
  } finally {
    rmSync(rdir, { recursive: true, force: true });
  }
  const unreachable = remoteSessions('box', t0, () => {
    throw Object.assign(new Error('x'), { status: 255 });
  });
  ok('an unreachable host is a reason, never a zero row', unreachable.ok === false && unreachable.sessions.length === 0 && /not read \(255\)/.test(unreachable.reason));
  {
    const hdir = mkdtempSync(join(tmpdir(), 'ug-home-'));
    try {
      ok('no ~/.ssh/config: ssh is called without -F', sshConfigArgs(hdir).length === 0);
      mkdirSync(join(hdir, '.ssh'));
      writeFileSync(join(hdir, '.ssh', 'config'), 'Host box\n');
      let seen = null;
      remoteSessions(
        'box',
        t0,
        (cmd, args) => {
          seen = args;
          return '{"sessions":[],"names":null}';
        },
        hdir
      );
      const fi = seen ? seen.indexOf('-F') : -1;
      ok(
        'with ~/.ssh/config the remote fold passes -F <that file> before the host, so a sandbox that hides /etc/ssh cannot fail it',
        fi > 0 && seen[fi + 1] === join(hdir, '.ssh', 'config') && seen.indexOf('box') > fi
      );
    } finally {
      rmSync(hdir, { recursive: true, force: true });
    }
  }

  /* MANAGED AGENTS: the last session GET carries the cumulative usage; earlier GETs and events are not summed. */
  const ma = {};
  const get = (at, out, cost) => ({
    method: 'GET',
    path: '/v1/sessions/sesn_A',
    at,
    body: {
      agent: { model: { id: 'claude-sonnet-5-5' } },
      usage: {
        input_tokens: 10,
        cache_creation: { ephemeral_5m_input_tokens: 100 },
        cache_read_input_tokens: 1000,
        output_tokens: out,
        ...(cost ? { list_cost: { amount: cost, currency: 'USD' } } : {})
      }
    }
  });
  foldMaRecord(ma, get('2026-10-11T01:00:00Z', 5, '10'));
  foldMaRecord(ma, get('2026-10-11T01:05:00Z', 40, '83'));
  foldMaRecord(ma, { method: 'GET', path: '/v1/sessions/sesn_A/events?limit=1000', at: '2026-10-11T01:06:00Z', body: { usage: { output_tokens: 9999 } } });
  foldMaRecord(ma, { method: 'POST', path: '/v1/sessions/sesn_B', at: '2026-10-11T01:06:00Z', body: { usage: { output_tokens: 9999 } } });
  foldMaRecord(ma, { method: 'GET', path: '/v1/sessions/sesn_C', at: '2026-10-11T02:00:00Z', body: { agent: { model: { id: 'claude-sonnet-5-5' } }, usage: { input_tokens: 1, output_tokens: 2 } } });
  const [mr] = maRows(ma, t0);
  ok(
    'managed-agents keeps the LAST session GET and ignores events and posts',
    mr?.sessions === 2 && mr.output === 42 && mr.input === 11 && mr.cacheCreate === 100 && mr.cacheRead === 1000,
    JSON.stringify(mr)
  );
  ok('list_cost reads as cents, and a session without one is counted, never priced at $0', mr?.listCostUsd === 0.83 && mr.costWithout === 1, JSON.stringify(mr));
  ok('a session whose last record precedes the window is out of it', maRows(ma, Date.parse('2026-10-11T03:00:00Z')).length === 0);
  return { pass, fail, ok: fail.length === 0, line: fail.length ? `✗ ${fail.length} failed, ${pass} passed` : `✓ all ${pass} selftests passed` };
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  if (argv.includes('--verdict-sample')) {
    /* enumerates nothing: a sample that did not read a transcript reports so, never a PASS it did not earn */
    const v = Verdict.make({
      gate: GATE,
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'remaining_share_of_configured_budget', threshold: STOP_REMAINING, unit: 'share', direction: 'gte' },
      result: null,
      evidence: ['tools/usage-guard.mjs'],
      reason: '--verdict-sample reads no transcript and configures no budget — nothing was examined',
      producedBy: producedByOf('tools/usage-guard.mjs', null)
    });
    process.stdout.write(`${JSON.stringify(v)}\n`);
    process.exit(0);
  }
  const nowMs = Date.now();
  const sinceMs = parseSince(flagValue(argv, '--since') ?? '24h', nowMs);
  const budgets = parseBudgets(argv);
  const apiLogs = flagValues(argv, '--api-log');
  const remotes = flagValues(argv, '--remote');
  const maLogs = flagValues(argv, '--ma-log');
  const onlySession = flagValue(argv, '--session') ?? null;
  if (argv.includes('--status-line')) {
    const input = await readStdinJson();
    const names = herderNames().map;
    let sess = null;
    const file = input?.transcript_path ?? (input?.session_id ? join(transcriptDir(input?.cwd ?? ROOT), `${input.session_id}.jsonl`) : null);
    if (file && existsSync(file)) sess = await readTranscript(file, sinceMs, 8 * 1024 * 1024).catch(() => null);
    if (sess && input?.session_id) sess.name = names[input.session_id]?.name ?? null;
    process.stdout.write(`${statusLineFrom(input, sess, names)}\n`);
    return;
  }
  const collected = await collect({ cwd: flagValue(argv, '--project') ?? primaryCheckout(), sinceMs, onlySession, apiLogs, remotes, maLogs });
  const { verdict, usage } = evaluate(collected, budgets, { sinceMs, nowMs });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ verdict, usage })}\n`);
  } else {
    process.stdout.write(`${renderTable(verdict, usage)}\n\n${JSON.stringify(verdict)}\n`);
  }
  process.exit(verdict.status === 'FAIL' ? 1 : 0);
}
if (IS_MAIN)
  main().catch((e) => {
    console.error(`usage-guard: ${e.message}`);
    process.exit(2);
  });
