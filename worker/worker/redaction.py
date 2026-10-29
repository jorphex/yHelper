"""Remove credential-bearing request details from diagnostics."""

from __future__ import annotations

import logging
import re
from urllib.parse import urlsplit

_URL = re.compile(r"\b(?:https?|wss?|postgres(?:ql)?)://[^\s\"'<>\\]+", re.I)
_PRIVATE_PATH = re.compile(r"(/v\d+/|/api/webhooks/)[^\s\"'<>\\)]+", re.I)
_TELEGRAM_TOKEN = re.compile(r"(/bot)\d+:[A-Za-z0-9_-]+", re.I)
_SECRET = re.compile(
    r"(\b(?:api[_-]?key|access[_-]?token|password|secret|token)\b(?:\\?[\"'])?\s*[:=]\s*(?:\\?[\"'])?)[^&\s\"'\\,;)]+",
    re.I,
)
_AUTH = re.compile(r"(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+", re.I)


def _url(match: re.Match) -> str:
    try:
        parsed = urlsplit(match.group())
        host = parsed.hostname or "upstream"
        return f"{parsed.scheme}://{host}/[redacted]"
    except ValueError:
        return "[redacted URL]"


def redact(value):
    if isinstance(value, str):
        value = _URL.sub(_url, value)
        value = _PRIVATE_PATH.sub(r"\1[redacted]", value)
        value = _TELEGRAM_TOKEN.sub(r"\1[redacted]", value)
        value = _SECRET.sub(r"\1[redacted]", value)
        return _AUTH.sub(r"\1[redacted]", value)
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Format exception chains first so their request URLs are covered too.
        return redact(super().format(record))
