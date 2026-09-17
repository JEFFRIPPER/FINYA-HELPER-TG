"""Interactive local setup for TELEGRAM_BOT_TOKEN.

The token is written only to .env, which is ignored by Git.
"""
from getpass import getpass
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{20,}$")


def main():
    print("FINYA HELPER — настройка Telegram-токена")
    print("Токен сохранится только локально в .env и не попадёт в Git.")
    token = getpass("Вставь новый токен из BotFather: ").strip()

    if not TOKEN_RE.fullmatch(token):
        raise SystemExit("Похоже, это невалидный Telegram Bot Token. Ничего не сохранено.")

    tmp = ENV_PATH.with_suffix(".env.tmp")
    tmp.write_text(f"TELEGRAM_BOT_TOKEN={token}\n", encoding="utf-8")
    tmp.replace(ENV_PATH)
    print("Готово: токен сохранён в локальный .env")


if __name__ == "__main__":
    main()
