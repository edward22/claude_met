/**
 * Turning a place name into coordinates.
 *
 * The Site Specific API takes latitude and longitude only, so a search needs a
 * geocoder. Mock mode uses a built-in list so development touches no network at
 * all; live mode falls back to OpenStreetMap's Nominatim, which is free, needs
 * no key and does send CORS headers.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** A handful of UK places so mock mode -- and an offline live mode -- still work. */
export const BUILT_IN_PLACES = [
  { name: 'Cheltenham (Gloucestershire)', latitude: 51.9, longitude: -2.0783 },
  { name: 'London (Greater London)', latitude: 51.5072, longitude: -0.1276 },
  { name: 'Exeter (Devon)', latitude: 50.7256, longitude: -3.5269 },
  { name: 'Manchester (Greater Manchester)', latitude: 53.4808, longitude: -2.2426 },
  { name: 'Edinburgh (City of Edinburgh)', latitude: 55.9533, longitude: -3.1883 },
  { name: 'Cardiff (Cardiff)', latitude: 51.4816, longitude: -3.1791 },
  { name: 'Belfast (Belfast)', latitude: 54.5973, longitude: -5.9301 },
  { name: 'Birmingham (West Midlands)', latitude: 52.4862, longitude: -1.8904 },
  { name: 'Leeds (West Yorkshire)', latitude: 53.8008, longitude: -1.5491 },
  { name: 'Glasgow (Glasgow City)', latitude: 55.8642, longitude: -4.2518 },
  { name: 'Bristol (Bristol)', latitude: 51.4545, longitude: -2.5879 },
  { name: 'Newcastle upon Tyne (Tyne and Wear)', latitude: 54.9783, longitude: -1.6178 },
  { name: 'Norwich (Norfolk)', latitude: 52.6309, longitude: 1.2974 },
  { name: 'Aberdeen (Aberdeen City)', latitude: 57.1497, longitude: -2.0943 },
  { name: 'Plymouth (Devon)', latitude: 50.3755, longitude: -4.1427 },
  { name: 'Fort William (Highland)', latitude: 56.8198, longitude: -5.1052 },
];

/** `51.9, -2.08` and friends -- lets the geocoder be bypassed entirely. */
export function parseCoordinates(query) {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    latitude,
    longitude,
    source: 'coordinates',
  };
}

function searchBuiltIn(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return BUILT_IN_PLACES
    .filter((p) => p.name.toLowerCase().includes(q))
    .map((p) => ({ ...p, source: 'built-in' }));
}

async function searchNominatim(query, signal) {
  const url = new URL(NOMINATIM);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '8');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status})`);
  const results = await response.json();

  return results.map((r) => {
    const a = r.address ?? {};
    const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? r.name;
    const area = a.county ?? a.state_district ?? a.state ?? a.country;
    return {
      name: place && area ? `${place} (${area})` : r.display_name,
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      source: 'nominatim',
    };
  });
}

/**
 * @returns {Promise<Array>} candidate locations, best first
 */
export async function searchPlaces(query, { offline = false, signal } = {}) {
  const coordinates = parseCoordinates(query);
  if (coordinates) return [coordinates];

  const builtIn = searchBuiltIn(query);
  if (offline) return builtIn;

  try {
    const remote = await searchNominatim(query, signal);
    // Keep built-in hits at the top; they carry the Met Office-style naming.
    const seen = new Set(builtIn.map((p) => p.name));
    return [...builtIn, ...remote.filter((r) => !seen.has(r.name))];
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return builtIn;
  }
}

/** Browser geolocation, wrapped as a promise. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not offer location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        name: 'My location',
        latitude: Number(position.coords.latitude.toFixed(4)),
        longitude: Number(position.coords.longitude.toFixed(4)),
        source: 'geolocation',
      }),
      (error) => reject(new Error(error.message || 'Location access was refused.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600_000 },
    );
  });
}
