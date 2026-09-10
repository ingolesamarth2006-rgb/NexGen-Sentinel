from __future__ import annotations
import json, os, urllib.parse, urllib.request


def enabled() -> bool:
    return bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"))


def send_message(text: str) -> tuple[bool, str]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False, "Telegram not configured"
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    try:
        with urllib.request.urlopen(url, data=payload, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        return bool(data.get("ok")), "sent" if data.get("ok") else str(data)
    except Exception as e:
        return False, str(e)
