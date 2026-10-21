// A tiny PNG encoder for Финя's pictures: 8-bit palette images, no compression
// (stored deflate blocks). The runtime has no canvas and no zlib, and a few hundred
// kilobytes is nothing for a Telegram photo.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 5552) {
    const end = Math.min(i + 5552, bytes.length);
    for (let j = i; j < end; j++) {
      a += bytes[j];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (out, at, v) => {
  out[at] = v >>> 24;
  out[at + 1] = (v >>> 16) & 0xff;
  out[at + 2] = (v >>> 8) & 0xff;
  out[at + 3] = v & 0xff;
};

// zlib stream of stored blocks (at most 65535 bytes each).
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const from = i * 65535;
    const len = Math.min(65535, raw.length - from);
    out[at] = i === blocks - 1 ? 1 : 0;
    out[at + 1] = len & 0xff;
    out[at + 2] = len >>> 8;
    out[at + 3] = ~len & 0xff;
    out[at + 4] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(from, from + len), at + 5);
    at += 5 + len;
  }
  u32(out, at, adler32(raw));
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  u32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  u32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

// pixels: one palette index per pixel, row by row. palette: [[r, g, b], …], up to 256.
export function encodePng(width, height, palette, pixels) {
  const ihdr = new Uint8Array(13);
  u32(ihdr, 0, width);
  u32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // palette colors
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach(([r, g, b], i) => plte.set([r, g, b], i * 3));
  // Every row starts with filter type 0.
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
