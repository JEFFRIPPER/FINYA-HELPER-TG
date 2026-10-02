"""Owner-private rank management with confirmed, audited changes."""
import html
import logging
import re
import secrets
import sqlite3
import time
from datetime import datetime

from activity_xp import MAX_XP, MOSCOW, RANKS, rank_for
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

PAGE_SIZE = 6
PENDING_SECONDS = 600
MAX_USER_ID = 9_223_372_036_854_775_807


def parse_user_id(value):
    text = str(value).strip()
    if not re.fullmatch(r"\+?[0-9]{1,19}", text):
        raise ValueError("Нужен положительный Telegram ID.")
    result = int(text)
    if not 0 < result <= MAX_USER_ID:
        raise ValueError("Неверный Telegram ID.")
    return result


class RankAdmin:
    def __init__(self, core):
        self.core = core

    def allowed(self, user, chat):
        return self.core.is_admin_user(user) and getattr(chat, "type", None) == "private"

    def clear(self, context, *, all_actions=False):
        context.user_data.pop("rank_admin", None)
        context.user_data.pop("rank_admin_pending", None)
        if all_actions or context.user_data.get("admin_action") in {"xp_add", "xp_rank", "rank_find", "rank_amount"}:
            context.user_data.pop("admin_action", None)
        if all_actions:
            context.user_data.pop("awaiting_feedback", None)

    def button(self, label, action):
        return InlineKeyboardButton(label, callback_data=f"admin:xp:{action}",
                                    icon_custom_emoji_id=self.core.ADMIN_BUTTON_ICONS["xp"])

    def keyboard(self):
        return InlineKeyboardMarkup([
            [self.button("Участники", "users"), self.button("Найти участника", "find")],
            [self.button("Звания и пороги", "ranks")],
            [self.button("Настройка учёта XP", "setup")],
            [self.core.menu_button("⬅️ Админ-панель", callback_data="admin:menu")],
        ])

    def back_keyboard(self, user_id=None):
        rows = [[self.button("Карточка участника", f"user:{user_id}")]] if user_id else []
        rows.append([InlineKeyboardButton("Звания / XP", callback_data="admin:xp")])
        return InlineKeyboardMarkup(rows)

    def home_text(self):
        return ("Звания / XP · управление\n\n"
                "Выбери участника из списка или найди по @username / Telegram ID.\n"
                "Звание назначается отдельно от XP: накопленный опыт сохраняется.\n"
                "Снятие ручного звания возвращает автоматическое звание по XP.\n\n"
                "Изменения применяются только после подтверждения.\n"
                "X · Основатель SQUAD закреплён только за владельцем.")

    def activity(self, context):
        value = getattr(context, "bot_data", {}).get("activity_xp")
        if value is None:
            raise LookupError("Учёт XP ещё запускается. Открой панель чуть позже.")
        return value

    def sync_known(self, activity):
        # Do not replace current activity names with older private-chat names.
        for raw_id, record in self.core.STATE.get("users", {}).items():
            try:
                user_id = parse_user_id(raw_id)
            except ValueError:
                continue
            if activity.get_profile(user_id) is None:
                activity.ensure_profile(user_id,
                    str(record.get("first_name") or record.get("username") or user_id)[:100],
                    str(record.get("username") or "")[:40])

    @staticmethod
    def label(profile):
        name = html.escape(str(profile.get("name") or profile["user_id"])[:100])
        username = str(profile.get("username") or "")[:40]
        return name + (f" · @{html.escape(username)}" if username else "")

    def card(self, profile, context):
        user_id = profile["user_id"]
        founder = user_id == self.core.OWNER_USER_ID
        current, _ = rank_for(profile["xp"], founder=founder, manual_rank=profile.get("manual_rank"))
        automatic, _ = rank_for(profile["xp"], founder=founder)
        source = "Закреплено за владельцем" if founder else (
            "Ручное звание" if profile.get("manual_rank") else "Автоматическое звание")
        text = (f"Участник Сквада\n\n{self.label(profile)}\nTelegram ID: {user_id}\n\n"
                f"Звание: {current[1]} · {current[2]}\n{source}\n"
                f"По XP: {automatic[1]} · {automatic[2]}\n\nВсего: {profile['xp']} XP\n"
                f"Активность за неделю: {profile.get('week', 0)} XP\n"
                f"Активность сегодня: {profile.get('today', 0)} XP\n\n"
                "Ручные изменения XP не добавляют баллы в дневную и недельную активность.")
        rows = []
        if not founder:
            rows.append([self.button("Выдать звание", f"rank:{user_id}")])
            if profile.get("manual_rank"):
                rows.append([self.button("Снять ручное звание", f"auto:{user_id}")])
            rows.append([self.button("Добавить XP", f"add:{user_id}"), self.button("Снять XP", f"subtract:{user_id}")])
        rows.append([self.button("История изменений", f"history:{user_id}")])
        rows.append([self.button("Список участников", f"users:{context.user_data.get('rank_admin_page', 0)}"), self.button("Поиск", "find")])
        rows.append([InlineKeyboardButton("Звания / XP", callback_data="admin:xp")])
        return text, InlineKeyboardMarkup(rows)

    def participants(self, activity, context, page=0):
        self.sync_known(activity)
        count = activity.profile_count()
        pages = max(1, (count + PAGE_SIZE - 1) // PAGE_SIZE)
        page = max(0, min(page, pages - 1))
        context.user_data["rank_admin_page"] = page
        profiles = activity.list_profiles(limit=PAGE_SIZE, offset=page * PAGE_SIZE)
        text = f"Участники Сквада\n\nВсего: {count}\nСтраница {page + 1} из {pages}\n\n"
        text += "Выбери участника. В карточке будут звание, XP и постоянный ID." if profiles else "Пока список пуст. Здесь появятся участники, открывшие бота или получившие XP."
        rows = [[self.button(f"{str(p.get('name') or p.get('username') or p['user_id'])[:25]} · {p['user_id']}", f"user:{p['user_id']}")] for p in profiles]
        navigation = []
        if page > 0:
            navigation.append(self.button("Назад", f"users:{page - 1}"))
        if page + 1 < pages:
            navigation.append(self.button("Далее", f"users:{page + 1}"))
        if navigation:
            rows.append(navigation)
        rows.append([self.button("Найти участника", "find"), self.button("Обновить", f"users:{page}")])
        rows.append([InlineKeyboardButton("Звания / XP", callback_data="admin:xp")])
        return text, InlineKeyboardMarkup(rows)

    def candidates(self, activity, text):
        self.sync_known(activity)
        if re.fullmatch(r"\+?[0-9]+", text):
            profile = activity.get_profile(parse_user_id(text))
            return [profile] if profile else []
        username = text.lstrip("@")
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,31}", username):
            raise ValueError("Отправь один @username или положительный Telegram ID.")
        username = username.casefold()
        matches = {p["user_id"]: p for p in activity.find_profiles(username)}
        # Never silently choose between a reused username and an old profile.
        for raw_id, record in self.core.STATE.get("users", {}).items():
            if str(record.get("username") or "").casefold() != username:
                continue
            try:
                profile = activity.get_profile(parse_user_id(raw_id))
            except ValueError:
                continue
            if profile:
                matches[profile["user_id"]] = profile
        return list(matches.values())

    def preview(self, context, profile, action, value):
        if profile["user_id"] == self.core.OWNER_USER_ID:
            raise PermissionError("X · Основатель SQUAD закреплён за владельцем и не изменяется.")
        pending = {"token": secrets.token_hex(6), "user_id": profile["user_id"],
                   "action": action, "value": value, "time": time.time(),
                   "before_xp": profile["xp"], "before_rank": profile.get("manual_rank")}
        context.user_data["rank_admin_pending"] = pending
        return self.preview_view(pending, profile)

    def preview_view(self, pending, profile):
        old, _ = rank_for(profile["xp"], manual_rank=profile.get("manual_rank"))
        if pending["action"] == "adjust_xp":
            new_xp = max(0, profile["xp"] + pending["value"])
            if new_xp > MAX_XP:
                raise ValueError("Сумма превышает предел XP. Введи новую сумму.")
            new, _ = rank_for(new_xp, manual_rank=profile.get("manual_rank"))
            change = (f"XP: {profile['xp']} → {new_xp}\nФактическое изменение: {new_xp - profile['xp']:+d} XP\n"
                      f"Звание: {old[1]} · {old[2]} → {new[1]} · {new[2]}")
        else:
            new, _ = rank_for(profile["xp"], manual_rank=pending["value"])
            change = (f"Звание: {old[1]} · {old[2]} → {new[1]} · {new[2]}\nXP остаётся: {profile['xp']}\n" +
                      ("Звание будет закреплено вручную." if pending["value"] else "Дальше звание будет определяться автоматически по XP."))
        return (f"Подтверди изменение\n\n{self.label(profile)}\nTelegram ID: {profile['user_id']}\n\n{change}\n\nДо подтверждения ничего не изменено.",
                InlineKeyboardMarkup([[self.button("Подтвердить", f"confirm:{pending['token']}"), self.button("Отмена", "cancel")]]))

    def history(self, activity, profile):
        text = f"История изменений\n\n{self.label(profile)}\nTelegram ID: {profile['user_id']}"
        records = activity.admin_history(profile["user_id"], limit=5)
        if not records:
            text += "\n\nРучных изменений пока нет."
        for entry in records:
            date = datetime.fromtimestamp(entry["created_at"], MOSCOW)
            change = (f"XP: {entry['before_xp']} → {entry['after_xp']}" if entry["action"] == "adjust_xp" else
                      f"Ручное звание: {entry.get('before_rank') or 'автоматически'} → {entry.get('after_rank') or 'автоматически'}")
            text += f"\n\n{date:%d.%m.%Y %H:%M} МСК\n{change}\nВладелец: {entry['actor_id']}"
        return text, self.back_keyboard(profile["user_id"])

    async def handle(self, query, context, action):
        if not self.allowed(query.from_user, getattr(query.message, "chat", None)):
            return
        try:
            if action.startswith("xp:confirm:"):
                await self.confirm(query, context, action.split(":", 2)[2])
                return
            self.clear(context, all_actions=True)
            if action == "xp":
                await self.core.edit_or_send(query, self.home_text(), self.keyboard())
                return
            activity = self.activity(context)
            parts = action.split(":")
            command = parts[1]
            if command == "users":
                page = int(parts[2]) if len(parts) == 3 and re.fullmatch(r"[0-9]{1,6}", parts[2]) else 0
                text, keyboard = self.participants(activity, context, page)
            elif command in {"find", "add", "rank"} and len(parts) == 2:
                context.user_data["rank_admin"] = {"mode": "find"}
                context.user_data["admin_action"] = "rank_find"
                text = "Найти участника\n\nОтправь @username или Telegram ID.\nПосле поиска выбери действие в карточке.\n/cancel — отменить."
                keyboard = self.back_keyboard()
            elif command == "ranks":
                text = "Звания Сквада\n\n" + "\n".join(f"{roman} · {name} — от {points} XP" for points, roman, name in RANKS)
                text += "\n\nX · Основатель SQUAD — только владелец.\nРучное звание не изменяет накопленный XP."
                keyboard = self.keyboard()
            elif command == "setup":
                text, keyboard = await self.core.xp_setup_text(context), self.back_keyboard()
            elif command == "cancel":
                uid = context.user_data.get("rank_admin_selected")
                profile = activity.get_profile(uid) if uid else None
                text, keyboard = self.card(profile, context) if profile else (self.home_text(), self.keyboard())
                text = "Действие отменено.\n\n" + text
            elif command in {"user", "rank", "auto", "add", "subtract", "history", "choose"}:
                if len(parts) != (4 if command == "choose" else 3):
                    raise ValueError("Кнопка устарела. Выбери участника заново.")
                uid = parse_user_id(parts[2])
                self.sync_known(activity)
                profile = activity.get_profile(uid)
                if profile is None:
                    raise LookupError("Участник не найден. Открой список или используй поиск.")
                context.user_data["rank_admin_selected"] = uid
                if command in {"rank", "auto", "add", "subtract", "choose"} and uid == self.core.OWNER_USER_ID:
                    raise PermissionError("X · Основатель SQUAD закреплён за владельцем и не изменяется.")
                if command == "user":
                    text, keyboard = self.card(profile, context)
                elif command == "history":
                    text, keyboard = self.history(activity, profile)
                elif command == "rank":
                    text = f"Выдать звание\n\n{self.label(profile)}\nTelegram ID: {uid}\n\nВыбери звание. Накопленные {profile['xp']} XP сохранятся."
                    rows = [[self.button(f"{roman} · {name}", f"choose:{uid}:{roman}")] for _, roman, name in RANKS]
                    rows.append([self.button("Карточка участника", f"user:{uid}")])
                    keyboard = InlineKeyboardMarkup(rows)
                elif command in {"choose", "auto"}:
                    value = parts[3] if command == "choose" else None
                    if value is not None and value not in {rank[1] for rank in RANKS}:
                        raise ValueError("Можно назначить только звания I–IX.")
                    text, keyboard = self.preview(context, profile, "set_manual_rank", value)
                else:
                    context.user_data["rank_admin"] = {"mode": "amount", "user_id": uid, "action": command}
                    context.user_data["admin_action"] = "rank_amount"
                    verb = "добавить" if command == "add" else "снять"
                    text = f"Изменить XP\n\n{self.label(profile)}\nTelegram ID: {uid}\nСейчас: {profile['xp']} XP\n\nСколько XP {verb}?\nОтправь целое число от 1 до {MAX_XP:,}.\n/cancel — отменить."
                    keyboard = self.back_keyboard(uid)
            else:
                raise ValueError("Кнопка устарела. Открой управление званиями заново.")
            await self.core.edit_or_send(query, text, keyboard)
        except (ValueError, LookupError, PermissionError) as exc:
            await self.core.edit_or_send(query, html.escape(str(exc)), self.keyboard())
        except sqlite3.Error:
            logging.getLogger(__name__).exception("Rank admin database operation failed")
            await self.core.edit_or_send(query, "Хранилище XP временно недоступно. Повтори действие чуть позже.", self.keyboard())

    async def confirm(self, query, context, token):
        pending = context.user_data.get("rank_admin_pending")
        if not pending or pending.get("token") != token or time.time() - pending.get("time", 0) > PENDING_SECONDS:
            if pending and pending.get("token") == token:
                self.clear(context)
            await self.core.edit_or_send(query, "Подтверждение устарело. Выбери действие заново.", self.keyboard())
            return
        activity = self.activity(context)
        profile = None
        try:
            profile = activity.get_profile(pending["user_id"])
            if profile is None:
                self.clear(context)
                raise LookupError("Участник не найден.")
            if profile["xp"] != pending["before_xp"] or profile.get("manual_rank") != pending["before_rank"]:
                if pending["action"] == "adjust_xp" and profile["xp"] + pending["value"] > MAX_XP:
                    self.clear(context)
                    context.user_data["rank_admin"] = {"mode": "amount", "user_id": profile["user_id"], "action": "add"}
                    context.user_data["admin_action"] = "rank_amount"
                    text = (f"XP участника изменился: сейчас {profile['xp']} XP.\n"
                            f"Максимальная добавка сейчас: {MAX_XP - profile['xp']} XP.\n\n"
                            "Ничего не изменено. Отправь новую сумму или нажми «Карточка участника».")
                    await self.core.edit_or_send(query, text, self.back_keyboard(profile["user_id"]))
                    return
                text, keyboard = self.preview(context, profile, pending["action"], pending["value"])
                await self.core.edit_or_send(query, "Данные участника изменились. Проверь обновлённое действие.\n\n" + text, keyboard)
                return
            method = activity.adjust_xp if pending["action"] == "adjust_xp" else activity.set_manual_rank
            result = method(pending["user_id"], pending["value"], actor_id=query.from_user.id,
                            owner_id=self.core.OWNER_USER_ID, operation_id=f"rankadmin:{query.from_user.id}:{token}")
        except sqlite3.Error:
            logging.getLogger(__name__).exception("Could not commit rank admin change")
            snapshot = profile or {"user_id": pending["user_id"], "xp": pending["before_xp"], "manual_rank": pending["before_rank"]}
            text, keyboard = self.preview_view(pending, snapshot)
            await self.core.edit_or_send(query, "Изменение не подтверждено хранилищем. Можно повторить подтверждение.\n\n" + text, keyboard)
            return
        self.clear(context)
        text, keyboard = self.card(result["profile"], context)
        await self.core.edit_or_send(query, "Изменение сохранено.\n\n" + text, keyboard)

    async def handle_text(self, update, context):
        state = context.user_data.get("rank_admin")
        legacy = context.user_data.get("admin_action") in {"xp_add", "xp_rank"}
        if not state and not legacy:
            return False
        if not self.allowed(update.effective_user, update.effective_chat):
            return True
        if legacy:
            self.clear(context, all_actions=True)
            await update.message.reply_text(self.core.bold_html(self.home_text()), parse_mode="HTML", reply_markup=self.keyboard())
            return True
        text = (update.message.text or "").strip()
        if text.lower() in {"отмена", "/cancel"}:
            self.clear(context, all_actions=True)
            await update.message.reply_text(self.core.bold_html("Действие отменено."), parse_mode="HTML", reply_markup=self.keyboard())
            return True
        try:
            activity = self.activity(context)
            if state["mode"] == "find":
                profiles = self.candidates(activity, text)
                if not profiles:
                    raise LookupError("Участник не найден. Он должен был открыть бота или появиться в учёте XP. Попробуй Telegram ID.")
                if len(profiles) > 1:
                    raise ValueError("Этот username связан с несколькими известными ID. Чтобы не изменить чужое звание, отправь постоянный Telegram ID участника.")
                profile = profiles[0]
                self.clear(context)
                context.user_data["rank_admin_selected"] = profile["user_id"]
                reply, keyboard = self.card(profile, context)
            else:
                number = text.replace(" ", "").replace("_", "")
                if not re.fullmatch(r"[0-9]{1,10}", number) or not 0 < int(number) <= MAX_XP:
                    raise ValueError(f"Нужно целое положительное число от 1 до {MAX_XP:,}. Попробуй ещё раз.")
                profile = activity.get_profile(state["user_id"])
                if profile is None:
                    raise LookupError("Участник не найден.")
                delta = int(number) * (-1 if state["action"] == "subtract" else 1)
                if profile["xp"] + delta > MAX_XP:
                    raise ValueError(f"Общий XP не может превышать {MAX_XP:,}. Отправь меньшее число.")
                self.clear(context)
                reply, keyboard = self.preview(context, profile, "adjust_xp", delta)
            await update.message.reply_text(self.core.bold_html(reply), parse_mode="HTML", reply_markup=keyboard)
        except (ValueError, LookupError, PermissionError) as exc:
            await update.message.reply_text(self.core.bold_html(html.escape(str(exc))), parse_mode="HTML",
                                            reply_markup=self.back_keyboard(state.get("user_id")))
        except sqlite3.Error:
            logging.getLogger(__name__).exception("Rank admin input database failure")
            await update.message.reply_text(self.core.bold_html("Хранилище временно недоступно. Повтори ввод чуть позже."),
                                            parse_mode="HTML", reply_markup=self.back_keyboard(state.get("user_id")))
        return True
