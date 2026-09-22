---
bump: patch
type: changed
brief: none
---

Three residue rows from the corpus re-fold. The first is a gap in CLAUDE.md §👥.4 itself: the
`EXIT=` sentinel (option 3) cannot terminate when the PRODUCER is SIGKILLed — §4c's own scenario —
so the waiter is immortal and reads exactly like a slow gate. Measured with a positive control:
the same `kill -9` leaves option 3's log 0 bytes with no sentinel, while option 2 (own the PID)
exits after one poll and reports 137. Two of this session's waiters had spun 2 h 08 min past their
producer's death. The other two rows record the consumer half of the corpus staleness question and
the two halves of the filename-stamp defect that #2846 did not touch.
