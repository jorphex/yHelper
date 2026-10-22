"""Yearn Wrapped payload builder.

Envio Transfers reconstruct period balances (deposits/withdrawals only supply flow
counts and asset amounts). yearn.fi supplies portfolio valuation and metadata.
Kong daily PPS and actual priceUsd observations estimate period vault yield,
position peaks and withdrawal counterfactuals. Unknown coverage stays unknown.

Usage: uv run python tools/recap.py 0x... [--year 2026] [--out data]
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import statistics

import datetime as dt
import json
import os
import pathlib
import tempfile
import time

import httpx

if __package__:
    from . import positions
else:  # Keep the existing direct-script CLI and offline helpers working.
    import positions

ENDPOINT = os.getenv(
    "YEARN_WRAPPED_GRAPHQL_URL", "https://indexer.hyperindex.xyz/5a089e4/v1/graphql"
)
PAGE = 100
MAX_PAGES = 200
CHAIN_NAMES = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    747474: "Katana",
}

YEARNFI = os.getenv("YEARN_WRAPPED_YEARNFI_URL", "https://yearn.fi").rstrip("/")
KONG = os.getenv("YEARN_WRAPPED_KONG_URL", "https://kong.yearn.fi").rstrip("/")
CACHE_TTL = 6 * 3600  # seconds; yearn.fi series change at most daily
CACHE_DIR = pathlib.Path(
    os.getenv(
        "YEARN_WRAPPED_UPSTREAM_CACHE_DIR",
        str(pathlib.Path(__file__).resolve().parents[1] / "data/cache"),
    )
)


class NoHistoryError(LookupError):
    """No indexed history on any supported chain."""


class UpstreamError(RuntimeError):
    """An upstream cannot provide a usable result after retries."""


def check_deadline(client):
    deadline = getattr(client, "recap_deadline", None)
    if deadline is not None and time.monotonic() >= deadline:
        raise UpstreamError("Recap build deadline exceeded")


def retry_delay(client, attempt, attempts):
    check_deadline(client)
    if attempt + 1 == attempts:
        return
    delay = 0.5 * (attempt + 1)
    deadline = getattr(client, "recap_deadline", None)
    if deadline is not None:
        delay = min(delay, max(0, deadline - time.monotonic()))
    time.sleep(delay)
    check_deadline(client)


def _fetch_json(client, url, cache, ttl, expected, *, optional=False, attempts=3):
    check_deadline(client)
    cached = _read_cache(cache, ttl)
    if isinstance(cached, expected):
        return cached
    last_error = None
    for attempt in range(attempts):
        check_deadline(client)
        try:
            response = client.get(url, timeout=10 if optional else 45)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, expected):
                raise ValueError("Unexpected upstream response")
            check_deadline(client)
            _write_cache(cache, data)
            return data
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            retry_delay(client, attempt, attempts)
    if optional:
        return expected()
    raise UpstreamError("Yearn holdings unavailable") from last_error


def fetch_yearnfi(client, path, addr):
    kind = path.split("?")[0].rsplit("/", 1)[-1]
    return _fetch_json(
        client,
        f"{YEARNFI}{path}",
        CACHE_DIR / f"yf-{kind}-{addr.lower()}.json",
        CACHE_TTL,
        dict,
    )


def fetch_kong_series(client, position, segment):
    chain, vault = position.split(":", 1)
    component = "?components=priceUsd" if segment == "tvl" else ""
    return _fetch_json(
        client,
        f"{KONG}/api/rest/timeseries/{segment}/{chain}/{vault}{component}",
        CACHE_DIR / f"kong-{segment}-{chain}-{vault}.json",
        CACHE_TTL,
        list,
        optional=True,
    )


MARKET = os.getenv(
    "YEARN_WRAPPED_MARKET_URL", "https://api.coingecko.com/api/v3"
).rstrip("/")
MARKET_TTL = 24 * 3600  # daily closes: a day of staleness is invisible at this scale


def _write_cache(cache: pathlib.Path, data) -> None:
    temporary = None
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=cache.parent, suffix=".tmp", delete=False
        ) as handle:
            temporary = pathlib.Path(handle.name)
            json.dump({"ts": time.time(), "data": data}, handle)
        temporary.replace(cache)
    except OSError:
        pass
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _read_cache(cache: pathlib.Path, ttl: int):
    try:
        cached = json.loads(cache.read_text())
        if 0 <= time.time() - cached["ts"] < ttl and isinstance(
            cached["data"], (list, dict)
        ):
            return cached["data"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def prune_cache():
    """Bound only reconstructable upstream cache files, never verification data."""
    files = []
    for pattern in ("yf-*.json", "kong-*.json", "market-*.json"):
        for path in CACHE_DIR.glob(pattern):
            try:
                stat = path.stat()
                files.append((stat.st_mtime, stat.st_size, path))
            except OSError:
                continue
    total = sum(size for _, size, _ in files)
    for index, (mtime, size, path) in enumerate(sorted(files)):
        if (
            time.time() - mtime < 7 * 86400
            and total <= 128 * 1024 * 1024
            and len(files) - index <= 512
        ):
            break
        try:
            path.unlink(missing_ok=True)
            total -= size
        except OSError:
            continue


def fetch_market_prices(client: httpx.Client, start_ts: int, end_ts: int) -> list:
    """Daily ETH/USD closes covering the period: [[ms, price], ...].

    Best-effort on CoinGecko's free tier: any failure returns [] so market
    context degrades to "unavailable" instead of failing the whole recap.
    """
    day = end_ts // 86400
    days = min(365, max(2, int((end_ts - start_ts) / 86400) + 2))
    return _fetch_json(
        client,
        f"{MARKET}/coins/ethereum/market_chart?vs_currency=usd&days={days}&interval=daily",
        CACHE_DIR / f"market-eth-{start_ts}-{day}.json",
        MARKET_TTL,
        dict,
        optional=True,
        attempts=2,
    ).get("prices", [])


def market_stats(client: httpx.Client, start_ts: int, end_ts: int) -> dict:
    """One-year market context (ETH/USD) to put the wallet's year in perspective."""
    raw = fetch_market_prices(client, start_ts, end_ts)
    points = []
    for ms, value in raw:
        try:
            ts, usd = int(ms / 1000), float(value)
        except (TypeError, ValueError):
            continue
        if start_ts <= ts <= end_ts:
            points.append([ts, usd])
    out = {
        "asset": "ETH",
        "source": "CoinGecko daily closes",
        "isComplete": False,
        "points": points[:: max(1, len(points) // 240)],
    }
    if len(points) < 30:
        return out
    first, last = points[0][1], points[-1][1]
    day_pct = [
        ((points[i][1] / points[i - 1][1]) - 1) * 100
        for i in range(1, len(points))
        if points[i - 1][1]
    ]
    if not day_pct:
        return out
    worst, best = (
        min(range(len(day_pct)), key=lambda i: day_pct[i]),
        max(range(len(day_pct)), key=lambda i: day_pct[i]),
    )
    peak, max_dd = 0.0, 0.0
    for _, usd in points:
        peak = max(peak, usd)
        max_dd = min(max_dd, (usd / peak - 1) * 100)

    def day(i: int) -> dict:
        return {
            "date": dt.datetime.fromtimestamp(points[i + 1][0], dt.timezone.utc)
            .date()
            .isoformat(),
            "pct": round(day_pct[i], 2),
        }

    out.update(
        {
            "isComplete": True,
            "startUsd": round(first, 2),
            "endUsd": round(last, 2),
            "changePct": round((last / first - 1) * 100, 2),
            "worstDay": day(worst),
            "bestDay": day(best),
            "maxDrawdownPct": round(max_dd, 2),
        }
    )
    return out


def quip(text: str, tone: str) -> dict:
    """Editorial one-liner; tone drives the accent colour."""
    return {"text": text, "tone": tone}


MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]


def monthly_activity(
    deposits: list[dict], withdrawals: list[dict], year: int
) -> list[dict]:
    """Deposit and withdrawal counts per calendar month, always 12 buckets so the
    deck can draw a fixed-width bar row without guessing about gaps."""
    dep, wit = [0] * 12, [0] * 12
    for rows, target in ((deposits, dep), (withdrawals, wit)):
        for e in rows:
            d = dt.datetime.fromtimestamp(int(e["blockTimestamp"]), dt.timezone.utc)
            if d.year == year:
                target[d.month - 1] += 1
    return [
        {"month": MONTH_NAMES[i], "deposits": dep[i], "withdrawals": wit[i]}
        for i in range(12)
    ]


def monthly_closes(points: list, year: int) -> list[dict]:
    """Last close per calendar month from [seconds, usd] closes, for a sparkline."""
    by_month: dict[int, dict] = {}
    for p in points or []:
        d = dt.datetime.fromtimestamp(int(p[0]), dt.timezone.utc)
        if d.year == year:
            by_month[d.month] = {
                "month": MONTH_NAMES[d.month - 1],
                "usd": round(float(p[1]), 4),
            }
    return [by_month[m] for m in sorted(by_month)]


# Stablecoin underlying tokens. Name-matched on purpose: the deck uses this to say
# "you stayed in stables through the crash", which is a statement about the token,
# not about depeg risk.
STABLE_SYMBOLS = {
    "USDC",
    "USDT",
    "DAI",
    "USDC.E",
    "USDBC",
    "FRAX",
    "GUSD",
    "TUSD",
    "LUSD",
    "USDE",
    "SUSDE",
    "CRVUSD",
    "MIM",
    "DUSD",
    "USDX",
    "FDUSD",
    "PYUSD",
    "USD0",
}


def market_overlap(
    market_points: list,
    valuation_points: list,
    monthly: list,
    year: int,
    valuation_complete: bool = True,
) -> dict:
    """The slice of the market the wallet was actually exposed to.

    The raw ETH numbers are the same for every address on the site, which makes the
    "year outside" card wallpaper. Exposure is not: it is the daily market moves on
    the days this wallet held something. Held means a positive USD position value on
    either side of the day's close, so a position opened mid-day still counts.

    `heldDays: 0` is only a fact when the USD curve could be measured. A wallet whose
    vault yearn.fi cannot price has an all-zero curve, which looks identical to "held
    nothing", so `isComplete` says which of the two it is. Without that flag the deck
    tells a wallet with a 118-day streak that none of those days found it holding.
    """
    daily = []  # (date, previous_date, pct_change)
    prev = None
    for ts, usd in market_points or []:
        try:
            d = dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).date()
            usd = float(usd)
        except (TypeError, ValueError):
            continue
        if prev and prev[1]:
            daily.append((d, prev[0], (usd / prev[1] - 1) * 100))
        prev = (d, usd)

    held = set()
    for ts, usd in valuation_points or []:
        try:
            if float(usd) > 0:
                held.add(dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).date())
        except (TypeError, ValueError):
            continue

    out = {
        "heldDays": len(held),
        "heldSharePct": None,
        "ethWhileHeldPct": None,
        "worstHeldDay": None,
        "dipMonths": [],
        "isComplete": bool(held) or valuation_complete,
    }
    if not daily or not held:
        return out

    compounded, worst, worst_day = 1.0, None, None
    month_pct: dict[int, float] = {}
    for d, prev_d, pct in daily:
        month_pct[d.month] = month_pct.get(d.month, 1.0) * (1 + pct / 100)
        if d in held or prev_d in held:
            compounded *= 1 + pct / 100
            if worst is None or pct < worst:
                worst, worst_day = pct, d
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    out["heldSharePct"] = round(100 * len(held) / (366 if leap else 365), 1)
    out["ethWhileHeldPct"] = round((compounded - 1) * 100, 2)
    if worst is not None and worst_day is not None:
        out["worstHeldDay"] = {"date": worst_day.isoformat(), "pct": round(worst, 2)}

    # Months that fell 10% or more where this wallet still deposited: buying the
    # dip is the one market behaviour a wallet can be accused of.
    for row in monthly or []:
        name = row.get("month")
        if name not in MONTH_NAMES or not row.get("deposits"):
            continue
        month = MONTH_NAMES.index(name) + 1
        if month in month_pct and (month_pct[month] - 1) * 100 <= -10:
            out["dipMonths"].append(name)
    return out


def drawdown_episodes(
    market_points: list, threshold: float = -20.0, recovery: float = -5.0
) -> list[dict]:
    """Peak-to-trough drawdowns deeper than `threshold` percent.

    An episode opens at the high that preceded the breach and closes when price is
    back within `recovery` percent of that high (or stays open, endTs None, if the
    year ended underwater). Used to answer: how many crashes did you actually sit
    through.
    """
    episodes: list[dict] = []
    peak = peak_ts = None
    cur = None
    for ts, usd in market_points or []:
        try:
            ts, usd = int(ts), float(usd)
        except (TypeError, ValueError):
            continue
        if peak is None or usd >= peak:
            peak, peak_ts = usd, ts
            if cur is not None:
                cur["endTs"] = ts
                episodes.append(cur)
                cur = None
            continue
        dd = (usd / peak - 1) * 100
        if cur is None:
            if dd <= threshold:
                cur = {"startTs": peak_ts, "endTs": None, "depthPct": round(dd, 2)}
        else:
            cur["depthPct"] = round(min(cur["depthPct"], dd), 2)
            if dd >= recovery:
                cur["endTs"] = ts
                episodes.append(cur)
                cur = None
    # A crash that never recovered inside the year still happened. Dropping the open
    # episode is how "you sat through two drawdowns" came back as zero.
    if cur is not None:
        episodes.append(cur)
    return episodes


def stable_event_share(rows: list[dict], symbols: dict) -> float | None:
    """Share of deposit events landing in stablecoin vaults, counted per event.

    Per event rather than per amount: adding 1 USDC to 1 WETH is not arithmetic.
    Deposits whose vault symbol is unknown are left out of the denominator, so the
    number means "of the deposits we could name".
    """
    if not rows:
        return None
    named = [str(symbols.get(positions.key(r), "")) for r in rows]
    named = [s for s in named if s]
    if not named:
        return None
    stables = sum(1 for s in named if s.upper() in STABLE_SYMBOLS)
    return round(100 * stables / len(named), 1)


def compact_usd(v) -> str:
    """$1.24M / $340k / $12.50, for quip text only (cards format their own)."""
    try:
        num = float(v)
    except (TypeError, ValueError):
        return ""
    sign = "-" if num < 0 else ""
    num = abs(num)
    if num >= 1e9:
        return f"{sign}${num / 1e9:.2f}B"
    if num >= 1e6:
        return f"{sign}${num / 1e6:.2f}M"
    if num >= 1e3:
        return f"{sign}${num / 1e3:.0f}k"
    return f"{sign}${num:.2f}"


def post(client: httpx.Client, query: dict) -> dict:
    last_err = None
    for attempt in range(4):
        check_deadline(client)
        try:
            r = client.post(ENDPOINT, json=query, timeout=30.0)
            r.raise_for_status()
            data = r.json()
            if "errors" in data:
                raise RuntimeError(data["errors"][0]["message"])
            return data["data"]
        except Exception as err:  # noqa: BLE001 - retryable probe
            last_err = err
            retry_delay(client, attempt, 4)
    raise UpstreamError("GraphQL failed after retries") from last_err


ENTITY_FIELDS = {
    "Deposit": "chainId vaultAddress owner sender shares assets blockTimestamp transactionHash",
    "Withdraw": "chainId vaultAddress owner receiver sender shares assets blockTimestamp transactionHash",
    "Transfer": "chainId vaultAddress sender receiver value blockTimestamp transactionHash",
}


def fetch_events(
    client: httpx.Client, entity: str, field: str, address: str, max_pages=MAX_PAGES
) -> list[dict]:
    """All rows for one entity where <field> == address, timestamp ascending."""
    rows, offset = [], 0
    # Envio stores checksummed strings; _eq on a normalized lowercase address misses history.
    chains = ", ".join(str(chain) for chain in sorted(CHAIN_NAMES))
    where = f'{{{field}: {{_ilike: "{address}"}}, chainId: {{_in: [{chains}]}}}}'
    fields = ENTITY_FIELDS[entity]
    while True:
        q = {
            "query": (
                f"{{ page: {entity}(where: {where}, limit: {PAGE}, offset: {offset}, "
                f"order_by: {{blockTimestamp: asc, id: asc}}) "
                f"{{ {fields} }} }}"
            )
        }
        page = post(client, q)["page"]
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        if offset >= (max_pages - 1) * PAGE:
            raise UpstreamError("History exceeds the supported pagination limit")
        offset += PAGE


def longest_positive_streak(points):
    best, span, start = 0, (None, None), None
    for ts, balance in points:
        if balance > 0 and start is None:
            start = ts
        if start is not None and ts - start > best:
            best, span = ts - start, (start, ts)
        if balance <= 0:
            start = None
    return best // 86400, span[0], span[1]


def compact_duration(seconds: int) -> str:
    """Short human duration for copy. Minutes, hours, days, then months: a wallet
    that held 400 days is being teased in months, not in 9,600 hours."""
    if seconds < 3_600:
        return f"{max(1, round(seconds / 60))} min"
    if seconds < 86_400:
        return f"{round(seconds / 3_600)} hours"
    days = int(seconds // 86_400)
    if days < 60:
        return f"{days} days"
    return f"{round(days / 30.44, 1)} months"


def tenure(first_ts: int | None, end_ts: int) -> dict | None:
    """How long this wallet has been in yearn, all time.

    The recap window starts on Jan 1; a wallet does not. "second year in" is the most
    identity-forming number available and the deck was throwing it away, so it is
    computed from the full event history rather than the period slice.
    """
    if not first_ts:
        return None
    days = max(0, (end_ts - first_ts) // 86_400)
    first_year = dt.datetime.fromtimestamp(first_ts, dt.timezone.utc).year
    last_year = dt.datetime.fromtimestamp(end_ts, dt.timezone.utc).year
    return {
        "firstYear": first_year,
        "days": int(days),
        "years": round(days / 365.25, 1),
        # Calendar years touched, this one included: 2023 to 2026 is four.
        "seasons": max(1, last_year - first_year + 1),
    }


def rhythm_stats(events: list[dict]) -> dict:
    """Hour, weekday and busiest-day counts for the wallet's own in-and-out traffic.

    Stored in UTC because a wallet has no timezone and the indexer's timestamps are
    chain time. The deck rotates the hour array into the viewer's clock, which is the
    only way "you move money at 3am" means anything to the person reading it.
    """
    hours, weekdays, by_day = [0] * 24, [0] * 7, {}
    for e in events:
        d = dt.datetime.fromtimestamp(e["blockTimestamp"], dt.timezone.utc)
        hours[d.hour] += 1
        weekdays[d.weekday()] += 1
        key = d.date().isoformat()
        by_day[key] = by_day.get(key, 0) + 1
    busiest = max(by_day.items(), key=lambda kv: kv[1]) if by_day else None
    return {
        "hoursUtc": hours,
        "weekdaysUtc": weekdays,
        "peakHourUtc": max(range(24), key=hours.__getitem__) if any(hours) else None,
        "peakWeekday": max(range(7), key=weekdays.__getitem__)
        if any(weekdays)
        else None,
        "busiestDay": {"date": busiest[0], "events": busiest[1]} if busiest else None,
        "activeDays": len(by_day),
    }


def holding_spans(timelines: dict, end_ts: int) -> dict:
    """Every stretch holding shares, across every vault, closed or still open.

    The median is the honest "how long do you actually stay"; the shortest closed span
    is the round trip worth teasing. Two limits worth stating: the timeline begins at
    the period boundary, so a position already open on day one is measured from there
    (it reads as at least the part of the year it was held), and an open span counts
    toward the median but not toward the fastest round trip, which needs an exit to
    bound it.
    """
    closed, durations, open_spans = [], [], 0
    for points in timelines.values():
        start = None
        for ts, bal in points:
            if bal > 0 and start is None:
                start = ts
            elif bal <= 0 and start is not None:
                closed.append((start, ts))
                durations.append(ts - start)
                start = None
        if start is not None:
            open_spans += 1
            durations.append(max(0, end_ts - start))
    if not durations:
        return {
            "holds": 0,
            "medianHoldSeconds": None,
            "fastestRoundTripSeconds": None,
            "roundTrips": 0,
            "openHolds": 0,
        }
    ordered = sorted(durations)
    return {
        "holds": len(durations),
        "medianHoldSeconds": int(statistics.median(ordered)),
        "fastestRoundTripSeconds": min(b - a for a, b in closed) if closed else None,
        "roundTrips": len(closed),
        "openHolds": open_spans,
    }


def load_medians(year) -> dict | None:
    """Seasonal constants for the "and everyone else" lines (data/medians.json).

    One hardcoded snapshot per season, produced by tools/medians.py from a sample of
    recently active wallets. A missing or unreadable file means no median lines at
    all, never a live batch computation.
    """
    path = pathlib.Path(__file__).resolve().parents[1] / "data" / "medians.json"
    try:
        blob = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    keys = {"n", "sampledAt", "vaults", "chains", "deposits", "holdDays"}
    return (
        blob
        if isinstance(blob, dict)
        and keys <= set(blob)
        and blob.get("year") == year
        and blob.get("ledgerVersion") == 2
        else None
    )


def phase_name(sign: int, busy: bool) -> str:
    """Chapter name for a stretch of months, keyed by what the month was doing."""
    if sign > 0:
        return "the building months" if busy else "the quiet adds"
    if sign < 0:
        return "the exit season" if busy else "the wind-down"
    return "the even keel"


def phases_of(monthly: list[dict], last_month: int = 12) -> list[dict] | None:
    """Cut the year into at most three behaviour chapters.

    Contiguous months with the same net direction form one chapter (empty months
    inherit the last moving month, and the months before the first move inherit
    that move); a chapter is "busy" when its traffic reaches about 30% of the
    busiest covered month, so quiet and loud read as different
    words. More than three chapters collapses the least active one into a neighbor,
    because a recap with six chapters is a ledger. `last_month` bounds a partial
    year: a recap built in October must not claim November. Returns None when the
    covered months saw nothing.
    """
    rows = monthly or []
    if len(rows) < 2:
        return None
    rows = rows[: max(2, min(12, int(last_month or 12)))]
    vols = [(r.get("deposits") or 0) + (r.get("withdrawals") or 0) for r in rows]
    peak_vol = max(vols)
    if not peak_vol:
        return None
    busy_line = max(3, (peak_vol * 3 + 9) // 10)
    raw, last = [], 0
    for vol, r in zip(vols, rows):
        if not vol:
            raw.append(None)
            continue
        dep, wit = r.get("deposits") or 0, r.get("withdrawals") or 0
        last = 1 if dep > wit else (-1 if wit > dep else 0)
        raw.append(last)
    signs = []
    carry = 0
    for s in raw:
        if s is None:
            signs.append(carry)
        else:
            signs.append(s)
            carry = s
    # Months before the year's first move inherit the first move's direction, not
    # "even keel": a silent March belongs to the same story as the April deposit
    # that ended it. A one-deposit year reads as one chapter, not nine.
    first_move = next((s for s in raw if s is not None), None)
    if first_move is not None:
        for i, s in enumerate(raw):
            if s is not None:
                break
            signs[i] = first_move

    def volume(seg: dict) -> int:
        return sum(vols[m] for m in seg["months"])

    def net(seg: dict) -> tuple[int, int]:
        d = sum((rows[m].get("deposits") or 0) for m in seg["months"])
        w = sum((rows[m].get("withdrawals") or 0) for m in seg["months"])
        return d, w

    segments: list[dict] = []
    for i, sign in enumerate(signs):
        if segments and segments[-1]["sign"] == sign:
            segments[-1]["months"].append(i)
        else:
            segments.append({"sign": sign, "months": [i]})
    # Cap at three chapters: fold the least active one into a neighbor, preferring
    # a neighbor of the same sign so the chapter's meaning survives the merge. The
    # survivor's name follows its own net direction, and a merge that rejoins two
    # same-sign neighbors folds again. Always shrinks: one deletion per pass, so
    # an alternating month pattern (twelve one-month chapters) terminates.
    while len(segments) > 3:
        idx = min(range(len(segments)), key=lambda i: (volume(segments[i]), i))
        if idx == 0:
            target = 1
        elif idx == len(segments) - 1:
            target = idx - 1
        else:
            target = min((idx - 1, idx + 1), key=lambda j: (volume(segments[j]), j))
        for j in (idx - 1, idx + 1):
            if 0 <= j < len(segments) and segments[j]["sign"] == segments[idx]["sign"]:
                target = j
                break
        survivor = segments[target]
        survivor["months"].extend(segments[idx]["months"])
        survivor["months"].sort()
        del segments[idx]
        d, w = net(survivor)
        survivor["sign"] = 1 if d > w else (-1 if w > d else 0)
        folded: list[dict] = []
        for seg in segments:
            if (
                folded
                and folded[-1]["sign"] == seg["sign"]
                and folded[-1]["months"][-1] == seg["months"][0] - 1
            ):
                folded[-1]["months"].extend(seg["months"])
            else:
                folded.append({"sign": seg["sign"], "months": sorted(seg["months"])})
        segments = folded
    return [
        {
            "name": phase_name(seg["sign"], volume(seg) >= busy_line),
            "months": [MONTH_NAMES[m] for m in seg["months"]],
            "deposits": sum((rows[m].get("deposits") or 0) for m in seg["months"]),
            "withdrawals": sum(
                (rows[m].get("withdrawals") or 0) for m in seg["months"]
            ),
        }
        for seg in segments
    ]


def verdict_of(
    *,
    seasons: int | None,
    visited: int,
    chains: int,
    round_trips: int,
    fastest_trip_s: int | None,
    streak_days: int,
    change_pct: float | None,
) -> dict | None:
    """One archetype per wallet, decided by facts the deck already carries.

    Ordered rules, first match wins: season count, then tempo (the fastest round
    trip, then how many there were), then commitment (the streak), then spread
    (vaults and chains), then loyalty, then growth. The names and the stamps are
    payload-owned, so the deck never invents a personality.
    """
    if not visited and not round_trips:
        return None
    plural = "" if visited == 1 else "s"
    if seasons == 1:
        return {
            "name": "the newcomer",
            "stamp": "just landed",
            "line": f"first season on yearn and {visited} vault{plural} deep already.",
        }
    if fastest_trip_s is not None and fastest_trip_s <= 3_600 and round_trips >= 3:
        return {
            "name": "the reflex",
            "stamp": "fast hands",
            "line": f"{round_trips} round trips. fastest: {compact_duration(fastest_trip_s)}.",
        }
    if round_trips >= 8:
        return {
            "name": "the round-tripper",
            "stamp": "in and out",
            "line": f"{round_trips} full round trips. the vaults know your footsteps.",
        }
    if round_trips <= 2 and streak_days >= 120:
        return {
            "name": "the camper",
            "stamp": "still here",
            "line": f"{streak_days} days is your longest sit.",
        }
    if visited >= 8 and chains >= 3:
        return {
            "name": "the drifter",
            "stamp": "everywhere",
            "line": f"{visited} vaults across {chains} chains. never one place for long.",
        }
    if visited <= 3 and (seasons or 0) >= 2:
        return {
            "name": "the loyalist",
            "stamp": "one home",
            "line": f"{seasons} seasons, {visited} vault{plural}. you know the way in.",
        }
    if change_pct is not None and change_pct >= 100:
        return {
            "name": "the compounder",
            "stamp": "still growing",
            "line": f"up {change_pct:.0f}% on the year. patient money.",
        }
    return {
        "name": "the farmer",
        "stamp": "the long game",
        "line": "farming is farming. you were here for it.",
    }


def peak_follow_up(
    points: list, peak_ts: int | None, window_days: int = 30
) -> dict | None:
    """What the market did in the window after the wallet's own peak.

    A peak with no date is a number; a peak with a date and the market's next thirty
    days is a story, and it is all measured. Nothing here pretends to a counterfactual
    trade you did not make.
    """
    if not points or peak_ts is None:
        return None
    after = [(ts, usd) for ts, usd in points if ts >= peak_ts]
    if len(after) < 2:
        return None
    start_usd = after[0][1]
    if not start_usd:
        return None
    horizon = peak_ts + window_days * 86_400
    later = [(ts, usd) for ts, usd in after if ts <= horizon]
    if len(later) < 2:
        later = after[-2:]  # the peak can sit at the very end of the year
    end_usd = later[-1][1]
    trough_ts, trough_usd = min(after, key=lambda p: p[1])
    return {
        "windowDays": window_days,
        "startUsd": round(start_usd, 2),
        "endUsd": round(end_usd, 2),
        "changePct": round((end_usd / start_usd - 1) * 100, 2),
        "troughTs": trough_ts,
        "troughPct": round((trough_usd / start_usd - 1) * 100, 2),
    }


def build_payload(address: str, year: int, client: httpx.Client) -> dict:
    start_ts = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    now_ts = int(time.time())
    year_end = int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    end_ts = min(now_ts, year_end - 1)
    address = address.lower()

    deposits = fetch_events(client, "Deposit", "owner", address)
    withdrawals = fetch_events(client, "Withdraw", "owner", address)
    transfers_out = fetch_events(client, "Transfer", "sender", address)
    transfers_in = fetch_events(client, "Transfer", "receiver", address)
    if not (deposits or withdrawals or transfers_out or transfers_in):
        raise NoHistoryError("No indexed Yearn history")

    for row in deposits + withdrawals + transfers_in + transfers_out:
        row["positionKey"] = positions.key(row)
    per_in = [t for t in transfers_in if start_ts <= t["blockTimestamp"] <= end_ts]
    per_out = [t for t in transfers_out if start_ts <= t["blockTimestamp"] <= end_ts]
    opening, timelines = positions.timelines(
        transfers_in, transfers_out, start_ts, end_ts
    )

    deposits_period = [d for d in deposits if start_ts <= d["blockTimestamp"] <= end_ts]
    withdrawals_period = [
        w for w in withdrawals if start_ts <= w["blockTimestamp"] <= end_ts
    ]

    deposits_by_vault: dict[str, int] = {}
    for d in deposits_period:
        deposits_by_vault[d["positionKey"]] = deposits_by_vault.get(
            d["positionKey"], 0
        ) + int(d["assets"])

    # yearn.fi supplies portfolio balances and metadata, never annual yield totals.
    portfolio = fetch_yearnfi(
        client,
        f"/api/holdings/portfolio?address={address}&denomination=usd&timeframe=all",
        address,
    )
    hist = portfolio.get("balance")
    if not isinstance(hist, dict):
        hist = fetch_yearnfi(
            client,
            f"/api/holdings/history?address={address}&denomination=usd&timeframe=all",
            address,
        )

    year_date = f"{year}-01-01"
    valuation_points = []
    if hist and hist.get("dataPoints"):
        pts = [
            p
            for p in hist["dataPoints"]
            if p["date"] >= year_date
            and p["date"]
            <= dt.datetime.fromtimestamp(end_ts, dt.timezone.utc).date().isoformat()
        ]
        for p in pts:
            ts = int(
                dt.datetime.fromisoformat(p["date"])
                .replace(tzinfo=dt.timezone.utc)
                .timestamp()
            )
            valuation_points.append([ts, float(p["value"])])

    growth_summary = (portfolio.get("growth") or {}).get("summary") or {}
    vault_meta = {}
    vault_symbols = {}
    for row in (portfolio.get("growth") or {}).get("vaults", []):
        position = positions.key(row)
        metadata = row.get("metadata") or {}
        vault_meta[position] = metadata
        vault_symbols[position] = metadata.get("symbol")

    def vault_label_of(vault):
        sym = vault_symbols.get(vault)
        if not sym:
            return short(positions.identity(vault)["vault"])
        return sym if sym.startswith("yv") else "yv" + sym

    human = positions.human
    all_vaults = sorted(set(timelines) | set(deposits_by_vault))
    chains_used = sorted({positions.identity(v)["chainId"] for v in all_vaults})
    first_event = min(
        (
            e["blockTimestamp"]
            for e in deposits + withdrawals + transfers_in + transfers_out
        ),
        default=None,
    )

    # Daily PPS and actual underlying prices; bounded upstream concurrency.
    def series_for(position):
        return position, (
            positions.Series(fetch_kong_series(client, position, "pps")),
            positions.Series(fetch_kong_series(client, position, "tvl")),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        series = dict(pool.map(series_for, timelines))
    calculations = {
        v: positions.metrics(points, vault_meta.get(v, {}).get("decimals"), *series[v])
        for v, points in timelines.items()
    }
    growth_vaults = [
        {
            **positions.identity(v),
            "symbol": vault_symbols.get(v),
            **{k: m[k] for k in ("growthUsd", "growthUnderlying", "annualizedPct")},
            "status": "ok" if m["isComplete"] else "partial",
            "issues": [] if m["isComplete"] else ["missing_period_prices"],
            "isComplete": m["isComplete"],
        }
        for v, m in calculations.items()
    ]
    growth_vaults.sort(
        key=lambda row: (
            row["growthUsd"] if row["growthUsd"] is not None else float("-inf")
        ),
        reverse=True,
    )
    ranking_complete = (
        bool(calculations)
        and set(calculations) == set(all_vaults)
        and all(m["valueComplete"] for m in calculations.values())
    )
    fav_basis = (
        "holdings"
        if ranking_complete
        else ("singleVault" if len(all_vaults) == 1 else None)
    )
    fav_vault = (
        max(calculations, key=lambda v: calculations[v]["peakUsd"])
        if ranking_complete
        else (all_vaults[0] if len(all_vaults) == 1 else None)
    )
    fav_peak_usd = calculations.get(fav_vault, {}).get("peakUsd")
    favourite = (fav_vault, deposits_by_vault.get(fav_vault, 0)) if fav_vault else None
    streak_vault, streak_days, streak_span = None, 0, (None, None)
    for vault, points in timelines.items():
        days, span_start, span_end = longest_positive_streak(points)
        if days > streak_days:
            streak_vault, streak_days, streak_span = vault, days, (span_start, span_end)

    def short(vault: str) -> str:
        return vault[:6] + "…" + vault[-4:]

    # --- editorial layer -------------------------------------------------
    # Every line below is derived from numbers already on the card; none of it
    # invents data. Tone steers colour.
    visited = len(all_vaults)
    still_holding = sum(1 for points in timelines.values() if points[-1][1] > 0)

    def by_symbol(rows: list[dict], field: str) -> list[dict]:
        """Human asset totals per underlying symbol (unknown decimals -> None)."""
        totals: dict[str, float] = {}
        unknown = 0.0
        for r in rows:
            meta = vault_meta.get(positions.key(r)) or {}
            sym = vault_symbols.get(positions.key(r))
            amount = human(r.get(field), meta.get("assetDecimals"))
            if amount is None:
                continue
            if not sym:
                unknown += amount
                continue
            totals[sym] = totals.get(sym, 0.0) + amount
        out = [
            {"symbol": s, "amount": round(a, 2)}
            for s, a in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        ]
        if unknown:
            out.append({"symbol": None, "amount": round(unknown, 2)})
        return out

    deposits_by_symbol = by_symbol(deposits_period, "assets")
    withdrawals_by_symbol = by_symbol(withdrawals_period, "assets")

    # What-if-held: the vault yield withdrawn shares would have earned had they
    # stayed put. Asset terms from Kong PPS; USD only where an asset price
    # estimate exists. Vault-level attribution, not personal P&L.
    forgone_by_vault: dict[str, dict] = {}
    biggest_exit = None
    covered_exits = 0
    for w in withdrawals_period:
        vault = w["positionKey"]
        meta = vault_meta.get(vault)
        pps_series, price_series = series.get(
            vault, (positions.Series([]), positions.Series([]))
        )
        if not meta or not pps_series.times or w.get("shares") is None:
            continue
        pps_exit = pps_series.at(int(w["blockTimestamp"]))
        pps_now = pps_series.at(end_ts)
        if not pps_exit or not pps_now:
            continue
        exited_shares = human(w["shares"], meta.get("decimals"))
        if exited_shares is None:
            continue
        forgone = exited_shares * (pps_now - pps_exit)
        covered_exits += 1
        entry = forgone_by_vault.setdefault(
            vault,
            {
                **positions.identity(vault),
                "label": vault_label_of(vault),
                "forgoneAssets": 0.0,
                "priceUsd": price_series.at(end_ts),
            },
        )
        entry["forgoneAssets"] += forgone
        price = price_series.at(end_ts)
        candidate = {
            "ts": int(w["blockTimestamp"]),
            **positions.identity(vault),
            "label": vault_label_of(vault),
            "forgoneAssets": round(forgone, 12),
            "forgoneUsd": round(forgone * float(price), 2) if price else None,
        }
        if (
            biggest_exit is None
            or candidate["forgoneUsd"] is not None
            and (
                biggest_exit["forgoneUsd"] is None
                or abs(candidate["forgoneUsd"]) > abs(biggest_exit["forgoneUsd"])
            )
        ):
            biggest_exit = candidate

    for entry in forgone_by_vault.values():
        entry["forgoneAssets"] = round(entry["forgoneAssets"], 12)
        price = entry.pop("priceUsd")
        entry["forgoneUsd"] = (
            round(entry["forgoneAssets"] * float(price), 2) if price else None
        )
    what_if_vaults = sorted(
        forgone_by_vault.values(),
        key=lambda e: abs(e["forgoneUsd"] or 0),
        reverse=True,
    )[:5]
    forgone_total_assets = None  # Different currencies must never be added.
    all_priced = bool(forgone_by_vault) and all(
        e["forgoneUsd"] is not None for e in forgone_by_vault.values()
    )
    forgone_total_usd = (
        round(
            sum(
                e["forgoneUsd"]
                for e in forgone_by_vault.values()
                if e["forgoneUsd"] is not None
            ),
            2,
        )
        if forgone_by_vault and all_priced
        else None
    )

    market = market_stats(client, start_ts, end_ts)

    # What the market did is the same for every wallet on the site. What this wallet
    # was exposed to is not, so the market card carries the overlap: the days it
    # actually held something, the crash months it still added to, and how much of
    # it was parked in stables while the chart fell over.
    activity_rows = monthly_activity(deposits_period, withdrawals_period, year)
    # Whether the USD curve can be trusted at all. A vault yearn.fi cannot price yields
    # an all-zero series, indistinguishable from an exited wallet unless this flag says
    # so; both the market overlap and the valuation card read the same answer.
    held_any = any(bal > 0 for points in timelines.values() for _, bal in points)
    silent_zero = (
        held_any and valuation_points and not any(p[1] for p in valuation_points)
    )
    valuation_ok = (
        bool(valuation_points)
        and bool(growth_summary.get("isComplete"))
        and not silent_zero
    )
    personal_market = market_overlap(
        market["points"],
        valuation_points,
        activity_rows,
        year,
        valuation_complete=valuation_ok,
    )
    personal_market["stableDepositPct"] = stable_event_share(
        deposits_period, vault_symbols
    )
    drawdowns_held = 0
    if streak_span[0]:
        for episode in drawdown_episodes(market["points"]):
            episode_end = episode["endTs"] or end_ts
            if episode_end >= streak_span[0] and episode["startTs"] <= (
                streak_span[1] or end_ts
            ):
                drawdowns_held += 1

    # The first onchain move, described rather than dated: what it was, into what,
    # on which chain. The deck has a date and no story without this.
    first_row = min(
        deposits + withdrawals + transfers_in + transfers_out,
        key=lambda e: e["blockTimestamp"],
        default=None,
    )
    first_detail = None
    if first_row:
        is_transfer = "value" in first_row and "assets" not in first_row
        first_vault = first_row["positionKey"]
        first_meta = vault_meta.get(first_vault) or {}
        first_raw = None if is_transfer else first_row.get("assets")
        first_chain = int(first_row["chainId"])
        first_detail = {
            "kind": "transfer"
            if is_transfer
            else ("withdraw" if first_row in withdrawals else "deposit"),
            "direction": "out" if first_row in transfers_out else "in",
            **positions.identity(first_vault),
            "vaultLabel": vault_label_of(first_vault),
            "chainId": first_chain,
            "chain": CHAIN_NAMES.get(first_chain, f"chain-{first_chain}"),
            "symbol": vault_symbols.get(first_vault),
            "underlying": round(human(first_raw, first_meta.get("assetDecimals")), 6)
            if human(first_raw, first_meta.get("assetDecimals")) is not None
            else None,
        }

    user_change_pct = (
        round((valuation_points[-1][1] / valuation_points[0][1] - 1) * 100, 2)
        if len(valuation_points) > 1 and valuation_points[0][1]
        else None
    )
    peak_usd_year = max((p[1] for p in valuation_points), default=None)
    end_usd_year = valuation_points[-1][1] if valuation_points else None
    growth_complete = (
        bool(growth_vaults)
        and set(calculations) == set(all_vaults)
        and all(v["isComplete"] for v in growth_vaults)
    )
    growth_total_usd = (
        round(sum(v["growthUsd"] for v in growth_vaults), 2)
        if growth_complete
        else None
    )

    # The shape of the year rather than its totals: how long the wallet has been
    # around, when it moves, how long it actually holds, and what the market did
    # after its own best day. All of it is already measured above.
    tenure_stats = tenure(first_event, end_ts)
    rhythm_rows = rhythm_stats(deposits_period + withdrawals_period)
    holding_rows = holding_spans(timelines, end_ts)
    peak_ts_year = (
        max(valuation_points, key=lambda p: p[1])[0] if valuation_points else None
    )
    peak_follow = peak_follow_up(market["points"], peak_ts_year)
    if not first_event:
        q_first = None
    elif first_event < 1640995200:  # before 2022: the V2 era
        q_first = quip("you were farming before the charts got boring", "hype")
    elif first_event < 1704067200:  # before 2024
        q_first = quip("early, by the standards that matter here", "hype")
    else:
        q_first = quip("a new chapter in your onchain story", "playful")

    if visited >= 5 and still_holding and visited >= still_holding * 4:
        q_vaults = quip(
            f"{visited} vaults visited, {still_holding} still holding. "
            "you collect vaults",
            "tease",
        )
    elif visited >= 5:
        q_vaults = quip(
            f"{visited} vaults in one year. the hop is the strategy", "tease"
        )
    elif visited == 1:
        q_vaults = quip("one vault. loyalty is a strategy", "calm")
    else:
        q_vaults = None

    if len(chains_used) == 1:
        q_chains = quip("mono-chain degen", "tease")
    elif len(chains_used) >= 3:
        q_chains = quip("bridges, gas, feelings", "tease")
    else:
        q_chains = None

    if not deposits_period and not withdrawals_period:
        q_ledger = quip(
            "shares moved. the vaults kept working"
            if per_in or per_out
            else "a quiet year",
            "calm",
        )
    elif len(withdrawals_period) > len(deposits_period):
        q_ledger = quip(
            "more exits than deposits. the vaults kept getting returned", "tease"
        )
    elif len(deposits_period) >= 50:
        q_ledger = quip("that is not a strategy, that is a habit", "hype")
    elif len(deposits_period) == 1:
        q_ledger = quip("one deposit, zero dithering", "hype")
    else:
        q_ledger = None

    if (
        peak_usd_year
        and end_usd_year is not None
        and peak_usd_year >= 10_000
        and end_usd_year < peak_usd_year * 0.1
    ):
        q_valuation = quip(
            f"you touched {compact_usd(peak_usd_year)} and left with pocket "
            "change. yearn harder",
            "pity",
        )
    elif user_change_pct is not None and user_change_pct >= 25:
        q_valuation = quip(
            f"your balance grew {user_change_pct:.0f}% this year", "hype"
        )
    elif user_change_pct is not None and user_change_pct <= -25:
        q_valuation = quip(
            "down with the market, but the vaults still paid what they could",
            "calm",
        )
    else:
        q_valuation = None

    if growth_total_usd is not None and growth_total_usd < 0:
        q_growth = quip("negative yield. it happens. this was one of those", "pity")
    elif growth_total_usd is not None and 0 <= growth_total_usd < 100:
        q_growth = quip("small, honest, real", "calm")
    else:
        q_growth = None

    # Behaviour gets its own voice: the numbers are behavioural, so the joke should
    # land on the habit, not on the money.
    median_hold = holding_rows["medianHoldSeconds"]
    fastest_trip = holding_rows["fastestRoundTripSeconds"]
    if median_hold is None:
        q_behaviour = None
    elif fastest_trip is not None and fastest_trip < 15 * 60:
        q_behaviour = quip(
            f"in and out in {compact_duration(fastest_trip)}. "
            "quick hands.",
            "tease",
        )
    elif median_hold < 7 * 86_400:
        q_behaviour = quip(
            f"median hold {compact_duration(median_hold)}. "
            "you treated yearn like a checkout page",
            "tease",
        )
    elif median_hold >= 180 * 86_400:
        q_behaviour = quip(
            f"median hold {compact_duration(median_hold)}. the vault knows your name",
            "hype",
        )
    else:
        q_behaviour = None

    if streak_days >= 180:
        q_streak = quip("half a year in one vault. the yield noticed", "hype")
    elif streak_days == 0:
        q_streak = quip("in and out the same day, a true degen", "tease")
    else:
        q_streak = None

    if market.get("isComplete"):
        eth, drawdown = market["changePct"], market.get("maxDrawdownPct") or 0
        stable_pct = personal_market.get("stableDepositPct")
        dip_months = personal_market.get("dipMonths") or []
        if stable_pct is not None and stable_pct >= 80 and drawdown <= -30:
            q_market = quip(
                f"ETH fell {abs(drawdown):.0f}% peak to trough and you were "
                f"{stable_pct:.0f}% stablecoins. boring, and still standing",
                "playful",
            )
        elif dip_months:
            q_market = quip(
                "you added while the market was down.",
                "hype",
            )
        elif drawdown <= -35:
            q_market = quip(
                f"ETH fell {abs(drawdown):.0f}% peak to trough this year. "
                "you were in vaults, unbothered",
                "hype",
            )
        elif eth <= -12:
            q_market = quip(
                f"a {abs(eth):.0f}% red year outside. you farmed through it",
                "calm",
            )
        elif eth >= 25:
            q_market = quip(
                f"ETH ripped {eth:.0f}% and you farmed on top of it", "hype"
            )
        else:
            q_market = quip("a sideways year. yield is yield", "calm")
    else:
        q_market = None

    if forgone_total_usd is not None and forgone_total_usd > 0:
        shown = compact_usd(forgone_total_usd) if forgone_total_usd is not None else ""
        q_whatif = quip(f"an estimated {shown} in yield after your exits.", "tease")
    elif forgone_total_usd is not None and forgone_total_usd < 0:
        q_whatif = quip("you exited right before the dip. nerve. or luck", "hype")
    else:
        q_whatif = None

    # The year cut into chapters, the archetype, the absent days and the retro on
    # the home-base vault: all of it from numbers already measured above. Each one
    # degrades to absent rather than to invented.
    # Partial years claim only covered months: a recap built in October must not
    # narrate November.
    end_month = dt.datetime.fromtimestamp(end_ts, dt.timezone.utc).month
    phase_rows = phases_of(activity_rows, last_month=end_month)
    q_phases = None
    # Absent days count any move: a transfer-funded wallet that never called
    # deposit() still showed up on its transfer day. Vault-traffic rhythm keeps
    # its own, narrower activeDays for the "how you move" card.
    move_days = {
        dt.datetime.fromtimestamp(int(e["blockTimestamp"]), dt.timezone.utc).date()
        for e in deposits_period + withdrawals_period + per_in + per_out
    }
    active_days = len(move_days)
    period_days = max(1, (end_ts - start_ts) // 86_400)
    absent_days = max(0, period_days - active_days)
    verdict = verdict_of(
        seasons=(tenure_stats or {}).get("seasons"),
        visited=visited,
        chains=len(chains_used),
        round_trips=holding_rows.get("roundTrips") or 0,
        fastest_trip_s=holding_rows.get("fastestRoundTripSeconds"),
        streak_days=streak_days,
        change_pct=None,  # Balance changes include flows; they do not establish return.
    )
    fav_first = None
    if favourite:
        fav_rows = [
            d
            for d in deposits_period
            if d["positionKey"] == favourite[0] and d.get("assets") is not None
        ]
        if fav_rows and all(
            human(d["assets"], vault_meta.get(favourite[0], {}).get("assetDecimals"))
            is not None
            for d in fav_rows
        ):
            d0 = min(
                fav_rows, key=lambda e: (int(e["blockTimestamp"]), int(e["assets"]))
            )
            meta = vault_meta.get(favourite[0]) or {}
            fav_first = {
                "ts": d0["blockTimestamp"],
                "assets": round(human(d0["assets"], meta.get("assetDecimals")), 6),
                "symbol": vault_symbols.get(favourite[0]),
            }

    timeline_card = []
    for vault, points in timelines.items():
        # Downsample (never truncate): keep the opening point and the last
        # point so emitted balances stay absolute.
        step = max(1, (len(points) + 399) // 400)
        kept = points[::step]
        if kept[-1] != points[-1]:
            kept.append(points[-1])
        timeline_card.append(
            {
                **positions.identity(vault),
                "label": vault_label_of(vault),
                "points": kept,
                "openingShares": opening.get(vault, 0),
                "isComplete": all(balance >= 0 for _, balance in points),
            }
        )

    return {
        "version": 1,
        "address": address,
        "resolvedName": None,
        "period": {
            "kind": "year",
            "year": year,
            "startTs": start_ts,
            "endTs": end_ts,
            "partial": now_ts < year_end,
        },
        "coverage": {
            "indexerChains": sorted(CHAIN_NAMES),
            "chainsUsed": [
                {"chainId": c, "name": CHAIN_NAMES.get(c, f"chain-{c}")}
                for c in chains_used
            ],
            "eventKinds": ["deposit", "withdraw", "transfer"],
            "v2PositionsIncomplete": True,
            "incomplete": [
                {
                    **positions.identity(positions.key(row)),
                    "source": "yearn.fi",
                    "issues": row.get("issues") or [row.get("status")],
                }
                for row in (portfolio.get("growth") or {}).get("vaults", [])
                if row.get("status") != "ok" or row.get("issues")
            ],
        },
        "cards": {
            "firstActivity": {
                "firstTs": first_event,
                "tenure": tenure_stats,
                "detail": first_detail,
                "isComplete": True,
                "quip": q_first,
            },
            "marketContext": {
                "definition": "ETH/USD daily closes across the recap year, shown as "
                "context for the year you farmed",
                "source": market["source"],
                "asset": market["asset"],
                "points": market["points"],
                "monthly": monthly_closes(market["points"], year),
                "startUsd": market.get("startUsd"),
                "endUsd": market.get("endUsd"),
                "changePct": market.get("changePct"),
                "worstDay": market.get("worstDay"),
                "bestDay": market.get("bestDay"),
                "maxDrawdownPct": market.get("maxDrawdownPct"),
                "yourChangePct": user_change_pct,
                "personal": personal_market,
                "isComplete": bool(market.get("isComplete")),
                "quip": q_market,
            },
            "vaultsExplored": {
                "count": visited,
                "stillHolding": still_holding,
                "vaults": [
                    {**positions.identity(v), "label": vault_label_of(v)}
                    for v in all_vaults
                ],
                "isComplete": True,
                "quip": q_vaults,
            },
            "chainsUsed": {
                "chainIds": chains_used,
                "names": [CHAIN_NAMES.get(c, f"chain-{c}") for c in chains_used],
                "isComplete": True,
                "quip": q_chains,
            },
            "favouriteVault": {
                "definition": "vault holding the most value in the period "
                "(deposits and received transfers both count)",
                "basis": fav_basis,
                **(
                    positions.identity(favourite[0])
                    if favourite
                    else {"vault": None, "chainId": None}
                ),
                "label": vault_label_of(favourite[0]) if favourite else None,
                "assetsDeposited": str(favourite[1]) if favourite else None,
                "peakPositionUsd": fav_peak_usd,
                "firstDeposit": fav_first,
                "isComplete": bool(favourite),
            },
            "depositsWithdrawn": {
                "depositsCount": len(deposits_period),
                "assetsDeposited": None,  # Different raw asset units are not aggregatable.
                "withdrawalsCount": len(withdrawals_period),
                "assetsWithdrawn": None,
                "depositsBySymbol": deposits_by_symbol,
                "withdrawalsBySymbol": withdrawals_by_symbol,
                "monthly": activity_rows,
                "isComplete": all(
                    human(
                        r.get("assets"),
                        vault_meta.get(r["positionKey"], {}).get("assetDecimals"),
                    )
                    is not None
                    for r in deposits_period + withdrawals_period
                ),
                "quip": q_ledger,
            },
            "whatIfHeld": {
                "definition": "vault yield your withdrawn shares would have earned had "
                "they stayed: exit-day assets x PPS growth to today. "
                "Vault-level attribution, not personal profit and loss, and "
                "it assumes the money would have stayed in the vault",
                "source": "Kong daily PPS and historical underlying price",
                "forgoneAssets": forgone_total_assets,
                "forgoneUsd": forgone_total_usd,
                "partial": not all_priced or covered_exits != len(withdrawals_period),
                "biggestExit": biggest_exit,
                "vaults": what_if_vaults,
                "exitsCovered": covered_exits,
                "exitsTotal": len(withdrawals_period),
                "isComplete": bool(forgone_by_vault)
                and all_priced
                and covered_exits == len(withdrawals_period),
                "quip": q_whatif,
            },
            "longestHoldingStreak": {
                "definition": "longest span in days with a positive share balance",
                **(
                    positions.identity(streak_vault)
                    if streak_vault
                    else {"vault": None, "chainId": None}
                ),
                "label": vault_label_of(streak_vault) if streak_vault else None,
                "days": streak_days if streak_vault else 0,
                "startTs": streak_span[0],
                "endTs": streak_span[1],
                "absentDays": absent_days,
                "drawdownsHeld": drawdowns_held,
                "isComplete": bool(streak_vault),
                "quip": q_streak,
            },
            "balanceTimeline": {
                "vaults": timeline_card,
                "isComplete": True,
            },
            "valuation": {
                "definition": "daily USD value of held positions "
                "(shares x historical PPS x asset price)",
                "source": "yearn.fi holdings portfolio balance",
                "points": valuation_points,
                "startUsd": valuation_points[0][1] if valuation_points else None,
                "endUsd": valuation_points[-1][1] if valuation_points else None,
                "peakUsd": peak_usd_year,
                "peakTs": peak_ts_year,
                "peakFollowUp": peak_follow,
                "changePct": user_change_pct,
                "isComplete": valuation_ok,
                "summary": {
                    "totalVaults": growth_summary.get("totalVaults"),
                    "completeVaults": growth_summary.get("completeVaults"),
                    "partialVaults": growth_summary.get("partialVaults"),
                }
                if growth_summary
                else None,
                "reason": (
                    "positions exist but yearn.fi valuation is empty, "
                    "vault not covered by their price universe"
                )
                if silent_zero
                else (
                    None
                    if valuation_points
                    else "yearn.fi holdings history unavailable"
                ),
                "quip": q_valuation,
            },
            "vaultGrowth": {
                "definition": "vault yield earned (protocol return) attributed to your "
                "positions during the recap period, estimated from daily PPS and historical underlying prices; not personal investment profit",
                "vaults": growth_vaults,
                "totalGrowthUsd": growth_total_usd,
                "estimated": True,
                "isComplete": growth_complete,
                "quip": q_growth,
            },
            "behaviour": {
                "definition": "timing and holding-time shape of your own in-and-out "
                "traffic. hour and weekday counts are chain time (UTC) and the deck "
                "rotates hours to the viewer's clock. holding spans come from the "
                "share timeline, so a position already open on day one counts from "
                "day one",
                "rhythm": rhythm_rows,
                "holdings": holding_rows,
                "isComplete": bool(rhythm_rows["busiestDay"]),
                "quip": q_behaviour,
            },
            "phases": {
                "list": phase_rows or [],
                "isComplete": bool(phase_rows),
                "quip": q_phases,
            },
            "verdict": verdict,
        },
        "medians": load_medians(year),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    with httpx.Client() as client:
        payload = build_payload(args.address, args.year, client)

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    addr = args.address.lower()
    path = out_dir / f"recap-{addr}-year{args.year}.json"
    path.write_text(json.dumps(payload, indent=1))
    cards = payload["cards"]
    print(f"saved {path}")
    print(
        f"vaults: {cards['vaultsExplored']['count']}, chains: {cards['chainsUsed']['names']}, "
        f"first activity: {cards['firstActivity']['firstTs']}, "
        f"favourite: {cards['favouriteVault']['label']} "
        f"(basis={cards['favouriteVault']['basis']}, "
        f"peakUsd={cards['favouriteVault']['peakPositionUsd']}), "
        f"streak: {cards['longestHoldingStreak']['days']}d, "
        f"valuation endUsd: {cards['valuation']['endUsd']}, "
        f"peakUsd: {cards['valuation']['peakUsd']}, "
        f"growth complete: {cards['vaultGrowth']['isComplete']}"
    )


if __name__ == "__main__":
    main()
