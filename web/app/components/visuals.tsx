"use client";

type Kpi = {
  label: string;
  value: string;
  hint?: string;
};

type BarDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
};

export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="kpi-grid">
      {items.map((item) => (
        <article className="kpi-card" key={item.label}>
          <p className="kpi-label">{item.label}</p>
          <p className="kpi-value">{item.value}</p>
          {item.hint ? <p className="kpi-hint">{item.hint}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function BarList({
  title,
  items,
  valueFormatter,
  emptyText = "No data available.",
}: {
  title: string;
  items: BarDatum[];
  valueFormatter: (value: number | null | undefined) => string;
  emptyText?: string;
}) {
  const valid = items.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  const max = valid.reduce((acc, item) => Math.max(acc, Number(item.value)), 0);

  return (
    <section className="bar-panel">
      <h3>{title}</h3>
      {valid.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ul className="bar-list">
          {valid.map((item) => {
            const value = Number(item.value);
            const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
            return (
              <li key={item.id}>
                <div className="bar-row-head">
                  <span className="bar-label">{item.label}</span>
                  <span className="bar-value">{valueFormatter(item.value)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${width}%` }} />
                </div>
                {item.note ? <p className="bar-note muted">{item.note}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
