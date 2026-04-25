"use client";

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div className="footer-brand">yHelper</div>
        <nav className="footer-links">
          <a
            href="https://yearn.fi"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link external-link-inline"
          >
            Yearn
          </a>
          <a
            href="https://x.com/yearnfi"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link external-link-inline"
          >
            X / Twitter
          </a>
          <a
            href="https://github.com/yearn"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link external-link-inline"
          >
            GitHub
          </a>
        </nav>
        <span className="footer-tagline">Data tooling for Yearn</span>
      </div>
    </footer>
  );
}
