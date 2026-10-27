import test from "node:test";
import assert from "node:assert/strict";
import { computeAstronomyPositions, computeAstronomyPositionSeries, computeAstronomyEventWindow } from "../src/index.mjs";

// Governing scientific definition, not a golden fitted to this implementation:
// https://aa.usno.navy.mil/faq/moon_phases and /data/MoonFraction
// Phase names follow ecliptic elongation. Illuminated fraction uses physical
// Sun-Moon phase-angle geometry, so its extrema need not occur at exact phase instants.
test("last-quarter and waning-crescent measurements do not become waxing because longitude increases", () => {
  for (const date of ["2026-10-03", "2026-09-08"]) {
    const result = computeAstronomyPositions(date);
    assert.ok(result.lunarPhase.elongation > 180 && result.lunarPhase.elongation < 360);
    assert.ok(result.bodies.moon.speed - result.bodies.sun.speed > 0);
    assert.equal(result.lunarPhase.trend, "waning");
  }
  assert.equal(computeAstronomyPositions("2026-10-17").lunarPhase.trend, "waxing");
});

test("phase trend and illumination derivative agree away from the geometric extrema", () => {
  const encountered = new Set();
  for (const year of [1800, 1900, 2000, 2026, 2050]) {
    for (let day = 0; day < 365; day += 3) {
      const time = Date.UTC(year, 0, 2) + day * 86_400_000;
      if (new Date(time + 3600000).getUTCFullYear() !== year) continue;
      const before = computeAstronomyPositions(new Date(time - 3600000).toISOString()).lunarPhase.illuminatedFraction;
      const after = computeAstronomyPositions(new Date(time + 3600000).toISOString()).lunarPhase.illuminatedFraction;
      const result = computeAstronomyPositions(new Date(time).toISOString());
      // Phase instants (defined by longitude) and physical illumination
      // extrema (defined by 3D geometry) are different events.
      const e = result.lunarPhase.elongation;
      if (Math.min(e, 360 - e, Math.abs(e - 180)) < 2 ||
          Math.abs(after - before) < 0.00001) continue;
      const trend = after > before ? "waxing" : "waning";
      assert.equal(result.lunarPhase.trend, trend, result.time);
      encountered.add(trend);
    }
  }
  assert.deepEqual([...encountered].sort(), ["waning", "waxing"]);
});

test("new and full Moon switch the trend, while first and last quarter do not", () => {
  const events = computeAstronomyEventWindow({ kind: "lunation-quarters", start: "2026-10-01", end: "2026-11-01" }).events;
  const expected = {
    "new moon": ["waning", "waxing"], "full moon": ["waxing", "waning"],
    "first quarter": ["waxing", "waxing"], "last quarter": ["waning", "waning"],
  };
  assert.deepEqual([...new Set(events.map(event => event.quarter))].sort(), Object.keys(expected).sort());
  for (const event of events) {
    const time = Date.parse(event.time);
    const sides = [-10, 10].map(minutes => computeAstronomyPositions(new Date(time + minutes * 60000).toISOString()).lunarPhase.trend);
    assert.deepEqual(sides, expected[event.quarter], event.quarter);
  }
});

test("bounded multi-epoch products carry both phase halves with unchanged single-moment values", () => {
  const series = computeAstronomyPositionSeries({
    start: "2026-10-01", end: "2026-11-01", stepMinutes: 1440,
    bodies: ["sun", "moon"], includeLunarPhase: true,
  });
  assert.deepEqual([...new Set(series.samples.map(sample => sample.lunarPhase.trend))].sort(), ["waning", "waxing"]);
  for (const sample of series.samples) assert.deepEqual(sample.lunarPhase, computeAstronomyPositions(sample.time).lunarPhase);
});

test("display rounding at a phase extremum does not move the actual trend transition", () => {
  const beforeFull = computeAstronomyPositions("2026-10-26T04:11:42.250Z").lunarPhase;
  assert.equal(beforeFull.elongation, 180);
  assert.equal(beforeFull.trend, "waxing");
  const beforeNew = computeAstronomyPositions("2026-10-10T15:49:59.250Z").lunarPhase;
  assert.equal(beforeNew.elongation, 360);
  assert.equal(beforeNew.trend, "waning");
});

test("mean-distance lunar phase angle agrees with independent USNO 2026 noon-UTC fractions", () => {
  // USNO almanac computes these independently at 12:00 UTC and publishes 2 dp:
  // https://aa.usno.navy.mil/calculated/moon/fraction?submit=Get+Data&task=12&tz=0&tz_label=false&tz_sign=1&year=2026
  // This is a rounded external COMPUTED reference, not observational raw data.
  const fractionsOnDay15 = [0.10, 0.04, 0.14, 0.05, 0.03, 0.00,
    0.02, 0.10, 0.20, 0.22, 0.32, 0.33];
  for (let month = 1; month <= 12; month += 1) {
    const time = `2026-${String(month).padStart(2, "0")}-15T12:00:00Z`;
    const measured = computeAstronomyPositions(time).lunarPhase.illuminatedFraction;
    assert.ok(Math.abs(measured - fractionsOnDay15[month - 1]) <= 0.00501,
      `${time}: model ${measured} vs USNO ${fractionsOnDay15[month - 1]} (2-dp almanac)`);
  }
});

test("longitude-defined new Moon does not falsely imply zero physical illumination", () => {
  const lunar = computeAstronomyPositions("2026-10-10T15:49:59Z").lunarPhase;
  assert.ok(lunar.elongation < 0.005 || lunar.elongation > 359.995);
  assert.ok(lunar.illuminatedFraction > 0, "nonzero lunar latitude separates the physical illumination angle");
});
