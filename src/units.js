/** Unit conversion and formatting. The API always reports SI: °C, m/s, metres. */

export const TEMPERATURE_UNITS = { C: '°C', F: '°F' };
export const WIND_UNITS = { mph: 'mph', kn: 'knots', 'm/s': 'm/s', 'km/h': 'km/h' };
export const VISIBILITY_UNITS = { description: 'description', mi: 'miles', km: 'km' };

const WIND_FACTORS = { mph: 2.236936, kn: 1.943844, 'm/s': 1, 'km/h': 3.6 };

export function convertTemp(celsius, unit) {
  if (celsius == null) return null;
  return unit === 'F' ? celsius * 9 / 5 + 32 : celsius;
}

export function formatTemp(celsius, unit) {
  const v = convertTemp(celsius, unit);
  return v == null ? '–' : `${Math.round(v)}°`;
}

export function convertWind(metresPerSecond, unit) {
  if (metresPerSecond == null) return null;
  return metresPerSecond * (WIND_FACTORS[unit] ?? WIND_FACTORS.mph);
}

export function formatWind(metresPerSecond, unit) {
  const v = convertWind(metresPerSecond, unit);
  return v == null ? '–' : String(Math.round(v));
}

/**
 * Met Office visibility bands. The boundaries are the published ones; the
 * two-letter codes are what the forecast table shows.
 */
const VISIBILITY_BANDS = [
  { max: 1000, code: 'VP', label: 'Very poor' },
  { max: 4000, code: 'PO', label: 'Poor' },
  { max: 10000, code: 'MO', label: 'Moderate' },
  { max: 20000, code: 'G', label: 'Good' },
  { max: 40000, code: 'VG', label: 'Very good' },
  { max: Infinity, code: 'EX', label: 'Excellent' },
];

export function visibilityBand(metres) {
  if (metres == null) return { code: '–', label: 'Not available' };
  return VISIBILITY_BANDS.find((b) => metres < b.max);
}

export function formatVisibility(metres, unit) {
  if (metres == null) return '–';
  if (unit === 'mi') {
    const mi = metres / 1609.344;
    return mi < 10 ? mi.toFixed(1) : String(Math.round(mi));
  }
  if (unit === 'km') {
    const km = metres / 1000;
    return km < 10 ? km.toFixed(1) : String(Math.round(km));
  }
  return visibilityBand(metres).code;
}

/**
 * Distance from the requested coordinates to the model grid point the forecast
 * actually came from. The API reports this in metres: UK site-specific data sits
 * on a roughly 2 km grid, so values are typically a few hundred metres and can
 * never plausibly reach the tens of kilometres a km reading would imply.
 */
export function formatDistance(metres) {
  if (metres == null) return '–';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass point the wind is blowing *from*, matching the API's convention. */
export function compassPoint(degrees) {
  if (degrees == null) return '–';
  return COMPASS[Math.round((degrees % 360) / 22.5) % 16];
}

/**
 * UV exposure bands as published by the Met Office / WHO.
 * `band` drives the swatch colour in the hourly table.
 */
export function uvBand(index) {
  if (index == null) return { band: 'none', label: 'Not available', short: '–' };
  if (index <= 2) return { band: 'low', label: 'Low', short: 'L' };
  if (index <= 5) return { band: 'moderate', label: 'Moderate', short: 'M' };
  if (index <= 7) return { band: 'high', label: 'High', short: 'H' };
  if (index <= 10) return { band: 'very-high', label: 'Very high', short: 'VH' };
  return { band: 'extreme', label: 'Extreme', short: 'E' };
}

/**
 * Temperature colour scale approximating the Met Office forecast table. Stops
 * are interpolated in sRGB, which is close enough over these short spans.
 */
const TEMP_STOPS = [
  [-15, [90, 76, 150]], [-10, [107, 100, 180]], [-5, [91, 143, 214]],
  [0, [143, 198, 232]], [3, [185, 223, 240]], [6, [216, 238, 200]],
  [9, [242, 240, 168]], [12, [251, 213, 138]], [15, [250, 195, 119]],
  [18, [247, 173, 92]], [21, [243, 146, 71]], [24, [236, 111, 60]],
  [27, [223, 74, 53]], [30, [201, 47, 48]], [35, [165, 31, 63]],
  [40, [125, 19, 56]],
];

export function temperatureColour(celsius) {
  if (celsius == null) return '#e9ecef';
  const stops = TEMP_STOPS;
  if (celsius <= stops[0][0]) return rgb(stops[0][1]);
  if (celsius >= stops.at(-1)[0]) return rgb(stops.at(-1)[1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (celsius >= t0 && celsius <= t1) {
      const f = (celsius - t0) / (t1 - t0);
      return rgb(c0.map((c, j) => Math.round(c + (c1[j] - c) * f)));
    }
  }
  return '#e9ecef';
}

/** Dark text on light swatches, white on the deep blues and reds. */
export function readableInk(hex) {
  const [r, g, b] = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1d1d1d' : '#ffffff';
}

function rgb([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}
