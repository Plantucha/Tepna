#!/usr/bin/env node
/*
 * ntfy-board-bridge.mjs — carry a push alert from its topic to the fleet board.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE RIG RAN THIS BRIDGE FOR WEEKS AND NO TREE HELD IT. Every push alert a capture host or a
 * watchdog publishes reaches a bird through this one script (`briefs/NTFY-ALERT-WIRING-2026-11-03-BRIEF.md`
 * draws the whole path). It lived only as an installed copy under the fleet herder's `~/.local/bin`,
 * so no test read it, no gate saw a change to it, and each repair was a hand edit on the rig.
 *
 * ⚠️ WHAT THAT COST, measured 2026-11-02/03. The subscription went silent at 13:34Z on 11-02 with no
 * `end` event and no `error`, so the reconnect that both of those arms drive never fired. A disk alert
 * published at 01:45Z reached the board at 09:23Z, on a restart, 7 h 38 min late. ntfy sends a
 * keepalive about every 45 s, so a link that delivers no byte for `STALL_MS` is dead rather than quiet,
 * and `makeStallWatch` destroys it to force the reconnect. The rule it answers has a residue row:
 * `2026-11-03-the-alert-bridge-had-no-tracked-copy-and-no-stall-reconnect`.
 *
 * 🔒 THE CONFIG IS NOT IN THIS REPO AND MUST NOT ENTER IT. `BRIDGE_CONFIG` names a file outside the
 * tree that holds the topic names, the thread numbers and the bird mailboxes. A topic name is a
 * credential: anyone holding it can publish to the owner's phone. So no topic name belongs in this
 * file, in a test, in a fixture or in a post, and the start-up log says `(name withheld)`. The three
 * rule functions take the config as an argument for the same reason: the selftest fabricates one.
 *
 * USAGE
 *   node tools/ntfy-board-bridge.mjs             # run the bridge; needs the installed config
 *   BRIDGE_DRY_RUN=1 node tools/ntfy-board-bridge.mjs   # classify and log, post nothing
 *   node tools/ntfy-board-bridge.mjs --selftest  # the pure rules over fabricated input
 *
 * The installed copy on the rig stays the running one. A merge here does not deploy: the fleet herder
 * re-points the unit at the tracked path, which is the owner's step, not a session's.
 */
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { isCliEntry } from './argv-guard.mjs';

const HOME = os.homedir();
const DRY = process.env.BRIDGE_DRY_RUN === '1';
const CFG_PATH = process.env.BRIDGE_CONFIG || `${HOME}/.config/ntfy-board-bridge/config.json`;
const STATE_BASE = process.env.BRIDGE_STATE || `${HOME}/.local/state/ntfy-board-bridge/state.json`;
const STATE_PATH = DRY ? `${STATE_BASE}.dry` : STATE_BASE;
const AB = `${HOME}/.local/bin/agent-board`;

/* A STALLED STREAM RECONNECTS. 150 s is three missed keepalives, so it cannot fire on a quiet link. */
export const STALL_MS = 150000;
export const RE_CLOSE = /recovered|back under|serving again|resolved|cleared/i;

/** Assigned by `main()`. The exported rules never read it — they take the config as an argument. */
let cfg = null;
let state = { lastId: {}, episodes: {}, closedAt: {}, tracked: {}, suppressed: 0, lastCycleAt: 0 };

const log = (...a) => console.log(new Date().toISOString(), ...a);

/**
 * A DEAD LINK IS NOT A QUIET ONE. Re-arm on every byte; fire `onStall` once `stallMs` passes with
 * none. `timers` is injectable so the selftest can run the clock without waiting 150 s.
 */
export function makeStallWatch({ onStall, stallMs = STALL_MS, timers = globalThis }) {
  let t = null;
  return {
    arm() {
      if (t !== null) timers.clearTimeout(t);
      t = timers.setTimeout(onStall, stallMs);
    },
    clear() {
      if (t !== null) timers.clearTimeout(t);
      t = null;
    },
    get armed() {
      return t !== null;
    }
  };
}

/**
 * The device NAME only (Wren 2026-11-01): the old `Polar[^,.;]*` ran on into the verb, so one device
 * keyed two episodes and a recovery could never close the alert it answered.
 */
export function deviceOf(s) {
  const first = (String(s || '').split('\n')[0] || '').replace(/:.*$/, '');
  const m =
    first.match(/^(.+?) (?:is|has|went|was|battery|delivered|connects)\b/) ||
    String(s || '').match(/(?:Polar (?:H10|Verity ?Sense|Sense)|Wellue O2Ring[-\w]*|O2Ring[-\w]*)(?: [0-9A-F]{8})?/i) ||
    String(s || '').match(/AirSense ?\d+/i) ||
    String(s || '').match(/WatchPAT[^,.;\s]*/i);
  return m ? (m[1] || m[0]).trim().slice(0, 40) : 'device';
}

/**
 * A capture-host POSTs `{"title","message"}` to the topic URL, so the server stores the JSON as the
 * message and the title arrives empty. Read the title back out, or every one of those alerts
 * classifies as `vigil:info` — 29 of the 31 entries before 2026-11-01 did.
 */
export function unwrap(msg) {
  if (msg.title || typeof msg.message !== 'string' || !msg.message.trim().startsWith('{')) return msg;
  try {
    const j = JSON.parse(msg.message);
    if (j && typeof j.title === 'string') return { ...msg, title: j.title, message: typeof j.message === 'string' ? j.message : '' };
  } catch {}
  return msg;
}

/** One alert → one episode key, one thread, one owning bird. `conf` carries `threads` and `birds`. */
export function classify(domain, msg, conf) {
  const T = msg.title || '';
  const M = msg.message || '';
  const X = `${T}\n${M}`;
  const threads = conf.threads;
  const birds = conf.birds;
  if (domain === 'vigil') {
    const base = { thread: threads.vigil, bird: birds.vigil, publisher: 'vigil alerts.py' };
    if (/disk/i.test(T)) return { ...base, cls: /low|full|critical/i.test(X) ? 'urgent' : 'routine', key: 'vigil:disk', coTo: [birds.network], latch: true };
    if (/serves nothing/i.test(T)) return { ...base, cls: RE_CLOSE.test(T) ? 'close' : 'urgent', key: 'vigil:ring', latch: true };
    if (/sensor/i.test(T) || /offline|silent/i.test(T)) return { ...base, cls: RE_CLOSE.test(T) ? 'close' : 'latched', key: `vigil:sensor:${deviceOf(M)}`, latch: true };
    /* THE SOLID-NIGHT VERDICT SITS ABOVE THE `sidecar` RULE ON PURPOSE (owner 2026-11-03). The judge's
       reason often names a sidecar, and the rule below would page that as a crash. One episode per
       night and status, a note to the capture bird's mailbox. */
    const sn = T.match(/^Tepna: night (\d{4}-\d{2}-\d{2}) ([A-Z_]+)$/);
    if (sn) return { ...base, publisher: 'vigil solid-night judge', cls: 'routine', key: `vigil:solid:${sn[1]}:${sn[2]}`, latch: true };
    if (/lost|sidecar|crashed|harvest failed/i.test(X)) return { ...base, cls: 'urgent', key: `vigil:crit:${T.slice(0, 40)}`, latch: true };
    return { ...base, cls: 'routine', key: 'vigil:info', latch: false };
  }
  if (/nebula-sync/i.test(X)) return { thread: threads.network, bird: birds.network, publisher: 'nebula-sync', cls: /FAILED/i.test(X) ? 'urgent' : 'routine', key: 'net:nebula', latch: true };
  if (domain === 'network') {
    const base = { thread: threads.network, bird: birds.network, publisher: 'watchdog' };
    if (/disk/i.test(T)) return { ...base, cls: 'urgent', key: 'net:disk', latch: true };
    if (RE_CLOSE.test(X)) return { ...base, cls: 'close', key: 'net:watch', latch: true };
    if (/fail|down|critical|error|offline/i.test(X)) return { ...base, cls: 'urgent', key: `net:watch:${T.slice(0, 40)}`, latch: true };
    return { ...base, cls: 'routine', key: 'net:info', latch: false };
  }
  const base = { thread: threads.rig, bird: birds.rig };
  if (/disk/i.test(T) || /disk-watch/i.test(M)) {
    const mount = /\/srv\/data/.test(X) ? 'data' : /\/boot/.test(X) ? 'boot' : 'root';
    return { ...base, publisher: 'disk-watch', cls: RE_CLOSE.test(X) ? 'close' : 'urgent', key: `rig:disk:${mount}`, coTo: [birds.network], latch: true };
  }
  return { ...base, cls: 'routine', key: 'rig:info', latch: false };
}

/* ── THE RUNNING HALF. Nothing below executes on import. ──────────────────────────────────────── */

function persist() {
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, STATE_PATH);
}

function run(args) {
  return new Promise((res, rej) => execFile(AB, args, { timeout: 30000 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));
}

function runFile(file, args) {
  return new Promise((res, rej) => execFile(file, args, { timeout: 30000 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));
}

/* An ack from the next rung up closes the escalation even while the board decision still waits on its
   addressee (the coordinator's #2485, defect 3). */
async function kestrelAcked(ids) {
  if (!ids.length) return new Set();
  const code =
    "import sqlite3,os,sys,json;db=sqlite3.connect(os.path.expanduser('~/.agent-board/board.db'));" +
    "ids=[int(x) for x in sys.argv[1:]];q='SELECT entry_id FROM acks WHERE agent=\"kestrel\" AND entry_id IN (%s)'%','.join('?'*len(ids));" +
    'print(json.dumps([r[0] for r in db.execute(q,ids)]))';
  try {
    return new Set(JSON.parse(await runFile('python3', ['-c', code, ...ids.map(String)])));
  } catch (e) {
    log('kestrelAcked failed', e.message);
    return new Set();
  }
}

async function post(thread, body, kind, to) {
  if (DRY) {
    log('[dry] post', thread, kind, `to=${to.join(',')}`, JSON.stringify(body.slice(0, 90)));
    return 0;
  }
  const args = ['--as', 'ntfy-bridge', 'post', thread, body, '--kind', kind, '--no-route', ...to.flatMap((t) => ['--to', t])];
  const out = await run(args);
  const m = out.match(/#(\d+)/);
  const id = m ? Number(m[1]) : 0;
  log('posted', thread, kind, 'id', id, 'to', to.join(','));
  return id;
}

/* JSON publish, not a Title header: a header is latin1 in Node, which mangled the middle dot. */
function ownerNtfy(title, body) {
  const data = Buffer.from(JSON.stringify({ topic: cfg.ownerTopic, title, message: body, priority: 5, tags: ['rotating_light'] }));
  const req = https.request({ host: 'ntfy.sh', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => res.resume());
  req.on('error', (e) => log('ownerNtfy error', e.message));
  req.end(data);
}

/* Owner 2026-11-01: birds first, the phone on escalation. The phone no longer follows the alert
   topics, so this page is the only copy the owner sees. It must say what broke and where. */
function ownerPage(id, tr, why) {
  const test = /test|drill/i.test(`${tr.key} ${tr.title || ''}`) ? 'TEST · ' : '';
  const title = `${test}${tr.title || tr.key} · ${tr.domain}`.slice(0, 200);
  const body = [
    why,
    `Owner bird: @${tr.bird} · Episode: ${tr.key} · Board: #${id} in alerts: ${tr.domain}`,
    `First seen: ${new Date(tr.at).toISOString().replace('T', ' ').slice(0, 16)}Z`,
    '',
    (tr.message || '(the publisher sent no message body)').slice(0, 3000)
  ].join('\n');
  return { title, body };
}

async function handle(domain, topicName, msg) {
  if (msg.event !== 'message') return;
  /* `since=<id>` can hand back a message already handled (measured 2026-11-01: a restart re-posted a
     7 h old alert twice), so skip a seen id. */
  state.seen = state.seen || [];
  if (state.seen.includes(msg.id)) return;
  state.seen.push(msg.id);
  if (state.seen.length > 500) state.seen.splice(0, state.seen.length - 500);
  state.lastId[topicName] = msg.id;
  const m = unwrap(msg);
  const c = classify(domain, m, cfg);
  const when = new Date((m.time || Date.now() / 1000) * 1000).toISOString();
  const stateWord = c.cls === 'close' ? 'RECOVERED' : c.cls === 'urgent' ? 'OPEN · urgent' : 'OPEN';
  const body =
    `## ${m.title || '(no title)'}\n\n- **State:** ${stateWord}\n- **Owner:** @${c.bird}` +
    `${c.coTo && c.coTo.length ? ` · copy @${c.coTo.join(', @')}` : ''}\n` +
    `- **Domain:** ${domain} · **Episode:** ${c.key} · **First seen:** ${when}\n` +
    `- **Publisher:** ${c.publisher || `ntfy ${domain} stream`} — original message below, verbatim\n\n${m.message || ''}`;
  if (c.cls === 'close') {
    if (state.episodes[c.key]) {
      delete state.episodes[c.key];
      state.closedAt[c.key] = Date.now();
      for (const [id, tr] of Object.entries(state.tracked)) if (tr.key === c.key) delete state.tracked[id];
      await post(c.thread, body, 'note', [c.bird, ...(c.coTo || [])]);
    }
    persist();
    return;
  }
  if (c.latch && state.episodes[c.key]) {
    state.suppressed += 1;
    log('suppressed repeat', c.key);
    persist();
    return;
  }
  if (c.latch && c.key.startsWith('vigil:sensor') && state.closedAt[c.key] && Date.now() - state.closedAt[c.key] < 2 * 3600e3) {
    state.episodes[c.key] = { at: Date.now(), domain };
    log('sensor reopen <2h merged', c.key);
    persist();
    return;
  }
  if (c.cls === 'urgent') {
    const id = await post(c.thread, body, 'decision', [c.bird, ...(c.coTo || [])]);
    if (id) state.tracked[id] = { key: c.key, bird: c.bird, domain, title: m.title || '', message: (m.message || '').slice(0, 3000), at: Date.now(), esc: 0 };
    /* A publisher that tags an alert `owner-critical` pages the owner at once, not after 90 min. */
    if (id && Array.isArray(m.tags) && m.tags.includes('owner-critical')) {
      const pg = ownerPage(id, state.tracked[id], 'The publisher marked this alert owner-critical. The bird has it too.');
      ownerNtfy(pg.title, pg.body);
      state.tracked[id].esc = 2;
    }
  } else {
    /* Every domain's notes go to that domain's bird, so the nudge pings each bird. */
    await post(c.thread, body, 'note', [c.bird]);
  }
  if (c.latch) state.episodes[c.key] = { at: Date.now(), domain };
  state.lastCycleAt = Date.now();
  persist();
}

async function ackSweep() {
  state.lastCycleAt = Date.now();
  persist();
  if (DRY) return;
  let out = '';
  try {
    out = await run(['--as', 'ntfy-bridge', 'acks']);
  } catch (e) {
    log('acks failed', e.message);
    return;
  }
  const pending = new Set([...out.matchAll(/#(\d+) decision by ntfy-bridge/g)].map((m) => Number(m[1])));
  const kAcked = await kestrelAcked(Object.keys(state.tracked).map(Number));
  for (const [idS, tr] of Object.entries(state.tracked)) {
    const id = Number(idS);
    if (!pending.has(id) || kAcked.has(id)) {
      delete state.tracked[idS];
      continue;
    }
    const ageMin = (Date.now() - tr.at) / 60000;
    const isTest = /test|drill/i.test(`${tr.key} ${tr.title || ''}`);
    if (ageMin > 30 && tr.esc === 0) {
      tr.esc = 1;
      tr.escAt = Date.now();
      await post(
        cfg.threads[tr.domain],
        `${isTest ? 'TEST · ' : ''}Escalation: urgent alert #${id} (${tr.key}) routed to @${tr.bird} is un-acked after 30 min. @kestrel please pick up or reassign.`,
        'warning',
        ['kestrel']
      );
    } else if (ageMin > 90 && tr.esc === 1) {
      tr.esc = 2;
      const stage1 = tr.escAt
        ? `The 30-min escalation to @kestrel was posted ${Math.max(1, Math.round((Date.now() - tr.escAt) / 60000))} min ago; no ack is recorded.`
        : 'No 30-min escalation was posted for this alert.';
      const pg = ownerPage(id, tr, `ESCALATION: no bird acked this urgent alert in 90 min. ${stage1}`);
      ownerNtfy(pg.title, pg.body);
    }
  }
  persist();
}

function consume(domain, topicName) {
  const since = state.lastId[topicName] || String(Math.floor(Date.now() / 1000));
  const url = `https://ntfy.sh/${topicName}/json?since=${encodeURIComponent(since)}`;
  let req = null;
  const watch = makeStallWatch({
    onStall: () => {
      log('stream stalled', domain);
      if (req) req.destroy(new Error('stalled'));
    }
  });
  req = https.get(url, (res) => {
    let buf = '';
    watch.arm();
    res.on('data', (d) => {
      watch.arm();
      buf += d;
      /* Split on the newline and keep the tail: the stream hands back partial lines, and a
         hand-advanced index in the loop condition is the shape the gates refuse. */
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        handle(domain, topicName, msg).catch((e) => log('handle error', e.message));
      }
    });
    res.on('end', () => {
      watch.clear();
      log('stream ended', domain);
      setTimeout(() => consume(domain, topicName), 5000);
    });
  });
  watch.arm();
  req.on('error', (e) => {
    watch.clear();
    log('stream error', domain, e.message);
    setTimeout(() => consume(domain, topicName), 15000);
  });
}

function main() {
  cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
  } catch {}
  process.on('SIGTERM', () => {
    try {
      persist();
    } catch {}
    process.exit(0);
  });
  log('bridge starting', DRY ? '(dry-run)' : '(live)');
  for (const [domain, topicName] of Object.entries(cfg.topics)) {
    if (topicName) {
      log('subscribing', domain, 'topic (name withheld)');
      consume(domain, topicName);
    }
  }
  setInterval(ackSweep, 5 * 60000);
  setTimeout(ackSweep, 10000);
}

/* ── SELFTEST — the rules only, over a fabricated config. No topic name, no network, no board. ──── */

function selftest() {
  let n = 0;
  let bad = 0;
  const ok = (name, cond, got) => {
    n += 1;
    if (cond) {
      console.log(`  ✓ ${name}`);
      return;
    }
    bad += 1;
    console.log(`  ✗ ${name}${got === undefined ? '' : ` — got ${JSON.stringify(got)}`}`);
  };
  /* The names are the fleet's; the numbers and the topics are invented here. A real config lives
     outside this tree and this function must never need one. */
  const conf = { threads: { vigil: 901, network: 902, rig: 903 }, birds: { vigil: 'wren', network: 'finch', rig: 'kestrel' } };

  /* 1 · THE SOLID-NIGHT RULE: one episode per night AND status, and a note rather than a page. */
  const solid = classify('vigil', { title: 'Tepna: night 2026-11-03 SOLID', message: 'the judge is content' }, conf);
  ok('the solid-night verdict keys one episode per night and status', solid.key === 'vigil:solid:2026-11-03:SOLID', solid.key);
  ok('the solid-night verdict is routine, so it notes and does not page', solid.cls === 'routine', solid.cls);
  ok('the solid-night verdict latches, so a repeat is suppressed', solid.latch === true, solid.latch);
  ok('the solid-night verdict names the judge as its publisher', solid.publisher === 'vigil solid-night judge', solid.publisher);
  ok('the solid-night verdict goes to the capture bird', solid.bird === 'wren' && solid.thread === 901, [solid.bird, solid.thread]);
  const notSolid = classify('vigil', { title: 'Tepna: night 2026-11-02 NOT_SOLID', message: '' }, conf);
  ok('a failing night keys its own status', notSolid.key === 'vigil:solid:2026-11-02:NOT_SOLID', notSolid.key);
  /* A title that only LOOKS like the judge's is not the judge's. */
  const nearMiss = classify('vigil', { title: 'Tepna: night 2026-11-03 solid', message: '' }, conf);
  ok('a lower-case status is not the judge line', !String(nearMiss.key).startsWith('vigil:solid:'), nearMiss.key);

  /* 2 · ITS PLACE ABOVE THE `sidecar` RULE. The judge's reason names a sidecar more often than not,
     and the rule below would page that as a crash. Order is the whole fix, so test it both ways. */
  const solidNamingSidecar = classify('vigil', { title: 'Tepna: night 2026-11-03 NOT_SOLID', message: 'the run sidecar covers 41 % of the night, so the judge refused' }, conf);
  ok('a judge line whose reason names a sidecar still reads as the judge', solidNamingSidecar.key === 'vigil:solid:2026-11-03:NOT_SOLID', solidNamingSidecar.key);
  ok('a judge line whose reason names a sidecar is not urgent', solidNamingSidecar.cls === 'routine', solidNamingSidecar.cls);
  /* THE CONTROL: the same word under any other title must still page, or the test above would pass
     over a rule that had simply stopped working. */
  const realCrash = classify('vigil', { title: 'Tepna: harvest failed', message: 'the sidecar writer crashed' }, conf);
  ok('the sidecar rule still pages under another title', realCrash.cls === 'urgent' && String(realCrash.key).startsWith('vigil:crit:'), [realCrash.cls, realCrash.key]);

  /* 3 · THE STALL RECONNECT. A fake clock, because the real one would take 150 s. */
  let fired = 0;
  let seq = 0;
  const live = new Map();
  const timers = {
    setTimeout(fn, ms) {
      seq += 1;
      live.set(seq, { fn, ms });
      return seq;
    },
    clearTimeout(id) {
      live.delete(id);
    }
  };
  const fire = () => {
    for (const [id, t] of [...live]) {
      live.delete(id);
      t.fn();
    }
  };
  const watch = makeStallWatch({ onStall: () => (fired += 1), timers });
  ok('a fresh watch is not armed', watch.armed === false, watch.armed);
  watch.arm();
  ok('arming schedules exactly one timer', live.size === 1, live.size);
  ok(
    'the stall deadline is three missed keepalives',
    [...live.values()][0].ms === STALL_MS && STALL_MS === 150000,
    [...live.values()].map((t) => t.ms)
  );
  watch.arm();
  ok('a byte re-arms rather than stacking a second timer', live.size === 1, live.size);
  fire();
  ok('a link with no byte for the deadline fires the reconnect', fired === 1, fired);
  watch.arm();
  watch.clear();
  fire();
  ok('a cleared watch cannot fire after the stream ended', fired === 1, fired);
  ok('a cleared watch reports itself unarmed', watch.armed === false, watch.armed);

  /* 4 · THE TWO PARSERS THE RULES STAND ON. */
  const wrapped = unwrap({ title: '', message: '{"title":"Tepna: disk low","message":"4 % free on the captures volume"}' });
  ok('a JSON body hands its title back', wrapped.title === 'Tepna: disk low', wrapped.title);
  ok('a JSON body hands its message back', wrapped.message === '4 % free on the captures volume', wrapped.message);
  const plain = { title: 'Tepna: disk low', message: 'not json' };
  ok('a message that already has a title is returned unchanged', unwrap(plain) === plain);
  ok('a body that is not JSON is returned unchanged', unwrap({ title: '', message: '{ not json' }).message === '{ not json');
  ok('the device name stops before the verb', deviceOf('Polar H10 has sent no data since 03:12') === 'Polar H10', deviceOf('Polar H10 has sent no data since 03:12'));
  ok('a recovery of the same device keys the same episode', deviceOf('Polar H10 is recording again') === deviceOf('Polar H10 has sent no data'), deviceOf('Polar H10 is recording again'));
  ok('an unreadable body keys a named fallback', deviceOf('') === 'device', deviceOf(''));
  const sensor = classify('vigil', { title: 'Tepna: sensor silent', message: 'Polar H10 has sent no data since 03:12' }, conf);
  ok('a sensor alert keys the device episode', sensor.key === 'vigil:sensor:Polar H10', sensor.key);
  const recovered = classify('vigil', { title: 'Tepna: sensor recovered', message: 'Polar H10 is recording again' }, conf);
  ok('the recovery closes the episode the silence opened', recovered.cls === 'close' && recovered.key === sensor.key, [recovered.cls, recovered.key]);

  /* 5 · THE CONFIG IS AN ARGUMENT, so a rule cannot reach the installed file. */
  ok('the rules read no module-level config', cfg === null, cfg);

  console.log(bad === 0 ? `all ${n} selftests passed` : `ntfy-board-bridge selftest: FAIL (${bad} of ${n})`);
  return bad === 0 ? 0 : 1;
}

/* The ONE allowed spelling is `isCliEntry` (tools/argv-guard.mjs). Comparing `process.argv[1]` with
   this module by hand answers wrong through a symlink and under `--preserve-symlinks-main`, and
   `tests/dex-tests.js` reds every tool that writes that comparison itself. */
if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  else main();
}
