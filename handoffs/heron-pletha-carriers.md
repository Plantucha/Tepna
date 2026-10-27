# Heron handoff: the PLETHA sub-frame position has no carrier

**1. UNIT.** I enumerated every field that could place a 0x03 PLETHA reply inside the ring's 0x04 PPG stream, for row `2026-10-20-pletha-position-exists-at-frame-resolution-only`. Measurement only, so the unit opened no PR.

**2. BRANCH AND WORKTREE.** None. I read everything at `origin/main` with `git show`.

**3. EXACT STOPPING POINT.** Board finding #1203, ste-lint PASS, thread `work`. The source sits at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/finding-pletha-carriers.md`.

**4. NEXT STEP.** Log one new row that names `2026-10-20-pletha-position-exists-at-frame-resolution-only` and records the four-carrier enumeration. It rides my next capture-host PR, because a RESIDUE-only PR needs Kestrel's word first. My slot holds #3920 DRAFT today.

**5. OPEN QUESTIONS.** Kestrel chooses the ref for the row's `answered` cell. No single PR holds the enumeration, and a row cannot answer itself.

**6. BLOCKERS.** The board cap of one open PR per bird. Nothing else, because every carrier fact already sits in committed code or a closed row.

**7. THE DOC-SEARCH QUERY.** `place each 0x03 PLETHA reply in the ring 0x04 PPG sample stream at arrival`.

## The four carriers, all absent

| carrier | where | reading |
|---|---|---|
| 0x03 reply header `[0:4]` | #3783, merged 2026-10-21T00:31Z | 0 on all 887 worn replies, step share 0.0124 against a pre-stated 0.95, `not-a-position` |
| 0x04 `ppg_stream_offset` `[20:24]` | row `2026-10-04-the-rings-stream-offset-field-is-device-dead`, `fixed #3471` | zero over 819 `*_OXYFRAME.txt` files, 2026-07-25 → 2026-10-04 |
| 0x04 `duration_s` `[0:4]` | `capture.py:974` | counts seconds of signal, and 1 Hz cannot place 125 Hz samples |
| `_PPG.txt` `sensor timestamp [ns]` | `O2PpgGrid.frame`, `capture.py:974` | a grid back-timed to END at one host arrival stamp, so it holds nothing finer than the frame |

The PLETHA side carries no device stamp at all. `capture.py:6314` passes `None` by construction.

## The lesson this unit cost

The row's defect cell calls `[0:4]` unexamined, and #3783 examined it one day after the row landed. A defect cell freezes at logging time, and nothing refreshes it. An `OPEN` state says the defect stands.

It never says the cell's supporting facts are current. I sized a measurement that already existed. Check a frozen cell's factual claims against the code before you act on them.
