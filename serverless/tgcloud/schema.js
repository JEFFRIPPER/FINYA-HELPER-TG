// FINYA HELPER database. Tables mirror xp.sqlite3 (profiles, events, messages,
// admin_changes, relay_*) and the former state.json (users, feedback, settings,
// blacklist). Sessions and jobs replace in-memory user_data and asyncio tasks.
// All runtime code uses raw SQL, so columns are plain INTEGER/TEXT/REAL.
import { table, integer, text, real, index, primaryKey } from 'sdk/db';

export const profiles = table('profiles', {
  user_id: integer('user_id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull().default(''),
  xp: integer('xp').notNull().default(0),
  manual_rank: text('manual_rank'),
}, (t) => ({
  byName: index('profiles_by_name').on(t.name),
  byUsername: index('profiles_by_username').on(t.username),
}));

export const events = table('events', {
  user_id: integer('user_id').notNull(),
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id').notNull(),
  kind: text('kind').notNull(),
  points: integer('points').notNull(),
  earned_at: integer('earned_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.chat_id, t.message_id, t.kind] }),
  byTime: index('events_by_time').on(t.earned_at, t.user_id),
  byUser: index('events_by_user').on(t.user_id, t.kind, t.earned_at),
}));

export const messages = table('messages', {
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id').notNull(),
  root_id: integer('root_id').notNull(),
  author_id: integer('author_id'),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.message_id] }),
}));

export const admin_changes = table('admin_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  actor_id: integer('actor_id').notNull(),
  operation_id: text('operation_id').notNull().unique(),
  action: text('action').notNull(),
  request_value: text('request_value').notNull(),
  before_xp: integer('before_xp').notNull(),
  after_xp: integer('after_xp').notNull(),
  before_rank: text('before_rank'),
  after_rank: text('after_rank'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  byUser: index('admin_changes_by_user').on(t.user_id, t.id),
}));

export const relay_targets = table('relay_targets', {
  chat_id: integer('chat_id').primaryKey(),
  title: text('title').notNull(),
  enabled: integer('enabled').notNull(),
  enabled_at: real('enabled_at').notNull(),
});

export const relay_outbox = table('relay_outbox', {
  source_chat_id: integer('source_chat_id').notNull(),
  source_message_id: integer('source_message_id').notNull(),
  target_chat_id: integer('target_chat_id').notNull(),
  post_url: text('post_url').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  retry_at: real('retry_at').notNull(),
  error: text('error').notNull().default(''),
  delivered_id: integer('delivered_id'),
  claimed_at: real('claimed_at'),
}, (t) => ({
  pk: primaryKey({ columns: [t.source_chat_id, t.source_message_id, t.target_chat_id] }),
  due: index('relay_due').on(t.status, t.retry_at),
}));

export const users = table('users', {
  user_id: integer('user_id').primaryKey(),
  username: text('username'),
  first_name: text('first_name'),
  first_seen: integer('first_seen').notNull(),
  last_seen: integer('last_seen').notNull(),
  blocked: integer('blocked').notNull().default(0),
  blocked_at: integer('blocked_at'),
  subscribed: integer('subscribed').notNull().default(0),
}, (t) => ({
  byUsername: index('users_by_username').on(t.username),
}));

export const feedback = table('feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  username: text('username'),
  first_name: text('first_name'),
  text: text('text').notNull(),
  time: integer('time').notNull(),
});

// key → JSON-encoded value (news, maintenance, last_channel_post_id, ...).
export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const blacklist = table('blacklist', {
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  channel_title: text('channel_title').notNull().default(''),
  username: text('username').notNull().default(''),
  full_name: text('full_name').notNull().default(''),
  left_at: real('left_at').notNull(),
  status: text('status').notNull(),
  last_error: text('last_error').notNull().default(''),
  retry_at: real('retry_at').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  claimed_at: real('claimed_at'),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.user_id] }),
  due: index('blacklist_due').on(t.status, t.retry_at),
}));

// Per-user dialog state that used to live in context.user_data.
export const sessions = table('sessions', {
  user_id: integer('user_id').primaryKey(),
  data: text('data').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// Long sends (owner broadcast, channel post to subscribers) processed in slices.
export const jobs = table('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('running'),
  cursor: integer('cursor').notNull().default(0),
  ok: integer('ok').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  report_chat_id: integer('report_chat_id'),
  lease_until: real('lease_until').notNull().default(0),
  retry_at: real('retry_at').notNull().default(0),
  created_at: integer('created_at').notNull(),
  finished_at: integer('finished_at'),
}, (t) => ({
  byStatus: index('jobs_by_status').on(t.status, t.id),
}));

export const error_log = table('error_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  source: text('source').notNull(),
  text: text('text').notNull(),
});

// SQUAD SHOP orders read from the owner's YooMoney history (lib/shop.js).
export const shop_orders = table('shop_orders', {
  operation_id: text('operation_id').primaryKey(),
  order_id: text('order_id').notNull(),
  username: text('username').notNull().default(''),
  items: text('items').notNull().default(''),
  amount: real('amount').notNull(),
  paid_at: text('paid_at').notNull(),
  status: text('status').notNull(),
  issued_at: integer('issued_at'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  byPaid: index('shop_orders_by_paid').on(t.paid_at),
}));
