<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, tooling]
brief: TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md
---
trio-batch can anchor a night on the O2Ring's native `.dat`, not only the vendor CSV — six analyzable nights (2026-07-07 … 07-12) were invisible because the CSV export had stopped while the `.dat` kept landing. OxyDex has decoded this format all along on the browser drop path; the fix exposes `isO2RingBin` / `decodeO2RingBinToCSV` on the namespace (export-inert) so the headless corner reuses the SAME decoder instead of a second copy that would drift. Prefers the vendor CSV when both files exist, and ranks the oxy anchor by duration rather than bytes (a `.dat` is ~10× denser, so bytes stopped being comparable). Equivalence proved on 2026-07-06, the night that has both files: same-code CSV-path ≡ `.dat`-path, zero diffs.
