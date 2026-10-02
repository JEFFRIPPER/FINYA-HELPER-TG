"""FINYA entrypoint with owner-private rank controls."""
import sys

import bot_core as core
from admin_ranks import RankAdmin

core.BOT_VERSION = "2.6.1"
core.RANK_ADMIN = RankAdmin(core)
core.admin_xp_keyboard = core.RANK_ADMIN.keyboard
_original_admin_callback = core.handle_admin_callback
_original_text_message = core.text_message
_original_button = core.button
_original_start = core.start
_original_admin_command = core.admin_command


async def handle_admin_callback(query, context, action):
    if not core.RANK_ADMIN.allowed(query.from_user, getattr(query.message, "chat", None)):
        return
    if action == "xp" or action.startswith("xp:"):
        await core.RANK_ADMIN.handle(query, context, action)
        return
    core.RANK_ADMIN.clear(context, all_actions=True)
    await _original_admin_callback(query, context, action)


async def text_message(update, context):
    if await core.RANK_ADMIN.handle_text(update, context):
        return
    if core.RANK_ADMIN.allowed(update.effective_user, update.effective_chat) and context.user_data.get("rank_admin_pending"):
        await update.message.reply_text(
            core.bold_html("Подтверди действие кнопкой или нажми «Отмена». /cancel — отменить."),
            parse_mode="HTML",
        )
        return
    await _original_text_message(update, context)


async def button(update, context):
    action = update.callback_query.data or ""
    if not action.startswith("admin:xp"):
        core.RANK_ADMIN.clear(context)
    await _original_button(update, context)


async def start(update, context):
    core.RANK_ADMIN.clear(context, all_actions=True)
    await _original_start(update, context)


async def admin_command(update, context):
    if not core.RANK_ADMIN.allowed(update.effective_user, update.effective_chat):
        return
    core.RANK_ADMIN.clear(context, all_actions=True)
    await _original_admin_command(update, context)


async def cancel_command(update, context):
    if not core.RANK_ADMIN.allowed(update.effective_user, update.effective_chat):
        return
    core.RANK_ADMIN.clear(context, all_actions=True)
    await update.message.reply_text(core.bold_html("Действие отменено."), parse_mode="HTML",
                                    reply_markup=core.admin_xp_keyboard())


core.handle_admin_callback = handle_admin_callback
core.text_message = text_message
core.button = button
core.start = start
core.admin_command = admin_command
core.cancel_command = cancel_command

if __name__ == "__main__":
    core.main()
else:
    # Keep patches of bot.STATE/save_state/Application working on core handlers.
    sys.modules[__name__] = core
