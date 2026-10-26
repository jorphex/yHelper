"""stYFI APRs using the official frontend's settled-reward and Vote Boost math."""

from __future__ import annotations

import logging
from decimal import Decimal, localcontext

import requests

from .config import STYFI_CONTRACTS, STYFI_EPOCH_LENGTH_SEC
from .eth import _eth_call, _eth_encode_address, _eth_encode_uint256, _eth_rpc

VOTE_BOOST = "0xa139250bcb3880a97c75fd4287d5bf2a6caf98a3"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WAD = 10**18
YEAR = 365 * 86400
logger = logging.getLogger(__name__)


def fetch_styfi_apr(payload: dict) -> dict:
    unavailable = {"state": "unavailable"}
    try:
        meta, price = payload["meta"], payload["global"]["yfi"]
        block = int(meta["blockNumber"])
        tag = hex(block)
        if _eth_rpc("eth_chainId", []) != "0x1":
            return unavailable
        head = _eth_rpc("eth_getBlockByNumber", [tag, False])
        if int(head["number"], 16) != block:
            return unavailable
        stamp = int(head["timestamp"], 16)
        price_cts, price_time = int(price["priceCts"]), int(price["priceUpdatedAt"])
        if (
            price_cts <= 0
            or not 0 < price_time <= stamp
            or stamp - price_time > 86400
            or price.get("priceStale") is True
            or str(price.get("priceStatus", "")).lower() not in {"fresh", "ready"}
            or price.get("priceSource") != "chainlink:yfi-usd"
            or str(price.get("priceFeed", "")).lower()
            != "0xa027702dbb89fbd58938e4324ac03b58d812b0e1"
        ):
            return unavailable

        def read(address, signature, *args):
            encoded = "".join(
                _eth_encode_address(value)
                if isinstance(value, str)
                else _eth_encode_uint256(value)
                for value in args
            )
            raw = _eth_call(address, signature, encoded, block_tag=tag)[2:]
            if not raw or len(raw) % 64:
                raise ValueError("Malformed staking read")
            return [
                int(raw[index : index + 64], 16) for index in range(0, len(raw), 64)
            ]

        distributor = STYFI_CONTRACTS["reward_distributor"]
        staking = STYFI_CONTRACTS["styfi_reward_distributor"]
        delegated = STYFI_CONTRACTS["styfix"]
        current = read(distributor, "epoch()")[0]
        reward_epoch = current - 1
        if (
            current != int(meta["epoch"])
            or reward_epoch < 0
            or read(distributor, "last_epoch()")[0] <= reward_epoch
        ):
            return unavailable
        count = read(staking, "total_weight_cursor()")[0]
        if count <= 0:
            return unavailable
        weight_epoch, weight = read(staking, "total_weight_entries(uint256)", count - 1)
        if weight_epoch > reward_epoch and count > 1:
            weight_epoch, weight = read(
                staking, "total_weight_entries(uint256)", count - 2
            )
        if weight_epoch > reward_epoch or weight <= 0:
            return unavailable
        staking_component = read(distributor, "components(address)", staking)
        boost_component = read(distributor, "components(address)", VOTE_BOOST)
        if (
            not staking_component[0]
            or staking_component[2] <= 0
            or staking_component[3] <= 0
        ):
            return unavailable
        with localcontext() as context:
            context.prec = 78
            multiplier = Decimal(1)
            if boost_component[0]:
                if boost_component[3] <= 0:
                    return unavailable
                multiplier += Decimal(
                    boost_component[2] * staking_component[3]
                ) / Decimal(boost_component[3] * staking_component[2])
            reward = read(
                distributor, "rewards(address,uint256)", staking, reward_epoch
            )[0]
            boost_reward = read(
                distributor, "rewards(address,uint256)", VOTE_BOOST, reward_epoch
            )[0]
            proposals = read(VOTE_BOOST, "num_proposals(uint256)", reward_epoch)[0]
            packed = read(
                VOTE_BOOST, "packed_total_weights(uint256)", reward_epoch // 5
            )[0]
            boost_weight = (
                (packed >> (50 * (reward_epoch % 5))) & ((1 << 50) - 1)
            ) * 10**10
            if proposals and boost_weight <= 0:
                return unavailable
            token = "0x" + f"{read(distributor, 'token()')[0]:040x}"
            reward_decimals = read(token, "decimals()")[0]
            asset = read(token, "asset()")[0]
            if asset != int(USDC, 16) or reward_decimals > 36:
                return unavailable
            asset_decimals = read(USDC, "decimals()")[0]
            pps = read(token, "convertToAssets(uint256)", 10**reward_decimals)[0]
            if asset_decimals != 6 or pps <= 0:
                return unavailable

            def annual(amount, assets):
                return Decimal(amount * pps * WAD * 100 * YEAR) / Decimal(
                    10**reward_decimals
                    * 10**asset_decimals
                    * assets
                    * price_cts
                    * STYFI_EPOCH_LENGTH_SEC
                )

            unit_reward = reward * WAD // weight
            unit_boost = (
                boost_reward * WAD * proposals // boost_weight if proposals else 0
            )
            base = annual(unit_reward, WAD)
            supply = read(delegated, "totalSupply()")[0]
            delegated_stake = read(
                STYFI_CONTRACTS["styfi"], "balanceOf(address)", delegated
            )[0]
            delegated_weight = read(
                VOTE_BOOST, "weight(uint256,address)", reward_epoch, delegated
            )[0]
            delegated_base = reward * delegated_stake // weight
            delegated_boost = (
                boost_reward * delegated_weight // boost_weight if boost_weight else 0
            )
            result = {
                "state": "ready",
                "block_number": block,
                "timestamp": stamp,
                "reward_epoch": reward_epoch,
                "base_apr": float(base),
                "max_apr": float(annual(unit_reward + unit_boost, WAD)),
                "estimated_max_apr": float(base * multiplier),
                "max_boost_multiplier": float(multiplier),
                "styfix_current_apr": float(
                    annual(delegated_base + delegated_boost, supply)
                )
                if supply >= 10**12
                else None,
                "styfix_estimated_apr": float(
                    annual(delegated_base, supply) * multiplier
                )
                if supply >= 10**12
                else None,
            }
        if _eth_rpc("eth_getBlockByNumber", [tag, False])["hash"] != head["hash"]:
            return unavailable
        return result
    except (
        KeyError,
        TypeError,
        ValueError,
        IndexError,
        ArithmeticError,
        RuntimeError,
        requests.RequestException,
    ) as exc:
        logger.warning("stYFI boosted APR unavailable (%s)", type(exc).__name__)
        return unavailable
