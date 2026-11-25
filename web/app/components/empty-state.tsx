interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: "search" | "filter" | "chart";
}

export function EmptyState({
  title,
  description,
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
    chart: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  };

  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {icons[icon]}
      </div>
      <h3 className="empty-state-title">
        {title}
      </h3>
      <p className="empty-state-description" style={{ marginBottom: actionLabel ? "var(--space-4)" : 0 }}>
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="button button-secondary empty-state-action"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
