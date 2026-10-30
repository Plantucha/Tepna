# tepna-capture — journal_logging.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""One owner for the severity a journald-consumed stream expresses: the `<N>` prefix and its installer.

VIGIL-COEXISTENCE-AND-RANGE §1. systemd assigns ONE priority to a service's whole stdout stream, so with
a plain `basicConfig` every line — INFO, WARNING, ERROR alike — lands in the journal at priority 6.
Measured 2026-07-26: 33 application warnings in one daemon lifetime while
`journalctl -u tepna-capture -p warning` returned NOTHING. The severity was printed in the text but never
*expressed*, so every standard operator tool (`-p warning`, `-p err`, journald alert rules, log-shipping
severity filters, systemctl's red-line extraction) came back clean on a box that had 33 warnings. The
overnight watch made exactly that mistake five times.

The fix is a syslog priority prefix: systemd parses a leading `<N>` when `SyslogLevelPrefix=yes`, which
is the DEFAULT, so this needs no unit change and no new dependency. `python3-systemd`'s JournalHandler is
the other option and is deliberately NOT taken — it adds a dependency to an appliance whose SOUP list is
intentionally empty, and it reframes every line.

Row `2026-10-30-the-journal-priority-formatter-is-duplicated-in-radioclock` is why the code lives here
rather than in `capture.py`. `radioclock.py` needed the same expression on 2026-10-30 and copied the map,
the formatter and the installer, which left two copies with no test holding them equal: an edit to the
scale in one file would have moved one unit's journal and not the other's, and the drift would have shown
up only as an operator filter that worked for one unit. `journal_line.py` settled the same question for
the line grammar — the shape has one owner from here, and each unit keeps only the proof that it calls
this one.
"""

from __future__ import annotations

import logging
import os

#: The level name stays in the TEXT as well as in the prefix, so a reader who pipes the journal through
#: anything that drops its metadata still sees the severity.
LOG_FORMAT = "%(asctime)s %(levelname)s %(message)s"

#: 4 is the one that matters: WARNING is the level `-p warning` filters on. The rest are pinned so an
#: edit cannot quietly shift the scale under an operator's filter.
SYSLOG_PRIORITY = {logging.CRITICAL: 2, logging.ERROR: 3, logging.WARNING: 4, logging.INFO: 6, logging.DEBUG: 7}


class PriorityFormatter(logging.Formatter):
    """Prefix each record with its syslog priority so journald can filter on severity."""

    def format(self, record: logging.LogRecord) -> str:
        return f"<{SYSLOG_PRIORITY.get(record.levelno, 6)}>" + super().format(record)


def install_logging(stream=None) -> logging.Formatter:
    """Configure root logging; add the `<N>` prefix ONLY when journald is consuming the stream.

    🔴 THE LINE MUST REACH THE JOURNAL. Measured 2026-10-30 on `radioclock.py`: the entry point
    configured no handler at all, so every `log.info` fell to logging's last-resort handler at WARNING
    and was DROPPED. A unit's outcomes are indistinguishable to a reader until its line is readable, and
    that unit's whole output was a silent exit 0.

    The discriminator is systemd's own `JOURNAL_STREAM`, not `isatty()`: a run whose output is redirected
    to a file is equally not-a-TTY, and prefixing there would just corrupt the file with `<6>` markers
    nothing parses. Absent that variable we are interactive or file-logged, so the plain format is used
    and the prefix never reaches a human's console.

    ⚠️ NO `force=True`. This is a no-op when the root logger already has handlers, which is what the
    plain `basicConfig` it replaced did. `force=True` looks harmless here and is not — it *removes* every
    existing root handler, which under pytest is `caplog`'s, so any test that drives a `main()` and then
    asserts on `caplog.records` silently sees an empty list. Measured: it broke four such tests
    (`test_shutdown_names_a_task_that_ignores_cancellation` and three siblings) while the logging itself
    worked perfectly. A caller wanting a specific sink passes `stream` and clears the root handlers first.
    """
    fmt: logging.Formatter = (
        PriorityFormatter(LOG_FORMAT) if os.environ.get("JOURNAL_STREAM") else logging.Formatter(LOG_FORMAT)
    )
    handler = logging.StreamHandler(stream)
    handler.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    return fmt
