"""Bound database waits without changing transaction ownership."""

from __future__ import annotations

import os

import psycopg
from psycopg.conninfo import conninfo_to_dict

from .config import DATABASE_URL


def _positive(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def connect(**kwargs) -> psycopg.Connection:
    options = conninfo_to_dict(DATABASE_URL).get("options", os.getenv("PGOPTIONS", ""))
    for name, setting, default in (
        ("DB_STATEMENT_TIMEOUT_MS", "statement_timeout", 60000),
        ("DB_LOCK_TIMEOUT_MS", "lock_timeout", 5000),
        (
            "DB_IDLE_TRANSACTION_TIMEOUT_MS",
            "idle_in_transaction_session_timeout",
            300000,
        ),
    ):
        options += f" -c {setting}={_positive(name, default)}"
    kwargs.setdefault("connect_timeout", _positive("DB_CONNECT_TIMEOUT_SEC", 5))
    kwargs.setdefault("options", options.strip())
    kwargs.setdefault("keepalives_idle", 30)
    kwargs.setdefault("keepalives_interval", 10)
    kwargs.setdefault("keepalives_count", 3)
    kwargs.setdefault("tcp_user_timeout", 30000)
    return psycopg.connect(DATABASE_URL, **kwargs)
