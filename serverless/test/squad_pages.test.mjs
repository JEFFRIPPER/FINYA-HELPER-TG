// The Squad's pages on the «Сквад» tab: Зал славы, Календарь, Летопись and Карта.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import * as citymap from '../tgcloud/lib/citymap.js';
import * as hall from '../tgcloud/lib/hall.js';
import { profileData } from '../tgcloud/lib/webapp.js';
import { checkErrors, DISCUSSION, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const DAY = 86400;
// 28 October 2026, 15:00 МСК.
const T = Date.UTC(2026, 9, 28, 12, 0, 0) / 1000;
const at = (ts) => { Date.now = () => ts * 1000; };
const today = Math.floor((T + 3 * 3600) / DAY);

async function member(id, name, extra = {}) {
  await db.run('INSERT INTO profiles (user_id, name, username, xp) VALUES (?, ?, ?, ?)', [id, name, extra.username || '', 10]);
  await db.run(`INSERT INTO chat_members (chat_id, user_id, name, username, status, first_seen, last_active, msgs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [DISCUSSION.id, id, name, extra.username || '', extra.status || 'member', T - 300 * DAY, T, extra.msgs || 0]);
  if (extra.city) await db.run('INSERT INTO profile_info (user_id, city, updated_at) VALUES (?, ?, ?)', [id, extra.city, T]);
}

async function pair(table, a, b, since) {
  await db.run(`INSERT INTO ${table} (user_id, partner_id, since) VALUES (?, ?, ?), (?, ?, ?)`, [a, b, since, b, a, since]);
}

test('cities: «+Город» as people write it finds the place', async () => {
  await setup();
  assert.equal(citymap.findCity('г. Москва').name, 'Москва');
  assert.equal(citymap.findCity('Питер').name, 'Санкт-Петербург');
  assert.equal(citymap.findCity('СПБ').name, 'Санкт-Петербург');
  assert.equal(citymap.findCity('Екб').name, 'Екатеринбург');
  assert.equal(citymap.findCity('Москва, Россия').name, 'Москва');
  assert.equal(citymap.findCity('ростов-на-дону').name, 'Ростов-на-Дону');
  assert.equal(citymap.findCity('Орел').name, 'Орёл');
  assert.equal(citymap.findCity('Київ').name, 'Киев');
  assert.equal(citymap.findCity('Городец'), null);
  assert.equal(citymap.findCity('Простоквашино'), null);
  assert.ok(citymap.cityCount > 300);
});

test('Зал славы: records and who holds them; the secret one only once somebody has it', async () => {
  await setup();
  at(T);
  await member(2, 'Аня', { msgs: 500 });
  await member(3, 'Боря', { msgs: 20 });
  await member(4, 'Вика', { msgs: 40 });
  await pair('marriages', 2, 3, T - 400 * DAY);
  await db.run('INSERT INTO chat_activity (chat_id, user_id, day, msgs) VALUES (?, 2, ?, 120), (?, 2, ?, 30), (?, 4, ?, 31)',
    [DISCUSSION.id, today - 1, DISCUSSION.id, today - 2, DISCUSSION.id, today - 3]);
  await db.run('INSERT INTO reputation (user_id, points, given) VALUES (4, 77, 0)');
  let pages = await hall.squadPages(T);
  const by = (key) => pages.hall.find((r) => r.key === key);
  assert.equal(by('marriage').who, 'Аня + Боря');
  assert.equal(by('marriage').value, '400 дней');
  assert.equal(by('dating').who, null);
  assert.match(by('best_day').value, /^120 сообщений · 27\.10\.2026$/);
  assert.equal(by('days').who, 'Аня');
  assert.equal(by('msgs').value, '500 сообщений');
  assert.equal(by('rep').who, 'Вика');
  assert.equal(by('dark').who, null);
  assert.equal(by('dark').secret, true);

  // A new holder shows up in «Летопись» after the cache runs out.
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (4, 'dark_secret', ?)", [T + 60]);
  pages = await hall.squadPages(T + 120);
  assert.equal(pages.hall.find((r) => r.key === 'dark').who, null, 'cached for 5 minutes');
  pages = await hall.squadPages(T + hall.CACHE_TTL + 1);
  assert.equal(pages.hall.find((r) => r.key === 'dark').who, 'Вика');
  assert.ok(pages.chronicle.some((e) => e.kind === 'badge' && /Вика открывает ачивку «СЕКРЕТ ТЬМЫ»/.test(e.text)));
});

test('Календарь: birthdays, pair anniversaries and holidays for 30 days', async () => {
  await setup();
  at(T);
  await member(2, 'Аня');
  await member(3, 'Боря');
  await member(5, 'Гоша', { status: 'left' });
  await member(6, 'Дина');
  await member(7, 'Ева');
  await db.run('INSERT INTO birthdays (user_id, day, month, announce, updated_at) VALUES (2, 28, 10, 1, 0), (5, 29, 10, 1, 0), (6, 30, 10, 0, 0), (3, 3, 11, 1, 0)');
  // One year married in 9 days; 100 days together tomorrow.
  await pair('marriages', 2, 3, T - 356 * DAY);
  await pair('dating', 6, 7, T - 99 * DAY);
  const { calendar } = await hall.squadPages(T);
  const line = (e) => `${e.in} ${e.kind} ${e.title}${e.sub ? ` · ${e.sub}` : ''}`;
  assert.deepEqual(calendar.map(line), [
    '0 birthday Аня · День рождения',
    '1 dating Дина + Ева · 100 дней вместе',
    '3 holiday Хэллоуин',
    '6 birthday Боря · День рождения',
    '9 wedding Аня + Боря · 1 год в браке · ситцевая свадьба 🧵',
  ]);
  assert.equal(calendar[0].at, Date.UTC(2026, 9, 28) / 1000 - 3 * 3600);
});

test('Летопись: weddings, citizens, positions and records, newest first', async () => {
  await setup();
  at(T);
  await member(2, 'Аня');
  await member(3, 'Боря');
  await member(4, 'Вика');
  await pair('marriages', 2, 3, T - 10 * DAY);
  await db.run("INSERT INTO squad_chats (chat_id, title, added_by, added_at) VALUES (?, 'SQUAD FAMILY CHAT', 1, 0)", [DISCUSSION.id]);
  await db.run('INSERT INTO citizens (user_id, chat_id, since, set_at) VALUES (4, ?, ?, ?)', [DISCUSSION.id, T - 90 * DAY, T - 2 * DAY]);
  await db.run("INSERT INTO positions (user_id, code, given_by, given_at) VALUES (2, 'creative', 1, ?)", [T - 5 * DAY]);
  await db.run("INSERT INTO achievements (user_id, code, unlocked_at) VALUES (3, 'msgs_10', ?)", [T - DAY]);
  const { chronicle } = await hall.squadPages(T);
  const texts = chronicle.map((e) => e.text);
  assert.equal(texts[0], 'Вика: гражданство чата «SQUAD FAMILY CHAT»');
  assert.match(texts[1], /^Аня: должность «.+»$/);
  assert.equal(texts[2], 'Аня и Боря поженились');
  // An ordinary badge is not history.
  assert.ok(!texts.some((t) => /Первые шаги/.test(t)));
});

test('Карта: cities with people and @usernames; the unknown ones listed apart; left members out', async () => {
  await setup();
  at(T);
  await member(2, 'Аня', { city: 'Москва', username: 'anya' });
  await member(3, 'Боря', { city: 'г. Москва' });
  await member(4, 'Вика', { city: 'Питер', username: 'vika' });
  await member(5, 'Гоша', { city: 'Простоквашино' });
  await member(6, 'Дина', { city: 'Москва', status: 'left' });
  const data = await profileData(user(2, { first_name: 'Аня' }));
  const { map } = data.squad;
  assert.equal(map.people, 4);
  assert.deepEqual(map.cities.map((c) => [c.name, c.count]), [['Москва', 2], ['Санкт-Петербург', 1]]);
  assert.deepEqual(map.cities[0].people.map(({ name, username }) => ({ name, username })), [{ name: 'Аня', username: 'anya' }, { name: 'Боря', username: '' }]);
  assert.ok(map.cities[0].people.every((x) => /^[0-9a-f]{12}$/.test(x.ref)));
  assert.deepEqual([map.cities[1].lat, map.cities[1].lon], [59.94, 30.31]);
  assert.deepEqual(map.other.map((c) => [c.name, c.count]), [['Простоквашино', 1]]);
  // Not cached: a fresh «+Город» is on the map at once.
  await db.run("UPDATE profile_info SET city = 'Казань' WHERE user_id = 5");
  const again = await profileData(user(2, { first_name: 'Аня' }));
  assert.ok(again.squad.map.cities.some((c) => c.name === 'Казань'));
  assert.ok(Array.isArray(again.squad.hall) && Array.isArray(again.squad.calendar) && Array.isArray(again.squad.chronicle));
});
