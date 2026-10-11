// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/ste-lint.mjs — the writing rules, checked

       node tools/ste-lint.mjs <file.md>        # advisory report
       node tools/ste-lint.mjs - < body.md      # a PR body on stdin
       node tools/ste-lint.mjs <file> --json    # the verdict alone
       node tools/ste-lint.mjs --selftest
       node tools/ste-lint.mjs --verdict-sample

   The rules come from ASD-STE100 (Simplified Technical English), Issue 8, 2021.

   ⚠️ WE ADOPT THE RULES, NOT THE DICTIONARY. ASD's approved-word list is
   copyrighted and is NOT copied here or anywhere in this repo. The approved-word
   layer is OURS: `docs/GLOSSARY.md`, seeded from terms this repo already uses and
   picked by COUNT, not by taste.

   Each finding names the line. The tool is ADVISORY (exit 0) by owner ruling;
   `--strict` exits 1 and is for later, when the counts are low enough that a red
   means a defect rather than a backlog.

   WHAT IT SKIPS, AND WHY EACH SKIP IS LOAD-BEARING. A checker that flags the
   wrong spans teaches people to ignore it:
     · fenced code and indented code — not prose;
     · tables — cells are labels, not sentences;
     · quoted log lines and command output — someone else's words, and we must
       not rewrite evidence;
     · URLs and inline code — a long identifier is not a long sentence;
     · citations (author, year, DOI) — the form is fixed by the source.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const MAX_WORDS_PROCEDURE = 20;
export const MAX_WORDS_PROSE = 25;
export const MAX_SENTENCES_PARAGRAPH = 6;

/** Retired terms: CLAUDE.md names the first three; the rest come from docs/GLOSSARY.md at run time. */
export const RETIRED_SEED = ['proxy', 'composite', 'provisionally validated'];

/** Technical names keep their form: a metric id, a device, a file name. They are NOT -ing nouns. */
export const TECHNICAL_NAME = /^(?:[A-Z][A-Za-z0-9]*(?:Dex|DSP)|[a-z]+[A-Z][A-Za-z0-9]*|[\w.-]+\.(?:js|mjs|py|json|md|html|txt|edf))$/;

export function readGlossary(root = ROOT) {
  const p = join(root, 'docs/GLOSSARY.md');
  const out = { retired: new Map(), technical: new Set() };
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    /* `| approved | retired, retired | note |` and `| **name** | technical name | … |` */
    const m = line.match(/^\|\s*`?([^`|]+?)`?\s*\|\s*([^|]*)\|/);
    if (!m) continue;
    const approved = m[1].trim();
    const second = m[2].trim();
    /* The table's own HEADER and separator are not entries. Without this the file that DEFINES the
       retired words reports them as uses — measured on the first run of this tool against its own
       glossary, which is the cheapest possible proof that a definition is not a use. */
    if (/^(approved|name|term)$/i.test(approved) || /^[-: ]+$/.test(approved) || /^(retired|kind)$/i.test(second)) continue;
    if (/technical name/i.test(second)) {
      out.technical.add(approved.toLowerCase());
      continue;
    }
    for (const r of second.split(/[,;]/)) {
      const t = r.trim().replace(/^`|`$/g, '');
      if (t && t !== '—' && !/^\*+$/.test(t)) out.retired.set(t.toLowerCase(), approved);
    }
  }
  return out;
}

/** Lines that are prose, with the skipped spans removed. Returns [{ n, text, procedure }]. */
export function proseLines(src) {
  const out = [];
  let fence = false;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (/^\s{4,}\S/.test(raw)) continue; // indented code
    if (/^\s*\|/.test(raw)) continue; // table row
    if (/^\s*>/.test(raw)) continue; // quoted text — someone else's words
    if (/^\s*(#|<!--|-->|\[\^)/.test(raw)) continue; // heading, comment, footnote
    if (/\bdoi:|https?:\/\/\S+\s*$/i.test(raw) && raw.trim().split(/\s+/).length < 14) continue; // a citation line
    let text = raw
      .replace(/`[^`]*`/g, 'CODE')
      .replace(/https?:\/\/\S+/g, 'URL')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    if (!text.trim()) continue;
    const procedure = /^\s*(?:[-*+]|\d+\.)\s/.test(raw);
    out.push({ n: i + 1, text: text.trim(), procedure });
  }
  return out;
}

export function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(§`"'0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s) =>
  s
    .replace(/[—·|]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));

/* Passive: a form of "to be" plus a past participle. A heuristic, and it says so. */
const PASSIVE = /\b(is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?([a-z]+(?:ed|en))\b/;
const IMPERATIVE_HEAD = /^(?:Run|Read|Add|Use|Set|Check|Make|Write|Open|Close|Do|Keep|Put|Give|Take|Send|Build|Fix|Remove|Replace|Escape|Verify|Measure|Report|Stop|Start|Never|Always)\b/;
/** A second instruction joined to the first. The verb list is the lowercase twin of the heads. */
const JOINED_IMPERATIVE =
  /(?:\band\b|\bthen\b|;|,)\s+(?:run|read|add|use|set|check|make|write|open|close|do|keep|put|give|take|send|build|fix|remove|replace|escape|verify|measure|report|stop|start)\b/;

export function findings(src, glossary = { retired: new Map(), technical: new Set() }) {
  const out = [];
  const add = (n, rule, detail) => out.push({ line: n, rule, detail });
  const lines = proseLines(src);

  for (const { n, text, procedure } of lines) {
    for (const s of sentences(text)) {
      const w = words(s);
      const cap = procedure || IMPERATIVE_HEAD.test(s) ? MAX_WORDS_PROCEDURE : MAX_WORDS_PROSE;
      if (w.length > cap) add(n, 'long-sentence', `${w.length} words, limit ${cap}`);
      const p = s.match(PASSIVE);
      if (p) add(n, 'passive', `"${p[0]}"`);
      /* More than one imperative in a sentence: one instruction per sentence. The SECOND one is
         lowercase and follows a joiner, so a case-sensitive scan of the leading form misses it —
         which is what the planted case caught. A bare case-insensitive scan would instead match the
         NOUN in "a dry run", so the joiner is required. */
      if (IMPERATIVE_HEAD.test(s) && JOINED_IMPERATIVE.test(s)) add(n, 'two-imperatives', `"${s.match(JOINED_IMPERATIVE)[0].trim()}"`);
      for (const m of s.matchAll(/\b([a-z][a-z-]{3,}ing)\b/g)) {
        const t = m[1];
        if (TECHNICAL_NAME.test(t) || glossary.technical.has(t)) continue;
        /* A verb-noun only when it heads a noun phrase: "the <x>ing of", "a <x>ing". */
        /* The verb-noun shape is a DETERMINER, the -ing word, and then no noun: "the stamping of",
           "a reading." — not "the writing rules", where -ing modifies a following noun. */
        if (new RegExp(`\\b(?:the|a|an|this|its|their)\\s+${t}(?=\\s+(?:of|is|was|has|had)\\b|[,.;:)]|$)`, 'i').test(s)) add(n, 'verb-noun', t);
      }
      for (const [retired, approved] of glossary.retired) {
        if (new RegExp(`\\b${retired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) add(n, 'retired-term', `"${retired}" → "${approved}"`);
      }
    }
  }

  /* Paragraph length, measured over consecutive prose lines. */
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const n = para[0].n;
    const count = para.reduce((a, l) => a + sentences(l.text).length, 0);
    if (count > MAX_SENTENCES_PARAGRAPH) add(n, 'long-paragraph', `${count} sentences, limit ${MAX_SENTENCES_PARAGRAPH}`);
    para = [];
  };
  let prev = -2;
  for (const l of lines) {
    /* A procedure line ends the paragraph: a numbered rule list is a set of instructions, not one
       seventeen-sentence paragraph. The first run reported exactly that against this repo's own rules. */
    if (l.procedure) {
      flush();
      prev = l.n;
      continue;
    }
    if (l.n !== prev + 1) flush();
    para.push(l);
    prev = l.n;
  }
  flush();
  return out;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function verdictFor(label, f, lineCount) {
  const byRule = {};
  for (const x of f) byRule[x.rule] = (byRule[x.rule] || 0) + 1;
  return Verdict.make({
    gate: 'ste-lint',
    scope: 'internal',
    status: 'NOT_APPLICABLE',
    population: { checked: lineCount, eligible: lineCount, excluded: 0 },
    criterion: { name: 'ste_findings', threshold: 0, unit: 'findings', direction: 'lte' },
    result: { target: label, findings: f.length, byRule },
    evidence: ['tools/ste-lint.mjs', 'docs/GLOSSARY.md'],
    /* ADVISORY by owner ruling: the rule does not bind yet, so NOT_APPLICABLE with the count beside
       it — never PASS over findings, and never FAIL on a backlog nobody has been asked to clear. */
    reason: `advisory — ${f.length} finding(s); the rules are adopted, the threshold is not armed (use --strict)`,
    producedBy: { tool: 'tools/ste-lint.mjs', commit: gitCommit() }
  });
}

function main() {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('-')) || (argv.includes('-') ? '-' : null);
  if (!target) {
    console.error('usage: node tools/ste-lint.mjs <file.md|-> [--json] [--strict]');
    process.exit(2);
  }
  const src = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
  const g = readGlossary();
  const f = findings(src, g);
  const lineCount = proseLines(src).length;
  const v = verdictFor(target === '-' ? '<stdin>' : target, f, lineCount);
  console.log(JSON.stringify(v));
  if (!argv.includes('--json')) {
    console.log(`\n▸ ${target}: ${f.length} finding(s) over ${lineCount} prose line(s)`);
    const byRule = v.result.byRule;
    for (const k of Object.keys(byRule).sort()) console.log(`   ${String(byRule[k]).padStart(4)}  ${k}`);
    for (const x of f.slice(0, 25)) console.log(`   ${target}:${x.line}  ${x.rule} — ${x.detail}`);
    if (f.length > 25) console.log(`   … and ${f.length - 25} more`);
  }
  process.exit(argv.includes('--strict') && f.length ? 1 : 0);
}

const DIRECT = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (DIRECT && process.argv.includes('--verdict-sample')) {
  const v = verdictFor('<sample>', [], 0);
  v.status = 'NOT_RUN';
  v.result = null;
  v.reason = 'sample only — this invocation read no file';
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (DIRECT && process.argv.includes('--selftest')) {
  let bad = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      bad++;
      console.log(`  ✕ ${n} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    } else console.log(`  ✓ ${n}`);
  };
  const rules = (s, g) => findings(s, g || { retired: new Map(), technical: new Set() }).map((x) => x.rule);
  const G = { retired: new Map([['proxy', 'measured value']]), technical: new Set(['oxydex']) };

  const long = 'This ' + 'word '.repeat(26) + 'ends.';
  ck('a prose sentence over 25 words is long', rules(long).includes('long-sentence'), true);
  ck('a 24-word prose sentence is not', rules('This ' + 'word '.repeat(22) + 'ends.').includes('long-sentence'), false);
  ck('a LIST item over 20 words is long', rules('- Run ' + 'word '.repeat(21) + 'now.').includes('long-sentence'), true);
  /* An IMPERATIVE is a procedure by the spec, so the 20-word cap applies even outside a list — the
     first draft of this case expected 21 words to pass and the tool was right to flag it. */
  ck('an imperative at 21 words is long even outside a list', rules('Run ' + 'word '.repeat(19) + 'now.').includes('long-sentence'), true);
  ck('…and a NON-imperative prose sentence at 21 words is not', rules('The tool ' + 'word '.repeat(18) + 'ends.').includes('long-sentence'), false);
  ck('passive is reported', rules('The value was measured by the tool.').includes('passive'), true);
  ck('active is not', rules('The tool measured the value.').includes('passive'), false);
  ck('two imperatives in one sentence are reported', rules('Run the gate and read the log.').includes('two-imperatives'), true);
  ck('a verb-noun is reported', rules('The stamping of the fixture failed.').includes('verb-noun'), true);
  ck('a technical name ending in -ing is NOT a verb-noun', rules('The oxydex reading is null.', G).includes('verb-noun'), false);
  ck('a retired term is reported with its approved form', findings('It is a proxy for the truth.', G).find((x) => x.rule === 'retired-term').detail, '"proxy" → "measured value"');
  /* 🔴 THE SKIPS. A checker that flags the wrong span teaches people to ignore it. */
  ck('fenced code is skipped', rules('```\n' + long + '\n```').length, 0);
  ck('a table row is skipped', rules('| ' + long + ' |').length, 0);
  ck('a quoted log line is skipped', rules('> ' + long).length, 0);
  ck('an indented code block is skipped', rules('    ' + long).length, 0);
  ck('a heading is skipped', rules('# ' + long).length, 0);
  ck('a long URL is not a long sentence', rules('See URL at https://example.com/' + 'x'.repeat(300) + ' now.').includes('long-sentence'), false);
  ck('inline code does not pad the count', rules('The `' + 'x '.repeat(40) + '` is fine.').includes('long-sentence'), false);
  ck('a paragraph over six sentences is reported', rules('A one. B two. C three. D four. E five. F six. G seven.').includes('long-paragraph'), true);
  ck('six sentences are not', rules('A one. B two. C three. D four. E five. F six.').includes('long-paragraph'), false);
  /* §∅ and §🧾 on the verdict's own shape. */
  ck('the verdict is NOT_APPLICABLE while advisory, never PASS over findings', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3).status, 'NOT_APPLICABLE');
  ck('…and it carries the count', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3).result.findings, 1);
  ck('the glossary reader survives an absent file', readGlossary('/nonexistent').retired.size, 0);
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
