import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  boundRoundingMseDifference as bound,
  analyzeUsno2026RoundingSensitivity as analyze,
} from '../src/lunar-rounding-sensitivity.mjs';
import { runUsno2026Assay } from '../src/lunar-reference-assay.mjs';

const closish = (a, b, eps = 1e-13) => assert.ok(Math.abs(a - b) < eps, String(a) + ' vs ' + String(b));
const squared = (a, b, t) => (a - t) ** 2 - (b - t) ** 2;

test('rounding admits opposing MSE rankings for a synthetic, equal-quality pair', () => {
  const r = bound([{ printed: 0.50, baseline: 0.502, challenger: 0.498 }]);
  assert.equal(r.status, 'ranking-not-identified-by-published-rounding');
  assert.ok(r.lower < 0 && r.upper > 0);
  closish(r.printedMseDifference, 0);
  closish(r.lower, -r.upper);
});

test('a much better model remains better for every rounding-consistent reference', () => {
  const r = bound([{ printed: 0.50, baseline: 0.90, challenger: 0.50 }]);
  assert.equal(r.status, 'challenger-better-for-all-admissible-references');
  assert.ok(r.upper < 0);
  const reverse = bound([{ printed: 0.50, baseline: 0.50, challenger: 0.90 }]);
  assert.equal(reverse.status, 'baseline-better-for-all-admissible-references');
  closish(reverse.lower, -r.upper);
});

test('endpoints are the sharp extreme witnesses for independently rounded dates', () => {
  const rows = [
    { date: 'case-one', printed: 0.40, baseline: 0.39, challenger: 0.405 },
    { date: 'case-two', printed: 0.70, baseline: 0.71, challenger: 0.67 },
  ];
  const r = bound(rows);
  const [first, second] = r.witnesses;
  const values = [
    [first.interval[0], second.interval[0]],
    [first.interval[0], second.interval[1]],
    [first.interval[1], second.interval[0]],
    [first.interval[1], second.interval[1]],
  ].map(([x, y]) => (
    squared(rows[0].challenger, rows[0].baseline, x) +
    squared(rows[1].challenger, rows[1].baseline, y)
  ) / 2);
  closish(r.lower, Math.min(...values));
  closish(r.upper, Math.max(...values));
  const lowWitnessResult = r.witnesses.reduce((sum, w, i) =>
    sum + squared(rows[i].challenger, rows[i].baseline, w.minimumReference), 0) / 2;
  closish(lowWitnessResult, r.lower);
});

test('physical endpoints clip 0.00 and 1.00 rounding intervals', () => {
  const r = bound([
    { printed: 0.00, baseline: 0.005, challenger: 0 },
    { printed: 1.00, baseline: 0.995, challenger: 1 },
  ]);
  assert.deepEqual(r.witnesses[0].interval, [0, 0.005]);
  assert.deepEqual(r.witnesses[1].interval, [0.995, 1]);
});

test('equal models imply zero difference without a manufactured winner', () => {
  const r = bound([{ printed: 0.5, baseline: 0.67, challenger: 0.67 }]);
  assert.equal(r.status, 'ranking-not-identified-by-published-rounding');
  assert.equal(r.lower, 0);
  assert.equal(r.upper, 0);
});

test('malformed fractions, empty samples and unsupported resolution refuse', () => {
  assert.throws(() => bound([]), /comparison requires/);
  assert.throws(() => bound([{ printed: 0.5, baseline: -0.1, challenger: 0.5 }]), /bounded fraction/);
  assert.throws(() => bound([{ printed: Number.NaN, baseline: 0.5, challenger: 0.5 }]), /bounded fraction/);
  assert.throws(() => bound([{ printed: 0.5, baseline: 0.5, challenger: 0.5 }], { roundingUnit: 0 }), /roundingUnit/);
});

test('2026 original-engine result lies within sharp rounded-reference bounds', () => {
  const csv = readFileSync(new URL('./fixtures/usno-2026-noon-utc-illumination.csv', import.meta.url), 'utf8');
  const sensitivity = analyze(csv);
  const original = runUsno2026Assay(csv);
  assert.equal(sensitivity.reference.sha256, original.reference.sha256);
  for (const [label, baselineName] of [
    ['triangleVsLongitude', 'longitude_only'],
    ['triangleVsSpherical', 'spherical_separation'],
  ]) {
    const result = sensitivity.comparisons[label];
    const challengerMse = original.models.mean_distance_triangle.rmse ** 2;
    const baselineMse = original.models[baselineName].rmse ** 2;
    const measured = challengerMse - baselineMse;
    closish(result.printedMseDifference, measured, 1e-10);
    assert.equal(result.n, 365);
    assert.ok(result.lower <= measured + 1e-12);
    assert.ok(result.upper >= measured - 1e-12);
    assert.ok(result.lower <= result.upper);
    assert.equal(result.witnesses.length, 365);
  }
  assert.throws(() => analyze(csv.replace('2026-01-01,0.94', '2026-01-01,0.93')), /digest mismatch/);
});
