// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { appendFold, buildRecord, fileSetDigest, ledgerFindings, LEDGER_NAME, LEDGER_SCHEMA, mountOf, RECORD_SCHEMA } from '../tools/fold-provenance.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

/* A fixed mountinfo: the two lines are the 2026-09-22 near-miss. `/mnt/nas` itself is NOT a mount
   (it sits on /), while `/mnt/nas/tepna-corpus` IS an nfs4 mount. A parent-prefix test gets the
   first right and the second wrong, which is exactly how a false finding was nearly logged. */
const MI = [
  '1 1 252:1 / / rw,relatime shared:1 - ext4 /dev/mapper/vg-lv rw',
  '2 1 8:3 / /srv/data rw,relatime shared:2 - ext4 /dev/sda3 rw',
  '3 1 0:52 / /mnt/nas/tepna-corpus rw,relatime shared:3 - nfs4 192.168.0.142:/mnt/Storage10TB/x rw',
  '4 1 0:22 / /tmp rw,nosuid shared:4 - tmpfs tmpfs rw'
].join('\n');

ok('the CHILD is the mount, not the parent', mountOf('/mnt/nas/tepna-corpus', MI)?.fstype === 'nfs4', JSON.stringify(mountOf('/mnt/nas/tepna-corpus', MI)));
ok('the parent falls through to /', mountOf('/mnt/nas', MI)?.target === '/', JSON.stringify(mountOf('/mnt/nas', MI)));
ok('longest prefix wins over /', mountOf('/srv/data/tepna-corpus', MI)?.source === '/dev/sda3');
ok('a path under the nfs mount keeps it', mountOf('/mnt/nas/tepna-corpus/2026-09-01/x.txt', MI)?.fstype === 'nfs4');
ok('/tmp is not matched by a /tm prefix', mountOf('/tmpfoo', MI)?.target === '/', JSON.stringify(mountOf('/tmpfoo', MI)));
ok('absent mountinfo returns null, never a guess', mountOf('/srv/data', '') === null);

/* The duplicate ingest this record exists to surface: one basename, two roots. If the digest keyed
   on basename the six copies would collapse to one and the record would look clean. */
const dup = [
  { full: '/c/a/Polar_X_PPG.txt', bytes: 100, mtimeMs: 5 },
  { full: '/c/.stage/a/Polar_X_PPG.txt', bytes: 100, mtimeMs: 5 }
];
ok('two roots, one basename = two entries', fileSetDigest(dup).files === 2);
ok('de-duplicated set digests differently', fileSetDigest(dup).digest !== fileSetDigest([dup[0]]).digest);
ok('order does not move the digest', fileSetDigest(dup).digest === fileSetDigest([dup[1], dup[0]]).digest);
ok('a changed size moves the digest', fileSetDigest([{ ...dup[0], bytes: 101 }]).digest !== fileSetDigest([dup[0]]).digest);

const rec = buildRecord({
  at: '2026-09-22T19:00:00Z',
  codeDigest: 'abc123',
  srcRoots: ['/srv/data/tepna-corpus'],
  nights: [
    { key: '2026-07-19', ok: false },
    { key: '2026-05-03', inputsDigest: 'd1', nodes: ['ECGDex'], ok: true }
  ],
  files: dup,
  mountinfo: MI
});
ok('schema is stamped', rec.schema === 'tepna.fold-provenance/1');
ok('nights sort by key', rec.nights[0].key === '2026-05-03');
ok('a failed night is recorded, not dropped', rec.nightCount === 2 && rec.nights.some((n) => n.key === '2026-07-19' && n.ok === false));
ok('an unstamped night carries null, not a fabricated digest', rec.nights.find((n) => n.key === '2026-07-19').inputsDigest === null);
ok('the mount travels with the root', rec.srcRoots[0].mount.source === '/dev/sda3');

/* WHY A NIGHT IS NOT OK. The projection is a whitelist, so a caller that measured no reason gets
   `null` — and a reader must not read that `null` as "the night had no reason", because every record
   written before these fields existed carries it on every night. The legs below pin both halves. */
ok('a caller that measured no reason gets null, never a fitted one', rec.nights.find((n) => n.key === '2026-07-19').notOkReason === null);
ok('an unmeasured planned-node set is null, never the empty set', rec.nights.find((n) => n.key === '2026-07-19').plannedNodes === null);
ok('an unmeasured export count is null, never 0', rec.nights.find((n) => n.key === '2026-07-19').exports === null);
const recReason = buildRecord({
  at: '2026-10-27T03:00:00Z',
  codeDigest: '54df21a0a400403d',
  srcRoots: ['/srv/data/tepna-corpus'],
  nights: [
    { key: '2026-09-01', ok: false, plannedNodes: ['OxyDex', 'PpgDex'], exports: 2, notOkReason: 'input-absent' },
    { key: '2026-09-11', ok: false, plannedNodes: ['OxyDex', 'PpgDex'], exports: 2, notOkReason: 'input-absent', nodes: null },
    { key: '2026-05-03', inputsDigest: 'd1', nodes: ['ECGDex', 'OxyDex', 'PpgDex'], ok: true, plannedNodes: ['ECGDex', 'OxyDex', 'PpgDex'], exports: 3, notOkReason: null }
  ],
  files: dup,
  mountinfo: MI
});
const byKey = (k) => recReason.nights.find((n) => n.key === k);
ok('the structural reason survives the projection', byKey('2026-09-01').notOkReason === 'input-absent');
ok('the nodes it DID have travel with the reason', JSON.stringify(byKey('2026-09-01').plannedNodes) === '["OxyDex","PpgDex"]');
ok('the export count travels as a measurement', byKey('2026-09-01').exports === 2);
ok('a complete night carries no reason', byKey('2026-05-03').notOkReason === null && byKey('2026-05-03').ok === true);
ok(
  'a reason that is not a string is null, never coerced',
  buildRecord({ at: '2026-10-27T03:00:00Z', codeDigest: 'c', srcRoots: ['/x'], nights: [{ key: 'k', ok: false, notOkReason: 7 }], files: dup, mountinfo: MI }).nights[0].notOkReason === null
);
ok('a record carrying reasons still passes the ledger check', ledgerFindings(appendFold(null, recReason)).length === 0);

ok("a night's own code digest travels beside the run's", rec.nights.find((n) => n.key === '2026-05-03').codeDigest === null);
const recWithCode = buildRecord({
  at: '2026-10-12T19:00:00Z',
  codeDigest: '54df21a0a400403d',
  srcRoots: ['/srv/data/tepna-corpus'],
  nights: [{ key: '2026-05-03', inputsDigest: 'd1', codeDigest: 'fd30ac42431eab6b', nodes: ['ECGDex', 'OxyDex', 'PpgDex'], ok: true }],
  files: dup,
  mountinfo: MI
});
ok('a night folded under other code says so', recWithCode.nights[0].codeDigest === 'fd30ac42431eab6b' && recWithCode.codeDigest === '54df21a0a400403d');

/* ── the run ledger ─────────────────────────────────────────────────────────────────────────────── */
const good = (over) => ({
  schema: RECORD_SCHEMA,
  at: '2026-10-12T19:00:00Z',
  codeDigest: '54df21a0a400403d',
  fileSetDigest: '0123456789abcdef',
  fileCount: 2,
  srcRoots: [{ root: '/srv/data/tepna-corpus', mount: null }],
  nights: [{ key: '2026-05-03', inputsDigest: 'd1', codeDigest: '54df21a0a400403d', nodes: ['ECGDex'], ok: true }],
  nightCount: 1,
  ...over
});
ok('the fragment name is the declared one', LEDGER_NAME === 'trio-fold');
const l1 = appendFold(null, good());
ok('an absent ledger is created, not refused', l1.schema === LEDGER_SCHEMA && l1.folds.length === 1);
const l2 = appendFold(l1, good({ at: '2026-10-13T19:00:00Z' }));
ok('a second fold is appended, never replaced', l2.folds.length === 2 && l2.folds[0].at === '2026-10-12T19:00:00Z');
ok('appendFold does not mutate its input', l1.folds.length === 1);
let threw = null;
try {
  appendFold({ schema: 'tepna.something-else/1', folds: [] }, good());
} catch (e) {
  threw = e.message;
}
ok('a foreign ledger schema refuses', threw != null && /not tepna\.fold-ledger\/1/.test(threw), String(threw));
threw = null;
try {
  appendFold(l1, { schema: 'tepna.verdict/1' });
} catch (e) {
  threw = e.message;
}
ok('a non-fold record refuses', threw != null, String(threw));
ok('a well-formed ledger has no findings', ledgerFindings(l2).length === 0, JSON.stringify(ledgerFindings(l2)));
ok(
  'an empty ledger is a finding — it recorded nothing',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [] }).some((f) => /recorded nothing/.test(f))
);
ok(
  'a miscounted record is caught',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [good({ nightCount: 9 })] }).some((f) => /nightCount 9 != nights.length 1/.test(f))
);
ok(
  'a short digest is caught',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [good({ codeDigest: 'abc123' })] }).some((f) => /codeDigest is not a 16-hex digest/.test(f))
);
ok(
  'a fold with no source tree is caught',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [good({ srcRoots: [] })] }).some((f) => /srcRoots is empty/.test(f))
);
ok(
  'one night listed twice is caught',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [good({ nights: [good().nights[0], good().nights[0]], nightCount: 2 })] }).some((f) => /lists one night twice/.test(f))
);
ok(
  'an unparseable timestamp is caught',
  ledgerFindings({ schema: LEDGER_SCHEMA, folds: [good({ at: 'last Tuesday' })] }).some((f) => /\.at is not a parseable timestamp/.test(f))
);
ok('a non-object ledger is named, not crashed on', ledgerFindings(null).length === 1 && ledgerFindings([]).length === 1);

console.log(`fold-provenance: ${pass} passing, ${fails.length} failing`);
for (const f of fails) console.log(`  ✕ ${f}`);
process.exit(fails.length ? 1 : 0);
