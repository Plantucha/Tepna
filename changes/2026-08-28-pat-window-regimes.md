---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md
---
PAT forensics §12/§16/§17: ran the per-LED oracle over the full 42-night capture-host corpus,
untruncated. The accepted-PAT distribution falls into four regimes — 37% window-dominated (SD
indistinguishable from 450/sqrt12, the SD of a uniform distribution on the acceptance window, so
the reported SD is a constant of the estimator), 11% edge-loaded ABOVE uniform (the bimodal
signature of the censoring cut), 48% intermediate, and 3.7% (one night) resolving below the 60 ms
bar. Retracts an earlier universality claim that was read off a `tail -40` truncation and was
false in both directions. Four candidate explanations for regime membership eliminated by
measurement: channel quality, per-channel variation, median-lag position, and yield. 36 zero-yield
channel-rows recorded as a first-order selection effect.
