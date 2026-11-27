import { useState } from "react";
import { formatPct } from "../lib/format";

export function BorrowScenario({ collateralApr, averageRate, minimumRate, maximumRate, maximumLtv }: {
  collateralApr: number;
  averageRate: number;
  minimumRate: number;
  maximumRate: number;
  maximumLtv: number;
}) {
  const [leverage, setLeverage] = useState("2");
  const [rate, setRate] = useState(String(Number((Math.max(minimumRate, averageRate) * 100).toFixed(8))));
  const [drop, setDrop] = useState("0");
  const multiple = Number(leverage);
  const borrowRate = Number(rate) / 100;
  const priceDrop = Number(drop) / 100;
  const carry = multiple * collateralApr - (multiple - 1) * borrowRate;
  const ltv = (1 - 1 / multiple) / (1 - priceDrop);
  const valid = leverage !== "" && rate !== "" && drop !== "" && multiple >= 1
    && borrowRate >= minimumRate && borrowRate <= maximumRate && priceDrop >= 0 && priceDrop < 1
    && Number.isFinite(carry) && Number.isFinite(ltv);

  return <section className="flex-borrow-scenario" aria-labelledby="flex-scenario-title">
    <h4 id="flex-scenario-title">Borrowing scenario</h4>
    <div className="flex-scenario-body">
      <div className="flex-scenario-inputs" role="group" aria-label="Scenario inputs">
        <label>Leverage (×)<input type="number" min="1" step="any" value={leverage} onChange={event => setLeverage(event.target.value)} /></label>
        <label>Borrow rate (%)<input type="number" min={minimumRate * 100} max={maximumRate * 100} step="any" value={rate} onChange={event => setRate(event.target.value)} /></label>
        <label>Oracle price drop (%)<input type="number" min="0" step="any" value={drop} onChange={event => setDrop(event.target.value)} /></label>
      </div>
      <dl className="flex-scenario-results" aria-live="polite">
        <dt>Estimated equity APR</dt>
        <dd>{valid ? formatPct(carry) : "—"}</dd>
        <dt>LTV after drop</dt>
        <dd>{valid ? formatPct(ltv) : "—"}</dd>
        <dt>Further drop to liquidation</dt>
        <dd>{!valid ? "—" : ltv >= maximumLtv ? <span className="flex-scenario-limit">At or above limit</span> : formatPct(1 - ltv / maximumLtv)}</dd>
      </dl>
    </div>
    {!valid ? <p className="flex-scenario-validation" role="status">Enter leverage of 1× or more, a rate from {formatPct(minimumRate)} to {formatPct(maximumRate)}, and a price drop below 100%.</p> : null}
    <p className="section-note">Equity APR assumes constant rates and prices, before fees. The price drop holds debt fixed.</p>
  </section>;
}
