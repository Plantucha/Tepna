---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

Route the box's `_ECGSEAMS.txt` clock-seam sidecar through the browser drop path into ECGDex.
`dex-ingest.js` gives the ECG spelling its own kind, bucket and companion lane, and the app pairs
it by filename stamp beside the blanking sidecar. One exported attach body now serves both of the
app's parse roads, so a drop over 5 MB or of more than one part — every real overnight recording —
carries its validity for the first time.
