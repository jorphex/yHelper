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
  title = "Data unavailable",
  description = "",
  error,
  onRetry,
  showHomeLink = true,
}: ErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div className="error-state">
      <div className="error-state-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h3 className="error-state-title">
        {title}
      </h3>

      {description && <p className="error-state-description" style={{ marginBottom: errorMessage ? "var(--space-2)" : "var(--space-4)" }}>
        {description}
      </p>}

      {errorMessage && (
        <code className="error-state-trace">
          {errorMessage}
        </code>
      )}

      <div className="error-state-actions">
        {onRetry && (
          <button
            onClick={onRetry}
            className="button button-primary"
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
      title="Data unavailable"
      onRetry={onRetry}
    />
  );
}

export function ApiError({ error, onRetry }: { error?: Error; onRetry: () => void }) {
  return (
    <ErrorState
      title="Data unavailable"
      error={error}
      onRetry={onRetry}
    />
  );
}
