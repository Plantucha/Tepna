# tepna-capture — tests/test_as11_detector_read_only.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# AS11-SESSION-DETECTOR-IMPLEMENTATION's third done-when item: "READ-ONLY confirmed by source scan (no
# Set/Enter*/SetDateTime anywhere in the new code); Clock Contract untouched."
#
# 🔴 IT WAS CONFIRMED BY READING, AND BY NOTHING ELSE. Both modules assert the property in a COMMENT —
# `cpap_supervisor.py:13` ("this core NEVER calls Set / EnterTherapy / EnterStandby") and
# `cpap_shadow_runner.py:15` ("only establish + get_items (Get) + get_date_time — never
# Set/Enter*/SetDateTime") — and until this file nothing enforced either sentence. A safety property
# whose only evidence is a comment can regress in one line, silently, and the comment will still be
# there saying it did not. When a comment asserts coverage, that sentence is a testable claim.
#
# WHY THE SCAN STRIPS COMMENTS AND KEEPS STRINGS, which is the whole trick here: an AS11 operation is
# a METHOD STRING handed to `as11_link.rpc(method, …)`, not a Python attribute — so a scan that
# stripped string literals (as `find_unwired._code_only` does, correctly, for its own purpose) would
# be blind to exactly the thing being forbidden. And a scan that kept comments would fail on the two
# sentences above, which name the forbidden verbs in order to promise they are absent.

import re
import tokenize
import io

import pytest

from _srcscan import module_source

# The detector path this brief added. `as11_pull`/`as11_link` are deliberately NOT in scope: they are
# the shared protocol layer and legitimately BUILD state-changing frames for other callers to use —
# the claim is about what the DETECTOR reaches for, not about what the library can express.
DETECTOR_MODULES = ("cpap_supervisor.py", "cpap_detect.py", "cpap_shadow_runner.py")

# `Set…` and `Enter…` in AS11's method vocabulary. Anchored on the capital so ordinary Python
# (`settings`, `enter`, `set_`) does not match; these are protocol verbs, not local identifiers.
FORBIDDEN = re.compile(r"\b(Set[A-Z]\w*|Enter[A-Z]\w*)\b")


def _code_and_strings(src: str) -> str:
    """Executable text with COMMENTS removed and STRING LITERALS KEPT — see the header."""
    try:
        return " ".join(
            t.string for t in tokenize.generate_tokens(io.StringIO(src).readline)
            if t.type != tokenize.COMMENT)
    except (tokenize.TokenError, IndentationError, SyntaxError):  # pragma: no cover - parse failure
        return src            # fail toward OVER-reporting: a broken file must not read as compliant


@pytest.mark.parametrize("mod", DETECTOR_MODULES)
def test_the_detector_path_issues_no_device_state_write(mod):
    """The safety property the two comments promise, now enforced."""
    found = sorted(set(FORBIDDEN.findall(_code_and_strings(module_source(mod)))))
    assert not found, (
        f"{mod} reaches for AS11 state-changing operation(s) {found}. This path is READ-ONLY by "
        "design: it observes a therapy session it must never steer, and the brief's own done-when "
        "says so. If this is deliberate, the brief and both module headers have to change first.")


def test_the_scan_FIRES_on_a_planted_write():
    """Anti-vacuity. A source scan that cannot go red proves nothing, and this one has to survive
    comment-stripping without losing the strings the operation names live in."""
    planted = 'async def go(w):\n    await _send(w, L.rpc("EnterTherapy", None))\n'
    assert FORBIDDEN.findall(_code_and_strings(planted)) == ["EnterTherapy"]


def test_the_scan_does_NOT_fire_on_the_comments_that_promise_the_property():
    """The paired direction, and the reason the stripper exists. Both real modules name the forbidden
    verbs in a comment IN ORDER TO promise they are absent; a scan over raw text would fail on the
    promise itself and would have to be silenced — which is how this property would have ended up
    with a test that asserts nothing."""
    promise = '# READ-ONLY: never Set / EnterTherapy / EnterStandby / SetDateTime.\nx = 1\n'
    assert FORBIDDEN.findall(promise), "the raw comment does contain the verbs"
    assert FORBIDDEN.findall(_code_and_strings(promise)) == [], "stripped, it must contribute nothing"
