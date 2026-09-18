from pathlib import Path
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
BUNDLE = ROOT / "config" / "finya-secrets.enc"


def read_env():
    values = {}
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def decrypt_bundle(token):
    openssl = shutil.which("openssl")
    if not openssl:
        raise RuntimeError("openssl not found")
    env = os.environ.copy()
    env["TELEGRAM_BOT_TOKEN"] = token
    proc = subprocess.run(
        [openssl, "enc", "-d", "-aes-256-cbc", "-pbkdf2",
         "-in", str(BUNDLE), "-pass", "env:TELEGRAM_BOT_TOKEN"],
        check=True, capture_output=True, env=env,
    )
    return json.loads(proc.stdout.decode("utf-8"))


def write_env(current, secrets):
    lines = [
        f"TELEGRAM_BOT_TOKEN={current['TELEGRAM_BOT_TOKEN']}",
        f"OPENROUTER_API_KEY={secrets['OPENROUTER_API_KEY']}",
        f"GROQ_API_KEY={secrets['GROQ_API_KEY']}",
        "OPENROUTER_MODELS=nvidia/nemotron-3-ultra-550b-a55b-20260604:free,openrouter/free",
        "GROQ_TEXT_MODEL=openai/gpt-oss-120b",
        "GROQ_WHISPER_MODEL=whisper-large-v3-turbo",
        "GROQ_WHISPER_LANGUAGE=ru",
    ]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    current = read_env()
    token = current.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("Local TELEGRAM_BOT_TOKEN is missing")
    if not BUNDLE.exists():
        raise SystemExit("Encrypted GitVerse bundle is not present yet")
    secrets = decrypt_bundle(token)
    if not secrets.get("OPENROUTER_API_KEY") or not secrets.get("GROQ_API_KEY"):
        raise SystemExit("Encrypted bundle does not contain both AI keys")
    write_env(current, secrets)
    print("GitVerse secrets synced to local .env")


if __name__ == "__main__":
    main()
