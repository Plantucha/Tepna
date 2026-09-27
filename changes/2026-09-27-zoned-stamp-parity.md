---
bump: patch
type: fixed
brief: none
---

A zoned host stamp no longer costs a night its verdict. `solid_night_inputs.recorded_seams` and `residual_scan` parsed `Phone timestamp` with `datetime.fromisoformat`, which returns an AWARE value for a zoned stamp; comparing it against the naive worn-interval bounds raised TypeError, which is not the ValueError the readers catch, so it escaped to the solid-night poller and the night was written with no verdict at all — read downstream as unassessed. Both now use `nights_index.parse_host_stamp`, a sibling of the existing zone-safe `parse_stamp` that keeps the sub-second digits these two readers measure with. Clock Contract §2 rule 2: a zoned stamp reaches the same floating time as its zoneless twin.
