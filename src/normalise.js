/**
 * Turns Site Specific GeoJSON into the flat model the renderer consumes.
 *
 * Field names differ subtly between the endpoints (hourly reports
 * `feelsLikeTemperature`, three-hourly reports `feelsLikeTemp`), so every read
 * goes through an alias list rather than a single key.
 */
import { toDaytimeCode } from './weather-codes.js';

const HOUR = 3600_000;
const DAY = 86400_000;

const pick = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] != null) return row[key];
  }
  return null;
};

/**
 * A representative temperature for a step.
 *
 * The hourly endpoint reports an instantaneous `screenTemperature`, but the
 * three-hourly endpoint reports only the max and min over the period. Averaging
 * the two gives a single comparable figure for the table; either bound alone
 * would read hot or cold against the neighbouring hourly columns.
 */
function representativeTemperature(row) {
  const instant = pick(row, 'screenTemperature');
  if (instant != null) return instant;
  const max = pick(row, 'maxScreenAirTemp');
  const min = pick(row, 'minScreenAirTemp');
  if (max != null && min != null) return (max + min) / 2;
  return max ?? min;
}

function seriesOf(payload) {
  const feature = payload?.features?.[0];
  return {
    series: feature?.properties?.timeSeries ?? [],
    coordinates: feature?.geometry?.coordinates ?? [],
    name: feature?.properties?.location?.name ?? null,
    modelRunDate: feature?.properties?.modelRunDate ?? null,
    distance: feature?.properties?.requestPointDistance ?? null,
  };
}

function normaliseStep(row, resolution) {
  return {
    time: new Date(row.time),
    resolution,
    temperature: representativeTemperature(row),
    feelsLike: pick(row, 'feelsLikeTemperature', 'feelsLikeTemp'),
    dewPoint: pick(row, 'screenDewPointTemperature'),
    code: pick(row, 'significantWeatherCode'),
    precipProbability: pick(row, 'probOfPrecipitation'),
    precipRate: pick(row, 'precipitationRate'),
    precipAmount: pick(row, 'totalPrecipAmount'),
    snowAmount: pick(row, 'totalSnowAmount'),
    windSpeed: pick(row, 'windSpeed10m'),
    windDirection: pick(row, 'windDirectionFrom10m'),
    windGust: pick(row, 'windGustSpeed10m', 'max10mWindGust'),
    visibility: pick(row, 'visibility'),
    humidity: pick(row, 'screenRelativeHumidity'),
    pressure: pick(row, 'mslp'),
    uv: pick(row, 'uvIndex'),
  };
}

function normaliseDay(row) {
  const dayCode = pick(row, 'daySignificantWeatherCode');
  return {
    date: new Date(row.time),
    max: pick(row, 'dayMaxScreenTemperature'),
    min: pick(row, 'nightMinScreenTemperature'),
    maxFeelsLike: pick(row, 'dayMaxFeelsLikeTemp'),
    minFeelsLike: pick(row, 'nightMinFeelsLikeTemp'),
    // The strip always shows a daytime symbol, even if the code is a night one.
    code: dayCode == null ? null : toDaytimeCode(dayCode),
    nightCode: pick(row, 'nightSignificantWeatherCode'),
    maxUv: pick(row, 'maxUvIndex'),
    precipProbability: pick(row, 'dayProbabilityOfPrecipitation'),
    nightPrecipProbability: pick(row, 'nightProbabilityOfPrecipitation'),
    windSpeed: pick(row, 'midday10MWindSpeed'),
    windDirection: pick(row, 'midday10MWindDirection'),
    windGust: pick(row, 'midday10MWindGust'),
    humidity: pick(row, 'middayRelativeHumidity'),
    visibility: pick(row, 'middayVisibility'),
  };
}

/**
 * Offset that lands the first hourly step on the current hour, so sample data
 * reads as a forecast for right now. Whole hours only, keeping hour-of-day (and
 * therefore the diurnal temperature and UV curves) intact.
 */
export function rebaseOffset(hourlyPayload, now = new Date()) {
  const { series } = seriesOf(hourlyPayload);
  if (!series.length) return 0;
  const first = new Date(series[0].time).getTime();
  const currentHour = Math.floor(now.getTime() / HOUR) * HOUR;
  return Math.round((currentHour - first) / HOUR) * HOUR;
}

const shift = (step, offset) => ({ ...step, time: new Date(step.time.getTime() + offset) });

/** Daily rows carry a bare date, so the shifted value is snapped to a midnight. */
function shiftDay(day, offset) {
  const moved = new Date(day.date.getTime() + offset);
  const local = new Date(moved.getFullYear(), moved.getMonth(), moved.getDate());
  const rounded = moved.getTime() - local.getTime() >= DAY / 2
    ? new Date(local.getTime() + DAY)
    : local;
  return { ...day, date: rounded };
}

/**
 * Merges the three datasets into one model.
 *
 * Hourly covers roughly two days and three-hourly covers seven, so the two are
 * concatenated: hourly wins wherever both describe the same instant, giving
 * full detail up front and coarse steps further out -- the same shape the Met
 * Office site presents.
 */
export function buildForecast({ datasets, sources = {}, fetchedAt }, { rebase = false, now = new Date() } = {}) {
  const hourly = datasets.hourly ? seriesOf(datasets.hourly) : null;
  const threeHourly = datasets['three-hourly'] ? seriesOf(datasets['three-hourly']) : null;
  const daily = datasets.daily ? seriesOf(datasets.daily) : null;

  const offset = rebase ? rebaseOffset(datasets.hourly ?? datasets['three-hourly'], now) : 0;

  const hourlySteps = (hourly?.series ?? []).map((r) => normaliseStep(r, 'hourly'));
  const threeHourlySteps = (threeHourly?.series ?? []).map((r) => normaliseStep(r, 'three-hourly'));

  const covered = new Set(hourlySteps.map((s) => s.time.getTime()));
  const lastHourly = hourlySteps.at(-1)?.time.getTime() ?? -Infinity;
  const steps = [
    ...hourlySteps,
    ...threeHourlySteps.filter((s) => s.time.getTime() > lastHourly && !covered.has(s.time.getTime())),
  ]
    .map((s) => (offset ? shift(s, offset) : s))
    .sort((a, b) => a.time - b.time);

  const days = (daily?.series ?? [])
    .map(normaliseDay)
    .map((d) => (offset ? shiftDay(d, offset) : d))
    .sort((a, b) => a.date - b.date);

  const meta = hourly ?? threeHourly ?? daily ?? {};
  const [longitude, latitude, elevation] = meta.coordinates ?? [];

  return {
    locationName: meta.name ?? null,
    latitude,
    longitude,
    elevation,
    distanceFromRequest: meta.distance,
    modelRunDate: meta.modelRunDate
      ? new Date(new Date(meta.modelRunDate).getTime() + offset)
      : null,
    steps,
    days,
    sources,
    fetchedAt: fetchedAt ? new Date(fetchedAt) : null,
    rebased: offset !== 0,
  };
}

/** The steps belonging to one local calendar day. */
export function stepsForDay(forecast, date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + DAY);
  return forecast.steps.filter((s) => s.time >= start && s.time < end);
}

/**
 * Drops steps that have already passed, so the table opens on the current hour
 * rather than on a morning that is already over -- as the reference display does.
 *
 * Falls back to the whole series if everything is in the past, which happens
 * when a cached response has gone stale.
 */
export function fromCurrentHour(steps, now = new Date()) {
  const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const future = steps.filter((s) => s.time >= currentHour);
  return future.length ? future : steps;
}

/** Day-level summary derived from the hourly steps, for days the daily feed misses. */
export function summariseDay(steps) {
  if (!steps.length) return null;
  const temps = steps.map((s) => s.temperature).filter((t) => t != null);
  return {
    max: temps.length ? Math.max(...temps) : null,
    min: temps.length ? Math.min(...temps) : null,
    maxUv: Math.max(0, ...steps.map((s) => s.uv ?? 0)),
    precipProbability: Math.max(0, ...steps.map((s) => s.precipProbability ?? 0)),
  };
}
