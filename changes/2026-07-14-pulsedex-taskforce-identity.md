<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
PulseDex: restore the Task-Force identity `vlf+lf+hf == totalPower` on overnight readings (DEEP-AUDIT-2026-07-14 §3). PulseDex was the un-fixed sibling of the DEEP-AUDIT-2026-07-11 §10 fix ECGDex + PpgDex both carry: its overnight `winSpec` took FOUR independent medians (`tp = median(tp_i)`, not `median(vlf_i)+median(lf_i)+median(hf_i)`), so Total Power and the HF/LF fraction bars (`hf/(tp||1)`) surfaced numbers that don't reconcile with the bands beside them (~5–20% on overnight). Fix: `tp` is now the band sum on both spectral paths — the overnight `winSpec` (`tp = vlf+lf+hf`; the per-segment `w.tp`/`stp` accumulator dropped) and the single-window `lombScargle` return (`tp = _v+_l+_h`), mirroring ECGDex:601 / PpgDex. Gated by a PulseDex identity group driven through `computeResult` on a ~1.7 h overnight record (`vlf+lf+hf === tp`; HF fraction matches the true share), verified RED on the old code first (8681 vs 8648). Re-bundled PulseDex + Data Unifier + OverDex. EXPORT-INERT — verified, not asserted: the export omits `tp` (its `hrv.frequency` block is `{lf,hf,vlf,lfhf}`), so all three PulseDex equiv legs reproduce byte-identical and `verifiedUnder` was re-stamped after a green corpus run — no fixture regen, correcting the brief's fix-sketch which wrongly expected a fixture move.
