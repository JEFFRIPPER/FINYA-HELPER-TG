"""Interactive local setup for TELEGRAM_BOT_TOKEN.

The token is written only to .env, which is ignored by Git. Other variables
already present in .env (for example BLACKLIST_CHANNEL_ID) are kept.
"""
from getpass import getpass
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{20,}$")
KEY = "TELEGRAM_BOT_TOKEN"


def merged_env(existing_text, token):
    """Return .env content with TELEGRAM_BOT_TOKEN set and everything else kept."""
    lines = []
    replaced = False
    for line in existing_text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#") and "=" in stripped and stripped.split("=", 1)[0].strip() == KEY:
            if not replaced:
                lines.append(f"{KEY}={token}")
                replaced = True
            continue
        lines.append(line)
    if not replaced:
        lines.append(f"{KEY}={token}")
    return "\n".join(lines) + "\n"


def write_token(token, path=ENV_PATH):
    try:
        existing = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        existing = ""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(merged_env(existing, token), encoding="utf-8")
    try:
        tmp.chmod(0o600)
    except OSError:
        pass
    tmp.replace(path)


def main():
    print("FINYA HELPER — настройка Telegram-токена")
    print("Токен сохранится только локально в .env и не попадёт в Git.")
    token = getpass("Вставь новый токен из BotFather: ").strip()

    if not TOKEN_RE.fullmatch(token):
        raise SystemExit("Похоже, это невалидный Telegram Bot Token. Ничего не сохранено.")

    write_token(token)
    print("Готово: токен сохранён в локальный .env")


if __name__ == "__main__":
    main()
