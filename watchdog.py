"""External watchdog for FINYA HELPER.

Starts run_background.py and restarts it if the heartbeat becomes stale.
Run this file from Task Scheduler/systemd for maximum resilience.
"""
from pathlib import Path
import os
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
HEARTBEAT = ROOT / "runtime" / "heartbeat.txt"
CHECK_EVERY = 15
STALE_AFTER = 120
START_GRACE = 90
WATCHDOG_LOCK = ROOT / "runtime" / "watchdog.lock"


def acquire_watchdog_lock():
    lock = WATCHDOG_LOCK.open("a+b")
    try:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, BlockingIOError):
        lock.close()
        raise SystemExit(0)
    return lock


def heartbeat_age():
    try:
        return max(0.0, time.time() - HEARTBEAT.stat().st_mtime)
    except FileNotFoundError:
        return None


def stop_process(proc):
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.terminate()
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def start_runner():
    kwargs = {"cwd": str(ROOT)}
    if os.name != "nt":
        kwargs["start_new_session"] = True
    return subprocess.Popen([sys.executable, str(ROOT / "run_background.py")], **kwargs)


def main():
    (ROOT / "runtime").mkdir(exist_ok=True)
    watchdog_lock = acquire_watchdog_lock()
    proc = None
    started_at = 0.0

    try:
        while True:
            if proc is None or proc.poll() is not None:
                proc = start_runner()
                started_at = time.time()
                time.sleep(3)

            age = heartbeat_age()
            grace_over = time.time() - started_at > START_GRACE
            if grace_over and (age is None or age > STALE_AFTER):
                stop_process(proc)
                try:
                    HEARTBEAT.unlink(missing_ok=True)
                except Exception:
                    pass
                proc = None

            time.sleep(CHECK_EVERY)
    finally:
        if proc is not None:
            stop_process(proc)
        watchdog_lock.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
