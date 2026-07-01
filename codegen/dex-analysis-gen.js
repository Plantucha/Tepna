/*
 * dex-analysis-gen.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
#!/usr/bin/env node
// dex-analysis-gen.js — Generates a JS analysis module from a Dex manifest
//
// Usage: node dex-analysis-gen.js <manifest.json> [--output <file.js>]

const fs = require('fs');
const path = require('path');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node dex-analysis-gen.js <manifest.json> [--output <file.js>]');
  process.exit(0);
}

const manifestPath = args[0];
let outputPath = null;
const i = args.indexOf('--output');
if (i !== -1 && args[i + 1]) outputPath = args[i + 1];
if (!outputPath) outputPath = path.basename(manifestPath, '.json') + '-analysis.js';

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const node = manifest.node;
const allMetrics = manifest.sections.flatMap(s =>
  s.metrics.map(m => ({ ...m, sectionId: s.id }))
);

// ── Compute code generation ─────────────────────────────────────────────────

function sourceExpr(source, where) {
  if (!where) return `d.${source}`;
  return `d.${source}Filtered`;  // prepared in the data-prep step
}

function genComputeBody(m) {
  const c = m.compute;
  if (!c) return genStubBody(m);

  const src = sourceExpr(c.source, c.where);
  const args = c.args || [];

  switch (c.fn) {

    // ── Statistics ──
    case 'percentile':
      return `return _p(${src}, ${args[0]});`;

    case 'mean':
      return `return _mean(${src});`;

    case 'sum':
      return `return _sum(${src});`;

    case 'sd':
      return `return _sd(${src});`;

    case 'cov':
      return `return _cov(${src});`;

    case 'iqr':
      return `return _iqr(${src});`;

    case 'min':
      return `return _min(${src});`;

    case 'max':
      return `return _max(${src});`;

    // ── Threshold counts ──
    case 'count_above': {
      const [, thresh] = args;
      return `return _countWhere(${src}, v => v > ${thresh});`;
    }

    case 'count_below': {
      const [, thresh] = args;
      return `return _countWhere(${src}, v => v < ${thresh});`;
    }

    case 'pct_above': {
      const [, thresh] = args;
      return `const arr = ${src}; return arr.length ? _countWhere(arr, v => v > ${thresh}) / arr.length * 100 : NaN;`;
    }

    case 'pct_below': {
      const [, thresh] = args;
      return `const arr = ${src}; return arr.length ? _countWhere(arr, v => v < ${thresh}) / arr.length * 100 : NaN;`;
    }

    // ── Derived counts ──
    case 'count_where_div': {
      const [op, thresh, divisor] = args;
      const opChar = op === 'gt' ? '>' : '<';
      return `return _countWhere(d.${c.source}, v => v ${opChar} ${thresh}) / ${divisor};`;
    }

    case 'first_where_div': {
      const [op, thresh, divisor] = args;
      const opChar = op === 'gt' ? '>' : '<';
      return `const idx = d.${c.source}.findIndex(v => v ${opChar} ${thresh}); return idx === -1 ? NaN : idx / ${divisor};`;
    }

    // ── Event-based ──
    case 'event_rate': {
      const types = c.eventTypes;
      const typeSet = `[${types.map(t => `'${t}'`).join(',')}]`;
      return [
        `const types = new Set(${typeSet});`,
        `const count = d.events.filter(e => types.has(e.type)).length;`,
        `return d.${c.denominator} > 0 ? count / d.${c.denominator} : NaN;`,
      ].join('\n    ');
    }

    case 'event_count': {
      const types = c.eventTypes;
      const typeSet = `[${types.map(t => `'${t}'`).join(',')}]`;
      return [
        `const types = new Set(${typeSet});`,
        `return d.events.filter(e => types.has(e.type)).length;`,
      ].join('\n    ');
    }

    // ── Time series ──
    case 'ols_slope':
      return `return _olsSlope(${src});`;

    // ── Composite / expression ──
    case 'expr':
      return `return ${c.expr};`;

    // ── Stub ──
    case 'stub':
    default:
      return genStubBody(m);
  }
}

function genStubBody(m) {
  return [
    `// TODO: Implement — ${m.formula}`,
    m.compute?.note ? `// Note: ${m.compute.note}` : '',
    `return NaN;`,
  ].filter(Boolean).join('\n    ');
}

function genPrepare() {
  // Collect all source + where combinations
  const combos = new Set();
  for (const m of allMetrics) {
    if (m.compute?.source && m.compute?.where) {
      combos.add(`${m.compute.source}|${m.compute.where}`);
    }
  }

  const filterLines = [...combos].map(combo => {
    const [source, where] = combo.split('|');
    const name = `${source}Filtered`;
    return `    const ${name} = _filterBy(d.${source}, d.${where});`;
  });

  return [
    `function prepare(raw) {`,
    `    const n = raw.pressure ? raw.pressure.length : 0;`,
    `    const maskOn = new Uint8Array(n);`,
    `    for (let i = 0; i < n; i++) maskOn[i] = raw.pressure[i] > 0 ? 1 : 0;`,
    ``,
    `    const d = {`,
    `      timestamps: raw.timestamps,`,
    `      pressure:   raw.pressure,`,
    `      leak:       raw.leak || new Float32Array(n),`,
    `      flow:       raw.flow || null,`,
    `      maskOn,`,
    `      events:     raw.events || [],`,
    `      mode:       raw.mode || 'CPAP',`,
    `      usageHours: _countWhere(maskOn, Boolean) / 3600,`,
    `    };`,
    ``,
    ...filterLines,
    ``,
    `    return d;`,
    `  }`,
  ].join('\n');
}

function genComputeFn(m) {
  const fnName = `compute_${m.id}`;
  const body = genComputeBody(m);
  return [
    `  function ${fnName}(d) {`,
    `    ${body.split('\n').join('\n    ')}`,
    `  }`,
  ].join('\n');
}

function genRangeTable() {
  const entries = allMetrics.map(m => {
    const ranges = (m.ranges || []).map(r =>
      `      { max: ${r.max === null ? 'Infinity' : r.max}, label: ${JSON.stringify(r.label)}, cls: ${JSON.stringify(r.class)} }`
    ).join(',\n');
    return `  ${m.id}: [\n${ranges}\n  ]`;
  });
  return `const RANGES = {\n${entries.join(',\n')}\n};`;
}

function genComputeMap() {
  const entries = allMetrics.map(m =>
    `  ${m.id}: compute_${m.id}`
  );
  return `const COMPUTE = {\n${entries.join(',\n')}\n};`;
}

// ── Assemble module ─────────────────────────────────────────────────────────

function generate() {
  const lines = [];

  lines.push(`/**`);
  lines.push(` * ${node} Analysis Module`);
  lines.push(` * Generated from manifest v${manifest.version} by dex-analysis-gen.js`);
  lines.push(` *`);
  lines.push(` * Usage:`);
  lines.push(` *   const results = ${node}.analyze(rawData);`);
  lines.push(` *   // results.medianPressure = { value: 10.2, label: 'Moderate', cls: 'ok' }`);
  lines.push(` *`);
  lines.push(` * Individual compute:`);
  lines.push(` *   const d = ${node}.prepare(rawData);`);
  lines.push(` *   const p50 = ${node}.compute.medianPressure(d);`);
  lines.push(` *   const grade = ${node}.grade('medianPressure', p50);`);
  lines.push(` */`);
  lines.push(`const ${node} = (() => {`);
  lines.push(``);

  // Metadata
  lines.push(`  const META = ${JSON.stringify({ node: manifest.node, version: manifest.version, modality: manifest.modality }, null, 2).split('\n').join('\n  ')};`);
  lines.push(``);

  // Ranges
  lines.push(`  ${genRangeTable().split('\n').join('\n  ')}`);
  lines.push(``);

  // ── Math utilities ──
  lines.push(`  // ── Math utilities ──`);
  lines.push(``);
  lines.push(`  function _p(arr, p) {`);
  lines.push(`    if (!arr || !arr.length) return NaN;`);
  lines.push(`    const sorted = Array.from(arr).sort((a, b) => a - b);`);
  lines.push(`    const idx = (p / 100) * (sorted.length - 1);`);
  lines.push(`    const lo = Math.floor(idx);`);
  lines.push(`    const hi = Math.ceil(idx);`);
  lines.push(`    return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _mean(arr) {`);
  lines.push(`    if (!arr || !arr.length) return NaN;`);
  lines.push(`    let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];`);
  lines.push(`    return s / arr.length;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _sum(arr) {`);
  lines.push(`    if (!arr || !arr.length) return 0;`);
  lines.push(`    let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];`);
  lines.push(`    return s;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _sd(arr) {`);
  lines.push(`    if (!arr || arr.length < 2) return NaN;`);
  lines.push(`    const m = _mean(arr);`);
  lines.push(`    let s = 0; for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;`);
  lines.push(`    return Math.sqrt(s / (arr.length - 1));`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _cov(arr) { const m = _mean(arr); return m ? (_sd(arr) / m) * 100 : NaN; }`);
  lines.push(`  function _iqr(arr) { return _p(arr, 75) - _p(arr, 25); }`);
  lines.push(`  function _min(arr) { let m = Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; }`);
  lines.push(`  function _max(arr) { let m = -Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }`);
  lines.push(``);
  lines.push(`  function _countWhere(arr, pred) {`);
  lines.push(`    let n = 0; for (let i = 0; i < arr.length; i++) if (pred(arr[i])) n++;`);
  lines.push(`    return n;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _filterBy(arr, mask) {`);
  lines.push(`    const out = []; for (let i = 0; i < arr.length; i++) if (mask[i]) out.push(arr[i]);`);
  lines.push(`    return out;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function _olsSlope(y) {`);
  lines.push(`    const n = y.length; if (n < 2) return NaN;`);
  lines.push(`    let sx = 0, sy = 0, sxy = 0, sxx = 0;`);
  lines.push(`    for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxy += i * y[i]; sxx += i * i; }`);
  lines.push(`    const d = n * sxx - sx * sx;`);
  lines.push(`    return d === 0 ? 0 : (n * sxy - sx * sy) / d;`);
  lines.push(`  }`);
  lines.push(``);

  // Data preparation
  lines.push(`  // ── Data preparation ──`);
  lines.push(``);
  lines.push(`  ${genPrepare().split('\n').join('\n  ')}`);
  lines.push(``);

  // Compute functions
  lines.push(`  // ── Per-metric compute functions ──`);
  lines.push(``);
  for (const m of allMetrics) {
    lines.push(genComputeFn(m));
    lines.push(``);
  }

  // Compute map
  lines.push(`  ${genComputeMap().split('\n').join('\n  ')}`);
  lines.push(``);

  // Grade function
  lines.push(`  // ── Grading ──`);
  lines.push(``);
  lines.push(`  function grade(metricId, value) {`);
  lines.push(`    const ranges = RANGES[metricId];`);
  lines.push(`    if (!ranges || value === null || value === undefined || isNaN(value))`);
  lines.push(`      return { label: 'N/A', cls: 'neutral' };`);
  lines.push(`    for (const r of ranges) {`);
  lines.push(`      if (value <= r.max) return { label: r.label, cls: r.cls };`);
  lines.push(`    }`);
  lines.push(`    const last = ranges[ranges.length - 1];`);
  lines.push(`    return { label: last.label, cls: last.cls };`);
  lines.push(`  }`);
  lines.push(``);

  // Public API
  lines.push(`  // ── Public API ──`);
  lines.push(``);
  lines.push(`  return {`);
  lines.push(`    META,`);
  lines.push(`    RANGES,`);
  lines.push(`    prepare,`);
  lines.push(`    grade,`);
  lines.push(`    compute: COMPUTE,`);
  lines.push(``);
  lines.push(`    analyze(raw) {`);
  lines.push(`      const d = prepare(raw);`);
  lines.push(`      const results = {};`);
  lines.push(`      for (const [id, fn] of Object.entries(COMPUTE)) {`);
  lines.push(`        const value = fn(d);`);
  lines.push(`        results[id] = { value, ...grade(id, value) };`);
  lines.push(`      }`);
  lines.push(`      return results;`);
  lines.push(`    },`);
  lines.push(``);
  lines.push(`    utils: { percentile: _p, mean: _mean, sd: _sd, cov: _cov, iqr: _iqr, olsSlope: _olsSlope },`);
  lines.push(`  };`);
  lines.push(`})();`);
  lines.push(``);
  lines.push(`if (typeof module !== 'undefined' && module.exports) module.exports = ${node};`);

  return lines.join('\n');
}

// ── Write ───────────────────────────────────────────────────────────────────
const code = generate();
fs.writeFileSync(outputPath, code, 'utf-8');

const stubCount = allMetrics.filter(m => !m.compute || m.compute.fn === 'stub').length;
console.log(`\n✓ Generated ${node} analysis module`);
console.log(`  Output:       ${outputPath}`);
console.log(`  Metrics:      ${allMetrics.length} (${stubCount} stub)`);
console.log(`  File size:    ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
if (stubCount) console.log(`\n  ⚠ ${stubCount} metric(s) generated as stubs — implement manually.`);
console.log();
