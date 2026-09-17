"""Run the bot continuously with rotating logs and a single-instance lock."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import os
import sys
import time

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / "logs"
LOGS.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        RotatingFileHandler(
            LOGS / "bot.log",
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
    ],
)

# HTTP request URLs can contain the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def acquire_lock():
    """Keep only one bot process running on Windows or Linux."""
    lock = (LOGS / "bot.lock").open("a+b")
    lock.seek(0)
    if not lock.read(1):
        lock.write(b"0")
        lock.flush()
    lock.seek(0)

    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, BlockingIOError):
        logging.info("Another bot instance is already running; exiting.")
        sys.exit(0)

    return lock


def run_forever():
    # Keep this handle referenced for the lifetime of the process so the lock stays active.
    lock_handle = acquire_lock()

    from bot import main

    delay = 3
    while True:
        try:
            logging.info("Starting FINYA HELPER bot")
            main()
            logging.warning("Bot stopped without an exception; restarting in %s seconds", delay)
        except KeyboardInterrupt:
            logging.info("Bot stopped by user")
            break
        except Exception:
            logging.exception("Bot crashed; restarting in %s seconds", delay)

        time.sleep(delay)
        delay = min(delay * 2, 30)

    # Keep an explicit reference until shutdown.
    lock_handle.close()


if __name__ == "__main__":
    run_forever()
