// Small helpers shared by every module. No platform imports here.

export const MSK_OFFSET = 3 * 3600;

export function now() {
  return Date.now() / 1000;
}

export function nowInt() {
  return Math.floor(Date.now() / 1000);
}

// Python html.escape(quote=True) parity.
export function escapeHtml(value, quote = true) {
  let s = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (quote) s = s.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  return s;
}

export function boldHtml(text) {
  const value = String(text).replace(/<b>/g, '').replace(/<\/b>/g, '');
  return `<b>${value}</b>`;
}

export function fullName(user) {
  if (!user) return '';
  return user.last_name ? `${user.first_name} ${user.last_name}` : String(user.first_name ?? '');
}

// Start of the Moscow day (unix seconds) containing `ts`.
export function dayStart(ts) {
  const local = Math.floor((Math.floor(ts) + MSK_OFFSET) / 86400);
  return local * 86400 - MSK_OFFSET;
}

// Monday 00:00 MSK of the week containing `ts`.
export function weekStart(ts) {
  const local = Math.floor((Math.floor(ts) + MSK_OFFSET) / 86400);
  const weekday = (local + 3) % 7; // 1970-01-01 was a Thursday (Monday = 0)
  return (local - weekday) * 86400 - MSK_OFFSET;
}

const pad = (n) => String(n).padStart(2, '0');

// "%d.%m.%Y %H:%M" in Moscow time.
export function fmtMsk(ts) {
  const d = new Date((Math.floor(ts) + MSK_OFFSET) * 1000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Python "{:,}".
export function fmtThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Python "{:+d}".
export function fmtSigned(n) {
  return n >= 0 ? `+${n}` : String(n);
}

export function fmtUptime(seconds) {
  seconds = Math.floor(Math.max(0, seconds));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const parts = [];
  if (days) parts.push(`${days}д`);
  if (hours || days) parts.push(`${hours}ч`);
  if (minutes || hours || days) parts.push(`${minutes}м`);
  parts.push(`${seconds}с`);
  return parts.join(' ');
}

// setTimeout may be missing in the isolate; then waiting is skipped.
export function sleep(ms) {
  if (typeof setTimeout !== 'function' || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomHex(bytes = 6) {
  const out = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < bytes; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isAlnumChar(ch) {
  return /[\p{L}\p{N}]/u.test(ch);
}

export function countAlnum(text) {
  let n = 0;
  for (const ch of text) if (isAlnumChar(ch)) n++;
  return n;
}

export function truncate(value, n) {
  return Array.from(String(value ?? '')).slice(0, n).join('');
}

export function base64ToBytes(b64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out;
}

