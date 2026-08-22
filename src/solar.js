/**
 * Sunrise and sunset from the NOAA solar position equations.
 *
 * The Site Specific API doesn't carry these, and they're part of the layout we
 * are reproducing, so they're computed locally -- no extra API call, no extra
 * key, and accurate to well under a minute for UK latitudes.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Days since the J2000.0 epoch for the given instant. */
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function solarNoonEvents(date, latitude, longitude) {
  // The sunrise equation is written with west longitude positive.
  const west = -longitude;
  // `n` is the whole number of mean solar days since J2000.0 at this meridian;
  // it must stay an integer or every downstream term slips by that fraction.
  const n = Math.round(julianDay(date) - 2451545.0 - 0.0009 - west / 360);
  const meanSolarNoon = 2451545.0 + 0.0009 + west / 360 + n;

  const meanAnomaly = (357.5291 + 0.98560028 * (meanSolarNoon - 2451545.0)) % 360;
  const centre = 1.9148 * Math.sin(meanAnomaly * RAD)
    + 0.02 * Math.sin(2 * meanAnomaly * RAD)
    + 0.0003 * Math.sin(3 * meanAnomaly * RAD);
  const eclipticLongitude = (meanAnomaly + centre + 180 + 102.9372) % 360;
  const solarTransit = meanSolarNoon
    + 0.0053 * Math.sin(meanAnomaly * RAD)
    - 0.0069 * Math.sin(2 * eclipticLongitude * RAD);
  const declination = Math.asin(Math.sin(eclipticLongitude * RAD) * Math.sin(23.44 * RAD));

  // -0.833° accounts for refraction plus the sun's apparent radius, which is
  // the convention the Met Office uses for published sunrise/sunset times.
  const cosHourAngle = (Math.sin(-0.833 * RAD) - Math.sin(latitude * RAD) * Math.sin(declination))
    / (Math.cos(latitude * RAD) * Math.cos(declination));

  if (cosHourAngle > 1) return { sunrise: null, sunset: null, reason: 'polar-night' };
  if (cosHourAngle < -1) return { sunrise: null, sunset: null, reason: 'midnight-sun' };

  const hourAngle = Math.acos(cosHourAngle) * DEG;
  const toDate = (julian) => new Date((julian - 2440587.5) * 86400000);
  return {
    sunrise: toDate(solarTransit - hourAngle / 360),
    sunset: toDate(solarTransit + hourAngle / 360),
    reason: null,
  };
}

/**
 * Sunrise/sunset for the local calendar day containing `date`.
 *
 * The NOAA formulation is anchored on UTC days, so near the day boundary it can
 * return an event belonging to the neighbouring day; the result is nudged by a
 * day until it lands inside the local day the caller asked about.
 */
export function sunTimes(date, latitude, longitude) {
  const target = new Date(date);
  const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  for (const shift of [0, -1, 1]) {
    const probe = new Date(target.getTime() + shift * 86400000);
    const { sunrise, sunset, reason } = solarNoonEvents(probe, latitude, longitude);
    if (reason) return { sunrise: null, sunset: null, reason };
    if (sunrise >= dayStart && sunrise < dayEnd) return { sunrise, sunset, reason: null };
  }
  return solarNoonEvents(target, latitude, longitude);
}

/** True when the instant falls between sunrise and sunset at that location. */
export function isDaylight(date, latitude, longitude) {
  const { sunrise, sunset, reason } = sunTimes(date, latitude, longitude);
  if (reason === 'midnight-sun') return true;
  if (reason === 'polar-night' || !sunrise || !sunset) return false;
  return date >= sunrise && date <= sunset;
}
