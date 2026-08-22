/**
 * Tests for the pure logic: unit handling, the solar model, the written
 * summary, and the shape of the normalised forecast. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  formatTemp, formatWind, formatVisibility, visibilityBand,
  compassPoint, uvBand, temperatureColour, readableInk, convertTemp, formatDistance,
} from '../src/units.js';
import { sunTimes, isDaylight } from '../src/solar.js';
import { describeDay } from '../src/summary.js';
import { buildForecast, rebaseOffset, stepsForDay, fromCurrentHour } from '../src/normalise.js';
import { describeCode, toDaytimeCode, codeFamily } from '../src/weather-codes.js';
import { weatherIcon, ICON_NAMES } from '../src/icons.js';
import { parseCoordinates, searchPlaces } from '../src/geocode.js';
import { forecastDays } from '../src/render.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url)));
const datasets = {
  hourly: load('hourly'),
  'three-hourly': load('three-hourly'),
  daily: load('daily'),
};

test('temperature conversion and formatting', () => {
  assert.equal(formatTemp(17.64, 'C'), '18°');
  // Math.round(-0.4) is -0, which must not surface as "-0°".
  assert.equal(formatTemp(-0.4, 'C'), '0°');
  assert.equal(formatTemp(-3.6, 'C'), '-4°');
  assert.equal(formatTemp(null, 'C'), '–');
  assert.equal(convertTemp(100, 'F'), 212);
  assert.equal(formatTemp(0, 'F'), '32°');
});

test('wind conversion', () => {
  assert.equal(formatWind(4.84, 'mph'), '11');
  assert.equal(formatWind(4.84, 'kn'), '9');
  assert.equal(formatWind(4.84, 'm/s'), '5');
  assert.equal(formatWind(null, 'mph'), '–');
});

test('visibility bands follow the published boundaries', () => {
  assert.equal(visibilityBand(500).code, 'VP');
  assert.equal(visibilityBand(3999).code, 'PO');
  assert.equal(visibilityBand(6668).code, 'MO');
  assert.equal(visibilityBand(15738).code, 'G');
  assert.equal(visibilityBand(38107).code, 'VG');
  assert.equal(visibilityBand(47037).code, 'EX');
  assert.equal(formatVisibility(1609.344, 'mi'), '1.0');
  assert.equal(formatVisibility(20000, 'km'), '20');
});

test('grid point distance is reported in metres', () => {
  // The API value is metres; the sample response carries 27.9057.
  assert.equal(formatDistance(27.9057), '28 m');
  assert.equal(formatDistance(419.8), '420 m');
  assert.equal(formatDistance(999), '999 m');
  assert.equal(formatDistance(1400), '1.4 km');
  assert.equal(formatDistance(null), '–');
});

test('compass points are the direction the wind comes from', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(282), 'WNW');
  assert.equal(compassPoint(359), 'N');
});

test('UV bands', () => {
  assert.equal(uvBand(0).band, 'low');
  assert.equal(uvBand(5).band, 'moderate');
  assert.equal(uvBand(7).band, 'high');
  assert.equal(uvBand(10).band, 'very-high');
  assert.equal(uvBand(12).band, 'extreme');
});

test('temperature colours rise monotonically and stay readable', () => {
  const scale = [-20, -5, 0, 8, 13, 19, 25, 32, 45].map(temperatureColour);
  assert.equal(new Set(scale).size, scale.length, 'each step should differ');
  for (const colour of scale) {
    assert.match(colour, /^#[0-9a-f]{6}$/);
    assert.match(readableInk(colour), /^#(1d1d1d|ffffff)$/);
  }
  // Matches the reference display, where 13°C and 19°C are distinct ambers.
  assert.equal(temperatureColour(13), '#fbcf84');
  assert.equal(temperatureColour(19), '#f6a455');
});

test('sunrise and sunset match published times within a few minutes', () => {
  const cases = [
    // [lat, lon, date, expected rise, expected set] in Europe/London
    [51.9, -2.0783, '2026-08-21T12:00:00Z', '06:03', '20:19'],
    [51.9, -2.0783, '2026-12-21T12:00:00Z', '08:15', '16:01'],
    [55.9533, -3.1883, '2026-06-21T12:00:00Z', '04:26', '22:02'],
  ];
  const mins = (d) => {
    const [h, m] = d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
    }).split(':').map(Number);
    return h * 60 + m;
  };
  const expect = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

  for (const [lat, lon, iso, rise, set] of cases) {
    const r = sunTimes(new Date(iso), lat, lon);
    assert.ok(Math.abs(mins(r.sunrise) - expect(rise)) <= 6, `${iso} sunrise ${mins(r.sunrise)} vs ${rise}`);
    assert.ok(Math.abs(mins(r.sunset) - expect(set)) <= 6, `${iso} sunset ${mins(r.sunset)} vs ${set}`);
  }
});

test('polar cases do not throw', () => {
  const winter = sunTimes(new Date('2026-12-21T12:00:00Z'), 78.2, 15.6);
  assert.equal(winter.reason, 'polar-night');
  const summer = sunTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6);
  assert.equal(summer.reason, 'midnight-sun');
  assert.equal(isDaylight(new Date('2026-06-21T02:00:00Z'), 78.2, 15.6), true);
});

test('weather codes cover 0-30 and every icon exists', () => {
  for (let code = 0; code <= 30; code++) {
    const { label, icon } = describeCode(code);
    assert.ok(label, `code ${code} needs a label`);
    assert.ok(ICON_NAMES.includes(icon), `code ${code} icon "${icon}" missing`);
    assert.match(weatherIcon(icon, label), /^<svg[\s\S]+<\/svg>$/);
  }
  assert.equal(describeCode(99).label, 'Not available');
  assert.equal(toDaytimeCode(0), 1);
  assert.equal(toDaytimeCode(2), 3);
  assert.equal(toDaytimeCode(7), 7);
  assert.equal(codeFamily(15), 'rain');
  assert.equal(codeFamily(30), 'thunder');
});

test('icon markup escapes the accessible name', () => {
  const svg = weatherIcon('sunny', 'Sun & "sky" <b>');
  assert.ok(svg.includes('&amp;') && svg.includes('&quot;') && !svg.includes('<b>'));
});

test('forecast normalisation merges hourly and three-hourly without overlap', () => {
  const f = buildForecast({ datasets, sources: {}, fetchedAt: Date.now() });
  assert.ok(f.steps.length > 60, 'should span the full week');

  const times = f.steps.map((s) => s.time.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'steps must be ordered');
  assert.equal(new Set(times).size, times.length, 'no duplicate timestamps');

  // Hourly detail first, coarser steps afterwards.
  assert.equal(f.steps[0].resolution, 'hourly');
  assert.equal(f.steps.at(-1).resolution, 'three-hourly');
  assert.equal(f.days.length, 7);
  assert.equal(f.latitude, 50.727);
  assert.ok(f.steps.every((s) => s.temperature != null && s.code != null));
});

test('three-hourly field aliases are read', () => {
  const f = buildForecast({ datasets, sources: {} });
  const coarse = f.steps.filter((s) => s.resolution === 'three-hourly');
  assert.ok(coarse.length > 0);
  // three-hourly reports feelsLikeTemp, hourly reports feelsLikeTemperature
  assert.ok(coarse.every((s) => s.feelsLike != null), 'feelsLikeTemp alias must resolve');
});

test('three-hourly temperature falls back to the mean of max and min', () => {
  // The real three-hourly endpoint carries no screenTemperature, so the fixture
  // must not either -- otherwise this whole class of bug hides in mock mode.
  const rows = datasets['three-hourly'].features[0].properties.timeSeries;
  assert.ok(rows.every((r) => r.screenTemperature === undefined),
    'fixture must mirror the real endpoint and omit screenTemperature');

  const f = buildForecast({ datasets, sources: {} });
  const coarse = f.steps.filter((s) => s.resolution === 'three-hourly');
  assert.ok(coarse.every((s) => s.temperature != null), 'every coarse step needs a temperature');

  // Rows overlapping the hourly range are dropped by the merge, so match on the
  // first coarse step that actually survives.
  const step = coarse[0];
  const row = rows.find((r) => new Date(r.time).getTime() === step.time.getTime());
  assert.ok(row, 'every coarse step must trace back to a three-hourly row');
  assert.equal(step.temperature, (row.maxScreenAirTemp + row.minScreenAirTemp) / 2);
  assert.ok(step.temperature > row.minScreenAirTemp && step.temperature < row.maxScreenAirTemp);
});

test('hourly temperature still uses the instantaneous value', () => {
  const f = buildForecast({ datasets, sources: {} });
  const row = datasets.hourly.features[0].properties.timeSeries[0];
  const step = f.steps.find((s) => s.time.getTime() === new Date(row.time).getTime());
  assert.equal(step.resolution, 'hourly');
  assert.equal(step.temperature, row.screenTemperature);
  // ...and not the mean, which would differ here.
  assert.notEqual(step.temperature, (row.maxScreenAirTemp + row.minScreenAirTemp) / 2);
});

test('rebasing shifts the series onto the current hour', () => {
  const now = new Date('2026-08-22T09:30:00Z');
  const offset = rebaseOffset(datasets.hourly, now);
  assert.equal(offset % 3600_000, 0, 'offset must be whole hours');

  const f = buildForecast({ datasets, sources: {} }, { rebase: true, now });
  assert.ok(f.rebased);
  assert.equal(f.steps[0].time.getTime(), Math.floor(now.getTime() / 3600_000) * 3600_000);
  // Days must still land on midnight after shifting.
  for (const day of f.days) {
    assert.equal(day.date.getHours(), 0);
    assert.equal(day.date.getMinutes(), 0);
  }
});

test('day selection filters to the local calendar day', () => {
  const now = new Date('2026-08-22T09:30:00Z');
  const f = buildForecast({ datasets, sources: {} }, { rebase: true, now });
  const today = stepsForDay(f, now);
  assert.ok(today.length > 0);
  assert.ok(today.every((s) => s.time.toDateString() === now.toDateString()));

  const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const future = fromCurrentHour(f.steps, now);
  assert.ok(future.length > 0 && future.length <= f.steps.length);
  assert.ok(future.every((s) => s.time >= currentHour), 'past hours are dropped');

  // If everything is in the past, show the series rather than an empty table.
  const allPast = fromCurrentHour(f.steps, new Date(now.getTime() + 40 * 86400_000));
  assert.equal(allPast.length, f.steps.length);
});

test('written summary reads as a forecast sentence', () => {
  const at = (hour, code, pop = 0) => ({
    time: new Date(2026, 7, 21, hour), code, precipProbability: pop,
  });
  const steps = [
    at(7, 3), at(8, 3), at(9, 3), at(10, 3), at(11, 3),
    at(12, 7), at(13, 7), at(14, 7), at(15, 7), at(16, 7), at(17, 7),
  ];
  assert.equal(describeDay(steps), 'Sunny intervals changing to cloudy by lunchtime.');

  const steady = [at(9, 7), at(10, 7), at(11, 7), at(12, 7), at(13, 7)];
  assert.equal(describeDay(steady), 'Cloudy throughout the day.');

  const wet = [
    at(7, 1), at(8, 1), at(9, 1), at(10, 1), at(11, 1),
    at(15, 7, 70), at(16, 7, 60), at(17, 7, 55),
  ];
  assert.match(describeDay(wet), /chance of rain through the afternoon/);

  assert.equal(describeDay([]), 'Forecast detail is not available for this day.');
});

test('summary leads on precipitation over cloud', () => {
  const at = (hour, code) => ({ time: new Date(2026, 7, 21, hour), code, precipProbability: 0 });
  const steps = [at(9, 7), at(10, 15), at(11, 15), at(12, 7), at(13, 7)];
  assert.match(describeDay(steps), /^Rain/);
});

test('coordinate parsing', () => {
  assert.deepEqual(parseCoordinates('51.9, -2.08'),
    { name: '51.9000, -2.0800', latitude: 51.9, longitude: -2.08, source: 'coordinates' });
  assert.ok(parseCoordinates('55.9533 -3.1883'));
  assert.equal(parseCoordinates('Cheltenham'), null);
  assert.equal(parseCoordinates('999, 0'), null);
  assert.equal(parseCoordinates('51.9, -200'), null);
});

test('offline place search uses the built-in list', async () => {
  const results = await searchPlaces('chelt', { offline: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Cheltenham (Gloucestershire)');
  assert.deepEqual(await searchPlaces('nowhere-at-all', { offline: true }), []);
});

test('the day list includes today, so it can be navigated back to', () => {
  const now = new Date('2026-08-22T09:30:00Z');
  const f = buildForecast({ datasets, sources: {} }, { rebase: true, now });
  const days = forecastDays(f, now);

  assert.ok(days.length >= 7);
  // The regression this guards: today was filtered out of the strip entirely,
  // leaving no control to return to it once another day was selected.
  assert.ok(days.some((d) => d.toDateString() === now.toDateString()), 'today must be offered');
  assert.ok(days.every((d) => d >= new Date(now.getFullYear(), now.getMonth(), now.getDate())),
    'past days are not offered');

  const times = days.map((d) => d.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'days must be ordered');
  assert.equal(new Set(times).size, times.length, 'no duplicate days');
  assert.ok(days.every((d) => d.getHours() === 0 && d.getMinutes() === 0), 'days are midnights');
});

test('a forecast with only hourly data still builds', () => {
  const f = buildForecast({ datasets: { hourly: datasets.hourly }, sources: {} });
  assert.ok(f.steps.length > 0);
  assert.equal(f.days.length, 0);
});
