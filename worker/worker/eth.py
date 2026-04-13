from __future__ import annotations

import math
import time
from functools import lru_cache
from urllib.parse import urlparse

import psycopg
import requests
from eth_utils import keccak
from psycopg.types.json import Json

from .config import (
    CHAIN_RPC_URLS,
    CHAIN_WSS_URLS,
    DATABASE_URL,
    ETH_CALL_TIMEOUT_SEC,
    ETH_RPC_MAX_ATTEMPTS,
    ETH_RPC_RETRY_SLEEP_SEC,
    ETH_RPC_URL,
    ETH_TX_BATCH_SIZE,
    EXPLORER_BASE_URLS,
    CHAIN_LABELS,
    KONG_GQL_URL,
)


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.lower() in {"n/a", "na", "none", "null", "nan", "-", "--"}:
            return None
        cleaned = cleaned.replace(",", "")
        try:
            numeric = float(cleaned)
        except ValueError:
            return None
        return numeric if math.isfinite(numeric) else None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
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
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        value = cleaned
    try:
        chain_id = int(value)
    except (TypeError, ValueError):
        return None
    return chain_id if chain_id > 0 else None


def _to_int_or_none(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        value = cleaned
    try:
        parsed = int(value)
    except (TypeError, ValueError):
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
    tvl = vault.get("tvl")
    tvl_obj = tvl if isinstance(tvl, dict) else {}
    performance = vault.get("performance")
    performance_obj = performance if isinstance(performance, dict) else {}
    oracle = performance_obj.get("oracle")
    oracle_obj = oracle if isinstance(oracle, dict) else {}
    raw_tvl = _first_present(tvl_obj, ("close", "tvl", "tvlUsd", "usd", "totalValueLockedUSD"))
    raw_apr = _first_present(oracle_obj, ("apy", "netAPY", "netApy"))
    tvl_usd = _to_float(raw_tvl)
    est_apy = _to_float(raw_apr)
    numeric_parse_failures: list[str] = []
    if tvl_usd is None and _has_raw_numeric_value(raw_tvl):
        numeric_parse_failures.append("tvl_usd")
    if est_apy is None and _has_raw_numeric_value(raw_apr):
        numeric_parse_failures.append("est_apy")
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
        "token_decimals": _to_int_or_none(
            _first_present(asset_obj, ("decimals", "tokenDecimals"))
            or _first_present(meta_token_obj, ("decimals",))
            or _first_present(token_obj, ("decimals",))
            or _first_present(vault, ("decimals",))
        ),
        "tvl_usd": tvl_usd,
        "est_apy": est_apy,
        "raw": Json(vault),
    }
    return row, numeric_parse_failures


def _connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def _post_kong_gql_json(query: str, variables: dict[str, object] | None = None) -> dict[str, object]:
    response = requests.post(
        KONG_GQL_URL,
        json={"query": query, "variables": variables or {}},
        timeout=30,
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Kong GraphQL response is not an object")
    if payload.get("errors"):
        raise ValueError(f"Kong GraphQL returned errors: {payload['errors']}")
    return payload


def _rpc_url_for_chain(chain_id: int) -> str | None:
    url = CHAIN_RPC_URLS.get(chain_id)
    if url and url.strip():
        return url.strip()
    return None


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
    last_error: Exception | None = None
    for attempt in range(1, ETH_RPC_MAX_ATTEMPTS + 1):
        try:
            response = requests.post(
                rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=ETH_CALL_TIMEOUT_SEC,
            )
            if response.status_code >= 500 or response.status_code == 429:
                response.raise_for_status()
            if response.status_code >= 400:
                response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(f"Ethereum RPC error: {payload['error']}")
            return payload.get("result")
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            is_retryable = isinstance(exc, requests.RequestException) and (
                getattr(exc.response, "status_code", None) in {429}
                or getattr(exc.response, "status_code", 0) >= 500
                or exc.response is None
            )
            if attempt >= ETH_RPC_MAX_ATTEMPTS or not is_retryable:
                raise
            time.sleep(ETH_RPC_RETRY_SLEEP_SEC * attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Ethereum RPC call failed without error for method {method}")


def _eth_rpc(method: str, params: list[object]) -> object:
    return _eth_rpc_to_url(ETH_RPC_URL, method, params)


def _eth_selector(signature: str) -> str:
    return keccak(text=signature)[:4].hex()


def _eth_encode_address(value: str) -> str:
    normalized = value.lower().replace("0x", "")
    if len(normalized) != 40:
        raise ValueError(f"Invalid address length: {value}")
    return normalized.rjust(64, "0")


def _eth_encode_uint256(value: int) -> str:
    if value < 0:
        raise ValueError(f"uint256 cannot be negative: {value}")
    return f"{value:064x}"


def _eth_decode_address(result: str) -> str:
    if len(result) < 66:
        raise ValueError(f"Unexpected address result length: {result!r}")
    return f"0x{result[-40:]}".lower()


def _eth_call(address: str, signature: str, encoded_args: str = "", block_tag: str = "latest") -> str:
    data = f"0x{_eth_selector(signature)}{encoded_args}"
    result = _eth_rpc("eth_call", [{"to": address, "data": data}, block_tag])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise ValueError(f"Unexpected eth_call result for {signature}: {result!r}")
    return result


def _eth_decode_uint256(result: str) -> int:
    if len(result) < 66:
        raise ValueError(f"Unexpected uint256 result length: {result!r}")
    return int(result[2:66], 16)


def _eth_decode_string(result: str) -> str:
    payload = result[2:] if result.startswith("0x") else result
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


def _eth_call_uint(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> int:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_uint256(_eth_call(address, signature, encoded))


def _eth_call_address(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> str:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_address(_eth_call(address, signature, encoded))


def _eth_call_string(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> str:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_string(_eth_call(address, signature, encoded))


def _eth_call_string_for_chain(chain_id: int, address: str, signature: str) -> str:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    data = f"0x{_eth_selector(signature)}"
    result = _eth_rpc_to_url(rpc_url, "eth_call", [{"to": address, "data": data}, "latest"])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise ValueError(f"Unexpected eth_call result for {signature} on chain {chain_id}: {result!r}")
    return _eth_decode_string(result)


@lru_cache(maxsize=2048)
def _strategy_display_label(chain_id: int, strategy_address: str) -> str:
    normalized = strategy_address.lower()
    for signature in ("symbol()", "name()"):
        try:
            label = _eth_call_string_for_chain(chain_id, normalized, signature).strip()
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
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    block_number = _eth_rpc_to_url(rpc_url, "eth_blockNumber", [])
    if not isinstance(block_number, str):
        raise ValueError(f"Unexpected eth_blockNumber result for chain {chain_id}: {block_number!r}")
    return int(block_number, 16)


def _eth_get_block_for_chain(chain_id: int, block_number: int) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getBlockByNumber", [hex(block_number), False])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getBlockByNumber result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transaction_for_chain(chain_id: int, tx_hash: str) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getTransactionByHash", [tx_hash])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getTransactionByHash result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transaction_receipt_for_chain(chain_id: int, tx_hash: str) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getTransactionReceipt result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transactions_for_chain(chain_id: int, tx_hashes: list[str]) -> dict[str, dict[str, object]]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    if not tx_hashes:
        return {}
    transactions: dict[str, dict[str, object]] = {}
    for start in range(0, len(tx_hashes), ETH_TX_BATCH_SIZE):
        batch_tx_hashes = tx_hashes[start : start + ETH_TX_BATCH_SIZE]
        batch_payload = [
            {"jsonrpc": "2.0", "id": idx, "method": "eth_getTransactionByHash", "params": [tx_hash]}
            for idx, tx_hash in enumerate(batch_tx_hashes, start=1)
        ]
        last_error: Exception | None = None
        payload: object | None = None
        try:
            for attempt in range(1, ETH_RPC_MAX_ATTEMPTS + 1):
                try:
                    response = requests.post(rpc_url, json=batch_payload, timeout=ETH_CALL_TIMEOUT_SEC)
                    if response.status_code >= 500 or response.status_code == 429:
                        response.raise_for_status()
                    if response.status_code >= 400:
                        response.raise_for_status()
                    payload = response.json()
                    break
                except requests.RequestException as exc:
                    last_error = exc
                    is_retryable = (
                        getattr(exc.response, "status_code", None) in {429}
                        or getattr(exc.response, "status_code", 0) >= 500
                        or exc.response is None
                    )
                    if attempt >= ETH_RPC_MAX_ATTEMPTS or not is_retryable:
                        raise
                    time.sleep(ETH_RPC_RETRY_SLEEP_SEC * attempt)
            if payload is None:
                if last_error is not None:
                    raise last_error
                raise RuntimeError(f"Missing batched eth_getTransactionByHash payload for chain {chain_id}")
            if not isinstance(payload, list):
                raise ValueError(f"Unexpected batched eth_getTransactionByHash result for chain {chain_id}: {payload!r}")
            by_id = {idx: tx_hash for idx, tx_hash in enumerate(batch_tx_hashes, start=1)}
            for row in payload:
                if not isinstance(row, dict):
                    continue
                if row.get("error"):
                    raise ValueError(f"Ethereum RPC batch error on chain {chain_id}: {row['error']}")
                tx_hash = by_id.get(int(row.get("id") or 0))
                result = row.get("result")
                if tx_hash and isinstance(result, dict):
                    transactions[tx_hash] = result
        except (requests.RequestException, ValueError):
            for tx_hash in batch_tx_hashes:
                result = _eth_get_transaction_for_chain(chain_id, tx_hash)
                if isinstance(result, dict):
                    transactions[tx_hash] = result
    return transactions


def _eth_get_logs_for_chain(
    chain_id: int,
    *,
    addresses: list[str],
    from_block: int,
    to_block: int,
    topics: list[list[str] | str | None],
) -> list[dict[str, object]]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(
        rpc_url,
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
