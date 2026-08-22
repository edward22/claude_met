/**
 * Met Office significant weather codes.
 *
 * `night` marks the codes that only ever occur after dark, which is what lets
 * the hourly strip pick a moon rather than a sun without needing sunrise times.
 * `icon` names an entry in the icon sprite (see icons.js).
 */
export const WEATHER_CODES = {
  '-1': { label: 'Trace rain', icon: 'drizzle', night: false },
  0: { label: 'Clear night', icon: 'clear-night', night: true },
  1: { label: 'Sunny day', icon: 'sunny', night: false },
  2: { label: 'Partly cloudy', icon: 'partly-cloudy-night', night: true },
  3: { label: 'Sunny intervals', icon: 'partly-cloudy-day', night: false },
  4: { label: 'Not used', icon: 'cloudy', night: false },
  5: { label: 'Mist', icon: 'mist', night: false },
  6: { label: 'Fog', icon: 'fog', night: false },
  7: { label: 'Cloudy', icon: 'cloudy', night: false },
  8: { label: 'Overcast', icon: 'overcast', night: false },
  9: { label: 'Light rain shower', icon: 'light-shower-night', night: true },
  10: { label: 'Light rain shower', icon: 'light-shower-day', night: false },
  11: { label: 'Drizzle', icon: 'drizzle', night: false },
  12: { label: 'Light rain', icon: 'light-rain', night: false },
  13: { label: 'Heavy rain shower', icon: 'heavy-shower-night', night: true },
  14: { label: 'Heavy rain shower', icon: 'heavy-shower-day', night: false },
  15: { label: 'Heavy rain', icon: 'heavy-rain', night: false },
  16: { label: 'Sleet shower', icon: 'sleet-shower-night', night: true },
  17: { label: 'Sleet shower', icon: 'sleet-shower-day', night: false },
  18: { label: 'Sleet', icon: 'sleet', night: false },
  19: { label: 'Hail shower', icon: 'hail-shower-night', night: true },
  20: { label: 'Hail shower', icon: 'hail-shower-day', night: false },
  21: { label: 'Hail', icon: 'hail', night: false },
  22: { label: 'Light snow shower', icon: 'light-snow-night', night: true },
  23: { label: 'Light snow shower', icon: 'light-snow-day', night: false },
  24: { label: 'Light snow', icon: 'light-snow', night: false },
  25: { label: 'Heavy snow shower', icon: 'heavy-snow-night', night: true },
  26: { label: 'Heavy snow shower', icon: 'heavy-snow-day', night: false },
  27: { label: 'Heavy snow', icon: 'heavy-snow', night: false },
  28: { label: 'Thunder shower', icon: 'thunder-shower-night', night: true },
  29: { label: 'Thunder shower', icon: 'thunder-shower-day', night: false },
  30: { label: 'Thunder', icon: 'thunder', night: false },
};

const UNKNOWN = { label: 'Not available', icon: 'unknown', night: false };

export function describeCode(code) {
  return WEATHER_CODES[String(code)] ?? UNKNOWN;
}

/**
 * The daily endpoint reports a separate night code, but the day tiles in the
 * strip always show the daytime symbol -- so a night-only code arriving there
 * gets swapped for its daytime twin.
 */
const NIGHT_TO_DAY = { 0: 1, 2: 3, 9: 10, 13: 14, 16: 17, 19: 20, 22: 23, 25: 26, 28: 29 };

export function toDaytimeCode(code) {
  return NIGHT_TO_DAY[String(code)] ?? code;
}

/** Broad families, used to write the plain-English day summary. */
export function codeFamily(code) {
  const n = Number(code);
  if (n === 0 || n === 1) return 'clear';
  if (n === 2 || n === 3) return 'sunny-intervals';
  if (n === 5 || n === 6) return 'fog';
  if (n === 7) return 'cloudy';
  if (n === 8) return 'overcast';
  if (n >= 9 && n <= 15) return 'rain';
  if (n >= 16 && n <= 21) return 'sleet';
  if (n >= 22 && n <= 27) return 'snow';
  if (n >= 28 && n <= 30) return 'thunder';
  return 'cloudy';
}
