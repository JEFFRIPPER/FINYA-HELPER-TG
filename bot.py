import os

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

TOKEN = "8906365781:AAGbeB9g-hBIy2KM_8o9_GAT1TTxbNoY9nU"
PHOTO_PATH = os.path.join(os.path.dirname(__file__), "info.jpg")


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
SQUAD_ICON_ID = "5366465407609756495"  # SquadecChat
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
            menu_button("👤 ЛС Владельца", url="https://t.me/THKC_SQUAD_CREATOR"),
        ],
    ])


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


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.message.reply_photo(
        photo=PHOTO_PATH,
        caption=HOME_TEXT,
        parse_mode="HTML",
        reply_markup=home_keyboard(),
    )


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "info":
        text, keyboard = INFO_TEXT, info_keyboard()
    elif query.data == "squad":
        text, keyboard = SQUAD_TEXT, squad_keyboard()
    elif query.data == "home":
        text, keyboard = HOME_TEXT, home_keyboard()
    elif query.data and query.data.startswith("partner:"):
        partner = PARTNERS.get(query.data.split(":", 1)[1])
        if partner is None:
            return
        text = f"<b>🤝 {partner['name']}\n\nПартнёр Сквада\nВыбери соцсеть:</b>"
        keyboard = partner_keyboard(partner)
    else:
        return

    if query.message.photo:
        await query.edit_message_caption(
            caption=text, parse_mode="HTML", reply_markup=keyboard,
        )
    else:
        await query.edit_message_text(
            text=text, parse_mode="HTML", reply_markup=keyboard,
        )


def main():
    app = (
        Application.builder()
        .token(TOKEN)
        .connect_timeout(20)
        .get_updates_connect_timeout(20)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button))

    print("OPEX BOT запущен.")
    # A home PC may start before its internet connection is ready.
    app.run_polling(bootstrap_retries=-1)


if __name__ == "__main__":
    main()
