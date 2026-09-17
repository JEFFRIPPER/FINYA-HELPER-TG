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

TOKEN = "8906365781:AAGbeB9g-hBIy2KM_8o9_GAT1TTxbNoY9nU"
ROOT = Path(__file__).resolve().parent
PHOTO_PATH = str(ROOT / "info.jpg")
RUNTIME_DIR = ROOT / "runtime"
HEARTBEAT_PATH = RUNTIME_DIR / "heartbeat.txt"
STATE_PATH = RUNTIME_DIR / "state.json"
LOGS_DIR = ROOT / "logs"
BOT_STARTED_AT = time.time()
BOT_VERSION = "1.3"

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
    return state


STATE = load_state()
STATE_LOCK = asyncio.Lock()


async def save_state():
    async with STATE_LOCK:
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_PATH)


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
    return (
        "<b>🟢 Статус FINYA HELPER</b>\n\n"
        "✅ Бот: работает\n"
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
        [menu_button("👤 ЛС Владельца", url="https://t.me/THKC_SQUAD_CREATOR")],
    ])


def back_home_keyboard():
    return InlineKeyboardMarkup([[menu_button("⬅️ Главное меню", callback_data="home")]])


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


def admin_keyboard():
    maintenance = "🟠 Техработы: ВКЛ" if STATE.get("maintenance") else "🟢 Техработы: ВЫКЛ"
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 Статистика", callback_data="admin:stats"),
         InlineKeyboardButton("🟢 Статус", callback_data="admin:status")],
        [InlineKeyboardButton("📬 Фидбек", callback_data="admin:feedback"),
         InlineKeyboardButton("📢 Новость", callback_data="admin:news")],
        [InlineKeyboardButton("📣 Рассылка", callback_data="admin:broadcast")],
        [InlineKeyboardButton(maintenance, callback_data="admin:maintenance")],
        [InlineKeyboardButton("🧾 Логи", callback_data="admin:logs"),
         InlineKeyboardButton("♻️ Перезапуск", callback_data="admin:restart")],
    ])


async def heartbeat_loop():
    RUNTIME_DIR.mkdir(exist_ok=True)
    while True:
        try:
            HEARTBEAT_PATH.write_text(str(time.time()), encoding="utf-8")
        except OSError:
            pass
        await asyncio.sleep(30)


async def post_init(application: Application):
    application.create_task(heartbeat_loop(), name="heartbeat")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logging.getLogger(__name__).exception("Unhandled bot error", exc_info=context.error)


async def edit_or_send(query, text, keyboard=None):
    if query.message.photo:
        await query.edit_message_caption(caption=text, parse_mode="HTML", reply_markup=keyboard)
    else:
        await query.edit_message_text(text=text, parse_mode="HTML", reply_markup=keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await track_user(update.effective_user)
    if STATE.get("maintenance") and not is_admin_user(update.effective_user):
        await update.message.reply_text(
            "🛠 <b>Бот временно на техработах.</b>\nПопробуй чуть позже.",
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
        "<b>🛠 Админ-панель FINYA HELPER</b>\n\nУправление ботом:",
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

    await query.edit_message_text(text=text, parse_mode="HTML", reply_markup=admin_keyboard())


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
            await update.message.reply_text("✅ Новость обновлена.", reply_markup=admin_keyboard())
            return
        if action == "broadcast":
            ok = 0
            failed = 0
            for user_id in list(STATE.get("users", {}).keys()):
                try:
                    await context.bot.send_message(chat_id=int(user_id), text=text)
                    ok += 1
                except Exception:
                    failed += 1
                await asyncio.sleep(0.04)
            await update.message.reply_text(
                f"✅ Рассылка завершена.\nДоставлено: {ok}\nОшибок: {failed}",
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
        await update.message.reply_text("✅ Отправлено владельцу. Спасибо ❤️")

        admin_chat_id = OWNER_USER_ID
        if admin_chat_id:
            who = f"@{user.username}" if user.username else f"{user.first_name} ({user.id})"
            try:
                await context.bot.send_message(
                    chat_id=int(admin_chat_id),
                    text=f"📬 Новый фидбек от {who}:\n\n{text[:3500]}",
                )
            except Exception:
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
    app.add_handler(CallbackQueryHandler(button))
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
