/**
 * Visualization Skeleton — mimics a viz-panel shape while data loads
 * so layout does not jump when charts appear.
 */

export function VizSkeleton({ variant = "panel" }: { variant?: "panel" | "bars" | "trend" }) {
  if (variant === "bars") {
    return (
      <div className="viz-skeleton">
        <div className="viz-skeleton-header" />
        <div className="viz-skeleton-bars">
          <div className="viz-skeleton-bar" />
          <div className="viz-skeleton-bar" />
          <div className="viz-skeleton-bar" />
          <div className="viz-skeleton-bar" />
          <div className="viz-skeleton-bar" />
        </div>
      </div>
    );
  }

  if (variant === "trend") {
    return (
      <div className="viz-skeleton">
        <div className="viz-skeleton-header" />
        <div className="viz-skeleton-body" style={{ borderRadius: "4px" }} />
      </div>
    );
  }

  return (
    <div className="viz-skeleton">
      <div className="viz-skeleton-header" />
      <div className="viz-skeleton-body" />
    </div>
  );
}
