/**
 * Empty State Component
 * Displayed when data exists but is empty (e.g., no vaults match filters)
 */

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: "search" | "filter" | "data" | "chart";
}

export function EmptyState({
  title = "No data found",
  description = "Try adjusting your filters to see more results.",
  actionLabel,
  onAction,
  icon = "search",
}: EmptyStateProps) {
  const icons = {
    search: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
    filter: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    ),
    data: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </svg>
    ),
    chart: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  };

  return (
    <div
      className="empty-state"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-12)",
        textAlign: "center",
        color: "var(--ink-dim)",
      }}
    >
      <div
        style={{
          color: "var(--ink-muted)",
          marginBottom: "var(--space-4)",
        }}
      >
        {icons[icon]}
      </div>
      <h3
        style={{
          fontSize: "var(--text-lg)",
          fontWeight: 600,
          color: "var(--ink)",
          marginBottom: "var(--space-2)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--ink-dim)",
          maxWidth: "40ch",
          marginBottom: actionLabel ? "var(--space-4)" : 0,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn btn-secondary"
          style={{
            padding: "var(--space-2) var(--space-4)",
            background: "var(--surface-secondary)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-md)",
            color: "var(--ink)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Pre-configured empty states for common scenarios
 */

export function NoVaultsEmptyState({ onReset }: { onReset?: () => void }) {
  return (
    <EmptyState
      title="No vaults match your filters"
      description="Try adjusting your filter criteria to see more vaults. You can lower the minimum TVL or change the universe."
      actionLabel={onReset ? "Reset filters" : undefined}
      onAction={onReset}
      icon="filter"
    />
  );
}

export function NoChangesEmptyState() {
  return (
    <EmptyState
      title="No changes detected"
      description="There are no significant APY changes in the selected time window. Try extending the range or adjusting the stale threshold."
      icon="chart"
    />
  );
}

export function NoAssetsEmptyState({ onReset }: { onReset?: () => void }) {
  return (
    <EmptyState
      title="No assets found"
      description="No tokens match your current filter set. Try changing the token scope or reducing the minimum TVL."
      actionLabel={onReset ? "Reset filters" : undefined}
      onAction={onReset}
      icon="data"
    />
  );
}
