---
bump: patch
type: changed
brief: none
---

tools/buzz-fiducial-correlate.mjs emits its run as one tepna.verdict/1 object, and its adoption row stops claiming it decides nothing about data. The criterion is the tool's OWN pre-existing bar rather than a new one: matchSchedule already returns null unless EVERY commanded gap aligns to a detected motion onset within --tol, defaulted to 1.5 s. The two distinguishable nulls are now separated: windows existed and none matched is FAIL, while fewer onsets than gaps+1 is UNDERPOWERED, because FAIL asserts the schedule was looked for and not seen and that claim needs enough onsets to form one candidate window. A daemon capture stays the refusal it already was, mapped to NOT_APPLICABLE - the stream carries the buzz on 6 of 39 fires, so a null alignment is not evidence the schedule did not fire. WO_CLAIM_RATCHET shrinks 7 -> 6.
