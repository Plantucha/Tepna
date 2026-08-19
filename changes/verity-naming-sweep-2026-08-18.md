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

---

**⚠️ THE DEVICE-NAME FIX ALONE WAS HALF A FIX — a second, independent blindness sat one line later.**

Polar Sensor Logger splits the timestamp: `Polar_Sense_0C301E3F_20260610_211539_PPG.txt`. The capture
host writes 14 contiguous digits. `ppg-fusion-e3` and `ppg-foot-consensus-e1` both parsed stamps with

    /_(\d{14})_/ || /(\d{14})/

and a PSL name contains **no 14-digit run at all**, so `stampOf` returned `null`. After the name fix the
file *matched* and was then dropped one line later — **quieter than not matching**: files found, nights
silently absent. Both now also accept `_(\d{8})_(\d{6})_`; verified on real names from both trees. The
other four tools have no stamp parse and were already complete.

**End-to-end control — the one that actually counts.** `ppg-fusion-e3` on the PSL tree, previously
**0 nights**, now returns six:

    consensus (SHIPPED)   jitter median 9.42  IQR 7.32-11.57 ms   PPV 99.64
    best single channel   jitter median 9.43  IQR 7.41-11.80 ms   PPV 99.64
    mean-of-3 fusion      jitter median 9.08  IQR 7.28-11.54 ms   PPV 99.82
    PCA-1 fusion          jitter median 9.08  IQR 7.28-11.54 ms

**5 of 6 are physiologically plausible** (PPV ≥ 99.5 %); the sixth is the known beat-alternation shape
(PPV 32 %, jitter 42.5 ms). Against `PPGDEX-MULTICHANNEL-FUSION` §2's *"only 6 of 12 nights"*, this tree
adds nights at a **better** plausible rate than the corpus that verdict was reached on — and it was
entirely invisible when that verdict was written.

**A device is identified by NAME, STAMP LAYOUT and STREAM SUFFIX — three independent conventions**, and a
capture app may differ on any of them. Fixing one and confirming files are *reachable* does not show
they are *usable*; only running the pipeline end-to-end does. (Third instance, not fixed here because
none of these six touch it: the magnetometer is `MAGN` on PSL against `MAG` from the capture host.)

