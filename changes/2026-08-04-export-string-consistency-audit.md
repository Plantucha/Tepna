---
bump: patch
type: changed
nodes: []
brief: DEX-CITATION-FORMULA-AUDIT-BRIEF.md
---

Audits whether committed output layers still carry the runtime strings their code emits, the audit's last
open acceptance item. Deep-walked 215 committed artifacts under uploads/ for values keyed Method, Note or
Label, giving 269 distinct strings, and required each to be traceable to current source.

The naive literal check is useless here, reporting roughly forty percent false positives, because these
strings are built three ways: as literals, by interpolation (one oxydex-dsp template accounts for 38
apparent misses), and by concatenation (an ecgdex-app expression that never exists as a whole literal
anywhere). Four successive narrowings were needed and each residue turned out to be template output
rather than staleness.

One string is genuinely stale. uploads/qrs-yield-stats.json carries an ECG-arm note saying the
reconstructed rMSSD is attenuated and certified for yield only, which no source emits; the tool now emits
a note saying that arm is faithful and is the reference arm. The sibling PPG note matches source exactly,
so it is one arm rather than an orphaned field, and papers/qrs-yield.html already uses the corrected
framing -- the tool and the paper were updated and only the committed artifact was left behind.

The two strings make opposite claims about whether that arm's rMSSD can be trusted, so this is not
cosmetic. It is routed rather than fixed: the artifact is regenerable, but re-running it is a fresh
Monte-Carlo pass that would move every number in a published paper's stats file, and changing a paper's
numbers to correct one caveat is an owner call.
