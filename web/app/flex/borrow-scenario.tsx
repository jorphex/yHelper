import { useState } from "react";
import { formatPct } from "../lib/format";

function percentFromRatio(rate: number) {
  // Shift the decimal before converting it to a numeric input bound.
  const [coefficient, exponent = "0"] = String(rate).split("e");
  return Number(`${coefficient}e${Number(exponent) + 2}`);
}

export function BorrowScenario({ collateralApr, averageRate, minimumRate, maximumRate, maximumLtv }: {
  collateralApr: number;
  averageRate: number;
  minimumRate: number;
  maximumRate: number;
  maximumLtv: number;
}) {
  const minimumPercent = percentFromRatio(minimumRate);
  const maximumPercent = percentFromRatio(maximumRate);
  const [leverage, setLeverage] = useState("2");
  const [rate, setRate] = useState(() => {
    const initial = Number((averageRate * 100).toFixed(8));
    return String(Math.min(maximumPercent, Math.max(minimumPercent, initial)));
  });
  const [drop, setDrop] = useState("0");
  const multiple = Number(leverage);
  const debt = multiple - 1;
  const unlevered = debt === 0;
  const borrowPercent = Number(rate);
  const dropPercent = Number(drop);
  const validLeverage = Number.isFinite(multiple) && multiple >= 1;
  const validRate = unlevered || (rate !== "" && borrowPercent >= minimumPercent && borrowPercent <= maximumPercent);
  const validDrop = drop !== "" && dropPercent >= 0 && dropPercent < 100;
  const carry = unlevered ? collateralApr : multiple * collateralApr - debt * (borrowPercent / 100);
  const ltv = validLeverage && validDrop ? debt / (multiple * ((100 - dropPercent) / 100)) : null;
  // The indexed threshold and the scenario can round the same LTV to adjacent values.
  const atLimit = ltv !== null && maximumLtv - ltv <= maximumLtv * Number.EPSILON;

  return <section className="flex-borrow-scenario" aria-labelledby="flex-scenario-title">
    <h4 id="flex-scenario-title">Borrowing scenario</h4>
    <div className="flex-scenario-body">
      <div className="flex-scenario-inputs" role="group" aria-label="Scenario inputs">
        <div>
          <label htmlFor="flex-scenario-leverage">Leverage (×)</label>
          <input id="flex-scenario-leverage" type="number" min="1" step="any" value={leverage} aria-invalid={!validLeverage} aria-describedby={!validLeverage ? "flex-leverage-error" : undefined} onChange={event => setLeverage(event.target.value)} />
          {!validLeverage ? <small id="flex-leverage-error" role="status">Enter 1× or more.</small> : null}
        </div>
        <div>
          <label htmlFor="flex-scenario-rate">Borrow rate (%)</label>
          <input id="flex-scenario-rate" type="number" min={minimumPercent} max={maximumPercent} step="any" value={rate} aria-invalid={!validRate} aria-describedby={!validRate ? "flex-rate-error" : undefined} onChange={event => setRate(event.target.value)} />
          {!validRate ? <small id="flex-rate-error" role="status">Enter {minimumPercent}%–{maximumPercent}%.</small> : null}
        </div>
        <div>
          <label htmlFor="flex-scenario-drop">Oracle price drop (%)</label>
          <input id="flex-scenario-drop" type="number" min="0" step="any" value={drop} aria-invalid={!validDrop} aria-describedby={!validDrop ? "flex-drop-error" : undefined} onChange={event => setDrop(event.target.value)} />
          {!validDrop ? <small id="flex-drop-error" role="status">Enter 0% to below 100%.</small> : null}
        </div>
        <p className="section-note">APR assumes constant rates and prices, before fees. A price drop holds debt fixed.</p>
      </div>
      <div className="flex-scenario-results" aria-live="polite" data-limit={atLimit ? "breached" : undefined}>
        <dl className="flex-ltv-readout">
          <div><dt>LTV after drop</dt><dd>{ltv === null ? "—" : formatPct(ltv)}</dd></div>
          <div><dt>Liquidation limit</dt><dd>{formatPct(maximumLtv)}</dd></div>
        </dl>
        <div className="flex-ltv-track" aria-hidden="true">
          <span style={{ width: `${Math.min(ltv ?? 0, 1) * 100}%` }} />
          <span style={{ left: `${maximumLtv * 100}%` }} />
        </div>
        <dl className="flex-scenario-metrics">
          <div><dt>Further drop to liquidation</dt><dd>{unlevered ? "No debt" : ltv === null ? "—" : atLimit ? "At or above limit" : formatPct(1 - ltv / maximumLtv)}</dd></div>
          <div><dt>Estimated equity APR</dt><dd>{validLeverage && validRate && Number.isFinite(carry) ? formatPct(carry) : "—"}</dd></div>
        </dl>
      </div>
    </div>
  </section>;
}
