// The activity chart of a member's profile, like Iris draws it: messages per day,
// this week brighter, years split by a dashed line. Dark and blood-red, in the Squad
// style. Labels use a small built-in pixel font (digits, «.», «k»).
import { encodePng } from './png.js';

const W = 900;
const H = 300;
const X0 = 20;
const X1 = W - 72;
const Y0 = 24;
const Y1 = H - 54;

const BG = 0;
const GRID = 1;
const BAR = 2;
const HOT = 3;
const LABEL = 4;
const YEAR = 5;
const BASE = 6;
const GLOW = 7;
const PALETTE = [
  [11, 4, 5], [40, 11, 15], [150, 14, 34], [255, 45, 72],
  [196, 156, 162], [120, 32, 44], [74, 20, 27], [58, 9, 16],
];

// 5×7 glyphs, drawn twice the size.
const FONT = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
};
const SCALE = 2;
const ADVANCE = 6 * SCALE;
const TEXT_H = 7 * SCALE;

const textWidth = (s) => s.length * ADVANCE - SCALE;

function rect(px, x, y, w, h, color) {
  const xa = Math.max(0, x);
  const xb = Math.min(W, x + w);
  for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) px.fill(color, yy * W + xa, yy * W + xb);
}

function text(px, s, x, y, color) {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) if (g[r][c] === '#') rect(px, cx + c * SCALE, y + r * SCALE, SCALE, SCALE, color);
      }
    }
    cx += ADVANCE;
  }
}

// Centered on x, kept inside the picture.
function centered(px, s, x, y, color) {
  const w = textWidth(s);
  text(px, s, Math.max(2, Math.min(W - w - 2, Math.round(x - w / 2))), y, color);
}

// 1, 2, 5, 10, 20, 50… — about four lines over the tallest bar.
function niceStep(max) {
  const raw = Math.max(1, max / 4);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const short = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace('.0k', 'k') : String(n));
const dateOf = (day) => new Date(day * 86400 * 1000);
const pad = (n) => String(n).padStart(2, '0');

// counts: Map day → messages; days are Moscow days (lib/members.js mskDay).
// hotFrom: the first day drawn brighter (this week).
export function activityChart(counts, fromDay, toDay, hotFrom) {
  const px = new Uint8Array(W * H).fill(BG);
  const n = Math.max(1, toDay - fromDay + 1);
  let max = 0;
  for (const [day, v] of counts) if (day >= fromDay && day <= toDay) max = Math.max(max, v);
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const plotH = Y1 - Y0;

  for (let v = step; v <= top; v += step) {
    const y = Y1 - Math.round((v / top) * plotH);
    for (let x = X0; x < X1; x += 6) rect(px, x, y, 3, 1, GRID);
    text(px, short(v), X1 + 10, y - TEXT_H / 2, LABEL);
  }
  text(px, '0', X1 + 10, Y1 - TEXT_H / 2, LABEL);

  const slot = (X1 - X0) / n;
  const barW = slot >= 3 ? Math.max(1, Math.floor(slot * 0.72)) : Math.max(1, Math.floor(slot));
  const centerOf = (i) => X0 + i * slot + slot / 2;

  // Years split by a dashed line, the new year's number under it.
  for (let i = 1; i < n; i++) {
    const d = dateOf(fromDay + i);
    if (d.getUTCMonth() !== 0 || d.getUTCDate() !== 1) continue;
    const x = Math.round(X0 + i * slot);
    for (let y = Y0; y < Y1; y += 8) rect(px, x, y, 1, 4, YEAR);
    centered(px, String(d.getUTCFullYear()), x, Y1 + 30, LABEL);
  }

  for (let i = 0; i < n; i++) {
    const v = counts.get(fromDay + i) || 0;
    if (!v) continue;
    const h = Math.max(1, Math.round((v / top) * plotH));
    const x = Math.round(X0 + i * slot + (slot - barW) / 2);
    const hot = fromDay + i >= hotFrom;
    if (hot) rect(px, x - 2, Y1 - h - 2, barW + 4, h + 2, GLOW);
    rect(px, x, Y1 - h, barW, h, hot ? HOT : BAR);
  }
  rect(px, X0, Y1, X1 - X0, 2, BASE);

  // Dates under the bars; the first one also gets its year.
  const labels = Math.min(n, 6);
  for (let k = 0; k < labels; k++) {
    const i = labels === 1 ? n - 1 : Math.round((k * (n - 1)) / (labels - 1));
    const d = dateOf(fromDay + i);
    centered(px, `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`, centerOf(i), Y1 + 10, LABEL);
    if (k === 0) centered(px, String(d.getUTCFullYear()), centerOf(i), Y1 + 30, LABEL);
  }
  return encodePng(W, H, PALETTE, px);
}
