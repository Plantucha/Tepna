// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { buildRecord, fileSetDigest, mountOf } from '../tools/fold-provenance.mjs';

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

console.log(`fold-provenance: ${pass} passing, ${fails.length} failing`);
for (const f of fails) console.log(`  ✕ ${f}`);
process.exit(fails.length ? 1 : 0);
