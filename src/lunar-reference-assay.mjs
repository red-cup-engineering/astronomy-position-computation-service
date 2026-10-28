import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { computeChart, computeAstronomyPositions } from './index.mjs';

// A reproducible research assay, not a replacement ephemeris or a sale route.
// Reference: the USNO's calculated, two-decimal almanac, NOT telescope observations.
export const USNO_2026_SOURCE = 'https://aa.usno.navy.mil/calculated/moon/fraction?submit=Get+Data&task=12&tz=0&tz_label=false&tz_sign=1&year=2026';
export const USNO_2026_SHA256 = 'b8e64f318ad14db40d5d95cf8260d78d3e52f78e4ba3e8cb5efde6991e0d2eff';
const EXPECTED_HEADER = 'utc_date,illuminated_fraction';
const RAD = Math.PI / 180;
const MODELS = ['longitude_only', 'spherical_separation', 'mean_distance_triangle'];

export function parseUsno2026Csv(text) {
  if (typeof text !== 'string') throw new TypeError('reference must be a UTF-8 CSV string');
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines[0] !== EXPECTED_HEADER) throw new Error('unexpected reference header');
  if (lines.length !== 366) throw new Error(`2026 reference requires 365 daily rows, got ${lines.length - 1}`);
  const rows = [];
  for (let index = 0; index < 365; index += 1) {
    const fields = lines[index + 1].split(',');
    const expected = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    if (fields.length !== 2 || fields[0] !== expected) {
      throw new Error(`reference UTC date missing, duplicated, reordered or malformed at row ${index + 2}: expected ${expected}`);
    }
    if (!/^(?:0\.[0-9]{2}|1\.00)$/.test(fields[1])) {
      throw new Error(`reference value at ${expected} must be a bounded two-decimal fraction`);
    }
    rows.push({ utc_date: expected, illuminated_fraction: Number(fields[1]) });
  }
  return rows;
}

export function calculateUsno2026Prediction(utcDate) {
  const time = `${utcDate}T12:00:00Z`;
  // Unrounded ecliptic source geometry, not rounded chart presentation fields.
  const chart = computeChart(time);
  const difference = (chart.bodies.moon.longitude - chart.bodies.sun.longitude) * RAD;
  const c = Math.cos(chart.bodies.moon.latitude * RAD) * Math.cos(difference);
  return {
    longitude_only: (1 - Math.cos(difference)) / 2,
    spherical_separation: (1 - c) / 2,
    mean_distance_triangle: computeAstronomyPositions(time).lunarPhase.illuminatedFraction,
  };
}

export function scoreUsno2026(rows, predict = calculateUsno2026Prediction) {
  if (!Array.isArray(rows) || rows.length !== 365) throw new Error('score requires 365 admitted source observations');
  if (typeof predict !== 'function') throw new TypeError('predict must be a function');
  const totals = Object.fromEntries(MODELS.map(model => [model, { squared: 0, absolute: 0, signed: 0, disagreements: [] }]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const expected = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    if (row?.utc_date !== expected || !Number.isFinite(row.illuminated_fraction) ||
        row.illuminated_fraction < 0 || row.illuminated_fraction > 1 ||
        Math.abs(row.illuminated_fraction * 100 - Math.round(row.illuminated_fraction * 100)) > 1e-8) {
      throw new Error(`invalid scoring reference row for ${expected}`);
    }
    const predictions = predict(expected);
    for (const model of MODELS) {
      const value = predictions?.[model];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`invalid ${model} prediction on ${expected}`);
      const delta = value - row.illuminated_fraction;
      const score = totals[model];
      score.squared += delta * delta;
      score.absolute += Math.abs(delta);
      score.signed += delta;
      if (Math.round(value * 100) / 100 !== row.illuminated_fraction) score.disagreements.push(expected);
    }
  }
  const models = Object.fromEntries(MODELS.map(model => {
    const s = totals[model];
    return [model, {
      rmse: Math.sqrt(s.squared / 365),
      mae: s.absolute / 365,
      bias: s.signed / 365,
      two_decimal_disagreements: s.disagreements.length,
      disagreement_dates: s.disagreements,
    }];
  }));
  return {
    reference_days: 365,
    clock: '12:00:00 UTC',
    observer: 'geocentric',
    comparator: 'rounded calculated USNO fraction; not telescope observations',
    models,
  };
}

export function runUsno2026Assay(csvText, options = {}) {
  const sourceSha256 = createHash('sha256').update(csvText, 'utf8').digest('hex');
  if (options.requireSourceSha !== false && sourceSha256 !== USNO_2026_SHA256) {
    throw new Error(`source digest mismatch; expected ${USNO_2026_SHA256}, got ${sourceSha256}`);
  }
  const rows = parseUsno2026Csv(csvText);
  return {
    type: 'LunarIlluminationReferenceAssay',
    version: 1,
    scientific_status: 'computational comparison against rounded calculated reference',
    reference: {
      url: USNO_2026_SOURCE,
      sha256: sourceSha256,
      source: 'US Naval Observatory',
      method: 'fraction illuminated, 2026 noon Universal Time, two-decimal printed table',
    },
    ...scoreUsno2026(rows, options.predict ?? calculateUsno2026Prediction),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source || process.argv.length !== 3) {
    console.error('usage: node src/lunar-reference-assay.mjs /path/to/usno-2026-noon-utc.csv');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(runUsno2026Assay(readFileSync(source, 'utf8')), null, 2)); }
    catch (error) { console.error(`assay refused: ${error.message}`); process.exitCode = 1; }
  }
}
