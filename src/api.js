/**
 * Access to the Met Office Weather DataHub Site Specific API, plus the mock
 * source that stands in for it during development.
 *
 * The free tier has a hard monthly call budget, so every live response is
 * cached and every request is counted.
 */
import { readCache, writeCache, recordCall } from './store.js';

const BASE = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point';

export const DATASETS = ['hourly', 'three-hourly', 'daily'];

const FIXTURES = {
  hourly: './fixtures/hourly.json',
  'three-hourly': './fixtures/three-hourly.json',
  daily: './fixtures/daily.json',
};

export class ApiError extends Error {
  constructor(message, { kind, status, dataset, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.kind = kind;      // 'cors' | 'auth' | 'quota' | 'http' | 'network' | 'parse'
    this.status = status;
    this.dataset = dataset;
  }
}

function buildUrl(dataset, location, proxyUrl) {
  const url = new URL(`${BASE}/${dataset}`);
  url.searchParams.set('latitude', location.latitude.toFixed(4));
  url.searchParams.set('longitude', location.longitude.toFixed(4));
  url.searchParams.set('excludeParameterMetadata', 'true');
  url.searchParams.set('includeLocationName', 'true');
  if (!proxyUrl) return url.toString();
  // Proxies come in two shapes: ones that take the target as a trailing path
  // and ones that take it as a query value. `{url}` opts into the latter.
  return proxyUrl.includes('{url}')
    ? proxyUrl.replace('{url}', encodeURIComponent(url.toString()))
    : proxyUrl.replace(/\/?$/, '') + '/' + url.toString();
}

async function fetchLive(dataset, location, settings) {
  const url = buildUrl(dataset, location, settings.proxyUrl);
  let response;
  try {
    response = await fetch(url, {
      headers: { apikey: settings.apiKey, accept: 'application/json' },
    });
  } catch (cause) {
    // A blocked cross-origin request surfaces as an opaque TypeError, which is
    // by far the most likely failure for a browser-only app against DataHub.
    throw new ApiError(
      'The browser could not reach the Met Office API. This is almost always CORS: '
      + 'DataHub does not send cross-origin headers, so a page served from GitHub Pages '
      + 'is blocked from calling it directly. Set a proxy URL in Settings.',
      { kind: 'cors', dataset, cause },
    );
  }

  recordCall();

  if (response.status === 401 || response.status === 403) {
    throw new ApiError('The API key was rejected (HTTP ' + response.status + '). Check it in Settings.',
      { kind: 'auth', status: response.status, dataset });
  }
  if (response.status === 429) {
    throw new ApiError('Rate limit or call quota reached (HTTP 429). Try again later.',
      { kind: 'quota', status: response.status, dataset });
  }
  if (!response.ok) {
    throw new ApiError(`The ${dataset} request failed with HTTP ${response.status}.`,
      { kind: 'http', status: response.status, dataset });
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError(`The ${dataset} response was not valid JSON.`, { kind: 'parse', dataset });
  }
}

async function fetchFixture(dataset) {
  const response = await fetch(FIXTURES[dataset], { cache: 'no-cache' });
  if (!response.ok) {
    throw new ApiError(`Could not load the ${dataset} fixture (HTTP ${response.status}). `
      + 'Fixtures need the app to be served over http -- opening index.html from disk will not work.',
      { kind: 'network', status: response.status, dataset });
  }
  return response.json();
}

/**
 * Fetches one dataset, preferring a fresh cache entry.
 *
 * On a live failure a stale cache entry is returned rather than nothing, so a
 * spent quota or a dropped connection still leaves something on screen.
 */
export async function fetchDataset(dataset, location, settings, { force = false } = {}) {
  if (settings.dataSource === 'mock') {
    return { payload: await fetchFixture(dataset), source: 'mock', fetchedAt: Date.now() };
  }

  const cached = readCache(dataset, location, settings.cacheMinutes);
  if (cached && !cached.stale && !force) {
    return { payload: cached.payload, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  try {
    const payload = await fetchLive(dataset, location, settings);
    writeCache(dataset, location, payload);
    return { payload, source: 'live', fetchedAt: Date.now() };
  } catch (error) {
    if (cached) {
      return { payload: cached.payload, source: 'stale-cache', fetchedAt: cached.fetchedAt, error };
    }
    throw error;
  }
}

/** Fetches all three datasets, tolerating partial failure. */
export async function fetchForecast(location, settings, options) {
  const results = await Promise.allSettled(
    DATASETS.map((d) => fetchDataset(d, location, settings, options)),
  );
  const out = { datasets: {}, errors: [], sources: {}, fetchedAt: null };
  results.forEach((result, i) => {
    const dataset = DATASETS[i];
    if (result.status === 'fulfilled') {
      out.datasets[dataset] = result.value.payload;
      out.sources[dataset] = result.value.source;
      out.fetchedAt = Math.max(out.fetchedAt ?? 0, result.value.fetchedAt);
      if (result.value.error) out.errors.push(result.value.error);
    } else {
      out.errors.push(result.reason);
    }
  });
  if (!Object.keys(out.datasets).length) {
    throw out.errors[0] ?? new ApiError('No forecast data could be loaded.', { kind: 'network' });
  }
  return out;
}
