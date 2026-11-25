from functools import partial

from yhelper_shared.db import connect as connect_with_timeouts

from .config import DATABASE_URL

connect = partial(
    connect_with_timeouts,
    DATABASE_URL,
    statement_timeout_ms=60000,
    lock_timeout_ms=5000,
    idle_transaction_timeout_ms=300000,
)
