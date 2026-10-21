---
bump: patch
type: fixed
brief: none
---

Read the respiratory events that an ISRUC workbook glues into the heart-rate cell, so they reach the
apnea-hypopnea index. The old loop read the event column alone and dropped every one of them.

The reader takes a token from outside the event column only when the ISRUC vocabulary names it, because
the columns beyond it hold technician notes and the sheet preamble. A token the event cell already holds
counts once. The recovered count, the duplicate count and the count recovered from a row whose event
cell is gone all ride beside the index.
