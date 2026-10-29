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

// What a member tells about themselves for «Моя анкета»: «+Пол», «+Город», the year
// of «+ДР» (the day and month live in birthdays).
export const profile_info = table('profile_info', {
  user_id: integer('user_id').primaryKey(),
  gender: text('gender').notNull().default(''),
  city: text('city').notNull().default(''),
  birth_year: integer('birth_year'),
  updated_at: integer('updated_at').notNull(),
});

// Citizenship like Iris has it: the one Squad chat a member calls home («+Гражданство»
// in it). since: when they first showed up there.
export const citizens = table('citizens', {
  user_id: integer('user_id').primaryKey(),
  chat_id: integer('chat_id').notNull(),
  since: integer('since').notNull(),
  set_at: integer('set_at').notNull(),
}, (t) => ({
  byChat: index('citizens_by_chat').on(t.chat_id, t.since),
}));

// Chats where Финя works as the chat manager without the channel's posts (/chat_on).
export const squad_chats = table('squad_chats', {
  chat_id: integer('chat_id').primaryKey(),
  title: text('title').notNull(),
  added_by: integer('added_by').notNull(),
  added_at: integer('added_at').notNull(),
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

// ---- club: rewards, shop, polls, birthdays, referrals ----------------------
// Bonus XP (daily reward, quests, achievements, ...) goes to `events` with
// chat_id = 0 and message_id as the idempotency key of that reward.

export const achievements = table('achievements', {
  user_id: integer('user_id').notNull(),
  code: text('code').notNull(),
  unlocked_at: integer('unlocked_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.code] }),
}));

// Items bought for XP. Buying spends the balance (XP minus purchases), not XP itself.
export const purchases = table('purchases', {
  user_id: integer('user_id').notNull(),
  item: text('item').notNull(),
  price: integer('price').notNull(),
  bought_at: integer('bought_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.item] }),
}));

// Equipped cosmetics: avatar frame, name colour, title.
export const wardrobe = table('wardrobe', {
  user_id: integer('user_id').primaryKey(),
  frame: text('frame'),
  color: text('color'),
  title: text('title'),
  updated_at: integer('updated_at').notNull(),
});

export const polls = table('polls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  question: text('question').notNull(),
  options: text('options').notNull(),
  status: text('status').notNull().default('open'),
  created_at: integer('created_at').notNull(),
  closed_at: integer('closed_at'),
}, (t) => ({
  byStatus: index('polls_by_status').on(t.status, t.id),
}));

export const poll_votes = table('poll_votes', {
  poll_id: integer('poll_id').notNull(),
  user_id: integer('user_id').notNull(),
  option: integer('option').notNull(),
  voted_at: integer('voted_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.poll_id, t.user_id] }),
}));

export const birthdays = table('birthdays', {
  user_id: integer('user_id').primaryKey(),
  day: integer('day').notNull(),
  month: integer('month').notNull(),
  announce: integer('announce').notNull().default(1),
  updated_at: integer('updated_at').notNull(),
}, (t) => ({
  byDate: index('birthdays_by_date').on(t.month, t.day),
}));

// One personal invite link to the channel per member.
export const ref_links = table('ref_links', {
  user_id: integer('user_id').primaryKey(),
  link: text('link').notNull().unique(),
  created_at: integer('created_at').notNull(),
});

// Who joined the channel through whose link; a member counts once, ever.
export const referrals = table('referrals', {
  referred_id: integer('referred_id').primaryKey(),
  referrer_id: integer('referrer_id').notNull(),
  joined_at: integer('joined_at').notNull(),
  points: integer('points').notNull().default(0),
}, (t) => ({
  byReferrer: index('referrals_by_referrer').on(t.referrer_id, t.joined_at),
}));

// Bot replies to /rank and /top in groups, and the commands: deleted from pump() later.
export const autodelete = table('autodelete', {
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id').notNull(),
  delete_at: integer('delete_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.message_id] }),
  due: index('autodelete_due').on(t.delete_at),
}));

// ---- Финя в чате: участники, актив, репутация, браки, РП, модерация ------------

// Who is in each Squad chat. Names refresh on every message; leaving drops a member
// from tops and «кто сегодня…» until they come back.
export const chat_members = table('chat_members', {
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  name: text('name').notNull(),
  username: text('username').notNull().default(''),
  status: text('status').notNull().default('member'),
  first_seen: integer('first_seen').notNull(),
  last_active: integer('last_active').notNull().default(0),
  msgs: integer('msgs').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.user_id] }),
  byActive: index('chat_members_by_active').on(t.chat_id, t.status, t.last_active),
  byUsername: index('chat_members_by_username').on(t.username),
}));

// Messages per member per Moscow day (day = days since 1970 in MSK).
export const chat_activity = table('chat_activity', {
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  day: integer('day').notNull(),
  msgs: integer('msgs').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.day, t.user_id] }),
}));

export const reputation = table('reputation', {
  user_id: integer('user_id').primaryKey(),
  points: integer('points').notNull().default(0),
  given: integer('given').notNull().default(0),
});

// The «+» messages already counted, so a redelivered update adds nothing.
export const rep_votes = table('rep_votes', {
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id').notNull(),
  from_id: integer('from_id').notNull(),
  to_id: integer('to_id').notNull(),
  at: integer('at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.message_id] }),
  byTime: index('rep_votes_by_time').on(t.at),
}));

// A marriage is two rows, one per spouse; the primary key keeps everyone in one marriage.
export const spouses = table('spouses', {
  user_id: integer('user_id').primaryKey(),
  partner_id: integer('partner_id').notNull(),
  since: integer('since').notNull(),
});

export const proposals = table('proposals', {
  from_id: integer('from_id').notNull(),
  to_id: integer('to_id').notNull(),
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.from_id, t.to_id] }),
}));

// Dating («Встречаться»): the step before marriage. Both rows, like spouses; it lasts
// until one of them says «Расстаться» or they marry.
export const dating = table('dating', {
  user_id: integer('user_id').primaryKey(),
  partner_id: integer('partner_id').notNull(),
  since: integer('since').notNull(),
});

export const date_offers = table('date_offers', {
  from_id: integer('from_id').notNull(),
  to_id: integer('to_id').notNull(),
  chat_id: integer('chat_id').notNull(),
  message_id: integer('message_id'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.from_id, t.to_id] }),
}));

// The chart theme bought in the shop (chart_*), for «Кто Я» and «Моя анкета».
export const chart_themes = table('chart_themes', {
  user_id: integer('user_id').primaryKey(),
  theme: text('theme').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// RP actions the owner added («+рп пощекотать = щекочет 🤭»).
export const rp_actions = table('rp_actions', {
  cmd: text('cmd').primaryKey(),
  action: text('action').notNull(),
  created_at: integer('created_at').notNull(),
});

export const warns = table('warns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  by_id: integer('by_id').notNull(),
  reason: text('reason').notNull().default(''),
  at: integer('at').notNull(),
}, (t) => ({
  byUser: index('warns_by_user').on(t.chat_id, t.user_id, t.at),
}));

// Messages in the current flood window of each member.
export const flood = table('flood', {
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  window_start: integer('window_start').notNull(),
  count: integer('count').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.user_id] }),
}));

// Newcomers who still have to press «Я не бот».
export const captcha = table('captcha', {
  chat_id: integer('chat_id').notNull(),
  user_id: integer('user_id').notNull(),
  message_id: integer('message_id'),
  // pending → passed; a passed row stops a late duplicate join update from asking again.
  status: text('status').notNull().default('pending'),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.chat_id, t.user_id] }),
  due: index('captcha_due').on(t.status, t.created_at),
}));

// ---- Премиум-эмодзи в ответах Фини ---------------------------------------------

// Emoji packs the owner sent Финя in the private chat (one emoji is enough per pack).
export const emoji_packs = table('emoji_packs', {
  name: text('name').primaryKey(),
  title: text('title').notNull(),
  count: integer('count').notNull(),
  added_at: integer('added_at').notNull(),
});

// Plain emoji → the premium one used in the chat replies. `picked`: the owner sent
// exactly this one, so a later pack doesn't replace it.
export const premium_emoji = table('premium_emoji', {
  base: text('base').primaryKey(),
  custom_id: text('custom_id').notNull(),
  set_name: text('set_name'),
  picked: integer('picked').notNull().default(0),
  added_at: integer('added_at').notNull(),
});

// ---- Профиль как у Ириса: «О себе» и награды -------------------------------------

// «+описание …»: a few lines about yourself, shown in the profile.
export const profile_about = table('profile_about', {
  user_id: integer('user_id').primaryKey(),
  text: text('text').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// «наградить …» from a chat admin; shown in the profile, newest first.
export const awards = table('awards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  text: text('text').notNull(),
  chat_id: integer('chat_id').notNull(),
  given_by: integer('given_by').notNull(),
  given_at: integer('given_at').notNull(),
}, (t) => ({
  byUser: index('awards_by_user').on(t.user_id, t.given_at),
}));

// The degree of an award, 1–8 (🎗…🏵), like Iris has it. No row: degree 1.
export const award_degrees = table('award_degrees', {
  award_id: integer('award_id').primaryKey(),
  degree: integer('degree').notNull(),
});

// «+ник Вася»: how Финя calls the member in tops, the profile and RP.
export const nicks = table('nicks', {
  user_id: integer('user_id').primaryKey(),
  nick: text('nick').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// XP spent besides the shop: gifts to others and casino stakes. The balance is
// XP minus purchases minus these; the rank keeps counting all XP earned.
export const xp_spend = table('xp_spend', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  amount: integer('amount').notNull(),
  other_id: integer('other_id'),
  at: integer('at').notNull(),
}, (t) => ({
  byUser: index('xp_spend_by_user').on(t.user_id, t.kind, t.at),
}));

// «Финя, напомни через 2ч …»: sent from pump() when due.
export const reminders = table('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  name: text('name').notNull(),
  chat_id: integer('chat_id').notNull(),
  thread_id: integer('thread_id'),
  message_id: integer('message_id'),
  text: text('text').notNull(),
  due_at: integer('due_at').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  byDue: index('reminders_by_due').on(t.due_at),
  byUser: index('reminders_by_user').on(t.user_id, t.due_at),
}));

// Counts behind the chat achievements that no other table keeps: RP actions,
// jackpots, reminders set, days as №1 of the daily summary, night and early messages.
export const counters = table('counters', {
  user_id: integer('user_id').notNull(),
  key: text('key').notNull(),
  n: integer('n').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.key] }),
}));

// A chat export the owner sent in the private chat: parsed at once, then imported
// batch by batch (history_queue) within the call's time and on later updates.
export const history_imports = table('history_imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chat_id: integer('chat_id').notNull(),
  title: text('title').notNull(),
  report_chat_id: integer('report_chat_id').notNull(),
  progress_message_id: integer('progress_message_id'),
  chunks: integer('chunks').notNull(),
  done: integer('done').notNull().default(0),
  added: integer('added').notNull().default(0),
  members: integer('members').notNull().default(0),
  created_at: integer('created_at').notNull(),
  finished_at: integer('finished_at'),
});

export const history_queue = table('history_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  import_id: integer('import_id').notNull(),
  users: text('users').notNull(),
  lease_until: integer('lease_until').notNull().default(0),
}, (t) => ({
  byImport: index('history_queue_by_import').on(t.import_id, t.id),
}));

// Positions in the Squad («+должность Креативщик» from the owner): the team behind
// the channel and the chats, apart from the XP ranks.
export const positions = table('positions', {
  user_id: integer('user_id').notNull(),
  code: text('code').notNull(),
  given_by: integer('given_by').notNull(),
  given_at: integer('given_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.code] }),
}));

// «Витрина»: up to three achievements a member shows off in «Кто Я» and the Mini App.
// codes: a JSON array of achievement codes, in the member's order.
export const showcase = table('showcase', {
  user_id: integer('user_id').primaryKey(),
  codes: text('codes').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// «Огонёк пары»: a married or dating couple that reply to each other every day.
// a < b; a_day / b_day: the last Moscow day each of them replied to the other;
// lit_day: the last day both did; days: the run then; best: the longest run.
export const pair_fire = table('pair_fire', {
  a: integer('a').notNull(),
  b: integer('b').notNull(),
  a_day: integer('a_day').notNull().default(0),
  b_day: integer('b_day').notNull().default(0),
  lit_day: integer('lit_day').notNull().default(0),
  days: integer('days').notNull().default(0),
  best: integer('best').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.a, t.b] }),
}));

// «Ёлка Сквада»: toys members hang on the shared tree for XP, 1 December – 13 January.
// season: the year of that December; spend_id: the xp_spend row that paid for it.
// Where a toy hangs follows the order they were hung in.
export const tree_toys = table('tree_toys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season: integer('season').notNull(),
  user_id: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  spend_id: integer('spend_id').notNull(),
  at: integer('at').notNull(),
}, (t) => ({
  bySeason: index('tree_toys_by_season').on(t.season, t.user_id),
}));

// A random ref for each member the Mini App shows: a tap on a person sends the ref,
// never the Telegram ID. Made once, the first time the member is listed.
export const member_refs = table('member_refs', {
  user_id: integer('user_id').primaryKey(),
  ref: text('ref').notNull().unique(),
});
