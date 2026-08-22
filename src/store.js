/**
 * Persistence: settings, cached responses and the API call log all live in
 * localStorage so a reload goes straight back to the forecast.
 */

const SETTINGS_KEY = 'metoffice-forecast/settings/v1';
const CACHE_KEY = 'metoffice-forecast/cache/v1';
const CALLS_KEY = 'metoffice-forecast/calls/v1';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  location: null,               // { name, latitude, longitude }
  units: { temperature: 'C', wind: 'mph', visibility: 'description' },
  dataSource: 'mock',           // 'mock' until a key is saved
  proxyUrl: '',                 // optional CORS proxy prefix
  rebaseFixtures: true,         // shift sample timestamps onto today
  cacheMinutes: 60,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private browsing or a full quota; the app still works, just without memory.
    return false;
  }
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    units: { ...DEFAULT_SETTINGS.units, ...(stored.units ?? {}) },
  };
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings);
}

export function clearAll() {
  for (const key of [SETTINGS_KEY, CACHE_KEY, CALLS_KEY]) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

// --- response cache --------------------------------------------------------

const cacheId = (dataset, location) =>
  `${dataset}@${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;

export function readCache(dataset, location, maxAgeMinutes) {
  const all = read(CACHE_KEY, {});
  const entry = all[cacheId(dataset, location)];
  if (!entry) return null;
  const ageMinutes = (Date.now() - entry.fetchedAt) / 60000;
  return { ...entry, ageMinutes, stale: ageMinutes > maxAgeMinutes };
}

export function writeCache(dataset, location, payload) {
  const all = read(CACHE_KEY, {});
  all[cacheId(dataset, location)] = { fetchedAt: Date.now(), payload };
  // Keep only the most recent handful of locations so the quota holds.
  const entries = Object.entries(all).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  write(CACHE_KEY, Object.fromEntries(entries.slice(0, 9)));
}

export function clearCache() {
  write(CACHE_KEY, {});
}

// --- call accounting -------------------------------------------------------

/**
 * A rolling log of live request timestamps, so the free tier's daily budget can
 * be shown before it runs out rather than after.
 */
export function recordCall() {
  const calls = read(CALLS_KEY, []).filter((t) => Date.now() - t < 32 * 86400_000);
  calls.push(Date.now());
  write(CALLS_KEY, calls);
}

export function callStats() {
  const calls = read(CALLS_KEY, []);
  const since = (ms) => calls.filter((t) => Date.now() - t < ms).length;
  return { today: since(86400_000), month: since(30 * 86400_000), total: calls.length };
}

export function resetCalls() {
  write(CALLS_KEY, []);
}
