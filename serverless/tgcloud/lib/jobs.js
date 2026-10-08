// Long sends without a background process: the owner's broadcast and channel
// posts for private subscribers are jobs processed in time-boxed slices. Each
// slice runs in the invocation that created the job, then on later updates
// (see pump) until the recipient list is exhausted.
import { api, db } from 'sdk';
import { sql } from 'sdk/db';
import { now, nowInt, boldHtml, escapeHtml, sleep } from './util.js';
import { isRetryAfter, isUnreachableUser, retryAfter, sendWithFloodWait } from './tg.js';
import { logError, markUserUnreachable } from './store.js';
import { adminKeyboard } from './ui.js';

// How long one invocation may spend sending. The platform's own limit is not
// documented; keep this conservative.
export const SLICE_MS = 20000;
const LEASE_SECONDS = 60;
const SEND_PAUSE_MS = 40;

export async function runningBroadcast() {
  return db.get(sql`SELECT id FROM jobs WHERE kind = 'broadcast' AND status = 'running' LIMIT 1`);
}

export async function createBroadcast(text, reportChatId) {
  const payload = JSON.stringify({ text });
  const r = await db.run(sql`INSERT INTO jobs (kind, payload, status, report_chat_id, created_at)
    VALUES ('broadcast', ${payload}, 'running', ${reportChatId}, ${nowInt()}) RETURNING id`);
  return r.rows[0].id;
}

export async function createPostJob(message, postUrl) {
  const payload = JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, post_url: postUrl });
  const r = await db.run(sql`INSERT INTO jobs (kind, payload, status, created_at)
    VALUES ('post', ${payload}, 'running', ${nowInt()}) RETURNING id`);
  return r.rows[0].id;
}

async function claim(jobId) {
  const ts = now();
  const r = await db.run(sql`UPDATE jobs SET lease_until = ${ts + LEASE_SECONDS}
    WHERE id = ${jobId} AND status = 'running' AND lease_until < ${ts} AND retry_at <= ${ts}`);
  return r.rowsAffected === 1;
}

async function recipients(job, limit) {
  if (job.kind === 'broadcast') {
    return db.all(sql`SELECT user_id FROM users WHERE user_id > ${job.cursor} ORDER BY user_id LIMIT ${limit}`);
  }
  return db.all(sql`SELECT user_id FROM users WHERE subscribed = 1 AND user_id > ${job.cursor}
    ORDER BY user_id LIMIT ${limit}`);
}

function sender(job, payload) {
  if (job.kind === 'broadcast') {
    const text = boldHtml(escapeHtml(payload.text));
    return (uid) => api.sendMessage({ chat_id: uid, text, parse_mode: 'HTML' });
  }
  const markup = { inline_keyboard: [[{
    text: 'Открыть пост в канале', url: payload.post_url, icon_custom_emoji_id: '5411527152212411235',
  }]] };
  return (uid) => api.copyMessage({
    chat_id: uid, from_chat_id: payload.chat_id, message_id: payload.message_id, reply_markup: markup,
  });
}

// Process one job for up to budgetMs. → true when the job finished.
export async function runJob(jobId, budgetMs = SLICE_MS) {
  if (!(await claim(jobId))) return false;
  const deadline = Date.now() + budgetMs;
  let job = await db.get(sql`SELECT * FROM jobs WHERE id = ${jobId}`);
  const payload = JSON.parse(job.payload);
  const send = sender(job, payload);
  let { cursor, ok, failed } = job;
  let finished = false;
  let retryAt = 0;
  try {
    outer: while (Date.now() < deadline) {
      const batch = await recipients({ ...job, cursor }, 50);
      if (!batch.length) {
        finished = true;
        break;
      }
      for (const { user_id: uid } of batch) {
        if (Date.now() >= deadline) break outer;
        try {
          await sendWithFloodWait(() => send(uid), { attempts: job.kind === 'post' ? 2 : 3 });
          ok++;
        } catch (err) {
          if (isRetryAfter(err)) {
            // A long flood wait: stop here and resume after it.
            retryAt = now() + (retryAfter(err) ?? 5) + 1;
            break outer;
          }
          if (isUnreachableUser(err)) await markUserUnreachable(uid);
          else if (job.kind === 'post') await logError(`post ${payload.message_id} → ${uid}`, err);
          failed++;
        }
        cursor = uid;
        await db.run(sql`UPDATE jobs SET cursor = ${cursor}, ok = ${ok}, failed = ${failed},
            lease_until = ${now() + LEASE_SECONDS} WHERE id = ${jobId}`);
        await sleep(SEND_PAUSE_MS);
      }
    }
  } finally {
    await db.run(sql`UPDATE jobs SET cursor = ${cursor}, ok = ${ok}, failed = ${failed}, lease_until = 0,
        retry_at = ${retryAt}, status = ${finished ? 'done' : 'running'},
        finished_at = ${finished ? nowInt() : null}
      WHERE id = ${jobId}`);
  }
  if (finished) await reportFinished(job, ok, failed, payload);
  return finished;
}

async function reportFinished(job, ok, failed, payload) {
  if (job.kind === 'post') {
    console.info(`Channel post ${payload.message_id} distributed: delivered=${ok} failed=${failed}`);
    return;
  }
  if (!job.report_chat_id) return;
  try {
    await api.sendMessage({
      chat_id: job.report_chat_id,
      text: boldHtml(`✅ Рассылка завершена.\nДоставлено: ${ok}\nОшибок: ${failed}`),
      parse_mode: 'HTML',
      reply_markup: await adminKeyboard(),
    });
  } catch (err) {
    await logError('broadcast.report', err);
  }
}

// Oldest unfinished jobs first, so channel posts keep their order.
export async function runPendingJobs(budgetMs = SLICE_MS) {
  const deadline = Date.now() + budgetMs;
  const jobs = await db.all(sql`SELECT id FROM jobs WHERE status = 'running' AND lease_until < ${now()}
    AND retry_at <= ${now()} ORDER BY id LIMIT 5`);
  for (const { id } of jobs) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const done = await runJob(id, left);
    if (!done) break;
  }
}

export async function jobProgress(jobId) {
  return db.get(sql`SELECT * FROM jobs WHERE id = ${jobId}`);
}
