/**
 * Builds development fixtures for the three-hourly and daily Site Specific
 * endpoints from the real hourly sample response.
 *
 * The hourly sample only spans ~2 days, but the UI needs a 7-day strip, so the
 * series is extended with a deterministic (seeded) walk that reuses the sample's
 * own diurnal shape. Everything here is synthetic beyond the sample's range and
 * is only ever used in mock mode -- see README.
 *
 *   node tools/make-fixtures.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HOURLY = JSON.parse(readFileSync(new URL('../fixtures/hourly.json', import.meta.url)));
const src = HOURLY.features[0];
const series = src.properties.timeSeries;
const [lon, lat, height] = src.geometry.coordinates;

// Deterministic PRNG so regenerating fixtures never churns the diff.
let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff);
};
const jitter = (span) => (rnd() - 0.5) * 2 * span;
const round = (n, dp = 2) => Number(n.toFixed(dp));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const iso = (d) => d.toISOString().replace(/:\d\d\.\d+Z$/, 'Z');

// ---------------------------------------------------------------------------
// Extend the hourly series out to 7 days by repeating the sample's diurnal
// profile with a slow drift, so later days look plausible rather than cloned.
// ---------------------------------------------------------------------------
const byHour = new Map();
for (const s of series) {
  const h = new Date(s.time).getUTCHours();
  if (!byHour.has(h)) byHour.set(h, []);
  byHour.get(h).push(s);
}
const profile = (h) => {
  const bucket = byHour.get(h) ?? series;
  return bucket[Math.floor(rnd() * bucket.length)];
};

const start = new Date(series[0].time);
const day0 = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
const TOTAL_HOURS = 7 * 24;

const extended = [];
for (let i = 0; i < TOTAL_HOURS; i++) {
  const t = new Date(day0.getTime() + i * 3600_000);
  const exact = series.find((s) => s.time === iso(t));
  if (exact) { extended.push({ ...exact }); continue; }

  const base = profile(t.getUTCHours());
  // A gentle warming trend across the week, matching the screenshot's shape.
  const trend = (i / TOTAL_HOURS) * 4.5;
  const temp = round(base.screenTemperature + trend + jitter(1.2), 2);
  const feels = round(temp - (base.screenTemperature - base.feelsLikeTemperature) + jitter(0.4), 2);
  extended.push({
    ...base,
    time: iso(t),
    screenTemperature: temp,
    feelsLikeTemperature: feels,
    maxScreenAirTemp: round(temp + Math.abs(jitter(0.5)), 2),
    minScreenAirTemp: round(temp - Math.abs(jitter(0.5)), 2),
    screenDewPointTemperature: round(base.screenDewPointTemperature + trend * 0.4 + jitter(0.6), 2),
    screenRelativeHumidity: round(clamp(base.screenRelativeHumidity + jitter(6), 25, 99), 2),
    windSpeed10m: round(Math.max(0.4, base.windSpeed10m + jitter(1.4)), 2),
    windGustSpeed10m: round(Math.max(0.8, base.windGustSpeed10m + jitter(2.2)), 2),
    max10mWindGust: round(Math.max(1, (base.max10mWindGust ?? base.windGustSpeed10m) + jitter(2.4)), 2),
    windDirectionFrom10m: Math.round((base.windDirectionFrom10m + jitter(40) + 360) % 360),
    visibility: Math.round(clamp(base.visibility + jitter(9000), 900, 60000)),
    probOfPrecipitation: Math.round(clamp(base.probOfPrecipitation + jitter(22), 0, 95)),
    mslp: Math.round(base.mslp + jitter(400)),
  });
}

// ---------------------------------------------------------------------------
// three-hourly: sample the extended hourly series every 3 hours, aggregating
// the "over previous period" fields the way the real endpoint does.
// ---------------------------------------------------------------------------
const threeHourly = [];
for (let i = 0; i < extended.length; i += 3) {
  const window = extended.slice(i, i + 3);
  if (window.length < 3) break;
  const s = window[0];
  const max = (k) => Math.max(...window.map((w) => w[k] ?? -Infinity));
  const min = (k) => Math.min(...window.map((w) => w[k] ?? Infinity));
  const sum = (k) => round(window.reduce((a, w) => a + (w[k] ?? 0), 0), 2);
  threeHourly.push({
    time: s.time,
    maxScreenAirTemp: round(max('maxScreenAirTemp')),
    minScreenAirTemp: round(min('minScreenAirTemp')),
    max10mWindGust: round(max('max10mWindGust')),
    significantWeatherCode: window.map((w) => w.significantWeatherCode)
      .sort((a, b) => b - a)[0],
    totalPrecipAmount: sum('totalPrecipAmount'),
    totalSnowAmount: sum('totalSnowAmount'),
    windSpeed10m: s.windSpeed10m,
    windDirectionFrom10m: s.windDirectionFrom10m,
    windGustSpeed10m: s.windGustSpeed10m,
    visibility: s.visibility,
    mslp: s.mslp,
    screenRelativeHumidity: s.screenRelativeHumidity,
    feelsLikeTemp: s.feelsLikeTemperature,
    uvIndex: Math.max(...window.map((w) => w.uvIndex ?? 0)),
    probOfPrecipitation: Math.round(max('probOfPrecipitation')),
    probOfSnow: 0,
    probOfHeavySnow: 0,
    probOfRain: Math.round(max('probOfPrecipitation')),
    probOfHeavyRain: Math.round(max('probOfPrecipitation') / 3),
    probOfHail: 0,
    probOfSferics: 0,
    screenDewPointTemperature: s.screenDewPointTemperature,
    // Deliberately no screenTemperature: the real three-hourly endpoint reports
    // only maxScreenAirTemp/minScreenAirTemp, and carrying an extra field here
    // would hide bugs that only show up against live data.
  });
}

// ---------------------------------------------------------------------------
// daily: day = 06:00-18:00Z, night = 18:00-06:00Z, mirroring the real endpoint.
// ---------------------------------------------------------------------------
const dayKey = (t) => t.slice(0, 10);
const buckets = new Map();
for (const s of extended) {
  const k = dayKey(s.time);
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push(s);
}

const daily = [];
for (const [k, hours] of buckets) {
  const dayHrs = hours.filter((h) => {
    const hh = new Date(h.time).getUTCHours();
    return hh >= 6 && hh < 18;
  });
  const nightHrs = hours.filter((h) => {
    const hh = new Date(h.time).getUTCHours();
    return hh < 6 || hh >= 18;
  });
  if (!dayHrs.length || !nightHrs.length) continue;

  const midday = dayHrs.find((h) => new Date(h.time).getUTCHours() === 12) ?? dayHrs[0];
  const midnight = nightHrs.find((h) => new Date(h.time).getUTCHours() === 0) ?? nightHrs[0];
  // The representative code is the most "significant" (highest) of the period,
  // which is how the daily endpoint tends to read against the hourly series.
  const repCode = (hs) => hs.map((h) => h.significantWeatherCode).sort((a, b) => b - a)[0];
  const dayMax = Math.max(...dayHrs.map((h) => h.screenTemperature));
  const nightMin = Math.min(...nightHrs.map((h) => h.screenTemperature));

  daily.push({
    time: `${k}Z`,
    midday10MWindSpeed: midday.windSpeed10m,
    midnight10MWindSpeed: midnight.windSpeed10m,
    midday10MWindDirection: midday.windDirectionFrom10m,
    midnight10MWindDirection: midnight.windDirectionFrom10m,
    midday10MWindGust: midday.windGustSpeed10m,
    midnight10MWindGust: midnight.windGustSpeed10m,
    middayVisibility: midday.visibility,
    midnightVisibility: midnight.visibility,
    middayRelativeHumidity: midday.screenRelativeHumidity,
    midnightRelativeHumidity: midnight.screenRelativeHumidity,
    middayMslp: midday.mslp,
    midnightMslp: midnight.mslp,
    maxUvIndex: Math.max(...dayHrs.map((h) => h.uvIndex ?? 0)),
    daySignificantWeatherCode: repCode(dayHrs),
    nightSignificantWeatherCode: repCode(nightHrs),
    dayMaxScreenTemperature: round(dayMax, 2),
    nightMinScreenTemperature: round(nightMin, 2),
    dayUpperBoundMaxTemp: round(dayMax + 1.6, 2),
    dayLowerBoundMaxTemp: round(dayMax - 1.6, 2),
    nightUpperBoundMinTemp: round(nightMin + 1.4, 2),
    nightLowerBoundMinTemp: round(nightMin - 1.4, 2),
    dayMaxFeelsLikeTemp: round(Math.max(...dayHrs.map((h) => h.feelsLikeTemperature)), 2),
    nightMinFeelsLikeTemp: round(Math.min(...nightHrs.map((h) => h.feelsLikeTemperature)), 2),
    dayUpperBoundMaxFeelsLikeTemp: round(Math.max(...dayHrs.map((h) => h.feelsLikeTemperature)) + 1.5, 2),
    dayLowerBoundMaxFeelsLikeTemp: round(Math.max(...dayHrs.map((h) => h.feelsLikeTemperature)) - 1.5, 2),
    nightUpperBoundMinFeelsLikeTemp: round(Math.min(...nightHrs.map((h) => h.feelsLikeTemperature)) + 1.5, 2),
    nightLowerBoundMinFeelsLikeTemp: round(Math.min(...nightHrs.map((h) => h.feelsLikeTemperature)) - 1.5, 2),
    dayProbabilityOfPrecipitation: Math.round(Math.max(...dayHrs.map((h) => h.probOfPrecipitation))),
    nightProbabilityOfPrecipitation: Math.round(Math.max(...nightHrs.map((h) => h.probOfPrecipitation))),
    dayProbabilityOfSnow: 0,
    nightProbabilityOfSnow: 0,
    dayProbabilityOfHeavySnow: 0,
    nightProbabilityOfHeavySnow: 0,
    dayProbabilityOfRain: Math.round(Math.max(...dayHrs.map((h) => h.probOfPrecipitation))),
    nightProbabilityOfRain: Math.round(Math.max(...nightHrs.map((h) => h.probOfPrecipitation))),
    dayProbabilityOfHeavyRain: Math.round(Math.max(...dayHrs.map((h) => h.probOfPrecipitation)) / 3),
    nightProbabilityOfHeavyRain: Math.round(Math.max(...nightHrs.map((h) => h.probOfPrecipitation)) / 3),
    dayProbabilityOfHail: 0,
    nightProbabilityOfHail: 0,
    dayProbabilityOfSferics: 0,
    nightProbabilityOfSferics: 0,
  });
}

const envelope = (timeSeries, extraParams) => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, height] },
    properties: {
      location: { name: 'Cheltenham (Gloucestershire)' },
      requestPointDistance: src.properties.requestPointDistance,
      modelRunDate: src.properties.modelRunDate,
      timeSeries,
    },
  }],
  parameters: HOURLY.parameters,
  ...extraParams,
});

writeFileSync(
  new URL('../fixtures/three-hourly.json', import.meta.url),
  JSON.stringify(envelope(threeHourly), null, 2) + '\n',
);
writeFileSync(
  new URL('../fixtures/daily.json', import.meta.url),
  JSON.stringify(envelope(daily), null, 2) + '\n',
);

console.log(`three-hourly: ${threeHourly.length} steps  ${threeHourly[0].time} -> ${threeHourly.at(-1).time}`);
console.log(`daily:        ${daily.length} steps  ${daily[0].time} -> ${daily.at(-1).time}`);
