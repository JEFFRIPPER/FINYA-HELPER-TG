import asyncio
import html
import json
import logging
import os
import platform
import socket
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from activity_xp import ActivityXP, DAILY_XP_LIMIT, RANKS, rank_for
from channel_blacklist import ChannelBlacklist
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import BadRequest, Forbidden, RetryAfter, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ChatMemberHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    MessageReactionHandler,
    filters,
)

ROOT = Path(__file__).resolve().parent
PHOTO_PATH = str(ROOT / "info.jpg")
RUNTIME_DIR = ROOT / "runtime"
HEARTBEAT_PATH = RUNTIME_DIR / "heartbeat.txt"
LOGS_DIR = ROOT / "logs"
BOT_STARTED_AT = time.time()
BOT_VERSION = "2.4.1"
SQUAD_CHANNEL_USERNAME = "THKC_SQUAD"
SQUAD_CHANNEL_URL = f"https://t.me/{SQUAD_CHANNEL_USERNAME}"


def load_local_env(path):
    """Load simple KEY=VALUE pairs without overriding real environment variables."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env(ROOT / ".env")
STATE_DIR = Path(os.environ.get("FINYA_STATE_DIR") or
                 os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") or RUNTIME_DIR)
STATE_PATH = STATE_DIR / "state.json"
SQUAD_CHANNEL_ID = os.environ.get("SQUAD_CHANNEL_ID", "").strip()
# Verified @THKC_SQUAD ID; usernames can change or be reassigned.
BLACKLIST_CHANNEL_ID = int(os.environ.get("BLACKLIST_CHANNEL_ID", "-1001192817776"))
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
if not TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

# Verified Telegram account: @THKC_SQUAD_CREATOR. Usernames can change.
OWNER_USER_ID = 7221285861

# Custom emoji from https://t.me/addemoji/sfsymbols.
BUTTON_ICONS = {
    "ℹ️": "6021620268697393273",
    "👤": "6021437281615748449",
    "💠": "6021620268697393273",
    "📜": "6023985764885338464",
    "🔥": "6021384767050618542",
    "🟢": "6021435456254646075",
    "🙂": "6019118553326689234",
    "🎁": "6023826881160157558",
    "⌨️": "6019107055699236857",
    "✨": "6019145074749740966",
    "🤝": "6021642336239360403",
    "🏦": "6030602393933060595",
    "⬅️": "5805509901048356965",
}


def menu_button(text, **kwargs):
    prefix, _, label = text.partition(" ")
    icon_id = BUTTON_ICONS.get(prefix)
    if "Папка" in text:
        icon_id = "6021375494216226506"
    elif "Буст" in text:
        icon_id = "6023609813513018256"
    elif label == "ТГК":
        icon_id = "6023656439677982525"
    elif "Главное меню" in text:
        icon_id = "6023896773162967617"
    return InlineKeyboardButton(
        label if icon_id else text, icon_custom_emoji_id=icon_id, **kwargs,
    )


HOME_TEXT = (
    "<b>𒈒𝙏.𝙉.𝙆.𝘾 𝙎𝙌𝙐𝘼𝘿𒈒 @THKC_SQUAD\n\n"
    "Всё о Скваде: важные ссылки, правила и наши партнёры.\n\n"
    "Выбери раздел:</b>"
)
INFO_TEXT = "<b>Сквад и партнёры\n\nВыбери раздел:</b>"
SQUAD_ICON_ID = "5366465407609756495"
SQUAD_EMOJI = f'<tg-emoji emoji-id="{SQUAD_ICON_ID}">💠</tg-emoji>'
SQUAD_TEXT = (
    f"<b>{SQUAD_EMOJI} T.N.K.C SQUAD — ИНФО {SQUAD_EMOJI}\n\n"
    "Информация о Скваде, правила и полезные ссылки — на кнопках ниже.\n\n"
    "⚠️ НАРУШЕНИЕ ПРАВИЛ КАРАЕТСЯ БАНОМ\n"
    "ПОСЛЕ ВЫХОДА ИЗ БЕСЕДЫ — ВОЗВРАТА НЕТ\n\n"
    "Здесь собраны папка Сквада, темы, стикеры, вишлист, "
    "анонимные вопросы, соцсети владельца и поддержка проекта.\n\n"
    f"Спасибо за внимание 🧐{SQUAD_EMOJI}\n\n"
    f"✨ Не забываем распространять НАШ КАНАЛ {SQUAD_EMOJI}\n"
    "в TikTok и ВКонтакте\n"
    "#ВернемСквадуЖизнь</b>"
)

PARTNERS = {
    "asahi": {
        "name": "Сай",
        "tiktok": "https://www.tiktok.com/@iruminaluu?_t=8lG9t4sGwlN&_r=1",
        "telegram": "https://t.me/twixtogram",
    },
    "wryushin": {
        "name": "Врюшин",
        "tiktok": "https://www.tiktok.com/@wryysn356?_t=8lG9pEcs8Jc&_r=1",
        "telegram": "https://t.me/wryysnscoffin",
    },
}


def default_state():
    return {
        "users": {},
        "feedback": [],
        "news": "Пока свежих объявлений нет. Следи за @THKC_SQUAD 👀",
        "maintenance": False,
        "admin_chat_id": None,
        "channel_subscribers": {},
        "channel_broadcast_enabled": True,
        "last_channel_post_id": None,
        "channel_blacklist": {},
        "xp_discussion_chat_id": None,
    }


def load_state():
    RUNTIME_DIR.mkdir(exist_ok=True)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    state = default_state()
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            state.update(loaded)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    state.setdefault("users", {})
    state.setdefault("feedback", [])
    state.setdefault("channel_subscribers", {})
    state.setdefault("channel_broadcast_enabled", True)
    state.setdefault("last_channel_post_id", None)
    return state


STATE = load_state()
STATE_LOCK = asyncio.Lock()


async def save_state():
    async with STATE_LOCK:
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_PATH)


def is_blacklist_channel(chat):
    return chat is not None and chat.type == "channel" and chat.id == BLACKLIST_CHANNEL_ID


CHANNEL_BLACKLIST = ChannelBlacklist(STATE, save_state, is_blacklist_channel, OWNER_USER_ID)


def bold_html(text):
    value = str(text).replace("<b>", "").replace("</b>", "")
    return f"<b>{value}</b>"

def is_admin_user(user):
    return user is not None and user.id == OWNER_USER_ID


async def track_user(user):
    if user is None:
        return
    user_id = str(user.id)
    now = int(time.time())
    previous = STATE["users"].get(user_id, {})
    first_seen = previous.get("first_seen") or previous.get("last_seen") or now
    STATE["users"][user_id] = {
        **previous,
        "username": user.username,
        "first_name": user.first_name,
        "first_seen": int(first_seen),
        "last_seen": now,
        "blocked": False,
    }
    STATE["users"][user_id].pop("blocked_at", None)
    await save_state()


def mark_user_unreachable(user_id):
    user_id = str(user_id)
    record = STATE["users"].setdefault(user_id, {})
    record["blocked"] = True
    record["blocked_at"] = int(time.time())
    STATE.get("channel_subscribers", {}).pop(user_id, None)


def user_stats_snapshot():
    now = int(time.time())
    result = {"new": 0, "active": 0, "inactive": 0, "blocked": 0}
    for record in STATE.get("users", {}).values():
        if record.get("blocked"):
            result["blocked"] += 1
            continue
        last_seen = int(record.get("last_seen") or 0)
        first_seen = int(record.get("first_seen") or last_seen or now)
        if now - first_seen <= 86400:
            result["new"] += 1
        if last_seen and now - last_seen <= 7 * 86400:
            result["active"] += 1
        else:
            result["inactive"] += 1
    return result


def fmt_uptime(seconds):
    seconds = int(max(0, seconds))
    days, seconds = divmod(seconds, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = []
    if days:
        parts.append(f"{days}д")
    if hours or days:
        parts.append(f"{hours}ч")
    if minutes or hours or days:
        parts.append(f"{minutes}м")
    parts.append(f"{seconds}с")
    return " ".join(parts)


def heartbeat_age():
    try:
        return max(0, int(time.time() - HEARTBEAT_PATH.stat().st_mtime))
    except OSError:
        return None


def status_text(user_id=None):
    age = heartbeat_age()
    hb = "нет данных" if age is None else f"{age} сек назад"
    personal = ""
    if user_id is not None:
        personal = f"🔔 Рассылка ТГК: {'ВКЛ' if channel_is_subscribed(user_id) else 'ВЫКЛ'}\n"
    return (
        "<b>🟢 Статус FINYA HELPER</b>\n\n"
        "✅ Бот: работает\n"
        + personal
        + f"⏱ Аптайм: {fmt_uptime(time.time() - BOT_STARTED_AT)}\n"
        + f"💓 Heartbeat: {hb}\n"
        + f"🖥 Сервер: <code>{html.escape(socket.gethostname())}</code>\n"
        + f"🐍 Python: <code>{platform.python_version()}</code>\n"
        + f"📦 Версия бота: <code>{BOT_VERSION}</code>"
    )


def partner_keyboard(partner):
    return InlineKeyboardMarkup([
        [menu_button("✨ TikTok", url=partner["tiktok"]),
         menu_button("💠 ТГК", url=partner["telegram"])],
        [menu_button("⬅️ Назад в Инфо", callback_data="info")],
    ])


def home_keyboard():
    return InlineKeyboardMarkup([
        [
            menu_button("ℹ️ Инфо", callback_data="info"),
            InlineKeyboardButton("📢 Новости", callback_data="news"),
        ],
        [
            InlineKeyboardButton("🟢 Статус", callback_data="status"),
            InlineKeyboardButton("💬 Обратная связь", callback_data="feedback"),
        ],
        [InlineKeyboardButton("Мой ранг", callback_data="xp:profile"),
         InlineKeyboardButton("Топ участников", callback_data="xp:top")],
        [menu_button("👤 ЛС Владельца", url="https://t.me/THKC_SQUAD_CREATOR")],
    ])


def back_home_keyboard():
    return InlineKeyboardMarkup([[menu_button("⬅️ Главное меню", callback_data="home")]])


def channel_is_subscribed(user_id):
    return bool(STATE.get("channel_subscribers", {}).get(str(user_id)))


def status_keyboard(user_id):
    subscribed = channel_is_subscribed(user_id)
    toggle = InlineKeyboardButton(
        "Выключить рассылку" if subscribed else "Включить рассылку",
        callback_data="status:unsubscribe" if subscribed else "status:subscribe",
        icon_custom_emoji_id="5409003906170651374" if subscribed else "5408901642999335517",
    )
    rows = [[toggle]]
    if subscribed and STATE.get("last_channel_post_id"):
        rows.append([InlineKeyboardButton("Последний пост", callback_data="channel:last", icon_custom_emoji_id="5411614357228390551")])
    rows.append([menu_button("⬅️ Главное меню", callback_data="home")])
    return InlineKeyboardMarkup(rows)


async def channel_news_view(context):
    try:
        chat = await context.bot.get_chat(f"@{SQUAD_CHANNEL_USERNAME}")
        pinned = getattr(chat, "pinned_message", None)
        if pinned:
            body = (pinned.text or pinned.caption or "Закреплённый медиа-пост без текста.").strip()
            if len(body) > 2800:
                body = body[:2797] + "..."
            return (
                f"<b>📌 Закреплённый пост @THKC_SQUAD</b>\n\n{html.escape(body)}",
                InlineKeyboardMarkup([
                    [InlineKeyboardButton("Открыть закреп", url=f"{SQUAD_CHANNEL_URL}/{pinned.message_id}", icon_custom_emoji_id="5411614357228390551")],
                    [menu_button("⬅️ Главное меню", callback_data="home")],
                ]),
            )
    except Exception as exc:
        logging.getLogger(__name__).warning("Could not load pinned channel post: %s", exc)
    news = html.escape(str(STATE.get("news") or "Пока новостей нет."))
    return (
        f"<b>📢 Новости / объявления</b>\n\n{news}",
        InlineKeyboardMarkup([
            [InlineKeyboardButton("Открыть канал", url=SQUAD_CHANNEL_URL, icon_custom_emoji_id="5411527152212411235")],
            [menu_button("⬅️ Главное меню", callback_data="home")],
        ]),
    )


def channel_subscription_text(user_id):
    if channel_is_subscribed(user_id):
        return (
            "🔔 <b>Рассылка T.N.K.C SQUAD включена</b>\n\n"
            "Новые посты из @THKC_SQUAD будут автоматически приходить тебе сюда в личку."
        )
    return (
        "🔕 <b>Рассылка T.N.K.C SQUAD выключена</b>\n\n"
        "Подпишись, и новые посты из @THKC_SQUAD будут автоматически приходить тебе сюда в личку."
    )


def channel_subscription_keyboard(user_id):
    if channel_is_subscribed(user_id):
        toggle = InlineKeyboardButton("Отписаться", callback_data="channel:unsubscribe", icon_custom_emoji_id="5409003906170651374")
    else:
        toggle = InlineKeyboardButton("Подписаться", callback_data="channel:subscribe", icon_custom_emoji_id="5408901642999335517")
    return InlineKeyboardMarkup([
        [toggle],
        [InlineKeyboardButton("Открыть T.N.K.C SQUAD", url=SQUAD_CHANNEL_URL, icon_custom_emoji_id="5411527152212411235")],
        [menu_button("⬅️ Главное меню", callback_data="home")],
    ])


def info_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Сквад", callback_data="squad",
                              icon_custom_emoji_id=SQUAD_ICON_ID)],
        *[[menu_button(f"🤝 {PARTNERS[key]['name']}", callback_data=f"partner:{key}")]
          for key in ("asahi", "wryushin")],
        [menu_button("⬅️ Главное меню", callback_data="home")],
    ])


def squad_keyboard():
    def link(label, url):
        if label.startswith("💠 "):
            return InlineKeyboardButton(label[2:], url=url,
                                        icon_custom_emoji_id=SQUAD_ICON_ID)
        return menu_button(label, url=url)

    return InlineKeyboardMarkup([
        [link("💠 Инфо о Скваде", "https://t.me/THKC_SQUAD/1449")],
        [link("📜 Правила беседы", "https://teletype.in/@creatorsworld/chat_rules")],
        [link("💠 Папка T.N.K.C SQUAD", "https://t.me/addlist/Nw_CFrN-wzQ1MThi")],
        [link("🔥 Красный Сквад", "https://t.me/addtheme/SQUADTHEME"),
         link("🟢 Зелёный Сквад", "https://t.me/addtheme/SQUADGREEN")],
        [link("🙂 Стикеры ТГК V2", "https://t.me/addstickers/SquadCorporation")],
        [link("🎁 Вишлист / желания", "https://t.me/wishapp/wishlist?startapp=-w15874613")],
        [link("⌨️ Анонимные вопросы", "http://t.me/anonaskbot?start=r5z6k1ge4zcjbdzb")],
        [link("👤 Владелец · TikTok", "https://www.tiktok.com/@tnkc_squad_corporation?_t=ZS-8xtQVu6AMBl&_r=1"),
         link("👤 Владелец · Discord", "https://discord.gg/dCgQvVeJzs")],
        [link("👤 Владелец · VK", "https://vk.com/creator_this_world"),
         link("👤 Владелец · Twitch", "https://www.twitch.tv/tnkc_squad_creator")],
        [link("🏦 Приглашение Т-Банк", "https://tbank.ru/baf/AwvoxOcQ5Ee")],
        [link("💠 Буст канала", "https://t.me/boost?c=1192817776")],
        [menu_button("⬅️ Назад в Инфо", callback_data="info")],
    ])


# Icons from HowDidYouDoThis, materialexpressive and UnigramIcons.
ADMIN_BUTTON_ICONS = {
    "xp": "5870930636742595124",
    "stats": "5870930636742595124",
    "status": "5346022209389372742",
    "feedback": "5870755659774955152",
    "news": "5870687545888607770",
    "broadcast": "5870886806601338791",
    "channel": "5411335287433364660",
    "maintenance": "5438513664388803768",
    "logs": "5870450390679425417",
    "restart": "5870892901159932239",
    "blacklist": "5438513664388803768",
}


def admin_button(text, action):
    return InlineKeyboardButton(
        text, callback_data=f"admin:{action}",
        icon_custom_emoji_id=ADMIN_BUTTON_ICONS[action],
    )


def admin_keyboard():
    maintenance = "Техработы: ВКЛ" if STATE.get("maintenance") else "Техработы: ВЫКЛ"
    channel_mode = "Авто ТГК: ВКЛ" if STATE.get("channel_broadcast_enabled", True) else "Авто ТГК: ВЫКЛ"
    return InlineKeyboardMarkup([
        [admin_button("Статистика", "stats"), admin_button("Статус", "status")],
        [admin_button("Фидбек", "feedback"), admin_button("Новость", "news")],
        [admin_button("Рассылка", "broadcast")],
        [admin_button(channel_mode, "channel")],
        [admin_button("Чёрный список", "blacklist")],
        [admin_button("Активность / XP", "xp")],
        [admin_button(maintenance, "maintenance")],
        [admin_button("Логи", "logs"), admin_button("Перезапуск", "restart")],
    ])


async def show_blacklist(query, context, page=0):
    # The list contains personal information and belongs in the owner's private chat.
    if not is_admin_user(query.from_user) or query.message.chat.type != "private":
        return
    context.user_data.pop("admin_action", None)
    records = [r for r in STATE.get("channel_blacklist", {}).values()
               if r["chat_id"] == BLACKLIST_CHANNEL_ID]
    records.sort(key=lambda r: (r["left_at"], r["user_id"]), reverse=True)
    page_size = 5
    pages = max(1, (len(records) + page_size - 1) // page_size)
    page = max(0, min(page, pages - 1))
    banned = sum(r["status"] == "banned" for r in records)
    channel_label = "@THKC_SQUAD" if BLACKLIST_CHANNEL_ID == -1001192817776 else str(BLACKLIST_CHANNEL_ID)
    text = (f"Чёрный список канала {channel_label}\n\n"
            f"Записей: {len(records)} · Бан подтверждён: {banned}\n"
            f"Ожидают / ошибка: {len(records) - banned}\n")
    try:
        member = await context.bot.get_chat_member(BLACKLIST_CHANNEL_ID, context.bot.id)
        ready = member.status == "administrator" and member.can_restrict_members
        text += ("Автобан: включён\n" if ready else
                 "Автобан: нужны права администратора на блокировку участников\n")
    except TelegramError:
        text += "Автобан: не удалось проверить права в Telegram\n"
    text += "\nПричина: самостоятельный выход из канала.\n"
    if not records:
        text += "\nПока список пуст. Здесь появятся новые выходы после включения функции."
    statuses = {"banned": "Заблокирован", "pending": "Ожидает блокировки",
                "failed": "Бан не выполнен"}
    for index, record in enumerate(records[page * page_size:(page + 1) * page_size], page * page_size + 1):
        name = html.escape(str(record.get("full_name") or record["user_id"])[:100])
        username = record.get("username")
        label = f" @{html.escape(str(username)[:40])}" if username else ""
        date = datetime.fromtimestamp(record["left_at"], timezone(timedelta(hours=3)))
        text += (f"\n{index}. {name}{label}\nID: {record['user_id']}\n"
                 f"Выход: {date:%d.%m.%Y %H:%M} МСК\n"
                 f"Статус: {statuses.get(record['status'], 'Неизвестен')}\n")
        if record.get("last_error"):
            text += f"Причина ошибки: {html.escape(str(record['last_error'])[:100])}\n"
    text += f"\nСтраница {page + 1} из {pages}"
    navigation = []
    if page > 0:
        navigation.append(InlineKeyboardButton("Назад", callback_data=f"admin:blacklist:{page - 1}"))
    if page + 1 < pages:
        navigation.append(InlineKeyboardButton("Далее", callback_data=f"admin:blacklist:{page + 1}"))
    rows = [navigation] if navigation else []
    rows.append([InlineKeyboardButton("Обновить", callback_data=f"admin:blacklist:{page}")])
    rows.append([menu_button("⬅️ Админ-панель", callback_data="admin:menu")])
    try:
        await query.edit_message_text(text=bold_html(text), parse_mode="HTML",
                                      reply_markup=InlineKeyboardMarkup(rows))
    except BadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


async def blacklist_retry_loop(application):
    while True:
        try:
            await CHANNEL_BLACKLIST.retry_pending(application.bot)
        except Exception:
            logging.getLogger(__name__).exception("Could not retry pending channel bans")
        await asyncio.sleep(30)


async def heartbeat_loop(application: Application):
    RUNTIME_DIR.mkdir(exist_ok=True)
    while True:
        try:
            # Heartbeat now proves that Telegram itself is reachable, not just
            # that the Python process is alive. If Telegram networking stays
            # broken, watchdog.py will see a stale heartbeat and restart us.
            await application.bot.get_me()
            HEARTBEAT_PATH.write_text(str(time.time()), encoding="utf-8")
        except Exception as exc:
            logging.getLogger(__name__).warning("Telegram heartbeat failed: %s", exc)
        await asyncio.sleep(30)


async def post_init(application: Application):
    logging.getLogger(__name__).info("Channel blacklist enabled for %s; state: %s",
                                     BLACKLIST_CHANNEL_ID, STATE_PATH)
    application.bot_data["activity_xp"] = ActivityXP(STATE_DIR / "xp.sqlite3")
    try:
        await resolve_xp_chat(application.bot, application.bot_data)
    except TelegramError:
        logging.getLogger(__name__).warning("XP discussion group not available at startup")
    application.bot_data["background_tasks"] = [
        asyncio.create_task(heartbeat_loop(application), name="heartbeat"),
        asyncio.create_task(blacklist_retry_loop(application), name="blacklist-retry"),
    ]
    application.bot_data["background_tasks"].append(
        asyncio.create_task(xp_discovery_loop(application), name="xp-discussion")
    )


async def post_stop(application: Application):
    tasks = application.bot_data.pop("background_tasks", [])
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    activity = application.bot_data.pop("activity_xp", None)
    if activity is not None:
        activity.close()


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logging.getLogger(__name__).exception("Unhandled bot error", exc_info=context.error)


def xp_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Мой ранг", callback_data="xp:profile")],
        [InlineKeyboardButton("За всё время", callback_data="xp:top"),
         InlineKeyboardButton("За неделю", callback_data="xp:week")],
        [InlineKeyboardButton("Звания и правила XP", callback_data="xp:rules")],
        [menu_button("⬅️ Главное меню", callback_data="home")],
    ])


def xp_profile_text(user, context):
    profile = context.bot_data["activity_xp"].profile(user)
    current, following = rank_for(profile["xp"], founder=user.id == OWNER_USER_ID)
    progress = (
        f"До {following[2]}: {following[0] - profile['xp']} XP"
        if following else "Высшее звание достигнуто."
    )
    return (
        f"Мой ранг · T.N.K.C SQUAD\n\n{html.escape(user.full_name[:100])}\n"
        f"{current[1]} · {current[2]}\n\n"
        f"Всего: {profile['xp']} XP\nЗа неделю: {profile['week']} XP\n"
        f"Сегодня: {profile['today']} / {DAILY_XP_LIMIT} XP\n\n{progress}\n\n"
        "Комментарий: +5 XP · Реакция: +1 XP\n"
        "Учитываются обсуждения постов Сквада."
    )


def xp_top_text(context, *, weekly=False):
    rows = context.bot_data["activity_xp"].leaderboard(weekly=weekly)
    text = "Топ Сквада · " + ("текущая неделя (МСК)" if weekly else "за всё время")
    if not rows:
        return text + "\n\nПока никто не заработал XP. Начни с комментария под постом."
    for number, row in enumerate(rows, 1):
        current, _ = rank_for(row["xp"], founder=row["user_id"] == OWNER_USER_ID)
        text += f"\n\n{number}. {html.escape(row['name'][:35])} — {row['score']} XP\n{current[1]} · {current[2]}"
    return text


def xp_rules_text():
    ranks = "\n".join(f"{roman} · {name} — от {points} XP" for points, roman, name in RANKS)
    return (
        "Звания Сквада\n\n" + ranks + "\nX · Основатель SQUAD — только владелец\n\n"
        "+5 XP за комментарий под постом: минимум 5 букв/цифр, не чаще раза в минуту.\n"
        "+1 XP за личную реакцию в обсуждениях: один раз на сообщение, до 20 в день.\n"
        "Смена эмодзи, снятие и повторная установка не дают новых XP. Снятие реакции не вычитает XP.\n"
        "Реакции на свои комментарии, пересланные сообщения, команды, стикеры и сообщения от имени канала не учитываются.\n"
        "Общий лимит: 100 XP в день, по Москве. Неделя начинается в понедельник.\n"
        "Анонимные реакции самого канала не учитываются. Учёт начинается после подключения Фини; прошлый актив не восстанавливается.\n"
        "Звание видно в Фине и не выдаёт права администратора."
    )


def xp_source_channel_id():
    return int(SQUAD_CHANNEL_ID or -1001192817776)


def xp_explicit_chat_id():
    raw = os.environ.get("XP_DISCUSSION_CHAT_ID", "").strip()
    value = int(raw) if raw else STATE.get("xp_discussion_chat_id")
    if value is not None and (not isinstance(value, int) or value >= 0):
        raise ValueError("XP_DISCUSSION_CHAT_ID must be a negative Telegram group ID")
    return value


async def resolve_xp_chat(bot, bot_data):
    explicit = xp_explicit_chat_id()
    if explicit:
        bot_data["xp_chat_id"] = explicit
        return explicit
    chat = await bot.get_chat(xp_source_channel_id())
    linked = getattr(chat, "linked_chat_id", None)
    bot_data["xp_chat_id"] = linked
    return linked


async def xp_discovery_loop(application):
    while True:
        await asyncio.sleep(300)
        try:
            await resolve_xp_chat(application.bot, application.bot_data)
        except Exception:
            logging.getLogger(__name__).exception("Could not discover XP discussion group")


async def xp_setup_text(context):
    try:
        chat_id = await resolve_xp_chat(context.bot, context.bot_data)
        if not chat_id:
            status = "Группа обсуждений не найдена. Привяжи её к каналу или отправь /xpchat в нужной группе."
        else:
            member = await context.bot.get_chat_member(chat_id, context.bot.id)
            ready = member.status in {"administrator", "creator"}
            status = (f"Группа: {chat_id}\nУчёт подключён." if ready else
                      f"Группа: {chat_id}\nДля учёта назначь Финю администратором этой группы.")
    except TelegramError:
        status = "Не удалось проверить группу. Добавь Финю администратором обсуждений и отправь там /xpchat от своего аккаунта."
    return (
        "Активность / XP\n\n" + status + "\n\n"
        "Комментарий: +5 XP, пауза 60 секунд, минимум 5 букв/цифр.\n"
        "Реакция: +1 XP, максимум 20 в день, один раз на сообщение.\n"
        "Общий лимит: 100 XP в день.\n\n"
        "Настройка: /xpchat в группе — подключить; /xpchat auto — вернуться к группе канала.\n"
        "XP сохраняется рядом с состоянием бота. На Railway нужен постоянный Volume."
    )


async def xp_chat_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin_user(update.effective_user):
        return
    message = update.message
    if os.environ.get("XP_DISCUSSION_CHAT_ID", "").strip():
        await message.reply_text("Группа XP задана переменной XP_DISCUSSION_CHAT_ID. Измени её в настройках сервера.")
        return
    if context.args == ["auto"]:
        STATE["xp_discussion_chat_id"] = None
        context.bot_data.pop("xp_chat_id", None)
        await save_state()
        await message.reply_text("Включено автоматическое определение обсуждений канала. Проверка: /admin → Активность / XP.")
        return
    if context.args or update.effective_chat.type not in {"group", "supergroup"}:
        await message.reply_text("Отправь /xpchat в группе обсуждений, где Финя назначена администратором.")
        return
    member = await context.bot.get_chat_member(update.effective_chat.id, context.bot.id)
    if member.status not in {"administrator", "creator"}:
        await message.reply_text("Сначала назначь Финю администратором этой группы, затем повтори /xpchat.")
        return
    STATE["xp_discussion_chat_id"] = update.effective_chat.id
    await save_state()
    context.bot_data["xp_chat_id"] = update.effective_chat.id
    await message.reply_text("Учёт XP подключён. +5 за комментарий, +1 за реакцию в обсуждениях постов @THKC_SQUAD. Профиль: /rank, рейтинг: /top.")


async def rank_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type == "private":
        await track_user(update.effective_user)
    await update.message.reply_text(bold_html(xp_profile_text(update.effective_user, context)),
                                    parse_mode="HTML", reply_markup=xp_keyboard())


async def top_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type == "private":
        await track_user(update.effective_user)
    weekly = bool(context.args and context.args[0].lower() in {"week", "неделя"})
    await update.message.reply_text(bold_html(xp_top_text(context, weekly=weekly)),
                                    parse_mode="HTML", reply_markup=xp_keyboard())


async def notify_xp_promotion(user, award, context):
    if not award or not award.promoted or user.id == OWNER_USER_ID:
        return
    # Do not try to initiate private chats with discussion-only participants.
    known = STATE.get("users", {}).get(str(user.id))
    if not known or known.get("blocked"):
        return
    try:
        await context.bot.send_message(
            chat_id=user.id,
            text=bold_html(f"Новое звание Сквада!\n\n{award.new_rank[1]} · {award.new_rank[2]}\nВсего: {award.total} XP"),
            parse_mode="HTML", reply_markup=xp_keyboard(),
        )
    except TelegramError:
        logging.getLogger(__name__).info("Could not deliver rank promotion to %s", user.id)


async def activity_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    if message is None or message.chat.type not in {"group", "supergroup"}:
        return
    chat_id = xp_explicit_chat_id() or context.bot_data.get("xp_chat_id")
    if not chat_id or message.chat.id != chat_id or STATE.get("maintenance"):
        return
    award = context.bot_data["activity_xp"].comment(message, xp_source_channel_id())
    if award:
        await notify_xp_promotion(message.from_user, award, context)


async def activity_reaction(update: Update, context: ContextTypes.DEFAULT_TYPE):
    event = update.message_reaction
    if event is None or event.chat.type not in {"group", "supergroup"}:
        return
    chat_id = xp_explicit_chat_id() or context.bot_data.get("xp_chat_id")
    if not chat_id or event.chat.id != chat_id or STATE.get("maintenance"):
        return
    award = context.bot_data["activity_xp"].reaction(event)
    if award:
        await notify_xp_promotion(event.user, award, context)


async def edit_or_send(query, text, keyboard=None):
    text = bold_html(text)
    try:
        if query.message.photo and len(text) <= 1024:
            await query.edit_message_caption(caption=text, parse_mode="HTML", reply_markup=keyboard)
        elif query.message.photo:
            await query.message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)
        else:
            await query.edit_message_text(text=text, parse_mode="HTML", reply_markup=keyboard)
    except BadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    returning = str(update.effective_user.id) in STATE.get("users", {})
    await track_user(update.effective_user)
    if STATE.get("maintenance") and not is_admin_user(update.effective_user):
        await update.message.reply_text(
            bold_html("🛠 Бот временно на техработах.\nПопробуй чуть позже."),
            parse_mode="HTML",
        )
        return
    caption = (
        "<b>С возвращением. FINYA HELPER на месте. Выбирай раздел:</b>"
        if returning else HOME_TEXT
    )
    await update.message.reply_photo(
        photo=PHOTO_PATH,
        caption=caption,
        parse_mode="HTML",
        reply_markup=home_keyboard(),
    )


async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    if not is_admin_user(update.effective_user):
        return
    STATE["admin_chat_id"] = OWNER_USER_ID
    await save_state()
    await update.message.reply_text(
        bold_html("🛠 Админ-панель FINYA HELPER\n\nУправление ботом:"),
        parse_mode="HTML",
        reply_markup=admin_keyboard(),
    )


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if update.effective_chat.type == "private":
        await track_user(update.effective_user)

    if STATE.get("maintenance") and not is_admin_user(update.effective_user) and query.data != "home":
        await edit_or_send(query, "🛠 <b>Бот временно на техработах.</b>", back_home_keyboard())
        return

    if query.data and query.data.startswith("xp:"):
        context.user_data.pop("awaiting_feedback", None)
        context.user_data.pop("admin_action", None)

    if query.data == "info":
        text, keyboard = INFO_TEXT, info_keyboard()
    elif query.data == "squad":
        text, keyboard = SQUAD_TEXT, squad_keyboard()
    elif query.data == "home":
        text, keyboard = HOME_TEXT, home_keyboard()
    elif query.data == "news":
        text, keyboard = await channel_news_view(context)
    elif query.data == "status":
        text, keyboard = status_text(update.effective_user.id), status_keyboard(update.effective_user.id)
    elif query.data == "xp:profile":
        text, keyboard = xp_profile_text(update.effective_user, context), xp_keyboard()
    elif query.data in {"xp:top", "xp:week"}:
        weekly = query.data == "xp:week"
        text, keyboard = xp_top_text(context, weekly=weekly), xp_keyboard()
    elif query.data == "xp:rules":
        text, keyboard = xp_rules_text(), xp_keyboard()
    elif query.data == "status:subscribe":
        STATE["channel_subscribers"][str(update.effective_user.id)] = True
        await save_state()
        text, keyboard = status_text(update.effective_user.id), status_keyboard(update.effective_user.id)
    elif query.data == "status:unsubscribe":
        STATE["channel_subscribers"].pop(str(update.effective_user.id), None)
        await save_state()
        text, keyboard = status_text(update.effective_user.id), status_keyboard(update.effective_user.id)
    elif query.data == "channel_notify":
        text = channel_subscription_text(update.effective_user.id)
        keyboard = channel_subscription_keyboard(update.effective_user.id)
    elif query.data == "channel:subscribe":
        STATE["channel_subscribers"][str(update.effective_user.id)] = True
        await save_state()
        text = "✅ <b>Готово. Рассылка T.N.K.C SQUAD включена.</b>\n\nНовые посты будут приходить сюда автоматически."
        keyboard = channel_subscription_keyboard(update.effective_user.id)
    elif query.data == "channel:unsubscribe":
        STATE["channel_subscribers"].pop(str(update.effective_user.id), None)
        await save_state()
        text = "🔕 <b>Рассылка T.N.K.C SQUAD выключена.</b>"
        keyboard = channel_subscription_keyboard(update.effective_user.id)
    elif query.data == "channel:last":
        last_post_id = STATE.get("last_channel_post_id")
        if not last_post_id:
            await query.answer("Последний пост пока не сохранён.", show_alert=True)
            return
        try:
            await context.bot.copy_message(
                chat_id=update.effective_user.id,
                from_chat_id=f"@{SQUAD_CHANNEL_USERNAME}",
                message_id=int(last_post_id),
            )
        except Exception as exc:
            logging.getLogger(__name__).warning("Could not send last channel post: %s", exc)
            await query.answer("Не получилось получить последний пост.", show_alert=True)
        return
    elif query.data == "feedback":
        context.user_data["awaiting_feedback"] = True
        text = (
            "<b>💬 Обратная связь</b>\n\n"
            "Напиши следующим сообщением проблему, идею или предложение.\n"
            "Я передам это владельцу."
        )
        keyboard = back_home_keyboard()
    elif query.data and query.data.startswith("partner:"):
        partner = PARTNERS.get(query.data.split(":", 1)[1])
        if partner is None:
            text, keyboard = INFO_TEXT, info_keyboard()
        else:
            text = f"<b>🤝 {partner['name']}\n\nПартнёр Сквада\nВыбери соцсеть:</b>"
            keyboard = partner_keyboard(partner)
    elif query.data and query.data.startswith("admin:"):
        if not is_admin_user(update.effective_user):
            return
        await handle_admin_callback(query, context, query.data.split(":", 1)[1])
        return
    else:
        return

    await edit_or_send(query, text, keyboard)


async def handle_admin_callback(query, context, action):
    if not is_admin_user(query.from_user):
        return
    if action == "xp":
        if query.message.chat.type != "private":
            return
        context.user_data.pop("admin_action", None)
        text = await xp_setup_text(context)
        await edit_or_send(query, text, InlineKeyboardMarkup([
            [InlineKeyboardButton("Обновить", callback_data="admin:xp")],
            [menu_button("⬅️ Админ-панель", callback_data="admin:menu")],
        ]))
        return
    if action == "blacklist" or action.startswith("blacklist:"):
        try:
            page = int(action.split(":", 1)[1]) if ":" in action else 0
        except ValueError:
            return
        await show_blacklist(query, context, page)
        return
    if action == "menu":
        text = "Админ-панель FINYA HELPER\n\nУправление ботом:"
    elif action == "stats":
        roles = user_stats_snapshot()
        text = (
            "<b>📊 Статистика</b>\n\n"
            f"👥 Пользователей: <b>{len(STATE['users'])}</b>\n"
            f"🆕 Новые за 24ч: <b>{roles['new']}</b>\n"
            f"⚡ Активные за 7д: <b>{roles['active']}</b>\n"
            f"💤 Неактивные: <b>{roles['inactive']}</b>\n"
            f"🚫 Недоступны / заблокировали: <b>{roles['blocked']}</b>\n"
            f"🔔 Подписчиков ТГК: <b>{sum(1 for v in STATE.get('channel_subscribers', {}).values() if v)}</b>\n"
            f"📬 Обращений: <b>{len(STATE['feedback'])}</b>\n"
            f"⏱ Аптайм: <b>{fmt_uptime(time.time() - BOT_STARTED_AT)}</b>"
        )
    elif action == "status":
        text = status_text(query.from_user.id)
    elif action == "feedback":
        items = STATE.get("feedback", [])[-5:]
        if not items:
            text = "<b>📬 Обратная связь</b>\n\nПока пусто."
        else:
            chunks = []
            for item in reversed(items):
                who = item.get("username") or item.get("first_name") or item.get("user_id")
                chunks.append(
                    f"<b>{html.escape(str(who))}</b>\n{html.escape(str(item.get('text', ''))[:700])}"
                )
            text = "<b>📬 Последние обращения</b>\n\n" + "\n\n────────\n\n".join(chunks)
    elif action == "news":
        context.user_data["admin_action"] = "set_news"
        text = "<b>📢 Новость</b>\n\nОтправь следующим сообщением новый текст объявления."
    elif action == "broadcast":
        context.user_data["admin_action"] = "broadcast"
        text = "<b>📣 Рассылка</b>\n\nОтправь следующим сообщением текст для всех пользователей бота."
    elif action == "channel":
        STATE["channel_broadcast_enabled"] = not bool(STATE.get("channel_broadcast_enabled", True))
        await save_state()
        mode = "включена" if STATE["channel_broadcast_enabled"] else "выключена"
        text = f"<b>🔔 Авторассылка постов ТГК {mode}.</b>"
    elif action == "maintenance":
        STATE["maintenance"] = not bool(STATE.get("maintenance"))
        await save_state()
        text = "<b>🛠 Режим техработ изменён.</b>"
    elif action == "logs":
        parts = []
        for name in ("error.log", "bot.log"):
            path = LOGS_DIR / name
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-12:]
                parts.append(f"<b>{name}</b>\n<pre>{html.escape(chr(10).join(lines))}</pre>")
            except OSError:
                parts.append(f"<b>{name}</b>\nнет данных")
        text = "\n\n".join(parts)
        if len(text) > 3900:
            text = text[-3900:]
    elif action == "restart":
        await query.edit_message_text("♻️ <b>Перезапускаюсь...</b>", parse_mode="HTML")
        await asyncio.sleep(1)
        os._exit(3)
    else:
        return

    await query.edit_message_text(text=bold_html(text), parse_mode="HTML", reply_markup=admin_keyboard())


def is_squad_channel(chat):
    if chat is None:
        return False
    if SQUAD_CHANNEL_ID:
        try:
            if chat.id == int(SQUAD_CHANNEL_ID):
                return True
        except ValueError:
            pass
    return (chat.username or "").lstrip("@").lower() == SQUAD_CHANNEL_USERNAME.lower()


async def channel_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.channel_post
    if message is None or not is_squad_channel(update.effective_chat):
        return

    if STATE.get("last_channel_post_id") != message.message_id:
        STATE["last_channel_post_id"] = message.message_id
        await save_state()

    if not STATE.get("channel_broadcast_enabled", True):
        return

    subscribers = [
        user_id
        for user_id, enabled in STATE.get("channel_subscribers", {}).items()
        if enabled
    ]
    if not subscribers:
        return

    username = (update.effective_chat.username or SQUAD_CHANNEL_USERNAME).lstrip("@")
    post_url = f"https://t.me/{username}/{message.message_id}"
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("Открыть пост в канале", url=post_url, icon_custom_emoji_id="5411527152212411235")]
    ])

    delivered = 0
    failed = 0
    stale = []
    for user_id in subscribers:
        try:
            await context.bot.copy_message(
                chat_id=int(user_id),
                from_chat_id=message.chat_id,
                message_id=message.message_id,
                reply_markup=keyboard,
            )
            delivered += 1
        except RetryAfter as exc:
            retry_after = exc.retry_after
            delay = retry_after.total_seconds() if hasattr(retry_after, "total_seconds") else float(retry_after)
            await asyncio.sleep(delay + 0.2)
            try:
                await context.bot.copy_message(
                    chat_id=int(user_id),
                    from_chat_id=message.chat_id,
                    message_id=message.message_id,
                    reply_markup=keyboard,
                )
                delivered += 1
            except Exception:
                failed += 1
        except Forbidden:
            stale.append(user_id)
            failed += 1
        except BadRequest as exc:
            if "chat not found" in str(exc).lower() or "user is deactivated" in str(exc).lower():
                stale.append(user_id)
            failed += 1
        except Exception:
            logging.getLogger(__name__).exception(
                "Channel post delivery failed for user %s", user_id
            )
            failed += 1
        await asyncio.sleep(0.04)

    if stale:
        for user_id in stale:
            mark_user_unreachable(user_id)
        await save_state()

    logging.getLogger(__name__).info(
        "Channel post %s distributed: delivered=%s failed=%s subscribers=%s",
        message.message_id,
        delivered,
        failed,
        len(subscribers),
    )


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    text = (update.message.text or "").strip()
    if not text:
        return

    if is_admin_user(update.effective_user) and context.user_data.get("admin_action"):
        action = context.user_data.pop("admin_action")
        if action == "set_news":
            STATE["news"] = text[:3500]
            await save_state()
            await update.message.reply_text(bold_html("✅ Новость обновлена."), parse_mode="HTML", reply_markup=admin_keyboard())
            return
        if action == "broadcast":
            ok = 0
            failed = 0
            state_changed = False
            for user_id in list(STATE.get("users", {}).keys()):
                try:
                    await context.bot.send_message(chat_id=int(user_id), text=bold_html(html.escape(text)), parse_mode="HTML")
                    ok += 1
                except Forbidden:
                    mark_user_unreachable(user_id)
                    state_changed = True
                    failed += 1
                except BadRequest as exc:
                    if "chat not found" in str(exc).lower() or "user is deactivated" in str(exc).lower():
                        mark_user_unreachable(user_id)
                        state_changed = True
                    failed += 1
                except Exception:
                    failed += 1
                await asyncio.sleep(0.04)
            if state_changed:
                await save_state()
            await update.message.reply_text(
                bold_html(f"✅ Рассылка завершена.\nДоставлено: {ok}\nОшибок: {failed}"),
                parse_mode="HTML",
                reply_markup=admin_keyboard(),
            )
            return

    if context.user_data.pop("awaiting_feedback", False):
        user = update.effective_user
        item = {
            "user_id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "text": text[:3000],
            "time": int(time.time()),
        }
        STATE["feedback"].append(item)
        STATE["feedback"] = STATE["feedback"][-200:]
        await save_state()
        await update.message.reply_text(bold_html("✅ Отправлено владельцу. Спасибо ❤️"), parse_mode="HTML")

        admin_chat_id = OWNER_USER_ID
        if admin_chat_id:
            who = f"@{user.username}" if user.username else f"{user.first_name} ({user.id})"
            try:
                await context.bot.send_message(
                    chat_id=int(admin_chat_id),
                    text=bold_html(f"📬 Новый фидбек от {html.escape(str(who))}:\n\n{html.escape(text[:3500])}"),
                    parse_mode="HTML",
                )
            except Exception:
                pass
        return

def main():
    # Each launch needs its own loop: run_polling closes it on shutdown.
    # Python 3.14 also requires an explicitly configured event loop.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        _run_bot()
    finally:
        if not loop.is_closed():
            loop.close()
        asyncio.set_event_loop(None)


def _run_bot():
    app = (
        Application.builder()
        .token(TOKEN)
        .connect_timeout(20)
        .read_timeout(30)
        .write_timeout(30)
        .get_updates_connect_timeout(20)
        .get_updates_read_timeout(40)
        .post_init(post_init)
        .post_stop(post_stop)
        .post_shutdown(post_stop)
        .build()
    )

    # A separate handler group observes discussion messages without stealing
    # commands or private conversations from the existing bot handlers.
    app.add_handler(MessageHandler(filters.ChatType.GROUPS & filters.UpdateType.MESSAGE,
                                   activity_message), group=-1)
    app.add_handler(MessageReactionHandler(
        activity_reaction, message_reaction_types=MessageReactionHandler.MESSAGE_REACTION_UPDATED,
    ), group=-1)
    app.add_handler(CommandHandler("rank", rank_command))
    app.add_handler(CommandHandler("top", top_command))
    app.add_handler(CommandHandler("xpchat", xp_chat_command))
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(ChatMemberHandler(CHANNEL_BLACKLIST.handle_update, ChatMemberHandler.CHAT_MEMBER))
    app.add_handler(MessageHandler(filters.ChatType.CHANNEL, channel_post))
    app.add_handler(MessageHandler(filters.ChatType.PRIVATE & filters.TEXT & ~filters.COMMAND, text_message))
    app.add_error_handler(error_handler)

    print("FINYA HELPER запущен.")
    app.run_polling(
        bootstrap_retries=-1,
        poll_interval=0.5,
        timeout=30,
        drop_pending_updates=False,
        allowed_updates=["message", "callback_query", "channel_post", "chat_member", "message_reaction"],
    )


if __name__ == "__main__":
    main()
