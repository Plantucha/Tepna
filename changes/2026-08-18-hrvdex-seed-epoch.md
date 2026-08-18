<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [HRVDex]
brief: FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md
---
An HRV row whose timestamp never parsed came back from persistence **dated to the Unix epoch**, and
then passed the very filter written to exclude it.

**The round trip, measured rather than reasoned:**

    _tMs: NaN  →  JSON.stringify  →  tMs: null  →  +null  →  0  →  _date: 1970-01-01T00:00:00.000Z

`_rowFromSeed` did `r._tMs = +s.tMs`. The coercion happens **before** the `isFinite` guard on the
next line, so the guard cannot help — it sees `0`, which is finite. `JSON.stringify(NaN)` writes
`null`, so the sentinel this file uses for an unparsed stamp (`r._tMs = _ts ? _ts.tMs : NaN`) does not
survive persistence.

**The consequence is worse than a wrong date.** Two callers do `.filter((r) => isFinite(r._tMs))`
*specifically to drop timeless rows* (`hrvdex-dsp.js:362`, `:550`), and `isFinite(0)` is true — so a
clockless row survived the filter written to fail it and entered the analysis dated to 1970.

**`_seedFromRow`'s own comment states the correct discipline** — *"Preserve absence through
persistence: a null transparent field round-trips as null, NOT a fabricated 0 (Finding 1)"* — and
applies it to `offsetMin` and to every seed field. **`tMs` was the single field copied raw.**

Fixed to `s.tMs == null ? NaN : +s.tMs`, preserving the file's existing NaN sentinel rather than
inventing a new one.

**How it was found, which generalises past this bug.** A peer session's mutation work showed that
`isFinite(x)` standing where `x != null` was meant is one character from fabricating, because
`isFinite(null)` is **true** and `Number(null)` is **0**. Sweeping the fleet for that shape: most uses
are correctly guarded (`x == null || !isFinite(x)`, or `typeof x === 'number'`, which null fails).
This one differs because the coercion precedes the guard, so no amount of guarding downstream could
have caught it.

Third instance of `0` as JavaScript's fabrication of choice for an absent quantity, after PpgDex's
`cvhrIndex: 0` (#1464) and PulseDex's `hour: 0` (#1475) — all from `Number(null)`.

Test written first and **seen to fail** (`got "1970-01-01T00:00:00.000Z" · want null`), with a control
asserting a real timestamp still round-trips intact — without it, a fix that nulled every timestamp
would have scored as a pass.
