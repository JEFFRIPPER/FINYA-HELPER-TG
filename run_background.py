"""Run the bot without a console, with rotating logs and a single-instance lock."""
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / "logs"
LOGS.mkdir(exist_ok=True)
lock = (LOGS / "bot.lock").open("a+b")
lock.seek(0)
if not lock.read(1):
    lock.write(b"0")
    lock.flush()
lock.seek(0)
try:
    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
except OSError:
    sys.exit(0)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[RotatingFileHandler(LOGS / "bot.log", maxBytes=2_000_000,
                                  backupCount=3, encoding="utf-8")],
)
# HTTP request URLs contain the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

if __name__ == "__main__":
    try:
        from bot import main
        logging.info("Starting OPEX BOT")
        main()
    except Exception:
        logging.exception("Bot stopped unexpectedly")
        sys.exit(1)
