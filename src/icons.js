/**
 * Weather symbols, drawn to echo the Met Office set: a thin dark outline, a
 * white cloud body, an amber sun and blue precipitation.
 *
 * Cloud silhouettes are generated from the union of overlapping circles sitting
 * on a flat base, so the outline is geometrically exact at any size instead of
 * hand-fitted curves that drift when the shape is retuned.
 */

const INK = '#4a4a4a';
const CLOUD = '#ffffff';
const CLOUD_DARK = '#d5d9dd';
const SUN = '#f6a01f';
const MOON = '#3f4a5a';
const RAIN = '#1e88c7';
const SNOW = '#7fb3e0';
const BOLT = '#f6a01f';
const STROKE = 1.5;

/** Upper intersection of two circles, in SVG coordinates (y grows downward). */
function upperIntersection(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  const t = (d * d - b.r * b.r + a.r * a.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - t * t));
  const mx = a.cx + (t * dx) / d;
  const my = a.cy + (t * dy) / d;
  // Two solutions; take the one with the smaller y (higher on screen).
  const p1 = { x: mx + (h * dy) / d, y: my - (h * dx) / d };
  const p2 = { x: mx - (h * dy) / d, y: my + (h * dx) / d };
  return p1.y <= p2.y ? p1 : p2;
}

/** Where a circle crosses the flat base line, on the given side. */
function baseCrossing(c, baseY, side) {
  const half = Math.sqrt(Math.max(0, c.r * c.r - (baseY - c.cy) ** 2));
  return { x: c.cx + (side === 'left' ? -half : half), y: baseY };
}

function cloudPath(circles, baseY) {
  const start = baseCrossing(circles[0], baseY, 'left');
  let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const end = i === circles.length - 1
      ? baseCrossing(c, baseY, 'right')
      : upperIntersection(c, circles[i + 1]);
    // sweep-flag 1 traces clockwise, i.e. over the top of the bump.
    d += ` A ${c.r} ${c.r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }
  return `${d} Z`;
}

// A single cloud, filling most of the 48x40 drawing area.
const BIG_CLOUD = cloudPath([
  { cx: 15, cy: 22, r: 9 },
  { cx: 25, cy: 19, r: 12 },
  { cx: 35, cy: 24, r: 7.5 },
], 30.5);

// A slightly smaller, lower cloud, leaving room for a sun or moon behind it.
const SMALL_CLOUD = cloudPath([
  { cx: 17, cy: 24, r: 8 },
  { cx: 26.5, cy: 21.5, r: 10.5 },
  { cx: 35.5, cy: 25.5, r: 6.5 },
], 31);

const cloud = (d, fill = CLOUD) =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;

function sun(cx, cy, r, rays = true) {
  let out = '';
  if (rays) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x1 = cx + Math.cos(a) * (r + 2.2);
      const y1 = cy + Math.sin(a) * (r + 2.2);
      const x2 = cx + Math.cos(a) * (r + 5.4);
      const y2 = cy + Math.sin(a) * (r + 5.4);
      out += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${SUN}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  }
  return `${out}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;
}

/** Crescent moon: a disc with a second disc punched out of its upper right. */
function moon(cx, cy, r) {
  const id = `m${Math.round(cx * 10)}${Math.round(cy * 10)}${Math.round(r * 10)}`;
  return `<mask id="${id}">
      <rect x="0" y="0" width="48" height="40" fill="#fff"/>
      <circle cx="${cx + r * 0.62}" cy="${cy - r * 0.55}" r="${r * 0.92}" fill="#000"/>
    </mask>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${MOON}" mask="url(#${id})"/>`;
}

const drop = (x, y, scale = 1, colour = RAIN) =>
  `<path d="M ${x} ${y} c ${2.1 * scale} ${3 * scale} ${2.1 * scale} ${4.4 * scale} 0 ${5.6 * scale} c ${-2.1 * scale} ${-1.2 * scale} ${-2.1 * scale} ${-2.6 * scale} 0 ${-5.6 * scale} Z" fill="${colour}"/>`;

const flake = (x, y, r = 2.6, colour = SNOW) => {
  let out = '';
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    out += `<line x1="${(x - Math.cos(a) * r).toFixed(2)}" y1="${(y - Math.sin(a) * r).toFixed(2)}" x2="${(x + Math.cos(a) * r).toFixed(2)}" y2="${(y + Math.sin(a) * r).toFixed(2)}" stroke="${colour}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  return out;
};

const pellet = (x, y, r = 1.9) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${CLOUD}" stroke="${INK}" stroke-width="1.1"/>`;

const bolt = (x, y) =>
  `<path d="M ${x} ${y} l 4.6 0 l -2.6 4 l 3.6 0 l -7 7.6 l 2 -5.4 l -3.4 0 Z" fill="${BOLT}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`;

const hazeLines = (colour) => [34, 38].map((y, i) =>
  `<line x1="${11 + i * 3}" y1="${y}" x2="${37 - i * 3}" y2="${y}" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>`).join('');

// Precipitation laid out under a cloud, evenly spaced.
const under = (fn, count, y) => {
  const xs = count === 1 ? [24] : count === 2 ? [19, 29] : [16, 24, 32];
  return xs.map((x, i) => fn(x, y + (i % 2 === 1 ? 1.6 : 0))).join('');
};

const ICONS = {
  sunny: () => sun(24, 20, 8.5),
  'clear-night': () => moon(24, 20, 10),
  'partly-cloudy-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD),
  'partly-cloudy-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD),
  cloudy: () => cloud(BIG_CLOUD),
  overcast: () => cloud(BIG_CLOUD, CLOUD_DARK),
  mist: () => cloud(SMALL_CLOUD) + hazeLines('#9aa3ab'),
  fog: () => cloud(SMALL_CLOUD, CLOUD_DARK) + hazeLines('#7c858d'),

  drizzle: () => cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.62), 3, 33),
  'light-rain': () => cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.85), 2, 33),
  'heavy-rain': () => cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 1), 3, 33),
  'light-shower-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.85), 1, 33),
  'light-shower-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.85), 1, 33),
  'heavy-shower-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.95), 3, 33),
  'heavy-shower-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + under((x, y) => drop(x, y, 0.95), 3, 33),

  sleet: () => cloud(SMALL_CLOUD) + drop(20, 33, 0.9) + flake(30, 35.5),
  'sleet-shower-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + drop(20, 33, 0.9) + flake(30, 35.5),
  'sleet-shower-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + drop(20, 33, 0.9) + flake(30, 35.5),

  hail: () => cloud(SMALL_CLOUD) + under((x, y) => pellet(x, y + 2), 3, 33),
  'hail-shower-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + under((x, y) => pellet(x, y + 2), 2, 33),
  'hail-shower-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + under((x, y) => pellet(x, y + 2), 2, 33),

  'light-snow': () => cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5), 2, 33),
  'light-snow-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5), 1, 33),
  'light-snow-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5), 1, 33),
  'heavy-snow': () => cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5, 3), 3, 33),
  'heavy-snow-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5, 3), 3, 33),
  'heavy-snow-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + under((x, y) => flake(x, y + 2.5, 3), 3, 33),

  thunder: () => cloud(SMALL_CLOUD) + bolt(21, 31),
  'thunder-shower-day': () => sun(16, 13, 8, false) + cloud(SMALL_CLOUD) + bolt(21, 31),
  'thunder-shower-night': () => moon(17, 12.5, 8) + cloud(SMALL_CLOUD) + bolt(21, 31),

  unknown: () => `<text x="24" y="27" text-anchor="middle" font-size="18" fill="#9aa3ab">?</text>`,
};

/**
 * Returns an inline <svg> for the named symbol. The title is what screen
 * readers announce, so callers pass the human-readable weather description.
 */
export function weatherIcon(name, title, size = 40) {
  const draw = ICONS[name] ?? ICONS.unknown;
  return `<svg class="wx-icon" viewBox="0 0 48 40" width="${size}" height="${(size * 40) / 48}" role="img" aria-label="${escapeAttr(title)}">`
    + `<title>${escapeAttr(title)}</title>${draw()}</svg>`;
}

export const ICON_NAMES = Object.keys(ICONS);

function escapeAttr(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
