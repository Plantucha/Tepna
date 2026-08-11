<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Test oxydex computeSmartSummary — the fleet's LARGEST survivor cluster (166), untested. 72 now die.

It turns a night into scored metric cards and is almost entirely threshold ladders:

  minSpo2:  >= 93 ? 0 : >= 90 ? 3 : >= 87 ? 5 : >= 85 ? 7 : 10
  t95:      <  1 ? 0 : <  5 ? 2 : < 10 ? 4 : < 20 ? 6 : < 30 ? 8 : 10

The survivors are the BOUNDARIES, and only a value sitting exactly ON one separates >= from >. A
realistic night lands mid-band and sees none of them. 21 metrics are now tabled, each checked at the
boundary and one step either side, plus the severity cut-points (score < 3 / < 6) and the cs/uars
pair, which are score*3 with a `=== 1` severity pin rather than ladders.

Three contract errors found by measurement rather than by reading:
- computeSmartSummary returns { ranked, top5, impression, overallScore }, NOT a bare array. The first
  version assumed an array and reported every metric "absent" — 0 useful assertions while looking
  green in count.
- sleepEff and WASO% sit in an `else if (n.motSleep)` and run ONLY when sleepArch is absent. With
  both blocks present sleepArch wins and that arm is dead, so those rows needed a fixture with
  sleepArch removed.
- push() drops null and undefined but KEEPS zero, which is a different thing and is now asserted.

Also fixes #1163's CI failure, which was not lint: `npm ci` refused because c8 was added to
devDependencies with --no-save, so package-lock.json never contained it. c8 now runs via
`npx -y c8@10.1.2`, matching how this repo already pins typescript for typecheck — the lockfile is
untouched and 88 packages stay out of the dependency tree.
