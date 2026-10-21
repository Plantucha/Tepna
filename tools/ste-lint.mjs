// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/ste-lint.mjs — the writing rules, checked

       node tools/ste-lint.mjs <file.md>        # exit 1 on any finding
       node tools/ste-lint.mjs - < body.md      # a PR body on stdin
       node tools/ste-lint.mjs <file> --json    # the verdict alone
       node tools/ste-lint.mjs <file> --advisory # report only, exit 0 (a backlog sweep)
       node tools/ste-lint.mjs --selftest
       node tools/ste-lint.mjs --verdict-sample

   The rules come from ASD-STE100 (Simplified Technical English), Issue 8, 2021.

   ⚠️ WE ADOPT THE RULES, NOT THE DICTIONARY. ASD's approved-word list is
   copyrighted and is NOT copied here or anywhere in this repo. The approved-word
   layer is OURS: `docs/GLOSSARY.md`, seeded from terms this repo already uses and
   picked by COUNT, not by taste.

   Each finding names the line, and each finding is a defect: the tool exits 1 on
   any finding (owner ruling 2026-10-12, "make it bite"; it was advisory from
   2026-10-11). `--advisory` keeps the report and exits 0, for a sweep over a
   backlog nobody has been asked to clear. `tools/pr-compliance.mjs` runs the
   strict form over every PR body, so a red here is a red `test` context.

   WHAT IT SKIPS, AND WHY EACH SKIP IS LOAD-BEARING. A checker that flags the
   wrong spans teaches people to ignore it:
     · fenced code and indented code — not prose;
     · tables — cells are labels, not sentences;
     · quoted log lines and command output — someone else's words, and we must
       not rewrite evidence;
     · URLs and inline code — a long identifier is not a long sentence;
     · citations (author, year, DOI) — the form is fixed by the source;
     · a PR body's `Rule 0:` evidence line and its `Fleet-Session:` trailer — a
       query plus its hits is a list, not a sentence, and the gate reads both by form.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

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
    /* `| approved | retired, retired | note |` and `| \`name\`, \`name\` | technical name | … |`. The first
       cell is read WHOLE and split on commas: the earlier reader stopped at the first backtick, so
       every multi-name technical row (the nodes, the devices, the module globals) registered
       nothing — measured 2026-10-12, when the set held two names out of twenty-seven. */
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*)\|/);
    if (!m) continue;
    const names = m[1]
      .split(',')
      .map((x) => x.replace(/[`*]/g, '').trim())
      .filter(Boolean);
    const approved = names[0] || '';
    const second = m[2].trim();
    /* The table's own HEADER and separator are not entries. Without this the file that DEFINES the
       retired words reports them as uses — measured on the first run of this tool against its own
       glossary, which is the cheapest possible proof that a definition is not a use. */
    if (/^(approved|name|term)$/i.test(approved) || /^[-: ]+$/.test(approved) || /^(retired|kind)$/i.test(second)) continue;
    if (/technical name/i.test(second)) {
      for (const n of names) out.technical.add(n.toLowerCase());
      continue;
    }
    for (const r of second.split(/[,;]/)) {
      const t = r.trim().replace(/^`|`$/g, '');
      if (t && t !== '—' && !/^\*+$/.test(t)) out.retired.set(t.toLowerCase(), approved);
    }
  }
  return out;
}

/**
 * The population, measured. `checked` is the prose the rules ran over, `excluded` is every OTHER
 * non-blank line — a table row, a quote, a heading, a fence and its contents, indented code, a
 * citation line, the `Rule 0:` line, the trailer, and a line that is nothing but inline code.
 *
 * WHY THIS IS COUNTED. Before it was, a target whose prose all sat in table cells reported
 * `0 finding(s) over 0 prose line(s)` with `excluded: 0` beside it, which reads as a clean run of a
 * clean file. `briefs/RESIDUE.md` is the case that made it matter: 559 of its rows hold 148,443
 * words and the 45 lines outside the table hold 724, so the verdict judged the preamble. The skip
 * itself is deliberate and stays — cells are labels in `DOCS-INDEX.md`, whatever they hold here.
 * What was wrong is an object that did not say so. §🧾 forbids a PASS over nothing examined; this
 * makes `checked + excluded = eligible` carry the rest.
 *
 * Returns { prose: [{ n, text, procedure }], checked, excluded, eligible }.
 */
export function scan(src) {
  const out = [];
  let excluded = 0;
  let fence = false;
  const lines = src.split('\n');
  /* YAML FRONTMATTER at the top of a file is metadata, not prose: a changeset's `bump:` and a skill's
     `name:` and `description:`. A skill's description is one long line by design, because the harness
     matches a task against it; the first sweep of the skills read each one as a 40-word sentence. */
  const front = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i <= front) {
      if (raw.trim()) excluded += 1;
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      excluded += 1;
      continue;
    }
    if (fence) {
      if (raw.trim()) excluded += 1;
      continue;
    }
    if (!raw.trim()) continue; // a blank line is not in the population at all
    if (/^\s{4,}\S/.test(raw)) {
      excluded += 1;
      continue;
    } // indented code
    if (/^\s*\|/.test(raw)) {
      excluded += 1;
      continue;
    } // table row
    if (/^\s*>/.test(raw)) {
      excluded += 1;
      continue;
    } // quoted text — someone else's words
    /* `--!>` also closes an HTML comment, and matching only `-->` left the line after one
       unskipped. CodeQL flagged it (high) and it was right: an incomplete end-tag match. */
    if (/^\s*(?:#|<!--|--!?>|\[\^)/.test(raw)) {
      excluded += 1;
      continue;
    } // heading, comment, footnote
    if (/\bdoi:|https?:\/\/\S+\s*$/i.test(raw) && raw.trim().split(/\s+/).length < 14) {
      excluded += 1;
      continue;
    } // a citation line
    if (/^(?:Rule 0:|Fleet-Session:)/.test(raw)) {
      excluded += 1;
      continue;
    } // a PR body's evidence line and trailer — read by form, not prose
    let text = raw
      .replace(/`[^`]*`/g, 'CODE')
      .replace(/https?:\/\/\S+/g, 'URL')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    if (!text.trim()) {
      excluded += 1;
      continue;
    }
    const procedure = /^\s*(?:[-*+]|\d+\.)\s/.test(raw);
    out.push({ n: i + 1, text: text.trim(), procedure });
  }
  return { prose: out, checked: out.length, excluded, eligible: out.length + excluded };
}

/** The prose alone. Kept at its old signature and return shape: every caller of it predates `scan`. */
export function proseLines(src) {
  return scan(src).prose;
}

export function sentences(text) {
  return text
    .split(/(?<=[.!?][*_`"')\]]*)\s+(?=[A-Z(§`"'0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s) =>
  s
    .replace(/[—·|]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));

/* Passive: a form of "to be" plus a past participle. A heuristic, and it says so. */
const PASSIVE = /\b(is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?([a-z]+(?:ed|en))\b/g;
/* Words the PASSIVE shape matches that are not participles. Measured on 2026-10-12 over the 767 tracked
   Markdown files: "is green" 87, "is open" 41, "is then" 47, "is when" 7, "is often" 6 and "is even" 4
   all read as passive, and none of them is a verb. */
export const NOT_PARTICIPLE = new Set(['green', 'open', 'then', 'when', 'often', 'even', 'ten', 'seven', 'eleven', 'between', 'screen', 'token', 'oxygen', 'hyphen', 'sudden', 'golden']);
/* `un-` plus a participle is a state, not an action: "the file is unchanged" names no actor because it
   has none. Measured: unchanged 131, untouched 89, unaffected 68. A real verb that starts with `un-`
   stays passive, and this list names those verbs. */
const UN_VERB = /^un(?:block|lock|pack|load|mount|wrap|install|stage|do|set|pin|link|zip|register|subscribe|ify)/;
function passiveMatch(s) {
  for (const m of s.matchAll(PASSIVE)) {
    const w = m[2];
    if (NOT_PARTICIPLE.has(w)) continue;
    if (w.startsWith('un') && !UN_VERB.test(w)) continue;
    return m[0];
  }
  return null;
}
/* -ing words that are plain NOUNS, not a verb used as a noun. Measured on 2026-10-12: sibling 25,
   ceiling 21, morning 11, and "meaning" in the first draft of the report that sized this backlog. */
export const NOUN_ING = new Set(['sibling', 'ceiling', 'morning', 'evening', 'meaning', 'warning', 'nothing', 'something', 'anything', 'everything', 'thing', 'string', 'during']);
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
      const p = passiveMatch(s);
      if (p) add(n, 'passive', `"${p}"`);
      /* More than one imperative in a sentence: one instruction per sentence. The SECOND one is
         lowercase and follows a joiner, so a case-sensitive scan of the leading form misses it —
         which is what the planted case caught. A bare case-insensitive scan would instead match the
         NOUN in "a dry run", so the joiner is required. */
      if (IMPERATIVE_HEAD.test(s) && JOINED_IMPERATIVE.test(s)) add(n, 'two-imperatives', `"${s.match(JOINED_IMPERATIVE)[0].trim()}"`);
      for (const m of s.matchAll(/\b([a-z][a-z-]{3,}ing)\b/g)) {
        const t = m[1];
        if (TECHNICAL_NAME.test(t) || glossary.technical.has(t) || NOUN_ING.has(t)) continue;
        /* A verb-noun only when it heads a noun phrase: "the <x>ing of", "a <x>ing". The END OF A LINE is
           not the end of a phrase: a hard-wrapped line that stops at "the existing" goes on with its
           noun on the next line. Measured: existing 38, missing 15 and coupling 10 were mostly that. */
        /* The verb-noun shape is a DETERMINER, the -ing word, and then no noun: "the stamping of",
           "a reading." — not "the writing rules", where -ing modifies a following noun. */
        if (new RegExp(`\\b(?:the|a|an|this|its|their)\\s+${t}(?=\\s+(?:of|is|was|has|had)\\b|[,.;:)])`, 'i').test(s)) add(n, 'verb-noun', t);
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
    /* The lines are JOINED before the count. Counted line by line, a hard-wrapped sentence counted once
       per line, so a six-line paragraph of three sentences read as seven (write-in-ste skill, measured
       2026-10-12). Joined, a sentence is a sentence wherever the line breaks. */
    const count = sentences(para.map((l) => l.text).join(' ')).length;
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

export function verdictFor(label, f, lineCount, { advisory = false, excluded = 0 } = {}) {
  const byRule = {};
  for (const x of f) byRule[x.rule] = (byRule[x.rule] || 0) + 1;
  const summary = Object.keys(byRule)
    .sort()
    .map((k) => `${k} ${byRule[k]}`)
    .join(', ');
  /* The rule BINDS (owner, 2026-10-12): a finding is FAIL, none over prose is PASS. Two refusals
     stay: `--advisory` is NOT_APPLICABLE with the count beside it — never PASS over findings, never
     FAIL on a backlog nobody was asked to clear — and a target with no prose line is NOT_RUN,
     because PASS over nothing examined is the §🧾 invalid object. */
  let status = 'PASS';
  let reason = null;
  if (advisory) {
    status = 'NOT_APPLICABLE';
    reason = `advisory — ${f.length} finding(s); the rule is not armed on this run (--advisory)`;
  } else if (lineCount === 0) {
    status = 'NOT_RUN';
    reason = excluded ? `no prose line examined — all ${excluded} non-blank line(s) are table rows, quotes, headings, code or form lines` : 'no prose line examined';
  } else if (f.length) {
    status = 'FAIL';
    reason = `${f.length} finding(s): ${summary}`;
  }
  return Verdict.make({
    gate: 'ste-lint',
    scope: 'internal',
    status,
    /* `excluded` defaults to 0 so the old three-argument call still produces a valid object, and
       every caller in this repo now passes it. §🧾: checked + excluded = eligible. */
    population: { checked: lineCount, eligible: lineCount + excluded, excluded },
    criterion: { name: 'ste_findings', threshold: 0, unit: 'findings', direction: 'lte' },
    result: { target: label, findings: f.length, byRule },
    evidence: ['tools/ste-lint.mjs', 'docs/GLOSSARY.md'],
    reason,
    producedBy: { tool: 'tools/ste-lint.mjs', commit: gitCommit() }
  });
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--advisory', '--json', '--verdict-sample', '--selftest', '--strict'], positional: true, stdin: true }, { tool: 'ste-lint' });
  const target = argv.find((a) => !a.startsWith('-')) || (argv.includes('-') ? '-' : null);
  if (!target) {
    console.error('usage: node tools/ste-lint.mjs <file.md|-> [--json] [--advisory]');
    process.exit(2);
  }
  const src = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
  const g = readGlossary();
  const f = findings(src, g);
  const pop = scan(src);
  const lineCount = pop.checked;
  const advisory = argv.includes('--advisory');
  const v = verdictFor(target === '-' ? '<stdin>' : target, f, lineCount, { advisory, excluded: pop.excluded });
  console.log(JSON.stringify(v));
  if (!argv.includes('--json')) {
    /* The skipped count is printed BESIDE the finding count, because a reader who sees only
       "0 finding(s) over 0 prose line(s)" reads a pass. */
    const skipped = pop.excluded ? `, ${pop.excluded} of ${pop.eligible} line(s) not prose` : '';
    console.log(`\n▸ ${target}: ${f.length} finding(s) over ${lineCount} prose line(s)${skipped}`);
    const byRule = v.result.byRule;
    for (const k of Object.keys(byRule).sort()) console.log(`   ${String(byRule[k]).padStart(4)}  ${k}`);
    for (const x of f.slice(0, 25)) console.log(`   ${target}:${x.line}  ${x.rule} — ${x.detail}`);
    if (f.length > 25) console.log(`   … and ${f.length - 25} more`);
  }
  /* `--strict` is accepted and means nothing: strict is the default now. */
  process.exit(!advisory && f.length ? 1 : 0);
}

const DIRECT = isCliEntry(import.meta.url);

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
  /* 🔴 THE FALSE POSITIVES, measured over the 767 tracked Markdown files on 2026-10-12. Each word had
     its own count; each has its own case, and a real passive and a real verb-noun stay reported. */
  for (const w of ['green', 'open', 'then', 'often', 'even']) ck(`"is ${w}" is not passive`, rules(`The check is ${w} now.`).includes('passive'), false);
  for (const w of ['unchanged', 'untouched', 'unaffected', 'unmeasured']) ck(`"is ${w}" is a state, not passive`, rules(`The file is ${w} here.`).includes('passive'), false);
  ck('…but "is unblocked" is a real passive', rules('The queue is unblocked by the walker.').includes('passive'), true);
  ck('…and a sentence with a state AND a passive still reports the passive', rules('The file is unchanged and the row was written.').includes('passive'), true);
  for (const w of ['sibling', 'ceiling', 'morning', 'meaning', 'warning']) ck(`"the ${w}." is a noun, not a verb-noun`, rules(`It reads the ${w}.`).includes('verb-noun'), false);
  ck('a line that ends on "the existing" is a hard wrap, not a verb-noun', rules('It anchors to the existing\nvalue in the table.').includes('verb-noun'), false);
  ck('…and "the stamping." at a sentence end is still a verb-noun', rules('It failed at the stamping.').includes('verb-noun'), true);
  ck(
    'a hard-wrapped paragraph of three sentences is not long',
    rules('The first sentence runs\nonto a second line here. The second\nsentence does too. The third\nsentence is\nshort\nand wraps.').includes('long-paragraph'),
    false
  );
  ck('…and seven real sentences on seven lines still are', rules('One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nSeven.').includes('long-paragraph'), true);
  /* 🔴 THE SKIPS. A checker that flags the wrong span teaches people to ignore it. */
  ck('YAML frontmatter is skipped', rules('---\nname: x\ndescription: ' + long + '\n---\n\nShort body.').length, 0);
  ck('…but a rule line later in the file is not frontmatter', rules('Short body.\n\n---\n\n' + long).includes('long-sentence'), true);

  ck('fenced code is skipped', rules('```\n' + long + '\n```').length, 0);
  ck('a table row is skipped', rules('| ' + long + ' |').length, 0);
  ck('a quoted log line is skipped', rules('> ' + long).length, 0);
  ck('an indented code block is skipped', rules('    ' + long).length, 0);
  ck('a heading is skipped', rules('# ' + long).length, 0);
  ck('a Rule 0 evidence line is skipped', rules('Rule 0: ' + long).length, 0);
  ck('…and a Fleet-Session trailer too', rules('Fleet-Session: Kestrel (relay: ' + long + ')').length, 0);
  ck('…but a sentence that merely mentions Rule 0 is prose', rules('The ' + long.replace('This', 'Rule 0 line')).includes('long-sentence'), true);
  /* 🔴 CodeQL (high) caught this one: `--!>` also closes an HTML comment, and matching only `-->`
     left the line after such a comment unskipped. Planted in both forms. */
  ck('an HTML comment closed with --> is skipped', rules('--> ' + long).length, 0);
  ck('…and one closed with --!> is skipped too', rules('--!> ' + long).length, 0);
  ck('a long URL is not a long sentence', rules('See URL at https://example.com/' + 'x'.repeat(300) + ' now.').includes('long-sentence'), false);
  ck('inline code does not pad the count', rules('The `' + 'x '.repeat(40) + '` is fine.').includes('long-sentence'), false);
  ck('a paragraph over six sentences is reported', rules('A one. B two. C three. D four. E five. F six. G seven.').includes('long-paragraph'), true);
  ck('six sentences are not', rules('A one. B two. C three. D four. E five. F six.').includes('long-paragraph'), false);
  /* §∅ and §🧾 on the verdict's own shape. */
  ck('a finding is FAIL — the rule binds (owner, 2026-10-12)', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3).status, 'FAIL');
  ck('…and the FAIL names the rule in its reason', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3).reason, '1 finding(s): passive 1');
  ck('no finding over prose is PASS', verdictFor('x', [], 3).status, 'PASS');
  ck('no prose line examined is NOT_RUN, never PASS over nothing', verdictFor('x', [], 0).status, 'NOT_RUN');
  ck('--advisory is NOT_APPLICABLE, never PASS over findings', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3, { advisory: true }).status, 'NOT_APPLICABLE');
  ck('…and it carries the count', verdictFor('x', [{ line: 1, rule: 'passive', detail: '' }], 3).result.findings, 1);
  /* THE POPULATION — what the gate did NOT read (2026-10-12). Before `scan` counted it, every
     verdict said `excluded: 0`, so a target whose prose sits in table cells reported
     "0 finding(s) over 0 prose line(s)" with an object that claimed it had read the whole file. */
  ck('a table-only target reports what it skipped', scan('| a | b |\n|---|---|\n| c | d |'), {
    prose: [],
    checked: 0,
    excluded: 3,
    eligible: 3
  });
  ck('…and the verdict over it is NOT_RUN with the skipped count', verdictFor('x', [], 0, { excluded: 3 }).population, {
    checked: 0,
    eligible: 3,
    excluded: 3
  });
  ck('…and its reason names them', /all 3 non-blank line/.test(verdictFor('x', [], 0, { excluded: 3 }).reason), true);
  ck('a blank line is in NO population', scan('The tool ran.\n\n\nThe gate passed.'), {
    prose: [
      { n: 1, text: 'The tool ran.', procedure: false },
      { n: 4, text: 'The gate passed.', procedure: false }
    ],
    checked: 2,
    excluded: 0,
    eligible: 2
  });
  ck('a fence counts its delimiters and its contents', scan('```\nx = 1\n```').excluded, 3);
  /* A line of nothing but inline code IS examined, because the stripper leaves the token `CODE`
     behind — measured, after this test first asserted the opposite. A line that strips to NOTHING,
     such as a bare link, is the one that leaves the prose set, and it is counted. */
  ck('a line of only inline code is examined as one word', scan('`npm run check`').prose[0].text, 'CODE');
  ck('a line that strips to nothing is excluded', scan('[](https://example.com)').checked, 0);
  ck('…and it is counted', scan('[](https://example.com)').excluded, 1);
  ck('proseLines keeps its old return shape', proseLines('The tool ran.'), [{ n: 1, text: 'The tool ran.', procedure: false }]);
  ck('the three-argument verdict still makes a valid object', verdictFor('x', [], 3).population, { checked: 3, eligible: 3, excluded: 0 });
  /* #3480's BODY, the case that opened this. Its prose lines are VERBATIM from the merged body; its
     table rows are abbreviated, because the skip is by form and the cell content cannot change it.
     The whole 42-line body measures `checked: 4, excluded: 24, eligible: 28` on 117f8427, and the
     old tool reported `checked: 4, eligible: 4, excluded: 0` over it — a PASS that named 4 lines as
     the entire population of a 28-line body. Check 6 caught that body's `fixed #3476` because it
     reads the raw text; the writing rules never reached the 17 rows. */
  {
    const pr3480 = [
      'Rule 0: `node tools/doc-search.mjs --read "residue-only PR sequencing"` → `ext:memory/osprey-state-2026-10-05.md` (0.033).',
      '',
      'RESIDUE-only, by the stopgap. `briefs/RESIDUE.md` is the one file this PR touches. Skills: `residue-row` for the row shape and the closed vocabulary, `worktree-to-pr` for the branch and this body.',
      '',
      '## 1 · Two closures against #3476, each verified by content',
      '',
      '| key | why it closes |',
      '|---|---|',
      '| `2026-09-22-link-sidecar-is-box-wide-not-per-device` | one tag list |',
      '| `2026-09-23-a-journal-that-is-almost-entirely-one-line-is-reported-by-nothing` | measured |',
      '',
      "Both state cells now read `fixed #3476`. #3476 sits ahead of this PR in the walker's order, so that citation lands first.",
      '',
      'The ledger permits only a state cell to change. A measurement about a row cannot go into that row, so each of these appends instead.',
      '',
      'Fleet-Session: Osprey'
    ].join('\n');
    const pop = scan(pr3480);
    ck('#3480 body: the prose lines are examined', pop.checked, 3);
    ck('…and the 7 form lines are counted, not forgotten', pop.excluded, 7);
    ck('…so the population adds up (§🧾 checked + excluded = eligible)', pop.checked + pop.excluded === pop.eligible, true);
    const v = verdictFor('pr3480', findings(pr3480, G), pop.checked, { excluded: pop.excluded });
    ck('…and the verdict no longer calls 3 lines the whole body', v.population.eligible === v.population.checked, false);
    ck('…while the body itself still passes the rules it was written to', v.status, 'PASS');
  }
  /* 🔴 A TERMINATOR INSIDE A MARKDOWN CLOSE. `**One … ten.** Eleven …` never split, because the splitter
     wanted whitespace right after the `.`. The minimal pair below is the same ten and fourteen words,
     bold and plain: the bold line read 24 words, the plain line read 10 and 14. */
  const ten = 'One two three four five six seven eight nine ten.';
  const fourteen = 'Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour.';
  ck('a plain pair of sentences splits in two', sentences(`${ten} ${fourteen}`).length, 2);
  ck('…and the SAME pair with the first one in bold splits in two', sentences(`**${ten}** ${fourteen}`).length, 2);
  ck('…and the bold list item is not a long sentence', rules(`- **${ten}** ${fourteen}`).includes('long-sentence'), false);
  ck('…and the plain list item is not either', rules(`- ${ten} ${fourteen}`).includes('long-sentence'), false);
  for (const [n, a] of [
    ['an underscore', '_Two words._'],
    ['a bracket', '[Two words.]'],
    ['a paren', '(Two words.)'],
    ['a quote', '"Two words."'],
    ['a backtick', '`Two words.`']
  ])
    ck(`a terminator inside ${n} close still splits`, sentences(`${a} Three words here.`).length, 2);
  ck('…and a sentence with no terminator is still one', sentences('**Two words** three words here').length, 1);
  ck('the glossary reader survives an absent file', readGlossary('/nonexistent').retired.size, 0);
  /* A multi-name technical row registers EVERY name — the defect measured 2026-10-12. */
  {
    const dir = mkdtempSync(join(tmpdir(), 'ste-gloss-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/GLOSSARY.md'), '| approved | retired | note |\n|---|---|---|\n| `measured value` | proxy | x |\n| `OxyDex`, `H10` | technical name — two |\n');
    const g2 = readGlossary(dir);
    ck('a two-name technical row registers both names', [...g2.technical].sort(), ['h10', 'oxydex']);
    ck('…and the retired row beside it still reads', g2.retired.get('proxy'), 'measured value');
  }
  console.log(bad ? `  ✗ ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
