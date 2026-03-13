import type { ReactNode } from "react";

type PageTopPanelTone = "discover" | "assets" | "composition" | "changes" | "regimes" | "chains" | "styfi";

const TONE_LABELS: Record<PageTopPanelTone, string> = {
  discover: "Opportunity scan",
  assets: "Venue comparison",
  composition: "Exposure map",
  changes: "Timing readout",
  regimes: "Behavior map",
  chains: "Network lens",
  styfi: "Staking surface",
};

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
  const toneLabel = TONE_LABELS[tone];

  return (
    <section className={`card page-top-panel tone-${tone}${className ? ` ${className}` : ""}`}>
      <div className="page-top-panel-copy">
        <div className="page-top-panel-ribbon">
          <p className="page-top-panel-kicker">{toneLabel}</p>
          <p className="page-top-panel-ribbon-note">Read this once, then work from the controls.</p>
        </div>
        <div className="page-top-panel-copy-head">
          <h2>{introTitle}</h2>
        </div>
        <div className="page-top-panel-copy-body">{intro}</div>
      </div>
      <div className="page-top-panel-controls">
        <div className="page-top-panel-controls-head">
          <div className="page-top-panel-controls-copy-block">
            <p className="page-top-panel-kicker">Controls</p>
            <h2>{filtersTitle}</h2>
          </div>
          {filtersIntro ? <div className="page-top-panel-controls-copy">{filtersIntro}</div> : null}
        </div>
        <div className="page-top-panel-controls-body">
          <div className="page-top-panel-controls-primary">{filters}</div>
          {secondaryFilters ? (
            <details className="page-top-panel-details">
              <summary>{secondaryFiltersTitle}</summary>
              <div className="page-top-panel-controls-secondary">{secondaryFilters}</div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
