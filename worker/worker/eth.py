from __future__ import annotations

import math
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from urllib.parse import urlparse

from eth_utils import keccak
from psycopg.types.json import Json

from .config import (
    CHAIN_LABELS,
    CHAIN_RPC_URLS,
    CHAIN_WSS_URLS,
    ETH_CALL_TIMEOUT_SEC,
    ETH_RPC_URL,
    EXPLORER_BASE_URLS,
)
from .http import request, rpc_cache_hit

_FINALIZED = ContextVar("finalized_blocks", default=None)


@contextmanager
def finalized_scope():
    token = _FINALIZED.set({})
    try:
        yield
    finally:
        _FINALIZED.reset(token)


def _to_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.replace(",", "")
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return numeric if math.isfinite(numeric) else None


def _first_present(mapping: dict[str, object], keys: tuple[str, ...]) -> object:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _has_raw_numeric_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return False
        return cleaned.lower() not in {"n/a", "na", "none", "null", "nan", "-", "--"}
    return True


def _parse_chain_id(value: object) -> int | None:
    return _to_int_or_none(value) or None


def _to_int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def _normalize_optional_address(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.lower() if text.startswith("0x") else text


def _short_hex(value: str, *, left: int = 6, right: int = 4) -> str:
    if len(value) <= left + right + 2:
        return value
    return f"{value[: left + 2]}…{value[-right:]}"


def _decode_uint256_words(data: object) -> list[int]:
    if not isinstance(data, str) or not data.startswith("0x"):
        return []
    payload = data[2:]
    if not payload:
        return []
    if len(payload) % 64 != 0:
        return []
    return [int(payload[idx : idx + 64], 16) for idx in range(0, len(payload), 64)]


def _topic_address(topics: list[object], index: int) -> str | None:
    if index >= len(topics):
        return None
    topic = str(topics[index] or "").lower()
    if not topic.startswith("0x") or len(topic) < 42:
        return None
    return f"0x{topic[-40:]}"


def _chain_label(chain_id: int) -> str:
    return CHAIN_LABELS.get(chain_id, str(chain_id))


def _explorer_base_url(chain_id: int) -> str | None:
    return EXPLORER_BASE_URLS.get(chain_id)


def _explorer_tx_url(chain_id: int, tx_hash: str) -> str | None:
    base = _explorer_base_url(chain_id)
    if not base:
        return None
    return f"{base}/tx/{tx_hash}"


def _explorer_address_url(chain_id: int, address: str) -> str | None:
    base = _explorer_base_url(chain_id)
    if not base:
        return None
    return f"{base}/address/{address}"


def _yearn_vault_url(chain_id: int, vault_address: str) -> str:
    return f"https://yearn.fi/vaults/{chain_id}/{vault_address}"


def _normalize_vault(vault: dict, *, vault_address: str, chain_id: int) -> tuple[dict, list[str]]:
    asset = vault.get("asset")
    asset_obj = asset if isinstance(asset, dict) else {}
    token = vault.get("token")
    token_obj = token if isinstance(token, dict) else {}
    meta = vault.get("meta")
    meta_obj = meta if isinstance(meta, dict) else {}
    meta_token = meta_obj.get("token")
    meta_token_obj = meta_token if isinstance(meta_token, dict) else {}
    inclusion = vault.get("inclusion")
    inclusion_obj = inclusion if isinstance(inclusion, dict) else {}
    tvl = vault.get("tvl")
    tvl_obj = tvl if isinstance(tvl, dict) else {}
    performance = vault.get("performance")
    performance_obj = performance if isinstance(performance, dict) else {}
    oracle = performance_obj.get("oracle")
    oracle_obj = oracle if isinstance(oracle, dict) else {}
    historical = performance_obj.get("historical")
    historical_obj = historical if isinstance(historical, dict) else {}
    estimated = performance_obj.get("estimated")
    estimated_obj = estimated if isinstance(estimated, dict) else {}
    raw_tvl = (
        _first_present(tvl_obj, ("close", "tvl", "tvlUsd", "usd", "totalValueLockedUSD"))
        if tvl_obj
        else tvl
    )
    tvl_usd = _to_float(raw_tvl)
    numeric_parse_failures: list[str] = []
    if tvl_usd is None and _has_raw_numeric_value(raw_tvl):
        numeric_parse_failures.append("tvl_usd")
    if str(vault.get("symbol") or "").strip().lower() in {"ybold", "ysybold"}:
        raw_apy_values = [
            _first_present(oracle_obj, ("netAPY", "netApy")),
            _first_present(historical_obj, ("weeklyNet",)),
        ]
        parsed_apy_values = [_to_float(value) for value in raw_apy_values]
        if any(
            parsed is None and _has_raw_numeric_value(raw)
            for raw, parsed in zip(raw_apy_values, parsed_apy_values, strict=True)
        ):
            numeric_parse_failures.append("est_apy")
        valid_apy_values = [value for value in parsed_apy_values if value is not None]
        est_apy = max(valid_apy_values) if valid_apy_values else None
    elif "apy" in estimated_obj and estimated_obj["apy"] is not None:
        raw_apy = estimated_obj["apy"]
        est_apy = _to_float(raw_apy)
        if est_apy is None and _has_raw_numeric_value(raw_apy):
            numeric_parse_failures.append("est_apy")
    else:
        raw_apr = _first_present(oracle_obj, ("netAPY", "netApy"))
        est_apy = _to_float(raw_apr)
        if est_apy is None and _has_raw_numeric_value(raw_apr):
            numeric_parse_failures.append("est_apy")
    decimal_candidates = (
        asset_obj.get("decimals"),
        asset_obj.get("tokenDecimals"),
        meta_token_obj.get("decimals"),
        token_obj.get("decimals"),
        vault.get("decimals"),
    )
    token_decimals = next((value for value in map(_to_int_or_none, decimal_candidates) if value is not None), None)
    row = {
        "vault_address": vault_address,
        "chain_id": chain_id,
        "name": vault.get("name"),
        "symbol": vault.get("symbol"),
        "category": _first_present(meta_obj, ("category",)) or vault.get("category"),
        "kind": _first_present(meta_obj, ("kind",)) or vault.get("kind"),
        "version": _first_present(vault, ("apiVersion", "version")),
        "token_address": _normalize_optional_address(
            _first_present(asset_obj, ("address", "tokenAddress"))
            or _first_present(token_obj, ("address", "tokenAddress"))
        ),
        "token_symbol": _first_present(asset_obj, ("symbol", "tokenSymbol")) or _first_present(token_obj, ("symbol",)),
        "token_name": _first_present(asset_obj, ("name", "tokenName")) or _first_present(token_obj, ("name",)),
        "token_decimals": token_decimals,
        "tvl_usd": tvl_usd,
        "est_apy": est_apy,
        "origin": str(vault.get("origin") or "").strip() or None,
        "inclusion": Json(inclusion_obj),
        "catalog_is_yearn": (
            inclusion_obj.get("isYearn") if isinstance(inclusion_obj.get("isYearn"), bool) else None
        ),
        "is_hidden": vault.get("isHidden") if isinstance(vault.get("isHidden"), bool) else None,
        "is_retired": vault.get("isRetired") if isinstance(vault.get("isRetired"), bool) else None,
        "raw": Json(vault),
    }
    return row, numeric_parse_failures


def _rpc_url_for_chain(chain_id: int) -> str | None:
    return (CHAIN_RPC_URLS.get(chain_id) or "").strip() or None


def _required_rpc_url(chain_id: int) -> str:
    url = _rpc_url_for_chain(chain_id)
    if url is None:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    return url


def _derive_wss_url(rpc_url: str | None) -> str | None:
    if not rpc_url:
        return None
    candidate = rpc_url.strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme in {"ws", "wss"}:
        return candidate
    if parsed.scheme == "https":
        return f"wss://{parsed.netloc}{parsed.path}"
    if parsed.scheme == "http":
        return f"ws://{parsed.netloc}{parsed.path}"
    return None


def _wss_url_for_chain(chain_id: int) -> str | None:
    explicit = CHAIN_WSS_URLS.get(chain_id)
    if explicit and explicit.strip():
        return explicit.strip()
    return _derive_wss_url(_rpc_url_for_chain(chain_id))


def _eth_rpc_to_url(rpc_url: str, method: str, params: list[object]) -> object:
    response = request(
        "POST", rpc_url, timeout=ETH_CALL_TIMEOUT_SEC, rpc=True,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
    )
    payload = response.json()
    if not isinstance(payload, dict) or payload.get("id") != 1 or "result" not in payload:
        raise ValueError("Malformed Ethereum RPC response")
    return payload["result"]


def _eth_rpc_batch_to_url(
    rpc_url: str, calls: list[tuple[str, list[object]]],
    *, allow_errors: bool = False,
) -> list[object]:
    if not calls:
        return []
    payload = [
        {"jsonrpc": "2.0", "id": index, "method": method, "params": params}
        for index, (method, params) in enumerate(calls, start=1)
    ]
    body = request(
        "POST", rpc_url, json=payload, timeout=ETH_CALL_TIMEOUT_SEC,
        rpc=True, allow_rpc_errors=allow_errors,
    ).json()
    if not isinstance(body, list):
        raise ValueError("Unexpected Ethereum RPC batch response")
    rows = {row.get("id"): row for row in body if isinstance(row, dict)}
    if len(rows) != len(calls) or len(body) != len(calls):
        raise ValueError("Incomplete Ethereum RPC batch response")
    results = []
    for index in range(1, len(calls) + 1):
        row = rows.get(index)
        if row is not None and row.get("error") and allow_errors:
            results.append(None)
            continue
        if row is None or "result" not in row:
            raise ValueError(f"Missing Ethereum RPC batch response id={index}")
        results.append(row["result"])
    return results


def _eth_rpc(method: str, params: list[object]) -> object:
    return _eth_rpc_to_url(ETH_RPC_URL, method, params)


def _eth_selector(signature: str) -> str:
    return keccak(text=signature)[:4].hex()


def _eth_encode_address(value: str) -> str:
    normalized = value.lower().removeprefix("0x")
    if not re.fullmatch(r"[0-9a-f]{40}", normalized):
        raise ValueError("Invalid Ethereum address")
    return normalized.rjust(64, "0")


def _eth_encode_uint256(value: int) -> str:
    if not 0 <= value < 2**256:
        raise ValueError("Value is outside the uint256 range")
    return f"{value:064x}"


def _eth_decode_address(result: str) -> str:
    if len(result) < 66:
        raise ValueError(f"Unexpected address result length: {result!r}")
    return f"0x{result[-40:]}".lower()


def _eth_call(
    address: str,
    signature: str,
    *args: str | int,
    block_number: int | None = None,
    rpc_url: str | None = None,
) -> str:
    encoded = "".join(
        _eth_encode_address(value) if isinstance(value, str) else _eth_encode_uint256(value)
        for value in args
    )
    data = f"0x{_eth_selector(signature)}{encoded}"
    block_tag = hex(block_number) if block_number is not None else "latest"
    result = _eth_rpc_to_url(rpc_url or ETH_RPC_URL, "eth_call", [{"to": address, "data": data}, block_tag])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise ValueError(f"Unexpected eth_call result for {signature}: {result!r}")
    return result


def _eth_decode_uint256(result: str) -> int:
    if len(result) < 66:
        raise ValueError(f"Unexpected uint256 result length: {result!r}")
    return int(result[2:66], 16)


def _eth_decode_string(result: str) -> str:
    payload = result.removeprefix("0x")
    if len(payload) < 128:
        raise ValueError(f"Unexpected string result length: {result!r}")
    offset = int(payload[:64], 16) * 2
    if len(payload) < offset + 64:
        raise ValueError(f"Unexpected string offset: {result!r}")
    length = int(payload[offset : offset + 64], 16)
    start = offset + 64
    end = start + length * 2
    if len(payload) < end:
        raise ValueError(f"Unexpected string payload length: {result!r}")
    return bytes.fromhex(payload[start:end]).decode("utf-8")


def _eth_call_uint(address: str, signature: str, *args: str | int) -> int:
    return _eth_decode_uint256(_eth_call(address, signature, *args))


def _eth_call_uint_for_chain(
    chain_id: int,
    address: str,
    signature: str,
    *args: str | int,
    block_number: int | None = None,
) -> int:
    return _eth_decode_uint256(
        _eth_call(address, signature, *args, block_number=block_number, rpc_url=_required_rpc_url(chain_id))
    )


def _eth_call_address(address: str, signature: str) -> str:
    return _eth_decode_address(_eth_call(address, signature))


def _eth_call_string(address: str, signature: str, *, rpc_url: str | None = None) -> str:
    return _eth_decode_string(_eth_call(address, signature, rpc_url=rpc_url))


@lru_cache(maxsize=2048)
def _strategy_display_label(chain_id: int, strategy_address: str) -> str:
    normalized = strategy_address.lower()
    rpc_url = _rpc_url_for_chain(chain_id)
    if rpc_url is None:
        return _short_hex(normalized)
    for signature in ("symbol()", "name()"):
        try:
            label = _eth_call_string(normalized, signature, rpc_url=rpc_url).strip()
        except Exception:
            continue
        if label:
            return label
    return _short_hex(normalized)


def _hex_to_int(value: str | None) -> int | None:
    if not value or not isinstance(value, str):
        return None
    return int(value, 16)


def _eth_block_number_for_chain(chain_id: int) -> int:
    block_number = _eth_rpc_to_url(_required_rpc_url(chain_id), "eth_blockNumber", [])
    if not isinstance(block_number, str):
        raise ValueError(f"Unexpected eth_blockNumber result for chain {chain_id}: {block_number!r}")
    return int(block_number, 16)


def _eth_finalized_block_for_chain(chain_id: int) -> dict[str, object]:
    rpc_url = _required_rpc_url(chain_id)
    cache = _FINALIZED.get()
    key = (chain_id, rpc_url)
    if cache is not None and key in cache:
        rpc_cache_hit()
        return cache[key]
    payload = _eth_rpc_to_url(rpc_url, "eth_getBlockByNumber", ["finalized", False])
    if not isinstance(payload, dict):
        raise ValueError(
            f"Unexpected finalized block result for chain {chain_id}: {payload!r}"
        )
    try:
        for field in ("number", "timestamp"):
            value = payload[field]
            if (
                not isinstance(value, str)
                or not value.startswith("0x")
                or int(value, 16) < 0
            ):
                raise ValueError("Malformed finalized block metadata")
        block_hash = payload["hash"]
        if (
            not isinstance(block_hash, str)
            or not block_hash.startswith("0x")
            or len(block_hash) != 66
        ):
            raise ValueError("Malformed finalized block hash")
        if len(bytes.fromhex(block_hash[2:])) != 32:
            raise ValueError("Malformed finalized block hash")
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Malformed finalized block for chain {chain_id}") from exc
    if cache is not None:
        cache[key] = payload
    return payload


def _eth_get_block_for_chain(chain_id: int, block_number: int) -> dict[str, object]:
    payload = _eth_rpc_to_url(_required_rpc_url(chain_id), "eth_getBlockByNumber", [hex(block_number), False])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getBlockByNumber result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transaction_receipt_for_chain(chain_id: int, tx_hash: str) -> dict[str, object]:
    payload = _eth_rpc_to_url(_required_rpc_url(chain_id), "eth_getTransactionReceipt", [tx_hash])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getTransactionReceipt result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_logs_for_chain(
    chain_id: int,
    *,
    addresses: list[str],
    from_block: int,
    to_block: int,
    topics: list[list[str] | str | None],
) -> list[dict[str, object]]:
    payload = _eth_rpc_to_url(
        _required_rpc_url(chain_id),
        "eth_getLogs",
        [
            {
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "address": addresses,
                "topics": topics,
            }
        ],
    )
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected eth_getLogs result for chain {chain_id}: {payload!r}")
    return [row for row in payload if isinstance(row, dict)]


def _find_block_at_or_after(chain_id: int, target_ts: int) -> int:
    latest = _eth_block_number_for_chain(chain_id)
    low = 0
    high = latest
    candidate = latest
    while low <= high:
        mid = (low + high) // 2
        block = _eth_get_block_for_chain(chain_id, mid)
        block_ts = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
        if block_ts is None:
            raise ValueError(f"Missing timestamp for chain {chain_id} block {mid}")
        if block_ts >= target_ts:
            candidate = mid
            high = mid - 1
        else:
            low = mid + 1
    return candidate


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]
