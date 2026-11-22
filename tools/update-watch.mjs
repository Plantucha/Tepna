/**
 * tools/update-watch.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * UPDATE WATCH — compare the software the fleet runs on this machine with its latest release, and
 * hand each update that is READY to a session as a prompt on the agent board (owner, 2026-11-05:
 * "make script that is checking software update and prompts ai to update if it's ready").
 *
 * ⚠️ PRIMARY DEV MACHINE ONLY, like `tools/doc-search.mjs`. It reads local binaries and the network.
 * CI and fresh clones run `--selftest` only. Nothing may gate on a live run.
 *
 * READY means three things, all measured:
 *   1. the latest release differs from the installed one;
 *   2. the release is at least `soakDays` old (a release yanked in its first days never reaches us);
 *   3. it is not a pre-release, unless the source's channel IS pre-releases (xerj ships rc builds).
 * A source whose release date the registry does not give (an Ollama model tag) soaks from the day
 * this tool FIRST SAW the new digest, kept in the state file. An unknown age is never read as old.
 *
 * The tool updates NOTHING. `--notify` posts one prompt per ready update to the board, once per
 * version, addressed to the coordinator. The prompt names the update path, the quiet condition to
 * check first, and whether the step needs the owner (sudo, or a model change that invalidates a cache).
 *
 *   node tools/update-watch.mjs              # the table + the tepna.verdict/1 object
 *   node tools/update-watch.mjs --notify     # …and post each new ready update to the board
 *   node tools/update-watch.mjs --json       # the verdict object and every row
 *   node tools/update-watch.mjs --selftest   # pure checks, no network
 *   node tools/update-watch.mjs --verdict-sample
 * Installed as `tools/systemd/tepna-update-watch.{service,timer}` (daily).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { boundedFetch } from './net-bound.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const TOOL = 'tools/update-watch.mjs';
const DAY = 86400000;
// The owner-installed root wrapper (tools/systemd/tepna-update + its sudoers drop-in). When it is
// present, a session runs the two sudo-bound updates itself with `sudo -n`; when it is absent, they go to the owner.
const WRAP = '/usr/local/sbin/tepna-update';
const HAS_WRAP = existsSync(WRAP);

/* ── pure helpers ─────────────────────────────────────────────────────────────────────────── */

/** `v1.0.0-rc.101`, `xerj v1.0.0-rc.101`, `2.1.300 (Claude Code)` → the bare version, or null. */
export function normVersion(s) {
  const m = String(s ?? '').match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
}

/** SemVer order of two version strings: -1, 0 or 1, or null when either is not a version (a model digest).
 * A pre-release sorts below its release; dot-separated pre-release parts compare numerically when both are digits. */
export function compareVersions(a, b) {
  const pa = normVersion(a);
  const pb = normVersion(b);
  if (pa == null || pb == null) return null;
  const [ca, prea] = pa.split('+')[0].split(/-(.*)/s);
  const [cb, preb] = pb.split('+')[0].split(/-(.*)/s);
  const na = ca.split('.').map(Number);
  const nb = cb.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] < nb[i] ? -1 : 1;
  if (!prea && !preb) return 0;
  if (!prea) return 1;
  if (!preb) return -1;
  const xa = prea.split('.');
  const xb = preb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const da = /^\d+$/.test(xa[i]);
    const db = /^\d+$/.test(xb[i]);
    if (da && db && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) < Number(xb[i]) ? -1 : 1;
    if (da !== db) return da ? -1 : 1;
    if (!da && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/* ── the licence table's local-tool rows ──────────────────────────────────────────────────── */

/** The heading of the `THIRD-PARTY.md` table that records the local search stack. */
export const LOCAL_TABLE_HEADING = '### Local search and local models';

/** Each local-tool row of that table against the source that reads its installed side. A row whose
 * cell pins no version — a model, which the runtime tags — cannot rot, so it sits here for COVERAGE
 * alone: a row this list does not name, and a name no source reads, are each a finding of their own. */
export const DOC_ROWS = [
  { label: 'xerj', source: 'xerj' },
  { label: 'the local model runtime (ollama)', source: 'ollama' },
  { label: 'bge-m3', source: 'model bge-m3:latest' },
  { label: 'qwen3-coder:30b', source: 'model qwen3-coder:30b' },
  { label: 'qwen3.8:27b', source: 'model qwen3.8:27b' }
];

/** Emphasis and code ticks off a table cell, so a label reads as its plain text. */
const plainCell = (c) =>
  String(c ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The leading version token of a version cell, or null when the cell pins no version. */
export function recordedVersion(cell) {
  const head = plainCell(cell).split(' (')[0].trim();
  return /^v?\d+\.\d+\.\d+/.test(head) ? normVersion(head) : null;
}

/** The local-tool rows of `THIRD-PARTY.md`, as `{ label, recorded, cell }`. Pure.
 * An absent heading answers null rather than an empty set: the table moved, and a read of the wrong
 * table reports nothing true about this one. */
export function parseLocalToolRows(md) {
  const at = String(md ?? '').indexOf(LOCAL_TABLE_HEADING);
  if (at === -1) return null;
  const rest = String(md).slice(at + LOCAL_TABLE_HEADING.length);
  const stop = rest.indexOf('\n#');
  const rows = [];
  for (const line of (stop === -1 ? rest : rest.slice(0, stop)).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    const label = plainCell(cells[0]);
    if (label === 'tool' || /^-+$/.test(label)) continue;
    rows.push({ label, recorded: recordedVersion(cells[1]), cell: plainCell(cells[1]) });
  }
  return rows;
}

/** Findings over that table: a pinned version the box no longer runs, a tracked tool with no row, and
 * a row no source reads. An unread install is never a finding, because an absence is not a drift. */
export function docDrift(docRows, installedByName) {
  if (docRows === null) return [{ label: LOCAL_TABLE_HEADING, kind: 'table absent', recorded: null, installed: null }];
  const findings = [];
  for (const m of DOC_ROWS) {
    const row = docRows.find((r) => r.label === m.label);
    const installed = installedByName[m.source] ?? null;
    if (!row) {
      findings.push({ label: m.label, kind: 'no row', recorded: null, installed });
      continue;
    }
    if (row.recorded === null || installed === null) continue;
    const order = compareVersions(row.recorded, installed);
    if (order !== null && order !== 0) findings.push({ label: m.label, kind: 'drift', recorded: row.recorded, installed });
  }
  for (const r of docRows) if (!DOC_ROWS.some((m) => m.label === r.label)) findings.push({ label: r.label, kind: 'untracked row', recorded: r.recorded, installed: null });
  return findings;
}

/** The board prompt for one drift finding. The licence is read at a version, so a restamp reads it. */
export function driftText(f) {
  const head = `The licence table and the box disagree about **${f.label}** (${f.kind}).`;
  const body =
    f.kind === 'drift'
      ? `\`THIRD-PARTY.md\` records ${f.recorded} and the box runs ${f.installed}.`
      : f.kind === 'no row'
        ? 'This tool reads its installed side, and the table names it nowhere.'
        : 'The table names it, and no source here reads its installed side.';
  return [
    `UPDATE-WATCH · licence table drift: ${f.label}`,
    '',
    head,
    body,
    '',
    'A session takes this as one small unit:',
    `1. Read the licence at the version the box runs, and confirm it is the one the row states.`,
    '2. Restamp the row with that version and the date it was read.',
    `3. Add or drop the mapping in \`DOC_ROWS\` when the row itself is the finding.`,
    '',
    'Fleet-Session: update-watch'
  ].join('\n');
}

/** The readiness rule above. `publishedMs` null → soak from `firstSeenMs`; both null → not ready. */
export function readiness({ installed, latest, publishedMs, firstSeenMs, prerelease, allowPre, soakDays, nowMs }) {
  if (installed == null || latest == null) return { ready: false, why: 'unread' };
  if (installed === latest) return { ready: false, why: 'current' };
  // A registry's "latest" can trail the install (2026-11-06: `claude update` installed 2.1.319 while npm's
  // latest tag still read 2.1.318, and the watch offered the downgrade as READY). Only a NEWER release is an update.
  const order = compareVersions(installed, latest);
  if (order === 0) return { ready: false, why: 'current' };
  if (order === 1) return { ready: false, why: 'installed is newer' };
  if (prerelease && !allowPre) return { ready: false, why: 'pre-release' };
  const since = publishedMs ?? firstSeenMs;
  if (since == null) return { ready: false, why: 'age unknown' };
  const ageDays = (nowMs - since) / DAY;
  if (ageDays < soakDays) return { ready: false, why: `soaking ${ageDays.toFixed(1)} of ${soakDays} d` };
  return { ready: true, why: `${ageDays.toFixed(1)} d old` };
}

/** The board prompt for one ready update. A session reads it as a task, so it states every step. */
export function promptText(row) {
  const lines = [
    `# UPDATE READY · ${row.name} ${row.installed} → ${row.latest}`,
    '',
    `The update watch found a release that has soaked ${row.why}. Released: ${row.published ?? 'date not given, soak counted from first sight'}.`,
    row.notes ? `Release notes: ${row.notes}` : null,
    '',
    row.owner ? `This update needs the owner: ${row.owner}. Send the owner the commands below. Do not run them.` : 'You may run this update yourself on this machine. Do not touch vigil.',
    '',
    '1. Read the release notes. Stop and report if they name a breaking change for our use.',
    `2. Check the quiet condition: ${row.quiet}.`,
    ...row.steps.map((s, i) => `${i + 3}. ${s}`),
    `${row.steps.length + 3}. Post the result on thread 6, with the version before and after.`,
    '',
    'Fleet-Session: update-watch'
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Each source names how to read both sides and how a session updates it. */
export const SOURCES = [
  {
    name: 'claude-code',
    installed: ['claude', ['--version']],
    latest: { npm: '@anthropic-ai/claude-code' },
    soakDays: 2,
    quiet: 'no session is mid-turn on a long gate (a restart of a session picks the new version)',
    steps: ['Run `claude update`.', 'Run `claude --version` and confirm the new version.'],
    owner: null
  },
  {
    name: 'xerj',
    installed: [join(homedir(), '.local/bin/xerj'), ['--version']],
    latest: { github: 'xerj-org/xerj', tagPrefix: 'v' },
    allowPre: true,
    soakDays: 1,
    quiet: 'no `xerj-load.mjs` runs (`pgrep -af xerj-load` lists nothing) and the nightly reload is not due within 30 min',
    steps: [
      'Download `xerj-<version>-x86_64-unknown-linux-gnu.tar.gz` and its `.sha256` with `gh release download`. Run `sha256sum -c`.',
      'Copy `~/.local/bin/xerj` to `~/.local/bin/xerj.<old>.bak`. Install the new binary in its place.',
      'Run `systemctl --user restart tepna-hybrid-index.service`.',
      'Confirm `curl -s localhost:9200/tepna-hybrid/_count` reads the count from before, and that a `doc-search` query answers from the hybrid lane.'
    ],
    owner: null
  },
  {
    name: 'ollama',
    installed: ['ollama', ['--version']],
    latest: { github: 'ollama/ollama', tagPrefix: 'v' },
    soakDays: 3,
    quiet: 'no mutation pipeline runs (`pgrep -af "[m]utate\\.mjs|[m]utation-crawl"` lists nothing) and no bge reindex tick runs',
    steps: [
      HAS_WRAP
        ? `Run \`sudo -n ${WRAP} ollama\`. It verifies the release checksums and restarts the service.`
        : 'The owner runs `curl -fsSL https://ollama.com/install.sh | sh` in a terminal. The service restarts.',
      'Confirm `ollama --version` and that `curl -s localhost:11434/api/tags` lists the same models.'
    ],
    owner: HAS_WRAP ? null : 'the system service lives in /usr/local/bin and restarts under sudo'
  },
  ...['qwen3-coder:30b', 'qwen3.8:27b'].map((model) => ({
    name: `model ${model}`,
    installed: { ollamaDigest: model },
    latest: { ollamaRegistry: model },
    soakDays: 3,
    quiet: 'no mutation pipeline runs and no board wrapper is mid-answer',
    steps: [`Run \`ollama pull ${model}\`.`, 'Run one short prompt against it and confirm it answers.'],
    owner: null
  })),
  {
    name: 'model bge-m3:latest',
    installed: { ollamaDigest: 'bge-m3:latest' },
    latest: { ollamaRegistry: 'bge-m3:latest' },
    soakDays: 3,
    quiet: 'no bge reindex tick runs',
    steps: [
      'Do not pull it. New weights change every vector, so the whole doc-search cache (~75,000 chunks) must be embedded again and the hybrid index rebuilt.',
      'Send the owner the size of that re-embed and ask for a time.'
    ],
    owner: 'a new embedding model invalidates the doc-search cache'
  },
  {
    name: 'gh',
    installed: ['gh', ['--version']],
    latest: { github: 'cli/cli', tagPrefix: 'v' },
    soakDays: 3,
    quiet: 'none',
    steps: [
      HAS_WRAP ? `Run \`sudo -n ${WRAP} apt\`. If it prints that a reboot is required, tell the owner. Do not reboot.` : 'Update `gh` through the package manager that installed it (`apt` uses sudo).'
    ],
    owner: HAS_WRAP ? null : 'the package manager runs under sudo'
  }
];

/* ── readers (network and local) ──────────────────────────────────────────────────────────── */

const run = (cmd, args, timeout = 20000) => execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });

async function readInstalled(src) {
  if (Array.isArray(src.installed)) return { version: normVersion(run(...src.installed)) };
  const tags = await (await boundedFetch('http://127.0.0.1:11434/api/tags', {}, { cls: 'api', label: 'the local ollama tag list' })).json();
  const m = (tags.models || []).find((x) => x.name === src.installed.ollamaDigest);
  return { version: m ? m.digest : null };
}

/* A row value is a version string, a digest or null. Coerce before measuring the length: a value of
   another shape used to throw here, and one unreadable row must never cost the whole table. */
const short = (v) => {
  if (v == null) return '—';
  const s = String(v);
  return s.length > 20 ? `${s.slice(0, 12)}…` : s;
};

/** `npm view <pkg> version --json` prints a bare string when one version matches and an ARRAY when
 * several do (measured 2026-11-21: `@anthropic-ai/claude-code` printed `["2.1.330"]`). Take the
 * newest member that reads as a version, or null when none does — never the printed value itself,
 * because every consumer below reads a version string, and an array reaching them is a crash. */
export function pickNpmVersion(printed) {
  const versions = (Array.isArray(printed) ? printed : [printed]).map((v) => normVersion(v)).filter((v) => v !== null);
  if (!versions.length) return null;
  return versions.reduce((best, v) => (compareVersions(best, v) === -1 ? v : best));
}

async function readLatest(src) {
  const l = src.latest;
  if (l.npm) {
    const time = JSON.parse(run('npm', ['view', l.npm, 'time', '--json'], 60000));
    const version = pickNpmVersion(JSON.parse(run('npm', ['view', l.npm, 'version', '--json'], 60000)));
    if (version === null) return { version: null };
    return { version, publishedMs: Date.parse(time[version]) || null, prerelease: /-/.test(version), notes: `https://www.npmjs.com/package/${l.npm}` };
  }
  if (l.github) {
    /* The newest release that is not a corpus pack or other non-version tag. On a stable channel a
       pre-release is skipped, so an rc published after the last stable release never hides that one
       (measured 2026-11-05: Ollama's newest was 0.40.15-rc2 beside a stable 0.40.14). `--jq` keeps
       the output small: cli/cli's release bodies overflowed the default buffer. */
    const rels = JSON.parse(run('gh', ['api', `repos/${l.github}/releases?per_page=30`, '--jq', '[.[]|{tag_name,published_at,prerelease,draft,html_url}]'], 60000));
    const rel = rels.find((r) => !r.draft && normVersion(r.tag_name) && r.tag_name.startsWith(l.tagPrefix) && (src.allowPre || !(r.prerelease || /-/.test(r.tag_name))));
    if (!rel) return { version: null };
    return { version: normVersion(rel.tag_name), publishedMs: Date.parse(rel.published_at) || null, prerelease: !!rel.prerelease || /-/.test(rel.tag_name), notes: rel.html_url };
  }
  const [name, tag = 'latest'] = l.ollamaRegistry.split(':');
  const r = await boundedFetch(
    `https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`,
    { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' } },
    { cls: 'api', label: 'the ollama registry manifest' }
  );
  if (!r.ok) return { version: null };
  return {
    version: createHash('sha256')
      .update(Buffer.from(await r.arrayBuffer()))
      .digest('hex'),
    publishedMs: null,
    prerelease: false,
    notes: `https://ollama.com/library/${name}`
  };
}

function statePath() {
  try {
    const common = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    return join(common, 'tepna-mutation', 'update-watch.json');
  } catch {
    return join(homedir(), '.local/state/tepna/update-watch.json');
  }
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────── */

function selftest() {
  let fails = 0;
  let n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) fails++;
    console.log(`  ${c ? '✓' : '✕'} ${m}`);
  };
  const now = Date.parse('2026-11-06T00:00:00Z');
  const base = { installed: '1.0.0', latest: '1.1.0', publishedMs: now - 5 * DAY, firstSeenMs: null, prerelease: false, allowPre: false, soakDays: 2, nowMs: now };
  ok(normVersion('xerj v1.0.0-rc.101') === '1.0.0-rc.101', 'a version reads out of a binary banner');
  ok(normVersion('2.1.300 (Claude Code)') === '2.1.300', 'a trailing product name is dropped');
  ok(normVersion('no version here') === null, 'no version reads null, never a default');
  ok(readiness(base).ready, 'a newer release past its soak is ready');
  ok(!readiness({ ...base, latest: '1.0.0' }).ready, 'the same version is not ready');
  ok(!readiness({ ...base, publishedMs: now - DAY }).ready, 'a release inside its soak is not ready');
  ok(!readiness({ ...base, prerelease: true }).ready, 'a pre-release is not ready on a stable channel');
  ok(readiness({ ...base, prerelease: true, allowPre: true }).ready, 'a pre-release is ready on a pre-release channel');
  ok(!readiness({ ...base, publishedMs: null }).ready, 'an unknown age is never read as old');
  ok(readiness({ ...base, publishedMs: null, firstSeenMs: now - 4 * DAY }).ready, 'an undated release soaks from first sight');
  ok(!readiness({ ...base, installed: null }).ready, 'an unread install is not ready');
  ok(!readiness({ ...base, installed: '2.1.319', latest: '2.1.318' }).ready, 'an older registry release is never ready (the 2.1.319 → 2.1.318 offer)');
  ok(readiness({ ...base, installed: '2.1.9', latest: '2.1.10' }).ready, 'versions compare by number, not as text');
  ok(compareVersions('0.5.0-rc.100', '0.5.0-rc.101') === -1, 'a pre-release number compares as a number');
  ok(compareVersions('0.40.15-rc2', '0.40.15') === -1, 'a pre-release sorts below its release');
  ok(compareVersions('sha256:abc', '1.0.0') === null, 'a digest is not a version');
  ok(pickNpmVersion('2.1.330') === '2.1.330', 'npm printing one version reads that version');
  ok(pickNpmVersion(['2.1.330']) === '2.1.330', 'npm printing a one-member array reads the member');
  ok(pickNpmVersion(['2.1.9', '2.1.10']) === '2.1.10', 'npm printing several versions reads the newest, by number');
  ok(pickNpmVersion([]) === null, 'npm printing nothing reads null, never a default');
  ok(pickNpmVersion(['latest']) === null, 'a member that is not a version reads null');
  ok(pickNpmVersion(null) === null, 'an absent version reads null');
  ok(typeof short(['2.1.330']) === 'string' && typeof short(null) === 'string', 'the table renders any row shape without throwing');
  ok(readiness({ ...base, installed: 'aaaa', latest: 'bbbb', publishedMs: null, firstSeenMs: now - 4 * DAY }).ready, 'two different digests still read as an update');
  const p = promptText({ name: 'x', installed: '1', latest: '2', why: '3 d old', published: 'd', notes: 'u', quiet: 'q', steps: ['s'], owner: 'sudo' });
  ok(p.includes('needs the owner') && p.includes('Do not run them'), 'an owner step tells the session not to run it');
  ok(/^4\. Post the result/m.test(p), 'the steps number on from the two fixed checks');
  ok(SOURCES.find((s) => s.name === 'model bge-m3:latest').owner, 'an embedding-model change always goes to the owner');

  /* the licence table's local-tool rows */
  const TBL = [
    `${LOCAL_TABLE_HEADING}`,
    '',
    '| tool | version or pin | licence |',
    '|---|---|---|',
    '| **xerj** | v1.0.0-rc.104 (licence read 2026-11-21) | Apache-2.0 |',
    "| **bge-m3** | the runtime's own tag | MIT |",
    '',
    '### the next section'
  ].join('\n');
  const parsed = parseLocalToolRows(TBL);
  ok(parsed.length === 2, 'the parser reads every row of the table and no header');
  ok(parsed[0].label === 'xerj' && parsed[0].recorded === '1.0.0-rc.104', 'a version cell reads its leading version, without the read date');
  ok(parsed[1].recorded === null, 'a cell that pins no version reads null, never a guessed version');
  ok(parseLocalToolRows('# a file with no such table') === null, 'an absent heading answers null, never an empty set');
  ok(docDrift(null, {})[0].kind === 'table absent', 'an absent table is itself one finding');
  ok(docDrift(parsed, { xerj: '1.0.0-rc.104' }).filter((f) => f.kind === 'drift').length === 0, 'a row that names the installed version does not drift');
  ok(docDrift(parsed, { xerj: '1.0.0-rc.105' }).filter((f) => f.kind === 'drift').length === 1, 'a row behind the box drifts');
  ok(docDrift(parsed, { xerj: null }).filter((f) => f.kind === 'drift').length === 0, 'an unread install is never a drift — an absence is not a number');
  ok(docDrift(parsed, { 'model bge-m3:latest': '790764642607' }).filter((f) => f.kind === 'drift').length === 0, 'a model digest never drifts against a row that pins no version');
  ok(docDrift(parsed, {}).filter((f) => f.kind === 'no row').length === 3, 'a tracked tool the table names nowhere is a finding');
  ok(
    docDrift([{ label: 'something else', recorded: null, cell: 'x' }, ...parsed], {}).some((f) => f.kind === 'untracked row'),
    'a row no source reads is a finding'
  );
  ok(driftText({ label: 'xerj', kind: 'drift', recorded: '1.0.0-rc.93', installed: '1.0.0-rc.104' }).includes('1.0.0-rc.93'), 'a drift prompt states the version the row records');
  /* COVERAGE over the REAL table, which is what keeps a new row from escaping the detector. */
  const realPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'THIRD-PARTY.md');
  if (existsSync(realPath)) {
    const real = parseLocalToolRows(readFileSync(realPath, 'utf8'));
    ok(real !== null && real.length > 0, 'the real table parses, so the heading above still names it');
    ok(
      real.every((r) => DOC_ROWS.some((m) => m.label === r.label)),
      'every row of the real table is named in DOC_ROWS'
    );
    ok(
      DOC_ROWS.every((m) => SOURCES.some((src) => src.name === m.source)),
      'every DOC_ROWS mapping names a source this tool reads'
    );
  }
  console.log(fails ? `\n${fails} of ${n} selftest(s) FAILED` : `\nall ${n} selftests passed`);
  process.exit(fails ? 1 : 0);
}

/* ── main ─────────────────────────────────────────────────────────────────────────────────── */

const CRITERION = { name: 'updates_ready', threshold: 0, unit: 'updates', direction: 'lte' };

if (flag('--selftest')) selftest();
if (flag('--verdict-sample')) {
  printVerdict(
    makeVerdict({
      gate: 'update-watch',
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: CRITERION,
      result: null,
      evidence: [TOOL],
      reason: 'a sample: no source was read',
      tool: TOOL,
      commit: null,
      commitReason: 'a --verdict-sample reads no tree'
    })
  );
  process.exit(0);
}

const nowMs = Date.now();
const SP = statePath();
const state = existsSync(SP) ? JSON.parse(readFileSync(SP, 'utf8')) : { firstSeen: {}, notified: {} };
const rows = [];
for (const src of SOURCES) {
  const row = { name: src.name, quiet: src.quiet, steps: src.steps, owner: src.owner };
  try {
    const [i, l] = await Promise.all([readInstalled(src), readLatest(src)]);
    row.installed = i.version;
    row.latest = l.version;
    row.notes = l.notes ?? null;
    row.published = l.publishedMs ? new Date(l.publishedMs).toISOString().slice(0, 10) : null;
    const key = `${src.name}@${l.version}`;
    if (l.version && l.version !== i.version && !state.firstSeen[key]) state.firstSeen[key] = nowMs;
    Object.assign(
      row,
      readiness({
        installed: i.version,
        latest: l.version,
        publishedMs: l.publishedMs,
        firstSeenMs: state.firstSeen[key] ?? null,
        prerelease: l.prerelease,
        allowPre: !!src.allowPre,
        soakDays: src.soakDays,
        nowMs
      })
    );
  } catch (e) {
    row.ready = false;
    row.why = 'unread';
    row.error = String(e.message || e)
      .split('\n')[0]
      .slice(0, 160);
  }
  rows.push(row);
}

if (!flag('--json')) {
  for (const r of rows)
    console.log(
      `  ${r.ready ? 'READY' : '     '}  ${r.name.padEnd(24)} ${short(r.installed).padEnd(16)} → ${short(r.latest).padEnd(16)} ${r.why}${r.owner ? ' · owner' : ''}${r.error ? ` · ${r.error}` : ''}`
    );
}

const installedByName = Object.fromEntries(rows.map((r) => [r.name, r.installed ?? null]));
const DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'THIRD-PARTY.md');
const drift = docDrift(existsSync(DOC) ? parseLocalToolRows(readFileSync(DOC, 'utf8')) : null, installedByName);
if (!flag('--json')) for (const f of drift) console.log(`  DRIFT  ${f.label.padEnd(24)} ${short(f.recorded).padEnd(16)} ← doc · box ${short(f.installed)} · ${f.kind}`);

let posted = 0;
if (flag('--notify')) {
  const board = process.env.AGENT_BOARD || join(homedir(), '.local/bin/agent-board');
  for (const r of rows.filter((x) => x.ready)) {
    const key = `${r.name}@${r.latest}`;
    if (state.notified[key]) continue;
    run(board, ['--as', 'update-watch', 'post', '6', '--kind', 'question', '--to', 'kestrel', '--no-lint', promptText(r)], 30000);
    state.notified[key] = nowMs;
    posted++;
  }
  for (const f of drift) {
    const key = `doc-drift:${f.label}@${f.installed ?? f.kind}`;
    if (state.notified[key]) continue;
    run(board, ['--as', 'update-watch', 'post', '6', '--kind', 'finding', '--to', 'kestrel', '--no-lint', driftText(f)], 30000);
    state.notified[key] = nowMs;
    posted++;
  }
}
mkdirSync(dirname(SP), { recursive: true });
writeFileSync(SP, `${JSON.stringify(state, null, 1)}\n`);

const unread = rows.filter((r) => r.why === 'unread').length;
const ready = rows.filter((r) => r.ready);
const checked = rows.length - unread;
const v = makeVerdict({
  gate: 'update-watch',
  status: checked === 0 ? 'UNKNOWN' : ready.length ? 'FAIL' : 'PASS',
  population: { checked, eligible: rows.length, excluded: unread },
  criterion: CRITERION,
  result: { ready: ready.map((r) => `${r.name}@${short(r.latest)}`), posted, docDrift: drift.map((f) => `${f.label}:${f.kind}`) },
  evidence: [TOOL],
  reason: checked === 0 ? 'no source could be read' : ready.length ? `${ready.length} update(s) ready` : null,
  tool: TOOL
});
if (flag('--json')) console.log(JSON.stringify({ verdict: v, rows }, null, 1));
else printVerdict(v);
