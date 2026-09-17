"""Run FINYA HELPER continuously with rotating logs and a single-instance lock."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import os
import sys
import time

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / "logs"
RUNTIME = ROOT / "runtime"
LOGS.mkdir(exist_ok=True)
RUNTIME.mkdir(exist_ok=True)

fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

main_log = RotatingFileHandler(
    LOGS / "bot.log",
    maxBytes=2_000_000,
    backupCount=3,
    encoding="utf-8",
)
main_log.setFormatter(fmt)
root_logger.addHandler(main_log)

error_log = RotatingFileHandler(
    LOGS / "error.log",
    maxBytes=1_000_000,
    backupCount=3,
    encoding="utf-8",
)
error_log.setLevel(logging.ERROR)
error_log.setFormatter(fmt)
root_logger.addHandler(error_log)

# HTTP request URLs can contain the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def acquire_lock():
    """Keep only one launcher instance running on Windows or Linux."""
    lock = (RUNTIME / "runner.lock").open("a+b")
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
        logging.info("Another launcher instance is already running; exiting.")
        sys.exit(0)

    return lock


def run_forever():
    lock_handle = acquire_lock()
    heartbeat = RUNTIME / "heartbeat.txt"
    try:
        heartbeat.unlink(missing_ok=True)
    except Exception:
        pass

    import bot

    # Do not rewrite state.json on every button press. Disk I/O before every
    # Telegram API response adds visible latency, especially on slow hosts.
    original_track_user = bot.track_user

    async def fast_track_user(user):
        if user is None:
            return
        key = str(user.id)
        now = int(time.time())
        previous = bot.STATE.get("users", {}).get(key, {})
        previous_seen = int(previous.get("last_seen", 0) or 0)
        bot.STATE["users"][key] = {
            "username": user.username,
            "first_name": user.first_name,
            "last_seen": now,
        }
        # Persist immediately for a new user, otherwise at most once/minute.
        if not previous or now - previous_seen >= 60:
            await bot.save_state()

    bot.track_user = fast_track_user
    main = bot.main

    delay = 3
    try:
        while True:
            started = time.monotonic()
            try:
                logging.info("Starting FINYA HELPER bot")
                main()
                logging.warning("Bot stopped without an exception; restart in %s s", delay)
            except KeyboardInterrupt:
                logging.info("Bot stopped by user")
                break
            except Exception:
                logging.exception("Bot crashed; restart in %s s", delay)

            alive_for = time.monotonic() - started
            if alive_for >= 300:
                delay = 3
            else:
                delay = min(delay * 2, 60)

            time.sleep(delay)
    finally:
        lock_handle.close()


if __name__ == "__main__":
    run_forever()
