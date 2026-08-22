/**
 * Writes the one-line plain-English outlook that sits beside the headline
 * temperature ("Sunny intervals changing to cloudy by lunchtime").
 *
 * The Site Specific API carries no written summary -- that text is authored
 * separately for the Met Office site -- so it is derived here from the run of
 * significant weather codes through the day.
 */
import { codeFamily } from './weather-codes.js';

const PERIODS = [
  { from: 0, to: 6, by: 'overnight', during: 'overnight' },
  { from: 6, to: 9, by: 'first thing', during: 'first thing' },
  { from: 9, to: 12, by: 'late morning', during: 'through the morning' },
  { from: 12, to: 14, by: 'lunchtime', during: 'around lunchtime' },
  { from: 14, to: 17, by: 'mid-afternoon', during: 'through the afternoon' },
  { from: 17, to: 20, by: 'early evening', during: 'in the early evening' },
  { from: 20, to: 24, by: 'tonight', during: 'tonight' },
];

const PHRASES = {
  clear: { lead: 'Clear skies', trail: 'clear skies' },
  'sunny-intervals': { lead: 'Sunny intervals', trail: 'sunny intervals' },
  cloudy: { lead: 'Cloudy', trail: 'cloudy' },
  overcast: { lead: 'Overcast', trail: 'overcast' },
  fog: { lead: 'Misty', trail: 'mist and fog' },
  rain: { lead: 'Rain', trail: 'rain' },
  sleet: { lead: 'Sleet', trail: 'sleet' },
  snow: { lead: 'Snow', trail: 'snow' },
  thunder: { lead: 'Thundery showers', trail: 'thundery showers' },
};

/** The family that best characterises a period: precipitation outranks cloud. */
function dominantFamily(steps) {
  if (!steps.length) return null;
  const counts = new Map();
  for (const s of steps) {
    if (s.code == null) continue;
    const family = codeFamily(s.code);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const PRECIP = ['thunder', 'snow', 'sleet', 'rain'];
  // Any meaningful spell of precipitation defines the period even if cloud
  // technically occupies more hours -- that is what a forecaster would lead on.
  for (const family of PRECIP) {
    if ((counts.get(family) ?? 0) >= Math.max(2, steps.length * 0.34)) return family;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function periodsFor(steps) {
  return PERIODS
    .map((p) => ({
      ...p,
      family: dominantFamily(steps.filter((s) => {
        const h = s.time.getHours();
        return h >= p.from && h < p.to;
      })),
    }))
    .filter((p) => p.family);
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {Array} steps  the day's forecast steps, in time order
 * @returns {string} a single sentence, or a fallback when there is nothing to say
 */
export function describeDay(steps) {
  const periods = periodsFor(steps);
  if (!periods.length) return 'Forecast detail is not available for this day.';

  const first = periods[0];
  const change = periods.find((p) => p.family !== first.family);
  const lead = PHRASES[first.family] ?? PHRASES.cloudy;

  let sentence;
  if (!change) {
    sentence = `${lead.lead} throughout the day.`;
  } else {
    const to = PHRASES[change.family] ?? PHRASES.cloudy;
    sentence = `${lead.lead} changing to ${to.trail} by ${change.by}.`;
  }

  // Call out a wet spell the cloud-led sentence would otherwise bury.
  const wettest = steps.reduce(
    (best, s) => ((s.precipProbability ?? 0) > (best?.precipProbability ?? -1) ? s : best),
    null,
  );
  const alreadyWet = ['rain', 'sleet', 'snow', 'thunder']
    .some((f) => [first.family, change?.family].includes(f));
  if (wettest && (wettest.precipProbability ?? 0) >= 50 && !alreadyWet) {
    const window = PERIODS.find((p) => {
      const h = wettest.time.getHours();
      return h >= p.from && h < p.to;
    });
    sentence += ` A chance of rain ${window?.during ?? 'later'}.`;
  }

  return capitalise(sentence);
}

/** Short outlook for a single day tile, used as its tooltip. */
export function describeDayBrief(steps) {
  const periods = periodsFor(steps);
  if (!periods.length) return '';
  const families = [...new Set(periods.map((p) => p.family))];
  return families.map((f) => (PHRASES[f] ?? PHRASES.cloudy).trail).join(', then ');
}
