/**
 * Error State Component
 * Displayed when data fetching fails
 */

interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: Error | string;
  onRetry?: () => void;
  showHomeLink?: boolean;
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load the data. This might be a temporary issue.",
  error,
  onRetry,
  showHomeLink = true,
}: ErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div
      className="error-state"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-12)",
        textAlign: "center",
      }}
    >
      {/* Error Icon */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--negative)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "var(--space-4)",
          color: "var(--negative)",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h3
        style={{
          fontSize: "var(--text-xl)",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: "var(--space-2)",
        }}
      >
        {title}
      </h3>

      <p
        style={{
          fontSize: "var(--text-base)",
          color: "var(--text-secondary)",
          maxWidth: "50ch",
          marginBottom: errorMessage ? "var(--space-2)" : "var(--space-4)",
        }}
      >
        {description}
      </p>

      {errorMessage && (
        <code
          style={{
            display: "block",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            background: "var(--bg-elevated)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-4)",
            maxWidth: "100%",
            overflow: "auto",
          }}
        >
          {errorMessage}
        </code>
      )}

      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {onRetry && (
          <button
            onClick={onRetry}
            className="button button-primary"
            style={{
              padding: "var(--space-3) var(--space-5)",
              background: "var(--accent)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color: "white",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              transition: "all 0.2s ease",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Try again
          </button>
        )}

        {showHomeLink && (
          <a
            href="/"
            className="button button-ghost"
            style={{
              padding: "var(--space-3) var(--space-5)",
              background: "transparent",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              textDecoration: "none",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Go home
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Pre-configured error states
 */

export function DataLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="Failed to load data"
      description="We couldn't fetch the latest data from our servers. This might be due to a network issue or temporary server downtime."
      onRetry={onRetry}
    />
  );
}

export function ApiError({ error, onRetry }: { error?: Error; onRetry: () => void }) {
  return (
    <ErrorState
      title="API error"
      description="There was a problem communicating with our data API."
      error={error}
      onRetry={onRetry}
    />
  );
}
