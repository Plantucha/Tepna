/**
 * tools/argv-guard.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * REFUSE AN ARGV TOKEN NOBODY READS. Residue
 * `2026-09-28-trio-batch-ignores-an-unknown-flag-so-a-near-miss-writes-the-corpus`.
 *
 * The idiom across `tools/` is `const flag = (n) => argv.includes(n)` and `opt(n, d)`: each looks up only
 * the names it knows, so a token nobody looks up is INDISTINGUISHABLE FROM AN ABSENT ONE. That is not a
 * cosmetic gap, because the default is not neutral — it is whatever the tool does when the flag is off,
 * and for a dry-run flag that is the WRITING branch.
 *
 * MEASURED, 2026-09-28: `node tools/trio-batch.mjs --src … --out uploads/trio --dry` (for the documented
 * `--dry-run`) printed a per-night plan, computed to `[3/92]`, and WROTE — leaving two exports of an
 * unstamped night modified — while the operator believed nothing was being written and the tool's own help
 * promised "compute nothing, write nothing". One character silently selected the opposite meaning.
 *
 * Same shape as a `--group=` or `-k` filter that matches nothing and reads as a pass (`CLAUDE.md` §4b):
 * **a token the tool cannot interpret must refuse, not default.** The cost of refusing is a retyped
 * command; the cost of defaulting is measured above.
 *
 * ⚠️ ARITY IS PART OF THE SPEC, not a detail. `--night 2026-06-20` and `--out path` pass a VALUE that is
 * not a flag, and a guard that walked tokens without knowing which flags consume one would refuse every
 * valued invocation — turning a correctness fix into a tool nobody can run. So the caller declares
 * `valued` and `boolean` separately, and a valued flag with no value after it is itself a refusal (a bare
 * `--night` is a mistake worth catching: `opt` would silently hand back its default).
 *
 * ⚠️ THE SPEC IS WHAT THE CODE READS, NOT WHAT THE HELP DOCUMENTS. trio-batch reads four flags its header
 * never mentions (`--cpap`, `--only-node`, `--allow-partial`, `--child`), and a guard built from the help
 * would refuse its own child dispatch. Enumerate from the `flag(`/`opt(`/`optAll(` call sites.
 */

/** Levenshtein distance, for "did you mean". Small inputs; clarity over speed. */
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(prev[j] + 1, prev[j - 1] + 1, carry + cost);
      carry = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

/** The closest known flag to `tok`, or null when nothing is close enough to be worth suggesting. */
export function nearestFlag(tok, known) {
  /* PREFIX BEATS EDIT DISTANCE, and the measured case is why. `--dry` is edit-distance 2 from `--src`
     (two substitutions) and 4 from `--dry-run` (a four-character suffix), so a pure-distance suggestion
     answers "did you mean --src?" for the one slip this module exists to catch. A token that is a PREFIX of
     a real flag is an abbreviation, which is a different and much likelier mistake than a typo, so it is
     tried first; the shortest such flag wins, since that is the least the caller left off. */
  const prefixed = known.filter((k) => k.startsWith(tok)).sort((a, b) => a.length - b.length);
  if (prefixed.length) return prefixed[0];
  let best = null;
  let bestD = Infinity;
  for (const k of known) {
    const d = editDistance(tok, k);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  /* Otherwise a suggestion is only worth making if it is plausibly what was typed — within half the
     token's length, floored at 2 so a short token cannot match anything by accident. */
  return bestD <= Math.max(2, Math.floor(tok.length / 2)) ? best : null;
}

/**
 * `{ ok: true }` when every token is interpretable, else `{ ok: false, reason }`.
 *
 * Pure: it neither prints nor exits, so a test can assert the REASON rather than a process code, and the
 * caller decides the exit. `refuseUnknownArgvOrExit` is the two-line adoption for a tool's main path.
 */
export function checkArgv(argv, { valued = [], boolean: bools = [], positional = false } = {}) {
  const known = [...valued, ...bools];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('-')) {
      if (positional) continue;
      return { ok: false, reason: `unexpected argument ${JSON.stringify(tok)} — this tool takes flags only` };
    }
    /* `--flag=value` is not this codebase's idiom (`opt` reads the NEXT token), so accepting it would let a
       caller write a form the tool then ignores — the very failure being fixed, one layer along. */
    if (tok.includes('=')) {
      const bare = tok.slice(0, tok.indexOf('='));
      return {
        ok: false,
        reason: known.includes(bare)
          ? `${tok} — this tool reads a value as the NEXT argument, so write \`${bare} <value>\``
          : `unknown flag ${tok}`,
      };
    }
    if (bools.includes(tok)) continue;
    if (valued.includes(tok)) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('-')) {
        return { ok: false, reason: `${tok} needs a value, and none followed${val === undefined ? '' : ` (got ${val})`}` };
      }
      i++; // consume the value, so it is never mistaken for a token of its own
      continue;
    }
    const near = nearestFlag(tok, known);
    return { ok: false, reason: `unknown flag ${tok}${near ? ` — did you mean ${near}?` : ''}` };
  }
  return { ok: true };
}

/**
 * Adoption in two lines: refuse before the tool does anything. EXIT 2, not 1 — a usage error is not a
 * failed run, and a caller that greps for a red must be able to tell "I typed it wrong" from "the thing
 * you asked about is broken".
 */
export function refuseUnknownArgvOrExit(argv, spec, { tool = 'this tool' } = {}) {
  const v = checkArgv(argv, spec);
  if (v.ok) return;
  console.error(`✗ ${tool}: ${v.reason}`);
  console.error(`  accepted: ${[...(spec.valued || []), ...(spec.boolean || [])].sort().join(' ')}`);
  console.error('  nothing was read and nothing was written.');
  process.exit(2);
}
