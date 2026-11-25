export function DataLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="error-state">
      <div className="error-state-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h3 className="error-state-title">Data unavailable</h3>

      <div className="error-state-actions">
        <button type="button" onClick={onRetry} className="button button-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Try again
        </button>
        <a href="/" className="button button-ghost">Go home</a>
      </div>
    </div>
  );
}
