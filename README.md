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

## Авторассылка T.N.K.C SQUAD

Управление подпиской находится внутри раздела **«Статус»**. Пользователь может включить или выключить личные уведомления без отдельной кнопки в главном меню.

Когда в публичном канале **@THKC_SQUAD** выходит новый пост, бот автоматически копирует его всем подписчикам и добавляет кнопку **«Открыть пост в канале»**.

Для работы авторассылки бот должен получать публикации канала. В админ-панели FINYA HELPER есть переключатель **«Авто ТГК: ВКЛ/ВЫКЛ»**.

Дополнительно:
- повторный `/start` показывает короткое приветствие;
- управление подпиской перенесено в **«Статус»**, без отдельной кнопки в главном меню;
- в **«Новости»** автоматически показывается закреплённый пост канала;
- подписчик может запросить последний сохранённый пост;
- админ-статистика показывает новых, активных, неактивных и недоступных пользователей.

## GitVerse Secrets

Для CI/CD используется один секрет репозитория:
- TELEGRAM_BOT_TOKEN

Workflow `.gitverse/workflows/finya-ci.yml` проверяет зависимости и синтаксис Python.
Workflow `.gitverse/workflows/deploy-tnkc.yml` предназначен для self-hosted Windows runner на TNKC-WORLD и умеет сформировать локальный `.env` из Telegram-токена.
