#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * estate-drift — config truth for the fleet's systemd estate: the unit files
 * the repo tracks against the unit files actually installed, per host.
 *
 *   node tools/estate-drift.mjs              # the findings, one line each
 *   node tools/estate-drift.mjs --json       # one tepna.verdict/1 on stdout
 *   node tools/estate-drift.mjs --post       # also post to board thread 7 when the finding set CHANGED
 *   node tools/estate-drift.mjs --selftest   # the pure rules below
 *
 * WHY (owner's infra review 2026-10-31, item 5; Kestrel ruling, board #2564).
 * Production behaviour lived in hand-edited unit files on the boxes, and the
 * repo did not know half of them: the rig ran about ten tepna-* units that
 * tools/systemd never tracked (the archive pull among them), and vigil runs
 * the capture daemon from a unit file capture-host/systemd does not hold.
 * tools/unit-health.mjs watches the runtime health of LOADED timers; it
 * cannot see a unit file that was never loaded, and it never compares
 * content against the repo. This tool is the other half: config truth.
 * The two verdicts stay in two tools, so a red says which kind of red it is.
 *
 * THE COMPARISON, per host (rig local, vigil over ssh):
 *   tracked   — the unit files in the repo (rig: tools/systemd;
 *               vigil: capture-host/systemd), by name, with sha256.
 *   installed — the unit files on the box (rig: ~/.config/systemd/user,
 *               override TEPNA_ESTATE_RIG_UNITS; vigil: /etc/systemd/system,
 *               tepna-* only), by name, with sha256, plus each unit's
 *               enable state from `list-unit-files`.
 *   drop-ins  — <unit>.d/*.conf files compare the same way, per unit.
 *
 * FINDINGS (a finding is a fact for a human ruling, never an auto-fix;
 * this tool reports only and converges nothing):
 *   untracked — installed, not tracked, and not on the by-design list.
 *   absent    — tracked, not installed.
 *   differs   — tracked and installed, content hashes apart.
 *   disabled  — tracked and installed, and the unit file state is disabled.
 *   script    — an installed unit names a host-local script (ExecStart)
 *               that cannot be read for hashing.
 *   host      — the vigil leg could not be read at all (ssh or systemctl).
 * Vigil's tepna-capture.service is the standing first finding until its
 * unit file is tracked: the capture daemon runs from an untracked file.
 * Report only — vigil itself is never written to.
 *
 * BY DESIGN (Kestrel #2564). Some installed units are host-local on
 * purpose: session launchers, the board software's own units, desktop
 * services. BY_DESIGN below names each one with its reason. A name absent
 * from that list and from the repo is a finding. Host-local SCRIPTS stay
 * host-local too — some carry secrets (an ntfy topic, a health-check URL) —
 * so the tool hashes each script an installed unit names into the verdict
 * and never copies its content anywhere. Secrets live in host-local
 * EnvironmentFiles; the tracked tree names none.
 *
 * EXITS: 0 no findings · 1 findings · 2 NOT_RUN (the local inventory
 * could not be read at all: no units dir, no systemctl).
 * Env: TEPNA_ESTATE_RIG_UNITS (installed units dir on the rig),
 * TEPNA_ESTATE_VIGIL=off skips the vigil leg, TEPNA_ESTATE_VIGIL_HOST
 * names the ssh host (default vigil).
 */
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { resolveStatePath } from './mutation-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const BOARD_THREAD = '7';
const ARGV_SPEC = { valued: [], boolean: ['--json', '--post', '--selftest'] };
export const UNIT_SUFFIXES = ['.service', '.timer', '.path'];

/** Installed on purpose, per host scope ('rig' user units). name → reason.
 *  Exact names only: a near-miss name is a finding, not a blessing. */
export const BY_DESIGN = new Map([
  ['cups.service', 'desktop printing session service'],
  ['gvfs-daemon.service', 'desktop session service (GNOME virtual filesystem)'],
  ['gvfsd-network.service', 'desktop session service (GNOME virtual filesystem)'],
  ['agent-board-nudge.service', "the board software's own unit, installed from the agent-message-board repo"],
  ['agent-board-tick.service', "the board software's own unit, installed from the agent-message-board repo"],
  ['agent-board-tick.timer', "the board software's own unit, installed from the agent-message-board repo"],
  ['agent-board-web.service', "the board software's own unit, installed from the agent-message-board repo"],
  ['claude-heron.service', 'fleet session launcher; host-local wiring'],
  ['claude-kestrel.service', 'fleet session launcher; host-local wiring'],
  ['claude-magpie.service', 'fleet session launcher; host-local wiring'],
  ['claude-osprey.service', 'fleet session launcher; host-local wiring'],
  ['herdr.service', "herdr's own unit"],
  ['openclaw-gateway.service', "the claw gateway's own unit"],
  ['finch-labbackup-daily.service', "Finch's lab backup; Finch-owned, not Tepna estate"],
  ['finch-labbackup-daily.timer', "Finch's lab backup; Finch-owned, not Tepna estate"]
]);

export const isUnitFile = (name) => UNIT_SUFFIXES.some((s) => name.endsWith(s));

/** systemctl list-unit-files text → Map name → state. Pure. */
export function parseUnitStates(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^(\S+\.(?:service|timer|path))\s+(enabled|disabled|static|indirect|generated|transient|masked|bad)\b/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Script paths an ExecStart line names, wrappers stripped. Pure.
 *  A token counts as a script when it carries a script suffix (.sh, .mjs,
 *  .cjs, .js, .py) or sits in a bin dir (.local/bin, /usr/local/bin) — so a
 *  mount path handed to mountpoint is not mistaken for one.
 *  `/bin/bash /opt/x.sh %i` yields the script; `/bin/sh -c '...'` yields
 *  nothing (the command lives in the unit file, which is already compared). */
export function execStartPaths(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    const m = /^ExecStart(?:Pre|Post)?=\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    for (let tok of m[1].split(/\s+/)) {
      tok = tok.replace(/^[-@+!]+/, '').replace(/^['"]|['"]$/g, '');
      const absolute = tok.startsWith('%h/') || (tok.startsWith('/') && !tok.startsWith('/bin/') && !tok.startsWith('/usr/bin/') && !tok.startsWith('/usr/sbin/') && !tok.startsWith('/sbin/'));
      const scriptish = /\.(?:sh|mjs|cjs|js|py)$/.test(tok) || tok.includes('/.local/bin/') || tok.startsWith('/usr/local/bin/');
      if (absolute && scriptish) out.add(tok);
    }
  }
  return [...out].sort();
}

/**
 * The three-way compare for one host. Pure.
 * tracked / installed: Map name → { hash, dropins: Map rel → hash }.
 * states: Map name → list-unit-files state. byDesign: Map name → reason.
 * Returns { findings, compared, byDesignSeen }.
 */
export function compareHost(host, { tracked, installed, states, byDesign }) {
  const findings = [];
  const names = new Set([...tracked.keys(), ...installed.keys()]);
  let byDesignSeen = 0;
  for (const name of [...names].sort()) {
    const t = tracked.get(name);
    const i = installed.get(name);
    if (i && !t) {
      if (byDesign.has(name)) {
        byDesignSeen++;
        continue;
      }
      findings.push({ host, unit: name, kind: 'untracked', detail: `${host}: ${name} is installed and not tracked` });
      continue;
    }
    if (t && !i) {
      findings.push({ host, unit: name, kind: 'absent', detail: `${host}: ${name} is tracked and not installed` });
      continue;
    }
    if (t.hash !== i.hash) findings.push({ host, unit: name, kind: 'differs', detail: `${host}: ${name} content differs from the tracked copy` });
    const dropNames = new Set([...t.dropins.keys(), ...i.dropins.keys()]);
    for (const rel of [...dropNames].sort()) {
      if (!t.dropins.has(rel)) findings.push({ host, unit: name, kind: 'untracked', detail: `${host}: ${name} drop-in ${rel} is installed and not tracked` });
      else if (!i.dropins.has(rel)) findings.push({ host, unit: name, kind: 'absent', detail: `${host}: ${name} drop-in ${rel} is tracked and not installed` });
      else if (t.dropins.get(rel) !== i.dropins.get(rel)) findings.push({ host, unit: name, kind: 'differs', detail: `${host}: ${name} drop-in ${rel} content differs from the tracked copy` });
    }
    if (states.get(name) === 'disabled') findings.push({ host, unit: name, kind: 'disabled', detail: `${host}: ${name} is installed and disabled` });
  }
  return { findings, compared: names.size, byDesignSeen };
}

/** The post-on-change key: findings plus the script-hash map, so a
 *  host-local script edit re-posts even when no finding changed. Pure. */
export const findingKey = (findings, scripts) => [...findings.map((f) => `${f.kind}:${f.host}:${f.unit}:${f.detail}`), ...Object.entries(scripts).map(([p, h]) => `script:${p}:${h}`)].sort().join('|');

export function diffFindings(prev, cur) {
  const key = (f) => `${f.kind}:${f.host}:${f.unit}:${f.detail}`;
  const p = new Set(prev.map(key));
  const c = new Set(cur.map(key));
  return { added: cur.filter((f) => !p.has(key(f))), cleared: prev.filter((f) => !c.has(key(f))) };
}

export function verdictOf({ status, findings, checked, excluded, scripts, reason }) {
  const failReason = status === 'FAIL' && !reason && findings.length ? `${findings.length} finding(s); first: ${findings[0].detail}` : reason;
  const v = Verdict.make({
    gate: 'estate-drift',
    status,
    population: { checked, eligible: checked + excluded, excluded },
    criterion: { name: 'installed-units-match-tracked-copies', threshold: 0, unit: 'findings', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { findings, scripts },
    evidence: ['tools/estate-drift.mjs', 'tools/systemd', 'capture-host/systemd', 'systemctl list-unit-files'],
    reason: failReason ?? null,
    producedBy: { tool: 'tools/estate-drift.mjs', commit: gitHead() },
    at: new Date().toISOString()
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`estate-drift produced an invalid verdict: ${check.errors.join('; ')}`);
  return v;
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const t = (name, cond) => {
    ran++;
    if (!cond) fail.push(name);
  };
  const H = (s) => createHash('sha256').update(s).digest('hex');
  const unit = (body, dropins = {}) => ({ hash: H(body), dropins: new Map(Object.entries(dropins).map(([k, v]) => [k, H(v)])) });
  const base = () => ({
    tracked: new Map([
      ['a.service', unit('A')],
      ['a.timer', unit('T')],
      ['gone.service', unit('G')]
    ]),
    installed: new Map([
      ['a.service', unit('A')],
      ['a.timer', unit('T')]
    ]),
    states: new Map([
      ['a.service', 'enabled'],
      ['a.timer', 'enabled']
    ]),
    byDesign: BY_DESIGN
  });

  const okRun = compareHost('rig', base());
  t('tracked-but-absent is the only finding on an otherwise clean estate', okRun.findings.length === 1 && okRun.findings[0].kind === 'absent' && okRun.findings[0].unit === 'gone.service');

  const b2 = base();
  b2.installed.set('rogue.service', unit('R'));
  const r2 = compareHost('rig', b2);
  t(
    'an installed unit the repo does not track is an untracked finding',
    r2.findings.some((f) => f.kind === 'untracked' && f.unit === 'rogue.service')
  );

  const b3 = base();
  b3.installed.set('cups.service', unit('C'));
  const r3 = compareHost('rig', b3);
  t('a by-design unit is no finding and counts as excluded', !r3.findings.some((f) => f.unit === 'cups.service') && r3.byDesignSeen === 1);

  const b4 = base();
  b4.installed.set('a.service', unit('A2'));
  t(
    'a content difference is a differs finding',
    compareHost('rig', b4).findings.some((f) => f.kind === 'differs' && f.unit === 'a.service')
  );

  const b5 = base();
  b5.tracked.set('a.service', unit('A', { 'override.conf': 'O' }));
  b5.installed.set('a.service', unit('A', { 'override.conf': 'O2' }));
  t(
    'a drop-in difference is a differs finding naming the drop-in',
    compareHost('rig', b5).findings.some((f) => f.kind === 'differs' && f.detail.includes('override.conf'))
  );

  const b6 = base();
  b6.states.set('a.timer', 'disabled');
  t(
    'a disabled tracked unit is a disabled finding',
    compareHost('rig', b6).findings.some((f) => f.kind === 'disabled' && f.unit === 'a.timer')
  );
  const b7 = base();
  b7.states.set('a.timer', 'static');
  t('a static unit is no finding', !compareHost('rig', b7).findings.some((f) => f.unit === 'a.timer'));

  const states = parseUnitStates('UNIT FILE STATE PRESET\na.service enabled enabled\ntepna-btattach@.service indirect -\nb.timer disabled enabled\nrun-123.scope transient -\n');
  t(
    'list-unit-files text parses to states',
    states.get('a.service') === 'enabled' && states.get('tepna-btattach@.service') === 'indirect' && states.get('b.timer') === 'disabled' && !states.has('run-123.scope')
  );

  const paths = execStartPaths(
    "[Service]\nExecStart=/bin/bash /opt/tepna/capture-host/systemd/x.sh %i\nExecStart=/bin/sh -c 'echo hi'\nExecStart=-%h/.local/bin/tool --flag\nExecStartPre=/usr/bin/mountpoint -q /mnt/x\n"
  );
  t('ExecStart paths come out with wrappers and system binaries stripped', paths.length === 2 && paths.includes('/opt/tepna/capture-host/systemd/x.sh') && paths.includes('%h/.local/bin/tool'));

  const f1 = [{ host: 'rig', unit: 'a.service', kind: 'differs', detail: 'd' }];
  const keyA = findingKey(f1, { '/h/s.sh': 'aa' });
  const keyA2 = findingKey(f1, { '/h/s.sh': 'aa' });
  t('the finding key moves when a script hash moves', keyA !== findingKey(f1, { '/h/s.sh': 'bb' }) && keyA === keyA2);
  const d = diffFindings([...f1, { host: 'vigil', unit: 'c.service', kind: 'untracked', detail: 'u' }], f1);
  t('a cleared finding reads as cleared', d.added.length === 0 && d.cleared.length === 1);

  const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, excluded: 0, scripts: {}, reason: 'no units dir' });
  t('a NOT_RUN verdict validates and carries no result', Verdict.validate(v).ok && v.result === null);
  const vf = verdictOf({ status: 'FAIL', findings: f1, checked: 3, excluded: 1, scripts: {} });
  t('a FAIL verdict validates and carries its findings', Verdict.validate(vf).ok && vf.result.findings.length === 1);

  const line = fail.length ? `estate-drift selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ran, fail, line };
}

/* ── I/O ── */

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function readUnitDir(dir) {
  const out = new Map();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  const isFile = async (p) => {
    try {
      return (await stat(p)).isFile();
    } catch {
      return false;
    }
  };
  const isDir = async (p) => {
    try {
      return (await stat(p)).isDirectory();
    } catch {
      return false;
    }
  };
  // stat, not the dirent: an installed unit is often a symlink into the repo,
  // and a dirent calls a symlink neither file nor directory.
  for (const name of names) {
    if (isUnitFile(name) && (await isFile(join(dir, name)))) {
      const buf = await readFile(join(dir, name));
      out.set(name, { hash: sha256(buf), text: buf.toString('utf8'), dropins: new Map() });
    }
  }
  for (const name of names) {
    if (name.endsWith('.d') && (await isDir(join(dir, name)))) {
      const unitName = name.slice(0, -2);
      if (!out.has(unitName)) continue;
      for (const f of await readdir(join(dir, name))) {
        if (f.endsWith('.conf') && (await isFile(join(dir, name, f)))) {
          out.get(unitName).dropins.set(f, sha256(await readFile(join(dir, name, f))));
        }
      }
    }
  }
  return out;
}

function systemctlStates(user) {
  const args = user ? ['--user', 'list-unit-files', '--no-pager'] : ['list-unit-files', '--no-pager'];
  const r = spawnSync('systemctl', args, { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return null;
  return parseUnitStates(r.stdout);
}

const REMOTE_WALKER = `
import hashlib, os, sys
root = sys.argv[1]
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for name in sorted(filenames):
        if name.endswith('.part') or name.endswith('.tmp'):
            continue
        p = os.path.join(dirpath, name)
        if not os.path.isfile(p) or os.path.islink(p):
            continue
        h = hashlib.sha256()
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        print(os.path.relpath(p, root) + '\\t' + h.hexdigest())
`;

function sshRun(host, remoteCmd) {
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-F', join(homedir(), '.ssh', 'config'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remoteCmd], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(new Error(`ssh ${host}: exit ${err.code ?? '?'}`)) : resolve(stdout)
    );
  });
}

async function hashRemoteDir(host, root) {
  const b64 = Buffer.from(REMOTE_WALKER).toString('base64');
  const out = await sshRun(host, `echo ${b64} | base64 -d | python3 - ${root}`);
  const map = new Map();
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

/** Vigil's installed set from the remote /etc/systemd/system hash map. */
function remoteInstalled(map) {
  const out = new Map();
  for (const [rel, hash] of map) {
    const parts = rel.split('/');
    if (parts.length === 1 && rel.startsWith('tepna-') && isUnitFile(rel)) out.set(rel, { hash, text: '', dropins: new Map() });
    else if (parts.length === 2 && parts[0].endsWith('.d') && parts[1].endsWith('.conf')) {
      const unitName = parts[0].slice(0, -2);
      if (out.has(unitName)) out.get(unitName).dropins.set(parts[1], hash);
    }
  }
  return out;
}

const homeKey = (absPath) => (absPath.startsWith(homedir()) ? `%h${absPath.slice(homedir().length)}` : absPath);

/** Hash the host-local scripts the rig's installed units name. */
async function rigScripts(installed) {
  const scripts = {};
  const findings = [];
  for (const [name, u] of installed) {
    for (const tok of execStartPaths(u.text)) {
      const abs = tok.startsWith('%h/') ? join(homedir(), tok.slice(3)) : tok;
      if (abs.startsWith(ROOT) || abs.startsWith('/opt/')) continue;
      try {
        scripts[homeKey(abs)] = sha256(await readFile(abs));
      } catch {
        findings.push({ host: 'rig', unit: name, kind: 'script', detail: `rig: ${name} names a script that cannot be read: ${homeKey(abs)}` });
      }
    }
  }
  return { scripts, findings };
}

function post(added, cleared, findings, scriptNote) {
  const lines = ['Estate drift (`tools/estate-drift.mjs`). The tracked-vs-installed comparison changed on the rig.', ''];
  if (added.length) lines.push('New:', ...added.map((f) => `- ${f.detail}.`), '');
  if (cleared.length) lines.push('Cleared:', ...cleared.map((f) => `- ${f.detail}.`), '');
  if (scriptNote) lines.push(scriptNote, '');
  lines.push(`Now: ${findings.length} finding(s). The checker reports only; it converges nothing.`);
  const bin = process.env.AGENT_BOARD_BIN || join(process.env.HOME || '', '.local/bin/agent-board');
  const r = spawnSync(bin, ['--as', 'muse', 'post', BOARD_THREAD, '--kind', 'finding', '-'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' });
  return r.status === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'estate-drift' });
  if (argv.includes('--selftest')) {
    const r = selftest();
    console.log(r.line);
    for (const f of r.fail) console.log(`  ✕ ${f}`);
    process.exit(r.fail.length ? 1 : 0);
  }
  const asJson = argv.includes('--json');

  const installedDir = process.env.TEPNA_ESTATE_RIG_UNITS || join(homedir(), '.config', 'systemd', 'user');
  const states = systemctlStates(true);
  if (!existsSync(installedDir) || !states) {
    const reason = !existsSync(installedDir) ? `rig units dir does not exist: ${homeKey(installedDir)}` : 'no systemd user manager answered `systemctl --user list-unit-files`';
    const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, excluded: 0, scripts: {}, reason });
    if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
    else console.log(`estate-drift: NOT_RUN — ${reason}`);
    process.exit(2);
  }

  const rigTracked = await readUnitDir(join(ROOT, 'tools', 'systemd'));
  const rigInstalled = await readUnitDir(installedDir);
  const rigCmp = compareHost('rig', { tracked: rigTracked, installed: rigInstalled, states, byDesign: BY_DESIGN });
  const { scripts, findings: scriptFindings } = await rigScripts(rigInstalled);
  let findings = [...rigCmp.findings, ...scriptFindings];
  let checked = rigCmp.compared;
  let excluded = rigCmp.byDesignSeen;

  if (process.env.TEPNA_ESTATE_VIGIL !== 'off') {
    const host = process.env.TEPNA_ESTATE_VIGIL_HOST || 'vigil';
    try {
      const vigilTracked = await readUnitDir(join(ROOT, 'capture-host', 'systemd'));
      const sysMap = await hashRemoteDir(host, '/etc/systemd/system');
      const vigilInstalled = remoteInstalled(sysMap);
      const stateText = await sshRun(host, 'systemctl list-unit-files --no-pager');
      const vigilCmp = compareHost('vigil', { tracked: vigilTracked, installed: vigilInstalled, states: parseUnitStates(stateText), byDesign: new Map() });
      findings = [...findings, ...vigilCmp.findings];
      checked += vigilCmp.compared;
      // Vigil scripts under the deployed checkout's systemd dir (tepna-btattach.sh).
      const checkoutMap = await hashRemoteDir(host, '/opt/tepna/capture-host/systemd');
      for (const [rel, hash] of checkoutMap) {
        if (rel.endsWith('.sh')) scripts[`/opt/tepna/capture-host/systemd/${rel}`] = hash;
      }
    } catch (e) {
      findings.push({ host: 'vigil', unit: '-', kind: 'host', detail: `vigil: the installed set could not be read (${e.message})` });
    }
  }

  findings.sort((a, b) => `${a.host}:${a.unit}:${a.kind}`.localeCompare(`${b.host}:${b.unit}:${b.kind}`));
  const status = findings.length ? 'FAIL' : 'PASS';
  const reason = findings.length ? `${findings.length} drift finding(s) across the estate` : null;

  if (argv.includes('--post')) {
    const p = resolveStatePath(ROOT, 'estate-drift.json');
    let prev = { findings: [], scripts: {} };
    try {
      if (existsSync(p)) prev = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      prev = { findings: [], scripts: {} };
    }
    if (findingKey(prev.findings || [], prev.scripts || {}) !== findingKey(findings, scripts)) {
      const { added, cleared } = diffFindings(prev.findings || [], findings);
      const scriptNote = added.length === 0 && cleared.length === 0 ? 'A host-local script hash changed; the finding set did not.' : null;
      if (post(added, cleared, findings, scriptNote)) {
        writeFileSync(p, `${JSON.stringify({ at: new Date().toISOString(), findings, scripts }, null, 1)}\n`);
      }
    }
  }

  const v = verdictOf({ status, findings, checked, excluded, scripts, reason });
  if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
  else {
    console.log(`estate-drift · ${checked} unit(s) compared · ${excluded} by-design · ${Object.keys(scripts).length} script(s) hashed · ${findings.length} finding(s)`);
    for (const f of findings) console.log(`  ✕ ${f.kind.padEnd(9)} ${f.detail}`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (isCliEntry(import.meta.url)) {
  await main();
}
