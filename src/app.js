/**
 * Application shell: settings, loading, and everything the user can click.
 */
import { loadSettings, saveSettings, clearAll, clearCache, callStats } from './store.js';
import { fetchForecast, ApiError } from './api.js';
import { buildForecast } from './normalise.js';
import { renderHero, renderDayStrip, renderHourlyTable, INFO, esc, fmtFull, startOfDay } from './render.js';
import { formatDistance } from './units.js';
import { searchPlaces, currentPosition, parseCoordinates } from './geocode.js';

const $ = (id) => document.getElementById(id);

const el = {
  main: $('forecast'),
  hero: $('hero'),
  heroScroll: $('hero-scroll'),
  dayStrip: $('day-strip'),
  viewport: $('hourly-viewport'),
  prev: $('scroll-prev'),
  next: $('scroll-next'),
  status: $('status'),
  setup: $('setup'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  errorPanel: $('error-panel'),
  errorTitle: $('error-title'),
  errorBody: $('error-body'),
  searchForm: $('search-form'),
  searchInput: $('search-input'),
  suggestions: $('suggestions'),
  dialog: $('settings-dialog'),
  popover: $('info-popover'),
  toast: $('toast'),
};

let settings = loadSettings();
let forecast = null;
let pendingLocation = null;
let searchAbort = null;
let toastTimer = null;

// ---------------------------------------------------------------------------
// Chrome helpers
// ---------------------------------------------------------------------------

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
}

function showOnly(section) {
  el.main.hidden = section !== 'forecast';
  el.setup.hidden = section !== 'setup';
  el.loading.hidden = section !== 'loading';
  el.errorPanel.hidden = section !== 'error';
}

function showError(error) {
  el.errorTitle.textContent = error?.kind === 'cors'
    ? 'The browser could not reach the Met Office API'
    : 'Could not load the forecast';
  el.errorBody.textContent = error?.message ?? String(error);
  showOnly('error');
}

// ---------------------------------------------------------------------------
// Loading and rendering
// ---------------------------------------------------------------------------

async function load({ force = false } = {}) {
  if (!settings.location) { showSetup(); return; }

  el.loadingText.textContent = settings.dataSource === 'mock'
    ? 'Loading sample forecast…'
    : `Loading forecast for ${settings.location.name}…`;
  showOnly('loading');

  try {
    const raw = await fetchForecast(settings.location, settings, { force });
    forecast = buildForecast(raw, {
      rebase: settings.dataSource === 'mock' && settings.rebaseFixtures,
    });
    // The API snaps to its nearest grid point; the saved name is the better label.
    forecast.locationName = settings.location.name;
    forecast.latitude ??= settings.location.latitude;
    forecast.longitude ??= settings.location.longitude;
    render();
    showOnly('forecast');
    if (raw.errors.length) {
      toast(`Showing cached data — ${raw.errors[0].message}`);
    }
  } catch (error) {
    console.error(error);
    showError(error);
  }
}

function render() {
  const now = new Date();
  el.hero.innerHTML = renderHero(forecast, settings, now);
  el.dayStrip.innerHTML = renderDayStrip(forecast, settings, now);
  el.viewport.innerHTML = renderHourlyTable(forecast, settings, now);
  renderStatus();
  updateScrollButtons();
  // Open on the current hour rather than the start of the model run.
  scrollToDay(startOfDay(now), { behaviour: 'auto' });
}

function renderStatus() {
  const stats = callStats();
  const sources = new Set(Object.values(forecast.sources ?? {}));
  const live = sources.has('live');
  const mock = sources.has('mock');
  const stale = sources.has('stale-cache');

  const pill = mock
    ? '<span class="pill pill--mock">Sample data</span>'
    : stale
      ? '<span class="pill pill--warn">Cached (refresh failed)</span>'
      : live
        ? '<span class="pill pill--live">Live</span>'
        : '<span class="pill">Cached</span>';

  const bits = [pill];
  if (forecast.rebased) {
    bits.push('<span>Sample dates shifted onto today</span>');
  }
  if (forecast.modelRunDate) {
    bits.push(`<span>Model run ${esc(forecast.modelRunDate.toLocaleString('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    }))}</span>`);
  }
  if (forecast.fetchedAt && !mock) {
    bits.push(`<span>Fetched ${esc(forecast.fetchedAt.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
    }))}</span>`);
  }
  if (settings.dataSource === 'live') {
    bits.push(`<span>${stats.today} calls today · ${stats.month} this month</span>`);
  }
  bits.push('<button type="button" id="refresh-btn">Refresh</button>');
  if (typeof forecast.distanceFromRequest === 'number') {
    bits.push('<span title="The forecast is produced on a grid, not for your exact '
      + 'coordinates. This is how far the nearest grid point is — a few hundred metres '
      + 'is normal.">'
      + `Grid point ${esc(formatDistance(forecast.distanceFromRequest))} away</span>`);
  }

  el.status.innerHTML = bits.join('');
  $('refresh-btn')?.addEventListener('click', () => load({ force: true }));
}

// ---------------------------------------------------------------------------
// Hourly table scrolling
// ---------------------------------------------------------------------------

function scrollToDay(date, { behaviour = 'smooth' } = {}) {
  const head = el.viewport.querySelector(`#day-${startOfDay(date).getTime()}`);
  if (!head) return;
  const table = el.viewport.querySelector('.hourly-table');
  if (!table) return;
  const left = head.getBoundingClientRect().left - table.getBoundingClientRect().left;
  el.viewport.scrollTo({ left, behavior: behaviour });
  el.dayStrip.querySelectorAll('.day-tile').forEach((tile) => {
    tile.classList.toggle('is-active',
      startOfDay(new Date(tile.dataset.date)).getTime() === startOfDay(date).getTime());
  });
  requestAnimationFrame(updateScrollButtons);
}

function updateScrollButtons() {
  const { scrollLeft, scrollWidth, clientWidth } = el.viewport;
  el.prev.hidden = scrollLeft <= 4;
  el.next.hidden = scrollLeft >= scrollWidth - clientWidth - 4;
}

function nudge(direction) {
  // Move by whole columns so the table never rests mid-hour.
  const step = Math.max(1, Math.floor(el.viewport.clientWidth / 76) - 1) * 76;
  el.viewport.scrollBy({ left: direction * step, behavior: 'smooth' });
}

el.prev.addEventListener('click', () => nudge(-1));
el.next.addEventListener('click', () => nudge(1));
el.viewport.addEventListener('scroll', updateScrollButtons, { passive: true });
window.addEventListener('resize', updateScrollButtons);

el.dayStrip.addEventListener('click', (event) => {
  const tile = event.target.closest('.day-tile');
  if (tile) scrollToDay(new Date(tile.dataset.date));
});

// ---------------------------------------------------------------------------
// Unit selectors and info popovers
// ---------------------------------------------------------------------------

el.viewport.addEventListener('change', (event) => {
  const select = event.target.closest('.unit-select');
  if (!select) return;
  const left = el.viewport.scrollLeft;
  settings.units[select.dataset.unit] = select.value;
  saveSettings(settings);
  render();
  el.viewport.scrollLeft = left;   // re-rendering resets scroll; put it back
});

function closePopover() {
  el.popover.hidden = true;
  el.popover.dataset.for = '';
}

el.viewport.addEventListener('click', (event) => {
  const button = event.target.closest('.info');
  if (!button) { closePopover(); return; }
  const key = button.dataset.info;
  if (el.popover.dataset.for === key && !el.popover.hidden) { closePopover(); return; }

  el.popover.textContent = INFO[key] ?? '';
  el.popover.dataset.for = key;
  el.popover.hidden = false;

  const rect = button.getBoundingClientRect();
  const width = el.popover.offsetWidth;
  const left = Math.min(
    Math.max(8, rect.left + window.scrollX - width / 2 + rect.width / 2),
    document.documentElement.clientWidth - width - 8,
  );
  el.popover.style.left = `${left}px`;
  el.popover.style.top = `${rect.bottom + window.scrollY + 8}px`;
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.info') && !event.target.closest('.popover')) closePopover();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closePopover(); hideSuggestions(); }
});

// ---------------------------------------------------------------------------
// Location search
// ---------------------------------------------------------------------------

function hideSuggestions() {
  el.suggestions.hidden = true;
  el.suggestions.innerHTML = '';
  el.searchInput.setAttribute('aria-expanded', 'false');
}

function showSuggestions(places) {
  if (!places.length) {
    el.suggestions.innerHTML =
      '<li class="suggestions__empty">No matching places. Try a postcode, or type a latitude and longitude.</li>';
  } else {
    el.suggestions.innerHTML = places.map((p, i) => `
      <li role="option" id="suggestion-${i}">
        <button type="button" data-index="${i}">
          ${esc(p.name)}
          ${p.source === 'coordinates' ? ''
        : `<span class="suggestions__meta">${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</span>`}
        </button>
      </li>`).join('');
  }
  el.suggestions.hidden = false;
  el.searchInput.setAttribute('aria-expanded', 'true');
  el.suggestions._places = places;
}

async function runSearch(query) {
  if (!query.trim()) return;
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const places = await searchPlaces(query, {
      offline: settings.dataSource === 'mock',
      signal: searchAbort.signal,
    });
    showSuggestions(places);
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message);
  }
}

el.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(el.searchInput.value);
});

el.suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;
  const place = el.suggestions._places[Number(button.dataset.index)];
  hideSuggestions();
  el.searchInput.value = '';
  settings.location = { name: place.name, latitude: place.latitude, longitude: place.longitude };
  saveSettings(settings);
  load();
});

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------

function showSetup() {
  showOnly('setup');
  $('setup-key').value = settings.apiKey ?? '';
  $('setup-place').value = settings.location?.name ?? '';
  pendingLocation = settings.location;
  $('setup-save').disabled = !pendingLocation;
}

async function setupFind() {
  const query = $('setup-place').value;
  const error = $('setup-error');
  error.hidden = true;
  if (!query.trim()) { $('setup-place-hint').textContent = 'Type a place name first.'; return; }

  const direct = parseCoordinates(query);
  const offline = !$('setup-key').value.trim();
  try {
    const places = direct ? [direct] : await searchPlaces(query, { offline });
    const list = $('setup-results');
    if (!places.length) {
      list.hidden = true;
      $('setup-place-hint').textContent = offline
        ? 'No match in the built-in list. Add an API key to search all places, or type a latitude and longitude.'
        : 'No match. Try a postcode, or type a latitude and longitude.';
      return;
    }
    list.innerHTML = places.map((p, i) => `
      <li><button type="button" data-index="${i}">${esc(p.name)}
        <span class="meta">${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</span>
      </button></li>`).join('');
    list._places = places;
    list.hidden = false;
    $('setup-place-hint').textContent = 'Choose a location.';
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
}

$('setup-find').addEventListener('click', setupFind);
$('setup-place').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); setupFind(); }
});

$('setup-results').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;
  const list = $('setup-results');
  pendingLocation = list._places[Number(button.dataset.index)];
  list.querySelectorAll('button').forEach((b) => b.classList.remove('is-chosen'));
  button.classList.add('is-chosen');
  $('setup-save').disabled = false;
});

$('setup-locate').addEventListener('click', async () => {
  const error = $('setup-error');
  error.hidden = true;
  try {
    pendingLocation = await currentPosition();
    $('setup-place').value = `${pendingLocation.latitude}, ${pendingLocation.longitude}`;
    $('setup-place-hint').textContent = 'Using your current position.';
    $('setup-save').disabled = false;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});

$('setup-save').addEventListener('click', () => {
  if (!pendingLocation) return;
  const key = $('setup-key').value.trim();
  settings = {
    ...settings,
    apiKey: key,
    dataSource: key ? 'live' : 'mock',
    location: {
      name: pendingLocation.name,
      latitude: pendingLocation.latitude,
      longitude: pendingLocation.longitude,
    },
  };
  saveSettings(settings);
  load();
});

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

function openSettings() {
  $('set-key').value = settings.apiKey ?? '';
  $('set-live').checked = settings.dataSource === 'live';
  $('set-mock').checked = settings.dataSource !== 'live';
  $('set-rebase').checked = Boolean(settings.rebaseFixtures);
  $('set-proxy').value = settings.proxyUrl ?? '';
  $('set-cache').value = String(settings.cacheMinutes ?? 60);
  const stats = callStats();
  $('set-stats').textContent =
    `${stats.today} live calls today · ${stats.month} in the last 30 days · ${stats.total} recorded.`;
  el.dialog.showModal();
}

$('settings-btn').addEventListener('click', openSettings);

$('set-save').addEventListener('click', () => {
  const key = $('set-key').value.trim();
  const wantsLive = $('set-live').checked;
  if (wantsLive && !key) {
    toast('Add an API key to use the live API.');
    return;
  }
  settings = {
    ...settings,
    apiKey: key,
    dataSource: wantsLive ? 'live' : 'mock',
    rebaseFixtures: $('set-rebase').checked,
    proxyUrl: $('set-proxy').value.trim(),
    cacheMinutes: Number($('set-cache').value) || 60,
  };
  saveSettings(settings);
  el.dialog.close();
  load();
});

$('set-clear').addEventListener('click', () => {
  clearAll();
  settings = loadSettings();
  forecast = null;
  el.dialog.close();
  showSetup();
  toast('Stored key, location and cache removed.');
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

$('error-retry').addEventListener('click', () => load({ force: true }));
$('error-settings').addEventListener('click', openSettings);
$('error-mock').addEventListener('click', () => {
  settings = { ...settings, dataSource: 'mock' };
  saveSettings(settings);
  clearCache();
  load();
});

// ---------------------------------------------------------------------------

if (!settings.location) showSetup();
else load();

// Re-render across midnight so "Today" keeps meaning today.
let renderedDay = new Date().toDateString();
setInterval(() => {
  const today = new Date().toDateString();
  if (forecast && today !== renderedDay) {
    renderedDay = today;
    render();
  }
}, 60_000);
