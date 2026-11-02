"""Bounded, process-local sharing for reads under a verified archive anchor."""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future


class HistoricalCache:
    def __init__(self, max_entries=2048, max_bytes=16 * 1024 * 1024, ttl=900):
        self.max_entries, self.max_bytes, self.ttl = max_entries, max_bytes, ttl
        self.entries = OrderedDict()
        self.pending = {}
        self.size = 0
        self.lock = threading.Lock()

    def acquire(self, key):
        """Return immutable cached bytes, or a shared future and its ownership."""
        with self.lock:
            item = self.entries.get(key)
            if item is not None:
                if item[0] > time.monotonic():
                    self.entries.move_to_end(key)
                    return item[1], None, False
                self.size -= len(self.entries.pop(key)[1])
            future = self.pending.get(key)
            if future is not None:
                return None, future, False
            if len(self.pending) >= self.max_entries:
                return None, None, False
            future = Future()
            self.pending[key] = future
            return None, future, True

    def resolve(self, key, future, result=None, error=None):
        raw = (
            None
            if error is not None
            else json.dumps(result, separators=(",", ":"), allow_nan=False).encode()
        )
        with self.lock:
            if self.pending.get(key) is not future:
                return
            del self.pending[key]
            if raw is not None and len(raw) <= self.max_bytes:
                self.entries[key] = (time.monotonic() + self.ttl, raw)
                self.size += len(raw)
                while (
                    len(self.entries) > self.max_entries or self.size > self.max_bytes
                ):
                    self.size -= len(self.entries.popitem(last=False)[1])
        if error is None:
            future.set_result(raw)
        else:
            future.set_exception(error)
