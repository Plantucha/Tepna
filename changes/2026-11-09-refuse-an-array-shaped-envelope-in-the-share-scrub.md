---
bump: patch
type: fixed
brief: none
---

Refuse an array-shaped envelope in the share-scrub. `typeof [] === 'object'`, so an array passed the
envelope guard in `_scrubWith` and reached the allow-list, which returns an array verbatim. The scrub
then wrote its mark to a non-index property, and `JSON.stringify` drops that property. Measured
against the previous code over a synthetic envelope: the in-memory mark reads `true`, the serialized
mark is ABSENT, and the upload filename, the input sha256 and an undeclared key all survive. The
scrub now throws on an array, which is the stance the same function already takes when the allow-list
is absent. Three test legs hold it, and the refusal leg reds against the previous code.
