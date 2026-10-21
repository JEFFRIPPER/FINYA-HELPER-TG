// Positions of the Squad team: the owner appoints in reply, «штаб» lists the team.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { find, POSITIONS } from '../tgcloud/lib/staff.js';
import { setSetting } from '../tgcloud/lib/store.js';
import { profileData } from '../tgcloud/lib/webapp.js';
import { checkErrors, DISCUSSION, groupMessage, OWNER, replies, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const say = (from, text, extra) => onMessage(groupMessage(DISCUSSION, from, text, extra));
const replyTo = (target) => ({ reply_to_message: groupMessage(DISCUSSION, target, 'сообщение') });
const last = (api) => replies(api).at(-1).params.text;

test('positions: 8 of them, found by any of their names', async () => {
  await setup();
  assert.equal(POSITIONS.length, 8);
  assert.equal(new Set(POSITIONS.map((p) => p.code)).size, 8);
  assert.equal(find('Контент-менеджер').code, 'content');
  assert.equal(find('дизайнер').code, 'creative');
  assert.equal(find('тех. администратор').code, 'tech');
  assert.equal(find('Модератор активности').code, 'activity');
  assert.equal(find('модератор').code, 'moderator');
  assert.equal(find('администратор чата').code, 'admin');
  assert.equal(find('повар'), null);
});

test('only the owner appoints in reply; the news stays, the team and profile show it', async () => {
  const api = await setup();
  await setSetting('chat_captcha', false);
  const a = user(2, { first_name: 'Аня' });
  const b = user(3, { first_name: 'Боря' });
  await say(b, '+должность Креативщик', replyTo(a));
  assert.match(last(api), /только владелец/);
  await say(OWNER, '+должность Креативщик', replyTo(a));
  assert.match(last(api), /<a href="tg:\/\/user\?id=2">Аня<\/a> назначается на должность\n🎨 Креативщик \/ Дизайнер/);
  assert.match(last(api), /• Баннеры/);
  const news = replies(api).at(-1);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM autodelete WHERE message_id = ?', [news.params.reply_parameters.message_id])).c, 0);
  await say(OWNER, '+должность креативщик', replyTo(a));
  assert.match(last(api), /уже Креативщик/);
  await say(OWNER, '+должность повар', replyTo(a));
  assert.match(last(api), /Такой должности нет/);
  await say(OWNER, '+должность Модератор чата', replyTo(a));
  await say(OWNER, '+должность Ивент-менеджер', replyTo(a));
  await say(OWNER, '+должность Комьюнити', replyTo(a));
  assert.match(last(api), /Больше 3 должностей/);

  await say(b, 'штаб');
  assert.match(last(api), /⛓️ Штаб Сквада/);
  assert.match(last(api), /🎨 Креативщик \/ Дизайнер — Аня/);
  assert.match(last(api), /📝 Контент-менеджер — вакансия/);
  await say(b, 'должность', replyTo(a));
  assert.match(last(api), /Должность Аня/);
  assert.match(last(api), /🛡 Модератор чата/);
  await say(b, 'должность');
  assert.match(last(api), /У тебя пока нет должности/);
  await say(b, 'должность контент-менеджер');
  assert.match(last(api), /Оформление постов/);
  assert.match(last(api), /Вакансия/);

  const data = await profileData(a);
  assert.deepEqual(data.me.positions.map((p) => p.title), ['Креативщик / Дизайнер', 'Ивент-менеджер', 'Модератор чата']);
  assert.deepEqual(data.squad.team.find((t) => t.title === 'Ивент-менеджер').people, ['Аня']);

  await say(OWNER, '-должность ивент-менеджер', replyTo(a));
  assert.match(last(api), /снимается с должности «Ивент-менеджер»/);
  await say(OWNER, '-должность', replyTo(a));
  assert.match(last(api), /больше без должности/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM positions')).c, 0);
});
