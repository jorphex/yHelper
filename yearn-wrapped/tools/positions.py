"""Chain-aware period ledger shared by recaps and cohort snapshots."""

from bisect import bisect_right
from collections import defaultdict
import math

DAY = 86_400


def key(row: dict) -> str:
    return f"{int(row['chainId'])}:{row['vaultAddress'].lower()}"


def identity(position: str) -> dict:
    chain, address = position.split(":", 1)
    return {"chainId": int(chain), "vault": address}


def human(raw, decimals) -> float | None:
    if raw is None or not isinstance(decimals, int) or not 0 <= decimals <= 36:
        return None
    try:
        value = int(raw) / 10**decimals
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def timelines(incoming: list, outgoing: list, start: int, end: int):
    """Transfer is the sole balance source; net simultaneous flows before sampling."""
    opening = defaultdict(int)
    deltas = defaultdict(lambda: defaultdict(int))
    for rows, sign in ((incoming, 1), (outgoing, -1)):
        for row in rows:
            ts, position, amount = (
                int(row["blockTimestamp"]),
                key(row),
                sign * int(row["value"]),
            )
            if ts < start:
                opening[position] += amount
            elif ts <= end:
                deltas[position][ts] += amount
    result = {}
    for position in sorted(set(opening) | set(deltas)):
        balance = opening[position]
        points = [[start, balance]]
        for ts, delta in sorted(deltas[position].items()):
            if not delta:
                continue
            balance += delta
            if ts == start:
                points[0][1] = balance
            else:
                points.append([ts, balance])
        if not any(bal != 0 for _, bal in points):
            continue
        if points[-1][0] != end:
            points.append([end, balance])
        result[position] = points
    return dict(opening), result


class Series:
    """Sorted daily observations; never silently carry a gap for weeks."""

    def __init__(self, rows):
        points = {}
        for row in rows:
            try:
                ts, value = int(row["time"]), float(row["value"])
                if math.isfinite(value) and value > 0:
                    points[ts] = value
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
        self.times = sorted(points)
        self.values = [points[t] for t in self.times]

    def at(self, ts, max_age=2 * DAY):
        index = bisect_right(self.times, ts) - 1
        if index < 0 or ts - self.times[index] > max_age:
            return None
        return self.values[index]


def metrics(points, decimals, pps: Series, prices: Series):
    """Daily estimate: integrate shares × PPS changes at contemporaneous USD prices.

    Flows change shares after their timestamp; the preceding interval belongs to
    the old position. Peak checks include values immediately before and after flows.
    No lifetime growth or return-derived price enters these calculations.
    """
    start, end = points[0][0], points[-1][0]
    grid = sorted(
        {t for t in pps.times + prices.times if start <= t <= end}
        | {p[0] for p in points}
    )
    balances = dict(points)
    balance = 0
    last_ts = None
    last_pps = None
    underlying = usd = exposure = 0.0
    peak = 0.0
    complete = value_complete = True
    for ts in grid:
        current_pps, price = pps.at(ts), prices.at(ts)
        held = human(balance, decimals)
        if held is None or balance < 0:
            complete = value_complete = False
        elif held > 0:
            if current_pps is None:
                complete = value_complete = False
            else:
                if price is None:
                    value_complete = False
                else:
                    peak = max(peak, held * current_pps * price)
                if last_ts is not None:
                    if last_pps is None or ts - last_ts > 2 * DAY:
                        complete = False
                    else:
                        gain = held * (current_pps - last_pps)
                        underlying += gain
                        if price is None and gain != 0:
                            complete = False
                        else:
                            usd += gain * (price or 0)
                            if price is not None:
                                exposure += (
                                    held
                                    * last_pps
                                    * price
                                    * (ts - last_ts)
                                    / (365.25 * DAY)
                                )
        balance = balances.get(ts, balance)
        held_after = human(balance, decimals)
        if held_after is None or balance < 0:
            complete = value_complete = False
        elif held_after > 0:
            if current_pps is None or price is None:
                value_complete = False
            else:
                peak = max(peak, held_after * current_pps * price)
        last_ts, last_pps = ts, current_pps
    return {
        "growthUnderlying": underlying if complete else None,
        "growthUsd": round(usd, 2) if complete else None,
        "annualizedPct": round(100 * usd / exposure, 2)
        if complete and exposure > 0
        else None,
        "peakUsd": round(peak, 2) if value_complete else None,
        "isComplete": complete,
        "valueComplete": value_complete,
    }
