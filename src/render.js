/**
 * Renders the forecast in the layout of the retiring Met Office display: a hero
 * band with today's headline, a scrolling strip of day tiles, and the hourly
 * parameter table beneath.
 */
import { describeCode } from './weather-codes.js';
import { weatherIcon } from './icons.js';
import { sunTimes } from './solar.js';
import { describeDay, describeDayBrief } from './summary.js';
import { stepsForDay, summariseDay, fromCurrentHour } from './normalise.js';
import {
  formatTemp, formatWind, formatVisibility, visibilityBand,
  compassPoint, uvBand, temperatureColour, readableInk,
} from './units.js';

const DAY_MS = 86400_000;

const dayParts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** "Fri 21 Aug" -- en-GB inserts a comma after the weekday, which the design omits. */
const fmtDay = { format: (d) => dayParts.format(d).replace(',', '') };
const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtFull = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** Explanations behind the (i) buttons, lifted from the Met Office glossary. */
const INFO = {
  weather: 'The most significant weather expected during the hour, shown as a symbol.',
  precipitation: 'The likelihood of 0.1 mm or more of precipitation falling during the hour.',
  temperature: 'Air temperature measured 1.5 m above the ground, away from direct sunlight.',
  feels: 'How the temperature feels once wind chill and humidity are taken into account.',
  wind: 'The direction the wind is blowing from, and the mean speed 10 m above the ground. '
    + 'The arrow points the way the wind is travelling.',
  gust: 'The strongest gust expected during the hour, 10 m above the ground.',
  visibility: 'How far you can expect to see. Very poor: under 1 km. Poor: 1–4 km. '
    + 'Moderate: 4–10 km. Good: 10–20 km. Very good: 20–40 km. Excellent: over 40 km.',
  humidity: 'The amount of moisture in the air as a percentage of the maximum it could hold.',
  uv: 'Strength of the sun\'s ultraviolet radiation. 1–2 low, 3–5 moderate, 6–7 high, '
    + '8–10 very high, 11+ extreme.',
};

const infoButton = (key) =>
  `<button type="button" class="info" data-info="${key}" aria-label="More about this row">i</button>`;

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function renderIndices(day, maxUv) {
  const uv = uvBand(maxUv);
  const unavailable = 'Air quality and pollen are published separately by DEFRA and are not '
    + 'part of the Met Office Site Specific API, so no value is available here.';
  return `
    <div class="indices">
      <div class="index">
        <span class="index__badge index__badge--square uv-${uv.band}" title="Maximum UV index today: ${maxUv ?? '–'} (${esc(uv.label)})">${esc(uv.short)}</span>
        <span class="index__label">UV</span>
      </div>
      <div class="index index--unavailable">
        <span class="index__badge" title="${esc(unavailable)}">–</span>
        <span class="index__label">Pollution</span>
      </div>
      <div class="index index--unavailable">
        <span class="index__badge" title="${esc(unavailable)}">–</span>
        <span class="index__label">Pollen</span>
      </div>
    </div>`;
}

export function renderHero(forecast, settings, now = new Date()) {
  const today = forecast.days.find((d) => sameDay(d.date, now)) ?? forecast.days[0];
  const anchor = today?.date ?? now;
  const todaySteps = stepsForDay(forecast, anchor);
  const derived = summariseDay(todaySteps);

  const max = today?.max ?? derived?.max;
  const min = today?.min ?? derived?.min;
  const maxUv = today?.maxUv ?? derived?.maxUv;
  const unit = settings.units.temperature;

  const { sunrise, sunset, reason } = sunTimes(anchor, forecast.latitude, forecast.longitude);
  const sunText = reason === 'midnight-sun' ? 'The sun does not set today'
    : reason === 'polar-night' ? 'The sun does not rise today'
      : null;

  return `
    <div class="hero__today">
      <p class="hero__date">${esc(fmtDay.format(anchor))}</p>
      <p class="hero__temps">
        <span class="hero__max">${esc(formatTemp(max, unit))}</span>
        <span class="hero__min">${esc(formatTemp(min, unit))}</span>
      </p>
      ${sunText
    ? `<p class="hero__sun">${esc(sunText)}</p>`
    : `<p class="hero__sun">
             <span class="hero__sun-item">${sunriseIcon()} Sunrise: ${esc(fmtTime.format(sunrise))}</span>
             <span class="hero__sun-item">${sunsetIcon()} Sunset: ${esc(fmtTime.format(sunset))}</span>
           </p>`}
    </div>
    <div class="hero__outlook">
      <p class="hero__summary">${esc(describeDay(todaySteps))}</p>
      ${renderIndices(today, maxUv)}
    </div>`;
}

const sunriseIcon = () => `<svg class="sun-icon" viewBox="0 0 20 16" aria-hidden="true" width="16" height="13">
  <path d="M2 13 h16" stroke="#3d3d3d" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="10" cy="10" r="4" fill="#f6a01f"/>
  <path d="M10 1.5 v3 M4.2 4 l2 2 M15.8 4 l-2 2" stroke="#3d3d3d" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const sunsetIcon = () => `<svg class="sun-icon" viewBox="0 0 20 16" aria-hidden="true" width="16" height="13">
  <path d="M2 13 h16" stroke="#3d3d3d" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="10" cy="10" r="4" fill="#f6a01f"/>
  <path d="M10 5.5 v-3 M6.2 3.2 l1.6 1.8 M13.8 3.2 l-1.6 1.8" stroke="#3d3d3d" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// ---------------------------------------------------------------------------
// Day strip
// ---------------------------------------------------------------------------

export function renderDayStrip(forecast, settings, now = new Date()) {
  const unit = settings.units.temperature;
  const todayStart = startOfDay(now).getTime();

  // The hero already carries today, so the strip starts from tomorrow -- as it
  // does on the Met Office page.
  return forecast.days
    .filter((d) => startOfDay(d.date).getTime() > todayStart)
    .map((day) => {
      const steps = stepsForDay(forecast, day.date);
      const { label } = describeCode(day.code);
      const brief = describeDayBrief(steps);
      return `
        <button type="button" class="day-tile" data-date="${day.date.toISOString()}"
                title="${esc(fmtFull.format(day.date))}${brief ? ` — ${esc(brief)}` : ''}">
          <span class="day-tile__name">${esc(fmtDay.format(day.date))}</span>
          <span class="day-tile__body">
            <span class="day-tile__icon">${weatherIcon(describeCode(day.code).icon, label, 38)}</span>
            <span class="day-tile__temps">
              <span class="day-tile__max">${esc(formatTemp(day.max, unit))}</span>
              <span class="day-tile__min">${esc(formatTemp(day.min, unit))}</span>
            </span>
          </span>
        </button>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Hourly table
// ---------------------------------------------------------------------------

/** Arrow pointing the way the wind travels, i.e. 180° from the reported bearing. */
function windArrow(direction) {
  if (direction == null) return '';
  return `<svg class="wind-arrow" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
       style="transform: rotate(${(direction + 180) % 360}deg)">
    <path d="M8 1 L13 14 L8 11 L3 14 Z" fill="#3d3d3d"/>
  </svg>`;
}

const tempCell = (value, unit) => {
  const colour = temperatureColour(value);
  return `<td class="cell cell--temp" style="background:${colour};color:${readableInk(colour)}">`
    + `${esc(formatTemp(value, unit))}</td>`;
};

/** Groups consecutive steps into local calendar days. */
function groupByDay(steps) {
  const groups = [];
  for (const step of steps) {
    const key = startOfDay(step.time).getTime();
    const last = groups.at(-1);
    if (last && last.key === key) last.steps.push(step);
    else groups.push({ key, date: startOfDay(step.time), steps: [step] });
  }
  return groups;
}

/**
 * Builds the table. Days are laid out left to right in one continuous scroller
 * with a gap column between them, so the panels read as separate days while all
 * rows stay aligned.
 */
export function renderHourlyTable(forecast, settings, now = new Date()) {
  const groups = groupByDay(fromCurrentHour(forecast.steps, now));
  if (!groups.length) return '<p class="empty">No hourly detail is available.</p>';

  const { temperature: tUnit, wind: wUnit, visibility: vUnit } = settings.units;

  // A <col> per rendered cell keeps widths stable under table-layout: fixed.
  const cols = [];
  const cells = [];   // flat list of column descriptors, including gaps
  groups.forEach((group, i) => {
    if (i > 0) { cols.push('<col class="col-gap">'); cells.push({ gap: true }); }
    group.steps.forEach((step) => {
      cols.push('<col class="col-hour">');
      cells.push({ step, group });
    });
  });

  const span = cells.length;

  const headRow = cells.map((c) => (c.gap
    ? '<td class="gap" aria-hidden="true"></td>'
    : `<th scope="col" class="hour">${esc(fmtTime.format(c.step.time))}</th>`)).join('');

  const dayRow = (() => {
    let out = '';
    groups.forEach((group, i) => {
      if (i > 0) out += '<td class="gap" aria-hidden="true"></td>';
      const label = sameDay(group.date, now) ? 'Today'
        : sameDay(group.date, new Date(now.getTime() + DAY_MS)) ? 'Tomorrow'
          : fmtDay.format(group.date);
      out += `<th scope="colgroup" colspan="${group.steps.length}" class="day-head"
                  id="day-${group.key}"><span class="day-head__inner">${esc(label)}</span></th>`;
    });
    return out;
  })();

  // The inner span is sticky so parameter names stay readable while the table
  // scrolls sideways; at rest it sits exactly where the flat design puts it.
  const labelRow = (text, key, control = '') =>
    `<tr class="row-label"><td colspan="${span}"><span class="row-label__inner">`
    + `<span class="row-label__text">${esc(text)}</span>${control}${infoButton(key)}`
    + `</span></td></tr>`;

  const valueRow = (className, fn) =>
    `<tr class="row-values ${className}">`
    + cells.map((c) => (c.gap ? '<td class="gap" aria-hidden="true"></td>' : fn(c.step))).join('')
    + '</tr>';

  const select = (name, options, current) =>
    `<select class="unit-select" data-unit="${name}" aria-label="Units">`
    + Object.entries(options).map(([value, label]) =>
      `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`).join('')
    + '</select>';

  const tempUnits = { C: '°C', F: '°F' };
  const windUnits = { mph: 'mph', kn: 'knots', 'm/s': 'm/s', 'km/h': 'km/h' };
  const visUnits = { description: 'description', mi: 'miles', km: 'km' };

  return `
  <table class="hourly-table" style="width:${span * 76}px">
    <caption class="sr-only">Hourly forecast for ${esc(forecast.locationName ?? 'the selected location')}</caption>
    <colgroup>${cols.join('')}</colgroup>
    <thead>
      <tr class="row-days">${dayRow}</tr>
      <tr class="row-hours">${headRow}</tr>
    </thead>
    <tbody>
      ${labelRow('Weather symbols', 'weather')}
      ${valueRow('is-symbols', (s) => {
    const { label, icon } = describeCode(s.code);
    return `<td class="cell cell--symbol" title="${esc(label)}">${weatherIcon(icon, label, 36)}</td>`;
  })}

      ${labelRow('Chance of precipitation', 'precipitation')}
      ${valueRow('is-pop', (s) => {
    const v = s.precipProbability;
    const wet = v != null && v >= 30 ? ' is-wet' : '';
    return `<td class="cell cell--pop${wet}">${v == null ? '–' : `${Math.round(v)}%`}</td>`;
  })}

      ${labelRow('Temperature', 'temperature', select('temperature', tempUnits, tUnit))}
      ${valueRow('is-temp', (s) => tempCell(s.temperature, tUnit))}

      ${labelRow(`Feels like temperature (${tempUnits[tUnit]})`, 'feels')}
      ${valueRow('is-temp', (s) => tempCell(s.feelsLike, tUnit))}

      ${labelRow('Wind direction and speed', 'wind', select('wind', windUnits, wUnit))}
      ${valueRow('is-wind', (s) => `<td class="cell cell--wind"
          title="${esc(compassPoint(s.windDirection))} ${esc(formatWind(s.windSpeed, wUnit))} ${esc(wUnit)}">
          <span class="wind-dir">${windArrow(s.windDirection)}<span>${esc(compassPoint(s.windDirection))}</span></span>
          <span class="wind-speed">${esc(formatWind(s.windSpeed, wUnit))}</span></td>`)}

      ${labelRow(`Wind gust (${windUnits[wUnit]})`, 'gust')}
      ${valueRow('is-gust', (s) => `<td class="cell">${esc(formatWind(s.windGust, wUnit))}</td>`)}

      ${labelRow('Visibility', 'visibility', select('visibility', visUnits, vUnit))}
      ${valueRow('is-vis', (s) => `<td class="cell" title="${esc(visibilityBand(s.visibility).label)}">`
    + `${esc(formatVisibility(s.visibility, vUnit))}</td>`)}

      ${labelRow('Humidity', 'humidity')}
      ${valueRow('is-humidity', (s) => `<td class="cell">${s.humidity == null ? '–' : `${Math.round(s.humidity)}%`}</td>`)}

      ${labelRow('UV', 'uv')}
      ${valueRow('is-uv', (s) => {
    const band = uvBand(s.uv);
    const none = s.uv == null || s.uv === 0;
    return `<td class="cell cell--uv"><span class="uv-chip uv-${none ? 'none' : band.band}"
        title="${esc(none ? 'None' : band.label)}">${none ? '–' : s.uv}</span></td>`;
  })}
    </tbody>
  </table>`;
}

export { INFO, esc, fmtDay, fmtTime, fmtFull, sameDay, startOfDay };
