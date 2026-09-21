---
bump: patch
type: fixed
brief: none
---

Make the box updater read the sha the daemon is actually running from the daemon's own `/api/version` instead of from the deploy marker — which records what the updater last deployed and goes stale after any restart it did not make, so the content gate then diffed code the daemon already had and fired a redundant restart at the first doff of the night; the marker remains the fallback, labelled as such whenever a restart decision rests on it, and every log line now says whose sha it is quoting.
