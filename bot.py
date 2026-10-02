"""FINYA HELPER entrypoint with owner-only XP/rank administration.

The 2.5 implementation lives in bot_core.py.  This thin layer keeps the
existing bot intact and adds manual XP/rank controls to /admin.
"""

import html

import bot_core as core
from bot_core import *  # noqa: F401,F403
from telegram import InlineKeyboardButton, InlineKeyboardMarkup


core.BOT_VERSION = "2.6"
BOT_VERSION = core.BOT_VERSION

_original_handle_admin_callback = core.handle_admin_callback
_original_text_message = core.text_message

_SQLITE_INT_MAX = 9_223_372_036_854_775_807


def admin_xp_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Добавить / снять XP", callback_data="admin:xp:add")],
        [InlineKeyboardButton("Выдать звание", callback_data="admin:xp:rank")],
        [InlineKeyboardButton("Настройка учёта XP", callback_data="admin:xp:setup")],
        [core.menu_button("⬅️ Админ-панель", callback_data="admin:menu")],
    ])


def _xp_setup_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Обновить", callback_data="admin:xp:setup")],
        [InlineKeyboardButton("Назад к управлению XP", callback_data="admin:xp")],
        [core.menu_button("⬅️ Админ-панель", callback_data="admin:menu")],
    ])


def _xp_back_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("Назад к управлению XP", callback_data="admin:xp")],
        [core.menu_button("⬅️ Админ-панель", callback_data="admin:menu")],
    ])


def _normalize_target(value):
    return value.strip().lstrip("@").casefold()


def _profile_from_db(activity, target):
    token = target.strip()
    if token.lstrip("+").isdigit():
        user_id = int(token.lstrip("+"))
        row = activity.db.execute(
            "SELECT * FROM profiles WHERE user_id=?", (user_id,)
        ).fetchone()
    else:
        username = _normalize_target(token)
        row = activity.db.execute(
            "SELECT * FROM profiles WHERE lower(username)=?", (username,)
        ).fetchone()
    return dict(row) if row else None


def _state_user(target):
    token = target.strip()
    if token.lstrip("+").isdigit():
        user_id = token.lstrip("+")
        record = core.STATE.get("users", {}).get(user_id)
        return (int(user_id), record) if record else (None, None)

    username = _normalize_target(token)
    for user_id, record in core.STATE.get("users", {}).items():
        if str(record.get("username") or "").casefold() == username:
            return int(user_id), record
    return None, None


def _resolve_xp_profile(context, target):
    activity = context.bot_data["activity_xp"]
    row = _profile_from_db(activity, target)
    if row:
        return row

    user_id, record = _state_user(target)
    if user_id is None:
        return None

    username = str(record.get("username") or "")[:40]
    name = str(record.get("first_name") or username or user_id)[:100]
    with activity.db:
        activity.db.execute(
            """
            INSERT INTO profiles(user_id, name, username)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                name=excluded.name,
                username=excluded.username
            """,
            (user_id, name, username),
        )
    return _profile_from_db(activity, str(user_id))


def _profile_label(profile):
    username = str(profile.get("username") or "").strip()
    if username:
        return f"@{username}"
    name = str(profile.get("name") or "").strip()
    return name or str(profile["user_id"])


def _rank_by_text(value):
    key = " ".join(value.strip().split()).casefold()
    for index, rank in enumerate(core.RANKS, 1):
        points, roman, name = rank
        candidates = {
            roman.casefold(),
            name.casefold(),
            f"{roman} {name}".casefold(),
            f"{roman} · {name}".casefold(),
            str(index),
        }
        if key in candidates:
            return points, roman, name
    return None


def _set_profile_xp(context, profile, new_xp):
    new_xp = int(new_xp)
    if new_xp < 0:
        new_xp = 0
    if new_xp > _SQLITE_INT_MAX:
        raise OverflowError("XP exceeds SQLite INTEGER range")

    activity = context.bot_data["activity_xp"]
    with activity.db:
        activity.db.execute(
            "UPDATE profiles SET xp=? WHERE user_id=?",
            (new_xp, int(profile["user_id"])),
        )
    updated = activity.db.execute(
        "SELECT * FROM profiles WHERE user_id=?",
        (int(profile["user_id"]),),
    ).fetchone()
    return dict(updated)


def _xp_admin_text():
    return (
        "Активность / XP · управление\n\n"
        "Здесь можно вручную изменить опыт участника или назначить ему звание.\n\n"
        "Добавить / снять XP — принимает любое целое число со знаком.\n"
        "Выдать звание — устанавливает XP ровно на порог выбранного ранга.\n\n"
        "X · Основатель SQUAD вручную не назначается."
    )


async def handle_admin_callback(query, context, action):
    if not core.is_admin_user(query.from_user):
        return

    if action == "xp":
        if query.message.chat.type != "private":
            return
        context.user_data.pop("admin_action", None)
        await core.edit_or_send(query, _xp_admin_text(), admin_xp_keyboard())
        return

    if action == "xp:add":
        if query.message.chat.type != "private":
            return
        context.user_data["admin_action"] = "xp_add"
        await core.edit_or_send(
            query,
            "Добавить / снять XP\n\n"
            "Отправь следующим сообщением:\n"
            "@username ЧИСЛО\n\n"
            "Примеры:\n"
            "@smokchaskyf 15000\n"
            "@kvazimato -500\n\n"
            "Можно использовать Telegram ID вместо @username.",
            _xp_back_keyboard(),
        )
        return

    if action == "xp:rank":
        if query.message.chat.type != "private":
            return
        context.user_data["admin_action"] = "xp_rank"
        ranks = "\n".join(
            f"{roman} · {name} — {points} XP"
            for points, roman, name in core.RANKS
        )
        await core.edit_or_send(
            query,
            "Выдать звание\n\n"
            "Отправь следующим сообщением:\n"
            "@username РАНГ\n\n"
            "Можно указать номер, римскую цифру или название.\n"
            "Например: @smokchaskyf IX\n"
            "или: @smokchaskyf Верховный Архонт\n\n"
            + ranks,
            _xp_back_keyboard(),
        )
        return

    if action == "xp:setup":
        if query.message.chat.type != "private":
            return
        context.user_data.pop("admin_action", None)
        text = await core.xp_setup_text(context)
        await core.edit_or_send(query, text, _xp_setup_keyboard())
        return

    if action == "menu":
        context.user_data.pop("admin_action", None)

    await _original_handle_admin_callback(query, context, action)


async def _handle_xp_add(update, context, text):
    parts = text.split()
    if len(parts) != 2:
        await update.message.reply_text(
            core.bold_html(
                "Неверный формат.\n\n"
                "Нужно: @username ЧИСЛО\n"
                "Пример: @smokchaskyf 15000"
            ),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    target, raw_delta = parts
    try:
        delta = int(raw_delta.replace("_", ""))
    except ValueError:
        await update.message.reply_text(
            core.bold_html("XP должен быть целым числом. Например: @user 5000"),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    profile = _resolve_xp_profile(context, target)
    if profile is None:
        await update.message.reply_text(
            core.bold_html(
                "Пользователь не найден.\n\n"
                "Финя должна уже знать его: он должен был появиться в XP "
                "или хотя бы один раз открыть бота."
            ),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    if int(profile["user_id"]) == core.OWNER_USER_ID:
        await update.message.reply_text(
            core.bold_html("Основатель всегда имеет X · Основатель SQUAD."),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    old_xp = int(profile["xp"])
    new_xp = old_xp + delta
    try:
        profile = _set_profile_xp(context, profile, new_xp)
    except OverflowError:
        await update.message.reply_text(
            core.bold_html("Слишком большое число XP."),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    current, _ = core.rank_for(profile["xp"])
    label = html.escape(_profile_label(profile))
    sign = f"+{delta}" if delta >= 0 else str(delta)
    await update.message.reply_text(
        core.bold_html(
            f"Готово.\n\n{label}\n"
            f"Изменение: {sign} XP\n"
            f"Было: {old_xp} XP\n"
            f"Стало: {profile['xp']} XP\n"
            f"Звание: {current[1]} · {current[2]}"
        ),
        parse_mode="HTML",
        reply_markup=admin_xp_keyboard(),
    )


async def _handle_xp_rank(update, context, text):
    parts = text.split(maxsplit=1)
    if len(parts) != 2:
        await update.message.reply_text(
            core.bold_html(
                "Неверный формат.\n\n"
                "Нужно: @username РАНГ\n"
                "Пример: @smokchaskyf IX"
            ),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    target, raw_rank = parts
    rank = _rank_by_text(raw_rank)
    if rank is None:
        await update.message.reply_text(
            core.bold_html(
                "Неизвестное звание. Используй I–IX, номер 1–9 "
                "или полное название звания."
            ),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    profile = _resolve_xp_profile(context, target)
    if profile is None:
        await update.message.reply_text(
            core.bold_html(
                "Пользователь не найден.\n\n"
                "Финя должна уже знать его: он должен был появиться в XP "
                "или хотя бы один раз открыть бота."
            ),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    if int(profile["user_id"]) == core.OWNER_USER_ID:
        await update.message.reply_text(
            core.bold_html("Основатель всегда имеет X · Основатель SQUAD."),
            parse_mode="HTML",
            reply_markup=admin_xp_keyboard(),
        )
        return

    old_xp = int(profile["xp"])
    points, roman, name = rank
    profile = _set_profile_xp(context, profile, points)
    label = html.escape(_profile_label(profile))
    await update.message.reply_text(
        core.bold_html(
            f"Звание выдано.\n\n{label}\n"
            f"{roman} · {name}\n"
            f"XP: {old_xp} → {profile['xp']}"
        ),
        parse_mode="HTML",
        reply_markup=admin_xp_keyboard(),
    )


async def text_message(update, context):
    action = context.user_data.get("admin_action")
    if core.is_admin_user(update.effective_user) and action in {"xp_add", "xp_rank"}:
        await core.track_user(update.effective_user)
        context.user_data.pop("admin_action", None)
        text = (update.message.text or "").strip()
        if action == "xp_add":
            await _handle_xp_add(update, context, text)
        else:
            await _handle_xp_rank(update, context, text)
        return

    await _original_text_message(update, context)


# Patch globals used by the existing handlers before core.main() builds the app.
core.handle_admin_callback = handle_admin_callback
core.text_message = text_message

# Re-export the patched callables for imports/tests that use `import bot`.
globals()["handle_admin_callback"] = handle_admin_callback
globals()["text_message"] = text_message
globals()["_run_bot"] = core._run_bot
globals()["main"] = core.main


if __name__ == "__main__":
    core.main()
