# Met Office forecast display

A standalone web app that renders a Met Office **Site Specific** forecast in the
layout of the retiring Met Office weather display — the headline panel, the
seven-day strip, and the hourly parameter table.

It is a static site: plain HTML, CSS and ES modules with no build step and no
dependencies. It remembers your API key and location in the browser, so a reload
goes straight back to the latest forecast.

<!-- Replace with your own Pages URL once deployed. -->

## Contents

- [Running it locally](#running-it-locally)
- [Live data and the CORS problem](#live-data-and-the-cors-problem) — **read this before deploying**
- [Staying inside the free tier](#staying-inside-the-free-tier)
- [Publishing to GitHub Pages](#publishing-to-github-pages)
- [Sample data](#sample-data)
- [What the app shows](#what-the-app-shows)
- [Project layout](#project-layout)
- [Tests](#tests)

## Running it locally

The app uses ES modules and `fetch`, so it must be served over HTTP — opening
`index.html` from disk will not work.

```sh
npm start          # python3 -m http.server 8000
# then open http://localhost:8000
```

On first run you are asked for an API key and a location. **Leave the key blank**
to explore with the bundled sample data — that is the intended way to develop
against this app without spending API calls.

Sample data is a development aid rather than a setting, so it is not offered
anywhere in the interface. It is used when there is no API key to call with, or
when `?mock=1` is added to the URL:

```
http://localhost:8000/?mock=1
```

That works even with a key saved, so you can check a layout change without
spending a call, and a live install can never quietly end up on stale bundled
data.

## Live data and the CORS problem

This is the one thing that will bite you, so it is worth being blunt about it.

The Met Office DataHub API **does not send CORS headers**. That is a decision on
their server, and nothing in this app can change it. The practical consequence:

- Calling the API from a page served at `https://<you>.github.io/...` is blocked
  by the browser. You will get a network error, not a 403.
- The request never even reaches the Met Office, so it costs you no quota.
- This is not specific to GitHub Pages. Any browser-only deployment hits it.

The app detects this failure shape and says so explicitly rather than showing a
generic "network error".

### Working around it

You need something that is not a browser to make the request. Options, roughly
in order of effort:

1. **A small proxy you control.** A Cloudflare Worker, a Netlify or Vercel
   function, or anything else that forwards the request and adds
   `Access-Control-Allow-Origin`. Put its URL in **Settings → CORS proxy**.
   Use `{url}` where the encoded target URL should go:

   ```
   https://my-worker.example.workers.dev/?target={url}
   ```

   If you leave out `{url}`, the target URL is appended to your prefix instead,
   which is what path-style proxies expect.

   A minimal Cloudflare Worker:

   ```js
   export default {
     async fetch(request) {
       const target = new URL(request.url).searchParams.get('target');
       if (!target?.startsWith('https://data.hub.api.metoffice.gov.uk/')) {
         return new Response('Blocked', { status: 400 });
       }
       const upstream = await fetch(target, {
         headers: { apikey: request.headers.get('apikey') ?? '', accept: 'application/json' },
       });
       const response = new Response(upstream.body, upstream);
       response.headers.set('Access-Control-Allow-Origin', '*');
       response.headers.set('Access-Control-Allow-Headers', 'apikey, accept');
       return response;
     },
   };
   ```

   Note that your API key passes through the proxy. Keep the proxy private to
   you, and restrict it to the DataHub host as above.

2. **A public CORS proxy.** Quick to try, but you are handing your API key to a
   third party. Fine for a five-minute experiment, not for anything you leave
   running.

3. **Fetch on a schedule instead.** Have a GitHub Action call the API every hour
   with the key held as a repository secret, commit the three JSON responses
   into the repo, and point the app at those files. The key never reaches the
   browser at all, and your call count becomes exactly predictable. This is the
   most robust option for a public Pages deployment, and the app's fixture
   loading already reads JSON from a path — see `FIXTURES` in
   [`src/api.js`](src/api.js).

Whichever route you take, remember that a key stored in the browser is visible to
anyone using that browser, and a key sent through a proxy is visible to whoever
runs the proxy.

## Staying inside the free tier

The free Site Specific tier has a capped call budget, so the app is built to be
frugal:

- **Responses are cached** in `localStorage`, for one hour by default
  (Settings → Cache responses for). A page load inside that window makes no
  request at all.
- **Calls are counted.** The status line under the forecast shows how many live
  calls you have made today and over the last 30 days.
- **Refresh is explicit.** Only the Refresh button bypasses the cache.
- **Failures fall back to cache.** If a refresh fails, the last good response is
  shown with a warning rather than an empty screen.

One refresh costs three calls — hourly, three-hourly and daily.

## Publishing to GitHub Pages

[`.github/workflows/main.yml`](.github/workflows/main.yml) runs the tests and
deploys on every push to `main`, and can be run by hand from the Actions tab.

In the repository, go to **Settings → Pages** and set **Source** to
**GitHub Actions**. All paths in the app are relative, so it works from a project
subpath (`https://<you>.github.io/<repo>/`) without configuration.

## Sample data

`fixtures/hourly.json` is a real Site Specific hourly response. The three-hourly
and daily fixtures are generated from it by
[`tools/make-fixtures.mjs`](tools/make-fixtures.mjs), which aggregates the hourly
series the way the real endpoints do and extends it to a full week with a seeded
walk. Regenerate them with:

```sh
npm run fixtures
```

The generator is deterministic, so the output only changes when the generator
does. CI checks that the committed fixtures match.

Sample timestamps are **shifted onto today** so the display looks like a live
forecast during development. The status line says when this is happening.

Everything beyond the original sample's two-day range is synthetic. It is
plausible, not real weather.

## What the app shows

The day strip carries every day in the forecast. Whichever day the hourly table
is showing expands into a card with its temperatures, sunrise and sunset, written
outlook and UV index, while the rest collapse to tiles. Selecting a tile scrolls
the table to that day, and scrolling the table moves the expansion to follow —
including back to today.

The hourly table carries the same nine rows as the original display: weather
symbol, chance of precipitation, temperature, feels-like temperature, wind
direction and speed, wind gust, visibility, humidity and UV. Temperature and
feels-like values are drawn as colour-banded bars whose height varies with the
value, so the row reads as a chart as well as a set of numbers. Both rows share
one scale spanning the whole forecast, which keeps bars comparable while
scrolling between days; heights follow the Celsius value, so switching to °F
relabels without reshaping. Units are switchable per row and remembered, and
each row has an information button explaining the parameter.

Hourly detail runs for about two days and then continues at three-hourly steps
out to seven days, with each day shown as its own panel in one continuous
horizontal scroll. Clicking a day in the strip scrolls to it.

A few things in the original layout are **not** available from this API, and the
app is explicit about each rather than inventing them:

- **Pollution and pollen** are published separately by DEFRA and are not part of
  the Site Specific API, so they are omitted rather than shown empty.
- **Sunrise and sunset** are not in the API. They are computed locally from the
  NOAA solar equations, accurate to within a few minutes.
- **The written outlook** ("Sunny intervals changing to cloudy by lunchtime") is
  authored separately for the Met Office site. Here it is derived from the run of
  significant weather codes through the day — see
  [`src/summary.js`](src/summary.js).

Times are shown in the browser's local timezone. For a UK user that is UK time,
which is what the original display shows.

## Project layout

```
index.html              markup and the first-run setup form
styles/app.css          all styling
src/app.js              controller: settings, loading, events
src/api.js              DataHub requests, caching, call accounting, mock source
src/normalise.js        GeoJSON to the internal model, dataset merging, rebasing
src/render.js           hero, day strip and hourly table markup
src/weather-codes.js    significant weather codes 0-30
src/icons.js            weather symbols, drawn as inline SVG
src/units.js            conversions, visibility bands, temperature colour scale
src/solar.js            sunrise and sunset
src/summary.js          the written outlook sentence
src/geocode.js          place search and coordinate parsing
src/store.js            localStorage: settings, cache, call log
fixtures/               sample API responses for development
tools/make-fixtures.mjs regenerates the derived fixtures
test/                   unit tests for the pure logic
```

Place search uses OpenStreetMap's Nominatim, which is free and needs no key. In
sample-data mode it is skipped entirely in favour of a built-in list of UK towns,
so development touches no network at all. You can always type coordinates
directly (`51.9, -2.08`).

## Tests

```sh
npm test
```

Covers unit conversion, the visibility and UV bands, the temperature colour
scale, the solar model (checked against published sunrise and sunset times), the
weather code table, dataset merging and rebasing, and the summary generator.

## Data

Forecast data from the [Met Office Weather DataHub](https://datahub.metoffice.gov.uk/).
Use of the API is subject to Met Office terms and licensing.
