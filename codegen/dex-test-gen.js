/*
 * dex-test-gen.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
#!/usr/bin/env node
// dex-test-gen.js — Generates synthetic-data tests from a Dex manifest
//
// Usage: node dex-test-gen.js <manifest.json> [--output <file.js>]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node dex-test-gen.js <manifest.json> [--output <file.js>]');
  process.exit(0);
}

const manifestPath = args[0];
let outputPath = null;
const i = args.indexOf('--output');
if (i !== -1 && args[i + 1]) outputPath = args[i + 1];
if (!outputPath) outputPath = path.basename(manifestPath, '.json') + '-tests.js';

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const node = manifest.node;
const analysisModule = path.basename(manifestPath, '.json') + '-analysis.js';
const allMetrics = manifest.sections.flatMap(s =>
  s.metrics.map(m => ({ ...m, sectionId: s.id }))
);

// ── Synthetic data generators per modality ───────────────────────────────────

function genSyntheticDataFn() {
  const modality = manifest.modality.toLowerCase();

  if (modality.includes('cpap') || modality.includes('pap')) {
    return `
function generateSyntheticData(config = {}) {
  const {
    durationHours  = 8,
    pressure       = 10,
    pressureNoise  = 0.2,
    leakBase       = 5,
    leakNoise      = 2,
    maskOnStart    = 0.25,   // hours into recording
    maskOnEnd      = 7.5,
    events         = [],
  } = config;

  const n = Math.floor(durationHours * 3600);
  const timestamps = new Float64Array(n);
  const pressureArr = new Float32Array(n);
  const leakArr = new Float32Array(n);

  const startIdx = Math.floor(maskOnStart * 3600);
  const endIdx   = Math.floor(maskOnEnd * 3600);

  // Seed PRNG for reproducibility
  let seed = config.seed || 42;
  function rand() { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; }

  for (let i = 0; i < n; i++) {
    timestamps[i] = i;
    if (i >= startIdx && i < endIdx) {
      pressureArr[i] = pressure + (rand() - 0.5) * pressureNoise * 2;
      leakArr[i]     = Math.max(0, leakBase + (rand() - 0.5) * leakNoise * 2);
    }
  }

  return {
    timestamps,
    pressure: pressureArr,
    leak: leakArr,
    events: events.map(e => ({ ...e })),
    mode: config.mode || 'CPAP',
  };
}`;
  }

  // Generic fallback — returns empty arrays
  return `
function generateSyntheticData(config = {}) {
  const n = (config.durationHours || 8) * 3600;
  return {
    timestamps: new Float64Array(n),
    pressure:   new Float32Array(n),
    leak:       new Float32Array(n),
    events:     config.events || [],
  };
}`;
}

// ── Test case generation ────────────────────────────────────────────────────

function genTestCases() {
  const cases = [];

  for (const m of allMetrics) {
    const c = m.compute;
    if (!c || c.fn === 'stub') {
      // Stub — generate a skip entry
      cases.push({
        name: m.id,
        skip: true,
        reason: c?.note || 'Not yet implemented',
      });
      continue;
    }

    // Generate a test case based on the compute function
    switch (c.fn) {
      case 'percentile': {
        const source = c.source;
        const p = c.args[0];
        const fixedValue = source === 'pressure' ? 10 : 5;
        const noise = source === 'pressure' ? 0.1 : 1;
        cases.push({
          name: m.id,
          data: `generateSyntheticData({ ${source}: ${fixedValue}, ${source === 'pressure' ? 'pressureNoise' : 'leakNoise'}: ${noise} })`,
          expected: fixedValue,
          tolerance: source === 'pressure' ? 0.5 : 2,
          note: `P${p} of near-constant ${source}`,
        });
        break;
      }

      case 'mean':
      case 'cov':
      case 'iqr':
      case 'sd': {
        const source = c.source;
        const val = source === 'pressure' ? 10 : 5;
        const noise = source === 'pressure' ? 0.1 : 1;
        let expected, tol;
        if (c.fn === 'mean') { expected = val; tol = 0.5; }
        else if (c.fn === 'cov') { expected = 0; tol = 5; } // low noise = low cov
        else if (c.fn === 'iqr') { expected = 0; tol = 1; }
        else { expected = 0; tol = 1; }

        cases.push({
          name: m.id,
          data: `generateSyntheticData({ ${source}: ${val}, ${source === 'pressure' ? 'pressureNoise' : 'leakNoise'}: ${noise} })`,
          expected,
          tolerance: tol,
          note: `${c.fn} of near-constant ${source}`,
        });
        break;
      }

      case 'count_where_div': {
        const [op, thresh, divisor] = c.args;
        // For usageHours: count pressure > 0 / 3600
        // With maskOn 0.25h to 7.5h → 7.25 hours
        cases.push({
          name: m.id,
          data: `generateSyntheticData({ maskOnStart: 0.25, maskOnEnd: 7.75 })`,
          expected: 7.5,
          tolerance: 0.05,
          note: '7.5 hours of mask-on time',
        });
        break;
      }

      case 'first_where_div': {
        cases.push({
          name: m.id,
          data: `generateSyntheticData({ maskOnStart: 0.5 })`,
          expected: 30,
          tolerance: 1,
          note: 'Mask-on at 30 minutes',
        });
        break;
      }

      case 'event_rate': {
        const types = c.eventTypes;
        const denom = c.denominator;
        // Generate 5 known events over 8 hours
        const eventList = types.map((t, i) =>
          `{ type: '${t}', time: ${(i + 1) * 3600}, duration: 20 }`
        ).join(', ');
        const expected = types.length / 8;

        cases.push({
          name: m.id,
          data: `generateSyntheticData({ maskOnStart: 0, maskOnEnd: 8, events: [${eventList}] })`,
          expected,
          tolerance: 0.01,
          note: `${types.length} events over 8 hours`,
        });
        break;
      }

      case 'event_count': {
        const types = c.eventTypes;
        const eventList = types.map((t, i) =>
          `{ type: '${t}', time: ${(i + 1) * 3600}, duration: 20 }`
        ).join(', ');

        cases.push({
          name: m.id,
          data: `generateSyntheticData({ events: [${eventList}] })`,
          expected: types.length,
          tolerance: 0,
          note: `Count ${types.length} ${types.join('+')} events`,
        });
        break;
      }

      case 'pct_above': {
        const [, thresh] = c.args;
        cases.push({
          name: m.id,
          data: `generateSyntheticData({ leakBase: ${thresh - 5}, leakNoise: 1 })`,
          expected: 0,
          tolerance: 5,
          note: `Leak well below ${thresh} threshold`,
        });
        break;
      }

      default:
        cases.push({
          name: m.id,
          skip: true,
          reason: `No auto-test for fn type: ${c.fn}`,
        });
    }
  }

  return cases;
}

// ── Code generation ─────────────────────────────────────────────────────────

function generate() {
  const testCases = genTestCases();
  const syntheticFn = genSyntheticDataFn();

  const testEntries = testCases.map(tc => {
    if (tc.skip) {
      return `  { name: ${JSON.stringify(tc.name)}, skip: true, reason: ${JSON.stringify(tc.reason || '')} }`;
    }
    return [
      `  {`,
      `    name: ${JSON.stringify(tc.name)},`,
      `    data: ${tc.data},`,
      `    expected: ${tc.expected},`,
      `    tolerance: ${tc.tolerance},`,
      `    note: ${JSON.stringify(tc.note || '')},`,
      `  }`,
    ].join('\n');
  });

  const lines = [];

  lines.push(`/**`);
  lines.push(` * ${node} Test Harness`);
  lines.push(` * Generated from manifest v${manifest.version} by dex-test-gen.js`);
  lines.push(` *`);
  lines.push(` * Run: node ${path.basename(outputPath)}`);
  lines.push(` *`);
  lines.push(` * Tests use deterministic synthetic data (seeded PRNG) to verify`);
  lines.push(` * each compute function produces expected values within tolerance.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`const ${node} = require('./${analysisModule}');`);
  lines.push(``);

  // Synthetic data generator
  lines.push(`// ── Synthetic data generator ──`);
  lines.push(syntheticFn);
  lines.push(``);

  // Test definitions
  lines.push(`// ── Test definitions ──`);
  lines.push(``);
  lines.push(`const TESTS = [`);
  lines.push(testEntries.join(',\n'));
  lines.push(`];`);
  lines.push(``);

  // Runner
  lines.push(`// ── Runner ──`);
  lines.push(``);
  lines.push(`function runTests() {`);
  lines.push(`  let passed = 0, failed = 0, skipped = 0;`);
  lines.push(``);
  lines.push(`  console.log(\`\\n  ${node} Test Harness — \${TESTS.length} tests\\n\`);`);
  lines.push(``);
  lines.push(`  for (const t of TESTS) {`);
  lines.push(`    if (t.skip) {`);
  lines.push(`      console.log(\`  ⏭  \${t.name} — \${t.reason}\`);`);
  lines.push(`      skipped++;`);
  lines.push(`      continue;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    try {`);
  lines.push(`      const results = ${node}.analyze(t.data);`);
  lines.push(`      const actual = results[t.name]?.value;`);
  lines.push(``);
  lines.push(`      if (actual === undefined) {`);
  lines.push(`        console.log(\`  ⚠  \${t.name} — not in analyze() map\`);`);
  lines.push(`        skipped++;`);
  lines.push(`        continue;`);
  lines.push(`      }`);
  lines.push(``);
  lines.push(`      const diff = Math.abs(actual - t.expected);`);
  lines.push(`      const pass = diff <= t.tolerance;`);
  lines.push(``);
  lines.push(`      if (pass) {`);
  lines.push(`        console.log(\`  ✓  \${t.name}: \${actual.toFixed(4)} (expected \${t.expected} ± \${t.tolerance})\`);`);
  lines.push(`        passed++;`);
  lines.push(`      } else {`);
  lines.push(`        console.log(\`  ✗  \${t.name}: \${actual.toFixed(4)} (expected \${t.expected} ± \${t.tolerance}, diff \${diff.toFixed(4)})\`);`);
  lines.push(`        failed++;`);
  lines.push(`      }`);
  lines.push(`    } catch (err) {`);
  lines.push(`      console.log(\`  ✗  \${t.name}: EXCEPTION — \${err.message}\`);`);
  lines.push(`      failed++;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  console.log(\`\\n  Results: \${passed} passed, \${failed} failed, \${skipped} skipped\\n\`);`);
  lines.push(`  return failed === 0;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`const ok = runTests();`);
  lines.push(`process.exit(ok ? 0 : 1);`);

  return lines.join('\n');
}

// ── Write ───────────────────────────────────────────────────────────────────
const code = generate();
fs.writeFileSync(outputPath, code, 'utf-8');

const total = allMetrics.length;
const tested = genTestCases().filter(t => !t.skip).length;
const skipped = total - tested;

console.log(`\n✓ Generated ${node} test harness`);
console.log(`  Output:       ${outputPath}`);
console.log(`  Tests:        ${tested} active / ${skipped} skipped / ${total} total`);
console.log(`  File size:    ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
console.log(`\n  Run: node ${outputPath}`);
console.log();
