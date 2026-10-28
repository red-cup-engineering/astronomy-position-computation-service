import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  USNO_2026_SHA256,
  USNO_2026_SOURCE,
  parseUsno2026Csv,
  calculateUsno2026Prediction,
} from './lunar-reference-assay.mjs';

/**
 * Partial identification of a model ranking from a rounded reference.
 *
 * For a challenger a, a baseline b and an unknown unrounded reference t:
 *
 *   (a - t)^2 - (b - t)^2 = (a - b) (a + b - 2t).
 *
 * This expression is affine in t. Its extrema on each independent rounding
 * interval are therefore attained (or approached if a tie-endpoint is open)
 * at its endpoints. Summing those extrema gives sharp bounds under ONLY the
 * publication's per-date resolution and the physical 0 <= t <= 1 bound.
 *
 * The resulting witnesses need not be a dynamically plausible lunar
 * ephemeris: they establish what these published rounded numbers alone
 * cannot identify, not what the Moon physically did.
 */
export function boundRoundingMseDifference(observations, { roundingUnit = 0.01 } = {}) {
  if (!Array.isArray(observations) || observations.length === 0 || observations.length > 3660) {
    throw new RangeError('comparison requires 1–3660 paired observations');
  }
  if (typeof roundingUnit !== 'number' || !Number.isFinite(roundingUnit) ||
      roundingUnit <= 0 || roundingUnit > 1) {
    throw new TypeError('roundingUnit must be a positive finite fraction at most one');
  }
  let lowerSum = 0, upperSum = 0, printedSum = 0;
  const witnesses = [];
  for (let i = 0; i < observations.length; i += 1) {
    const observation = observations[i];
    const { date, printed, baseline, challenger } = observation ?? {};
    if (![printed, baseline, challenger].every(v => typeof v === 'number' &&
        Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new TypeError('invalid bounded fraction in row ' + (i + 1));
    }
    if (date !== undefined && (typeof date !== 'string' || date.length === 0)) {
      throw new TypeError('invalid date label in row ' + (i + 1));
    }
    const lowerReference = Math.max(0, printed - roundingUnit / 2);
    const upperReference = Math.min(1, printed + roundingUnit / 2);
    const differenceAt = t => (challenger - baseline) * (challenger + baseline - 2 * t);
    const differenceAtLow = differenceAt(lowerReference);
    const differenceAtHigh = differenceAt(upperReference);
    const minimumRef = differenceAtLow <= differenceAtHigh ? lowerReference : upperReference;
    const maximumRef = differenceAtLow >= differenceAtHigh ? lowerReference : upperReference;
    const minimum = Math.min(differenceAtLow, differenceAtHigh);
    const maximum = Math.max(differenceAtLow, differenceAtHigh);
    lowerSum += minimum;
    upperSum += maximum;
    printedSum += differenceAt(printed);
    witnesses.push({
      ...(date ? { date } : {}),
      printed, interval: [lowerReference, upperReference],
      minimumReference: minimumRef, maximumReference: maximumRef,
      minimumMseDifferenceContribution: minimum,
      maximumMseDifferenceContribution: maximum,
    });
  }
  const lower = lowerSum / observations.length;
  const upper = upperSum / observations.length;
  const printedMseDifference = printedSum / observations.length;
  return {
    n: observations.length, roundingUnit,
    metric: 'MSE(challenger) - MSE(baseline)',
    lower, upper, printedMseDifference,
    status: upper < 0 ? 'challenger-better-for-all-admissible-references'
      : lower > 0 ? 'baseline-better-for-all-admissible-references'
      : 'ranking-not-identified-by-published-rounding',
    witnesses,
    qualification: 'Sharp under only independent per-date closed rounding intervals; correlated physical reference trajectories and model error are not constrained. Endpoint ties can be approached from interior. Computed in IEEE-754, not an exact rational or a machine-checked physical theorem.',
  };
}

export function analyzeUsno2026RoundingSensitivity(csvText, options = {}) {
  if (typeof csvText !== 'string') throw new TypeError('CSV input must be UTF-8 text');
  const sha256 = createHash('sha256').update(csvText, 'utf8').digest('hex');
  if (options.requireSourceSha !== false && sha256 !== USNO_2026_SHA256) {
    throw new Error('reference digest mismatch: ' + sha256);
  }
  const rows = parseUsno2026Csv(csvText);
  const predictor = options.predict ?? calculateUsno2026Prediction;
  if (typeof predictor !== 'function') throw new TypeError('predict must be a function');
  const values = rows.map(row => ({ ...row, models: predictor(row.utc_date) }));
  const compare = (baselineModel, challengerModel) =>
    boundRoundingMseDifference(values.map(({ utc_date, illuminated_fraction, models }) => ({
      date: utc_date, printed: illuminated_fraction,
      baseline: models?.[baselineModel], challenger: models?.[challengerModel],
    })));
  return {
    type: 'LunarIlluminationRoundingSensitivity',
    version: 1,
    reference: { source: USNO_2026_SOURCE, sha256, years: [2026], utcTime: '12:00',
      unit: 'unit-fraction', printedDecimalPlaces: 2, observedKind: 'calculated almanac, not telescope readings' },
    comparisons: {
      triangleVsLongitude: compare('longitude_only', 'mean_distance_triangle'),
      triangleVsSpherical: compare('spherical_separation', 'mean_distance_triangle'),
    },
    status: 'finite computational partial-identification assay',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('usage: node src/lunar-rounding-sensitivity.mjs test/fixtures/usno-2026-noon-utc-illumination.csv');
    process.exitCode = 2;
  } else {
    try {
      const result = analyzeUsno2026RoundingSensitivity(readFileSync(process.argv[2], 'utf8'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('rounding sensitivity refused: ' + error.message);
      process.exitCode = 1;
    }
  }
}
