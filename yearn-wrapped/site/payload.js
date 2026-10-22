// Reject broken contracts before any templates or animations consume the payload.
const numeric = new Set(['year', 'startTs', 'endTs', 'firstTs', 'ts', 'count', 'stillHolding',
  'depositsCount', 'withdrawalsCount', 'exitsTotal', 'exitsCovered', 'days', 'absentDays',
  'drawdownsHeld', 'amount', 'underlying', 'usd', 'holds', 'roundTrips', 'openHolds', 'medianHoldSeconds',
  'fastestRoundTripSeconds', 'seasons', 'firstYear', 'years', 'heldDays', 'chainId']);

export function validatePayload(payload) {
  if (payload?.version !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(payload.address)
      || payload.period?.year !== 2026 || !payload.cards || typeof payload.cards !== "object" || Array.isArray(payload.cards)) {
    throw new Error('Unsupported recap payload');
  }
  let nodes = 0;
  function walk(value, key = '', depth = 0) {
    if (++nodes > 50000 || depth > 12) throw new Error('Oversized recap');
    if (value == null) return;
    if ((numeric.has(key) || /(?:Usd|Pct|Seconds|Ts)$/.test(key)) && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('Invalid recap number');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid recap number');
    if (typeof value === 'string' && value.length > 1000) throw new Error('Oversized recap text');
    if (Array.isArray(value)) {
      if (value.length > 2000) throw new Error('Oversized recap list');
      value.forEach((item) => walk(item, '', depth + 1));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([name, item]) => walk(item, name, depth + 1));
    }
  }
  walk(payload);
  return payload;
}
