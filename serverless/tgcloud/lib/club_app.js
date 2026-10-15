// Actions of /api/club. Each one changes something, then returns the profile.
import { OWNER_USER_ID } from './config.js';
import { isMaintenance, setSetting } from './store.js';
import * as club from './club.js';
import { profileData } from './webapp.js';

const OWNER_SETTINGS = { weekly: 'club_weekly', welcome: 'club_welcome', birthdays: 'club_birthdays' };

function int(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

export async function handle(user, input) {
  const owner = user.id === OWNER_USER_ID;
  if (!owner && (await isMaintenance())) throw new club.ClubError('Бот на техработах. Попробуй чуть позже.');
  const action = String(input.action || '');
  let result = null;
  switch (action) {
    case 'daily':
      result = await club.claimDaily(user);
      break;
    case 'quest':
      result = await club.claimQuest(user, int(input.id));
      break;
    case 'buy':
      await club.buy(user, String(input.item || ''));
      break;
    case 'wear':
      await club.wear(user, String(input.slot || ''), input.item == null ? null : String(input.item));
      break;
    case 'vote':
      result = await club.vote(user, int(input.poll), int(input.option));
      break;
    case 'birthday':
      await club.setBirthday(user, int(input.day), int(input.month), input.announce !== false);
      break;
    case 'ref':
      await club.referralLink(user);
      break;
    default:
      if (!owner) throw new club.ClubError('Неизвестное действие.');
      await ownerAction(user, action, input);
  }
  const data = await profileData(user);
  data.result = result ? { points: result.points, promoted: result.promoted } : null;
  return data;
}

async function ownerAction(user, action, input) {
  if (action === 'poll_create') {
    await club.createPoll(input.question, input.options);
  } else if (action === 'poll_close') {
    await club.closePoll(int(input.poll));
  } else if (action === 'setting') {
    const key = OWNER_SETTINGS[String(input.key || '')];
    if (!key) throw new club.ClubError('Неизвестная настройка.');
    await setSetting(key, Boolean(input.value));
  } else if (action === 'weekly_preview') {
    await club.weeklyPreview(user.id);
  } else {
    throw new club.ClubError('Неизвестное действие.');
  }
}
