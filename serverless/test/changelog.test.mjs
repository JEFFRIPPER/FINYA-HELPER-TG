// CHANGELOG topic: Финя posts a fresh deploy's news by herself; /log shows it.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage, pump } from '../tgcloud/lib/bot.js';
import { CHANGELOG_CHAT_ID, CHANGELOG_THREAD_ID, CHANGES } from '../tgcloud/lib/changelog.js';
import { getSetting, setSetting } from '../tgcloud/lib/store.js';
import { nowInt } from '../tgcloud/lib/util.js';
import { apiError, checkErrors, groupMessage, OWNER, privateMessage, setup, user } from './helpers.mjs';

const realNow = Date.now;
afterEach(async () => {
  Date.now = realNow;
  await checkErrors();
});

const posts = (api) => api.called('sendMessage').filter((c) => c.params.chat_id === CHANGELOG_CHAT_ID);
const toOwner = (api) => api.called('sendMessage').filter((c) => c.params.chat_id === OWNER.id);
const FORUM = { id: CHANGELOG_CHAT_ID, type: 'supergroup', title: 'SQUAD FAMILY CHAT', is_forum: true };
const ANON = { id: 1087968824, is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' };
const inTopic = { message_thread_id: CHANGELOG_THREAD_ID, is_topic_message: true };
// A deploy brought news nobody has seen yet.
const freshDeploy = () => setSetting('changelog_posted', null);

test('after a deploy pump() posts the news to the topic by itself, once', async () => {
  const api = await setup();
  await freshDeploy();
  await pump({ force: true });
  await pump({ force: true });
  const all = posts(api);
  assert.equal(all.length, 1);
  assert.equal(all[0].params.message_thread_id, CHANGELOG_THREAD_ID);
  assert.match(all[0].params.text, new RegExp(`Обновление Фини · ${CHANGES[0].date}`));
  assert.match(all[0].params.text, new RegExp(CHANGES[0].title));
  assert.equal(await getSetting('changelog_posted'), CHANGES[0].id);
});

test('/log shows the news to the owner; /log post posts it right away', async () => {
  const api = await setup();
  await onMessage(privateMessage(OWNER, '/log'));
  assert.match(toOwner(api).at(-2).params.text, /Уже в топике/);
  assert.match(toOwner(api).at(-1).params.text, new RegExp(CHANGES[0].title));
  await onMessage(privateMessage(OWNER, '/log post'));
  assert.match(toOwner(api).at(-1).params.text, /уже в топике/);
  assert.equal(posts(api).length, 0);

  // Waiting after a failed try: the owner's /log post doesn't wait.
  await freshDeploy();
  await setSetting('changelog_failed_at', nowInt());
  await onMessage(privateMessage(OWNER, '/log'));
  assert.match(toOwner(api).at(-2).params.text, /Ещё не в топике/);
  assert.equal(posts(api).length, 0);
  await onMessage(privateMessage(OWNER, '/log post'));
  assert.equal(posts(api).length, 1);
  assert.match(toOwner(api).at(-1).params.text, /опубликована в CHANGELOG/);
});

test('only the owner, or an anonymous admin of that chat, can post', async () => {
  const api = await setup();
  await freshDeploy();
  await setSetting('changelog_failed_at', nowInt());
  await onMessage(privateMessage(user(5), '/log post'));
  await onMessage(groupMessage(FORUM, user(5), '/log post', inTopic));
  assert.equal(posts(api).length, 0);
  // The owner writes there anonymously, as the group.
  const cmd = groupMessage(FORUM, ANON, '/log post', { ...inTopic, sender_chat: { id: CHANGELOG_CHAT_ID, type: 'supergroup' } });
  await onMessage(cmd);
  assert.equal(posts(api).length, 1);
  assert.ok(api.called('deleteMessage').some((c) => c.params.message_id === cmd.message_id));
});

test('a failed post: the owner hears once, Финя tries again later', async () => {
  const api = await setup({
    sendMessage: (p) => {
      if (p.chat_id === CHANGELOG_CHAT_ID) throw apiError('sendMessage', 400, 'Bad Request: message thread not found');
      return { message_id: 1 };
    },
  });
  await freshDeploy();
  await pump({ force: true });
  assert.equal(posts(api).length, 1);
  assert.equal(await getSetting('changelog_posted'), null);
  assert.match(toOwner(api).at(-1).params.text, /Не смогла опубликовать новость в CHANGELOG: Bad Request: message thread not found/);
  // Not on every pump…
  await pump({ force: true });
  assert.equal(posts(api).length, 1);
  // …but half an hour later, without a second warning.
  Date.now = () => realNow() + 31 * 60 * 1000;
  await pump({ force: true });
  assert.equal(posts(api).length, 2);
  assert.equal(toOwner(api).length, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM error_log WHERE source = 'changelog.post'")).c, 2);
  // The owner's /log post says what Telegram answered.
  await onMessage(privateMessage(OWNER, '/log post'));
  assert.match(toOwner(api).at(-1).params.text, /Не вышло опубликовать: Bad Request: message thread not found/);
  await db.run('DELETE FROM error_log');
});

const OTHER = { id: -1009990001, type: 'supergroup', title: 'Сквад Новости', is_forum: true };
const otherTopic = { message_thread_id: 77, is_topic_message: true };

test('/log_on in a topic: the news go there from now on, the pending one right away', async () => {
  const api = await setup();
  await freshDeploy();
  await setSetting('changelog_failed_at', nowInt());
  // Not by someone else, nor by an anonymous admin of a stranger chat.
  await onMessage(groupMessage(OTHER, user(5), '/log_on', otherTopic));
  await onMessage(groupMessage(OTHER, ANON, '/log_on', { ...otherTopic, sender_chat: { id: OTHER.id, type: 'supergroup' } }));
  assert.equal(await getSetting('changelog_target'), null);

  const cmd = groupMessage(OTHER, OWNER, '/log_on', otherTopic);
  await onMessage(cmd);
  // Only the news itself goes to the topic, and nothing there is deleted except the command.
  const sent = api.called('sendMessage').filter((c) => c.params.chat_id === OTHER.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.message_thread_id, 77);
  assert.match(sent[0].params.text, new RegExp(CHANGES[0].title));
  assert.match(toOwner(api).at(-1).params.text, /Готово: новости об обновлениях Фини теперь приходят в «Сквад Новости», в этот топик/);
  assert.deepEqual(await getSetting('changelog_target'), { chat_id: OTHER.id, thread_id: 77, title: 'Сквад Новости' });
  assert.equal(await getSetting('changelog_posted'), CHANGES[0].id);
  assert.deepEqual(api.called('deleteMessage').map((c) => c.params.message_id), [cmd.message_id]);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM autodelete WHERE chat_id = ?', [OTHER.id])).c, 0);
  assert.equal(posts(api).length, 0);

  // Binding again (nothing pending) puts the latest news there once more, still nothing deleted.
  await onMessage(groupMessage(OTHER, OWNER, '/log_on', otherTopic));
  const again = api.called('sendMessage').filter((c) => c.params.chat_id === OTHER.id);
  assert.equal(again.length, 2);
  assert.match(again[1].params.text, new RegExp(CHANGES[0].title));
  assert.equal(await getSetting('changelog_posted'), CHANGES[0].id);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM autodelete WHERE chat_id = ?', [OTHER.id])).c, 0);

  await onMessage(privateMessage(OWNER, '/log'));
  assert.match(toOwner(api).at(-2).params.text, /Куда: Сквад Новости · топик/);
});

test('/log_on where Финя cannot write: the owner hears why, nothing moves', async () => {
  const api = await setup({
    sendMessage: (p) => {
      if (p.chat_id === OTHER.id) throw apiError('sendMessage', 400, 'Bad Request: TOPIC_CLOSED');
      return { message_id: 1 };
    },
  });
  await freshDeploy();
  await setSetting('changelog_failed_at', nowInt());
  await onMessage(groupMessage(OTHER, OWNER, '/log_on', otherTopic));
  assert.equal(await getSetting('changelog_target'), null);
  assert.equal(await getSetting('changelog_posted'), null);
  assert.match(toOwner(api).at(-1).params.text, /Не могу писать в этот топик: Bad Request: TOPIC_CLOSED/);
  await db.run('DELETE FROM error_log');
});
