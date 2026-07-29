<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
---
`capture-host/nightqc.py` decides cross-midnight pooling by **contiguity with the neighbour**, not by how close to midnight the folder happened to open — so a night whose device takes more than an hour to reconnect is no longer judged as two broken halves.

**The defect, measured on the real box.** Pooling was gated on `0 <= earliest - midnight < _SESSION_GAP_SEC`. That proxy — *"did this folder open just after midnight"* — stands in for *"does last night's session continue here"* only while the reconnect is quicker than the gap. On **2026-07-28** the H10 dropped at 01:08:10 and returned at **01:08:59** — 4101 s past midnight, **501 s over the gate** — so its 107 MB `01:08→05:03` half landed in tomorrow's folder with pooling switched off. The night was then judged twice, and wrong both times:

| folder | H10 | Verity | O2Ring | verdict |
|---|---|---|---|---|
| `2026-07-28` | ecg **0.53**, silent 12414 s | full | full | `ok: false` |
| `2026-07-29` | ecg 1.0 | `coverage {}` | `coverage {}` | `ok: false` |

A complete **7.7 h tri-device night** read as two partial ones, and the alert fired on the half that looked worse. This is the same false-alarm shape as the sidecar-decoy case fixed in `7457a49`, arriving by a different route: that fix handles a post-midnight folder holding *only* sidecars, and this one is a folder holding **real capture data on both sides of midnight**, where `searched_dirs` stayed single.

**The fix.** Ask the neighbour instead of guessing from the clock: pool when the previous folder's last write actually runs into this folder's earliest session, within the same `_SESSION_GAP_SEC` that defines a session everywhere else in the file. Contiguity is the property the proxy was approximating, and unlike the proxy it does not care how long the reconnect took. The cheap near-midnight gate still answers the common case for free and short-circuits before the probe.

`prev_probe_window()` bounds only **where the question is asked**, never what is accepted — a capture opening at 15:00 cannot be last night's, so it never pays for the extra directory scan. Noon is deliberately generous: the cost of being wrong is one scan; the cost of being too tight is a night judged as two halves. The pooling decision itself remains contiguity, so a 02:00 sitting whose neighbour stopped at 18:00 yesterday is still **not** pooled — the probe widens the question, not the answer.

Also drops a dead `if prev:` guard: `prev_probe_window` already required a parseable midnight, which is the same folder-name parse `_prev_day_dir` does, so its false branch was unreachable. Removing it beats writing a test for an impossible state.

3 regression tests built from the real 2026-07-28 layout, **mutation-checked** (disabling the probe fails exactly the reconnect case and nothing else): the >gap reconnect pools and reads ~1.0 instead of 0.53; a non-contiguous 02:00 sitting inside the probe window stays unpooled; and known answers for the probe window itself. `pytest` **1646 passed**, **100.00 %** statement + branch coverage, `ruff` clean.

Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture.
