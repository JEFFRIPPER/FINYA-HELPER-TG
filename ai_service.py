"""AI backend for FINYA HELPER.

OpenRouter is the primary text provider; Groq is the text fallback and Whisper STT.
No secrets are stored in this file.
"""
import logging
import os
from pathlib import Path

import httpx

LOG = logging.getLogger(__name__)
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

DEFAULT_OPENROUTER_MODELS = [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter/free",
]

SYSTEM_PROMPT = """Ты Финя — виртуальная помощница проекта T.N.K.C SQUAD и FINYA HELPER.
Отвечай живо, естественно и по-русски, если пользователь не попросил другой язык.
Будь дружелюбной, но не навязчивой. Обычно отвечай кратко, для сложного вопроса — подробно.
Не выдавай себя за реального человека. Не придумывай факты, ссылки, действия или память.
Если не знаешь — прямо скажи. Учитывай контекст последних сообщений диалога.
У тебя может быть доступ только к информации, которую передал FINYA HELPER в текущем запросе."""


def _text_from_response(data):
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("AI provider returned no choices")
    content = (choices[0].get("message") or {}).get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                chunks.append(str(item.get("text", "")))
        return "\n".join(chunks).strip()
    return str(content).strip()


def _messages(history, user_text, user_name=None):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content[:6000]})
    prefix = f"Имя пользователя в Telegram: {user_name}.\n" if user_name else ""
    messages.append({"role": "user", "content": prefix + user_text[:12000]})
    return messages


async def generate_reply(history, user_text, user_name=None):
    messages = _messages(history, user_text, user_name)
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    errors = []

    if openrouter_key:
        models = [m.strip() for m in os.environ.get(
            "OPENROUTER_MODELS", ",".join(DEFAULT_OPENROUTER_MODELS)
        ).split(",") if m.strip()]
        payload = {"models": models, "messages": messages, "max_tokens": 1200, "temperature": 0.8}
        headers = {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://gitverse.ru/THKC_SQUAD_CREATOR/FINYA-HELPER",
            "X-Title": "FINYA HELPER",
        }
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(OPENROUTER_URL, headers=headers, json=payload)
                response.raise_for_status()
                text = _text_from_response(response.json())
                if text:
                    return text, "OpenRouter"
        except Exception as exc:
            LOG.warning("OpenRouter failed: %s", exc)
            errors.append("OpenRouter")


    if groq_key:
        payload = {
            "model": os.environ.get("GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
            "messages": messages,
            "max_tokens": 1200,
            "temperature": 0.8,
        }
        headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(GROQ_CHAT_URL, headers=headers, json=payload)
                response.raise_for_status()
                text = _text_from_response(response.json())
                if text:
                    return text, "Groq"
        except Exception as exc:
            LOG.warning("Groq chat failed: %s", exc)
            errors.append("Groq")

    if not openrouter_key and not groq_key:
        raise RuntimeError("AI_API_KEY_MISSING")
    raise RuntimeError("AI_PROVIDERS_FAILED:" + ",".join(errors))


async def transcribe_audio(path):
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not groq_key:
        raise RuntimeError("GROQ_API_KEY_MISSING")

    audio_path = Path(path)
    headers = {"Authorization": f"Bearer {groq_key}"}
    data = {
        "model": os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
        "response_format": "json",
        "language": os.environ.get("GROQ_WHISPER_LANGUAGE", "ru"),
        "temperature": "0",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            with audio_path.open("rb") as fh:
                files = {"file": (audio_path.name, fh, "application/octet-stream")}
                response = await client.post(GROQ_STT_URL, headers=headers, data=data, files=files)
            response.raise_for_status()
            result = response.json()
    except Exception as exc:
        LOG.warning("Groq STT failed: %s", exc)
        raise RuntimeError("STT_FAILED") from exc

    text = str(result.get("text", "")).strip()
    if not text:
        raise RuntimeError("STT_EMPTY")
    return text


def ai_config_status():
    return {
        "openrouter": bool(os.environ.get("OPENROUTER_API_KEY", "").strip()),
        "groq": bool(os.environ.get("GROQ_API_KEY", "").strip()),
    }
