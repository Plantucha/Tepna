---
bump: patch
type: fixed
brief: none
---

`how-to-collect/muse-eeg.md` warned about a constraint that stopped existing on the day it was
written. It said muse-lsl and BlueMuse FAIL on the Muse S Athena, that OpenMuse was required, and told
a reader to "confirm your model before buying into a toolchain" because "it flips muse-lsl to
OpenMuse".

Upstream added Athena support in `74fcb916` on 2026-06-30 — the same day — released as v2.5.0 on
2026-07-01, and mapped `--ppg` to the Athena optics stream in `c5a327b4` on 2026-09-08 (v2.5.2/2.5.3).
So for eleven weeks the guide's central buying advice was inverted, and the cost of believing it was
choosing the worse toolchain or avoiding the better device for an expired reason.

Corrected: muse-lsl covers Gen 1-2 and Athena from v2.5.0, with PPG from v2.5.2. OpenMuse is demoted
to an alternative, and a stale one — last push 2026-01-28, 10 open issues including #27 OPTICS/PPG
channels flatlining and #24 incorrect optical channel mapping, both untouched since May/June 2026 and
both in the optics path a PPG capture depends on.

EVERY UPSTREAM CLAIM WAS VERIFIED INDEPENDENTLY rather than relayed, via the GitHub API: both commit
SHAs and their dates, the three release dates, and OpenMuse's push date and issue list. One relayed
figure was wrong and is corrected here — OpenMuse's last push is 2026-01-28, not 2026-01-19.

THE GENERALISATION IS IN THE GUIDE, not only in this changeset: a claim about a third-party project is
a SNAPSHOT and needs a date and a version, or a reader cannot tell what it is a snapshot OF. A local
doc resolves which tools EXIST; it cannot establish what they SUPPORT today. Currency is not
inheritable — not from a doc's recency, and not from its having been right last time. Every toolchain
claim in that section now carries its version and the date it was checked.

⚠️ MACHINE-READABLE, NOT MACHINE-CHECKED — stated in the guide as the limit. The claims carry a SHA, a
version and a date so a reader or a tool can see what they are a snapshot of, but NO GATE CAN VERIFY
THEM: checking an upstream repository needs network, and no gate or bundle here may have it. So this
is a dated claim a human re-checks, not a check that reds when it goes stale. Which of those you have
is the thing to say out loud, because a dated claim reads as verified long after it stops being true.

The stale text is quoted inside the correction rather than deleted, so a reader who remembers the old
advice can see it was withdrawn and why.

Also logged, not fixed: residue `2026-09-19-capture-muse-tool-switch-encodes-stale-assumption` —
`capture.py`'s `run_muse` still carries an `openmuse` branch encoding the same expired assumption.
Nothing is broken, the branch encodes rather than acts, and it may still be wanted as a fallback, so
it is a row rather than an edit. Whether any caller reaches it is stated as UNASSESSED.
