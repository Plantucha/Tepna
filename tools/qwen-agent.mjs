/*
  qwen-agent.mjs — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0

  READ-ONLY LOCAL-MODEL AGENT — owner-directed 2026-08-27: "make sure qwen will read CLAUDE.md
  and have access to bge and other stuff so it can behave like normal Claude coder."

  qwen3-coder gets an agent loop with READ-ONLY tools — it pulls its own context the way a
  session does (read files, semantic doc-search, git grep, list dirs), then must produce a
  markdown BRIEF. ⚠️ THE §0 INVARIANT IS STRUCTURAL HERE: there is no write tool, no shell
  tool, no network tool. The agent's only output is a report file for coordinator triage; it
  proposes (including full draft code), it never decides and it cannot touch the tree.

  The system prompt embeds a DISTILLED CLAUDE.md read at runtime from the real file, so the
  house rules the agent reasons under track the document, not a paraphrase frozen in this tool.

  Usage:
    node tools/qwen-agent.mjs "review the flush gate for races with a new recording"
    node tools/qwen-agent.mjs --max-rounds 12 "task ..."
    node tools/qwen-agent.mjs --selftest
  Output: .git/tepna-mutation/qwen-agent/<timestamp>-<slug>.md
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..'));
const OLLAMA = 'http://127.0.0.1:11434';
const MODEL = 'qwen3-coder:30b';
const RESULT_CAP = 4000;          // chars per tool result handed back to the model
const HISTORY_CAP = 24000;        // chars of tool-result history kept before oldest are elided

/* Path jail: every file access resolves inside ROOT or is refused. */
export function jail(p) {
  const r = resolve(ROOT, String(p || ''));
  if (r !== ROOT && !r.startsWith(ROOT + sep)) return null;
  return r;
}

export const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'Read a file from the Tepna repo (path relative to repo root). Large files are truncated; pass start_line to page.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'doc_search', description: 'Semantic (bge) search over the repo docs/briefs/code. Returns top hits with snippets. Use for INTENT: what a thing is documented to do.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'grep_repo', description: 'git grep -n a fixed string (not regex) across the repo. Use for occurrences of an identifier.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'List a repo directory (names + sizes).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
];

export function runTool(name, args) {
  try {
    if (name === 'read_file') {
      const p = jail(args.path);
      if (!p) return 'REFUSED: path escapes the repo';
      if (!existsSync(p)) return 'NOT FOUND: ' + args.path;
      const lines = readFileSync(p, 'utf8').split('\n');
      const start = Math.max(0, (args.start_line || 1) - 1);
      const slice = lines.slice(start, start + 120);
      return `[${args.path} lines ${start + 1}-${start + slice.length} of ${lines.length}]\n` + slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
    }
    if (name === 'doc_search') {
      const out = execFileSync('node', [join(HERE, 'doc-search.mjs'), String(args.query || '')], { encoding: 'utf8', timeout: 60000 });
      return out.split('\n').slice(0, 14).join('\n');
    }
    if (name === 'grep_repo') {
      const out = execFileSync('git', ['grep', '-nF', '--', String(args.text || '')], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      return out.split('\n').slice(0, 40).join('\n');
    }
    if (name === 'list_dir') {
      const p = jail(args.path || '.');
      if (!p) return 'REFUSED: path escapes the repo';
      return readdirSync(p).slice(0, 80).map((f) => { try { const st = statSync(join(p, f)); return `${st.isDirectory() ? 'd' : '-'} ${st.size}\t${f}`; } catch { return '? ?\t' + f; } }).join('\n');
    }
    return 'UNKNOWN TOOL: ' + name;
  } catch (e) { return 'TOOL ERROR: ' + String(e.message || e).slice(0, 200); }
}

function distilledClaudeMd() {
  try {
    const s = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const grab = (marker, n) => { const i = s.indexOf(marker); return i < 0 ? '' : s.slice(i, i + n) + '\n…\n'; };
    return (
      grab('## 🔒 THE CLOCK CONTRACT', 1500) +
      grab('### 5. Display — ALWAYS `getUTC*`', 300) +
      grab('## 📏 Units', 400) +
      grab('## 🎫 Evidence badges', 400)
    ).slice(0, 3000);
  } catch { return '(CLAUDE.md unavailable — apply the Clock Contract and honest-null rules from memory)'; }
}

function systemPrompt() {
  return `You are a careful engineer working on Tepna, a local-first physiological signal suite. You have READ-ONLY tools: read_file, doc_search (semantic), grep_repo, list_dir. Investigate before concluding — read the actual code, check documented intent with doc_search, verify identifier usage with grep_repo. Cite file:line for every claim.

HOUSE RULES (distilled live from the repo's CLAUDE.md):
${distilledClaudeMd()}

HARD INVARIANT: you are an advisor. Your findings and any code you write are PROPOSALS for a human coordinator's triage — you cannot modify anything, and your report must not claim anything is fixed or decided. A wrong confident claim is worse than an honest "could not establish".

When you have enough evidence, STOP calling tools and write your final answer as a markdown brief: ## Finding(s), each with file:line citations, a concrete scenario, and (where you can stand behind it) a proposed fix as a code block.`;
}

async function chat(messages, useTools) {
  const res = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, messages, tools: useTools ? TOOLS : undefined, think: false, stream: false, options: { temperature: 0.2, num_predict: 1400 } })
  });
  if (!res.ok) throw new Error('ollama HTTP ' + res.status);
  return (await res.json()).message || {};
}

function trimHistory(messages) {
  let size = messages.reduce((a, m) => a + String(m.content || '').length, 0);
  for (let i = 2; i < messages.length - 2 && size > HISTORY_CAP; i++) {
    if (messages[i].role === 'tool' && String(messages[i].content || '').length > 200) {
      size -= messages[i].content.length - 60;
      messages[i] = { ...messages[i], content: '[elided earlier tool result]' };
    }
  }
  return messages;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const mi = argv.indexOf('--max-rounds');
  const maxRounds = mi >= 0 ? Math.min(20, +argv[mi + 1] || 10) : 10;
  const task = argv.filter((a, i) => !a.startsWith('--') && (mi < 0 || i !== mi + 1)).join(' ');
  if (!task) { console.error('usage: qwen-agent.mjs "task"'); process.exit(2); }
  const outDir = join(existsSync('/home/michal/Tepna/.git') ? '/home/michal/Tepna/.git/tepna-mutation' : join(ROOT, '.git', 'tepna-mutation'), 'qwen-agent');
  mkdirSync(outDir, { recursive: true });

  let messages = [ { role: 'system', content: systemPrompt() }, { role: 'user', content: task } ];
  const toolLog = [];
  let final = null;
  for (let round = 0; round < maxRounds; round++) {
    const msg = await chat(trimHistory(messages), round < maxRounds - 1);
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls.slice(0, 4)) {
        const name = tc.function?.name, args = tc.function?.arguments || {};
        const result = String(runTool(name, typeof args === 'string' ? JSON.parse(args || '{}') : args)).slice(0, RESULT_CAP);
        toolLog.push(`${name}(${JSON.stringify(args).slice(0, 120)})`);
        process.stderr.write(`  [${round}] ${toolLog[toolLog.length - 1]}\n`);
        messages.push({ role: 'tool', content: result });
      }
      continue;
    }
    final = msg.content || '';
    break;
  }
  if (final === null) {
    messages.push({ role: 'user', content: 'Round limit reached. Write your final brief NOW from the evidence you have; mark anything unestablished as such.' });
    final = (await chat(trimHistory(messages), false)).content || '(no final answer)';
  }
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/^-|-$/g, '');
  const path = join(outDir, new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '-' + slug + '.md');
  writeFileSync(path, `# qwen-agent brief — MODEL PROPOSAL, untriaged\n\n**Task:** ${task}\n**Tool calls (${toolLog.length}):** ${toolLog.join(' · ') || 'none'}\n\n---\n\n${final}\n`);
  console.log(path);
}

function selftest() {
  let ok = 0, fail = 0;
  const ck = (n, c) => { c ? ok++ : (fail++, console.error('✗ ' + n)); };
  ck('jail: inside ok', jail('tools/doc-search.mjs') !== null);
  ck('jail: escape refused', jail('../../etc/passwd') === null);
  ck('jail: absolute escape refused', jail('/etc/passwd') === null);
  ck('jail: root itself ok', jail('.') === ROOT);
  ck('read_file: refuses escape', runTool('read_file', { path: '../secrets' }).startsWith('REFUSED'));
  ck('read_file: reads real file', runTool('read_file', { path: 'package.json' }).includes('"name"'));
  ck('read_file: pages', runTool('read_file', { path: 'CLAUDE.md', start_line: 50 }).includes('lines 50-'));
  ck('grep: finds fixed string', runTool('grep_repo', { text: 'DEFAULT_FLEET' }).includes('mutation-crawl'));
  ck('list: jailed', runTool('list_dir', { path: '/etc' }).startsWith('REFUSED'));
  ck('list: works', runTool('list_dir', { path: 'tools' }).includes('doc-search.mjs'));
  ck('unknown tool named', runTool('nope', {}).startsWith('UNKNOWN'));
  ck('distill: nonempty', distilledClaudeMd().length > 200);
  ck('distill: clock contract present', distilledClaudeMd().includes('CLOCK CONTRACT'));
  console.log(`selftest: ${ok} ok, ${fail} failed`); process.exit(fail ? 1 : 0);
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === self || process.argv[1].endsWith('qwen-agent.mjs'))) main();
