# Astronomy position computation service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

**Source-owned mathematics.** This package computes bounded sky measurements
from one pinned, embedded approximate ephemeris. It has no network calls,
merchant domain, secret, x402 middleware, horoscope, customer record, or
publication authority. Consumers can use the same calculations in astronomical
products, Divination, scientific comparisons, and machine-purchasable operations.

## Compute surface and laws

| Export | Admitted inputs | Output |
| --- | --- | --- |
| `computeAstronomyPositions(date)` | UTC date/instant in **1800–2050** | Ten bodies' geocentric ecliptic-of-date approximate longitude, latitude, apparent angular speed and lunar illumination |
| `computePrecisionAstronomyPositions(date, options)` from `/node` | **1972–2050**, Earth latitude/longitude, OxiEphemeris binary plus exact DE440 kernel at runtime | Original DE440-backed supplier coordinates and cross-model divergence; unavailable binary is a refusal, not an approximate fallback |
| `computeAstronomyEventWindow(request)` | Kind, strict start/end interval **over zero through 35 days**, plus necessary body/angle | Numerical lunar-quarter, planetary-station or relative-ecliptic-longitude crossing events |
| `computeAngularGeometry(request)` | UTC instant, optional **2–10 distinct bodies** | All unordered pairwise spherical great-circle separations (at most **45**) |
| `computeAstronomyPositionSeries(request)` | UTC start/end, integer cadence 1–10080 minutes, **at most 35 days and 256 instants**, 1–10 selected bodies | Reproducible batched positions, optional lunar phase, and explicit sampled endpoint and unsampled remainder |
| `computeEquatorialPositions(date)` | UTC date/instant in **1800–2050** | Approximate geocentric right ascension/declination of the same ten source bodies, with obliquity, frame and provenance |

The scientific source is the **ephemeris computation**, not astrology. Zodiacal
signs, houses, rulership and the meanings of aspects belong downstream in
Divination, not here. An x402 offer must bind to a named compute and validate
function in the existing `market.561.group` catalog: adding a domain or payment
gateway is not part of this package.

### Exact input meanings

- Bare `YYYY-MM-DD` is **00:00 UTC** on that calendar date.
- Full datetimes must carry `Z` or an explicit numeric UTC offset. Hours and
  minutes are required; seconds and fractional seconds are optional. They
  are canonically returned at millisecond precision in UTC; finer fractional
  digits are truncated, as in the existing JavaScript Date-based model.
  Zone-less datetimes, impossible calendar days, `24:00` and leap seconds are
  refused rather than reinterpreted. Gregorian leap-year rules apply; the
  accuracy range is checked on the resulting UTC instant after the offset.
  Validate the published date range *before* making a payment challenge.
- Existing unambiguous ISO spellings remain accepted: lowercase `z`, compact
  numeric offsets such as `+0530`, and signed six-digit years such as `+002026`.
- A Julian day used internally for the underlying series is in **TT**
  (Terrestrial Time), translated from UTC using the package's stated
  approximate `Delta T` law. Event roots are inverted from TT to UT
  before being reported as UTC. Solver tolerance is **not** guaranteed
  physical event-time accuracy.
- Geographic latitude is degrees north and longitude degrees east.
  Input celestial longitude, latitude, separations, right ascension and
  declination use degrees. Right ascension is also reported in hours
  (`degrees / 15`) in the interval 0–24 hours.

## Coordinate geometry

The approximate geocentric ecliptic source point is first represented by the
unit vector

```text
x = cos(beta) cos(lambda)
y = cos(beta) sin(lambda)
z = sin(beta)
```

where `lambda` is ecliptic longitude and `beta` is ecliptic latitude.

Great-circle angular separation uses
`atan2(norm(cross(u, v)), dot(u, v))`, which remains numerically stable
for nearly coincident directions and for antipodes. This is a **three-dimensional
spherical separation**, not the **difference of ecliptic longitudes** used for
the crossing-event product. Consumers must not conflate them.

To derive equatorial-of-date coordinates, rotate that same vector about the
ecliptic X axis by the **mean obliquity of date**, from the Meeus J2000
TT-centuries polynomial:

```text
epsilon0 = 23°26'21.448"
           - 46.8150" T - 0.00059" T² + 0.001813" T³
y_eq = y cos(epsilon0) - z sin(epsilon0)
z_eq = y sin(epsilon0) + z cos(epsilon0)
RA = atan2(y_eq, x) modulo 360°
Dec = atan2(z_eq, hypot(x, y_eq))
```

The forward rotation has an independently tested inverse, and source
measurements remain **unrounded until after** the transformation. The Meeus
polynomial and reference-frame distinction are documented in
[Max Planck's precession-and-nutation reference](https://www2.mps.mpg.de/homes/fraenz/systems/systems3art/node3.html).

**Limitation:** the embedded source's longitude is an approximate
"apparent ecliptic-of-date" quantity. Rotating it through the *mean*
obliquity is a disclosed mixed approximation, **not a full
true/apparent equatorial reference frame**. Outputs are not ICRS/CIRS
coordinates or topocentric telescope-pointing instructions; this
transformation does not add full nutation, parallax, refraction, rigorous
light-time treatment or accuracy the ephemeris does not have.

### Bounded position-series products

One request can calculate a series of positions without buying a separate
single-instant operation for each sample. An example:

```js
import { computeAstronomyPositionSeries } from "@lenticule-science/astronomy-position-computation-service";
const week = computeAstronomyPositionSeries({
  start: "2026-10-12T00:00:00Z",
  end: "2026-10-19T00:00:00Z",
  stepMinutes: 120,
  bodies: ["sun", "moon", "mars"],
  includeLunarPhase: true,
});
```

This produces 85 UTC instants, inclusive of both endpoints at a two-hour
cadence, using precisely the same computation as the single-instant source.
Neither the model nor the service interpolates between instants. When the
end is off the requested cadence, `sampledEnd` and
`unsampledRemainderMinutes` expose that gap instead of claiming it was
measured. Input admission bounds both time span and number of samples
before computation. The provider returns its original method and angular
error provenance without promoting decimal formatting to physical accuracy.

## Provenance, accuracy and authority

The lunar `trend` denotes the **longitude-defined phase half-cycle**, not
the exact sign of a physical-illumination derivative at its extremum:
waxing for Sun–Moon ecliptic longitude difference `[0, 180)` degrees and
waning for `[180, 360)`. The exact primary phases follow these longitude
crossings; the physical illumination extrema need not coincide with them.
Classification uses the unrounded elongation; a printed 180/360 near the
boundary can still carry the preceding phase label.

`lunarPhase.illuminatedFraction` now uses the original Sun/Moon longitudes
and lunar latitude to derive their geocentric spherical separation, then
approximates the phase angle at the Moon using mean Earth–Moon distance
**384,400 km** (NASA/JPL) and mean Sun distance **1 au =
149,597,870.7 km** (IAU 2012). It is still an *approximate geocentric
illumination fraction*, not a range-aware precision lunar ephemeris.
The scalar distance ratio is a physical mean, **not** a fitted calibration.
The rest of the published ecliptic positions and quarter-event definitions
are unchanged. The [2026 USNO noon-UT almanac](https://aa.usno.navy.mil/calculated/moon/fraction?submit=Get+Data&task=12&tz=0&tz_label=false&tz_sign=1&year=2026)
is an independently calculated, **two-decimal** reference, not telescope data.
On all 365 of its dates the earlier longitude-only model differed after
two-decimal rounding on 35 dates; the mean-distance phase-angle approximation
differs on one. The paired RMSEs against those rounded published values are
0.003051 and 0.002896 respectively. Such comparisons do not establish
precision beyond that almanac's resolution; this is a model
qualification, not an empirical discovery of new lunar dynamics.


The embedded source algorithm is a truncated Meeus lunar/solar series with
JPL approximate planetary elements. Its published tested interval is
1800–2050. The existing golden tests and per-body longitude error bounds
describe the published numerical law; extra decimal places in a vector
transformation or printed coordinate **do not make the underlying positions
more accurate**. The separate DE440 provider carries the pin of the actual
precision binary and rejects unavailable suppliers.

### Precision runtime identity

The Node adapter measures the regular file named by `OXIEPH_DE` with streaming
SHA-256 on every call and requires the existing classic-binary DE440 pin
`29915576d0a6555766b99485ac3056ee415e86df4fce282611c31afb329ad062`.
It resolves `OXIEPH_BIN` (or `oxieph` on the process search path) once, measures
that executable, and requires its `--version` response to be `oxieph 0.1.1`.
The version handshake is the existing supplier's
[published Clap CLI contract](https://static.crates.io/crates/oxiephemeris-cli/oxiephemeris-cli-0.1.1.crate).
Both resolved files' identity, size and modification/change times must remain
unchanged through verification and chart execution. Missing files, a different
kernel, mismatched version, process errors and observed input changes refuse
the computation; there is no approximate fallback or environment hash override.

Successful native responses retain their coordinates, nodes, cross-checks and
existing metrology fields. The additional `supplierSha256` identifies measured
executable bytes, and `runtimeIdentity` is
`verified-file-and-reported-version`. This verifies the kernel pin and the
executable's **self-reported** version, not a signed supplier build or a trusted
executable digest. The configured executable and files must be trusted and
stable; file-stat checks detect ordinary changes, not a hostile host replacing
inputs between observations. This is runtime provenance, not a new rights,
accuracy or commercial-activation claim. The approximate-model cross-check
retains its separate scientific and source provenance.

`executeOxiEphemeris` continues returning the raw chart. A custom
`dependencies.execute` result can retain the verified metrology only by
returning the unchanged chart actually received by this adapter for that exact
request. Other injected, cloned, changed or replayed charts still support
numerical projection, but their ephemeris, hash, supplier and software-license
fields are `null`, with `runtimeIdentity: "unverified-executor"`.
Tests exercise real temporary files and local synthetic child processes with
known fixture hashes. They do not assert execution of the actual Oxi/DE440
numerical supplier or qualification of SPK input.

The `computeAstronomyEventWindow` products make observational promises only
to the limit of the underlying ephemeris and Earth-rotation model. Do not
represent a one-second bisection/root tolerance as a one-second ephemeris
prediction guarantee.

Source data, external catalogs and HTTP API rights must be reviewed separately
for commercial use, derived outputs, caching and redistribution. Computing
and selling a transformation does not override upstream licenses or terms.

### Repeatable USNO 2026 research assay

This repository holds **executable scoring** for the original [Lenticule Astronomy Science 365-day lunar-illumination assay](https://github.com/lenticule-science/astronomy-science-services-section/blob/main/content/text/documents/articles/notes/2026/10/27/2026-10-27-geocentric-lunar-illumination-usno-assay.md). Its single independently usable **public distribution fixture** is [`test/fixtures/usno-2026-noon-utc-illumination.csv`](test/fixtures/usno-2026-noon-utc-illumination.csv), an exact-byte copy of the Science-owned dated reference, with pinned SHA-256 `b8e64f318ad14db40d5d95cf8260d78d3e52f78e4ba3e8cb5efde6991e0d2eff`. Science retains the scientific interpretation and PROV-O provenance; the public test fixture makes the analysis executable without access to a private research repository.

```sh
# Runs five admission/scoring/negative controls and a sixth live-engine 365-day comparison.
node --test test/lunar-reference-assay.test.mjs

# Emits a structured JSON result with RMSE, MAE, bias, and disagreement dates.
node src/lunar-reference-assay.mjs test/fixtures/usno-2026-noon-utc-illumination.csv > lunar-2026-assay.json
```

**Independent upstream source-table reconciliation.** In addition to the
Science-owned date-indexed reference CSV, the test fixtures retain one
**separately read 31-day × 12-month** text copy of the
[U.S. Naval Observatory's 2026 noon Universal Time table](https://aa.usno.navy.mil/calculated/moon/fraction?submit=Get+Data&task=12&tz=0&tz_label=false&tz_sign=1&year=2026):
[`test/fixtures/usno-2026-noon-utc-original-rendered-table.txt`](test/fixtures/usno-2026-noon-utc-original-rendered-table.txt).
The source was independently read as the **rendered** 2026 web table on
2026-10-29 and is attributed to USNO under its
[conditional usage notice](https://aa.usno.navy.mil/about/PrivacyNotice).
It is NOT the original upstream HTTP response or a second canonical
date-indexed dataset. The native source parser refuses a different year,
Midnight-versus-Noon clock, swapped columns, bogus Feb 29 and other invalid
calendar cells, duplicate/missing day rows, malformed values and non-source
input. A changed two-decimal source print is returned as a re-verification
candidate, not treated as a change in underlying lunar physics.

```sh
# Re-run original model comparison AND independent printed-source check.
node src/lunar-reference-assay.mjs \
  test/fixtures/usno-2026-noon-utc-illumination.csv \
  test/fixtures/usno-2026-noon-utc-original-rendered-table.txt \
  > lunar-2026-with-source-reconciliation.json
```

The optional `source_reconciliation` receipt records the two distinct
local content digests (original locked CSV and separately acquired rendered
text), all 365 source dates, seven structurally missing calendar entries,
exact dates of any disagreement, and status. These are **text-capture**
evidence; hashing the text copy is not hashing or preserving USNO's HTML.
The existing public independent reproduction workflow exercises this
comparison and includes its source receipt in the original
`lunar-reference-reproduction` artifact. A future truly independent
higher-precision astronomy reference remains a separate Science #14
experiment; an absence of transcribing errors cannot identify unrounded
physical model error.

The assay refuses changed CSV source bytes by default. It admits exact 365 UTC dates and bounded two-decimal fractions; it compares longitude-only phase, latitude-aware spherical separation and physical mean-distance phase-angle models against USNO's **calculated** 2026 noon-UTC table. The full-year regression asserts the historical 35/26/1 two-decimal disagreement counts and rounded-reference RMSE. The values are **not raw physical observations, a precision ephemeris, or a novel physical theorem**. They do not certify a merchant deployment, customer acceptance or any x402 settlement. This package exposes no research-selling route or new payment service.

## Verify as an independent producer

```sh
npm run check
npm test
npm pack
```

The engineering repository's [Astronomy package distributability GitHub
Actions workflow](https://github.com/red-cup-engineering/computer-engineering-services-section/actions/workflows/astronomy-package.yml)
runs these scientific tests and verifies that a packed tarball can be
installed and imported by a separate clean consumer without registry access.
An accepted tarball is **not** a published `registry.561.group` release,
and a published library is not a live x402 paid-delivery witness.

