---
bump: patch
type: fixed
brief: PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md
---

**Fourteen tools could not see one of the two names the Verity is written under. Six in this lane are
fixed; the rest are flagged.**

`ppi-jitter-vs-ecg.mjs` was fixed earlier today (#1489) after matching **0 of 1980** files on the PSL
tree. A sweep shows it was not alone — **14 tools** matched `VeritySense` only, so none of them could see
`Polar_Sense_<serial>`, the spelling Polar Sensor Logger writes. Same armband, identical serial
`0C301E3F`; PpgDex's own equivalence input uses the PSL spelling.

**Control:** on the PSL corpus the old pattern matches **0** files, the new one **54**.

Fixed here (this lane): `pat-connection-stability` · `pat-ppg-ppg-control` · `pat-dip-index` ·
`pat-dip-validate` (ACC pattern) · `ppg-fusion-e3` · `ppg-foot-consensus-e1`.

Still blind, other lanes — flagged, not touched: `acc-acc-control` · `device-stability` ·
`dual-clock-rate` · `wearable-sync` · `known-clock-recovery` · `beat-error-recovery` · `trio-batch`.

**Why it matters beyond tidiness.** `PPGDEX-MULTICHANNEL-FUSION` §2 is blocked on *"only 6 of 12 nights
produce a physiologically plausible rMSSD, so the corpus cannot yet decide"* — measured with
`ppg-fusion-e3`, which is one of the blind tools. That verdict was reached on a corpus a whole tree
smaller than the one on disk. It does not follow that more nights fix it (six of the twelve fail for a
real reason — the beat-alternation defect), but *"the corpus cannot decide"* was concluded without the
corpus being fully visible.

⚠️ **`pat-connection-stability.mjs` is mine, shipped today with the defect.** Its within-connection
result (n = 2) ran on the vigil tree, where the old pattern works — so that measurement stands — but the
tool would have been blind on the PSL tree.

Regression-checked: `pat-ppg-ppg-control` on a vigil night returns byte-identical output before and
after (−38 ms, 89 % strict, ratio 13.18). `lint` 0.
