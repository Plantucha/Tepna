---
bump: minor
type: added
brief: SESSION-SPAN-WRITER-OFFSET-2026-09-28-BRIEF.md
nodes: [capture-host]
---

The capture host records its UTC offset per session in `STARTS.csv`, so a reader no longer has to infer
the writer's zone.

`_phone_ts` is documented "local civil time, zone-free", the filename stamp carries bare components, and
`mtime` is a night's only absolute instant — so relating a connection-open stamp to a last-write instant
forced every reader through `nightqc.recover_writer_offset`, a bounded vote that refuses a night which
captured almost nothing (measured: 2026-09-14, and 2026-08-08 where two killed sessions split the vote
three ways). `utc_offset_sec` is now recorded at session open, where it is known exactly.

⚠️ Recorded AT THE SESSION'S INSTANT, not at `now()`: the offset is a function of the instant, so two
sessions on a DST-change night differ and a `now()`-based reading would stamp both with whichever the
process saw. ∅ Blank when the zone cannot be determined, never 0 — 0 is a real offset, reported by a box
running UTC.

Precedence is now caller's declaration → recorded → inferred, in both `nightqc.summarize` and
`timeline`. A night whose sessions recorded DIFFERENT offsets spans a DST change and refuses one value
rather than publishing a side of it. The column is appended at the tail and read BY HEADER NAME, so a
pre-2026-10-05 five-column file reads as "nothing recorded" rather than as an error.

`find_unwired`'s `declared_offset` allowlist entry is retired: both halves of its own stated condition —
the writer half landing and the daemon passing a recorded offset through — are now met.

⚠️ A WRITER CHANGE IS NOT A DEPLOY. The box records this only after the owner authorises the restart;
until then every night still recovers by vote, which is why the inference is kept rather than removed.
