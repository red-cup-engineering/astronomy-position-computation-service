import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseUsno2026Csv,
  scoreUsno2026,
  runUsno2026Assay,
  calculateUsno2026Prediction,
  parseUsno2026RenderedTable,
  reconcileUsno2026RenderedSource,
} from '../src/lunar-reference-assay.mjs';

const fixture = (value = '0.50') => 'utc_date,illuminated_fraction\n' +
  Array.from({ length: 365 }, (_, day) =>
    `${new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10)},${value}\n`).join('');
const cases = { longitude_only: 0.5, spherical_separation: 0.505, mean_distance_triangle: 0.499 };

test('accepts exactly 365 valid dates and locks source digest before scoring', () => {
  const rows = parseUsno2026Csv(fixture());
  assert.equal(rows.length, 365);
  assert.equal(rows.at(0).utc_date, '2026-01-01');
  assert.equal(rows.at(-1).utc_date, '2026-12-31');
  assert.throws(() => runUsno2026Assay(fixture(), { predict: () => cases }), /digest mismatch/);
  const trial = runUsno2026Assay(fixture(), { requireSourceSha: false, predict: () => cases });
  assert.equal(trial.models.mean_distance_triangle.two_decimal_disagreements, 0);
});

test('computes exact residual metrics on a deliberately fabricated control', () => {
  const measured = scoreUsno2026(parseUsno2026Csv(fixture()), () => ({
    longitude_only: 0.6, spherical_separation: 0.5, mean_distance_triangle: 0.49,
  }));
  assert.ok(Math.abs(measured.models.longitude_only.rmse - 0.1) < 1e-12);
  assert.ok(Math.abs(measured.models.longitude_only.mae - 0.1) < 1e-12);
  assert.ok(Math.abs(measured.models.longitude_only.bias - 0.1) < 1e-12);
  assert.equal(measured.models.longitude_only.two_decimal_disagreements, 365);
  assert.equal(measured.models.spherical_separation.two_decimal_disagreements, 0);
  assert.equal(measured.models.mean_distance_triangle.two_decimal_disagreements, 365);
});

test('refuses missing, doubled, non-calendar, imprecise, out-of-range and corrupt observations', () => {
  const lines = fixture().trimEnd().split('\n');
  assert.throws(() => parseUsno2026Csv(lines.slice(0, -1).join('\n') + '\n'), /365/);
  const bad = (line, replacement) => {
    const other = [...lines];
    other[line] = replacement;
    return other.join('\n') + '\n';
  };
  assert.throws(() => parseUsno2026Csv(bad(60, '2026-02-29,0.50')), /expected/);
  assert.throws(() => parseUsno2026Csv(bad(60, lines[59])), /duplicated/);
  assert.throws(() => parseUsno2026Csv(bad(60, '2026-03-01,0.501')), /two-decimal/);
  assert.throws(() => parseUsno2026Csv(bad(60, '2026-03-01,1.01')), /two-decimal/);
  assert.throws(() => parseUsno2026Csv(bad(60, '2026-03-01,NaN')), /two-decimal/);
});

test('refuses unsupported physical outputs rather than promoting an estimate', () => {
  const rows = parseUsno2026Csv(fixture());
  assert.throws(() => scoreUsno2026(rows, () => ({ ...cases, mean_distance_triangle: Infinity })), /invalid/);
  assert.throws(() => scoreUsno2026(rows, () => ({ ...cases, longitude_only: -0.1 })), /invalid/);
  assert.throws(() => scoreUsno2026(rows.slice(1), () => cases), /365/);
});

test('2026 October longitude-defined new Moon preserves bounded physical illumination', () => {
  const predicted = calculateUsno2026Prediction('2026-10-10');
  assert.ok(predicted.mean_distance_triangle >= 0 && predicted.mean_distance_triangle <= 1);
  assert.ok(predicted.spherical_separation >= 0 && predicted.spherical_separation <= 1);
});

test('reproduces original full-year three-model evidence against the real astronomy engine', () => {
  const csv = readFileSync(new URL('./fixtures/usno-2026-noon-utc-illumination.csv', import.meta.url), 'utf8');
  const result = runUsno2026Assay(csv);
  assert.equal(result.reference_days, 365);
  assert.equal(result.reference.sha256, 'b8e64f318ad14db40d5d95cf8260d78d3e52f78e4ba3e8cb5efde6991e0d2eff');
  assert.equal(result.models.longitude_only.two_decimal_disagreements, 35);
  assert.equal(result.models.spherical_separation.two_decimal_disagreements, 26);
  assert.equal(result.models.mean_distance_triangle.two_decimal_disagreements, 1);
  assert.ok(Math.abs(result.models.longitude_only.rmse - 0.0030510) < 0.000002);
  assert.ok(Math.abs(result.models.mean_distance_triangle.rmse - 0.0028957) < 0.000002);
  assert.ok(result.models.mean_distance_triangle.rmse < result.models.longitude_only.rmse);
});

const originalUSNO = () => readFileSync(new URL(
  './fixtures/usno-2026-noon-utc-original-rendered-table.txt', import.meta.url), 'utf8');
const sourceLocked2026 = () => readFileSync(new URL(
  './fixtures/usno-2026-noon-utc-illumination.csv', import.meta.url), 'utf8');

test('all 365 original USNO noon-UTC printed values independently match the source-locked CSV', () => {
  const snapshot = parseUsno2026RenderedTable(originalUSNO());
  assert.equal(snapshot.rows.length, 365);
  assert.equal(snapshot.absentCalendarCells, 7);
  assert.equal(snapshot.rows[0].utc_date, '2026-01-01');
  assert.equal(snapshot.rows.at(-1).utc_date, '2026-12-31');
  const result = reconcileUsno2026RenderedSource(sourceLocked2026(), originalUSNO());
  assert.equal(result.status, 'printed-source-consistent');
  assert.equal(result.comparedDays, 365);
  assert.equal(result.absentCalendarCells, 7);
  assert.equal(result.mismatches.length, 0);
  assert.equal(result.sourceCsvPinned, true);
  assert.equal(result.sourceCsvSha256, 'b8e64f318ad14db40d5d95cf8260d78d3e52f78e4ba3e8cb5efde6991e0d2eff');
  assert.match(result.sourceStatus, /HTML bytes not archived/);
});

test('a changed original published fraction is a source-reverification candidate, not a measured physical claim', () => {
  const source = originalUSNO().replace('01 | 0.94 |', '01 | 0.93 |');
  const result = reconcileUsno2026RenderedSource(sourceLocked2026(), source);
  assert.equal(result.status, 'source-reverification-candidate');
  assert.equal(result.mismatches.length, 1);
  assert.deepEqual(result.mismatches[0], {
    utc_date: '2026-01-01', published: '0.93', sourceLockedCsv: '0.94',
  });
  assert.equal(result.sourceCsvPinned, true);
  assert.match(result.epistemicStanding, /not an independent physical observation/);
});

test('source text must explicitly identify the 2026 noon UTC product, all months and calendar holes', () => {
  const source = originalUSNO();
  for (const corrupt of [
    source.replace('at Noon Universal Time', 'at Midnight Universal Time'),
    source.replace('Fraction of Moon Illuminated, 2026', 'Fraction of Moon Illuminated, 2025'),
    source.replace('Day | Jan. | Feb.', 'Day | Feb. | Jan.'),
    source.replace('29 | 0.85 | -- |', '29 | 0.85 | 0.00 |'),
    source.replace('31 | 0.97 | -- | 0.97 | -- |', '31 | 0.97 | -- | 0.97 | 0.00 |'),
    source.replace('04 | 0.98 |', '04 | 1.01 |'),
    source.replace('30 | 0.92 |', '30 | not-a-fraction |'),
    source.replace('05 | 0.94 |', '04 | 0.94 |'),
    source.replace('02 | 0.99 |', '02 | 0.99 | 0.01 |'),
  ]) {
    assert.throws(() => parseUsno2026RenderedTable(corrupt), /source|invalid|header|calendar|day|fraction/i);
  }
  assert.throws(() => parseUsno2026RenderedTable(42), /bounded text capture/);
  assert.throws(() => parseUsno2026RenderedTable('A'.repeat(25001)), /bounded text capture/);
});

test('source-locked CSV drift remains visible even if the official table capture is unchanged', () => {
  const tamperedCsv = sourceLocked2026().replace('2026-01-01,0.94', '2026-01-01,0.93');
  const result = reconcileUsno2026RenderedSource(tamperedCsv, originalUSNO());
  assert.equal(result.sourceCsvPinned, false);
  assert.equal(result.status, 'source-reverification-candidate');
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].utc_date, '2026-01-01');
});
