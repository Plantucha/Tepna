---
bump: patch
type: fixed
brief: none
---
An undated ECG recording exported **1970-01-01 00:00:00** as its date. `new Date(0)` renders a perfectly valid-looking instant that a consumer reads as the recording's date and that sorts before every real one — in-band, and unreachable by any plausibility guard.

The repo had already settled this everywhere else, WITH TESTS — *"§∅ · no recording anchor ⇒ the timestamp is null, not 1970"*, *"null never coerces to a 1970 stamp"*, *"RRacc epoch times stay relative (never 1970-ms)"*. The two CSV/text exports are what that pass did not reach. `exportRR` even contradicted itself: the filename said `_undated` while every row inside carried a 1970-based absolute stamp.

Both now emit an EMPTY stamp. The RR handoff is a cross-node contract, so the twin drives PulseDex's real `parseRRInput` rather than trusting the format note: the undated file still yields its three intervals, the RR values survive the empty column, and the anchor comes back **null** — while the dated control returns a real anchor, so the case cannot pass on a parser that reads nothing.

⚠️ One existing assertion was SUPERSEDED IN PART and is reconciled rather than deleted: *"RR / Welltory-CSV exporters anchor an undated recording at 0, never now()"* had two halves. **Never now()** is the invariant FOLLOWUPS §1 earned when it retired `_floatNow()`, and it is kept — strengthened, in fact, to forbid `_floatNow` anywhere in the file. **Anchor at 0** was the other half, and 0 was never a refusal.
