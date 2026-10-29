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

/**
 * Admit a separately captured, *web-rendered* USNO day-by-month source table.
 * This checks the clock/edition and every civil-day/month cell rather than
 * trusting the row order or the Group's own already-normalized CSV. It is
 * deliberately NOT an HTML parser: no claim is made to have archived USNO's
 * original HTTP response, observed a physical Moon, or recovered more than
 * the published two-decimal fractions.
 */
export function parseUsno2026RenderedTable(renderedText) {
  if (typeof renderedText !== 'string' || renderedText.length > 25000) {
    throw new TypeError('rendered USNO source must be a bounded text capture');
  }
  if (!/Fraction of (?:the )?Moon Illuminated, 2026/u.test(renderedText) ||
      !/at Noon\s+Universal Time/u.test(renderedText)) {
    throw new Error('source edition or noon Universal Time header mismatch');
  }
  const lines = renderedText.replace(/\r\n/gu, '\n').split('\n');
  const expectedMonths = ['Day', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May',
    'June', 'July', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  const headerIndex = lines.findIndex(line => /^\s*Day\s*\|/u.test(line));
  if (headerIndex < 0 || JSON.stringify(lines[headerIndex].split('|').map(x => x.trim())) !==
    JSON.stringify(expectedMonths)) {
    throw new Error('source day-by-month header must name all 12 original months in order');
  }
  const sourceDayRows = lines.slice(headerIndex + 1)
    .filter(line => /^\s*[0-9]{2}\s*\|/u.test(line));
  if (sourceDayRows.length !== 31) {
    throw new Error(`USNO printed source needs exactly 31 day rows, got ${sourceDayRows.length}`);
  }
  const sourceByDay = sourceDayRows.map((line, index) => {
    const fields = line.split('|').map(x => x.trim());
    const day = String(index + 1).padStart(2, '0');
    if (fields.length !== 13 || fields[0] !== day) {
      throw new Error(`USNO source date/order/column count invalid for day ${day}`);
    }
    return fields.slice(1);
  });
  const rows = [];
  let absentCalendarCells = 0;
  for (let month = 0; month < 12; month += 1) {
    const lastDay = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= 31; day += 1) {
      const printed = sourceByDay[day - 1][month];
      if (day > lastDay) {
        if (printed !== '--') throw new Error(`invalid calendar cell must be --: month ${month + 1}, day ${day}`);
        absentCalendarCells += 1;
        continue;
      }
      const utc_date = `2026-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!/^(?:0\.[0-9]{2}|1\.00)$/u.test(printed)) {
        throw new Error(`invalid source fraction on ${utc_date}: ${printed}`);
      }
      rows.push({ utc_date, printed_fraction: printed });
    }
  }
  if (rows.length !== 365 || absentCalendarCells !== 7) {
    throw new Error('USNO source table has incorrect calendar coverage');
  }
  return { rows, absentCalendarCells };
}

/**
 * Compare an independently obtained 31x12 rendered official source table with
 * the original source-locked date CSV. Changed prints are *candidates* for a
 * source correction, not a historical retraction or measured physical error.
 * `sourceCaptureSha256` addresses THIS text copy, not upstream HTML bytes.
 */
export function reconcileUsno2026RenderedSource(csvText, renderedText) {
  const source = parseUsno2026RenderedTable(renderedText);
  const original = parseUsno2026Csv(csvText);
  const mismatches = source.rows.flatMap((row, index) => {
    const actual = original[index];
    if (actual.utc_date === row.utc_date &&
        actual.illuminated_fraction.toFixed(2) === row.printed_fraction) return [];
    return [{ utc_date: row.utc_date, published: row.printed_fraction,
      sourceLockedCsv: actual.illuminated_fraction.toFixed(2) }];
  });
  const sourceCsvSha256 = createHash('sha256').update(csvText, 'utf8').digest('hex');
  return {
    type: 'Usno2026PrintedSourceReconciliation',
    source: USNO_2026_SOURCE,
    sourceStatus: 'separate rendered-text source capture; upstream HTML bytes not archived',
    sourceCaptureSha256: createHash('sha256').update(renderedText, 'utf8').digest('hex'),
    sourceCsvSha256,
    sourceCsvPinned: sourceCsvSha256 === USNO_2026_SHA256,
    clock: '12:00 Universal Time', year: 2026,
    comparedDays: source.rows.length,
    absentCalendarCells: source.absentCalendarCells,
    mismatches,
    status: mismatches.length === 0 && sourceCsvSha256 === USNO_2026_SHA256 ?
      'printed-source-consistent' : 'source-reverification-candidate',
    epistemicStanding: 'two-decimal source-text reconciliation, not an independent physical observation or unrounded accuracy',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2];
  if (!source || (process.argv.length !== 3 && process.argv.length !== 4)) {
    console.error('usage: node src/lunar-reference-assay.mjs /path/to/usno-2026-noon-utc.csv [original-rendered-source-table.txt]');
    process.exitCode = 2;
  } else {
    try {
      const csv = readFileSync(source, 'utf8');
      const result = runUsno2026Assay(csv);
      const sourceReconciliation = process.argv[3] === undefined ? undefined :
        reconcileUsno2026RenderedSource(csv, readFileSync(process.argv[3], 'utf8'));
      console.log(JSON.stringify(sourceReconciliation === undefined ? result :
        { ...result, source_reconciliation: sourceReconciliation }, null, 2));
      if (sourceReconciliation?.status === 'source-reverification-candidate') process.exitCode = 1;
    }
    catch (error) { console.error(`assay refused: ${error.message}`); process.exitCode = 1; }
  }
}
