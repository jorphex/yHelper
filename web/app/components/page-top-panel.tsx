import type { ReactNode } from "react";

type PageTopPanelProps = {
  intro: ReactNode;
  filters: ReactNode;
  filtersIntro?: ReactNode;
  introTitle?: string;
  filtersTitle?: string;
  className?: string;
};

export function PageTopPanel({
  intro,
  filters,
  filtersIntro,
  introTitle = "Read Me First",
  filtersTitle = "Filters",
  className,
}: PageTopPanelProps) {
  return (
    <section className={`card page-top-panel${className ? ` ${className}` : ""}`}>
      <div className="page-top-panel-copy">
        <h2>{introTitle}</h2>
        {intro}
      </div>
      <div className="page-top-panel-controls">
        <div className="page-top-panel-controls-head">
          <h2>{filtersTitle}</h2>
          {filtersIntro}
        </div>
        {filters}
      </div>
    </section>
  );
}
