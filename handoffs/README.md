<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff files — one session, one unit

A handoff file starts one Claude session on one work unit. The session reads the file. The session
does the unit. The session writes the file back with `**state:** DONE`. The session then exits.

`tools/unit-launch.sh` reads a handoff file and launches that session.

## Where a handoff lives

Write the file at `handoffs/<unit-slug>.md`. Use a short kebab-case slug. The slug names the unit, not
the bird. The launcher takes the slug from the filename.

## The nine fields

Write all nine fields. The launcher refuses a file with a missing or empty field. Write each field on
one line, in this shape: `**field:** value`.

| field | what it holds |
|---|---|
| `state` | `READY` before the launch. `RUNNING` while the session works. `DONE` when the unit is finished. |
| `unit` | One sentence. What this session must deliver. |
| `bird` | The lane that owns the unit, in lower case. The session signs this name in `Fleet-Session:`. |
| `branch` | The branch to create, as `claude/<slug>-<3 chars>`. |
| `worktree` | The worktree path to create, as `../wt-<slug>-<3 chars>`. |
| `doc-search` | The Rule 0 query that finds the prior work. The session runs it first. |
| `stopping-point` | Where the last session stopped, as `file:line` or a command. Write `not started` for a new unit. |
| `next-step` | One sentence. The first thing the session does after the search. |
| `done-when` | The acceptance test. Write a condition a stranger can check. |

Write open questions and blockers under `## Open questions`. The launcher does not read that section.
The session does.

## Keep the file under 40 lines

A handoff is an entry point, not a brief. Put the reasoning in a brief and cite it. Put the evidence
in the PR body. A long handoff costs the new session the context the launch was meant to save.

## The agent name is an address, not a seventh bird

The launcher names the session `<bird>-<slug>`. Herdr requires a unique name among live agents, so a
unit session can never take the name of a live bird. The name is an address for `herdr agent prompt`.
The `bird` field, not the name, says who owns the work. The roster stays at six.

## The exit path

A unit session ends its own unit. It writes `**state:** DONE` into the handoff file. It then **commits
that file on its own branch**. It then runs `/exit`. The launcher never kills a session, and it never
restarts one.

**Commit the handoff, or `DONE` does not travel.** The launcher copies the handoff into the new
worktree, so an uncommitted edit lives only there. The first smoke run left `DONE` in the worktree and
committed nothing, which told the next reader nothing (measured 2026-10-11).

**This applies to unit sessions only** (owner ruling 2026-10-11). A unit session is disposable, so it
exits when its unit is done. The six named birds never exit themselves, because a restart is the
owner's call. Read the `bird` field to tell the two apart: the field names the lane that owns the
work, and the session carrying that name is not the session this file launched.
