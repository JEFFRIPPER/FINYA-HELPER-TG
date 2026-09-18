import asyncio
import html
import json
import logging
import os
import platform
import socket
import time
from pathlib import Path

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from ai_service import ai_config_status, generate_reply, transcribe_audio

ROOT = Path(__file__).resolve().parent
PHOTO_PATH = str(ROOT / "info.jpg")
RUNTIME_DIR = ROOT / "runtime"
HEARTBEAT_PATH = RUNTIME_DIR / "heartbeat.txt"
STATE_PATH = RUNTIME_DIR / "state.json"
LOGS_DIR = ROOT / "logs"
BOT_STARTED_AT = time.time()
BOT_VERSION = "2.0"


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
    "red_may": {
        "name": "Красный Май",
        "tiktok": "https://www.tiktok.com/@remchik_13?_r=1&_t=ZS-98riJx5qMRV",
        "telegram": "https://t.me/urbanriot",
    },
}


def default_state():
    return {
        "users": {},
        "feedback": [],
        "news": "Пока свежих объявлений нет. Следи за @THKC_SQUAD 👀",
        "maintenance": False,
        "admin_chat_id": None,
        "ai_enabled": {},
        "ai_memory": {},
    }


def load_state():
    RUNTIME_DIR.mkdir(exist_ok=True)
    state = default_state()
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            state.update(loaded)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    state.setdefault("users", {})
    state.setdefault("feedback", [])
    state.setdefault("ai_enabled", {})
    state.setdefault("ai_memory", {})
    return state


STATE = load_state()
STATE_LOCK = asyncio.Lock()


async def save_state():
    async with STATE_LOCK:
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_PATH)


def bold_html(text):
    value = str(text).replace("<b>", "").replace("</b>", "")
    return f"<b>{value}</b>"

def is_admin_user(user):
    return user is not None and user.id == OWNER_USER_ID


async def track_user(user):
    if user is None:
        return
    STATE["users"][str(user.id)] = {
        "username": user.username,
        "first_name": user.first_name,
        "last_seen": int(time.time()),
    }
    await save_state()


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


def status_text():
    age = heartbeat_age()
    hb = "нет данных" if age is None else f"{age} сек назад"
    cfg = ai_config_status()
    providers = []
    if cfg["openrouter"]:
        providers.append("OpenRouter")
    if cfg["groq"]:
        providers.append("Groq")
    ai_state = " + ".join(providers) if providers else "ожидает API-ключ"
    return (
        "<b>🟢 Статус FINYA HELPER</b>\n\n"
        "✅ Бот: работает\n"
        f"🤖 FINYA AI: {ai_state}\n"
        f"⏱ Аптайм: {fmt_uptime(time.time() - BOT_STARTED_AT)}\n"
        f"💓 Heartbeat: {hb}\n"
        f"🖥 Сервер: <code>{html.escape(socket.gethostname())}</code>\n"
        f"🐍 Python: <code>{platform.python_version()}</code>\n"
        f"📦 Версия бота: <code>{BOT_VERSION}</code>"
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
        [InlineKeyboardButton("🤖 ФИНЯ AI", callback_data="ai")],
        [menu_button("👤 ЛС Владельца", url="https://t.me/THKC_SQUAD_CREATOR")],
    ])


def back_home_keyboard():
    return InlineKeyboardMarkup([[menu_button("⬅️ Главное меню", callback_data="home")]])


def ai_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🧹 Очистить память", callback_data="ai:reset")],
        [InlineKeyboardButton("⏹ Выключить AI", callback_data="ai:off")],
        [menu_button("⬅️ Главное меню", callback_data="home")],
    ])


def ai_is_enabled(user_id):
    return bool(STATE.get("ai_enabled", {}).get(str(user_id)))


def info_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Сквад", callback_data="squad",
                              icon_custom_emoji_id=SQUAD_ICON_ID)],
        *[[menu_button(f"🤝 {PARTNERS[key]['name']}", callback_data=f"partner:{key}")]
          for key in ("red_may", "asahi", "wryushin")],
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
    "stats": "5870930636742595124",
    "status": "5346022209389372742",
    "feedback": "5870755659774955152",
    "news": "5870687545888607770",
    "broadcast": "5870886806601338791",
    "maintenance": "5438513664388803768",
    "logs": "5870450390679425417",
    "restart": "5870892901159932239",
}


def admin_button(text, action):
    return InlineKeyboardButton(
        text, callback_data=f"admin:{action}",
        icon_custom_emoji_id=ADMIN_BUTTON_ICONS[action],
    )


def admin_keyboard():
    maintenance = "Техработы: ВКЛ" if STATE.get("maintenance") else "Техработы: ВЫКЛ"
    return InlineKeyboardMarkup([
        [admin_button("Статистика", "stats"), admin_button("Статус", "status")],
        [admin_button("Фидбек", "feedback"), admin_button("Новость", "news")],
        [admin_button("Рассылка", "broadcast")],
        [admin_button(maintenance, "maintenance")],
        [admin_button("Логи", "logs"), admin_button("Перезапуск", "restart")],
    ])


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
    asyncio.create_task(heartbeat_loop(application), name="heartbeat")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logging.getLogger(__name__).exception("Unhandled bot error", exc_info=context.error)


async def edit_or_send(query, text, keyboard=None):
    text = bold_html(text)
    if query.message.photo:
        await query.edit_message_caption(caption=text, parse_mode="HTML", reply_markup=keyboard)
    else:
        await query.edit_message_text(text=text, parse_mode="HTML", reply_markup=keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    if STATE.get("maintenance") and not is_admin_user(update.effective_user):
        await update.message.reply_text(
            bold_html("🛠 Бот временно на техработах.\nПопробуй чуть позже."),
            parse_mode="HTML",
        )
        return
    await update.message.reply_photo(
        photo=PHOTO_PATH,
        caption=HOME_TEXT,
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
    await track_user(update.effective_user)

    if STATE.get("maintenance") and not is_admin_user(update.effective_user) and query.data != "home":
        await edit_or_send(query, "🛠 <b>Бот временно на техработах.</b>", back_home_keyboard())
        return

    if query.data == "info":
        text, keyboard = INFO_TEXT, info_keyboard()
    elif query.data == "squad":
        text, keyboard = SQUAD_TEXT, squad_keyboard()
    elif query.data == "home":
        text, keyboard = HOME_TEXT, home_keyboard()
    elif query.data == "ai":
        user_id = str(update.effective_user.id)
        STATE["ai_enabled"][user_id] = True
        await save_state()
        cfg = ai_config_status()
        ready = cfg["openrouter"] or cfg["groq"]
        text = (
            "🤖 ФИНЯ AI включена.\n\n"
            "Пиши мне обычным сообщением — я буду отвечать с памятью последних реплик.\n"
            "Голосовые тоже поддерживаются через Whisper.\n\n"
            + ("✅ AI-провайдер подключён." if ready else "⚠️ AI-контур готов, но API-ключ ещё не подключён.")
        )
        keyboard = ai_keyboard()
    elif query.data == "ai:reset":
        user_id = str(update.effective_user.id)
        STATE["ai_memory"].pop(user_id, None)
        await save_state()
        text, keyboard = "🧹 Память диалога Фини очищена.", ai_keyboard()
    elif query.data == "ai:off":
        user_id = str(update.effective_user.id)
        STATE["ai_enabled"][user_id] = False
        await save_state()
        text, keyboard = "⏹ ФИНЯ AI выключена.", back_home_keyboard()
    elif query.data == "news":
        news = html.escape(str(STATE.get("news") or "Пока новостей нет."))
        text = f"<b>📢 Новости / объявления</b>\n\n{news}"
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("💠 Открыть канал", url="https://t.me/THKC_SQUAD")],
            [menu_button("⬅️ Главное меню", callback_data="home")],
        ])
    elif query.data == "status":
        text, keyboard = status_text(), back_home_keyboard()
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
            return
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
    if action == "stats":
        text = (
            "<b>📊 Статистика</b>\n\n"
            f"👥 Пользователей: <b>{len(STATE['users'])}</b>\n"
            f"📬 Обращений: <b>{len(STATE['feedback'])}</b>\n"
            f"⏱ Аптайм: <b>{fmt_uptime(time.time() - BOT_STARTED_AT)}</b>"
        )
    elif action == "status":
        text = status_text()
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


def split_ai_text(text, limit=3500):
    text = str(text).strip()
    if not text:
        return ["..."]
    chunks = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = text.rfind(" ", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        chunks.append(text)
    return chunks


async def handle_ai_input(update, context, user_text):
    user = update.effective_user
    user_id = str(user.id)
    history = STATE["ai_memory"].get(user_id, [])[-12:]
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        reply, provider = await generate_reply(history, user_text, user.first_name)
    except RuntimeError as exc:
        code = str(exc)
        if "AI_API_KEY_MISSING" in code:
            message = "⚠️ ФИНЯ AI уже встроена, но пока не подключён OPENROUTER_API_KEY или GROQ_API_KEY."
        else:
            message = "⚠️ Сейчас AI-провайдер не ответил. Попробуй ещё раз чуть позже."
        await update.message.reply_text(bold_html(message), parse_mode="HTML")
        return

    history.extend([
        {"role": "user", "content": user_text[:6000]},
        {"role": "assistant", "content": reply[:6000]},
    ])
    STATE["ai_memory"][user_id] = history[-12:]
    await save_state()
    logging.getLogger(__name__).info("AI reply via %s for user %s", provider, user.id)
    for chunk in split_ai_text(reply):
        await update.message.reply_text(bold_html(html.escape(chunk)), parse_mode="HTML")


async def ai_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    STATE["ai_enabled"][str(update.effective_user.id)] = True
    await save_state()
    await update.message.reply_text(
        bold_html("🤖 ФИНЯ AI включена. Просто пиши мне сообщения."),
        parse_mode="HTML",
        reply_markup=ai_keyboard(),
    )


async def ai_reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    STATE["ai_memory"].pop(str(update.effective_user.id), None)
    await save_state()
    await update.message.reply_text(bold_html("🧹 Память диалога Фини очищена."), parse_mode="HTML")


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
            for user_id in list(STATE.get("users", {}).keys()):
                try:
                    await context.bot.send_message(chat_id=int(user_id), text=bold_html(html.escape(text)), parse_mode="HTML")
                    ok += 1
                except Exception:
                    failed += 1
                await asyncio.sleep(0.04)
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

    if ai_is_enabled(update.effective_user.id):
        await handle_ai_input(update, context, text)


async def voice_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    user_id = str(update.effective_user.id)
    if not ai_is_enabled(update.effective_user.id):
        STATE["ai_enabled"][user_id] = True
        await save_state()

    media = update.message.voice or update.message.audio
    if media is None:
        return
    suffix = ".ogg"
    if update.message.audio and update.message.audio.file_name:
        suffix = Path(update.message.audio.file_name).suffix or ".mp3"
    temp_path = RUNTIME_DIR / f"voice_{user_id}_{update.message.message_id}{suffix}"

    try:
        tg_file = await context.bot.get_file(media.file_id)
        await tg_file.download_to_drive(custom_path=temp_path)
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
        transcript = await transcribe_audio(temp_path)
        await handle_ai_input(update, context, transcript)
    except RuntimeError as exc:
        if "GROQ_API_KEY_MISSING" in str(exc):
            msg = "🎙 Голосовые готовы, но для распознавания нужен GROQ_API_KEY."
        else:
            msg = "⚠️ Не получилось распознать голосовое. Попробуй ещё раз."
        await update.message.reply_text(bold_html(msg), parse_mode="HTML")
    except Exception:
        logging.getLogger(__name__).exception("Voice AI error")
        await update.message.reply_text(
            bold_html("⚠️ Ошибка обработки голосового."),
            parse_mode="HTML",
        )
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def main():
    app = (
        Application.builder()
        .token(TOKEN)
        .connect_timeout(20)
        .read_timeout(30)
        .write_timeout(30)
        .get_updates_connect_timeout(20)
        .get_updates_read_timeout(40)
        .post_init(post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(CommandHandler("ai", ai_command))
    app.add_handler(CommandHandler("resetai", ai_reset_command))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, voice_message))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
    app.add_error_handler(error_handler)

    print("FINYA HELPER запущен.")
    app.run_polling(
        bootstrap_retries=-1,
        poll_interval=0.5,
        timeout=30,
        drop_pending_updates=False,
    )


if __name__ == "__main__":
    main()
