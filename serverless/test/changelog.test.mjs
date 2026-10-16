// /log: update news for the CHANGELOG topic.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from 'sdk';
import { onMessage } from '../tgcloud/lib/bot.js';
import { CHANGELOG_CHAT_ID, CHANGELOG_THREAD_ID, CHANGES } from '../tgcloud/lib/changelog.js';
import { getSetting } from '../tgcloud/lib/store.js';
import { apiError, checkErrors, groupMessage, OWNER, privateMessage, setup, user } from './helpers.mjs';

afterEach(checkErrors);

const posts = (api) => api.called('sendMessage').filter((c) => c.params.chat_id === CHANGELOG_CHAT_ID);
const FORUM = { id: CHANGELOG_CHAT_ID, type: 'supergroup', title: 'SQUAD FAMILY CHAT', is_forum: true };
const ANON = { id: 1087968824, is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' };
const inTopic = { message_thread_id: CHANGELOG_THREAD_ID, is_topic_message: true };

test('/log shows the news to the owner, /log post puts it in the topic once', async () => {
  const api = await setup();
  await onMessage(privateMessage(OWNER, '/log'));
  assert.equal(posts(api).length, 0);
  const preview = api.called('sendMessage').at(-1).params.text;
  assert.match(preview, new RegExp(`Обновление Фини · ${CHANGES[0].date}`));
  assert.match(preview, new RegExp(CHANGES[0].title));

  await onMessage(privateMessage(OWNER, '/log post'));
  const [post] = posts(api);
  assert.equal(post.params.message_thread_id, CHANGELOG_THREAD_ID);
  assert.match(post.params.text, /Финя теперь живёт в чате/);
  assert.match(api.called('sendMessage').at(-1).params.text, /опубликована в CHANGELOG/);
  assert.equal(await getSetting('changelog_posted'), CHANGES[0].id);

  await onMessage(privateMessage(OWNER, '/log post'));
  assert.equal(posts(api).length, 1);
  assert.match(api.called('sendMessage').at(-1).params.text, /уже в топике/);
});

test('only the owner, or an anonymous admin of that chat, can post', async () => {
  const api = await setup();
  await onMessage(privateMessage(user(5), '/log post'));
  await onMessage(groupMessage(FORUM, user(5), '/log post', inTopic));
  assert.equal(posts(api).length, 0);
  // The owner writes there anonymously, as the group.
  const cmd = groupMessage(FORUM, ANON, '/log post', { ...inTopic, sender_chat: { id: CHANGELOG_CHAT_ID, type: 'supergroup' } });
  await onMessage(cmd);
  assert.equal(posts(api).length, 1);
  assert.ok(api.called('deleteMessage').some((c) => c.params.message_id === cmd.message_id));
});

test('a failed post is not marked as done', async () => {
  const api = await setup({
    sendMessage: (p) => {
      if (p.chat_id === CHANGELOG_CHAT_ID) throw apiError('sendMessage', 400, 'Bad Request: message thread not found');
      return { message_id: 1 };
    },
  });
  await onMessage(privateMessage(OWNER, '/log post'));
  assert.equal(await getSetting('changelog_posted'), null);
  assert.match(api.called('sendMessage').at(-1).params.text, /Не вышло опубликовать/);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM error_log WHERE source = 'changelog.post'")).c, 1);
  await db.run('DELETE FROM error_log');
});
