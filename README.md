# FINYA HELPER

Telegram-бот с бесплатной схемой самовосстановления.

## Рекомендуемый запуск

Запускай не `bot.py`, а:

```bash
python watchdog.py
```

Цепочка защиты:

`watchdog.py -> run_background.py -> bot.py`

- `bot.py` пишет heartbeat каждые 30 секунд.
- `watchdog.py` проверяет heartbeat раз в 15 секунд.
- Если heartbeat старше 120 секунд или процесс умер — launcher перезапускается.
- `run_background.py` перезапускает бота после исключений с backoff 3–60 секунд.
- Логи ротируются в `logs/bot.log` и `logs/error.log`.

## Windows: автозапуск бесплатно

1. Открой **Планировщик заданий**.
2. Создай задачу `FINYA HELPER`.
3. Триггер: **При входе в систему** или **При запуске компьютера**.
4. Действие: запуск программы `pythonw.exe`.
5. Аргументы: полный путь к `watchdog.py`.
6. В поле «Рабочая папка» укажи папку проекта.
7. Включи «Перезапустить при сбое» и запуск независимо от входа пользователя, если доступно.

Для проверки можно сначала запустить обычным `python watchdog.py`.

## Linux: systemd

Создай `/etc/systemd/system/finya-helper.service`:

```ini
[Unit]
Description=FINYA HELPER Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/FINYA-HELPER
ExecStart=/usr/bin/python3 /path/to/FINYA-HELPER/watchdog.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Затем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finya-helper
```

Проверка:

```bash
systemctl status finya-helper
```

## Установка зависимостей

```bash
pip install -r requirements.txt
```

## Настройка токена Telegram

Токен нельзя записывать в исходный код или отправлять в Git. Перед запуском задай его одним из способов:

```bash
export TELEGRAM_BOT_TOKEN="токен_из_BotFather"
python watchdog.py
```

Или скопируй `.env.example` в локальный `.env` и замени значение-заглушку. Настоящий `.env` уже исключён через `.gitignore`.

## FINYA AI

Кнопка **ФИНЯ AI** включает режим диалога с памятью последних сообщений пользователя.

Текстовый AI:
- основной провайдер: OpenRouter;
- модели по умолчанию: NVIDIA Nemotron 3 Ultra Free -> OpenRouter Free Router;
- fallback: Groq openai/gpt-oss-120b, если задан GROQ_API_KEY.

Голосовые:
- Telegram voice/audio скачивается только во временный файл;
- распознавание: Groq Whisper whisper-large-v3-turbo;
- временный файл удаляется сразу после обработки.

Локальный .env:
OPENROUTER_API_KEY=...
GROQ_API_KEY=...

Команды:
- /ai — включить FINYA AI;
- /resetai — очистить память диалога.

API-ключи никогда не коммитить в GitVerse.

## GitVerse Secrets

В настройках репозитория создай секреты с точными именами:
- TELEGRAM_BOT_TOKEN
- OPENROUTER_API_KEY
- GROQ_API_KEY

Workflow .gitverse/workflows/finya-ci.yml проверяет наличие секретов, синтаксис Python и авторизацию Telegram/OpenRouter/Groq без вывода значений в лог.

Workflow .gitverse/workflows/deploy-tnkc.yml предназначен для self-hosted Windows runner на TNKC-WORLD: он синхронизирует main, формирует локальный .env из GitVerse Secrets, проверяет код и перезапускает FINYA HELPER.

Важно: GitVerse Secrets доступны только внутри workflow. Обычный процесс bot.py на ПК не может прочитать их напрямую без self-hosted runner/deploy workflow.
