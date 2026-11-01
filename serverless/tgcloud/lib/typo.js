// «Может, ты имел в виду …?»: the command closest to a mistyped one.

// Edits between two strings: insert, delete, replace, swap two neighbours.
export function distance(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

// How many typos a command of this length forgives: none for short ones like «фарм».
const allowed = (key) => (key.length <= 4 ? 0 : key.length <= 8 ? 1 : 2);

// «кто мы» is not a typo of «кто ты»: short words of the command must be exact.
function shortWordsMatch(query, key) {
  const q = query.split(' ');
  const k = key.split(' ');
  if (q.length !== k.length) return true;
  return k.every((w, i) => Array.from(w.replace(/^[+-]/, '')).length > 2 || w === q[i]);
}

// A plain chat message (no «Финя,») is held to more: one typo, in a longer command
// that is not an everyday word, and not just another ending («передал» is a word,
// not «Передать» mistyped).
const EVERYDAY = new Set(['спасибо', 'помощь', 'вопрос', 'выбери', 'сравни', 'статья', 'казино', 'кубики', 'возраст']);
const strictOk = (key) => !EVERYDAY.has(key) && (key.includes(' ') || /^[+-]/.test(key) || key.length >= 7);
// Another ending: the words part right at the end («семью»/«семья», «передал»/«передать»).
const endsDiffer = (a, b) => a.at(-1) !== b.at(-1);

export function closest(query, keys, { strict = false } = {}) {
  const q = query.trim().replace(/^([+-])\s+/u, '$1');
  // An exact command that just did nothing here (a chat-only one in private) is no typo.
  if (!q || q.length > 30 || keys.includes(q)) return null;
  let best = null;
  let bestD = Infinity;
  for (const key of keys) {
    const max = strict && !strictOk(key) ? 0 : Math.min(strict ? 1 : 2, allowed(key));
    if (!max || Math.abs(q.length - key.length) > max) continue;
    const d = distance(q, key);
    if (d < 1 || d > max || d >= bestD || !shortWordsMatch(q, key)) continue;
    if (strict && endsDiffer(q, key)) continue;
    // «награда» is a word; «-Награда» only when the minus is there.
    if (/^[+-]/.test(key) && q[0] !== key[0]) continue;
    best = key;
    bestD = d;
  }
  return best;
}
