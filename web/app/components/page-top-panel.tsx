import type { ReactNode } from "react";

type PageTopPanelTone = "discover" | "assets" | "composition" | "changes" | "regimes" | "chains" | "styfi";

type PageTopPanelProps = {
  intro: ReactNode;
  filters: ReactNode;
  secondaryFilters?: ReactNode;
  secondaryFiltersTitle?: string;
  filtersIntro?: ReactNode;
  introTitle?: string;
  filtersTitle?: string;
  tone?: PageTopPanelTone;
  className?: string;
};

export function PageTopPanel({
  intro,
  filters,
  secondaryFilters,
  secondaryFiltersTitle = "More Filters",
  filtersIntro,
  introTitle = "Read Me First",
  filtersTitle = "Filters",
  tone = "discover",
  className,
}: PageTopPanelProps) {
  return (
    <section className={`card page-top-panel tone-${tone}${className ? ` ${className}` : ""}`}>
      <div className="page-top-panel-controls">
        <div className="page-top-panel-controls-head">
          <div className="page-top-panel-controls-copy-block">
            <h2>{filtersTitle}</h2>
          </div>
          {filtersIntro ? <div className="page-top-panel-controls-copy">{filtersIntro}</div> : null}
        </div>
        <div className="page-top-panel-controls-body">
          <div className="page-top-panel-controls-primary">{filters}</div>
          {secondaryFilters ? (
            <details className="page-top-panel-details">
              <summary>
                <span className="page-top-panel-details-label">{secondaryFiltersTitle}</span>
                <span aria-hidden="true" className="page-top-panel-details-indicator" />
              </summary>
              <div className="page-top-panel-controls-secondary">{secondaryFilters}</div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="page-top-panel-copy-shell">
        <div className="page-top-panel-copy">
          <div className="page-top-panel-copy-head">
            <h2>{introTitle}</h2>
          </div>
          <div className="page-top-panel-copy-body">{intro}</div>
        </div>
        <details className="page-top-panel-details page-top-panel-copy-details">
          <summary>
            <span className="page-top-panel-details-label">{introTitle}</span>
            <span aria-hidden="true" className="page-top-panel-details-indicator" />
          </summary>
          <div className="page-top-panel-copy-body">{intro}</div>
        </details>
      </div>
    </section>
  );
}
